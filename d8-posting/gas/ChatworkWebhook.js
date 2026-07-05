// ============================================================
// ChatworkWebhook.gs — Chatwork Webhook 受信・自動記録
// ============================================================

/**
 * Chatwork Webhook のエントリーポイント
 * GAS ウェブアプリの doPost() から呼ばれる
 * （WebApp.gs の doPost に委譲される）
 */
function handleChatworkWebhook(e) {
  var result = { success: false, message: '' };

  try {
    // Webhook ペイロードの検証
    var payload = _parseChatworkPayload(e);
    if (!payload) {
      result.message = 'ペイロードのパースに失敗しました';
      return result;
    }

    // #ポスティング タグがあるメッセージのみ処理
    var body = payload.webhook_event && payload.webhook_event.body;
    if (!body) {
      result.message = 'メッセージ本文が空です';
      return result;
    }

    if (!_isPostingMessage(body)) {
      result.message = '#ポスティング タグなし：スキップ';
      result.success = true;
      return result;
    }

    Logger.log('ポスティング報告を受信: ' + body);

    // Claude API で解析
    var parsed = parsePostingMessage(body);
    if (parsed.error) {
      _notifyChatworkError(parsed.error, payload);
      result.message = 'AI解析エラー: ' + parsed.error;
      return result;
    }

    // 必須項目チェック
    if (!parsed.city || !parsed.town) {
      var errMsg = '市町村名または町名が読み取れませんでした。\n投稿: ' + body;
      _notifyChatworkError(errMsg, payload);
      result.message = errMsg;
      return result;
    }

    // エリアマスタのステータスを「配布済み」に更新
    var today = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd');
    var updateResult = updateArea({
      city:       parsed.city,
      town:       parsed.town,
      chome:      parsed.chome,
      status:     STATUS.DONE,
      flyerType:  parsed.flyerType,
      distCount:  parsed.distCount,
      memberName: parsed.memberName,
      distDate:   today
    });

    if (!updateResult.success) {
      Logger.log('エリア更新失敗（エリアが見つからない可能性）: ' + JSON.stringify(parsed));
      // エリアが見つからなくても配布記録には追記する
    }

    // 配布記録に追記
    appendDistLog({
      city:       parsed.city,
      address:    parsed.town + (parsed.chome ? parsed.chome : ''),
      flyerType:  parsed.flyerType,
      distCount:  parsed.distCount,
      memberName: parsed.memberName,
      distType:   '町丁目',
      source:     'Chatwork自動'
    });

    result.success = true;
    result.message = '記録完了: ' + parsed.city + ' ' + parsed.town + parsed.chome +
      ' / ' + parsed.flyerType + ' / ' + parsed.distCount + '枚 / ' + parsed.memberName;

    Logger.log('Chatwork自動記録完了: ' + result.message);

  } catch (err) {
    Logger.log('Webhook処理エラー: ' + err.message + '\n' + err.stack);
    result.message = 'システムエラー: ' + err.message;
  }

  return result;
}

/**
 * Chatwork Webhook のペイロードをパースする
 */
function _parseChatworkPayload(e) {
  try {
    var raw = e.postData && e.postData.contents;
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (err) {
    Logger.log('Webhook ペイロードのパース失敗: ' + err.message);
    return null;
  }
}

/**
 * メッセージ本文を正規化する（全角＃→半角#、全角スペース→半角）
 */
function _normalizeBody(body) {
  if (!body) return '';
  return body
    .replace(/＃/g, '#')          // 全角＃ → 半角#
    .replace(/　/g, ' ');          // 全角スペース → 半角
}

/**
 * #店舗設置 タグがあるか判定する（全角・半角両対応）
 * ただし #店舗設置不可 は除く（設置を断られた店舗）
 */
function _isStoreSetupMessage(body) {
  if (!body) return false;
  var norm = _normalizeBody(body);
  // #店舗設置 があり、かつ「設置可能な店舗」の記述を含む
  // ※ #店舗設置不可 のみのメッセージは対象外
  if (norm.indexOf('#店舗設置') === -1) return false;
  // #店舗設置不可 だけで #店舗設置 を含まないケースを除外
  // → #店舗設置不可 を取り除いた後も #店舗設置 が残るか確認
  var withoutFuka = norm.replace(/#店舗設置不可/g, '');
  return withoutFuka.indexOf('#店舗設置') !== -1;
}

/**
 * ポスティング・チラシ配布・辻立ち 報告メッセージか判定する
 * 対応タグ: #ポスティング / #チラシ配布 / #辻立ち / #チラシ名
 * 全角＃にも対応
 */
function _isPostingMessage(body) {
  if (!body) return false;
  var norm = _normalizeBody(body);
  // 対応タグがあれば確定
  if (norm.indexOf('#ポスティング') !== -1) return true;
  if (norm.indexOf('#チラシ配布')   !== -1) return true;
  if (norm.indexOf('#辻立ち')       !== -1) return true;
  if (norm.indexOf('#チラシ名')     !== -1) return true;
  // 「数字＋枚」＋市町村名パターン（例: 200枚）
  if (/\d+枚/.test(norm)) {
    if (norm.indexOf('函館') !== -1 ||
        norm.indexOf('七飯') !== -1 ||
        norm.indexOf('北斗') !== -1 ||
        norm.indexOf('森町') !== -1 ||
        norm.indexOf('木古内') !== -1) return true;
  }
  return false;
}

/**
 * メッセージ本文からdistType（配布種別）を判定する
 * @param {string} body 正規化済みメッセージ本文
 * @returns {string} '辻立ち' / 'チラシ配布' / '町丁目'
 */
function _detectDistType(body) {
  if (!body) return '町丁目';
  var norm = _normalizeBody(body);
  if (norm.indexOf('#辻立ち') !== -1)     return '辻立ち';
  if (norm.indexOf('#チラシ配布') !== -1) return 'チラシ配布';
  return '町丁目';
}

/**
 * エラーが発生した場合に Chatwork へ通知する
 */
function _notifyChatworkError(errorMessage, payload) {
  var token, roomId;
  try {
    token  = getProp(PROP_KEYS.CHATWORK_TOKEN);
    roomId = getProp(PROP_KEYS.CHATWORK_ROOM_ID);
  } catch (e) {
    Logger.log('Chatwork通知スキップ（設定なし）: ' + errorMessage);
    return;
  }

  var senderName = '';
  try {
    senderName = payload.webhook_event.account.name || '';
  } catch (e) { /* 無視 */ }

  var msg = '[info][title]ポスティング報告の自動記録に失敗しました[/title]' +
    (senderName ? '投稿者: ' + senderName + '\n' : '') +
    'エラー内容: ' + errorMessage +
    '\n\n正しいフォーマットで再投稿してください：\n' +
    '#ポスティング\n函館市 西旭岡町2丁目\n419チラシ\n200枚配布\n氏名[/info]';

  var options = {
    method: 'post',
    headers: { 'X-ChatWorkToken': token },
    payload: 'body=' + encodeURIComponent(msg),
    muteHttpExceptions: true
  };

  try {
    UrlFetchApp.fetch(
      'https://api.chatwork.com/v2/rooms/' + roomId + '/messages',
      options
    );
  } catch (e) {
    Logger.log('Chatwork通知の送信に失敗: ' + e.message);
  }
}
