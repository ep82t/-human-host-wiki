// ============================================================
// FlyerSpreadsheet.gs — チラシ別スプレッドシート管理
// チラシ種別ごとに独立したスプレッドシートを作成・管理する
// ============================================================

var FLYER_SS_MAP_KEY = 'FLYER_SS_MAP';

// ------------------------------------------------------------
// SS ID マップ管理
// ------------------------------------------------------------

/**
 * チラシ名→SS ID のマップを取得する
 * @returns {Object} {flyerName: ssId, ...}
 */
function _getFlyerSsMap() {
  var val = PropertiesService.getScriptProperties().getProperty(FLYER_SS_MAP_KEY);
  if (!val) return {};
  try { return JSON.parse(val); } catch(e) { return {}; }
}

/**
 * チラシSS IDマップを保存する
 * @param {Object} map
 */
function _saveFlyerSsMap(map) {
  PropertiesService.getScriptProperties().setProperty(FLYER_SS_MAP_KEY, JSON.stringify(map));
}

/**
 * チラシ名の数字を正規化する（半角↔全角を統一）
 * 例: "DIYタイムズ19チラシ" ↔ "DIYタイムズ１９チラシ" を同一視
 * @param {string} name
 * @returns {string} 全角数字に統一した名前
 */
function _normalizeFlyerNameDigits(name) {
  if (!name) return name;
  // 半角数字→全角数字
  return String(name).replace(/[0-9]/g, function(c) {
    return String.fromCharCode(c.charCodeAt(0) + 0xFEE0);
  });
}

/**
 * FLYER_SS_MAPから指定チラシの登録を削除する（SSファイル自体は削除しない）
 * GASエディタから実行: unregisterFlyerByName('チラシ名')
 * @param {string} flyerName 削除するチラシ名
 */
function unregisterFlyerByName(flyerName) {
  var map = _getFlyerSsMap();
  if (!map[flyerName]) {
    Logger.log('未登録: ' + flyerName);
    Logger.log('登録済み一覧: ' + Object.keys(map).join(', '));
    return;
  }
  var ssId = map[flyerName];
  delete map[flyerName];
  _saveFlyerSsMap(map);
  Logger.log('✅ 登録削除完了: ' + flyerName + ' (SS ID: ' + ssId + ')');
  Logger.log('※ SSファイル自体はGoogle Driveに残っています（必要なら手動削除）');
  Logger.log('残りチラシ: ' + Object.keys(map).join(', '));
}

// ============================================================
// 風力発電(旧)+(新) 統合ツール
// ============================================================

/**
 * 【確認・ドライラン】風力発電(旧)を(新)に統合した場合の結果を表示する（変更なし）
 * GASエディタから実行: checkMergeFuryoku()
 * ファイル: FlyerSpreadsheet.gs
 */
function checkMergeFuryoku() { _mergeFuryoku(true); }

/**
 * 【実行】風力発電(旧)を(新)に統合し、(新)を「風力発電」に改名、(旧)を削除する
 * ・重複エリアの配布枚数は合算
 * ・(旧)の配布記録は「風力発電」に引き継ぐ
 * ・(旧)はドロップダウンから削除（SSファイルはDriveに残す）
 * GASエディタから実行: mergeFuryoku()
 * ファイル: FlyerSpreadsheet.gs
 */
function mergeFuryoku() { _mergeFuryoku(false); }

/**
 * 風力発電(旧)→(新) 統合の本体
 * @param {boolean} dryRun true=変更せずログのみ
 */
function _mergeFuryoku(dryRun) {
  var TARGET_NAME = '風力発電';
  Logger.log('========== 風力発電 統合 ' + (dryRun ? '【ドライラン・変更なし】' : '【実行】') + ' ==========');

  var map = _getFlyerSsMap();
  var keys = Object.keys(map);

  // 旧・新のキーを実データから検出（括弧の半角/全角ゆれに対応）
  var oldKey = keys.filter(function(k) { return k.indexOf('風力発電') !== -1 && k.indexOf('旧') !== -1; })[0];
  var newKey = keys.filter(function(k) { return k.indexOf('風力発電') !== -1 && k.indexOf('新') !== -1; })[0];

  if (!oldKey) { Logger.log('❌ 旧チラシが見つかりません。登録一覧: ' + keys.join(', ')); return; }
  if (!newKey) { Logger.log('❌ 新チラシが見つかりません。登録一覧: ' + keys.join(', ')); return; }
  Logger.log('旧チラシ: [' + oldKey + ']');
  Logger.log('新チラシ: [' + newKey + ']  → 統合後「' + TARGET_NAME + '」に改名');

  var oldArea = _getFlyerSheet(oldKey, 'エリア');
  var newArea = _getFlyerSheet(newKey, 'エリア');
  if (!oldArea || !newArea) { Logger.log('❌ エリアシートが取得できません'); return; }

  // ── 旧のエリアデータを収集（配布実績があるものだけ）──
  var oldLast = oldArea.getLastRow();
  var oldData = oldLast >= 2 ? oldArea.getRange(2, 1, oldLast - 1, 10).getValues() : [];
  var oldMap = {}; // city|town|chome → {dist, status, member, date}
  var oldActiveCount = 0;
  oldData.forEach(function(r) {
    var city = String(r[COL_AREA.CITY - 1] || '').trim();
    var town = String(r[COL_AREA.TOWN - 1] || '').trim();
    if (!city || !town) return;
    var chome = String(r[COL_AREA.CHOME - 1] || '').trim();
    var dist  = parseInt(r[COL_AREA.DIST_COUNT - 1], 10) || 0;
    var status= String(r[COL_AREA.STATUS - 1] || '').trim();
    var distributed = dist > 0 || (status && status !== STATUS.NOT_STARTED && status !== '未着手');
    if (!distributed) return; // 配布実績なしは統合不要
    oldMap[city + '|' + town + '|' + chome] = {
      dist:   dist,
      status: status,
      member: String(r[COL_AREA.MEMBER_NAME - 1] || '').trim(),
      date:   r[COL_AREA.DIST_DATE - 1]
    };
    oldActiveCount++;
  });
  Logger.log('旧の配布実績エリア数: ' + oldActiveCount);

  // ── 新のエリアに合算 ──
  var newLast = newArea.getLastRow();
  var newData = newLast >= 2 ? newArea.getRange(2, 1, newLast - 1, 10).getValues() : [];
  var newIndex = {}; // city|town|chome → rowNum
  newData.forEach(function(r, i) {
    var city = String(r[COL_AREA.CITY - 1] || '').trim();
    var town = String(r[COL_AREA.TOWN - 1] || '').trim();
    if (!city || !town) return;
    var chome = String(r[COL_AREA.CHOME - 1] || '').trim();
    newIndex[city + '|' + town + '|' + chome] = i + 2;
  });

  var summed = 0, added = 0;
  Object.keys(oldMap).forEach(function(key) {
    var o = oldMap[key];
    var parts = key.split('|');
    var rowNum = newIndex[key];

    if (rowNum) {
      // 既存行に合算
      var curDist = parseInt(newArea.getRange(rowNum, COL_AREA.DIST_COUNT).getValue() || 0, 10) || 0;
      var curStat = String(newArea.getRange(rowNum, COL_AREA.STATUS).getValue() || '').trim();
      var newDist = curDist + o.dist;
      Logger.log('  合算 [' + key + '] 新' + curDist + ' + 旧' + o.dist + ' = ' + newDist);
      summed++;
      if (!dryRun) {
        newArea.getRange(rowNum, COL_AREA.DIST_COUNT).setValue(newDist);
        // 新が未着手なら旧の配布済み情報を反映
        if (!curStat || curStat === STATUS.NOT_STARTED || curStat === '未着手') {
          newArea.getRange(rowNum, COL_AREA.STATUS).setValue(o.status || STATUS.DONE);
          if (o.member) newArea.getRange(rowNum, COL_AREA.MEMBER_NAME).setValue(o.member);
          if (o.date)   newArea.getRange(rowNum, COL_AREA.DIST_DATE).setValue(o.date);
        }
      }
    } else {
      // 新に存在しないエリア → 行追加
      Logger.log('  追加 [' + key + '] 旧' + o.dist + '（新に無いエリア）');
      added++;
      if (!dryRun) {
        var insertRow = newArea.getLastRow() + 1;
        newArea.getRange(insertRow, 1, 1, 10).setValues([[
          parts[0], parts[1], parts[2], 0,
          o.status || STATUS.DONE, TARGET_NAME, o.dist, o.member || '',
          o.date || '', ''
        ]]);
      }
    }
  });
  Logger.log('合算: ' + summed + '件 / 新規追加: ' + added + '件');

  // ── 旧の配布記録を新へ引き継ぎ ──
  var oldLog = _getFlyerSheet(oldKey, '配布記録');
  var newLog = _getFlyerSheet(newKey, '配布記録');
  var logCount = 0;
  if (oldLog && newLog) {
    var ll = oldLog.getLastRow();
    if (ll >= 2) {
      var logData = oldLog.getRange(2, 1, ll - 1, 8).getValues()
        .filter(function(r) { return r[0]; });
      logCount = logData.length;
      Logger.log('旧の配布記録: ' + logCount + '件 → 新へ引き継ぎ');
      if (!dryRun && logData.length > 0) {
        var nr = newLog.getLastRow() + 1;
        newLog.getRange(nr, 1, logData.length, 8).setValues(logData);
        newLog.getRange(nr, 1, logData.length, 1).setNumberFormat('yyyy/MM/dd HH:mm');
      }
    }
  }

  if (dryRun) {
    Logger.log('--- ドライラン完了。問題なければ mergeFuryoku() を実行してください ---');
    return;
  }

  // ── (新) を「風力発電」に改名 ──
  _renameFlyerSsEntry(newKey, TARGET_NAME);

  // ── FLYER_TYPES 更新（旧・新を除き、風力発電を追加）──
  var props = PropertiesService.getScriptProperties();
  var types = (props.getProperty('FLYER_TYPES') || '')
    .split(',').map(function(s) { return s.trim(); }).filter(function(s) { return s; });
  types = types.filter(function(t) { return t !== oldKey && t !== newKey; });
  if (types.indexOf(TARGET_NAME) === -1) types.push(TARGET_NAME);
  props.setProperty('FLYER_TYPES', types.join(','));
  Logger.log('FLYER_TYPES: ' + types.join(', '));

  // ── 旧をマップから削除（SSファイルはDriveに残す）──
  var map2 = _getFlyerSsMap();
  var oldSsId = map2[oldKey];
  delete map2[oldKey];
  _saveFlyerSsMap(map2);
  Logger.log('✅ 旧チラシをドロップダウンから削除（SS ID ' + oldSsId + ' はDriveに残存）');

  Logger.log('========== 統合完了 ==========');
  Logger.log('統合後の登録チラシ: ' + Object.keys(map2).join(', '));
  Logger.log('※ マップ反映には clasp push 不要だが、ドロップダウン更新のためページをリロードしてください');
}

