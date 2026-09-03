/**
 * @file 08_response_reader.gs
 * APIレスポンスから値を「寛容に」取り出すための層。
 *
 * なぜ必要か
 * ----------
 * レスポンス項目名を1つに決め打ちすると、e-Gov側の命名が想定と異なった瞬間に
 * 全件が失敗する。本層では EGOV_API_SPEC.FIELD_CANDIDATES の候補を順に探索し、
 * さらに見つからない場合はキー名を正規化して再探索する。
 * その結果、命名差異は「処理停止」ではなく「WARN付きで継続」に縮退する。
 */

/**
 * オブジェクトから、候補リストのいずれかに一致する値を取り出す。
 *
 * 探索の順序
 *   1. 候補のパス（'a.b' 形式にも対応）を順に直接参照
 *   2. 見つからなければ、キー名を正規化（小文字化・記号除去）して深さ優先で探索
 *
 * @param {*} obj 対象オブジェクト
 * @param {!Array<string>} candidates 候補となる項目名（優先順）
 * @param {*=} fallback 見つからなかった場合の戻り値
 * @return {*} 見つかった値、または fallback
 */
function pickField(obj, candidates, fallback) {
  if (!obj || typeof obj !== 'object') {
    return fallback;
  }

  // 1. 候補を直接参照する
  for (var i = 0; i < candidates.length; i++) {
    var value = getByPath(obj, candidates[i]);
    if (value !== undefined && value !== null && value !== '') {
      return value;
    }
  }

  // 2. キー名を正規化して深さ優先で探索する
  var normalizedTargets = candidates.map(function (c) {
    var parts = String(c).split('.');
    return normalizeKey_(parts[parts.length - 1]);
  });
  var found = searchByNormalizedKey_(obj, normalizedTargets, 0);
  return found === undefined ? fallback : found;
}

/**
 * 法令一覧レスポンスから法令の配列を取り出す。
 * レスポンスが配列そのものである場合にも対応する。
 *
 * @param {*} parsed パース済みレスポンス
 * @return {!Array<!Object>} 法令の配列（見つからなければ空配列）
 */
function pickLawList(parsed) {
  if (Array.isArray(parsed)) {
    return parsed;
  }
  var list = pickField(parsed, EGOV_API_SPEC.FIELD_CANDIDATES.LAW_LIST, null);
  if (Array.isArray(list)) {
    return list;
  }
  // レスポンス直下に配列が1つだけある場合はそれを採用する
  if (parsed && typeof parsed === 'object') {
    var arrays = Object.keys(parsed).filter(function (key) {
      return Array.isArray(parsed[key]);
    });
    if (arrays.length === 1) {
      return parsed[arrays[0]];
    }
  }
  return [];
}

/**
 * 法令1件分のレスポンス（または一覧の1要素）から、正規化した書誌情報を作る。
 *
 * @param {*} item レスポンスの1要素
 * @return {{law_id: string, law_num: string, law_title: string, law_title_kana: string,
 *           law_type_raw: string, law_type: string, revision_id: string,
 *           revision_date: string, promulgation_date: string, effective_date: string,
 *           repeal_date: string, repeal_status: string}}
 */
function readLawInfo(item) {
  var F = EGOV_API_SPEC.FIELD_CANDIDATES;
  var lawTypeRaw = String(pickField(item, F.LAW_TYPE, '') || '');

  return {
    law_id: String(pickField(item, F.LAW_ID, '') || ''),
    law_num: String(pickField(item, F.LAW_NUM, '') || ''),
    law_title: String(pickField(item, F.LAW_TITLE, '') || ''),
    law_title_kana: String(pickField(item, F.LAW_TITLE_KANA, '') || ''),
    law_type_raw: lawTypeRaw,
    law_type: normalizeLawType(lawTypeRaw),
    revision_id: String(pickField(item, F.REVISION_ID, '') || ''),
    revision_date: String(pickField(item, F.REVISION_DATE, '') || ''),
    promulgation_date: String(pickField(item, F.PROMULGATION_DATE, '') || ''),
    effective_date: String(pickField(item, F.EFFECTIVE_DATE, '') || ''),
    repeal_date: String(pickField(item, F.REPEAL_DATE, '') || ''),
    repeal_status: String(pickField(item, F.REPEAL_STATUS, '') || '')
  };
}

/**
 * e-Gov の法令種別表記を内部キーへ正規化する。
 * 英語enum・日本語表記の双方に対応する。
 *
 * @param {string} raw e-Gov側の法令種別
 * @return {string} CONFIG.LAW_TYPE_DEFS のキー。判定できなければ 'other'
 */
