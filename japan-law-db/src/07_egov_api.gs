/**
 * @file 07_egov_api.gs
 * e-Gov 法令API Version 2 のクライアント。
 *
 * このファイルはAPIの「呼び出し方」だけを担い、
 * 保存やMarkdown変換などの業務処理は一切持たない。
 * パス・パラメータ名は必ず 02_api_spec.gs を参照する。
 */

/**
 * API呼び出しの結果。
 * @typedef {{
 *   ok: boolean, status: number, body: string, data: *,
 *   url: string, error: ?string
 * }} ApiResult
 */

/**
 * APIへGETし、必要に応じてJSONをパースする。
 *
 * @param {string} url リクエストURL
 * @param {!Logger_} logger ロガー
 * @param {boolean} parseJson JSONとしてパースするか
 * @return {!ApiResult} 結果
 * @private
 */
function apiGet_(url, logger, parseJson) {
  var result = httpGet(url, logger);

  if (!result.ok) {
    return {
      ok: false, status: result.status, body: result.body, data: null,
      url: url, error: result.error
    };
  }

  if (!parseJson) {
    return {
      ok: true, status: result.status, body: result.body, data: null,
      url: url, error: null
    };
  }

  var data = safeJsonParse(result.body, undefined);
  if (data === undefined) {
    return {
      ok: false, status: result.status, body: result.body, data: null, url: url,
      error: 'レスポンスをJSONとして解析できませんでした（API仕様変更の可能性）'
    };
  }

  return {
    ok: true, status: result.status, body: result.body, data: data,
    url: url, error: null
  };
}

/**
 * 法令名で法令を検索する。
 *
 * 検索手段は環境により異なり得るため、複数の方法を順に試す。
 *   1. /laws に法令名を指定して絞り込む
 *   2. 1で0件なら /keyword で検索する
 *
 * @param {string} lawName 法令名
 * @param {!Logger_} logger ロガー
 * @return {{ok: boolean, candidates: !Array<!Object>, error: ?string, url: string}}
 */
function searchLawsByName(lawName, logger) {
  var queryParams = {};
  queryParams[EGOV_API_SPEC.PARAMS.LAW_TITLE] = lawName;
  queryParams[EGOV_API_SPEC.PARAMS.RESPONSE_FORMAT] = EGOV_API_SPEC.FORMATS.JSON;
  queryParams[EGOV_API_SPEC.PARAMS.LIMIT] = 100;

  var url = buildEgovUrl('LAWS', {}, queryParams);
  var result = apiGet_(url, logger, true);

  if (result.ok) {
    var list = pickLawList(result.data);
    if (list.length > 0) {
      return { ok: true, candidates: list, error: null, url: url };
    }
    logger.info('法令一覧APIで0件のため、キーワード検索を試みます', { law_name: lawName });
  } else {
    logger.warn('法令一覧APIの呼び出しに失敗しました。キーワード検索へ切り替えます', {
      law_name: lawName, error: result.error, status: result.status
    });
  }

  // フォールバック: キーワード検索
  var kwParams = {};
  kwParams[EGOV_API_SPEC.PARAMS.KEYWORD] = lawName;
  kwParams[EGOV_API_SPEC.PARAMS.RESPONSE_FORMAT] = EGOV_API_SPEC.FORMATS.JSON;
  kwParams[EGOV_API_SPEC.PARAMS.LIMIT] = 100;

  var kwUrl = buildEgovUrl('KEYWORD', {}, kwParams);
  var kwResult = apiGet_(kwUrl, logger, true);

  if (!kwResult.ok) {
    return {
      ok: false, candidates: [], url: kwUrl,
      error: kwResult.error || 'キーワード検索に失敗しました'
    };
  }

  return { ok: true, candidates: pickLawList(kwResult.data), error: null, url: kwUrl };
}