/**
 * 設定から作成したチラシ（600系）をFLYER_SS_MAPから削除し、正式名で再作成する
 * GASエディタから実行: fixFlyer600Registration()
 */
function fixFlyer600Registration() {
  var map = _getFlyerSsMap();

  // 「600」を含む既存エントリを全て探す
  var toDelete = Object.keys(map).filter(function(key) {
    return key.indexOf('600') !== -1;
  });

  if (toDelete.length === 0) {
    Logger.log('600を含むチラシは登録されていません');
  } else {
    toDelete.forEach(function(name) {
      Logger.log('削除: [' + name + '] SS ID: ' + map[name]);
      delete map[name];
    });
    _saveFlyerSsMap(map);
    Logger.log('✅ 削除完了: ' + toDelete.join(', '));
  }

  // 正式名「600プロジェクト」で新規作成
  var result = createFlyerSpreadsheet('600プロジェクト');
  if (result.success) {
    Logger.log('✅ 600プロジェクト SS作成完了');
    Logger.log('URL: ' + result.url);
  } else if (result.reason === 'exists') {
    Logger.log('ℹ️ 600プロジェクトは既に存在します');
  } else {
    Logger.log('❌ 作成失敗: ' + (result.reason || '不明'));
  }
}

/**
 * プロジェクト600 SSを完全リセットしてマスター配布記録から再同期する
 * GASエディタから実行: rebuildProject600FromMaster()
 */
function rebuildProject600FromMaster() {
  var flyerName = 'プロジェクト600';

  // ① チラシSS 配布記録を全クリア
  var logSheet = _getFlyerSheet(flyerName, '配布記録');
  if (logSheet && logSheet.getLastRow() >= 2) {
    logSheet.getRange(2, 1, logSheet.getLastRow() - 1, logSheet.getLastColumn()).clearContent();
    Logger.log('✅ 配布記録クリア完了');
  }

  // ② チラシSS エリアシートを全リセット
  var areaSheet = _getFlyerSheet(flyerName, 'エリア');
  if (areaSheet && areaSheet.getLastRow() >= 2) {
    var rows = areaSheet.getLastRow() - 1;
    var areaData = areaSheet.getRange(2, 1, rows, 9).getValues();
    areaData.forEach(function(row, i) {
      if (!row[0]) return;
      areaSheet.getRange(i + 2, 5).setValue(STATUS.NOT_STARTED);
      areaSheet.getRange(i + 2, 6).setValue('');
      areaSheet.getRange(i + 2, 7).setValue(0);
      areaSheet.getRange(i + 2, 8).setValue('');
      areaSheet.getRange(i + 2, 9).setValue('');
    });
    Logger.log('✅ エリアシートリセット完了');
  }

  // ③ マスター配布記録から「プロジェクト600」「600プロジェクト」両方をコピー
  var masterSs = getSpreadsheet();
  var masterSheet = masterSs.getSheetByName(SHEET_NAMES.DIST_LOG);
  if (!masterSheet || masterSheet.getLastRow() < 2) {
    Logger.log('❌ マスター配布記録なし'); return;
  }
  var masterData = masterSheet.getRange(2, 1, masterSheet.getLastRow() - 1, 8).getValues();

  // "600" と "プロジェクト" を両方含む行を対象に
  var matched = masterData.filter(function(row) {
    var ft = String(row[3] || '');
    return ft.indexOf('600') !== -1 && ft.indexOf('プロジェクト') !== -1;
  });
  Logger.log('マスターから対象: ' + matched.length + '件');

  // 重複除去（同一datetime|city|address）
  var seen = {};
  var deduped = matched.filter(function(row) {
    var dt  = row[0] instanceof Date ? row[0].getTime() : String(row[0]);
    var key = dt + '|' + String(row[1]) + '|' + String(row[2]);
    if (seen[key]) return false;
    seen[key] = true;
    return true;
  });
  Logger.log('重複除去後: ' + deduped.length + '件');

  // チラシSS配布記録にコピー
  if (deduped.length > 0 && logSheet) {
    var writeRows = deduped.map(function(row) {
      return [row[0], row[1], row[2], flyerName, row[4], row[5], row[6], row[7]];
    });
    logSheet.getRange(2, 1, writeRows.length, 8).setValues(writeRows);
    for (var i = 0; i < writeRows.length; i++) {
      logSheet.getRange(i + 2, 1).setNumberFormat('yyyy/MM/dd HH:mm');
    }
    Logger.log('✅ 配布記録コピー完了: ' + deduped.length + '件');
  }

  // ④ エリアシートを配布記録から再計算
  Logger.log('エリアシート再計算中...');
  recalcFlyerAreaFromLog(flyerName);

  Logger.log('====================');
  Logger.log('✅ プロジェクト600 再構築完了');
}

/**
 * 600プロジェクトのチラシSSを新規作成する
 * GASエディタから実行: createFlyer600Project()
 */
function createFlyer600Project() {
  var flyerName = '600プロジェクト';
  var result = createFlyerSpreadsheet(flyerName);
  if (result.success) {
    Logger.log('✅ チラシSS作成完了: ' + flyerName);
    Logger.log('URL: ' + result.url);
  } else if (result.reason === 'exists') {
    Logger.log('ℹ️ 既に存在します: ' + flyerName + ' (SS ID: ' + result.ssId + ')');
  } else {
    Logger.log('❌ 作成失敗: ' + (result.reason || '不明'));
  }
}

/**
 * チラシSSに配布記録シートが欠けている場合に追加してマスターから同期する
 * GASエディタから実行: addDistLogSheetAndSync()
 */
function addDistLogSheetAndSync() {
  var map = _getFlyerSsMap();
  var flyerName = null;
  Object.keys(map).forEach(function(key) {
    if (key.toUpperCase().indexOf('DIY') !== -1) flyerName = key;
  });
  if (!flyerName) { Logger.log('❌ DIYチラシ未登録'); return; }

  var ssId = map[flyerName];
  var ss;
  try {
    ss = SpreadsheetApp.openById(ssId);
  } catch(e) {
    Logger.log('❌ SS開放失敗: ' + e.message); return;
  }

  // 配布記録シートが既にあればスキップ
  var existing = ss.getSheetByName('配布記録');
  if (existing) {
    Logger.log('配布記録シートは既に存在します（行数: ' + existing.getLastRow() + '）');
  } else {
    // 配布記録シートを追加
    var distLogSheet = ss.insertSheet('配布記録');
    var headers = ['日時', '市町村', '住所', 'チラシ種別', '配布枚数', '実施者名', '配布種別', '入力ソース'];
    distLogSheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    _applyFlyerSheetHeaderFormat(distLogSheet, headers.length);
    Logger.log('✅ 配布記録シートを追加しました');
  }

  // マスター配布記録から同期
  Logger.log('マスター配布記録から同期開始...');
  syncFlyerSsFromMasterDistLog(flyerName);
}

/**
 * DIYチラシSSの状態を詳細診断する
 * GASエディタから実行: diagnoseDIYFlyer()
 */
function diagnoseDIYFlyer() {
  var map = _getFlyerSsMap();
  // DIYを含むチラシ名を検索
  var flyerName = null;
  Object.keys(map).forEach(function(key) {
    if (key.toUpperCase().indexOf('DIY') !== -1) flyerName = key;
  });

  if (!flyerName) {
    Logger.log('❌ DIYチラシがFLYER_SS_MAPに未登録');
    return;
  }
  Logger.log('✅ チラシ名: [' + flyerName + ']');

  var ssId = map[flyerName];
  Logger.log('✅ SS ID: ' + ssId);

  // SSを開けるか確認
  try {
    var ss = SpreadsheetApp.openById(ssId);
    Logger.log('✅ SS開放OK: ' + ss.getName());
    // シート一覧
    var sheets = ss.getSheets().map(function(s) { return s.getName(); });
    Logger.log('シート一覧: ' + sheets.join(', '));
    // 配布記録シートの確認
    var logSheet = ss.getSheetByName('配布記録');
    if (logSheet) {
      Logger.log('✅ 配布記録シートあり（行数: ' + logSheet.getLastRow() + '）');
    } else {
      Logger.log('❌ 配布記録シートが存在しない → シート名を確認してください');
    }
  } catch(e) {
    Logger.log('❌ SSを開けません: ' + e.message);
    Logger.log('→ SSが削除されたか、別アカウントで作成された可能性があります');
  }
}

/**
 * FLYER_SS_MAPに登録されているチラシ名の一覧をログに表示する
 * GASエディタから実行: listFlyerNames()
 */
function listFlyerNames() {
  var map = _getFlyerSsMap();
  var keys = Object.keys(map);
  Logger.log('登録済みチラシ数: ' + keys.length + '件');
  keys.forEach(function(name, i) {
    // 文字コードも表示して半角・全角の違いを可視化
    var codes = '';
    for (var j = 0; j < name.length; j++) {
      codes += name.charCodeAt(j).toString(16) + ' ';
    }
    Logger.log((i + 1) + '. [' + name + '] (hex: ' + codes.trim() + ')');
  });
}

/**
 * 指定チラシのSS IDを取得する（半角・全角数字を同一視）
 * @param {string} flyerName
 * @returns {string|null}
 */
function _getFlyerSsId(flyerName) {
  var map = _getFlyerSsMap();
  // 完全一致
  if (map[flyerName]) return map[flyerName];
  // 正規化して再検索（半角→全角）
  var normalized = _normalizeFlyerNameDigits(flyerName);
  if (map[normalized]) return map[normalized];
  // マップのキー側も正規化して照合
  var keys = Object.keys(map);
  for (var i = 0; i < keys.length; i++) {
    if (_normalizeFlyerNameDigits(keys[i]) === normalized) return map[keys[i]];
  }
  return null;
}

/**
 * 指定チラシがFLYER_SS_MAPに存在するか確認する（半角・全角同一視）
 * @param {string} flyerName
 * @returns {boolean}
 */
function flyerSsExists(flyerName) {
  return _getFlyerSsId(flyerName) !== null;
}

/**
 * 指定チラシのSS IDを登録する
 * @param {string} flyerName
 * @param {string} ssId
 */
