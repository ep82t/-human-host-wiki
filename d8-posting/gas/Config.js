// ============================================================
// Config.gs — 定数・スクリプトプロパティのラッパー
// ============================================================

var SHEET_NAMES = {
  AREA_MASTER:      'エリアマスタ',
  DIST_LOG:         '配布記録',
  MANSION:          'マンション台帳',
  MEMBER:           'メンバーマスタ',
  EXECUTOR:         '実行者',
  STORE:            '店舗設置'
};

// 店舗設置列インデックス
var COL_STORE = {
  NAME:       1,  // 店舗名
  ADDRESS:    2,  // 住所
  CITY:       3,  // 市町村
  COUNT:      4,  // 設置枚数
  MEMBER:     5,  // 設置者名
  DATE:       6,  // 設置日
  LAT:        7,  // 緯度
  LNG:        8,  // 経度
  MEMO:       9,  // メモ
  MSG_ID:     10  // ChatworkメッセージID（重複防止）
};

// エリアマスタ列インデックス（1始まり）
var COL_AREA = {
  CITY:        1,  // 市町村名
  TOWN:        2,  // 町名
  CHOME:       3,  // 丁目
  HOUSEHOLDS:  4,  // 世帯数
  STATUS:      5,  // ステータス
  FLYER_TYPE:  6,  // チラシ種別
  DIST_COUNT:  7,  // 配布枚数
  MEMBER_NAME: 8,  // 実施者名
  DIST_DATE:   9,  // 実施日
  MEMO:        10, // メモ
  LAT:         11, // 緯度
  LNG:         12  // 経度
};

// 配布記録列インデックス
var COL_LOG = {
  DATETIME:    1,
  CITY:        2,
  ADDRESS:     3,
  FLYER_TYPE:  4,
  DIST_COUNT:  5,
  MEMBER_NAME: 6,
  DIST_TYPE:   7,  // 町丁目 / マンション
  SOURCE:      8   // Chatwork自動 / アプリ手入力
};

// マンション台帳列インデックス
var COL_MANSION = {
  NAME:           1,
  ADDRESS:        2,
  CITY:           3,
  STATUS:         4,  // 配布OK / オートロックNG / 管理人NG / お断り貼り紙あり
  STATUS_TYPE:    5,  // 永続NG / 状況次第
  LAST_VISIT:     6,
  LAST_COUNT:     7,
  MEMO:           8,
  LAT:            9,
  LNG:            10
};

// メンバーマスタ列インデックス
var COL_MEMBER = {
  NAME:  1,
  COLOR: 2,
  ROLE:  3
};

// ステータス定数
var STATUS = {
  NOT_STARTED: '未着手',
  DONE:        '配布済み',
  SKIPPED:     '未配布',
  REVISIT:     '再訪'
};

var MANSION_STATUS = {
  OK:         '配布OK',
  AUTOLOCK:   'オートロックNG',
  MANAGER_NG: '管理人NG',
  REFUSED:    'お断り貼り紙あり'
};

var MANSION_STATUS_TYPE = {
  PERMANENT: '永続NG',
  SITUATIONAL: '状況次第'
};

// スクリプトプロパティのキー名
var PROP_KEYS = {
  SPREADSHEET_ID:   'SPREADSHEET_ID',
  MAPS_API_KEY:     'MAPS_API_KEY',
  CLAUDE_API_KEY:   'CLAUDE_API_KEY',
  CHATWORK_TOKEN:   'CHATWORK_TOKEN',
  CHATWORK_ROOM_ID: 'CHATWORK_ROOM_ID',
  FLYER_TYPES:      'FLYER_TYPES',      // チラシ選択ドロップダウン用（カンマ区切り）
  FLYER_SS_MAP:     'FLYER_SS_MAP',     // チラシ名→SS ID マッピング（JSON）
  NOTIFY_EMAIL:     'NOTIFY_EMAIL',     // 新チラシ自動作成のメール通知先（未設定ならGAS所有者宛）
  // ── セキュリティ関連（未設定の間は従来どおり動作 = チェック無効）──
  APP_ACCESS_KEY:         'APP_ACCESS_KEY',         // WebアプリURLの合言葉（?key=xxx）
  CHATWORK_WEBHOOK_TOKEN: 'CHATWORK_WEBHOOK_TOKEN'  // Webhook署名検証用トークン
};

