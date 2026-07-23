// ============================================================
// StoreSetup.gs — チラシ店舗設置の管理
// #店舗設置 タグ付きChatworkメッセージを解析・保存・提供
// ============================================================

/**
 * 店舗設置シートを取得（なければ作成）
 */
function _getOrCreateStoreSheet() {
  var ss    = getSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_NAMES.STORE);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAMES.STORE);
    sheet.appendRow(['店舗名','住所','市町村','設置枚数','設置者名','設置日','緯度','経度','メモ','メッセージID']);
    sheet.getRange(1, 1, 1, 10)
      .setFontWeight('bold')
      .setBackground('#1a237e')
      .setFontColor('#ffffff');
    sheet.setFrozenRows(1);
  }
  return sheet;
}

/**
 * 店舗設置データを追加する
 * @param {Object} params - {name, address, city, count, memberName, date, lat, lng, memo, msgId}
 */
function addStoreSetup(params) {
  var sheet = _getOrCreateStoreSheet();
  var lock  = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    // 同じメッセージIDがあればスキップ（重複防止）
    if (params.msgId) {
      var lastRow = sheet.getLastRow();
      if (lastRow >= 2) {
        var ids = sheet.getRange(2, COL_STORE.MSG_ID, lastRow - 1, 1).getValues();
        for (var i = 0; i < ids.length; i++) {
          if (String(ids[i][0]) === String(params.msgId)) {
            return { success: false, reason: 'duplicate' };
          }
        }
      }
    }
    sheet.appendRow([
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
    ]);
    return { success: true };
  } finally {
    lock.releaseLock();
  }
}

/**
 * 店舗設置一覧を取得する
 * @returns {Array} [{name, address, city, count, memberName, date, lat, lng, memo}]
 */