function _setFlyerSsId(flyerName, ssId) {
  var map = _getFlyerSsMap();
  map[flyerName] = ssId;
  _saveFlyerSsMap(map);
}

/**
 * チラシ名のリネーム（マップのキー更新 + SSファイル名更新）
 * @param {string} oldName
 * @param {string} newName
 */
function _renameFlyerSsEntry(oldName, newName) {
  if (!oldName || !newName || oldName === newName) return;
  var map = _getFlyerSsMap();
  var ssId = map[oldName];
  if (!ssId) {
    Logger.log('_renameFlyerSsEntry: SS IDなし for ' + oldName);
    return;
  }
  // マップキーを変更
  map[newName] = ssId;
  delete map[oldName];
  _saveFlyerSsMap(map);

  // SSファイル名を変更
  try {
    var ss = SpreadsheetApp.openById(ssId);
    ss.rename('D8-Posting: ' + newName);
    Logger.log('チラシSS名変更: ' + oldName + ' → ' + newName);
  } catch(e) {
    Logger.log('チラシSSリネーム失敗: ' + e.message);
  }
}

/**
 * チラシ名に対応するスプレッドシートを開いて返す
 * @param {string} flyerName
 * @returns {Spreadsheet|null}
 */
function _getFlyerSpreadsheet(flyerName) {
  var ssId = _getFlyerSsId(flyerName);
  if (!ssId) return null;
  try {
    return SpreadsheetApp.openById(ssId);
  } catch(e) {
    Logger.log('_getFlyerSpreadsheet エラー: ' + e.message);
    return null;
  }
}

/**
 * チラシSS内の指定シートを返す
 * @param {string} flyerName
 * @param {string} sheetName
 * @returns {Sheet|null}
 */
function _getFlyerSheet(flyerName, sheetName) {
  var ss = _getFlyerSpreadsheet(flyerName);
  if (!ss) return null;
  return ss.getSheetByName(sheetName) || null;
}

// ------------------------------------------------------------
// ヘッダー書式適用
// ------------------------------------------------------------

function _applyFlyerSheetHeaderFormat(sheet, colCount) {
  var hRange = sheet.getRange(1, 1, 1, colCount);
  hRange.setBackground('#1a237e').setFontColor('#ffffff').setFontWeight('bold');
  sheet.setFrozenRows(1);
}

// ------------------------------------------------------------
// チラシSSの作成
// ------------------------------------------------------------

/**
 * チラシ専用スプレッドシートを作成する
 * @param {string} flyerName
 * @returns {Object} {success, ssId, url} or {success:false, reason}
 */
function createFlyerSpreadsheet(flyerName) {
  if (!flyerName) return { success: false, reason: 'flyerName が空です' };

  // 既存チェック
  var existingId = _getFlyerSsId(flyerName);
  if (existingId) {
    try {
      SpreadsheetApp.openById(existingId);
      return { success: false, reason: 'exists', ssId: existingId };
    } catch(e) {
      // SSが削除されていた場合は再作成する
      Logger.log('既存SSが無効（削除済み？）: ' + existingId + ' / ' + e.message);
    }
  }

  Logger.log('チラシSS作成開始: ' + flyerName);

  var ss = SpreadsheetApp.create('D8-Posting: ' + flyerName);

  // デフォルトシート名を「エリア」に変更（既存の Sheet1 を利用）
  var defaultSheet = ss.getSheets()[0];
  defaultSheet.setName('エリア');

  // ---- エリアシート ----
  var areaSheet = defaultSheet;
  var areaHeaders = ['市町村名', '町名', '丁目', '世帯数',
    'ステータス', 'チラシ種別', '配布枚数', '実施者名', '実施日', 'メモ', '緯度', '経度'];
  areaSheet.getRange(1, 1, 1, areaHeaders.length).setValues([areaHeaders]);
  _applyFlyerSheetHeaderFormat(areaSheet, areaHeaders.length);

  // エリアマスタからデータコピー（ステータスリセット）
  try {
    var masterSs = getSpreadsheet();
    var masterAreaSheet = masterSs.getSheetByName(SHEET_NAMES.AREA_MASTER);
    if (masterAreaSheet && masterAreaSheet.getLastRow() >= 2) {
      var masterData = masterAreaSheet.getRange(
        2, 1, masterAreaSheet.getLastRow() - 1, 12
      ).getValues();
      var areaRows = masterData.filter(function(r) { return r[0]; }).map(function(r) {
        return [
          r[0],           // 市町村名
          r[1],           // 町名
          r[2],           // 丁目
          r[3],           // 世帯数
          STATUS.NOT_STARTED, // ステータス = 未着手
          flyerName,      // チラシ種別
          0,              // 配布枚数
          '',             // 実施者名
          '',             // 実施日
          '',             // メモ
          r[10] || '',    // 緯度（マスタから引き継ぐ）
          r[11] || ''     // 経度（マスタから引き継ぐ）
        ];
      });
      if (areaRows.length > 0) {
        areaSheet.getRange(2, 1, areaRows.length, 12).setValues(areaRows);
      }
    }
  } catch(e) {
    Logger.log('エリアデータコピー失敗: ' + e.message);
  }

  // ---- マンションシート ----
  var mansionSheet = ss.insertSheet('マンション');
  var mansionHeaders = ['マンション名', '住所', '市町村', '配布ステータス',
    'ステータス種別', '最終訪問日', '最終配布枚数', 'メモ', '緯度', '経度'];
  mansionSheet.getRange(1, 1, 1, mansionHeaders.length).setValues([mansionHeaders]);
  _applyFlyerSheetHeaderFormat(mansionSheet, mansionHeaders.length);

  // マンション台帳からデータコピー（建物情報のみ、訪問記録はリセット）
  try {
    var masterSs2 = getSpreadsheet();
    var masterMansionSheet = masterSs2.getSheetByName(SHEET_NAMES.MANSION);
    if (masterMansionSheet && masterMansionSheet.getLastRow() >= 2) {
      var mansionData = masterMansionSheet.getRange(
        2, 1, masterMansionSheet.getLastRow() - 1, 10
      ).getValues();
      var mansionRows = mansionData.filter(function(r) { return r[0]; }).map(function(r) {
        var originalStatus = String(r[COL_MANSION.STATUS - 1] || '');
        var statusType     = String(r[COL_MANSION.STATUS_TYPE - 1] || '');
        // 永続NGはそのまま引き継ぎ、それ以外はリセット
        var newStatus     = (statusType === MANSION_STATUS_TYPE.PERMANENT) ? originalStatus : MANSION_STATUS.OK;
        var newStatusType = (statusType === MANSION_STATUS_TYPE.PERMANENT) ? statusType : '';
        return [
          r[COL_MANSION.NAME    - 1],  // マンション名
          r[COL_MANSION.ADDRESS - 1],  // 住所
          r[COL_MANSION.CITY    - 1],  // 市町村
          newStatus,                    // ステータス（永続NG以外はリセット）
          newStatusType,                // ステータス種別
          '',                           // 最終訪問日 リセット
          0,                            // 最終配布枚数 リセット
          '',                           // メモ リセット
          r[COL_MANSION.LAT - 1] || '', // 緯度
          r[COL_MANSION.LNG - 1] || ''  // 経度
        ];
      });
      if (mansionRows.length > 0) {
        mansionSheet.getRange(2, 1, mansionRows.length, 10).setValues(mansionRows);
      }
    }
  } catch(e) {
    Logger.log('マンションデータコピー失敗: ' + e.message);
  }

  // ---- 店舗シート ----
  var storeSheet = ss.insertSheet('店舗');
  var storeHeaders = ['店舗名', '住所', '市町村', '設置枚数', '設置者名',
    '設置日', '緯度', '経度', 'メモ', 'メッセージID'];
  storeSheet.getRange(1, 1, 1, storeHeaders.length).setValues([storeHeaders]);
  _applyFlyerSheetHeaderFormat(storeSheet, storeHeaders.length);

  // ---- 実行者シート ----
  var executorSheet = ss.insertSheet('実行者');
  var executorHeaders = ['名前', '登録日'];
  executorSheet.getRange(1, 1, 1, executorHeaders.length).setValues([executorHeaders]);
  _applyFlyerSheetHeaderFormat(executorSheet, executorHeaders.length);

  // ---- 配布記録シート ----
  var distLogSheet = ss.insertSheet('配布記録');
  var distLogHeaders = ['日時', '市町村', '住所', 'チラシ種別', '配布枚数', '実施者名', '配布種別', '入力ソース'];
  distLogSheet.getRange(1, 1, 1, distLogHeaders.length).setValues([distLogHeaders]);
  _applyFlyerSheetHeaderFormat(distLogSheet, distLogHeaders.length);

  // SS IDを保存
  var ssId = ss.getId();
  _setFlyerSsId(flyerName, ssId);

  // ドロップダウン用の FLYER_TYPES にも自動追加（チラシを選択に反映）
  try {
    var props = PropertiesService.getScriptProperties();
    var existingTypes = (props.getProperty('FLYER_TYPES') || '')
      .split(',').map(function(s) { return s.trim(); }).filter(function(s) { return s; });
    if (existingTypes.indexOf(flyerName) === -1) {
      existingTypes.push(flyerName);
      props.setProperty('FLYER_TYPES', existingTypes.join(','));
      Logger.log('FLYER_TYPES に追加: ' + flyerName);
    }
  } catch(e) {
    Logger.log('FLYER_TYPES 更新失敗（SS自体は作成済み）: ' + e.message);
  }

  Logger.log('チラシSS作成完了: ' + flyerName + ' / ID=' + ssId);
  return { success: true, ssId: ssId, url: ss.getUrl() };
}

/**
 * マスターSSにあった旧チラシシートのデータをチラシSSのエリアシートに移行し、旧シートを削除する
 * @param {string} flyerName
 */
