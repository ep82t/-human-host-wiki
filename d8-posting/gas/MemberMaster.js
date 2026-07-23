// ============================================================
// MemberMaster.gs — メンバーマスタ CRUD
// ============================================================

/**
 * メンバー一覧を取得する
 * @returns {Array} [{name, color, role}]
 */
function getMemberList() {
  var sheet = getSheet(SHEET_NAMES.MEMBER);
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];

  var data = sheet.getRange(2, 1, lastRow - 1, 3).getValues();
  return data
    .filter(function(row) { return row[0]; })
    .map(function(row) {
      return {
        name:  row[COL_MEMBER.NAME - 1],
        color: row[COL_MEMBER.COLOR - 1] || '#999999',
        role:  row[COL_MEMBER.ROLE - 1] || '一般'
      };
    });
}

/**
 * メンバーを追加する（同名が既にいる場合はスキップ）
 */
function addMember(name, color, role) {
  var sheet = getSheet(SHEET_NAMES.MEMBER);
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    // 重複チェック
    var lastRow = sheet.getLastRow();
    if (lastRow >= 2) {
      var names = sheet.getRange(2, COL_MEMBER.NAME, lastRow - 1, 1).getValues();
      for (var i = 0; i < names.length; i++) {
        if (names[i][0] === name) return { success: false, reason: 'duplicate' };
      }
    }
    sheet.appendRow([name, color || '#4a86e8', role || '一般']);
    return { success: true };
  } finally {
    lock.releaseLock();
  }
}

// ============================================================
// 実行者マスタ（実行者シート）
// ============================================================

/**
 * 実行者シートを取得（なければ作成）
 */
function _getOrCreateExecutorSheet() {
  var ss = getSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_NAMES.EXECUTOR);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAMES.EXECUTOR);
    sheet.appendRow(['名前', '登録日']);
    sheet.getRange(1, 1, 1, 2).setFontWeight('bold').setBackground('#1a237e').setFontColor('#ffffff');
  }
  return sheet;
}

/**
 * 実行者一覧を取得する
 * @returns {string[]} 名前の配列
 */
function getExecutorList() {
  var sheet = _getOrCreateExecutorSheet();
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  return sheet.getRange(2, 1, lastRow - 1, 1).getValues()
    .map(function(r) { return String(r[0]).trim(); })
    .filter(function(n) { return n; });
}

/**
 * 実行者を追加する（重複スキップ）
 */
function addExecutor(name) {
  if (!name || !name.trim()) return;
  var sheet = _getOrCreateExecutorSheet();
  var existing = getExecutorList();
  if (existing.indexOf(name.trim()) !== -1) return; // 重複スキップ
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    sheet.appendRow([name.trim(), Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd')]);
  } finally {
    lock.releaseLock();
  }
}

/**
 * 配布記録・メンバーマスタから実行者を自動収集して実行者シートに保存
 * GASエディタから手動実行 または 自動呼び出し
 */
/**
 * Chatworkの表示名形式（「名前（北海道第8支部/役職）」など）を除外する
 * 実際にポスティングを行った人名のみを残す
 */
function _isChatworkDisplayName(name) {
  if (!name) return false;
  // 「（道8/...）」「（北海道第8支部）」「(第8支部)」のような形式
  return /[（(]/.test(name) && /(支部|道8|第8|支局|北海道)/.test(name);
}

function syncExecutorsFromLogs() {
  var names = {};

  // 配布記録から収集
  try {
    var logSheet = getSheet(SHEET_NAMES.DIST_LOG);
    var lastRow = logSheet.getLastRow();
    if (lastRow >= 2) {
      logSheet.getRange(2, COL_LOG.MEMBER_NAME, lastRow - 1, 1).getValues()
        .forEach(function(r) { if (r[0]) names[String(r[0]).trim()] = true; });
    }
  } catch(e) {}

  // メンバーマスタから収集
  try {
    getMemberList().forEach(function(m) { if (m.name) names[m.name.trim()] = true; });
  } catch(e) {}

  // エリアマスタから収集
  try {
    var areaSheet = getSheet(SHEET_NAMES.AREA_MASTER);
    var aLastRow = areaSheet.getLastRow();
    if (aLastRow >= 2) {
      areaSheet.getRange(2, COL_AREA.MEMBER_NAME, aLastRow - 1, 1).getValues()
        .forEach(function(r) { if (r[0]) names[String(r[0]).trim()] = true; });
    }
  } catch(e) {}

  // Chatwork表示名形式の名前を除外
  var filtered = Object.keys(names).filter(function(n) {
    return n && !_isChatworkDisplayName(n);
  });

  // 既存の実行者シートをクリアして再構築
  var sheet = _getOrCreateExecutorSheet();
  var lastRow2 = sheet.getLastRow();
  if (lastRow2 >= 2) sheet.deleteRows(2, lastRow2 - 1);

  filtered.forEach(function(name) { addExecutor(name); });
  Logger.log('✅ 実行者同期完了: ' + filtered.length + '名（Chatwork表示名を除外済み）');
}

/**
 * 名前でメンバーの表示色を返す
 */
function getMemberColor(name) {
  var members = getMemberList();
  for (var i = 0; i < members.length; i++) {
    if (members[i].name === name) return members[i].color;
  }
  return '#999999';
}

/**
 * 野口有美さんを一般メンバーとして追加する（1回のみ実行）
 * GASエディタから実行: addMember_Noguchi()
 * ファイル: MemberMaster.gs
 */
function addMember_Noguchi() {
  var result = addMember('野口有美', '#4a86e8', '一般');
  if (result.success) {
    Logger.log('✅ メンバー追加完了: 野口有美（一般 / #4a86e8）');
  } else if (result.reason === 'duplicate') {
    Logger.log('⚠️ 既に登録済みです: 野口有美');
  } else {
    Logger.log('❌ 追加失敗: ' + JSON.stringify(result));
  }
}