// ------------------------------------------------------------
// セキュリティ設定ユーティリティ
// ------------------------------------------------------------

/**
 * 【セキュリティ有効化】アクセスキーとWebhookトークンを生成・設定する
 * 実行すると即座に有効になるため、ログに出る新URLを必ずメンバーに再配布すること！
 * GASエディタから実行: setupSecurity()
 * ファイル: Config.gs
 */
function setupSecurity() {
  var props = PropertiesService.getScriptProperties();

  // 既存キーがあれば再利用（再実行しても URL が変わらないように）
  var appKey = props.getProperty(PROP_KEYS.APP_ACCESS_KEY);
  if (!appKey) {
    appKey = Utilities.getUuid().replace(/-/g, '');
    props.setProperty(PROP_KEYS.APP_ACCESS_KEY, appKey);
  }
  var hookToken = props.getProperty(PROP_KEYS.CHATWORK_WEBHOOK_TOKEN);
  if (!hookToken) {
    hookToken = Utilities.getUuid().replace(/-/g, '');
    props.setProperty(PROP_KEYS.CHATWORK_WEBHOOK_TOKEN, hookToken);
  }

  var baseUrl = '';
  try { baseUrl = ScriptApp.getService().getUrl() || ''; } catch(e) {}
  if (!baseUrl) baseUrl = '（WebアプリのURL）';

  Logger.log('========== セキュリティ有効化 完了 ==========');
  Logger.log('');
  Logger.log('【1】管理者マップの新URL（ブックマーク更新・管理者のみに共有）:');
  Logger.log(baseUrl + '?key=' + appKey);
  Logger.log('');
  Logger.log('【2】マンション配布アプリの新URL（メンバーに再配布）:');
  Logger.log(baseUrl + '?app=mansion&key=' + appKey);
  Logger.log('');
  Logger.log('【3】Chatwork側のWebhook URL設定を以下に変更:');
  Logger.log('（Chatwork → 管理者設定 → Webhook → 該当WebhookのURL欄）');
  Logger.log(baseUrl + '?token=' + hookToken);
  Logger.log('');
  Logger.log('⚠️ 旧URL（key/tokenなし）は以後アクセス拒否されます');
  Logger.log('⚠️ 元に戻す場合: disableSecurity() を実行');
}

/**
 * 【セキュリティ無効化】アクセスキー・Webhookトークンを削除して従来動作に戻す
 * GASエディタから実行: disableSecurity()
 * ファイル: Config.gs
 */
function disableSecurity() {
  var props = PropertiesService.getScriptProperties();
  props.deleteProperty(PROP_KEYS.APP_ACCESS_KEY);
  props.deleteProperty(PROP_KEYS.CHATWORK_WEBHOOK_TOKEN);
  Logger.log('✅ セキュリティチェックを無効化しました（誰でもアクセス可能な状態に戻りました）');
}

// ------------------------------------------------------------
// 通知メール設定ユーティリティ
// ------------------------------------------------------------

/**
 * 【メール通知先を設定】新チラシ自動作成時のメール宛先を登録する
 * GASエディタから実行: setNotifyEmail('kyoep82t@gmail.com')
 * 複数宛先はカンマ区切り: setNotifyEmail('a@x.com,b@y.com')
 * 未設定のままでもGAS所有者（あなた）のGmail宛に自動送信されます。
 * @param {string} email 通知先メールアドレス
 */
function setNotifyEmail(email) {
  if (!email) { Logger.log('❌ メールアドレスを指定してください'); return; }
  PropertiesService.getScriptProperties().setProperty(PROP_KEYS.NOTIFY_EMAIL, String(email).trim());
  Logger.log('✅ 新チラシ通知メールの宛先を設定しました: ' + email);
}