function migrateAndDeleteOldFlyerSheet(flyerName) {
  try {
    var masterSs = getSpreadsheet();
    var oldSheet = masterSs.getSheetByName(flyerName);

    if (!oldSheet) {
      Logger.log('migrateAndDeleteOldFlyerSheet: 旧シートなし: ' + flyerName);
      return { success: true, migrated: 0, reason: 'no_old_sheet' };
    }

    var flyerSs = _getFlyerSpreadsheet(flyerName);
    if (!flyerSs) {
      Logger.log('migrateAndDeleteOldFlyerSheet: チラシSSなし: ' + flyerName);
      return { success: false, reason: 'no_flyer_ss' };
    }

    var flyerAreaSheet = flyerSs.getSheetByName('エリア');
    if (!flyerAreaSheet) {
      Logger.log('migrateAndDeleteOldFlyerSheet: エリアシートなし in ' + flyerName);
      return { success: false, reason: 'no_area_sheet' };
    }

    var migratedCount = 0;
    var oldLastRow = oldSheet.getLastRow();

    if (oldLastRow >= 2) {
      // 旧シートのデータ（ヘッダー除く）
      var oldData = oldSheet.getRange(2, 1, oldLastRow - 1, 10).getValues();
      var flyerAreaLastRow = flyerAreaSheet.getLastRow();

      oldData.forEach(function(row) {
        if (!row[0]) return; // 空行スキップ
        var city  = row[0];
        var town  = row[1];
        var chome = row[2];

        // 既存エリアシートの行を探して更新
        var existingRow = _findAreaRowInSheet(flyerAreaSheet, city, town, chome);
        if (existingRow !== -1) {
          // ステータスや配布数を旧データで上書き
          if (row[4]) flyerAreaSheet.getRange(existingRow, COL_AREA.STATUS).setValue(row[4]);
          if (row[6]) flyerAreaSheet.getRange(existingRow, COL_AREA.DIST_COUNT).setValue(row[6]);
          if (row[7]) flyerAreaSheet.getRange(existingRow, COL_AREA.MEMBER_NAME).setValue(row[7]);
          if (row[8]) flyerAreaSheet.getRange(existingRow, COL_AREA.DIST_DATE).setValue(row[8]);
          if (row[9]) flyerAreaSheet.getRange(existingRow, COL_AREA.MEMO).setValue(row[9]);
          migratedCount++;
        } else {
          // 見つからなければ末尾に追記（12列対応）
          flyerAreaLastRow++;
          flyerAreaSheet.getRange(flyerAreaLastRow, 1, 1, 10).setValues([[
            city, town, chome, row[3] || 0,
            row[4] || STATUS.NOT_STARTED, flyerName,
            row[6] || 0, row[7] || '', row[8] || '', row[9] || ''
          ]]);
          migratedCount++;
        }
      });
    }

    // 旧シートを削除
    masterSs.deleteSheet(oldSheet);
    Logger.log('旧チラシシート削除: ' + flyerName + ' / 移行=' + migratedCount + '行');

    return { success: true, migrated: migratedCount };
  } catch(e) {
    Logger.log('migrateAndDeleteOldFlyerSheet エラー: ' + e.message);
    return { success: false, error: e.message };
  }
}

/**
 * エリアマスタの配布データを419チラシSSにコピーし、エリアマスタをリセットする
 * 【用途】エリアマスタに419チラシの実績データが残っている場合の一回限りの移行
 * GASエディタから実行: migrateAreaMasterTo419()
 */
function migrateAreaMasterTo419() {
  var flyerName = '419チラシ';
  var masterSs  = getSpreadsheet();
  var masterSheet = masterSs.getSheetByName(SHEET_NAMES.AREA_MASTER);

  if (!masterSheet || masterSheet.getLastRow() < 2) {
    Logger.log('エリアマスタにデータなし');
    return;
  }

  // 419チラシSSを取得（なければ自動作成）
  var flyerSs = _getFlyerSpreadsheet(flyerName);
  if (!flyerSs) {
    Logger.log('419チラシSS未作成 → 作成します');
    createFlyerSpreadsheet(flyerName);
    flyerSs = _getFlyerSpreadsheet(flyerName);
    if (!flyerSs) { Logger.log('SS作成失敗'); return; }
  }
  var flyerAreaSheet = flyerSs.getSheetByName('エリア');
  if (!flyerAreaSheet) { Logger.log('エリアシートなし'); return; }

  // ── エリアマスタのデータを読み込む ──────────────────────────
  var lastRow  = masterSheet.getLastRow();
  var srcData  = masterSheet.getRange(2, 1, lastRow - 1, 12).getValues();

  // ── 419チラシSSのエリアシートを上書き ───────────────────────
  // 既存データをクリア
  var flyerLastRow = flyerAreaSheet.getLastRow();
  if (flyerLastRow >= 2) {
    flyerAreaSheet.getRange(2, 1, flyerLastRow - 1, 12).clearContent();
  }

  var writeRows = srcData.filter(function(r) { return r[0]; }).map(function(r) {
    return [
      r[0],  // 市町村名
      r[1],  // 町名
      r[2],  // 丁目
      r[3],  // 世帯数
      r[4] || STATUS.NOT_STARTED,  // ステータス（そのままコピー）
      flyerName,                   // チラシ種別 = 419チラシ
      r[6] || 0,                   // 配布枚数
      r[7] || '',                  // 実施者名
      r[8] || '',                  // 実施日
      r[9] || '',                  // メモ
      r[10] || '',                 // 緯度
      r[11] || ''                  // 経度
    ];
  });

  if (writeRows.length > 0) {
    flyerAreaSheet.getRange(2, 1, writeRows.length, 12).setValues(writeRows);
  }
  Logger.log('✅ 419チラシSSにコピー完了: ' + writeRows.length + '行');

  // ── エリアマスタの配布データをリセット ──────────────────────
  var resetRows = srcData.filter(function(r) { return r[0]; }).map(function(r) {
    return [
      r[0], r[1], r[2], r[3],  // 市町村名・町名・丁目・世帯数（そのまま）
      STATUS.NOT_STARTED,       // ステータス → 未着手
      '',                       // チラシ種別 → 空
      0,                        // 配布枚数 → 0
      '',                       // 実施者名 → 空
      '',                       // 実施日 → 空
      '',                       // メモ → 空
      r[10] || '',              // 緯度（保持）
      r[11] || ''               // 経度（保持）
    ];
  });

  if (resetRows.length > 0) {
    masterSheet.getRange(2, 1, resetRows.length, 12).setValues(resetRows);
  }
  Logger.log('✅ エリアマスタリセット完了: ' + resetRows.length + '行');

  // ── 店舗設置を移行 ────────────────────────────────────────────
  _migrateStoreToFlyerSs(flyerName, masterSs, flyerSs);

  // ── 配布記録を移行 ────────────────────────────────────────────
  _migrateDistLogToFlyerSs(flyerName, masterSs, flyerSs);

  Logger.log('=== migrateAreaMasterTo419 完了 ===');
}

/**
 * マスターの店舗設置 → 419チラシSSの店舗シートへコピーしてマスターをクリア
 */
function _migrateStoreToFlyerSs(flyerName, masterSs, flyerSs) {
  var masterStore = masterSs.getSheetByName(SHEET_NAMES.STORE);
  if (!masterStore || masterStore.getLastRow() < 2) {
    Logger.log('店舗設置: データなし、スキップ');
    return;
  }

  var flyerStore = flyerSs.getSheetByName('店舗');
  if (!flyerStore) {
    Logger.log('店舗シートなし: ' + flyerName);
    return;
  }

  var lastRow = masterStore.getLastRow();
  var srcData  = masterStore.getRange(2, 1, lastRow - 1, 10).getValues();
  var rows     = srcData.filter(function(r) { return r[0]; }); // 名前のある行のみ

  // チラシSSの店舗シートに書き込み
  var flyerStoreLastRow = flyerStore.getLastRow();
  if (flyerStoreLastRow >= 2) {
    flyerStore.getRange(2, 1, flyerStoreLastRow - 1, 10).clearContent();
  }
  if (rows.length > 0) {
    flyerStore.getRange(2, 1, rows.length, 10).setValues(rows);
  }
  Logger.log('✅ 店舗設置コピー完了: ' + rows.length + '件');

  // マスターの店舗設置をクリア（ヘッダー行は保持）
  if (lastRow >= 2) {
    masterStore.getRange(2, 1, lastRow - 1, 10).clearContent();
  }
  Logger.log('✅ マスター店舗設置リセット完了');
}

/**
 * マスターの配布記録 → 419チラシSSの配布記録シートへコピーしてマスターをクリア
 */
function _migrateDistLogToFlyerSs(flyerName, masterSs, flyerSs) {
  var masterLog = masterSs.getSheetByName(SHEET_NAMES.DIST_LOG);
  if (!masterLog || masterLog.getLastRow() < 2) {
    Logger.log('配布記録: データなし、スキップ');
    return;
  }

  var flyerLog = flyerSs.getSheetByName('配布記録');
  if (!flyerLog) {
    Logger.log('配布記録シートなし: ' + flyerName);
    return;
  }

  var lastRow = masterLog.getLastRow();
  var srcData  = masterLog.getRange(2, 1, lastRow - 1, 8).getValues();
  var rows     = srcData.filter(function(r) { return r[0]; }); // 日時のある行のみ

  // チラシSSの配布記録シートに書き込み
  var flyerLogLastRow = flyerLog.getLastRow();
  if (flyerLogLastRow >= 2) {
    flyerLog.getRange(2, 1, flyerLogLastRow - 1, 8).clearContent();
  }
  if (rows.length > 0) {
    flyerLog.getRange(2, 1, rows.length, 8).setValues(rows);
    // 日時列の書式設定
    flyerLog.getRange(2, 1, rows.length, 1).setNumberFormat('yyyy/MM/dd HH:mm');
  }
  Logger.log('✅ 配布記録コピー完了: ' + rows.length + '件');

  // マスターの配布記録をクリア（ヘッダー行は保持）
  if (lastRow >= 2) {
    masterLog.getRange(2, 1, lastRow - 1, 8).clearContent();
  }
  Logger.log('✅ マスター配布記録リセット完了');
}

/**
 * 419チラシSSのエリアデータを復元する
 * ① エリアマスタの構造（住所・世帯数・緯度経度）をコピー
 * ② 419チラシSSの配布記録から枚数・ステータスを再計算して反映
 * GASエディタから実行: restoreFlyer419AreaData()
 */