function normalizeLawType(raw) {
  if (!raw) {
    return 'other';
  }
  var text = String(raw).trim();
  var lower = text.toLowerCase().replace(/[\s_-]/g, '');

  var MAP = {
    'act': 'act',
    'constitution': 'constitution',
    'cabinetorder': 'cabinet_order',
    'imperialorder': 'imperial_order',
    'ministerialordinance': 'ministerial_ordinance',
    'rule': 'rule',
    'misc': 'other'
  };
  if (MAP[lower]) {
    return MAP[lower];
  }

  // 日本語表記
  if (text.indexOf('憲法') !== -1) { return 'constitution'; }
  if (text.indexOf('法律') !== -1) { return 'act'; }
  if (text.indexOf('政令') !== -1) { return 'cabinet_order'; }
  if (text.indexOf('勅令') !== -1) { return 'imperial_order'; }
  if (text.indexOf('省令') !== -1 || text.indexOf('府令') !== -1) {
    return 'ministerial_ordinance';
  }
  if (text.indexOf('規則') !== -1) { return 'rule'; }

  return 'other';
}

/**
 * 法令番号の文字列から法令種別を推定する。
 * law_type が返らなかった場合の補助手段。
 *
 * @param {string} lawNum 法令番号（例: '昭和四十年法律第三十三号'）
 * @return {string} 推定した法令種別キー
 */
function inferLawTypeFromNum(lawNum) {
  if (!lawNum) {
    return 'other';
  }
  return normalizeLawType(lawNum);
}

/**
 * 廃止・失効の状態を判定する。
 *
 * 重要: 判定はe-Govが返すフィールドに基づいて行い、推測しない。
 * 判断材料が無い場合は 'unknown' とし、'active' と断定しない。
 *
 * @param {!Object} lawInfo readLawInfo() の戻り値
 * @return {string} CONFIG.STATUS のいずれか
 */
function determineLawStatus(lawInfo) {
  var statusText = String(lawInfo.repeal_status || '').toLowerCase();

  if (statusText) {
    if (statusText.indexOf('repeal') !== -1 || statusText.indexOf('廃止') !== -1) {
      return CONFIG.STATUS.REPEALED;
    }
    if (statusText.indexOf('expire') !== -1 || statusText.indexOf('失効') !== -1) {
      return CONFIG.STATUS.EXPIRED;
    }
    if (statusText.indexOf('none') !== -1 || statusText.indexOf('has_not') !== -1) {
      return CONFIG.STATUS.ACTIVE;
    }
  }

  // 廃止日が設定され、かつ現在日を過ぎていれば廃止扱い
  if (lawInfo.repeal_date) {
    var repealDate = toDate(lawInfo.repeal_date);
    if (repealDate && repealDate.getTime() <= Date.now()) {
      return CONFIG.STATUS.REPEALED;
    }
  }

  // 廃止に関する情報が一切ない場合は、有効とみなす
  if (!lawInfo.repeal_status && !lawInfo.repeal_date) {
    return CONFIG.STATUS.ACTIVE;
  }

  return CONFIG.STATUS.UNKNOWN;
}

/**
 * キー名を比較用に正規化する。
 * @param {string} key キー名
 * @return {string} 正規化後のキー名
 * @private
 */
function normalizeKey_(key) {
  return String(key).toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * 正規化したキー名で、オブジェクトを深さ優先探索する。
 *
 * @param {*} obj 対象
 * @param {!Array<string>} normalizedTargets 正規化済みの探索対象キー
 * @param {number} depth 現在の深さ
 * @return {*} 見つかった値。なければ undefined
 * @private
 */
function searchByNormalizedKey_(obj, normalizedTargets, depth) {
  var MAX_DEPTH = 6;
  if (!obj || typeof obj !== 'object' || depth > MAX_DEPTH) {
    return undefined;
  }

  var keys = Object.keys(obj);

  // まず同じ階層で一致を探す（優先順を維持するため候補順にループする）
  for (var t = 0; t < normalizedTargets.length; t++) {
    for (var k = 0; k < keys.length; k++) {
      if (normalizeKey_(keys[k]) === normalizedTargets[t]) {
        var value = obj[keys[k]];
        if (value !== undefined && value !== null && value !== '') {
          return value;
        }
      }
    }
  }

  // 見つからなければ子オブジェクトを探索する
  for (var i = 0; i < keys.length; i++) {
    var child = obj[keys[i]];
    if (child && typeof child === 'object' && !Array.isArray(child)) {
      var found = searchByNormalizedKey_(child, normalizedTargets, depth + 1);
      if (found !== undefined) {
        return found;
      }
    }
  }

  return undefined;
}
