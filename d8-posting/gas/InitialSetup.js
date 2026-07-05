// ============================================================
// InitialSetup.gs — 初期設定・確認用の便利関数集
// GASエディタから手動実行してください
// ============================================================

/**
 * 進捗色の5段階テスト用データを投入する
 * 5エリアに異なる配布枚数を設定して色の変化を確認する
 * テスト後は clearTestData() で元に戻せる
 */
function insertTestProgressData() {
  var sheet = getSheet(SHEET_NAMES.AREA_MASTER);
  var data = sheet.getRange(2, 1, sheet.getLastRow() - 1, 4).getValues();
  var today = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd');

  // 世帯数が多いエリアを5つ選んでテスト
  var targets = [];
  for (var i = 0; i < data.length && targets.length < 5; i++) {
    var h = parseInt(data[i][3], 10);
    if (h >= 200) targets.push({ row: i + 2, households: h, town: data[i][1] + (data[i][2] || '') });
  }

  // 各エリアに10% / 25% / 50% / 70% / 90% 相当の枚数を設定
  var pcts = [0.10, 0.25, 0.50, 0.70, 0.90];
  targets.forEach(function(t, idx) {
    var count = Math.round(t.households * pcts[idx]);
    sheet.getRange(t.row, COL_AREA.DIST_COUNT).setValue(count);
    sheet.getRange(t.row, COL_AREA.STATUS).setValue('配布済み');
    sheet.getRange(t.row, COL_AREA.DIST_DATE).setValue(today);
    sheet.getRange(t.row, COL_AREA.MEMBER_NAME).setValue('テスト');
    Logger.log(t.town + ': ' + count + '枚 (' + Math.round(pcts[idx] * 100) + '%)');
  });
  Logger.log('テストデータ投入完了。アプリをリロードして色の変化を確認してください。');
}

/**
 * テストデータをクリアする
 */
function clearTestData() {
  var sheet = getSheet(SHEET_NAMES.AREA_MASTER);
  var lastRow = sheet.getLastRow();
  var data = sheet.getRange(2, COL_AREA.MEMBER_NAME, lastRow - 1, 1).getValues();
  var cleared = 0;
  for (var i = 0; i < data.length; i++) {
    if (data[i][0] === 'テスト') {
      var row = i + 2;
      sheet.getRange(row, COL_AREA.STATUS).setValue('未着手');
      sheet.getRange(row, COL_AREA.DIST_COUNT).setValue('');
      sheet.getRange(row, COL_AREA.MEMBER_NAME).setValue('');
      sheet.getRange(row, COL_AREA.DIST_DATE).setValue('');
      cleared++;
    }
  }
  Logger.log('クリア完了: ' + cleared + '件');
}

/**
 * スプレッドシートの実データを確認する（デバッグ用）
 * エリアマスタの最初の10行を表示する
 */
function debugAreaData() {
  var sheet = getSheet(SHEET_NAMES.AREA_MASTER);
  var lastRow = sheet.getLastRow();
  Logger.log('総行数: ' + (lastRow - 1) + '件');

  var data = sheet.getRange(2, 1, Math.min(10, lastRow - 1), 4).getValues();
  data.forEach(function(row, i) {
    Logger.log('行' + (i + 2) + ': 市=' + row[0] + ' | 町=' + row[1] + ' | 丁目=[' + row[2] + '] | 世帯=' + row[3]);
  });

  // 丁目がある行数を集計
  var allData = sheet.getRange(2, 1, lastRow - 1, 3).getValues();
  var withChome = allData.filter(function(r) { return r[2] !== ''; }).length;
  Logger.log('丁目あり: ' + withChome + '件 / 丁目なし: ' + (allData.length - withChome) + '件');
}

/**
 * 【最初に実行】セットアップ状況を確認する
 * 何が設定済みで何が未設定かをログに表示する
 */
function checkSetup() {
  Logger.log('=== セットアップ確認 ===');

  // スクリプトプロパティ確認
  var props = PropertiesService.getScriptProperties().getProperties();
  var keys = [
    'SPREADSHEET_ID', 'MAPS_API_KEY', 'CLAUDE_API_KEY',
    'CHATWORK_TOKEN', 'CHATWORK_ROOM_ID'
  ];
  keys.forEach(function(k) {
    var val = props[k];
    Logger.log((val ? '✅' : '❌') + ' ' + k + (val ? ': 設定済み' : ': 未設定'));
  });

  // シート確認
  Logger.log('--- シート確認 ---');
  try {
    var ss = getSpreadsheet();
    ['エリアマスタ', '配布記録', 'マンション台帳', 'メンバーマスタ'].forEach(function(name) {
      var sheet = ss.getSheetByName(name);
      if (sheet) {
        Logger.log('✅ ' + name + '（' + (sheet.getLastRow() - 1) + '件）');
      } else {
        Logger.log('❌ ' + name + '（シートなし）');
      }
    });
  } catch(e) {
    Logger.log('❌ スプレッドシートへのアクセス失敗: ' + e.message);
  }

  // WebアプリURL
  Logger.log('--- WebアプリURL ---');
  var url = ScriptApp.getService().getUrl();
  if (url) {
    Logger.log('管理者アプリ:   ' + url + '?app=admin');
    Logger.log('マンションアプリ: ' + url + '?app=mansion');
    Logger.log('Webhook URL:    ' + url + '（ChatworkのWebhookに登録）');
  } else {
    Logger.log('❌ ウェブアプリ未デプロイ（デプロイが必要です）');
  }
}

/**
 * メンバーを一括登録する
 * 必要に応じてメンバー名・色を編集してから実行してください
 */
function addInitialMembers() {
  var members = [
    { name: 'ep',   color: '#1a237e', role: '管理者' },
    // 追加メンバーは以下に記述（コピーして使ってください）
    // { name: '氏名', color: '#4caf50', role: '一般' },
  ];

  members.forEach(function(m) {
    addMember(m.name, m.color, m.role);
    Logger.log('追加: ' + m.name + ' (' + m.role + ')');
  });
  Logger.log('メンバー登録完了: ' + members.length + '名');
}

/**
 * Chatwork Webhook の動作テスト
 * テスト用のポスティング報告を模擬して処理する
 * CLAUDE_API_KEY が設定済みの場合のみ動作する
 */
function testChatworkParsing() {
  var testMessage = '#ポスティング\n函館市 西旭岡町2丁目\n419チラシ\n200枚配布\nテスト太郎';
  Logger.log('テストメッセージ: \n' + testMessage);

  var result = parsePostingMessage(testMessage);
  Logger.log('解析結果: ' + JSON.stringify(result));

  if (result.error) {
    Logger.log('❌ エラー: ' + result.error);
  } else {
    Logger.log('✅ 解析成功');
    Logger.log('  市町村: ' + result.city);
    Logger.log('  町名:   ' + result.town + result.chome);
    Logger.log('  種別:   ' + result.flyerType);
    Logger.log('  枚数:   ' + result.distCount);
    Logger.log('  実施者: ' + result.memberName);
  }
}

/**
 * エリアマスタのサマリーを表示する
 */
function showAreaSummary() {
  var cities = ['函館市', '七飯町', '北斗市'];
  cities.forEach(function(city) {
    var s = getAreaSummary(city);
    if (s.total === 0) return;
    Logger.log('【' + city + '】 合計' + s.total + 'エリア');
    Logger.log('  配布済み: ' + s.done + ' / 未配布: ' + s.skipped +
      ' / 再訪: ' + s.revisit + ' / 未着手: ' + s.notStarted);
    Logger.log('  総配布枚数: ' + s.totalDistCount + '枚');
  });
}