/**
 * 法令本文をXML形式で取得する。
 *
 * 長期保存する原本はXMLを優先する。
 * XMLで取得できない場合は、JSONレスポンス内の本文フィールドから
 * XML文字列を取り出すフォールバックを試みる。
 *
 * @param {string} lawIdOrNum 法令IDまたは法令番号（法令履歴IDも可）
 * @param {!Logger_} logger ロガー
 * @return {{ok: boolean, xml: ?string, source: string, url: string,
 *           error: ?string, meta: ?Object}}
 */
function fetchLawXml(lawIdOrNum, logger) {
  var pathParams = { lawIdOrNumOrRevisionId: lawIdOrNum };

  // --- 1. law_data を XML 形式で取得する（最優先） ---
  var xmlParams = {};
  xmlParams[EGOV_API_SPEC.PARAMS.RESPONSE_FORMAT] = EGOV_API_SPEC.FORMATS.XML;
  var xmlUrl = buildEgovUrl('LAW_DATA', pathParams, xmlParams);
  var xmlResult = apiGet_(xmlUrl, logger, false);

  if (xmlResult.ok && looksLikeLawXml_(xmlResult.body)) {
    return {
      ok: true, xml: xmlResult.body, source: 'law_data(xml)',
      url: xmlUrl, error: null, meta: null
    };
  }

  logger.warn('law_data のXML取得に失敗したため、JSON経由での取得を試みます', {
    law: lawIdOrNum, status: xmlResult.status, error: xmlResult.error
  });

  // --- 2. law_data を JSON で取得し、本文XMLを取り出す ---
  var jsonParams = {};
  jsonParams[EGOV_API_SPEC.PARAMS.RESPONSE_FORMAT] = EGOV_API_SPEC.FORMATS.JSON;
  var jsonUrl = buildEgovUrl('LAW_DATA', pathParams, jsonParams);
  var jsonResult = apiGet_(jsonUrl, logger, true);

  if (jsonResult.ok) {
    var fullText = pickField(
      jsonResult.data, EGOV_API_SPEC.FIELD_CANDIDATES.LAW_FULL_TEXT, null);

    if (typeof fullText === 'string' && looksLikeLawXml_(fullText)) {
      return {
        ok: true, xml: fullText, source: 'law_data(json.law_full_text)',
        url: jsonUrl, error: null, meta: jsonResult.data
      };
    }

    // 本文がJSONオブジェクトで返る場合、原本XMLとしては扱えない。
    // 推測でXMLへ組み立てると原本性が失われるため、明確にエラーとする。
    if (fullText && typeof fullText === 'object') {
      return {
        ok: false, xml: null, source: 'law_data(json)', url: jsonUrl, meta: jsonResult.data,
        error: '本文がJSON構造で返されました。原本XMLとして保存できないためスキップします' +
               '（law_file エンドポイントの利用可否を確認してください）'
      };
    }
  }

  // --- 3. law_file エンドポイントを試す ---
  var fileUrl = buildEgovUrl(
    'LAW_FILE', { fileType: 'xml', lawIdOrNumOrRevisionId: lawIdOrNum }, {});
  var fileResult = apiGet_(fileUrl, logger, false);

  if (fileResult.ok && looksLikeLawXml_(fileResult.body)) {
    return {
      ok: true, xml: fileResult.body, source: 'law_file(xml)',
      url: fileUrl, error: null, meta: null
    };
  }

  return {
    ok: false, xml: null, source: 'none', url: xmlUrl, meta: null,
    error: '法令本文XMLを取得できませんでした（' +
           'law_data(xml): ' + (xmlResult.error || xmlResult.status) + ' / ' +
           'law_file(xml): ' + (fileResult.error || fileResult.status) + '）'
  };
}

/**
 * 法令の改正履歴一覧を取得する。
 *
 * @param {string} lawIdOrNum 法令IDまたは法令番号
 * @param {!Logger_} logger ロガー
 * @return {{ok: boolean, revisions: !Array<!Object>, error: ?string, url: string}}
 */
