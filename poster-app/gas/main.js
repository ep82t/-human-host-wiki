// ========================================
// ポスター管理アプリ - Google Apps Script v2
// （一覧取得・修正・削除 対応版）
// ========================================

var SPREADSHEET_ID = '1y2REf6tQVETw9qfzastIOXlfzJR_I8RFAv6JrwhvVHc'; // スプレッドシートID
var SHEET_NAME = 'ポスター管理';
var HEADERS = [
  '記号', '形態', '許可の有無', '名称', '住所（数字ハイフンは半角）',
  '枚数', '補足', '記入者', '設置者', '設置日', 'ポスター種類',
  '修復・交換日', '入力種別', '入力日時', 'ステータス'
];

// 列番号マップ（1始まり）
var COL = {
  記号: 1, 形態: 2, 許可の有無: 3, 名称: 4, 住所: 5,
  枚数: 6, 補足: 7, 記入者: 8, 設置者: 9,
  設置日: 10, ポスター種類: 11, 修復交換日: 12,
  入力種別: 13, 入力日時: 14, ステータス: 15
};

function getOrCreateSheet() {
  var ss;
  if (SPREADSHEET_ID) {
    ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  } else {
    ss = SpreadsheetApp.create('ポスター管理台帳_' + Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyyMMdd'));
    SPREADSHEET_ID = ss.getId();
  }
  var sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.getSheets()[0];
    sheet.setName(SHEET_NAME);
  }
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(HEADERS);
    var headerRange = sheet.getRange(1, 1, 1, HEADERS.length);
    headerRange.setBackground('#f97316');
    headerRange.setFontColor('#ffffff');
    headerRange.setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
  return sheet;
}

// 日付を安全にフォーマット
function formatDateSafe(val) {
  if (!val) return '';
  try {
    var d = (val instanceof Date) ? val : new Date(val);
    if (isNaN(d.getTime())) return String(val);
    return Utilities.formatDate(d, 'Asia/Tokyo', 'yyyy.MM.dd');
  } catch(e) {
    return String(val);
  }
}

// ── GET: 一覧取得 ──
function doGet(e) {
  var action = e && e.parameter && e.parameter.action;

  // マスターデータ取得
  if (action === 'getMaster') {
    try {
      var ss2 = SpreadsheetApp.openById(SPREADSHEET_ID);
      getOrCreateMasterSheet(ss2, 'ポスター種類');
      getOrCreateMasterSheet(ss2, '担当者');
      var master = getMasterData(ss2);
      return buildResponse({ status:'ok', posterTypes: master.posterTypes, members: master.members });
    } catch(err) {
      return buildResponse({ error: err.toString() });
    }
  }

  if (action === 'getAll') {
    try {
      var sheet = getOrCreateSheet();
      var lastRow = sheet.getLastRow();
      var result = { rows: [] };

      if (lastRow <= 1) {
        return buildResponse(result);
      }

      var data = sheet.getRange(2, 1, lastRow - 1, HEADERS.length).getValues();

      data.forEach(function(row, i) {
        if (row.every(function(cell) { return cell === '' || cell === null; })) return;
        result.rows.push({
          _rowIndex: i + 2, // 実際の行番号（1ヘッダー + 1始まり）
          記号: row[0],
          形態: row[1],
          許可の有無: row[2],
          名称: row[3],
          住所: row[4],
          枚数: row[5],
          補足: row[6],
          記入者: row[7],
          設置者: row[8],
          設置日: formatDateSafe(row[9]),
          ポスター種類: row[10],
          '修復・交換日': formatDateSafe(row[11]),
          入力種別: row[12],
          入力日時: row[13],
          ステータス: row[14] || '正常',
        });
      });

      // 新しい順に並べ替え
      result.rows.reverse();
      return buildResponse(result);

    } catch(err) {
      return buildResponse({ error: err.toString() });
    }
  }

  // デフォルト（動作確認用）
  return buildResponse({ status: 'ok', message: 'ポスター管理GASは正常に動作しています（v2）' });
}

