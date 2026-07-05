// ============================================================
// ChatworkWebhook.gs — Chatwork Webhook 受信・自動記録
// ============================================================
//
// ポーラー（ChatworkPoller.gs）と同じ記録フローをリアルタイムに実行する。
// - 新チラシ名を検出したらチラシSSを自動作成（FLYER_TYPESにも自動追加
//   → 管理マップのチラシ選択に即反映）し、そのSSに記録する
// - 既知チラシはチラシSSの「エリア」更新＋「配布記録」追記
// - 処理済みメッセージIDを記録し、ポーラーとの二重記録を防ぐ
// ============================================================

var WEBHOOK_PROCESSED_IDS_KEY = 'CHATWORK_WEBHOOK_PROCESSED_IDS';

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

    var ev = payload.webhook_event || {};
    var body = ev.body;
    if (!body) {
      result.message = 'メッセージ本文が空です';
      return result;
    }

    var norm = _normalizeBody(String(body).trim());
    var messageId = ev.message_id ? String(ev.message_id) : '';

    // トークン・ルームID（通知や送信者名解決に使用。未設定でも記録処理は続行）
    var token = '', roomId = '';
    try { token = getProp(PROP_KEYS.CHATWORK_TOKEN); } catch (e1) {}
    try { roomId = String(ev.room_id || getProp(PROP_KEYS.CHATWORK_ROOM_ID)); } catch (e2) {}

    var senderName = _resolveChatworkSenderName(ev, token);

    // 店舗設置報告（processStoreSetupMessage内でメッセージID重複防止済み）
    if (_isStoreSetupMessage(norm)) {
      var storeResult = processStoreSetupMessage(norm, senderName, ev.send_time, messageId);
      Logger.log('店舗設置報告（Webhook）: ' +
        (storeResult.success ? '登録 ' + (storeResult.count || 1) + '件' : (storeResult.reason || storeResult.error || '')));
      if (!_isPostingMessage(norm)) {
        result.success = true;
        result.message = '店舗設置のみ処理';
        return result;
      }
    }

    // #ポスティング タグがあるメッセージのみ処理
    if (!_isPostingMessage(norm)) {
      result.message = '#ポスティング タグなし：スキップ';
      result.success = true;
      return result;
    }

    Logger.log('ポスティング報告を受信（Webhook）: ' + norm);

    // Claude API で解析（複数町対応：配列で返る）
    var parsedList = parsePostingMessage(norm);
    if (parsedList.error) {
      _notifyChatworkError(parsedList.error, payload);
      result.message = 'AI解析エラー: ' + parsedList.error;
      return result;
    }
    if (!Array.isArray(parsedList)) parsedList = [parsedList]; // 旧レスポンス互換

    if (parsedList.length === 0) {
      var errMsg = '市町村名または町名が読み取れませんでした。\n投稿: ' + norm;
      _notifyChatworkError(errMsg, payload);
      result.message = errMsg;
      return result;
    }

    // 送信時刻を実施日として使用
    var distDate = Utilities.formatDate(
      ev.send_time ? new Date(ev.send_time * 1000) : new Date(),
      'Asia/Tokyo', 'yyyy-MM-dd'
    );
    var distType = _detectDistType(norm);

    var recorded = 0;
    var failed = 0;
    var lines = [];

    parsedList.forEach(function(parsed) {
      if (!parsed || !parsed.city || !parsed.town) { failed++; return; }

      // 実施者名が空の場合はChatworkの送信者名を使用
      if (!parsed.memberName && senderName) {
        parsed.memberName = senderName;
      }

      // チラシ種別なしはスキップ（マスターには書かない設計：ポーラーと同じ）
      if (!parsed.flyerType) {
        Logger.log('  ⚠️ チラシ種別なし → スキップ');
        failed++;
        return;
      }

      var flyerName = _normalizeFlyerName(parsed.flyerType);

      // 🆕 未知のチラシ名 → チラシSSを自動作成して記録
      //    （createFlyerSpreadsheet が FLYER_TYPES にも自動追加
      //      → 管理マップのチラシ選択ドロップダウンに即反映される）
      if (!flyerSsExists(flyerName)) {
        if (_autoCreateFlyerAndRecord(flyerName, parsed, distDate, senderName, token, roomId)) {
          recorded++;
          lines.push(parsed.city + ' ' + parsed.town + (parsed.chome || '') +
            ' +' + parsed.distCount + '枚（' + parsed.memberName + '）[新チラシ自動作成]');
        } else {
          failed++; // 作成失敗分はキューに保存済み → ポーラーが再処理する
        }
        return;
      }

      // 既知チラシ → チラシSSに記録（マスターには書かない）
      var flyerUpdateResult = updateAreaInFlyerSs(flyerName, {
        city:       parsed.city,
        town:       parsed.town,
        chome:      parsed.chome      || '',
        status:     STATUS.DONE,
        flyerType:  parsed.flyerType,
        distCount:  parsed.distCount,
        memberName: parsed.memberName,
        distDate:   distDate,
        accumulate: true
      });

      if (flyerUpdateResult.success) {
        appendDistLogToFlyerSs(flyerName, {
          city:       parsed.city,
          address:    parsed.town + (parsed.chome || ''),
          flyerType:  parsed.flyerType,
          distCount:  parsed.distCount,
          memberName: parsed.memberName,
          distType:   distType,
          source:     'Chatwork自動'
        });
        recorded++;
        lines.push('[' + distType + '] ' + parsed.city + ' ' + parsed.town + (parsed.chome || '') +
          ' +' + parsed.distCount + '枚（' + parsed.memberName + '）');
      } else {
        Logger.log('⚠️ チラシSS更新失敗: ' + (flyerUpdateResult.error || ''));
        failed++;
      }
    });

    // 記録できたメッセージはポーラーが二重処理しないようIDを保存
    if (recorded > 0 && messageId) {
      _markWebhookProcessed(messageId);
    }

    result.success = (failed === 0);
    result.message = '記録完了: ' + recorded + '件' +
      (failed > 0 ? ' / 失敗: ' + failed + '件' : '') +
      (lines.length > 0 ? '\n' + lines.join('\n') : '');

    Logger.log('Chatwork自動記録完了（Webhook）: ' + result.message);

  } catch (err) {
    Logger.log('Webhook処理エラー: ' + err.message + '\n' + err.stack);
    result.message = 'システムエラー: ' + err.message;
  }

  return result;
}