function getStoreList() {
  var sheet   = _getOrCreateStoreSheet();
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];

  var rows = sheet.getRange(2, 1, lastRow - 1, 9).getValues();
  var result = [];
  rows.forEach(function(r, i) {
    if (!r[COL_STORE.NAME - 1]) return;
    result.push({
      rowNum:     i + 2,   // スプレッドシートの実際の行番号
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

/**
 * 店舗情報を更新する
 * @param {number} rowNum - シートの行番号
 * @param {Object} params - {name, address, city, count, memberName, memo}
 */
function updateStoreRow(rowNum, params) {
  if (!rowNum || rowNum < 2) return { success: false, error: '行番号が不正です' };
  var sheet = _getOrCreateStoreSheet();
  var lock  = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    if (params.name       !== undefined) sheet.getRange(rowNum, COL_STORE.NAME   ).setValue(params.name);
    if (params.address    !== undefined) sheet.getRange(rowNum, COL_STORE.ADDRESS ).setValue(params.address);
    if (params.city       !== undefined) sheet.getRange(rowNum, COL_STORE.CITY   ).setValue(params.city);
    if (params.count      !== undefined) sheet.getRange(rowNum, COL_STORE.COUNT  ).setValue(params.count);
    if (params.memberName !== undefined) sheet.getRange(rowNum, COL_STORE.MEMBER ).setValue(params.memberName);
    if (params.memo       !== undefined) sheet.getRange(rowNum, COL_STORE.MEMO   ).setValue(params.memo);

    // 市町村が更新された場合、住所を再ジオコーディング
    if (params.city || params.address) {
      var name    = sheet.getRange(rowNum, COL_STORE.NAME   ).getValue();
      var address = params.address || sheet.getRange(rowNum, COL_STORE.ADDRESS).getValue();
      var city    = params.city    || sheet.getRange(rowNum, COL_STORE.CITY   ).getValue();
      var query   = address ? (city ? city + address : address) : name;
      if (query) {
        try {
          var geo = Maps.newGeocoder().setLanguage('ja').geocode(query + ' 北海道');
          if (geo.status === 'OK' && geo.results.length > 0) {
            var loc = geo.results[0].geometry.location;
            sheet.getRange(rowNum, COL_STORE.LAT).setValue(loc.lat);
            sheet.getRange(rowNum, COL_STORE.LNG).setValue(loc.lng);
          }
        } catch(e) { Logger.log('再ジオコーディング失敗: ' + e.message); }
      }
    }
    return { success: true };
  } catch(e) {
    return { success: false, error: e.message };
  } finally {
    lock.releaseLock();
  }
}

/**
 * #店舗設置 メッセージを解析してジオコーディングし保存する
 * @param {string} body       - メッセージ本文
 * @param {string} senderName - 送信者名
 * @param {number} sendTime   - Unixタイムスタンプ
 * @param {string} msgId      - メッセージID
 * @returns {Object} {success, name, address}
 */
/**
 * #店舗設置 メッセージを解析してジオコーディングし保存する（複数店舗対応）
 * @param {string} body       - メッセージ本文
 * @param {string} senderName - 送信者名
 * @param {number} sendTime   - Unixタイムスタンプ
 * @param {string} msgId      - メッセージID（重複防止に使用、複数店舗は _1 _2 を付与）
 * @returns {Object} {success, count:登録件数, names:[], error}
 */
function processStoreSetupMessage(body, senderName, sendTime, msgId) {
  var parsedList = parseStoreSetupMessage(body);

  // エラーの場合
  if (!Array.isArray(parsedList)) {
    if (parsedList && parsedList.error) return { success: false, error: parsedList.error };
    return { success: false, error: '解析結果が不正です' };
  }

  if (parsedList.length === 0) {
    return { success: false, reason: 'no_stores', error: '設置店舗が見つかりませんでした' };
  }

  var date = Utilities.formatDate(
    new Date((sendTime || 0) * 1000), 'Asia/Tokyo', 'yyyy-MM-dd'
  );

  var registeredNames = [];
  var duplicateCount  = 0;

  parsedList.forEach(function(parsed, idx) {
    var memberName = parsed.memberName || senderName || '';

    // 複数店舗の場合はmsgIdにインデックスを付与して重複チェック
    var storeMsgId = parsedList.length > 1
      ? (msgId + '_' + idx)
      : msgId;

    // 住所をジオコーディング
    var lat = null, lng = null;
    var query = parsed.address || parsed.name;
    if (query) {
      try {
        var geocoder  = Maps.newGeocoder().setLanguage('ja');
        var geoResult = geocoder.geocode(query + ' 北海道');
        if (geoResult.status === 'OK' && geoResult.results.length > 0) {
          var loc = geoResult.results[0].geometry.location;
          lat = loc.lat;
          lng = loc.lng;
        }
      } catch (e) {
        Logger.log('ジオコーディング失敗 [' + parsed.name + ']: ' + e.message);
      }
    }

    var result = addStoreSetup({
      name:       parsed.name,
      address:    parsed.address,
      city:       parsed.city,
      count:      parsed.count,
      memberName: memberName,
      date:       date,
      lat:        lat,
      lng:        lng,
      memo:       parsed.memo,
      msgId:      storeMsgId
    });

    if (result.success) {
      registeredNames.push(parsed.name);
      Logger.log('✅ 店舗設置登録: ' + parsed.name + ' / ' + parsed.address + ' / ' + parsed.count + '枚');
    } else if (result.reason === 'duplicate') {
      duplicateCount++;
      Logger.log('⏭ 重複スキップ: ' + parsed.name);
    } else {
      Logger.log('❌ 登録失敗: ' + parsed.name + ' / ' + (result.error || ''));
    }
  });

  // 全件重複の場合
  if (registeredNames.length === 0 && duplicateCount === parsedList.length) {
    return { success: false, reason: 'duplicate', name: parsedList[0].name };
  }

  return {
    success: registeredNames.length > 0,
    count:   registeredNames.length,
    names:   registeredNames,
    name:    registeredNames[0] || parsedList[0].name  // 後方互換
  };
}