function fetchLawRevisions(lawIdOrNum, logger) {
  var params = {};
  params[EGOV_API_SPEC.PARAMS.RESPONSE_FORMAT] = EGOV_API_SPEC.FORMATS.JSON;
  var url = buildEgovUrl('LAW_REVISIONS', { lawIdOrNum: lawIdOrNum }, params);
  var result = apiGet_(url, logger, true);

  if (!result.ok) {
    return { ok: false, revisions: [], error: result.error, url: url };
  }
  return { ok: true, revisions: pickLawList(result.data), error: null, url: url };
}

/**
 * 指定期間に更新された法令の一覧を取得する。
 *
 * 取得可能期間には制約があり得るため、呼び出し側は
 * 「0件＝更新なし」と即断せず、ok と件数の両方を確認すること。
 *
 * @param {string} fromIso 取得開始日時（ISO 8601）
 * @param {!Logger_} logger ロガー
 * @return {{ok: boolean, laws: !Array<!Object>, error: ?string, url: string}}
 */
function fetchUpdatedLaws(fromIso, logger) {
  var params = {};
  params[EGOV_API_SPEC.PARAMS.RESPONSE_FORMAT] = EGOV_API_SPEC.FORMATS.JSON;
  params[EGOV_API_SPEC.PARAMS.UPDATED_FROM] = toDateOnly_(fromIso);
  params[EGOV_API_SPEC.PARAMS.LIMIT] = 500;

  var url = buildEgovUrl('LAWS', {}, params);
  var result = apiGet_(url, logger, true);

  if (!result.ok) {
    return { ok: false, laws: [], error: result.error, url: url };
  }
  return { ok: true, laws: pickLawList(result.data), error: null, url: url };
}

/**
 * ISO 8601の日時から日付部分（YYYY-MM-DD）だけを取り出す。
 * @param {string} iso ISO 8601形式の日時
 * @return {string} 'YYYY-MM-DD'
 * @private
 */
function toDateOnly_(iso) {
  var date = toDate(iso);
  if (!date) {
    return '';
  }
  return date.toISOString().substring(0, 10);
}

/**
 * 文字列が法令XMLらしいか判定する。
 * HTMLのエラーページやJSONを誤って原本として保存しないための防波堤。
 *
 * @param {string} text 判定対象
 * @return {boolean} 法令XMLらしければ true
 * @private
 */
function looksLikeLawXml_(text) {
  if (!text || typeof text !== 'string') {
    return false;
  }
  var head = text.substring(0, 2000);
  if (head.indexOf('<Law') === -1) {
    return false;
  }
  // 本文の骨格が含まれていることを確認する
  return text.indexOf('<LawBody') !== -1 || text.indexOf('<LawNum') !== -1;
}

/**
 * 公式OpenAPI仕様を取得し、このプロジェクトの仕様マップと突き合わせる。
 *
 * ネットワークが遮断された環境では実装時に検証できないため、
 * 実運用の前に必ずGAS上でこの関数を実行し、差異がないことを確認すること。
 *
 * 差異が見つかった場合、修正すべきなのは 02_api_spec.gs の値だけである。
 *
 * @return {{ok: boolean, openapi_url: ?string, missing_endpoints: !Array<string>,
 *           found_paths: !Array<string>, notes: !Array<string>}}
 */
