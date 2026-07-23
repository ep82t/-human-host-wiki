// ============================================================
// DistributionLog.gs — 配布記録 CRUD
// ============================================================

/**
 * 配布記録を追記する
 * @param {Object} params
 * @param {string} params.city         - 市町村名
 * @param {string} params.address      - 住所（町丁目名 or マンション名）
 * @param {string} params.flyerType    - チラシ種別
 * @param {number} params.distCount    - 配布枚数
 * @param {string} params.memberName   - 実施者名
 * @param {string} params.distType     - '町丁目' or 'マンション'
 * @param {string} params.source       - 'Chatwork自動' or 'アプリ手入力'
 * @returns {Object} {success, row}
 */
function appendDistLog(params) {
  var sheet = getSheet(SHEET_NAMES.DIST_LOG);
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);

  try {
    var now = new Date();
    var nextRow = sheet.getLastRow() + 1;

    sheet.getRange(nextRow, 1, 1, 8).setValues([[
      now,
      params.city || '',
      params.address || '',
      params.flyerType || '',
      params.distCount || 0,
      params.memberName || '',
      params.distType || '町丁目',
      params.source || 'アプリ手入力'
    ]]);

    // 日時列の書式設定
    sheet.getRange(nextRow, COL_LOG.DATETIME)
      .setNumberFormat('yyyy/MM/dd HH:mm');

    return { success: true, row: nextRow };
  } finally {
    lock.releaseLock();
  }
}

/**
 * 配布記録の一覧を取得する
 * @param {Object} [filter]
 * @param {string} [filter.city]
 * @param {number} [filter.limit] - 取得件数（新しい順）
 * @returns {Array}
 */
function getDistLogs(filter) {
  filter = filter || {};
  var sheet = getSheet(SHEET_NAMES.DIST_LOG);
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];

  var data = sheet.getRange(2, 1, lastRow - 1, 8).getValues();
  var results = [];

  // 新しい順（逆順）で処理
  for (var i = data.length - 1; i >= 0; i--) {
    var row = data[i];
    if (!row[COL_LOG.DATETIME - 1]) continue;

    if (filter.city && row[COL_LOG.CITY - 1] !== filter.city) continue;

    results.push({
      datetime:   _formatDatetime(row[COL_LOG.DATETIME - 1]),
      city:       row[COL_LOG.CITY - 1],
      address:    row[COL_LOG.ADDRESS - 1],
      flyerType:  row[COL_LOG.FLYER_TYPE - 1],
      distCount:  row[COL_LOG.DIST_COUNT - 1],
      memberName: row[COL_LOG.MEMBER_NAME - 1],
      distType:   row[COL_LOG.DIST_TYPE - 1],
      source:     row[COL_LOG.SOURCE - 1]
    });

    if (filter.limit && results.length >= filter.limit) break;
  }

  return results;
}

/**
 * 配布記録の重複行を確認する（ドライラン）
 * 同じ「市町村+住所+チラシ種別+枚数+実施者+ソース」が複数ある行を表示
 */
function checkDuplicateLogs() {
  var sheet = getSheet(SHEET_NAMES.DIST_LOG);
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) { Logger.log('記録なし'); return; }

  var data = sheet.getRange(2, 1, lastRow - 1, 8).getValues();
  var seen = {};
  var dupCount = 0;

  data.forEach(function(row, i) {
    // city + address + flyerType + distCount + memberName + source をキーに
    var key = [row[1], row[2], row[3], row[4], row[5], row[7]].join('|');
    if (!seen[key]) {
      seen[key] = [];
    }
    seen[key].push(i + 2); // 実際の行番号（ヘッダー除く）
  });

  Object.keys(seen).forEach(function(key) {
    if (seen[key].length > 1) {
      dupCount++;
      var parts = key.split('|');
      Logger.log('⚠️ 重複 ' + seen[key].length + '件 [行: ' + seen[key].join(', ') + '] ' +
        parts[0] + ' ' + parts[1] + ' ' + parts[2] + ' ' + parts[3] + '枚 ' + parts[4]);
    }
  });

  if (dupCount === 0) {
    Logger.log('✅ 重複なし（全 ' + (lastRow - 1) + '件チェック済み）');
  } else {
    Logger.log('重複グループ数: ' + dupCount + '件　→ removeDuplicateLogs() で削除できます');
  }
}

/**
 * 配布記録の重複行を削除する（後から追加された行を残し、最初の行を削除）
 * 必ず checkDuplicateLogs() で内容確認してから実行すること
 */
function removeDuplicateLogs() {
  var sheet = getSheet(SHEET_NAMES.DIST_LOG);
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) { Logger.log('記録なし'); return; }

  var data = sheet.getRange(2, 1, lastRow - 1, 8).getValues();
  var seen = {};
  var deleteRows = []; // 削除する行番号（降順で削除するため）

  data.forEach(function(row, i) {
    var key = [row[1], row[2], row[3], row[4], row[5], row[7]].join('|');
    if (seen[key] !== undefined) {
      // 重複：古い方（seen[key]）を削除候補に
      deleteRows.push(seen[key]);
      seen[key] = i + 2;
    } else {
      seen[key] = i + 2;
    }
  });

  // 降順に削除（行番号がずれないよう）
  deleteRows.sort(function(a, b) { return b - a; });
  deleteRows.forEach(function(rowNum) {
    sheet.deleteRow(rowNum);
  });

  Logger.log('✅ 重複削除完了: ' + deleteRows.length + '行削除（残り ' + (lastRow - 1 - deleteRows.length) + '件）');
}