function restoreFlyer419AreaData() {
  var flyerName = '419チラシ';
  var masterSs  = getSpreadsheet();
  var flyerSs   = _getFlyerSpreadsheet(flyerName);

  if (!flyerSs) {
    Logger.log('❌ 419チラシSSが見つかりません');
    return;
  }

  var masterAreaSheet = masterSs.getSheetByName(SHEET_NAMES.AREA_MASTER);
  var flyerAreaSheet  = flyerSs.getSheetByName('エリア');
  var flyerLogSheet   = flyerSs.getSheetByName('配布記録');

  if (!masterAreaSheet || masterAreaSheet.getLastRow() < 2) {
    Logger.log('❌ エリアマスタにデータなし');
    return;
  }
  if (!flyerAreaSheet) {
    Logger.log('❌ 419チラシSSにエリアシートなし');
    return;
  }

  // ── ① エリアマスタ構造をコピー（全行を未着手で初期化）──────
  var masterLastRow = masterAreaSheet.getLastRow();
  var masterData    = masterAreaSheet.getRange(2, 1, masterLastRow - 1, 12).getValues();

  var areaRows = masterData.filter(function(r) { return r[0]; }).map(function(r) {
    return [
      r[0], r[1], r[2], r[3],      // 市町村・町名・丁目・世帯数
      STATUS.NOT_STARTED,           // ステータス（まず未着手）
      flyerName,                    // チラシ種別
      0,                            // 配布枚数（後で再計算）
      '', '', '',                   // 実施者・実施日・メモ
      r[10] || '', r[11] || ''      // 緯度・経度
    ];
  });

  // 既存データをクリアして書き込み
  var flyerAreaLastRow = flyerAreaSheet.getLastRow();
  if (flyerAreaLastRow >= 2) {
    flyerAreaSheet.getRange(2, 1, flyerAreaLastRow - 1, 12).clearContent();
  }
  if (areaRows.length > 0) {
    flyerAreaSheet.getRange(2, 1, areaRows.length, 12).setValues(areaRows);
  }
  Logger.log('✅ エリア構造コピー完了: ' + areaRows.length + '行');

  // ── ② 配布記録から枚数・ステータスを再計算 ─────────────────
  if (!flyerLogSheet || flyerLogSheet.getLastRow() < 2) {
    Logger.log('配布記録なし → 未着手のまま完了');
    return;
  }

  var logLastRow = flyerLogSheet.getLastRow();
  var logData    = flyerLogSheet.getRange(2, 1, logLastRow - 1, 8).getValues();

  // city|addr → {count, memberName, latestDate} の集計マップ
  // ※ 漢数字(一丁目) / アラビア数字(1丁目) どちらにも対応するため正規化してキー作成
  // ※ flyerType フィルタ: '419チラシ' または空（旧記録）のみ対象
  var accumMap = {};
  var skippedByFlyer = 0;
  logData.forEach(function(row) {
    var distType  = String(row[6] || '').trim();
    var flyerType = String(row[3] || '').trim();
    if (distType === 'マンション') return;
    // 他チラシ種別の記録は除外（空は旧記録として含める）
    if (flyerType && flyerType !== flyerName) { skippedByFlyer++; return; }
    var city   = String(row[1] || '').trim();
    var addr   = _normalizeTownName(String(row[2] || '').trim());
    var count  = parseInt(row[4], 10) || 0;
    var member = String(row[5] || '').trim();
    var date   = row[0];
    if (!city || !addr || count === 0) return;
    var key = city + '|' + addr;
    if (!accumMap[key]) {
      accumMap[key] = { count: 0, memberName: member, latestDate: null };
    }
    accumMap[key].count += count;
    if (!accumMap[key].latestDate || (date && date > accumMap[key].latestDate)) {
      accumMap[key].memberName = member;
      accumMap[key].latestDate = date;
    }
  });
  Logger.log('他チラシ除外: ' + skippedByFlyer + '件');

  // エリアシートを再読み込みして更新
  var currentData = flyerAreaSheet.getRange(2, 1, areaRows.length, 12).getValues();
  var updated = 0;
  currentData.forEach(function(row, i) {
    var city  = String(row[0] || '').trim();
    var town  = _normalizeTownName(String(row[1] || '').trim());
    var chome = String(row[2] || '').trim();
    var key   = city + '|' + (town + chome);
    var accum = accumMap[key];
    if (accum && accum.count > 0) {
      flyerAreaSheet.getRange(i + 2, COL_AREA.STATUS).setValue(STATUS.DONE);
      flyerAreaSheet.getRange(i + 2, COL_AREA.DIST_COUNT).setValue(accum.count);
      flyerAreaSheet.getRange(i + 2, COL_AREA.MEMBER_NAME).setValue(accum.memberName);
      updated++;
    }
  });

  Logger.log('✅ 配布枚数・ステータス反映完了: ' + updated + '行を配布済みに更新');
  Logger.log('=== restoreFlyer419AreaData 完了 ===');
}

/**
 * 419チラシSSのマンションデータをマスター台帳から復元する
 * マスターの訪問履歴（ステータス・最終訪問日・枚数）をそのままコピー
 * GASエディタから実行: restoreFlyer419MansionData()
 */
function restoreFlyer419MansionData() {
  var flyerName = '419チラシ';
  var masterSs  = getSpreadsheet();
  var flyerSs   = _getFlyerSpreadsheet(flyerName);

  if (!flyerSs) {
    Logger.log('❌ 419チラシSSが見つかりません');
    return;
  }

  var masterMansionSheet = masterSs.getSheetByName(SHEET_NAMES.MANSION);
  var flyerMansionSheet  = flyerSs.getSheetByName('マンション');

  if (!masterMansionSheet || masterMansionSheet.getLastRow() < 2) {
    Logger.log('❌ マンション台帳にデータなし');
    return;
  }

  // シートがなければ作成
  if (!flyerMansionSheet) {
    flyerMansionSheet = flyerSs.insertSheet('マンション');
    var headers = ['マンション名', '住所', '市町村', '配布ステータス',
      'ステータス種別', '最終訪問日', '最終配布枚数', 'メモ', '緯度', '経度'];
    flyerMansionSheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    _applyFlyerSheetHeaderFormat(flyerMansionSheet, headers.length);
    Logger.log('マンションシートを新規作成しました');
  }

  // マスター台帳の全データを取得（訪問履歴ごとコピー）
  var lastRow = masterMansionSheet.getLastRow();
  var srcData = masterMansionSheet.getRange(2, 1, lastRow - 1, 10).getValues();
  var rows = srcData.filter(function(r) { return r[0]; });

  if (rows.length === 0) {
    Logger.log('マンション台帳にデータなし（フィルタ後）');
    return;
  }

  // 既存データをクリアして書き込み
  var flyerLastRow = flyerMansionSheet.getLastRow();
  if (flyerLastRow >= 2) {
    flyerMansionSheet.getRange(2, 1, flyerLastRow - 1, 10).clearContent();
  }
  flyerMansionSheet.getRange(2, 1, rows.length, 10).setValues(rows);
  Logger.log('✅ マンションデータ復元完了: ' + rows.length + '件');
  Logger.log('=== restoreFlyer419MansionData 完了 ===');
}

/**
 * チラシSSの配布記録からエリアのステータス・配布枚数を再計算して反映する
 * 既存エリアデータは保持し、配布記録があるエリアのみ上書き更新する
 * @param {string} flyerName
 */
function recalcFlyerAreaFromLog(flyerName) {
  var flyerSs = _getFlyerSpreadsheet(flyerName);
  if (!flyerSs) {
    Logger.log('❌ ' + flyerName + ' のSSが見つかりません');
    return;
  }

  var flyerAreaSheet = flyerSs.getSheetByName('エリア');
  var flyerLogSheet  = flyerSs.getSheetByName('配布記録');

  if (!flyerAreaSheet || flyerAreaSheet.getLastRow() < 2) {
    Logger.log('❌ エリアシートにデータなし');
    return;
  }
  if (!flyerLogSheet || flyerLogSheet.getLastRow() < 2) {
    Logger.log('配布記録なし → 処理スキップ');
    return;
  }

  // 配布記録から city|addr → {count, memberName, latestDate} を集計
  // ※ 漢数字(一丁目) / アラビア数字(1丁目) 混在に対応するため両側を正規化
  // ※ flyerType フィルタ: 対象チラシ名 または空（旧記録）のみ集計
  var logLastRow = flyerLogSheet.getLastRow();
  var logData    = flyerLogSheet.getRange(2, 1, logLastRow - 1, 8).getValues();

  var accumMap = {};
  var skippedByFlyer = 0;
  logData.forEach(function(row) {
    var distType  = String(row[6] || '').trim();
    var flyerType = String(row[3] || '').trim();
    if (distType === 'マンション') return;  // マンションは除外
    // 他チラシ種別の記録は除外（flyerTypeが空の旧記録は含める）
    if (flyerType && flyerType !== flyerName) { skippedByFlyer++; return; }
    var city   = String(row[1] || '').trim();
    var addr   = _normalizeTownName(String(row[2] || '').trim());
    var count  = parseInt(row[4], 10) || 0;
    var member = String(row[5] || '').trim();
    var date   = row[0];
    if (!city || !addr || count === 0) return;
    var key = city + '|' + addr;
    if (!accumMap[key]) {
      accumMap[key] = { count: 0, memberName: member, latestDate: null };
    }
    accumMap[key].count += count;
    if (!accumMap[key].latestDate || (date && date > accumMap[key].latestDate)) {
      accumMap[key].memberName = member;
      accumMap[key].latestDate = date;
    }
  });

  Logger.log('集計キー数: ' + Object.keys(accumMap).length + ' / 他チラシ除外: ' + skippedByFlyer + '件');

  // エリアシートを更新
  var areaLastRow = flyerAreaSheet.getLastRow();
  var currentData = flyerAreaSheet.getRange(2, 1, areaLastRow - 1, 12).getValues();
  var updated = 0;

  currentData.forEach(function(row, i) {
    var city  = String(row[0] || '').trim();
    var town  = _normalizeTownName(String(row[1] || '').trim());
    var chome = String(row[2] || '').trim();
    var key   = city + '|' + (town + chome);
    var accum = accumMap[key];
    if (accum && accum.count > 0) {
      flyerAreaSheet.getRange(i + 2, COL_AREA.STATUS).setValue(STATUS.DONE);
      flyerAreaSheet.getRange(i + 2, COL_AREA.DIST_COUNT).setValue(accum.count);
      flyerAreaSheet.getRange(i + 2, COL_AREA.MEMBER_NAME).setValue(accum.memberName);
      if (accum.latestDate) {
        flyerAreaSheet.getRange(i + 2, COL_AREA.DIST_DATE).setValue(
          Utilities.formatDate(new Date(accum.latestDate), 'Asia/Tokyo', 'yyyy-MM-dd')
        );
      }
      updated++;
    }
  });

  Logger.log('✅ ' + flyerName + ' エリア再計算完了: ' + updated + '行を配布済みに更新');
  Logger.log('=== recalcFlyerAreaFromLog 完了 ===');
}

/**
 * マスターの配布記録からチラシSSの配布記録・エリアを同期する
 * チラシSSの配布記録が空の場合にマスターから補完する
 * @param {string} flyerName チラシ名（半角・全角数字どちらでも可）
 */