function verifyApiSpec() {
  var logger = createLogger('verify_api_spec');
  var notes = [];
  var document = null;
  var openapiUrl = null;

  logger.info('公式OpenAPI仕様の取得を開始します');

  for (var i = 0; i < EGOV_API_SPEC.OPENAPI_URL_CANDIDATES.length; i++) {
    var candidate = EGOV_API_SPEC.OPENAPI_URL_CANDIDATES[i];
    var result = httpGet(candidate, logger, { maxRetries: 1 });
    if (!result.ok) {
      notes.push('取得できず: ' + candidate + '（' + (result.error || result.status) + '）');
      continue;
    }
    var parsed = safeJsonParse(result.body, null);
    if (parsed && parsed.paths) {
      document = parsed;
      openapiUrl = candidate;
      notes.push('OpenAPI仕様を取得しました: ' + candidate);
      break;
    }
    notes.push('JSONとして解析できないかpathsが無い: ' + candidate);
  }

  if (!document) {
    notes.push(
      'OpenAPI仕様を自動取得できませんでした。' +
      'ブラウザで ' + EGOV_API_SPEC.BASE_URL + '/swagger-ui/ を開き、' +
      '各エンドポイントのパスとパラメータ名を 02_api_spec.gs と照合してください。');
    logger.error('OpenAPI仕様を取得できませんでした', { tried: notes.length });
    printSpecReport_({
      ok: false, openapi_url: null, missing_endpoints: [], found_paths: [], notes: notes
    });
    return {
      ok: false, openapi_url: null, missing_endpoints: [], found_paths: [], notes: notes
    };
  }

  var foundPaths = Object.keys(document.paths || {});
  var missing = [];

  EGOV_API_SPEC.REQUIRED_ENDPOINT_KEYS.forEach(function (key) {
    var endpoint = EGOV_API_SPEC.ENDPOINTS[key];
    // パスパラメータ名は仕様書と異なり得るため、形を無視して比較する
    var wanted = normalizePathShape_(endpoint.path);
    var matched = foundPaths.some(function (p) {
      return normalizePathShape_(p) === wanted;
    });
    if (!matched) {
      missing.push(key + ' (' + endpoint.path + ')');
      logger.warn('設定したパスが公式仕様に見つかりません', {
        endpoint: key, configured: endpoint.path
      });
    }
  });

  // 各エンドポイントの実際のパラメータ名を記録する
  foundPaths.forEach(function (p) {
    var operations = document.paths[p] || {};
    var getOp = operations.get;
    if (!getOp || !getOp.parameters) {
      return;
    }
    var names = getOp.parameters.map(function (param) {
      return param.name + (param.in ? '(' + param.in + ')' : '');
    });
    notes.push('GET ' + p + ' のパラメータ: ' + names.join(', '));
  });

  var ok = missing.length === 0;
  if (ok) {
    setProp(CONFIG.PROPERTY_KEYS.API_SPEC_VERIFIED_AT, nowIso());
    logger.info('API仕様の照合に成功しました', { openapi_url: openapiUrl });
  } else {
    logger.error('API仕様に差異があります。02_api_spec.gs を修正してください', {
      missing: missing.join(' / ')
    });
  }

  var report = {
    ok: ok, openapi_url: openapiUrl, missing_endpoints: missing,
    found_paths: foundPaths, notes: notes
  };
  printSpecReport_(report);
  return report;
}

/**
 * パスの形を比較用に正規化する（{xxx} を {} に統一する）。
 * @param {string} path APIパス
 * @return {string} 正規化後のパス
 * @private
 */
function normalizePathShape_(path) {
  return String(path).replace(/\{[^}]*\}/g, '{}').replace(/\/+$/, '');
}

/**
 * 仕様照合の結果を実行ログへ見やすく出力する。
 * @param {!Object} report verifyApiSpec() の戻り値
 * @private
 */
function printSpecReport_(report) {
  console.log('========== API仕様 照合レポート ==========');
  console.log('結果: ' + (report.ok ? 'OK（設定と公式仕様は一致）' : '要確認'));
  console.log('OpenAPI: ' + (report.openapi_url || '(取得できず)'));
  if (report.missing_endpoints.length > 0) {
    console.log('--- 公式仕様に見つからなかったパス ---');
    report.missing_endpoints.forEach(function (m) { console.log('  ' + m); });
  }
  if (report.found_paths.length > 0) {
    console.log('--- 公式仕様に存在するパス ---');
    report.found_paths.forEach(function (p) { console.log('  ' + p); });
  }
  console.log('--- 詳細 ---');
  report.notes.forEach(function (n) { console.log('  ' + n); });
  console.log('=========================================');
}