// ── POST: 追加・修正・削除 ──
function doPost(e) {
  var result = { status: 'ok' };
  try {
    var data = JSON.parse(e.postData.contents);
    var sheet = getOrCreateSheet();
    var now = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy/MM/dd HH:mm:ss');

    // マスターデータ追加
    if (data.action === 'addMaster') {
      var ss3 = SpreadsheetApp.openById(SPREADSHEET_ID);
      var sn = data.listKey === 'posterTypes' ? 'ポスター種類' : '担当者';
      addMasterItem(ss3, sn, data.value);
      result.message = '追加しました';
      return buildResponse(result);
    }

    // マスターデータ削除
    if (data.action === 'deleteMaster') {
      var ss4 = SpreadsheetApp.openById(SPREADSHEET_ID);
      var sn2 = data.listKey === 'posterTypes' ? 'ポスター種類' : '担当者';
      deleteMasterItem(ss4, sn2, data.value);
      result.message = '削除しました';
      return buildResponse(result);
    }

    // 削除
    if (data.action === 'delete') {
      sheet.deleteRow(parseInt(data.rowIndex));
      result.message = '削除しました';
      return buildResponse(result);
    }

    // 修正
    if (data.action === 'update') {
      var rowIndex = parseInt(data.rowIndex);
      var installDate = data.installDate ? data.installDate.replace(/-/g, '.') : '';
      var repairDate = data.repairDate ? data.repairDate.replace(/-/g, '.') : '';
      sheet.getRange(rowIndex, COL.形態).setValue(data.type || '');
      sheet.getRange(rowIndex, COL.許可の有無).setValue(data.permission || '');
      sheet.getRange(rowIndex, COL.名称).setValue(data.name || '');
      sheet.getRange(rowIndex, COL.住所).setValue(data.address || '');
      sheet.getRange(rowIndex, COL.枚数).setValue(data.count || '0');
      sheet.getRange(rowIndex, COL.補足).setValue(data.notes || '');
      sheet.getRange(rowIndex, COL.記入者).setValue(data.recorder || '');
      sheet.getRange(rowIndex, COL.設置者).setValue(data.installer || '');
      sheet.getRange(rowIndex, COL.設置日).setValue(installDate);
      sheet.getRange(rowIndex, COL.ポスター種類).setValue(data.posterType || '');
      sheet.getRange(rowIndex, COL.修復交換日).setValue(repairDate);
      sheet.getRange(rowIndex, COL.入力日時).setValue(now + '（修正）');
      if (data.status) sheet.getRange(rowIndex, COL.ステータス).setValue(data.status);
      result.message = '修正しました';
      return buildResponse(result);
    }

    // 新規追加（新規貼付 or 修復・貼替）
    var installDate = data.installDate ? data.installDate.replace(/-/g, '.') : '';
    var repairDate = data.repairDate ? data.repairDate.replace(/-/g, '.') : '';
    var modeLabel = data.mode === 'new' ? '新規貼付' : '修正・貼替';
    var row = [
      '',
      data.type || '',
      data.permission || '',
      data.name || '',
      data.address || '',
      data.count || '0',
      data.notes || '',
      data.recorder || '',
      data.installer || '',
      installDate,
      data.posterType || '',
      repairDate,
      modeLabel,
      now,
      data.status || '正常'
    ];
    sheet.appendRow(row);
    if (sheet.getLastRow() <= 2) sheet.autoResizeColumns(1, HEADERS.length);
    result.message = '追加しました: ' + data.address;

  } catch(err) {
    result.status = 'error';
    result.message = err.toString();
  }
  return buildResponse(result);
}

function buildResponse(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

// ── マスターシート作成 ──
function getOrCreateMasterSheet(ss, sheetName) {
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
    sheet.getRange(1,1).setValue('名前');
    sheet.getRange(1,1).setBackground('#f97316').setFontColor('#ffffff').setFontWeight('bold');
  }
  return sheet;
}

// ── マスターデータ取得 ──
function getMasterData(ss) {
  var result = { posterTypes: [], members: [] };
  var ptSheet = ss.getSheetByName('ポスター種類');
  var mbSheet = ss.getSheetByName('担当者');
  if (ptSheet && ptSheet.getLastRow() > 1) {
    result.posterTypes = ptSheet.getRange(2,1,ptSheet.getLastRow()-1,1).getValues()
      .map(function(r){ return r[0]; }).filter(function(v){ return v; });
  }
  if (mbSheet && mbSheet.getLastRow() > 1) {
    result.members = mbSheet.getRange(2,1,mbSheet.getLastRow()-1,1).getValues()
      .map(function(r){ return r[0]; }).filter(function(v){ return v; });
  }
  return result;
}

// ── マスターデータ追加 ──
function addMasterItem(ss, sheetName, value) {
  var sheet = getOrCreateMasterSheet(ss, sheetName);
  var existing = sheet.getLastRow() > 1
    ? sheet.getRange(2,1,sheet.getLastRow()-1,1).getValues().map(function(r){return r[0];})
    : [];
  if (existing.indexOf(value) === -1) sheet.appendRow([value]);
}

// ── マスターデータ削除 ──
function deleteMasterItem(ss, sheetName, value) {
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet || sheet.getLastRow() <= 1) return;
  var values = sheet.getRange(2,1,sheet.getLastRow()-1,1).getValues();
  for (var i = values.length-1; i >= 0; i--) {
    if (values[i][0] === value) { sheet.deleteRow(i+2); break; }
  }
}