/**
 * エリアマスタの配布枚数を配布記録シートから再計算して正しい値に上書きする
 * ※ removeDuplicateLogs() で重複削除後に実行すること
 */
function recalcAreaMasterFromLogs() {
  var logSheet  = getSheet(SHEET_NAMES.DIST_LOG);
  var areaSheet = getSheet(SHEET_NAMES.AREA_MASTER);

  var lastLogRow  = logSheet.getLastRow();
  var lastAreaRow = areaSheet.getLastRow();
  if (lastLogRow  < 2) { Logger.log('配布記録なし'); return; }
  if (lastAreaRow < 2) { Logger.log('エリアマスタなし'); return; }

  // ── 配布記録を読み込んで city+addr ごとに集計 ──────────────
  var logData = logSheet.getRange(2, 1, lastLogRow - 1, 8).getValues();
  var accumMap = {}; // key: "city|addr" → {count, flyerType, memberName, latestDate}

  logData.forEach(function(row) {
    var distType = String(row[6] || '').trim();
    if (distType === 'マンション') return; // マンションはエリアマスタ対象外

    var city   = String(row[1] || '').trim();
    var addr   = String(row[2] || '').trim();
    var flyer  = String(row[3] || '').trim();
    var count  = parseInt(row[4], 10) || 0;
    var member = String(row[5] || '').trim();
    var date   = row[0]; // Date or ''

    if (!city || !addr || count === 0) return;

    var key = city + '|' + addr;
    if (!accumMap[key]) {
      accumMap[key] = { count: 0, flyerType: flyer, memberName: member, latestDate: null };
    }
    accumMap[key].count += count;
    // 最新日時のチラシ種別・実施者を採用
    if (!accumMap[key].latestDate || (date && date > accumMap[key].latestDate)) {
      accumMap[key].flyerType  = flyer;
      accumMap[key].memberName = member;
      accumMap[key].latestDate = date;
    }
  });

  // ── エリアマスタを一括更新 ─────────────────────────────────
  var areaData    = areaSheet.getRange(2, 1, lastAreaRow - 1, 10).getValues();
  var numRows     = areaData.length;

  var distCountVals = [];
  var flyerTypeVals = [];
  var memberVals    = [];
  var statusVals    = [];
  var updated = 0, reset = 0;

  areaData.forEach(function(row) {
    var city      = String(row[COL_AREA.CITY        - 1] || '').trim();
    var town      = String(row[COL_AREA.TOWN        - 1] || '').trim();
    var chome     = String(row[COL_AREA.CHOME       - 1] || '').trim();
    var curStatus = String(row[COL_AREA.STATUS      - 1] || '').trim();
    var curFlyer  = String(row[COL_AREA.FLYER_TYPE  - 1] || '').trim();
    var curMember = String(row[COL_AREA.MEMBER_NAME - 1] || '').trim();

    var key   = city + '|' + (town + chome);
    var accum = accumMap[key];

    if (accum) {
      distCountVals.push([accum.count]);
      flyerTypeVals.push([accum.flyerType  || curFlyer]);
      memberVals.push([accum.memberName || curMember]);
      statusVals.push(['配布済み']);
      updated++;
    } else {
      // 配布記録なし → 枚数を0にリセット
      distCountVals.push([0]);
      flyerTypeVals.push([curFlyer]);  // flyerTypeはそのまま保持
      memberVals.push([curMember]);
      // 「配布済み」だったものを「未着手」に戻す（新聞折り込み以外）
      if (curStatus === '配布済み') {
        statusVals.push(['未着手']);
        reset++;
      } else {
        statusVals.push([curStatus]);
      }
    }
  });

  // バッチ書き込み（一括で高速）
  areaSheet.getRange(2, COL_AREA.DIST_COUNT,  numRows, 1).setValues(distCountVals);
  areaSheet.getRange(2, COL_AREA.FLYER_TYPE,  numRows, 1).setValues(flyerTypeVals);
  areaSheet.getRange(2, COL_AREA.MEMBER_NAME, numRows, 1).setValues(memberVals);
  areaSheet.getRange(2, COL_AREA.STATUS,      numRows, 1).setValues(statusVals);

  Logger.log('✅ エリアマスタ再計算完了');
  Logger.log('  配布済み更新: ' + updated + '行');
  Logger.log('  枚数リセット: ' + reset + '行（未着手に変更）');
  Logger.log('  配布記録の合計を正しく反映しました');
}

function _formatDatetime(val) {
  if (!val) return '';
  try {
    return Utilities.formatDate(new Date(val), 'Asia/Tokyo', 'yyyy/MM/dd HH:mm');
  } catch (e) {
    return String(val);
  }
}
