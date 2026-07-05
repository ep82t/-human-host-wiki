// ============================================================
// Mansion.gs — マンション台帳 CRUD
// ============================================================

/**
 * マンション一覧を取得する
 * @param {Object} [filter]
 * @param {string} [filter.city]
 * @param {string} [filter.status]  - 配布ステータスフィルター
 * @returns {Array}
 */
function getMansionList(filter) {
  filter = filter || {};
  var sheet = getSheet(SHEET_NAMES.MANSION);
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];

  var data = sheet.getRange(2, 1, lastRow - 1, 10).getValues();
  var results = [];

  for (var i = 0; i < data.length; i++) {
    var row = data[i];
    if (!row[COL_MANSION.NAME - 1]) continue;

    if (filter.city && row[COL_MANSION.CITY - 1] !== filter.city) continue;
    if (filter.status && row[COL_MANSION.STATUS - 1] !== filter.status) continue;

    results.push(_rowToMansion(row, i + 2));
  }

  return results;
}

/**
 * マンションを新規登録する
 * @param {Object} params
 * @returns {Object} {success, id}
 */
function addMansion(params) {
  var sheet = getSheet(SHEET_NAMES.MANSION);
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);

  try {
    // 座標がなければサーバーサイドでジオコーディング
    var lat = params.lat || '';
    var lng = params.lng || '';
    if (!lat || !lng) {
      var query = params.address || (params.name + ' ' + (params.city || '函館市'));
      try {
        var geocoder = Maps.newGeocoder().setLanguage('ja');
        var geoResult = geocoder.geocode(query);
        if (geoResult.status === 'OK' && geoResult.results.length > 0) {
          var loc = geoResult.results[0].geometry.location;
          lat = loc.lat;
          lng = loc.lng;
          Logger.log('ジオコーディング成功: ' + query + ' → ' + lat + ',' + lng);
        } else {
          Logger.log('ジオコーディング失敗: ' + geoResult.status + ' / ' + query);
        }
      } catch (geoErr) {
        Logger.log('ジオコーディングエラー: ' + geoErr.message);
      }
    }

    var nextRow = sheet.getLastRow() + 1;
    sheet.getRange(nextRow, 1, 1, 10).setValues([[
      params.name || '',
      params.address || '',
      params.city || '',
      params.status || MANSION_STATUS.OK,
      params.statusType || '',
      params.lastVisit ? new Date(params.lastVisit) : '',
      params.lastCount || '',
      params.memo || '',
      lat,
      lng
    ]]);

    // 最終訪問日の書式
    if (params.lastVisit) {
      sheet.getRange(nextRow, COL_MANSION.LAST_VISIT)
        .setNumberFormat('yyyy/MM/dd');
    }

    return { success: true, id: nextRow };
  } finally {
    lock.releaseLock();
  }
}

/**
 * マンション情報を更新する
 * @param {number} rowId - 行番号（addMansion で返される id）
 * @param {Object} params
 * @returns {Object} {success}
 */
function updateMansion(rowId, params) {
  var sheet = getSheet(SHEET_NAMES.MANSION);
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);

  try {
    if (rowId < 2) {
      return { success: false, error: '無効な行IDです' };
    }
    // 行が存在するか確認
    var nameCheck = sheet.getRange(rowId, COL_MANSION.NAME).getValue();
    if (!nameCheck) {
      return { success: false, error: 'マンションが見つかりません: row=' + rowId };
    }

    if (params.name != null)       sheet.getRange(rowId, COL_MANSION.NAME).setValue(params.name);
    if (params.address != null)    sheet.getRange(rowId, COL_MANSION.ADDRESS).setValue(params.address);
    if (params.city != null)       sheet.getRange(rowId, COL_MANSION.CITY).setValue(params.city);
    if (params.status != null)     sheet.getRange(rowId, COL_MANSION.STATUS).setValue(params.status);
    if (params.statusType != null) sheet.getRange(rowId, COL_MANSION.STATUS_TYPE).setValue(params.statusType);
    if (params.lastVisit != null) {
      sheet.getRange(rowId, COL_MANSION.LAST_VISIT).setValue(new Date(params.lastVisit));
      sheet.getRange(rowId, COL_MANSION.LAST_VISIT).setNumberFormat('yyyy/MM/dd');
    }
    if (params.lastCount != null)  sheet.getRange(rowId, COL_MANSION.LAST_COUNT).setValue(params.lastCount);
    if (params.memo != null)       sheet.getRange(rowId, COL_MANSION.MEMO).setValue(params.memo);
    if (params.lat != null)        sheet.getRange(rowId, COL_MANSION.LAT).setValue(params.lat);
    if (params.lng != null)        sheet.getRange(rowId, COL_MANSION.LNG).setValue(params.lng);

    return { success: true };
  } finally {
    lock.releaseLock();
  }
}

/**
 * マンション訪問を記録する（ステータス + 枚数 + 日付を一括更新）
 * 同時に配布記録にも追記する
 */
function recordMansionVisit(params) {
  // params: {rowId, status, statusType, distCount, memberName, memo}
  var today = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd');

  var updateResult = updateMansion(params.rowId, {
    status:      params.status,
    statusType:  params.statusType || '',
    lastVisit:   today,
    lastCount:   params.distCount || 0,
    memo:        params.memo
  });

  if (!updateResult.success) return updateResult;

  // 配布OKの場合のみ配布記録に追記
  if (params.status === MANSION_STATUS.OK && params.distCount > 0) {
    var sheet = getSheet(SHEET_NAMES.MANSION);
    var mansionData = sheet.getRange(params.rowId, 1, 1, 3).getValues()[0];
    var mansionName = mansionData[COL_MANSION.NAME - 1];
    var city = mansionData[COL_MANSION.CITY - 1];

    appendDistLog({
      city:       city,
      address:    mansionName,
      flyerType:  params.flyerType || '',
      distCount:  params.distCount,
      memberName: params.memberName || '',
      distType:   'マンション',
      source:     'アプリ手入力'
    });
  }

  return { success: true };
}

// ------------------------------------------------------------
// 内部ヘルパー
// ------------------------------------------------------------

function _rowToMansion(row, rowIndex) {
  return {
    id:         rowIndex,
    name:       row[COL_MANSION.NAME - 1],
    address:    row[COL_MANSION.ADDRESS - 1],
    city:       row[COL_MANSION.CITY - 1],
    status:     row[COL_MANSION.STATUS - 1] || MANSION_STATUS.OK,
    statusType: row[COL_MANSION.STATUS_TYPE - 1],
    lastVisit:  row[COL_MANSION.LAST_VISIT - 1]
      ? Utilities.formatDate(new Date(row[COL_MANSION.LAST_VISIT - 1]), 'Asia/Tokyo', 'yyyy/MM/dd')
      : '',
    lastCount:  row[COL_MANSION.LAST_COUNT - 1] || 0,
    memo:       row[COL_MANSION.MEMO - 1],
    lat:        row[COL_MANSION.LAT - 1] || null,
    lng:        row[COL_MANSION.LNG - 1] || null
  };
}