/**
 * 【メール通知のテスト送信】設定した宛先にテストメールを送る
 * GASエディタから実行: testNewFlyerEmail()
 */
function testNewFlyerEmail() {
  _sendNewFlyerEmail('テストチラシ（送信確認）', 'https://docs.google.com/spreadsheets/');
  var to = PropertiesService.getScriptProperties().getProperty(PROP_KEYS.NOTIFY_EMAIL);
  if (!to) { try { to = Session.getEffectiveUser().getEmail(); } catch(e) { to = '（取得失敗）'; } }
  Logger.log('テストメールを送信しました → ' + to + '（受信ボックスを確認してください）');
}

/**
 * スクリプトプロパティを取得する（未設定時はエラーメッセージ付き例外）
 */
function getProp(key) {
  var val = PropertiesService.getScriptProperties().getProperty(key);
  if (!val) {
    throw new Error('スクリプトプロパティ未設定: ' + key +
      '\n GASエディタ > プロジェクトの設定 > スクリプトプロパティ で設定してください。');
  }
  return val;
}

/**
 * スプレッドシートオブジェクトを返す（キャッシュなし・都度取得）
 */
function getSpreadsheet() {
  return SpreadsheetApp.openById(getProp(PROP_KEYS.SPREADSHEET_ID));
}

/**
 * 指定シート名のシートを返す
 */
function getSheet(sheetName) {
  var ss = getSpreadsheet();
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    throw new Error('シートが見つかりません: ' + sheetName);
  }
  return sheet;
}

// ------------------------------------------------------------
// FLYER_TYPES 管理ユーティリティ
// ------------------------------------------------------------

/**
 * 現在のFLYER_TYPESを一覧表示する
 * GASエディタから実行: listFlyerTypes()
 */
function listFlyerTypes() {
  var props = PropertiesService.getScriptProperties();
  var raw = props.getProperty(PROP_KEYS.FLYER_TYPES) || '';
  var types = raw.split(',').map(function(s) { return s.trim(); }).filter(function(s) { return s; });
  Logger.log('=== FLYER_TYPES 一覧 (' + types.length + '件) ===');
  types.forEach(function(t, i) {
    Logger.log((i + 1) + ': [' + t + ']');
  });
  Logger.log('生の値: ' + raw);
  return types;
}

/**
 * FLYER_TYPESから指定したチラシ名を削除する
 * GASエディタから実行: removeFlyerType('チラシ:風力発電 (旧)')
 * @param {string} nameToRemove 削除するチラシ名（完全一致）
 */
function removeFlyerType(nameToRemove) {
  var props = PropertiesService.getScriptProperties();
  var raw = props.getProperty(PROP_KEYS.FLYER_TYPES) || '';
  var types = raw.split(',').map(function(s) { return s.trim(); }).filter(function(s) { return s; });

  var before = types.length;
  var filtered = types.filter(function(t) { return t !== nameToRemove; });

  if (filtered.length === before) {
    Logger.log('⚠️ 見つかりませんでした: [' + nameToRemove + ']');
    Logger.log('登録済み一覧: ' + types.join(', '));
    return false;
  }

  props.setProperty(PROP_KEYS.FLYER_TYPES, filtered.join(','));
  Logger.log('✅ 削除完了: [' + nameToRemove + ']');
  Logger.log('残りチラシ: ' + filtered.join(', '));
  return true;
}

/**
 * FLYER_TYPESを直接上書きする（整形・修正用）
 * GASエディタから実行: setFlyerTypes(['419チラシ', 'プロジェクト600', '街宣チラシ'])
 * @param {Array<string>} typeArray チラシ名の配列
 */
function setFlyerTypes(typeArray) {
  if (!Array.isArray(typeArray)) {
    Logger.log('❌ 配列で指定してください');
    return;
  }
  var cleaned = typeArray.map(function(s) { return String(s).trim(); }).filter(function(s) { return s; });
  PropertiesService.getScriptProperties().setProperty(PROP_KEYS.FLYER_TYPES, cleaned.join(','));
  Logger.log('✅ FLYER_TYPES を更新しました:');
  cleaned.forEach(function(t, i) { Logger.log((i + 1) + ': ' + t); });
}

