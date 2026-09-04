/**
 * @file 05_properties_service.gs
 * Script Properties の読み書き。
 * Google Drive のフォルダIDなど、コードに直接書いてはいけない値を安全に管理する。
 *
 * e-Gov 法令APIは認証不要のため、APIキーは扱わない。
 * 不要な認証情報を保持しないこと自体がセキュリティ上の方針である。
 */

/**
 * Script Properties を取得する。
 * @return {!Properties} Script Properties
 */
function getScriptProps() {
  return PropertiesService.getScriptProperties();
}

/**
 * プロパティを取得する。
 * @param {string} key キー
 * @param {?string=} defaultValue 未設定時の戻り値
 * @return {?string} 値
 */
function getProp(key, defaultValue) {
  var value = getScriptProps().getProperty(key);
  return (value === null || value === undefined || value === '')
    ? (defaultValue === undefined ? null : defaultValue)
    : value;
}

/**
 * プロパティを設定する。
 * @param {string} key キー
 * @param {string} value 値
 */
function setProp(key, value) {
  getScriptProps().setProperty(key, String(value));
}

/**
 * プロパティを削除する。
 * @param {string} key キー
 */
function deleteProp(key) {
  getScriptProps().deleteProperty(key);
}

/**
 * 保存されているルートフォルダIDを返す。
 * @return {?string} フォルダID。未設定なら null
 */
function getRootFolderId() {
  return getProp(CONFIG.PROPERTY_KEYS.ROOT_FOLDER_ID);
}

/**
 * ルートフォルダIDを保存する。
 * @param {string} folderId フォルダID
 */
function setRootFolderId(folderId) {
  setProp(CONFIG.PROPERTY_KEYS.ROOT_FOLDER_ID, folderId);
}

/**
 * 前回の同期完了日時（ISO 8601）を返す。
 * @return {?string} 日時。未同期なら null
 */
function getLastSyncAt() {
  return getProp(CONFIG.PROPERTY_KEYS.LAST_SYNC_AT);
}

/**
 * 同期完了日時を記録する。
 * @param {string=} isoString ISO 8601形式の日時（省略時は現在）
 */
function setLastSyncAt(isoString) {
  setProp(CONFIG.PROPERTY_KEYS.LAST_SYNC_AT, isoString || nowIso());
}

/**
 * 現在のプロパティ設定を一覧表示する（運用時の確認用）。
 * 認証情報は保持しないため、そのまま表示して問題ない。
 *
 * @return {!Object<string, string>} プロパティの一覧
 */
function showProperties() {
  var props = getScriptProps().getProperties();
  console.log('--- Script Properties ---');
  Object.keys(props).forEach(function (key) {
    console.log(key + ' = ' + props[key]);
  });
  if (Object.keys(props).length === 0) {
    console.log('(未設定です。setup() をまだ実行していない可能性があります)');
  }
  return props;
}