function syncFlyerSsFromMasterDistLog(flyerName) {
  var normalizedName = _normalizeFlyerNameDigits(flyerName);

  // チラシSSの配布記録シートを取得
  var flyerLogSheet = _getFlyerSheet(normalizedName, '配布記録');
  if (!flyerLogSheet) {
    Logger.log('❌ チラシSSが見つかりません: ' + normalizedName);
    return;
  }

  // マスターの配布記録を全取得
  var masterSs    = getSpreadsheet();
  var masterSheet = masterSs.getSheetByName(SHEET_NAMES.DIST_LOG);
  if (!masterSheet || masterSheet.getLastRow() < 2) {
    Logger.log('❌ マスター配布記録なし');
    return;
  }

  var masterData = masterSheet.getRange(2, 1, masterSheet.getLastRow() - 1, 8).getValues();

  // 対象チラシ名でフィルタ（正規化して比較 ＋ 全角・半角両対応）
  var matched = masterData.filter(function(row) {
    var ft = _normalizeFlyerNameDigits(String(row[3] || '').trim());
    return ft === normalizedName || ft === flyerName || String(row[3] || '').trim() === flyerName;
  });

  Logger.log('マスター配布記録 対象件数: ' + matched.length + '件 (チラシ: ' + normalizedName + ')');
  if (matched.length === 0) {
    Logger.log('対象レコードなし。チラシ種別名がマスターに存在するか確認してください。');
    return;
  }

  // チラシSS配布記録の既存データをキーで管理（重複防止）
  var existingKeys = {};
  var flyerLastRow = flyerLogSheet.getLastRow();
  if (flyerLastRow >= 2) {
    var existingData = flyerLogSheet.getRange(2, 1, flyerLastRow - 1, 8).getValues();
    existingData.forEach(function(row) {
      if (!row[0]) return;
      var dt  = row[0] instanceof Date ? row[0].getTime() : String(row[0]);
      var key = dt + '|' + String(row[1]) + '|' + String(row[2]);
      existingKeys[key] = true;
    });
  }

  // マスターのレコードをチラシSS配布記録にコピー
  var addedCount = 0;
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    matched.forEach(function(row) {
      var dt  = row[0] instanceof Date ? row[0].getTime() : String(row[0]);
      var key = dt + '|' + String(row[1]) + '|' + String(row[2]);
      if (existingKeys[key]) {
        Logger.log('重複スキップ: ' + String(row[1]) + ' ' + String(row[2]));
        return;
      }
      var nextRow = flyerLogSheet.getLastRow() + 1;
      flyerLogSheet.getRange(nextRow, 1, 1, 8).setValues([[
        row[0], row[1], row[2], normalizedName,
        row[4], row[5], row[6], row[7]
      ]]);
      flyerLogSheet.getRange(nextRow, 1).setNumberFormat('yyyy/MM/dd HH:mm');
      existingKeys[key] = true;
      addedCount++;
      Logger.log('✅ コピー: ' + String(row[1]) + ' ' + String(row[2]) + ' ' + row[4] + '枚');
    });
  } finally {
    lock.releaseLock();
  }

  Logger.log('配布記録コピー完了: ' + addedCount + '件追加');

  // エリアシートをチラシSS配布記録から再計算
  Logger.log('エリアシート再計算中...');
  recalcFlyerAreaFromLog(normalizedName);
}

/**
 * DIYタイムズ１９チラシSSをマスター配布記録から同期する（ワンクリック実行用）
 * FLYER_SS_MAPから「DIY」を含むチラシ名を自動検索して使用する
 * GASエディタから実行: syncDIYFlyerFromMasterLog()
 */
function syncDIYFlyerFromMasterLog() {
  // マップから「DIY」を含むチラシ名を検索（文字コード差異を回避）
  var map = _getFlyerSsMap();
  var flyerName = null;
  Object.keys(map).forEach(function(key) {
    if (key.toUpperCase().indexOf('DIY') !== -1) flyerName = key;
  });
  if (!flyerName) {
    Logger.log('❌ DIYチラシがFLYER_SS_MAPに登録されていません');
    Logger.log('登録済みチラシ: ' + Object.keys(map).join(', '));
    return;
  }
  Logger.log('対象チラシ名: [' + flyerName + ']');
  syncFlyerSsFromMasterDistLog(flyerName);
}

/**
 * DIYタイムズ１９チラシのエリアを配布記録から再計算する
 * GASエディタから実行: recalcDIYTimesAreaFromLog()
 */
function recalcDIYTimesAreaFromLog() {
  recalcFlyerAreaFromLog('DIYタイムズ１９チラシ');
}

/**
 * 419チラシSSに配布記録シートを作成してマスターから移動する
 * GASエディタから実行: addDistLogSheetAndMigrate()
 */
function addDistLogSheetAndMigrate() {
  var flyerName = '419チラシ';
  var masterSs  = getSpreadsheet();
  var flyerSs   = _getFlyerSpreadsheet(flyerName);

  if (!flyerSs) {
    Logger.log('❌ 419チラシSSが見つかりません。先にsetupAllFlyerSpreadsheets()を実行してください。');
    return;
  }

  // ── 配布記録シートを作成（なければ） ────────────────────────
  var flyerLog = flyerSs.getSheetByName('配布記録');
  if (!flyerLog) {
    flyerLog = flyerSs.insertSheet('配布記録');
    var headers = ['日時', '市町村', '住所', 'チラシ種別', '配布枚数', '実施者名', '配布種別', '入力ソース'];
    flyerLog.getRange(1, 1, 1, headers.length).setValues([headers]);
    flyerLog.getRange(1, 1, 1, headers.length)
      .setBackground('#1a237e').setFontColor('#ffffff').setFontWeight('bold');
    flyerLog.setFrozenRows(1);
    Logger.log('✅ 配布記録シート作成完了');
  } else {
    Logger.log('配布記録シートは既に存在します');
  }

  // ── マスターの配布記録を読み込む ────────────────────────────
  var masterLog = masterSs.getSheetByName(SHEET_NAMES.DIST_LOG);
  if (!masterLog || masterLog.getLastRow() < 2) {
    Logger.log('マスター配布記録にデータなし');
    return;
  }

  var lastRow = masterLog.getLastRow();
  var srcData = masterLog.getRange(2, 1, lastRow - 1, 8).getValues();
  var rows    = srcData.filter(function(r) { return r[0]; });

  if (rows.length === 0) {
    Logger.log('移動するデータなし');
    return;
  }

  // ── 419チラシSSの配布記録に書き込む ─────────────────────────
  var flyerLogLastRow = flyerLog.getLastRow();
  if (flyerLogLastRow >= 2) {
    flyerLog.getRange(2, 1, flyerLogLastRow - 1, 8).clearContent();
  }
  flyerLog.getRange(2, 1, rows.length, 8).setValues(rows);
  flyerLog.getRange(2, 1, rows.length, 1).setNumberFormat('yyyy/MM/dd HH:mm');
  Logger.log('✅ 配布記録コピー完了: ' + rows.length + '件');

  // ── マスターの配布記録をクリア ───────────────────────────────
  masterLog.getRange(2, 1, lastRow - 1, 8).clearContent();
  Logger.log('✅ マスター配布記録クリア完了');
  Logger.log('=== addDistLogSheetAndMigrate 完了 ===');
}

/**
 * 全チラシのSSをセットアップする（GASエディタから実行）
 */
function setupAllFlyerSpreadsheets() {
  var flyerTypesVal = PropertiesService.getScriptProperties().getProperty('FLYER_TYPES');
  var flyerTypes = flyerTypesVal
    ? flyerTypesVal.split(',').map(function(s) { return s.trim(); }).filter(function(s) { return s; })
    : ['419チラシ', 'DIYタイムズ１９チラシ'];

  Logger.log('setupAllFlyerSpreadsheets 開始: ' + flyerTypes.join(', '));

  flyerTypes.forEach(function(flyerName) {
    Logger.log('--- ' + flyerName + ' ---');

    // SS作成
    var createResult = createFlyerSpreadsheet(flyerName);
    if (createResult.success) {
      Logger.log('SS作成: ' + createResult.url);
    } else {
      Logger.log('SS作成スキップ: ' + createResult.reason);
    }

    // 旧シート移行・削除
    var migrateResult = migrateAndDeleteOldFlyerSheet(flyerName);
    Logger.log('移行結果: ' + JSON.stringify(migrateResult));
  });

  Logger.log('setupAllFlyerSpreadsheets 完了');
}

// ------------------------------------------------------------
// 読み取り関数
// ------------------------------------------------------------

/**
 * チラシSSのエリアシートからエリア一覧を取得する
 * @param {string} flyerName
 * @param {string|null} cityFilter
 * @returns {Array|null} SSが存在しない場合はnull、存在するが空なら[]
 */
function getAreaListFromFlyerSs(flyerName, cityFilter) {
  var sheet = _getFlyerSheet(flyerName, 'エリア');
  if (!sheet) return null;  // SSなし → nullでフォールバックを促す

  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];

  var data = sheet.getRange(2, 1, lastRow - 1, 12).getValues();
  var results = [];

  for (var i = 0; i < data.length; i++) {
    var row = data[i];
    if (!row[COL_AREA.CITY - 1]) continue;
    if (cityFilter && row[COL_AREA.CITY - 1] !== cityFilter) continue;
    results.push(_rowToArea(row, i + 2));
  }

  return results;
}

/**
 * チラシSSのマンションシートからマンション一覧を取得する
 * @param {string} flyerName
 * @param {Object} [filter] {city, status}
 * @returns {Array} SSが存在しない場合は[]
 */
/**
 * チラシSSのマンションシートをマスター台帳で上書き再作成（訪問履歴リセット）
 * チラシが新しくなった時や、前チラシのデータが混入している場合に実行する
 * @param {string} flyerName チラシ名（省略時はFLYER_SS_MAPの全チラシが対象）
 */
