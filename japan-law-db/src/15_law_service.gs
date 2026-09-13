/**
 * @file 15_law_service.gs
 * 法令の同定（どの法令データを取得すべきかの特定）。
 *
 * データの信頼性に関する最重要ルール
 * ----------------------------------
 * 法令名が似ているだけの別法令を保存してはならない。
 * 候補が複数あり自動で確定できない場合、**推測で選ばず** WARN を記録して
 * その法令をスキップする。誤ったデータを保存するより、取得しない方が安全である。
 *
 * 利用者は、設定ファイルに lawId を直接書くことで確実に確定できる。
 */

/**
 * 法令同定の結果。
 * @typedef {{
 *   resolved: boolean,
 *   lawInfo: ?Object,
 *   reason: string,
 *   candidates: !Array<!Object>,
 *   ambiguous: boolean
 * }} ResolveResult
 */

/**
 * 設定エントリから、取得対象の法令を1件に確定する。
 *
 * @param {!Object} lawConfig 設定エントリ
 * @param {!Logger_} logger ロガー
 * @return {!ResolveResult} 同定結果
 */
function resolveLaw(lawConfig, logger) {
  // --- 1. 設定で法令IDが指定されていれば、それを最優先で使う ---
  if (lawConfig.lawId) {
    logger.info('設定の法令IDを使用します', {
      law_name: lawConfig.name, law_id: lawConfig.lawId
    });
    return {
      resolved: true,
      lawInfo: {
        law_id: lawConfig.lawId,
        law_num: lawConfig.lawNum || '',
        law_title: lawConfig.name,
        law_title_kana: '',
        law_type_raw: '',
        law_type: lawConfig.expectedLawType || 'other',
        revision_id: '', revision_date: '', promulgation_date: '',
        effective_date: '', repeal_date: '', repeal_status: ''
      },
      reason: '設定ファイルで法令IDが指定されています',
      candidates: [],
      ambiguous: false
    };
  }

  // --- 2. e-Govで検索する ---
  var search = searchLawsByName(lawConfig.name, logger);
  if (!search.ok) {
    return {
      resolved: false, lawInfo: null, candidates: [], ambiguous: false,
      reason: '検索APIの呼び出しに失敗しました: ' + search.error
    };
  }

  var candidates = search.candidates.map(readLawInfo).filter(function (info) {
    return info.law_id || info.law_num;
  });

  if (candidates.length === 0) {
    return {
      resolved: false, lawInfo: null, candidates: [], ambiguous: false,
      reason: '法令が見つかりませんでした（検索結果0件）'
    };
  }

  // --- 3. 法令名の完全一致で絞り込む ---
  var targetName = normalizeLawName(lawConfig.name);
  var aliases = (lawConfig.aliases || []).map(normalizeLawName);

  var exactMatches = candidates.filter(function (info) {
    var name = normalizeLawName(info.law_title);
    return name === targetName || aliases.indexOf(name) !== -1;
  });

  if (exactMatches.length === 0) {
    // 部分一致しかない場合は自動決定しない。誤った法令の保存を防ぐため。
    var samples = candidates.slice(0, 5).map(function (info) {
      return info.law_title + '（' + info.law_num + '）';
    });
    return {
      resolved: false, lawInfo: null, candidates: candidates, ambiguous: true,
      reason: '法令名が完全一致する候補がありません。' +
              '設定の name をe-Gov上の正式名称に修正するか、lawId を指定してください。' +
              '（候補: ' + samples.join(' / ') + '）'
    };
  }

  // --- 4. 法令番号の指定があれば、さらに絞り込む ---
  var narrowed = exactMatches;
  if (lawConfig.lawNum) {
    var wantedNum = normalizeLawName(lawConfig.lawNum);
    var byNum = narrowed.filter(function (info) {
      return normalizeLawName(info.law_num) === wantedNum;
    });
    if (byNum.length > 0) {
      narrowed = byNum;
    }
  }

  // --- 5. 期待する法令種別で絞り込む ---
  if (lawConfig.expectedLawType && narrowed.length > 1) {
    var byType = narrowed.filter(function (info) {
      var actualType = info.law_type !== 'other'
        ? info.law_type
        : inferLawTypeFromNum(info.law_num);
      return actualType === lawConfig.expectedLawType;
    });
    if (byType.length > 0) {
      narrowed = byType;
    }
  }

  if (narrowed.length === 1) {
    var resolved = narrowed[0];
    verifyLawTypeMatch_(lawConfig, resolved, logger);
    return {
      resolved: true, lawInfo: resolved, candidates: candidates, ambiguous: false,
      reason: '法令名の完全一致により確定しました'
    };
  }

  // --- 6. 複数候補が残った場合は自動決定しない ---
  var candidateText = narrowed.slice(0, 5).map(function (info) {
    return info.law_title + '（法令番号: ' + info.law_num + ' / 法令ID: ' + info.law_id + '）';
  });
  return {
    resolved: false, lawInfo: null, candidates: narrowed, ambiguous: true,
    reason: '候補が' + narrowed.length + '件あり、自動で確定できません。' +
            '設定ファイルの lawId に正しい法令IDを指定してください。' +
            '（候補: ' + candidateText.join(' / ') + '）'
  };
}