/**
 * Webhookペイロードから送信者名を解決する
 * payloadに名前が無い場合はルームメンバーAPIで account_id → 名前 を引く
 */
function _resolveChatworkSenderName(ev, token) {
  if (ev.account && ev.account.name) return ev.account.name;
  if (!ev.account_id || !ev.room_id || !token) return '';
  try {
    var res = UrlFetchApp.fetch(
      'https://api.chatwork.com/v2/rooms/' + ev.room_id + '/members',
      { headers: { 'X-ChatWorkToken': token }, muteHttpExceptions: true }
    );
    if (res.getResponseCode() !== 200) return '';
    var members = JSON.parse(res.getContentText());
    for (var i = 0; i < members.length; i++) {
      if (String(members[i].account_id) === String(ev.account_id)) {
        return members[i].name || '';
      }
    }
  } catch (e) {
    Logger.log('送信者名の解決失敗: ' + e.message);
  }
  return '';
}

// ------------------------------------------------------------
// Webhook処理済みメッセージID管理（ポーラーとの二重記録防止）
// ------------------------------------------------------------

/**
 * Webhookで処理済みのメッセージIDを {id: true} のマップで返す
 */
function _getWebhookProcessedIds() {
  try {
    var raw = PropertiesService.getScriptProperties().getProperty(WEBHOOK_PROCESSED_IDS_KEY);
    var arr = raw ? JSON.parse(raw) : [];
    var map = {};
    arr.forEach(function(id) { map[String(id)] = true; });
    return map;
  } catch (e) {
    return {};
  }
}

/**
 * メッセージIDを処理済みとして記録する（最大300件保持）
 */
function _markWebhookProcessed(messageId) {
  try {
    var props = PropertiesService.getScriptProperties();
    var raw = props.getProperty(WEBHOOK_PROCESSED_IDS_KEY);
    var arr = raw ? JSON.parse(raw) : [];
    if (arr.indexOf(String(messageId)) === -1) arr.push(String(messageId));
    if (arr.length > 300) arr = arr.slice(arr.length - 300);
    props.setProperty(WEBHOOK_PROCESSED_IDS_KEY, JSON.stringify(arr));
  } catch (e) {
    Logger.log('処理済みID保存失敗: ' + e.message);
  }
}

/**
 * ポーラーが追い越したID（lastId以下）を処理済みリストから削除する
 * ポーリング完了時に呼ばれる
 */
function _pruneWebhookProcessedIds(lastId) {
  try {
    var props = PropertiesService.getScriptProperties();
    var raw = props.getProperty(WEBHOOK_PROCESSED_IDS_KEY);
    if (!raw) return;
    var arr = JSON.parse(raw).filter(function(id) {
      return parseInt(id, 10) > lastId;
    });
    props.setProperty(WEBHOOK_PROCESSED_IDS_KEY, JSON.stringify(arr));
  } catch (e) {
    Logger.log('処理済みID整理失敗: ' + e.message);
  }
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