function resetMansionInFlyerSs(flyerName) {
  var targetNames = [];
  if (flyerName) {
    targetNames = [flyerName];
  } else {
    targetNames = Object.keys(_getFlyerSsMap());
  }

  // マスターのマンション台帳を取得
  var masterSs = getSpreadsheet();
  var masterSheet = masterSs.getSheetByName(SHEET_NAMES.MANSION);
  if (!masterSheet || masterSheet.getLastRow() < 2) {
    Logger.log('❌ マスターマンション台帳が空です');
    return;
  }
  var masterData = masterSheet.getRange(2, 1, masterSheet.getLastRow() - 1, 10).getValues()
    .filter(function(r) { return r[COL_MANSION.NAME - 1]; });

  targetNames.forEach(function(name) {
    var mansionSheet = _getFlyerSheet(name, 'マンション');
    if (!mansionSheet) {
      Logger.log('⚠️ マンションシートなし: ' + name);
      return;
    }

    // 既存データをクリア（ヘッダー以外）
    var lastRow = mansionSheet.getLastRow();
    if (lastRow >= 2) {
      mansionSheet.getRange(2, 1, lastRow - 1, mansionSheet.getLastColumn()).clearContent();
    }

    // マスターデータをリセット状態でコピー
    // NG系ステータス（永続NG）は引き継ぎ、それ以外は配布OKにリセット
    var rows = masterData.map(function(r) {
      var originalStatus = String(r[COL_MANSION.STATUS - 1] || '');
      var statusType     = String(r[COL_MANSION.STATUS_TYPE - 1] || '');
      // 永続NGはそのまま引き継ぐ
      var newStatus = (statusType === MANSION_STATUS_TYPE.PERMANENT) ? originalStatus : MANSION_STATUS.OK;
      var newStatusType = (statusType === MANSION_STATUS_TYPE.PERMANENT) ? statusType : '';
      return [
        r[COL_MANSION.NAME      - 1],  // マンション名
        r[COL_MANSION.ADDRESS   - 1],  // 住所
        r[COL_MANSION.CITY      - 1],  // 市町村
        newStatus,                      // ステータス（永続NG以外はリセット）
        newStatusType,                  // ステータス種別
        '',                             // 最終訪問日 リセット
        0,                              // 最終配布枚数 リセット
        '',                             // メモ リセット
        r[COL_MANSION.LAT       - 1] || '',  // 緯度
        r[COL_MANSION.LNG       - 1] || ''   // 経度
      ];
    });

    if (rows.length > 0) {
      mansionSheet.getRange(2, 1, rows.length, 10).setValues(rows);
    }
    Logger.log('✅ マンションリセット完了: ' + name + '（' + rows.length + '件）');
  });
}

/**
 * DIYタイムズ１９チラシのマンションをリセットする
 * GASエディタから実行: resetDIYMansion()
 */
function resetDIYMansion() {
  var map = _getFlyerSsMap();
  var flyerName = null;
  Object.keys(map).forEach(function(key) {
    if (key.toUpperCase().indexOf('DIY') !== -1) flyerName = key;
  });
  if (!flyerName) { Logger.log('❌ DIYチラシ未登録'); return; }
  Logger.log('対象: ' + flyerName);
  resetMansionInFlyerSs(flyerName);
}

function getMansionListFromFlyerSs(flyerName, filter) {
  filter = filter || {};
  var sheet = _getFlyerSheet(flyerName, 'マンション');
  if (!sheet) return [];

  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];

  var data = sheet.getRange(2, 1, lastRow - 1, 10).getValues();
  var results = [];

  for (var i = 0; i < data.length; i++) {
    var row = data[i];
    if (!row[COL_MANSION.NAME - 1]) continue;
    if (filter.city   && row[COL_MANSION.CITY   - 1] !== filter.city)   continue;
    if (filter.status && row[COL_MANSION.STATUS  - 1] !== filter.status) continue;
    results.push(_rowToMansion(row, i + 2));
  }

  return results;
}

/**
 * チラシSSの店舗シートから店舗一覧を取得する
 * @param {string} flyerName
 * @returns {Array}
 */
function getStoreListFromFlyerSs(flyerName) {
  var sheet = _getFlyerSheet(flyerName, '店舗');
  if (!sheet) return [];

  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];

  var rows = sheet.getRange(2, 1, lastRow - 1, 9).getValues();
  var result = [];
  rows.forEach(function(r, i) {
    if (!r[COL_STORE.NAME - 1]) return;
    result.push({
      rowNum:     i + 2,
      name:       String(r[COL_STORE.NAME    - 1] || ''),
      address:    String(r[COL_STORE.ADDRESS  - 1] || ''),
      city:       String(r[COL_STORE.CITY     - 1] || ''),
      count:      parseInt(r[COL_STORE.COUNT   - 1], 10) || 0,
      memberName: String(r[COL_STORE.MEMBER   - 1] || ''),
      date:       String(r[COL_STORE.DATE     - 1] || ''),
      lat:        parseFloat(r[COL_STORE.LAT  - 1]) || null,
      lng:        parseFloat(r[COL_STORE.LNG  - 1]) || null,
      memo:       String(r[COL_STORE.MEMO     - 1] || '')
    });
  });
  return result;
}

// ------------------------------------------------------------
// 書き込み関数
// ------------------------------------------------------------

/**
 * チラシSSのエリアシートを更新する
 * @param {string} flyerName
 * @param {Object} params {city, town, chome, status, flyerType, distCount, memberName, distDate, memo}
 * @returns {Object} {success} or {success:false, error}
 */
function updateAreaInFlyerSs(flyerName, params) {
  var sheet = _getFlyerSheet(flyerName, 'エリア');
  if (!sheet) return { success: false, error: 'チラシSSが見つかりません: ' + flyerName };

  var lock = LockService.getScriptLock();
  lock.waitLock(30000);

  try {
    var rowIndex = _findAreaRowInSheet(sheet, params.city, params.town, params.chome);
    if (rowIndex === -1) {
      return { success: false, error: 'エリアが見つかりません: ' + params.city + ' ' + params.town + (params.chome || '') };
    }

    if (params.status     != null) sheet.getRange(rowIndex, COL_AREA.STATUS).setValue(params.status);
    if (params.flyerType  != null) sheet.getRange(rowIndex, COL_AREA.FLYER_TYPE).setValue(params.flyerType);
    if (params.distCount  != null) {
      if (params.accumulate) {
        var existing = parseInt(sheet.getRange(rowIndex, COL_AREA.DIST_COUNT).getValue() || 0, 10);
        sheet.getRange(rowIndex, COL_AREA.DIST_COUNT).setValue((existing || 0) + params.distCount);
      } else {
        sheet.getRange(rowIndex, COL_AREA.DIST_COUNT).setValue(params.distCount);
      }
    }
    if (params.memberName != null) sheet.getRange(rowIndex, COL_AREA.MEMBER_NAME).setValue(params.memberName);
    if (params.distDate   != null) sheet.getRange(rowIndex, COL_AREA.DIST_DATE).setValue(params.distDate);
    if (params.memo       != null) sheet.getRange(rowIndex, COL_AREA.MEMO).setValue(params.memo);

    return { success: true };
  } finally {
    lock.releaseLock();
  }
}

/**
 * チラシSSのマンションシートに訪問記録を書き込む
 * @param {string} flyerName
 * @param {Object} params {rowId, status, statusType, distCount, memberName, memo, flyerType}
 * @returns {Object} {success}
 */
function recordMansionVisitInFlyerSs(flyerName, params) {
  var sheet = _getFlyerSheet(flyerName, 'マンション');
  if (!sheet) return { success: false, error: 'チラシSSが見つかりません: ' + flyerName };

  var lock = LockService.getScriptLock();
  lock.waitLock(30000);

  try {
    var rowId = params.rowId;
    if (!rowId || rowId < 2) return { success: false, error: '無効な行IDです' };

    var nameCheck = sheet.getRange(rowId, COL_MANSION.NAME).getValue();
    if (!nameCheck) return { success: false, error: 'マンションが見つかりません: row=' + rowId };

    var today = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd');

    if (params.status     != null) sheet.getRange(rowId, COL_MANSION.STATUS).setValue(params.status);
    if (params.statusType != null) sheet.getRange(rowId, COL_MANSION.STATUS_TYPE).setValue(params.statusType || '');
    sheet.getRange(rowId, COL_MANSION.LAST_VISIT).setValue(new Date(today));
    sheet.getRange(rowId, COL_MANSION.LAST_VISIT).setNumberFormat('yyyy/MM/dd');
    sheet.getRange(rowId, COL_MANSION.LAST_COUNT).setValue(params.distCount || 0);
    if (params.memo != null) sheet.getRange(rowId, COL_MANSION.MEMO).setValue(params.memo);

    // 配布OKかつ枚数>0 の場合は配布記録に追記
    if (params.status === MANSION_STATUS.OK && params.distCount > 0) {
      var mansionData = sheet.getRange(rowId, 1, 1, 3).getValues()[0];
      var mansionName = mansionData[COL_MANSION.NAME - 1];
      var city = mansionData[COL_MANSION.CITY - 1];
      var logParams = {
        city:       city,
        address:    mansionName,
        flyerType:  params.flyerType || flyerName,
        distCount:  params.distCount,
        memberName: params.memberName || '',
        distType:   'マンション',
        source:     'アプリ手入力'
      };
      // マスターの配布記録にも追記（全体集計用）
      appendDistLog(logParams);
      // チラシSS内の配布記録にも追記
      appendDistLogToFlyerSs(flyerName, logParams);
    }

    return { success: true };
  } finally {
    lock.releaseLock();
  }
}

/**
 * チラシSSのマンションシートにマンションを新規追加する
 * @param {string} flyerName
 * @param {Object} params {name, address, city, status, statusType, lastVisit, lastCount, memo, lat, lng}
 * @returns {Object} {success, id}
 */
function addMansionToFlyerSs(flyerName, params) {
  var sheet = _getFlyerSheet(flyerName, 'マンション');
  if (!sheet) return { success: false, error: 'チラシSSが見つかりません: ' + flyerName };

  var lock = LockService.getScriptLock();
  lock.waitLock(30000);

  try {
    var nextRow = sheet.getLastRow() + 1;
    sheet.getRange(nextRow, 1, 1, 10).setValues([[
      params.name      || '',
      params.address   || '',
      params.city      || '',
      params.status    || MANSION_STATUS.OK,
      params.statusType || '',
      params.lastVisit ? new Date(params.lastVisit) : '',
      params.lastCount || '',
      params.memo      || '',
      params.lat       || '',
      params.lng       || ''
    ]]);
    if (params.lastVisit) {
      sheet.getRange(nextRow, COL_MANSION.LAST_VISIT).setNumberFormat('yyyy/MM/dd');
    }
    return { success: true, id: nextRow };
  } finally {
    lock.releaseLock();
  }
}

/**
 * チラシSSの店舗シートの指定行を更新する
 * @param {string} flyerName
 * @param {number} rowNum
 * @param {Object} params {name, address, city, count, memberName, memo}
 * @returns {Object} {success}
 */
