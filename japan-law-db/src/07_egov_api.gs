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
 * 重要な注意点
 * ------------
 * e-Gov の law_title は **部分一致** で検索される。
 * 例えば「所得税法」で検索すると、次のようなものも大量にヒットする。
 *
 *   - 所得税法（本命）
 *   - 所得税法等の一部を改正する法律（年度ごとに多数存在する）
 *   - ...所得税法等の臨時特例に関する法律
 *
 * そのため1ページ目だけを見ていると、本命の法令が埋もれて
 * 「見つからない」と誤判定する恐れがある。
 * 本関数は **完全一致する法令が見つかるまでページを送る**。
 *
 * @param {string} lawName 法令名
 * @param {!Logger_} logger ロガー
 * @return {{ok: boolean, candidates: !Array<!Object>, error: ?string, url: string,
 *           pages: number, exactFound: boolean}}
 */
function searchLawsByName(lawName, logger) {
  var collected = [];
  var seenIds = {};
  var pages = 0;
  var lastUrl = '';
  var target = normalizeLawName(lawName);
  var exactFound = false;

  for (var page = 0; page < CONFIG.HTTP.MAX_SEARCH_PAGES; page++) {
    var queryParams = {};
    queryParams[EGOV_API_SPEC.PARAMS.LAW_TITLE] = lawName;
    queryParams[EGOV_API_SPEC.PARAMS.LIMIT] = CONFIG.HTTP.SEARCH_PAGE_SIZE;
    if (page > 0) {
      queryParams[EGOV_API_SPEC.PARAMS.OFFSET] = page * CONFIG.HTTP.SEARCH_PAGE_SIZE;
    }

    var url = buildEgovUrl('LAWS', {}, queryParams);
    lastUrl = url;
    var result = apiGet_(url, logger, true);

    if (!result.ok) {
      if (page === 0) {
        logger.warn('法令一覧APIの呼び出しに失敗しました。キーワード検索へ切り替えます', {
          law_name: lawName, error: result.error, status: result.status
        });
        return searchLawsByKeyword_(lawName, logger);
      }
      break;  // 2ページ目以降の失敗は、取得済みの分で判断する
    }

    var list = pickLawList(result.data);
    if (list.length === 0) {
      break;
    }

    // 同じ結果が返ってきた場合、offset が効いていないためページ送りを止める
    var newCount = 0;
    list.forEach(function (item) {
      var info = readLawInfo(item);
      var key = info.law_id || info.law_num || JSON.stringify(item);
      if (seenIds[key]) {
        return;
      }
      seenIds[key] = true;
      newCount++;
      collected.push(item);
      if (normalizeLawName(info.law_title) === target) {
        exactFound = true;
      }
    });

    pages++;

    if (newCount === 0) {
      // offset が無視されている（同じページが返ってきた）
      break;
    }
    if (exactFound) {
      break;  // 本命が見つかったので、これ以上ページを送らない
    }
    if (list.length < CONFIG.HTTP.SEARCH_PAGE_SIZE) {
      break;  // 最終ページ
    }
  }

  if (collected.length === 0) {
    logger.info('法令一覧APIで0件のため、キーワード検索を試みます', { law_name: lawName });
    return searchLawsByKeyword_(lawName, logger);
  }

  if (!exactFound) {
    logger.warn(
      '完全一致する法令名が見つかりませんでした（部分一致の候補のみ）', {
        law_name: lawName, candidates: collected.length, pages: pages
      });
  }

  return {
    ok: true, candidates: collected, error: null, url: lastUrl,
    pages: pages, exactFound: exactFound
  };
}

/**
 * キーワード検索で法令を探す（法令一覧APIが使えない場合のフォールバック）。
 *
 * @param {string} lawName 法令名
 * @param {!Logger_} logger ロガー
 * @return {{ok: boolean, candidates: !Array<!Object>, error: ?string, url: string,
 *           pages: number, exactFound: boolean}}
 * @private
 */
