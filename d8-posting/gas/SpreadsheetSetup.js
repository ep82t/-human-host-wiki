// ============================================================
// SpreadsheetSetup.gs — スプレッドシートの初期構築
// ============================================================

/**
 * 全シートを初期化する（既存シートが存在する場合はスキップ）
 * GASエディタから手動実行する
 */
function setupSpreadsheet() {
  var ss = getSpreadsheet();
  setupAreaMasterSheet(ss);
  setupDistLogSheet(ss);
  setupMansionSheet(ss);
  setupMemberSheet(ss);
  Logger.log('スプレッドシートの初期化が完了しました。');
}

// ------------------------------------------------------------
// シート1：エリアマスタ
// ------------------------------------------------------------
function setupAreaMasterSheet(ss) {
  var sheet = ss.getSheetByName(SHEET_NAMES.AREA_MASTER);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAMES.AREA_MASTER);
  }

  var headers = [
    '市町村名', '町名', '丁目', '世帯数',
    'ステータス', 'チラシ種別', '配布枚数',
    '実施者名', '実施日', 'メモ', '緯度', '経度'
  ];
  _writeHeaders(sheet, headers);
  _formatAreaMasterSheet(sheet);
  Logger.log('エリアマスタシート: 初期化完了');
}

function _formatAreaMasterSheet(sheet) {
  // ヘッダー行の書式設定
  var header = sheet.getRange(1, 1, 1, 12);
  header.setBackground('#4a86e8');
  header.setFontColor('#ffffff');
  header.setFontWeight('bold');

  // ステータス列のデータ入力規則
  var statusRule = SpreadsheetApp.newDataValidation()
    .requireValueInList(['未着手', '配布済み', '未配布', '再訪'], true)
    .build();
  sheet.getRange(2, COL_AREA.STATUS, 1000, 1).setDataValidation(statusRule);

  // 列幅設定
  sheet.setColumnWidth(COL_AREA.CITY, 80);
  sheet.setColumnWidth(COL_AREA.TOWN, 120);
  sheet.setColumnWidth(COL_AREA.CHOME, 60);
  sheet.setColumnWidth(COL_AREA.HOUSEHOLDS, 70);
  sheet.setColumnWidth(COL_AREA.STATUS, 80);
  sheet.setColumnWidth(COL_AREA.FLYER_TYPE, 100);
  sheet.setColumnWidth(COL_AREA.DIST_COUNT, 80);
  sheet.setColumnWidth(COL_AREA.MEMBER_NAME, 90);
  sheet.setColumnWidth(COL_AREA.DIST_DATE, 90);
  sheet.setColumnWidth(COL_AREA.MEMO, 200);

  sheet.setFrozenRows(1);
}

// ------------------------------------------------------------
// シート2：配布記録
// ------------------------------------------------------------
function setupDistLogSheet(ss) {
  var sheet = ss.getSheetByName(SHEET_NAMES.DIST_LOG);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAMES.DIST_LOG);
  }

  var headers = [
    '日時', '市町村名', '住所', 'チラシ種別',
    '配布枚数', '実施者名', '配布区分', '入力元'
  ];
  _writeHeaders(sheet, headers);

  var header = sheet.getRange(1, 1, 1, 8);
  header.setBackground('#0f9d58');
  header.setFontColor('#ffffff');
  header.setFontWeight('bold');

  sheet.setColumnWidth(COL_LOG.DATETIME, 140);
  sheet.setColumnWidth(COL_LOG.CITY, 80);
  sheet.setColumnWidth(COL_LOG.ADDRESS, 150);
  sheet.setColumnWidth(COL_LOG.FLYER_TYPE, 100);
  sheet.setColumnWidth(COL_LOG.DIST_COUNT, 80);
  sheet.setColumnWidth(COL_LOG.MEMBER_NAME, 90);
  sheet.setColumnWidth(COL_LOG.DIST_TYPE, 90);
  sheet.setColumnWidth(COL_LOG.SOURCE, 120);

  sheet.setFrozenRows(1);
  Logger.log('配布記録シート: 初期化完了');
}

// ------------------------------------------------------------
// シート3：マンション台帳
// ------------------------------------------------------------
function setupMansionSheet(ss) {
  var sheet = ss.getSheetByName(SHEET_NAMES.MANSION);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAMES.MANSION);
  }

  var headers = [
    'マンション名', '住所', '市町村名',
    '配布ステータス', 'ステータス種別',
    '最終訪問日', '最終配布枚数', 'メモ', '緯度', '経度'
  ];
  _writeHeaders(sheet, headers);

  var header = sheet.getRange(1, 1, 1, 10);
  header.setBackground('#e69138');
  header.setFontColor('#ffffff');
  header.setFontWeight('bold');

  // ステータス入力規則
  var statusRule = SpreadsheetApp.newDataValidation()
    .requireValueInList(['配布OK', 'オートロックNG', '管理人NG', 'お断り貼り紙あり'], true)
    .build();
  sheet.getRange(2, COL_MANSION.STATUS, 1000, 1).setDataValidation(statusRule);

  var typeRule = SpreadsheetApp.newDataValidation()
    .requireValueInList(['永続NG', '状況次第'], true)
    .build();
  sheet.getRange(2, COL_MANSION.STATUS_TYPE, 1000, 1).setDataValidation(typeRule);

  sheet.setColumnWidth(COL_MANSION.NAME, 160);
  sheet.setColumnWidth(COL_MANSION.ADDRESS, 200);
  sheet.setColumnWidth(COL_MANSION.CITY, 80);
  sheet.setColumnWidth(COL_MANSION.STATUS, 130);
  sheet.setColumnWidth(COL_MANSION.STATUS_TYPE, 90);
  sheet.setColumnWidth(COL_MANSION.LAST_VISIT, 90);
  sheet.setColumnWidth(COL_MANSION.LAST_COUNT, 90);
  sheet.setColumnWidth(COL_MANSION.MEMO, 200);

  sheet.setFrozenRows(1);
  Logger.log('マンション台帳シート: 初期化完了');
}

// ------------------------------------------------------------
// シート4：メンバーマスタ
// ------------------------------------------------------------
function setupMemberSheet(ss) {
  var sheet = ss.getSheetByName(SHEET_NAMES.MEMBER);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAMES.MEMBER);
  }

  var headers = ['名前', '表示色', '役割'];
  _writeHeaders(sheet, headers);

  var header = sheet.getRange(1, 1, 1, 3);
  header.setBackground('#9c27b0');
  header.setFontColor('#ffffff');
  header.setFontWeight('bold');

  var roleRule = SpreadsheetApp.newDataValidation()
    .requireValueInList(['管理者', '一般'], true)
    .build();
  sheet.getRange(2, COL_MEMBER.ROLE, 100, 1).setDataValidation(roleRule);

  sheet.setColumnWidth(COL_MEMBER.NAME, 100);
  sheet.setColumnWidth(COL_MEMBER.COLOR, 80);
  sheet.setColumnWidth(COL_MEMBER.ROLE, 70);

  sheet.setFrozenRows(1);
  Logger.log('メンバーマスタシート: 初期化完了');
}

// ------------------------------------------------------------
// 共通ユーティリティ
// ------------------------------------------------------------
function _writeHeaders(sheet, headers) {
  var existing = sheet.getRange(1, 1, 1, headers.length).getValues()[0];
  var hasHeaders = existing.some(function(v) { return v !== ''; });
  if (hasHeaders) {
    return; // ヘッダーが既にある場合はスキップ
  }
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
}