function updateStoreInFlyerSs(flyerName, rowNum, params) {
  if (!rowNum || rowNum < 2) return { success: false, error: '行番号が不正です' };
  var sheet = _getFlyerSheet(flyerName, '店舗');
  if (!sheet) return { success: false, error: 'チラシSSが見つかりません: ' + flyerName };

  var lock = LockService.getScriptLock();
  lock.waitLock(10000);

  try {
    if (params.name       !== undefined) sheet.getRange(rowNum, COL_STORE.NAME   ).setValue(params.name);
    if (params.address    !== undefined) sheet.getRange(rowNum, COL_STORE.ADDRESS ).setValue(params.address);
    if (params.city       !== undefined) sheet.getRange(rowNum, COL_STORE.CITY   ).setValue(params.city);
    if (params.count      !== undefined) sheet.getRange(rowNum, COL_STORE.COUNT  ).setValue(params.count);
    if (params.memberName !== undefined) sheet.getRange(rowNum, COL_STORE.MEMBER ).setValue(params.memberName);
    if (params.memo       !== undefined) sheet.getRange(rowNum, COL_STORE.MEMO   ).setValue(params.memo);
    return { success: true };
  } catch(e) {
    return { success: false, error: e.message };
  } finally {
    lock.releaseLock();
  }
}

/**
 * チラシSSの店舗シートに店舗を新規追加する
 * @param {string} flyerName
 * @param {Object} params {name, address, city, count, memberName, date, lat, lng, memo, msgId}
 * @returns {Object} {success, rowNum}
 */
function addStoreToFlyerSs(flyerName, params) {
  var sheet = _getFlyerSheet(flyerName, '店舗');
  if (!sheet) return { success: false, error: 'チラシSSが見つかりません: ' + flyerName };

  var lock = LockService.getScriptLock();
  lock.waitLock(15000);

  try {
    var nextRow = sheet.getLastRow() + 1;
    sheet.getRange(nextRow, 1, 1, 10).setValues([[
      params.name       || '',
      params.address    || '',
      params.city       || '',
      params.count      || 0,
      params.memberName || '',
      params.date       || '',
      params.lat        || '',
      params.lng        || '',
      params.memo       || '',
      params.msgId      || ''
    ]]);
    return { success: true, rowNum: nextRow };
  } finally {
    lock.releaseLock();
  }
}

/**
 * チラシSSの全店舗を再ジオコーディングして座標を修正する
 * 範囲外（渡島・檜山管内外）の座標はクリアする
 * GASエディタから実行: regeocodeAllStoresInFlyer419() / regeocodeAllStoresInFlyerDIY()
 * @param {string} flyerName
 */
function regeocodeAllStoresInFlyer(flyerName) {
  var sheet = _getFlyerSheet(flyerName, '店舗');
  if (!sheet || sheet.getLastRow() < 2) {
    Logger.log('❌ 店舗シートにデータなし: ' + flyerName);
    return;
  }

  var geocoder = Maps.newGeocoder().setLanguage('ja').setRegion('JP');
  var lastRow  = sheet.getLastRow();
  var data     = sheet.getRange(2, 1, lastRow - 1, 10).getValues();
  var fixed = 0; var cleared = 0; var skipped = 0;

  data.forEach(function(row, i) {
    var name    = String(row[COL_STORE.NAME    - 1] || '').trim();
    var address = String(row[COL_STORE.ADDRESS  - 1] || '').trim();
    var city    = String(row[COL_STORE.CITY     - 1] || '').trim();
    var curLat  = row[COL_STORE.LAT - 1];
    var curLng  = row[COL_STORE.LNG - 1];
    if (!name) return;

    // 既存座標が正常範囲内ならスキップ
    if (curLat && curLng) {
      var la = parseFloat(curLat); var lo = parseFloat(curLng);
      if (la >= 41.0 && la <= 43.0 && lo >= 139.0 && lo <= 141.5) {
        skipped++;
        return;
      }
    }

    // 再ジオコーディング（「北海道＋市町村＋住所」で検索）
    var query = '北海道' + (city || '函館市') + ' ' + (address || name);
    try {
      var result = geocoder.geocode(query);
      if (result.status === 'OK' && result.results.length > 0) {
        var loc = result.results[0].geometry.location;
        if (loc.lat >= 41.0 && loc.lat <= 43.0 && loc.lng >= 139.0 && loc.lng <= 141.5) {
          sheet.getRange(i + 2, COL_STORE.LAT).setValue(loc.lat);
          sheet.getRange(i + 2, COL_STORE.LNG).setValue(loc.lng);
          Logger.log('✅ 修正: ' + name + ' → ' + loc.lat + ',' + loc.lng);
          fixed++;
        } else {
          sheet.getRange(i + 2, COL_STORE.LAT).setValue('');
          sheet.getRange(i + 2, COL_STORE.LNG).setValue('');
          Logger.log('⚠️ 範囲外のためクリア: ' + name + ' (' + query + ')');
          cleared++;
        }
      } else {
        sheet.getRange(i + 2, COL_STORE.LAT).setValue('');
        sheet.getRange(i + 2, COL_STORE.LNG).setValue('');
        Logger.log('⚠️ ジオコーディング失敗のためクリア: ' + name);
        cleared++;
      }
    } catch(e) {
      Logger.log('エラー: ' + name + ' / ' + e.message);
    }
    Utilities.sleep(200); // レート制限対策
  });

  Logger.log('=== regeocodeAllStoresInFlyer 完了: ' + flyerName +
    ' / 修正=' + fixed + ' クリア=' + cleared + ' スキップ=' + skipped + ' ===');
}

/** 419チラシの全店舗を再ジオコーディング — GASエディタから実行 */
function regeocodeAllStoresInFlyer419() {
  regeocodeAllStoresInFlyer('419チラシ');
}

/** DIYタイムズ１９チラシの全店舗を再ジオコーディング — GASエディタから実行 */
function regeocodeAllStoresInFlyerDIY() {
  regeocodeAllStoresInFlyer('DIYタイムズ１９チラシ');
}

// ------------------------------------------------------------
// 配布記録（チラシSS）
// ------------------------------------------------------------

/**
 * チラシSSの配布記録シートに追記する
 * @param {string} flyerName
 * @param {Object} params - {city, address, flyerType, distCount, memberName, distType, source}
 */
function appendDistLogToFlyerSs(flyerName, params) {
  var sheet = _getFlyerSheet(flyerName, '配布記録');
  if (!sheet) {
    Logger.log('appendDistLogToFlyerSs: 配布記録シートなし / ' + flyerName);
    return;
  }
  var lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    // params.datetime が指定されていれば実際の送信日時を使用（履歴取込時）
    // 指定なければ現在時刻（リアルタイム記録時）
    var dt = params.datetime ? new Date(params.datetime) : new Date();
    var nextRow = sheet.getLastRow() + 1;
    sheet.getRange(nextRow, 1, 1, 8).setValues([[
      dt,
      params.city       || '',
      params.address    || '',
      params.flyerType  || flyerName,
      params.distCount  || 0,
      params.memberName || '',
      params.distType   || '町丁目',
      params.source     || 'アプリ手入力'
    ]]);
    sheet.getRange(nextRow, 1).setNumberFormat('yyyy/MM/dd HH:mm');
  } finally {
    lock.releaseLock();
  }
}

/**
 * チラシSSの配布記録を取得する（新しい順）
 * @param {string} flyerName
 * @param {Object} [filter] - {city, limit}
 * @returns {Array}
 */
function getDistLogsFromFlyerSs(flyerName, filter) {
  filter = filter || {};
  var sheet = _getFlyerSheet(flyerName, '配布記録');
  if (!sheet) return [];

  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];

  var data = sheet.getRange(2, 1, lastRow - 1, 8).getValues();
  var results = [];

  for (var i = data.length - 1; i >= 0; i--) {
    var row = data[i];
    if (!row[0]) continue;
    if (filter.city && row[1] !== filter.city) continue;
    results.push({
      datetime:   _formatDatetime(row[0]),
      city:       row[1],
      address:    row[2],
      flyerType:  row[3],
      distCount:  row[4],
      memberName: row[5],
      distType:   row[6],
      source:     row[7]
    });
    if (filter.limit && results.length >= filter.limit) break;
  }
  return results;
}

// ------------------------------------------------------------
// 内部ヘルパー
// ------------------------------------------------------------

/**
 * シートを受け取ってエリア行を探す（_findAreaRow のシート引数版）
 * @param {Sheet} sheet
 * @param {string} city
 * @param {string} town
 * @param {string} chome
 * @returns {number} 行番号（1始まり）、見つからない場合は -1
 */
function _findAreaRowInSheet(sheet, city, town, chome) {
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return -1;

  var data = sheet.getRange(2, 1, lastRow - 1, 3).getValues();
  var chomeStr = String(chome || '');
  var townNorm = _normalizeTownName(town);

  // ① 完全一致（正規化あり）
  for (var i = 0; i < data.length; i++) {
    var rowTown = _normalizeTownName(String(data[i][1] || ''));
    if (data[i][0] === city &&
        rowTown === townNorm &&
        String(data[i][2]) === chomeStr) {
      return i + 2;
    }
  }

  // ② town+chome を結合した形でシートに入っている場合
  if (chomeStr) {
    var combined = townNorm + chomeStr;
    for (var i = 0; i < data.length; i++) {
      var rowTown = _normalizeTownName(String(data[i][1] || ''));
      if (data[i][0] === city &&
          rowTown === combined &&
          String(data[i][2]) === '') {
        return i + 2;
      }
    }
  }

  // ③ town部分一致（chomeを無視）
  var partialMatch = -1;
  for (var i = 0; i < data.length; i++) {
    var rowTown = _normalizeTownName(String(data[i][1] || ''));
    if (data[i][0] === city && rowTown === townNorm) {
      if (partialMatch === -1) partialMatch = i + 2;
    }
  }
  if (partialMatch !== -1) {
    Logger.log('_findAreaRowInSheet 部分一致: ' + city + ' ' + town + ' → row ' + partialMatch);
    return partialMatch;
  }

  // ④ town+chome 結合フル一致
  var prefixMatch = -1;
  for (var i = 0; i < data.length; i++) {
    if (data[i][0] !== city) continue;
    var rowFull = _normalizeTownName(String(data[i][1] || '') + String(data[i][2] || ''));
    var searchFull = townNorm + chomeStr;
    if (rowFull === searchFull) { return i + 2; }
    if (!chomeStr && rowFull.indexOf(townNorm) === 0) {
      if (prefixMatch === -1) prefixMatch = i + 2;
    }
  }
  if (prefixMatch !== -1) {
    Logger.log('_findAreaRowInSheet プレフィックス一致: ' + city + ' ' + town + ' → row ' + prefixMatch);
    return prefixMatch;
  }

  return -1;
}
