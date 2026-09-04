/**
 * @file 17_trigger_service.gs
 * 時間主導型トリガーの管理。
 * PCを起動していなくてもGoogle側で自動実行されるようにする。
 */

/**
 * 定期同期トリガーを作成する（重複登録しない）。
 *
 * 既に同じ関数のトリガーが存在する場合は新規作成せず、既存のものを使う。
 *
 * @return {{created: boolean, triggerCount: number, message: string}}
 */
function installTrigger() {
  var handler = CONFIG.TRIGGER.HANDLER_FUNCTION;
  var existing = findTriggersByHandler_(handler);

  if (existing.length > 0) {
    var message = 'トリガーは既に設定されています（' + existing.length + '件）。' +
      '重複登録はしていません。';
    console.log(message);
    return { created: false, triggerCount: existing.length, message: message };
  }

  try {
    ScriptApp.newTrigger(handler)
      .timeBased()
      .atHour(CONFIG.TRIGGER.HOUR_OF_DAY)
      .everyDays(1)
      .inTimezone(CONFIG.TIMEZONE)
      .create();
  } catch (e) {
    var errorMessage = 'トリガーの作成に失敗しました: ' + describeError(e);
    console.log(errorMessage);
    return { created: false, triggerCount: 0, message: errorMessage };
  }

  var successMessage = '毎日 ' + CONFIG.TRIGGER.HOUR_OF_DAY + '時台（日本時間）に ' +
    handler + '() を実行するトリガーを作成しました。';
  console.log(successMessage);
  return { created: true, triggerCount: 1, message: successMessage };
}

/**
 * 定期同期トリガーを削除する。
 *
 * @return {{removed: number, message: string}}
 */
function removeTrigger() {
  var handler = CONFIG.TRIGGER.HANDLER_FUNCTION;
  var targets = findTriggersByHandler_(handler);

  targets.forEach(function (trigger) {
    ScriptApp.deleteTrigger(trigger);
  });

  var message = targets.length > 0
    ? 'トリガーを' + targets.length + '件削除しました。自動同期は停止しました。'
    : '削除対象のトリガーはありませんでした。';
  console.log(message);
  return { removed: targets.length, message: message };
}

/**
 * 現在設定されているトリガーを一覧表示する。
 *
 * @return {!Array<{handler: string, id: string}>} トリガーの一覧
 */
function listTriggers() {
  var triggers = ScriptApp.getProjectTriggers();
  var result = triggers.map(function (trigger) {
    return { handler: trigger.getHandlerFunction(), id: trigger.getUniqueId() };
  });

  console.log('--- 設定済みトリガー（' + result.length + '件） ---');
  result.forEach(function (item) {
    console.log('  ' + item.handler + ' (ID: ' + item.id + ')');
  });
  if (result.length === 0) {
    console.log('  (なし) installTrigger() で自動同期を設定できます。');
  }
  return result;
}

/**
 * 指定した関数名のトリガーを探す。
 * @param {string} handlerFunction 関数名
 * @return {!Array<!Trigger>} 該当するトリガー
 * @private
 */
function findTriggersByHandler_(handlerFunction) {
  return ScriptApp.getProjectTriggers().filter(function (trigger) {
    return trigger.getHandlerFunction() === handlerFunction;
  });
}