/**
 * 「チラシ:〇〇」という間違ったキーが FLYER_SS_MAP / FLYER_TYPES に入っていたら
 * 「〇〇」に修正する（5/21問題の後始末用）
 * GASエディタから実行: fixFlyerPrefixEntries()
 */
function fixFlyerPrefixEntries() {
  var props = PropertiesService.getScriptProperties();

  // ---- FLYER_SS_MAP の修正 ----
  var mapRaw = props.getProperty(PROP_KEYS.FLYER_SS_MAP) || '{}';
  var map;
  try { map = JSON.parse(mapRaw); } catch(e) { map = {}; }

  var mapFixed = 0;
  var newMap = {};
  Object.keys(map).forEach(function(key) {
    var fixedKey = key.replace(/^チラシ[：:]\s*/u, '').trim();
    if (fixedKey !== key) {
      Logger.log('FLYER_SS_MAP 修正: [' + key + '] → [' + fixedKey + ']');
      mapFixed++;
    }
    newMap[fixedKey] = map[key];
  });
  if (mapFixed > 0) {
    props.setProperty(PROP_KEYS.FLYER_SS_MAP, JSON.stringify(newMap));
    Logger.log('✅ FLYER_SS_MAP ' + mapFixed + '件修正');
  } else {
    Logger.log('FLYER_SS_MAP: 修正対象なし');
  }

  // ---- FLYER_TYPES の修正 ----
  var typesRaw = props.getProperty(PROP_KEYS.FLYER_TYPES) || '';
  var types = typesRaw.split(',').map(function(s) { return s.trim(); }).filter(function(s) { return s; });
  var typesFixed = 0;
  var newTypes = types.map(function(t) {
    var fixed = t.replace(/^チラシ[：:]\s*/u, '').trim();
    if (fixed !== t) {
      Logger.log('FLYER_TYPES 修正: [' + t + '] → [' + fixed + ']');
      typesFixed++;
    }
    return fixed;
  });
  // 重複除去
  newTypes = newTypes.filter(function(t, i) { return newTypes.indexOf(t) === i; });
  if (typesFixed > 0) {
    props.setProperty(PROP_KEYS.FLYER_TYPES, newTypes.join(','));
    Logger.log('✅ FLYER_TYPES ' + typesFixed + '件修正');
  } else {
    Logger.log('FLYER_TYPES: 修正対象なし');
  }

  Logger.log('--- 修正後の状態 ---');
  Logger.log('FLYER_TYPES: ' + (props.getProperty(PROP_KEYS.FLYER_TYPES) || '（空）'));
  Logger.log('FLYER_SS_MAP のキー: ' + Object.keys(newMap).join(', '));
}

/**
 * FLYER_SS_MAP から「600プロジェクト」（旧・誤登録）を削除する
 * 「プロジェクト600」が正しい名前として残る
 * GASエディタから実行: removeOld600ProjectKey()
 */
function removeOld600ProjectKey() {
  var props = PropertiesService.getScriptProperties();
  var mapRaw = props.getProperty(PROP_KEYS.FLYER_SS_MAP) || '{}';
  var map;
  try { map = JSON.parse(mapRaw); } catch(e) { Logger.log('パース失敗'); return; }

  if (!map['600プロジェクト']) {
    Logger.log('「600プロジェクト」は登録されていません（削除不要）');
    Logger.log('現在のキー: ' + Object.keys(map).join(', '));
    return;
  }

  var oldId = map['600プロジェクト'];
  var newId = map['プロジェクト600'];

  Logger.log('削除対象: 600プロジェクト → SS ID: ' + oldId);
  Logger.log('残す側: プロジェクト600 → SS ID: ' + (newId || '未登録'));

  delete map['600プロジェクト'];
  props.setProperty(PROP_KEYS.FLYER_SS_MAP, JSON.stringify(map));

  Logger.log('✅ 削除完了');
  Logger.log('現在のキー: ' + Object.keys(map).join(', '));
}