function searchLawsByKeyword_(lawName, logger) {
  var kwParams = {};
  kwParams[EGOV_API_SPEC.PARAMS.KEYWORD] = lawName;
  kwParams[EGOV_API_SPEC.PARAMS.LIMIT] = CONFIG.HTTP.SEARCH_PAGE_SIZE;

  var kwUrl = buildEgovUrl('KEYWORD', {}, kwParams);
  var kwResult = apiGet_(kwUrl, logger, true);

  if (!kwResult.ok) {
    return {
      ok: false, candidates: [], url: kwUrl, pages: 0, exactFound: false,
      error: kwResult.error || 'キーワード検索に失敗しました'
    };
  }

  var candidates = pickLawList(kwResult.data);
  var target = normalizeLawName(lawName);
  var exactFound = candidates.some(function (item) {
    return normalizeLawName(readLawInfo(item).law_title) === target;
  });

  return {
    ok: true, candidates: candidates, error: null, url: kwUrl,
    pages: 1, exactFound: exactFound
  };
}

/**
 * 法令本文を取得する。
 *
 * 原本の優先順位
 * --------------
 *   1. XML形式（長期保存の原本として最も望ましい）
 *   2. JSON形式（XMLが得られない場合。**レスポンスをそのまま原本として保存する**）
 *
 * JSONで取得した場合も、本文は e-Gov が返した構造をそのまま保持する。
 * JSONから疑似的なXMLを組み立てるようなことはしない（原本性が失われるため）。
 *
 * @param {string} lawIdOrNum 法令IDまたは法令番号（法令履歴IDも可）
 * @param {!Logger_} logger ロガー
 * @return {{ok: boolean, raw: ?string, tree: ?Object, format: string,
 *           extension: string, source: string, url: string,
 *           error: ?string, meta: ?Object}}
 *     raw       : 保存すべき原本の文字列（無加工）
 *     tree      : 解析済みの法令木構造
 *     format    : 'xml' | 'json'
 *     extension : 保存時の拡張子
 */