/**
 * 確定した法令の種別が、設定の期待値と一致するか確認する。
 * 一致しない場合はWARNを出すが、処理は継続する（法令名は完全一致しているため）。
 *
 * @param {!Object} lawConfig 設定エントリ
 * @param {!Object} lawInfo 確定した法令情報
 * @param {!Logger_} logger ロガー
 * @private
 */
function verifyLawTypeMatch_(lawConfig, lawInfo, logger) {
  if (!lawConfig.expectedLawType) {
    return;
  }
  var actualType = lawInfo.law_type !== 'other'
    ? lawInfo.law_type
    : inferLawTypeFromNum(lawInfo.law_num);

  if (actualType !== lawConfig.expectedLawType) {
    logger.warn('法令種別が設定の期待値と一致しません（要確認）', {
      law_name: lawConfig.name,
      expected: lawConfig.expectedLawType,
      actual: actualType,
      law_num: lawInfo.law_num,
      law_id: lawInfo.law_id
    });
  }
}

/**
 * 法令の保存に使う種別キーを決める。
 * e-Govが種別を返さない場合は法令番号から推定する。
 *
 * @param {!Object} lawInfo 法令情報
 * @param {!Object} lawConfig 設定エントリ
 * @return {string} CONFIG.LAW_TYPE_DEFS のキー
 */
function decideLawTypeKey(lawInfo, lawConfig) {
  if (lawInfo.law_type && lawInfo.law_type !== 'other') {
    return lawInfo.law_type;
  }
  var inferred = inferLawTypeFromNum(lawInfo.law_num);
  if (inferred !== 'other') {
    return inferred;
  }
  return lawConfig.expectedLawType || 'other';
}

/**
 * Markdownに書き出すメタデータを組み立てる。
 *
 * 「いつ取得したか（retrieved_at）」と
 * 「いつ時点で有効な法令か（effective_date / revision_date）」は
 * 意味が異なるため、必ず別項目として保持する。
 *
 * @param {!Object} lawConfig 設定エントリ
 * @param {!Object} lawInfo 法令情報
 * @param {string} lawTypeKey 法令種別キー
 * @param {string} status ステータス
 * @param {string} apiSourceUrl 取得に使ったAPIのURL
 * @return {!Object} メタデータ
 */
function buildLawMetadata(lawConfig, lawInfo, lawTypeKey, status, apiSourceUrl) {
  var category = CONFIG.CATEGORIES[lawConfig.category];
  var typeDef = CONFIG.LAW_TYPE_DEFS[lawTypeKey] || CONFIG.LAW_TYPE_DEFS.other;

  return {
    law_name: lawInfo.law_title || lawConfig.name,
    law_id: lawInfo.law_id,
    law_number: lawInfo.law_num,
    law_type: typeDef.label,
    law_type_key: lawTypeKey,
    category: category.label,
    category_key: lawConfig.category,
    source: 'e-Gov法令検索',
    source_url: lawInfo.law_id ? buildHumanLawUrl(lawInfo.law_id) : '',
    api_source_url: apiSourceUrl,
    retrieved_at: nowIso(),
    retrieved_at_jst: formatJst(new Date()),
    promulgation_date: lawInfo.promulgation_date || '',
    effective_date: lawInfo.effective_date || '',
    revision_id: lawInfo.revision_id || '',
    revision_date: lawInfo.revision_date || '',
    repeal_date: lawInfo.repeal_date || '',
    status: status,
    content_note: '本文はe-Govの正式XMLから機械的に変換したものであり、要約・改変はしていません。'
  };
}