function fetchLawContent(lawIdOrNum, logger) {
  var pathParams = { lawIdOrNumOrRevisionId: lawIdOrNum };
  var attempts = [];

  // --- 1. XML形式での取得を試みる（原本として最優先） ---
  var xmlParams = {};
  xmlParams[EGOV_API_SPEC.PARAMS.LAW_FULL_TEXT_FORMAT] = EGOV_API_SPEC.FORMATS.XML;
  var xmlUrl = buildEgovUrl('LAW_DATA', pathParams, xmlParams);
  var xmlResult = apiGet_(xmlUrl, logger, false);

  if (xmlResult.ok && looksLikeLawXml_(xmlResult.body)) {
    try {
      return {
        ok: true, raw: xmlResult.body, tree: parseLawXml(xmlResult.body),
        format: 'xml', extension: 'xml', source: 'law_data(xml)',
        url: xmlUrl, error: null, meta: null
      };
    } catch (e) {
      attempts.push('law_data(xml): 解析失敗 ' + describeError(e));
    }
  } else {
    attempts.push('law_data(xml): ' + (xmlResult.error || 'HTTP ' + xmlResult.status));
  }

  // --- 2. JSON形式で取得する ---
  var jsonParams = {};
  jsonParams[EGOV_API_SPEC.PARAMS.LAW_FULL_TEXT_FORMAT] = EGOV_API_SPEC.FORMATS.JSON;
  var jsonUrl = buildEgovUrl('LAW_DATA', pathParams, jsonParams);
  var jsonResult = apiGet_(jsonUrl, logger, true);

  if (jsonResult.ok) {
    var fullText = pickField(
      jsonResult.data, EGOV_API_SPEC.FIELD_CANDIDATES.LAW_FULL_TEXT, null);

    // 本文がXML文字列で返る場合
    if (typeof fullText === 'string' && looksLikeLawXml_(fullText)) {
      try {
        return {
          ok: true, raw: fullText, tree: parseLawXml(fullText),
          format: 'xml', extension: 'xml', source: 'law_data(json.law_full_text=xml)',
          url: jsonUrl, error: null, meta: jsonResult.data
        };
      } catch (e) {
        attempts.push('law_data(json内XML): 解析失敗 ' + describeError(e));
      }
    }

    // 本文が構造化JSONで返る場合（法令API v2 の既定の形式）
    if (fullText && typeof fullText === 'object') {
      try {
        var tree = parseLawContent(fullText, 'json');
        logger.info('本文をJSON形式で取得しました（原本はJSONのまま保存します）', {
          law: lawIdOrNum
        });
        return {
          ok: true,
          // e-Govが返した本文をそのまま原本とする。
          // 整形（インデント付与）は原本の改変にあたるうえ、
          // 法令XMLのような深い入れ子では空白がファイル全体を肥大化させ、
          // Driveの上限を超える原因にもなるため、絶対に行わない。
          raw: jsonResult.body,
          tree: tree, format: 'json', extension: 'json',
          source: 'law_data(json)', url: jsonUrl, error: null, meta: jsonResult.data
        };
      } catch (e) {
        attempts.push('law_data(json): 構造変換に失敗 ' + describeError(e));
      }
    } else if (!fullText) {
      attempts.push('law_data(json): 本文フィールドが見つかりません');
    }
  } else {
    attempts.push('law_data(json): ' + (jsonResult.error || 'HTTP ' + jsonResult.status));
  }

  // --- 3. law_file エンドポイントを試す ---
  var fileUrl = buildEgovUrl(
    'LAW_FILE', { fileType: 'xml', lawIdOrNumOrRevisionId: lawIdOrNum }, {});
  var fileResult = apiGet_(fileUrl, logger, false);

  if (fileResult.ok && looksLikeLawXml_(fileResult.body)) {
    try {
      return {
        ok: true, raw: fileResult.body, tree: parseLawXml(fileResult.body),
        format: 'xml', extension: 'xml', source: 'law_file(xml)',
        url: fileUrl, error: null, meta: null
      };
    } catch (e) {
      attempts.push('law_file(xml): 解析失敗 ' + describeError(e));
    }
  } else {
    attempts.push('law_file(xml): ' + (fileResult.error || 'HTTP ' + fileResult.status));
  }

  return {
    ok: false, raw: null, tree: null, format: '', extension: '',
    source: 'none', url: xmlUrl, meta: null,
    error: '法令本文を取得できませんでした（' + attempts.join(' / ') + '）'
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

/**
 * 実際にAPIを呼び出して、設定が正しいかを確かめる。
 *
 * verifyApiSpec() は公式のOpenAPI仕様書と突き合わせるが、
 * 仕様書のURLが不明な場合は確認できない。
 * 本関数は仕様書に頼らず、**実際のAPIを数回だけ呼び出して**
 * 応答の中身から設定の正しさを判定する。
 *
 * 公的APIへの負荷を避けるため、呼び出しは3回までに抑えている。
 *
 * @param {string=} lawName 確認に使う法令名（既定: '所得税法'）
 * @return {{ok: boolean, steps: !Array<!Object>, lawId: string, contentFormat: string}}
 */
function probeApiSpec(lawName) {
  var logger = createLogger('probe_api');
  var target = lawName || '所得税法';
  var steps = [];
  var lawId = '';
  var contentFormat = '';

  console.log('========== API 実接続テスト ==========');
  console.log('確認に使う法令: ' + target);
  console.log('');

  // --- 1. 法令一覧APIで検索できるか ---
  var searchParams = {};
  searchParams[EGOV_API_SPEC.PARAMS.LAW_TITLE] = target;
  // 部分一致のため候補が多い。本命が埋もれないよう多めに取得する
  searchParams[EGOV_API_SPEC.PARAMS.LIMIT] = CONFIG.HTTP.SEARCH_PAGE_SIZE;
  var searchUrl = buildEgovUrl('LAWS', {}, searchParams);

  console.log('[1] 法令検索');
  console.log('    ' + searchUrl);
  var searchResult = apiGet_(searchUrl, logger, true);

  if (!searchResult.ok) {
    console.log('    結果: 失敗 — ' + (searchResult.error || 'HTTP ' + searchResult.status));
    console.log('');
    console.log('    → /laws のパスかパラメータ名が違う可能性があります。');
    steps.push({ step: 'search', ok: false, detail: searchResult.error });
    printProbeVerdict_(steps);
    return { ok: false, steps: steps, lawId: '', contentFormat: '' };
  }

  var candidates = pickLawList(searchResult.data);
  console.log('    結果: 成功（候補 ' + candidates.length + ' 件）');

  if (candidates.length === 0) {
    console.log('    → 通信はできましたが、法令一覧を取り出せませんでした。');
    console.log('      レスポンスの先頭: ' + searchResult.body.substring(0, 300));
    steps.push({ step: 'search', ok: false, detail: '一覧を取り出せない' });
    printProbeVerdict_(steps);
    return { ok: false, steps: steps, lawId: '', contentFormat: '' };
  }

  // law_title は部分一致で検索されるため、1件目が目的の法令とは限らない。
  // 実際の同期処理と同じく「法令名が完全一致するもの」を選ぶ。
  var normalizedTarget = normalizeLawName(target);
  var exact = null;
  candidates.forEach(function (item) {
    if (exact) {
      return;
    }
    var candidateInfo = readLawInfo(item);
    if (normalizeLawName(candidateInfo.law_title) === normalizedTarget) {
      exact = candidateInfo;
    }
  });

  if (!exact) {
    console.log('    ⚠ 「' + target + '」と完全一致する法令が見つかりませんでした。');
    console.log('      e-Govの検索は部分一致のため、名前に「' + target + '」を含む');
    console.log('      別の法令だけがヒットしています。候補の例:');
    candidates.slice(0, 3).forEach(function (item) {
      console.log('        - ' + readLawInfo(item).law_title);
    });
    steps.push({ step: 'search', ok: false, detail: '完全一致なし' });
    printProbeVerdict_(steps);
    return { ok: false, steps: steps, lawId: '', contentFormat: '' };
  }

  var info = exact;
  lawId = info.law_id;
  console.log('    （部分一致の候補から、名前が完全一致するものを選びました）');
  console.log('    法令名  : ' + (info.law_title || '(読み取れず)'));
  console.log('    法令番号: ' + (info.law_num || '(読み取れず)'));
  console.log('    法令ID  : ' + (info.law_id || '(読み取れず)'));
  console.log('    法令種別: ' + (info.law_type_raw || '(読み取れず)'));

  var fieldsOk = !!(info.law_id && info.law_title);
  if (!fieldsOk) {
    console.log('    → 項目名が想定と異なります。レスポンスの先頭を確認してください:');
    console.log('      ' + searchResult.body.substring(0, 400));
  }
  steps.push({ step: 'search', ok: fieldsOk, detail: info.law_title });
  console.log('');

  if (!lawId) {
    printProbeVerdict_(steps);
    return { ok: false, steps: steps, lawId: '', contentFormat: '' };
  }

  // --- 2. 本文をXML形式で取得できるか ---
  var xmlParams = {};
  xmlParams[EGOV_API_SPEC.PARAMS.LAW_FULL_TEXT_FORMAT] = EGOV_API_SPEC.FORMATS.XML;
  var xmlUrl = buildEgovUrl('LAW_DATA', { lawIdOrNumOrRevisionId: lawId }, xmlParams);

  console.log('[2] 本文取得（XML形式）');
  console.log('    ' + xmlUrl);
  var xmlResult = apiGet_(xmlUrl, logger, false);
  var xmlOk = xmlResult.ok && looksLikeLawXml_(xmlResult.body);
  console.log('    結果: ' + (xmlOk ? '成功（XMLで取得できます）'
    : '取得できず — ' + (xmlResult.error || 'HTTP ' + xmlResult.status)));
  if (xmlOk) {
    contentFormat = 'xml';
  }
  steps.push({ step: 'content_xml', ok: xmlOk, detail: xmlResult.status });
  console.log('');

  // --- 3. 本文をJSON形式で取得できるか（XMLが駄目だった場合のみ） ---
  if (!xmlOk) {
    var jsonParams = {};
    jsonParams[EGOV_API_SPEC.PARAMS.LAW_FULL_TEXT_FORMAT] = EGOV_API_SPEC.FORMATS.JSON;
    var jsonUrl = buildEgovUrl('LAW_DATA', { lawIdOrNumOrRevisionId: lawId }, jsonParams);

    console.log('[3] 本文取得（JSON形式）');
    console.log('    ' + jsonUrl);
    var jsonResult = apiGet_(jsonUrl, logger, true);

    var jsonOk = false;
    if (jsonResult.ok) {
      var fullText = pickField(
        jsonResult.data, EGOV_API_SPEC.FIELD_CANDIDATES.LAW_FULL_TEXT, null);
      if (fullText && typeof fullText === 'object') {
        try {
          var tree = parseLawContent(fullText, 'json');
          jsonOk = (tree.name === 'Law');
          contentFormat = 'json';
          console.log('    結果: 成功（JSONで取得できます。原本はJSONのまま保存します）');
        } catch (e) {
          console.log('    結果: 本文の構造を解釈できませんでした — ' + describeError(e));
        }
      } else if (typeof fullText === 'string') {
        jsonOk = looksLikeLawXml_(fullText);
        contentFormat = jsonOk ? 'xml' : '';
        console.log('    結果: ' + (jsonOk ? '成功（JSONの中にXMLが入っています）'
          : '本文が想定の形式ではありません'));
      } else {
        console.log('    結果: 本文の項目が見つかりません');
        console.log('      レスポンスの先頭: ' + jsonResult.body.substring(0, 400));
      }
    } else {
      console.log('    結果: 失敗 — ' + (jsonResult.error || 'HTTP ' + jsonResult.status));
    }
    steps.push({ step: 'content_json', ok: jsonOk, detail: contentFormat });
    console.log('');
  }

  printProbeVerdict_(steps);
  // XML取得の失敗は「JSONで取得できれば問題なし」であるため、
  // 全段階の成否ではなく「検索できたか」「本文を取得できたか」で判定する
  return {
    ok: isProbeSuccessful_(steps),
    steps: steps, lawId: lawId, contentFormat: contentFormat
  };
}

/**
 * 実接続テストが成功と言えるかを判定する。
 *
 * 本文はXMLとJSONのどちらか一方で取得できれば十分であり、
 * XML取得の失敗だけを理由に失敗とはしない。
 *
 * @param {!Array<!Object>} steps 各段階の結果
 * @return {boolean} 成功なら true
 * @private
 */
function isProbeSuccessful_(steps) {
  var searchOk = steps.some(function (s) { return s.step === 'search' && s.ok; });
  var contentOk = steps.some(function (s) {
    return (s.step === 'content_xml' || s.step === 'content_json') && s.ok;
  });
  return searchOk && contentOk;
}

/**
 * 実接続テストの判定を表示する。
 * @param {!Array<!Object>} steps 各段階の結果
 * @private
 */
function printProbeVerdict_(steps) {
  var searchOk = steps.some(function (s) { return s.step === 'search' && s.ok; });
  var contentOk = steps.some(function (s) {
    return (s.step === 'content_xml' || s.step === 'content_json') && s.ok;
  });

  console.log('========== 判定 ==========');
  if (isProbeSuccessful_(steps)) {
    console.log('✅ 問題ありません。setup() を実行してください。');
    console.log('   法令の検索・本文の取得ともに成功しました。');
    setProp(CONFIG.PROPERTY_KEYS.API_SPEC_VERIFIED_AT, nowIso());
  } else if (!searchOk) {
    console.log('❌ 法令を特定できませんでした。');
    console.log('   通信自体は成功している場合、法令名がe-Govの正式名称と');
    console.log('   異なっている可能性があります。');
    console.log('   通信から失敗している場合は、02_api_spec.gs の');
    console.log('   ENDPOINTS.LAWS と PARAMS.LAW_TITLE を確認してください。');
  } else {
    console.log('❌ 法令は検索できましたが、本文を取得できませんでした。');
    console.log('   02_api_spec.gs の ENDPOINTS.LAW_DATA と');
    console.log('   PARAMS.LAW_FULL_TEXT_FORMAT を確認してください。');
  }
  console.log('==========================');
}
