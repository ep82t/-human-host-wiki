// ============================================================
// ChatworkPoller.gs — Chatwork定期ポーリング（Webhook代替）
// ============================================================
//
// Webhookの代わりに、GASタイマーで定期的にChatworkを読みに行く方式。
// 管理者権限不要。自分のAPIトークンで動作する。
//
// 【セットアップ】
//   1. GASエディタで setupPollTrigger() を実行（1回のみ）
//   2. 以後、1時間ごとに自動で新着 #ポスティング を処理する
//
// 【停止】
//   stopPollTrigger() を実行
// ============================================================

var LAST_MESSAGE_ID_KEY        = 'CHATWORK_LAST_MESSAGE_ID';
var PENDING_FLYER_CREATE_KEY   = 'PENDING_FLYER_CREATE';  // 旧承認待ちチラシ名リスト（廃止）
var PENDING_ENTRIES_KEY        = 'PENDING_POSTING_ENTRIES'; // SS作成失敗時の投稿エントリキュー

// ------------------------------------------------------------
// チラシ名の正規化（半角・全角数字を同一視）
// ------------------------------------------------------------

/**
 * Claude APIが解析したflyerType名を正規化する
 * - 半角数字→全角数字に統一
 * - FLYER_SS_MAPに登録済みの名前と照合して正式名を返す
 * 例: "DIYタイムズ19チラシ" → "DIYタイムズ１９チラシ"
 *     "600プロジェクト"    → "プロジェクト600"（語順違いも吸収）
 */
function _normalizeFlyerName(name) {
  if (!name) return name;

  // 「チラシ:」「チラシ：」などのラベルプレフィックスを除去
  // 例: "チラシ:風力発電 (旧)" → "風力発電 (旧)"
  var stripped = String(name).replace(/^チラシ[：:]\s*/u, '').trim();

  // 半角→全角数字
  var normalized = _normalizeFlyerNameDigits(stripped);

  try {
    var map = _getFlyerSsMap();
    var keys = Object.keys(map);

    // ① 完全一致
    if (map[normalized]) return normalized;
    if (map[name])       return name;

    // ② 正規化したキーと完全一致
    for (var i = 0; i < keys.length; i++) {
      if (_normalizeFlyerNameDigits(keys[i]) === normalized) return keys[i];
    }

    // ③ 単語レベルの包含マッチ（語順違いを吸収）
    //    例: "600プロジェクト" と "プロジェクト600" → 両方に「600」「プロジェクト」を含む
    var queryWords = normalized.replace(/[0-9０-９]/g, function(c) { return c; }).split('');
    for (var j = 0; j < keys.length; j++) {
      var keyNorm = _normalizeFlyerNameDigits(keys[j]);
      // 片方がもう片方を含む（部分文字列）
      if (keyNorm.indexOf(normalized) !== -1 || normalized.indexOf(keyNorm) !== -1) return keys[j];
      // 両方が共通の主要単語（3文字以上）を含む
      var matched = _flyerNameTokenMatch(normalized, keyNorm);
      if (matched) return keys[j];
    }
  } catch(e) {
    Logger.log('チラシ名照合エラー: ' + e.message);
  }

  return normalized;
}

/**
 * 2つのチラシ名が共通トークン（3文字以上）を持つか判定する
 */
function _flyerNameTokenMatch(a, b) {
  // 3文字以上の共通部分文字列があれば一致とみなす
  for (var len = Math.min(a.length, b.length); len >= 3; len--) {
    for (var i = 0; i <= a.length - len; i++) {
      var sub = a.substring(i, i + len);
      if (b.indexOf(sub) !== -1) return true;
    }
  }
  return false;
}

// ------------------------------------------------------------
// 新チラシ検出・自動作成フロー
// （旧：承認フロー → 新：即時自動作成 + 失敗時キュー）
// ------------------------------------------------------------

/**
 * 失敗エントリのキューを取得する
 * @returns {Array} [{flyerName, parsed, distDate, senderName, storedAt}, ...]
 */
function _getPendingEntries() {
  try {
    var val = PropertiesService.getScriptProperties().getProperty(PENDING_ENTRIES_KEY);
    return val ? JSON.parse(val) : [];
  } catch(e) { return []; }
}

/**
 * 失敗エントリのキューを保存する
 */
function _savePendingEntries(entries) {
  // 最大50件に制限（古いものを削除）
  if (entries.length > 50) entries = entries.slice(entries.length - 50);
  PropertiesService.getScriptProperties().setProperty(
    PENDING_ENTRIES_KEY, JSON.stringify(entries)
  );
}

/**
 * SS作成失敗時にエントリをキューに追加する
 */
function _storePendingEntry(flyerName, parsed, distDate, senderName) {
  var pending = _getPendingEntries();
  pending.push({
    flyerName:  flyerName,
    parsed:     parsed,
    distDate:   distDate,
    senderName: senderName,
    storedAt:   new Date().getTime()
  });
  _savePendingEntries(pending);
  Logger.log('  📌 キューに保存: ' + flyerName + ' / ' + parsed.city + ' ' + parsed.town);
}

/**
 * キューに溜まったエントリを処理する（SS作成済みのものだけ）
 * pollChatworkMessages の先頭で毎回呼び出す
 */
function _processPendingEntries(token, roomId) {
  var pending = _getPendingEntries();
  if (pending.length === 0) return;

  Logger.log('キュー処理開始: ' + pending.length + '件');
  var remaining = [];
  var processed = 0;

  pending.forEach(function(entry) {
    var flyerName = entry.flyerName;

    // SS が未作成なら自動作成を試みる
    if (!flyerSsExists(flyerName)) {
      var createResult = createFlyerSpreadsheet(flyerName);
      if (!createResult.success && createResult.reason !== 'exists') {
        Logger.log('  ⏳ キュー: SSまだなし → 再キュー: ' + flyerName);
        remaining.push(entry);
        return;
      }
      if (createResult.success) {
        Logger.log('  ✅ キュー処理: SS作成完了: ' + flyerName);
        _sendNewFlyerNotification(flyerName, createResult.url, token, roomId);
      }
    }

    // チラシSSに記録
    var p = entry.parsed;
    if (!p || !p.town) { return; } // 不正データはスキップ

    var flyerUpdateResult = updateAreaInFlyerSs(flyerName, {
      city:       p.city,
      town:       p.town,
      chome:      p.chome      || '',
      status:     STATUS.DONE,
      flyerType:  p.flyerType  || flyerName,
      distCount:  p.distCount  || 0,
      memberName: p.memberName || entry.senderName || '',
      distDate:   entry.distDate,
      accumulate: true
    });
    if (flyerUpdateResult.success) {
      appendDistLogToFlyerSs(flyerName, {
        city:       p.city,
        address:    p.town + (p.chome || ''),
        flyerType:  p.flyerType || flyerName,
        distCount:  p.distCount || 0,
        memberName: p.memberName || entry.senderName || '',
        distType:   '町丁目',
        source:     'Chatwork自動（再処理）',
        datetime:   entry.distDate ? new Date(entry.distDate + 'T12:00:00+09:00') : new Date()
      });
      processed++;
      Logger.log('  ✅ キュー処理完了: ' + flyerName + ' / ' + p.city + p.town);
    } else {
      Logger.log('  ⚠️ キュー処理失敗: ' + (flyerUpdateResult.error || ''));
      remaining.push(entry); // 失敗したら再キュー
    }
  });

  _savePendingEntries(remaining);
  if (processed > 0 || remaining.length < pending.length) {
    Logger.log('キュー処理完了: ' + processed + '件記録 / ' + remaining.length + '件残り');
  }
}

/**
 * 新チラシSS作成をChatworkに通知する
 */
function _sendNewFlyerNotification(flyerName, url, token, roomId) {
  var reportRoomId = PropertiesService.getScriptProperties()
    .getProperty('CHATWORK_REPORT_ROOM_ID') || roomId;
  var msg = [
    '[info][title]🆕 新チラシのマップを自動作成しました[/title]',
    'チラシ名：「' + flyerName + '」',
    'スプレッドシートURL：' + (url || '（URL取得失敗）'),
    '',
    '次のステップ：',
    '① 管理画面の設定（⚙️）から目標枚数を設定してください',
    '② チラシ選択ドロップダウンに自動追加されます',
    '[/info]'
  ].join('\n');
  try {
    UrlFetchApp.fetch('https://api.chatwork.com/v2/rooms/' + reportRoomId + '/messages', {
      method: 'post',
      headers: { 'X-ChatWorkToken': token },
      payload: { body: msg },
      muteHttpExceptions: true
    });
  } catch(e) {
    Logger.log('新チラシ通知送信失敗: ' + e.message);
  }
}

/**
 * 未知のチラシSSを自動作成してエントリを記録する
 * @param {string} flyerName 正規化済みチラシ名
 * @param {Object} parsed    Claudeの解析結果
 * @param {string} distDate  実施日 yyyy-MM-dd
 * @param {string} senderName Chatwork送信者名
 * @param {string} token
 * @param {string} roomId
 * @returns {boolean} 記録成功したか
 */
function _autoCreateFlyerAndRecord(flyerName, parsed, distDate, senderName, token, roomId) {
  Logger.log('🆕 未知のチラシ → SS自動作成: ' + flyerName);

  var createResult = createFlyerSpreadsheet(flyerName);

  if (!createResult.success && createResult.reason !== 'exists') {
    Logger.log('❌ SS作成失敗: ' + (createResult.reason || '不明') + ' → キューに保存');
    _storePendingEntry(flyerName, parsed, distDate, senderName);
    return false;
  }

  if (createResult.success) {
    Logger.log('✅ SS作成完了: ' + flyerName + ' / ' + createResult.url);
    _sendNewFlyerNotification(flyerName, createResult.url, token, roomId);
    migrateAndDeleteOldFlyerSheet(flyerName);
  } else {
    Logger.log('ℹ️ SS既存: ' + flyerName);
  }

  // 作成直後にエントリを記録
  var flyerUpdateResult = updateAreaInFlyerSs(flyerName, {
    city:       parsed.city,
    town:       parsed.town,
    chome:      parsed.chome      || '',
    status:     STATUS.DONE,
    flyerType:  parsed.flyerType  || flyerName,
    distCount:  parsed.distCount  || 0,
    memberName: parsed.memberName || senderName,
    distDate:   distDate,
    accumulate: true
  });
  if (flyerUpdateResult.success) {
    appendDistLogToFlyerSs(flyerName, {
      city:       parsed.city,
      address:    parsed.town + (parsed.chome || ''),
      flyerType:  parsed.flyerType || flyerName,
      distCount:  parsed.distCount || 0,
      memberName: parsed.memberName || senderName,
      distType:   '町丁目',
      source:     'Chatwork自動'
    });
    return true;
  } else {
    Logger.log('  ⚠️ SS作成後の記録失敗: ' + (flyerUpdateResult.error || ''));
    _storePendingEntry(flyerName, parsed, distDate, senderName);
    return false;
  }
}

// ------------------------------------------------------------
// メイン：新着メッセージをチェックして処理
// ------------------------------------------------------------

/**
 * Chatworkルームの新着メッセージをポーリングし、
 * #ポスティング を含むものを自動記録する
 * タイムトリガーで定期実行される（setupPollTrigger()で設定）
 */
function pollChatworkMessages() {
  var token, roomId;
  try {
    token  = getProp(PROP_KEYS.CHATWORK_TOKEN);
    roomId = getProp(PROP_KEYS.CHATWORK_ROOM_ID);
  } catch (e) {
    Logger.log('設定エラー: ' + e.message);
    return;
  }

  // 最後に処理したメッセージIDを取得
  var scriptProps = PropertiesService.getScriptProperties();
  var lastId = parseInt(scriptProps.getProperty(LAST_MESSAGE_ID_KEY) || '0', 10);

  // Chatwork APIからメッセージ取得（force=1: 既読問わず最新100件）
  var url = 'https://api.chatwork.com/v2/rooms/' + roomId + '/messages?force=1';
  var resp;
  try {
    resp = UrlFetchApp.fetch(url, {
      headers: { 'X-ChatWorkToken': token },
      muteHttpExceptions: true
    });
  } catch (e) {
    Logger.log('Chatwork API 通信エラー: ' + e.message);
    return;
  }

  if (resp.getResponseCode() !== 200) {
    Logger.log('Chatwork API エラー HTTP ' + resp.getResponseCode() + ': ' + resp.getContentText().slice(0, 200));
    return;
  }

  var messages;
  try {
    messages = JSON.parse(resp.getContentText());
  } catch (e) {
    Logger.log('レスポンスのパース失敗: ' + e.message);
    return;
  }

  if (!messages || messages.length === 0) {
    Logger.log('メッセージなし');
    return;
  }

  // 前回より新しいメッセージのみ抽出
  var candidates = messages.filter(function(m) {
    return parseInt(m.message_id, 10) > lastId;
  });

  if (candidates.length === 0) {
    Logger.log('新着なし（最終処理ID: ' + lastId + '）');
    return;
  }

  // Webhookで記録済みのメッセージを除外（二重記録防止）
  var webhookDone = _getWebhookProcessedIds();
  var newMessages = candidates.filter(function(m) {
    return !webhookDone[String(m.message_id)];
  });

  // 最終IDはWebhook処理済み分も含めて前進させる
  var maxId = lastId;
  candidates.forEach(function(m) {
    var id = parseInt(m.message_id, 10);
    if (id > maxId) maxId = id;
  });

  if (newMessages.length === 0) {
    scriptProps.setProperty(LAST_MESSAGE_ID_KEY, String(maxId));
    _pruneWebhookProcessedIds(maxId);
    Logger.log('新着はすべてWebhook記録済み（最終ID: ' + maxId + '）');
    return;
  }

  Logger.log('新着メッセージ: ' + newMessages.length + '件' +
    (candidates.length > newMessages.length
      ? '（Webhook記録済み ' + (candidates.length - newMessages.length) + '件を除外）' : ''));

  // キューに溜まった失敗エントリを再処理
  _processPendingEntries(token, roomId);

  var processed = 0;
  var failedCount = 0;
  var reportLines = []; // Chatwork報告用

  newMessages.forEach(function(msg) {
    var msgId = parseInt(msg.message_id, 10);
    if (msgId > maxId) maxId = msgId;

    var body = _normalizeBody((msg.body || '').trim());

    // 店舗設置報告を先にチェック（#店舗設置不可 のみは除外）
    if (_isStoreSetupMessage(body)) {
      var senderName = (msg.account && msg.account.name) ? msg.account.name : '';
      Logger.log('店舗設置報告検出: ' + senderName + ' / ID=' + msg.message_id);
      var storeResult = processStoreSetupMessage(body, senderName, msg.send_time, msg.message_id);
      if (storeResult.success) {
        processed += storeResult.count || 1;
        (storeResult.names || [storeResult.name]).forEach(function(n) {
          reportLines.push('🏪 店舗設置: ' + n + '（' + senderName + '）');
        });
      } else if (storeResult.reason !== 'duplicate') {
        failedCount++;
        Logger.log('店舗設置登録失敗: ' + (storeResult.error || ''));
      }
      // 同じメッセージに #ポスティング も含む場合は続けて処理
      if (!_isPostingMessage(body)) return;
    }

    // ポスティング報告でないものはスキップ
    if (!_isPostingMessage(body)) return;

    var senderName = (msg.account && msg.account.name) ? msg.account.name : '';
    // 配布種別をタグから判定（#辻立ち / #チラシ配布 / 町丁目）
    var distType = _detectDistType(body);
    Logger.log('配布報告検出: [' + distType + '] ' + senderName + ' / ID=' + msg.message_id);

    // Claude APIで解析（配列で返る）
    var parsedList = parsePostingMessage(body);
    if (parsedList.error) {
      Logger.log('解析エラー [ID=' + msg.message_id + ']: ' + parsedList.error);
      failedCount++;
      return;
    }

    if (!Array.isArray(parsedList) || parsedList.length === 0) {
      Logger.log('市町村/町名が読み取れず [ID=' + msg.message_id + ']');
      failedCount++;
      return;
    }

    // 送信時刻を実施日として使用
    var distDate = Utilities.formatDate(
      new Date(msg.send_time * 1000), 'Asia/Tokyo', 'yyyy-MM-dd'
    );

    parsedList.forEach(function(parsed) {
      // 実施者名が空の場合はChatworkの送信者名を使用
      if (!parsed.memberName && senderName) {
        parsed.memberName = senderName;
      }

      // チラシ種別なしはスキップ（マスターには書かない設計）
      if (!parsed.flyerType) {
        Logger.log('  ⚠️ チラシ種別なし → スキップ（マスターには書き込みません）');
        failedCount++;
        return;
      }

      var normalizedFlyerName = _normalizeFlyerName(parsed.flyerType);

      // 未知のチラシ名の場合は自動作成してそのまま記録
      if (!flyerSsExists(normalizedFlyerName)) {
        var autoCreated = _autoCreateFlyerAndRecord(
          normalizedFlyerName, parsed, distDate, senderName, token, roomId
        );
        if (autoCreated) {
          processed++;
          var autoLine = parsed.city + ' ' + parsed.town + (parsed.chome || '') +
            ' +' + parsed.distCount + '枚（' + parsed.memberName + '）[新チラシ自動作成]';
          reportLines.push(autoLine);
          Logger.log('✅ 新チラシ自動作成＆記録: ' + autoLine);
        } else {
          failedCount++;
        }
        return;
      }

      // チラシSSのみに記録（マスターには書かない）
      var flyerUpdateResult = updateAreaInFlyerSs(normalizedFlyerName, {
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
        appendDistLogToFlyerSs(normalizedFlyerName, {
          city:       parsed.city,
          address:    parsed.town + (parsed.chome || ''),
          flyerType:  parsed.flyerType,
          distCount:  parsed.distCount,
          memberName: parsed.memberName,
          distType:   distType,   // #辻立ち / #チラシ配布 / 町丁目
          source:     'Chatwork自動'
        });
        processed++;
        var line = '[' + distType + '] ' + parsed.city + ' ' + parsed.town + (parsed.chome || '') +
          ' +' + parsed.distCount + '枚（' + parsed.memberName + '）';
        reportLines.push(line);
        Logger.log('✅ 記録（チラシSS）: ' + line);
      } else {
        Logger.log('⚠️ チラシSS更新失敗: ' + (flyerUpdateResult.error || ''));
        failedCount++;
      }
    });
  });

  // 最後のメッセージIDを保存（次回の重複処理を防ぐ）
  scriptProps.setProperty(LAST_MESSAGE_ID_KEY, String(maxId));
  _pruneWebhookProcessedIds(maxId);
  Logger.log('ポーリング完了: ' + processed + '件記録 / 最終ID: ' + maxId);

  // Chatworkに結果を報告
  if (processed > 0 || failedCount > 0) {
    _sendChatworkReport(processed, failedCount, reportLines, token, roomId);
  }
}

// ------------------------------------------------------------
// Chatwork報告送信
// ------------------------------------------------------------

function _sendChatworkReport(processed, failedCount, reportLines, token, roomId) {
  // 報告先: CHATWORK_REPORT_ROOM_ID が設定されていればそちらへ、なければ同じルーム
  var reportRoomId = PropertiesService.getScriptProperties()
    .getProperty('CHATWORK_REPORT_ROOM_ID') || roomId;

  var today = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'M/d HH:mm');
  var lines = ['[info][title]📊 ポスティング自動集計 ' + today + '[/title]'];

  if (processed > 0) {
    lines.push('✅ 新規記録: ' + processed + '件');
    reportLines.forEach(function(l) { lines.push('  - ' + l); });
  }
  if (failedCount > 0) {
    lines.push('⚠️ 処理失敗: ' + failedCount + '件（ログを確認してください）');
  }
  lines.push('[/info]');

  var message = lines.join('\n');

  try {
    UrlFetchApp.fetch('https://api.chatwork.com/v2/rooms/' + reportRoomId + '/messages', {
      method: 'post',
      headers: { 'X-ChatWorkToken': token },
      payload: { body: message },
      muteHttpExceptions: true
    });
    Logger.log('Chatwork報告送信完了 (ルーム: ' + reportRoomId + ')');
  } catch (e) {
    Logger.log('Chatwork報告送信失敗: ' + e.message);
  }
}

// ------------------------------------------------------------
// トリガー管理
// ------------------------------------------------------------

/**
 * 毎日19時の定期実行トリガーを設定する
 * GASエディタから1回だけ手動実行してください
 */
function setupPollTrigger() {
  // 既存の同名トリガーを削除（重複防止）
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (t.getHandlerFunction() === 'pollChatworkMessages') {
      ScriptApp.deleteTrigger(t);
      Logger.log('既存トリガーを削除しました');
    }
  });

  // 毎日22時（日本時間）のトリガーを作成
  ScriptApp.newTrigger('pollChatworkMessages')
    .timeBased()
    .atHour(22)
    .everyDays(1)
    .inTimezone('Asia/Tokyo')
    .create();

  Logger.log('✅ トリガー設定完了: 毎日22時に自動チェックします');
  Logger.log('   停止するには stopPollTrigger() を実行してください');
}

/**
 * 定期実行トリガーを停止する
 */
function stopPollTrigger() {
  var count = 0;
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (t.getHandlerFunction() === 'pollChatworkMessages') {
      ScriptApp.deleteTrigger(t);
      count++;
    }
  });
  Logger.log('トリガー停止: ' + count + '件削除しました');
}

/**
 * 今すぐ手動で新着チェックを実行（テスト用）
 */
function testPollNow() {
  Logger.log('=== 手動ポーリング実行 ===');
  pollChatworkMessages();
}

/**
 * 4/28以降の過去メッセージをドライラン確認（600プロジェクト対応）
 */
function checkHistoricalMessages_Apr28() {
  _processHistoricalMessages(true, new Date('2026-04-28T00:00:00+09:00'));
}

/**
 * 4/28以降の過去メッセージを実際に記録する（600プロジェクト対応）
 * 必ず checkHistoricalMessages_Apr28() で内容確認後に実行すること
 */
function recordHistoricalMessages_Apr28() {
  _processHistoricalMessages(false, new Date('2026-04-28T00:00:00+09:00'));
}

/**
 * 4/23以降の過去メッセージをドライラン確認（チラシSS含む）
 */
function checkHistoricalMessages_Apr23() {
  _processHistoricalMessages(true, new Date('2026-04-23T00:00:00+09:00'));
}

/**
 * 4/23以降の過去メッセージを実際に記録する（チラシSS含む）
 * 必ず checkHistoricalMessages_Apr23() で内容確認後に実行すること
 */
function recordHistoricalMessages_Apr23() {
  _processHistoricalMessages(false, new Date('2026-04-23T00:00:00+09:00'));
}

/**
 * 4/4以降の過去メッセージをドライラン確認（記録しない）
 */
function checkHistoricalMessages() {
  _processHistoricalMessages(true, new Date('2026-04-04T00:00:00+09:00'));
}

/**
 * 4/4以降の過去メッセージを実際に記録する
 */
function recordHistoricalMessages() {
  _processHistoricalMessages(false, new Date('2026-04-04T00:00:00+09:00'));
}

/**
 * 4/12以降の過去メッセージをドライラン確認（#ポスティング + #店舗設置 両対応・複数店舗対応）
 */
function checkHistoricalMessages_Apr12() {
  _processHistoricalMessages(true, new Date('2026-04-12T00:00:00+09:00'));
}

/**
 * 4/12以降の過去メッセージを実際に記録する（#ポスティング + #店舗設置 両対応・複数店舗対応）
 * 必ず checkHistoricalMessages_Apr12() で内容確認後に実行すること
 */
function recordHistoricalMessages_Apr12() {
  _processHistoricalMessages(false, new Date('2026-04-12T00:00:00+09:00'));
}

/**
 * 4/13以降の過去メッセージをドライラン確認（#ポスティング + #店舗設置 両対応）
 */
function checkHistoricalMessages_Apr13() {
  _processHistoricalMessages(true, new Date('2026-04-13T00:00:00+09:00'));
}

/**
 * 4/13以降の過去メッセージを実際に記録する（#ポスティング + #店舗設置 両対応）
 * 必ず checkHistoricalMessages_Apr13() で内容確認後に実行すること
 */
function recordHistoricalMessages_Apr13() {
  _processHistoricalMessages(false, new Date('2026-04-13T00:00:00+09:00'));
}

/**
 * 過去メッセージを解析して記録する共通処理
 * @param {boolean} dryRun - true=確認のみ、false=実際に記録
 * @param {Date}    startDate - この日時以降のメッセージを対象とする
 */
function _processHistoricalMessages(dryRun, startDate) {
  var token  = getProp(PROP_KEYS.CHATWORK_TOKEN);
  var roomId = getProp(PROP_KEYS.CHATWORK_ROOM_ID);
  if (!token || !roomId) { Logger.log('❌ トークン/ルームID未設定'); return; }

  var startTimestamp = Math.floor((startDate || new Date('2026-04-04T00:00:00+09:00')).getTime() / 1000);
  var startLabel     = Utilities.formatDate(new Date(startTimestamp * 1000), 'Asia/Tokyo', 'M/d');

  // 過去メッセージ取得（force=1で最新100件）
  var url  = 'https://api.chatwork.com/v2/rooms/' + roomId + '/messages?force=1';
  var resp = UrlFetchApp.fetch(url, {
    headers: { 'X-ChatWorkToken': token },
    muteHttpExceptions: true
  });
  if (resp.getResponseCode() !== 200) {
    Logger.log('❌ API取得失敗: ' + resp.getResponseCode()); return;
  }

  var messages = JSON.parse(resp.getContentText());
  Logger.log('取得メッセージ総数: ' + messages.length + '件');

  // フィルタリング：開始日以降 かつ 野坂以外 かつ (#ポスティング or #店舗設置)
  var targets = messages.filter(function(msg) {
    if (parseInt(msg.send_time, 10) < startTimestamp) return false;
    var senderName = (msg.account && msg.account.name) || '';
    if (senderName.indexOf('野坂') !== -1) return false;
    var body = _normalizeBody(msg.body || '');
    return _isPostingMessage(body) || _isStoreSetupMessage(body);
  });

  Logger.log(startLabel + '以降の解析対象: ' + targets.length + '件（' + (dryRun ? 'ドライラン' : '記録モード') + '）');

  var recorded = 0, skipped = 0, failed = 0, storeRecorded = 0;

  // 重複チェック用：各チラシSS配布記録の既存エントリをキー化（市町村|住所|チラシ種別）
  // ※ マスターには書かない設計のため、チラシSSを参照する
  var existingLogKeys = {};
  if (!dryRun) {
    try {
      var flyerMap = _getFlyerSsMap();
      Object.keys(flyerMap).forEach(function(flyerName) {
        try {
          var logs = getDistLogsFromFlyerSs(flyerName, {});
          (logs || []).forEach(function(log) {
            if (log.source && log.source.indexOf('Chatwork') !== -1) {
              var key = (log.city || '') + '|' + (log.address || '') + '|' + (log.flyerType || '');
              existingLogKeys[key] = true;
            }
          });
        } catch(e2) {
          Logger.log('チラシSS重複チェック取得失敗 [' + flyerName + ']: ' + e2.message);
        }
      });
      Logger.log('既存チラシSS記録数（重複チェック用）: ' + Object.keys(existingLogKeys).length + '件');
    } catch(e) {
      Logger.log('重複チェック取得失敗（続行）: ' + e.message);
    }
  }

  targets.forEach(function(msg) {
    var senderName = (msg.account && msg.account.name) || '不明';
    var sendDate   = Utilities.formatDate(
      new Date(parseInt(msg.send_time, 10) * 1000), 'Asia/Tokyo', 'M/d HH:mm');
    var body = _normalizeBody(msg.body || '');

    Logger.log('--------------------');
    Logger.log('[' + sendDate + '] ' + senderName);
    Logger.log(body.length > 150 ? body.substring(0, 150) + '...' : body);

    // ── #店舗設置 処理 ──────────────────────────
    if (_isStoreSetupMessage(body)) {
      Logger.log('  [店舗設置]');
      if (!dryRun) {
        var storeResult = processStoreSetupMessage(body, senderName, msg.send_time, msg.message_id);
        if (storeResult.success) {
          storeRecorded += storeResult.count || 1;
          (storeResult.names || [storeResult.name]).forEach(function(n) {
            Logger.log('  ✅ 店舗登録: ' + n);
          });
        } else if (storeResult.reason === 'duplicate') {
          Logger.log('  ⏭ 重複スキップ: ' + (storeResult.name || ''));
        } else {
          failed++;
          Logger.log('  ❌ 店舗登録失敗: ' + (storeResult.error || ''));
        }
      } else {
        // ドライラン：Claude に解析させてログ表示のみ
        var storePreviewList = parseStoreSetupMessage(body);
        if (Array.isArray(storePreviewList)) {
          storePreviewList.forEach(function(sp) {
            Logger.log('  → 店舗: ' + (sp.name || '?') + ' / ' + (sp.address || '?') + ' / ' + (sp.count || 0) + '枚');
            storeRecorded++;
          });
        } else {
          Logger.log('  → 店舗解析失敗: ' + (storePreviewList.error || ''));
        }
      }
      // 同じメッセージに #ポスティング も含む場合は続けて処理（returnしない）
      if (!_isPostingMessage(body)) return;
    }

    // ── #ポスティング 処理 ───────────────────────
    var parsedList = parsePostingMessage(body);
    if (parsedList.error || !Array.isArray(parsedList) || parsedList.length === 0) {
      Logger.log('⚠️ 解析失敗: ' + (parsedList.error || '市町村・町名不明'));
      failed++;
      return;
    }

    parsedList.forEach(function(p) {
      Logger.log('  → ' + p.city + ' ' + p.town + (p.chome || '') +
        ' ' + p.distCount + '枚 [' + (p.flyerType || '-') + '] ' + (p.memberName || senderName));

      if (!dryRun) {
        // チラシ種別なしはスキップ（マスターには書かない設計）
        if (!p.flyerType) {
          Logger.log('  ⚠️ チラシ種別なし → スキップ');
          skipped++;
          return;
        }

        var normalizedName = _normalizeFlyerName(p.flyerType);
        // 未知のチラシ名の場合は自動作成（履歴取込時も同様）
        if (!flyerSsExists(normalizedName)) {
          Logger.log('  🆕 チラシSS未登録 → 自動作成: ' + normalizedName);
          var histCreateResult = createFlyerSpreadsheet(normalizedName);
          if (!histCreateResult.success && histCreateResult.reason !== 'exists') {
            Logger.log('  ❌ SS作成失敗 → スキップ: ' + normalizedName);
            failed++;
            return;
          }
          if (histCreateResult.success) {
            Logger.log('  ✅ SS作成完了: ' + normalizedName);
            migrateAndDeleteOldFlyerSheet(normalizedName);
          }
        }

        // 重複チェック：チラシSSの既存エントリで確認
        var dupKey = p.city + '|' + (p.town + (p.chome || '')) + '|' + (p.flyerType || '');
        if (existingLogKeys[dupKey]) {
          Logger.log('  ⏭ 重複スキップ（既にチラシSS記録済み）: ' + dupKey);
          skipped++;
          return;
        }

        // 実際の送信日時を取得（yyyy-MM-dd形式）
        var actualDate = Utilities.formatDate(
          new Date(parseInt(msg.send_time, 10) * 1000), 'Asia/Tokyo', 'yyyy-MM-dd'
        );
        var actualDatetime = new Date(parseInt(msg.send_time, 10) * 1000);

        // チラシSSのみに記録（マスターには書かない）
        var flyerRes = updateAreaInFlyerSs(normalizedName, {
          city:       p.city,
          town:       p.town,
          chome:      p.chome      || '',
          status:     '配布済み',
          flyerType:  p.flyerType,
          distCount:  p.distCount  || 0,
          memberName: p.memberName || senderName,
          distDate:   actualDate,   // 正しい日付形式 yyyy-MM-dd
          accumulate: true
        });
        if (flyerRes.success) {
          appendDistLogToFlyerSs(normalizedName, {
            city:       p.city,
            address:    p.town + (p.chome || ''),
            flyerType:  p.flyerType,
            distCount:  p.distCount || 0,
            memberName: p.memberName || senderName,
            distType:   _detectDistType(body),  // タグから種別判定
            source:     'Chatwork履歴',
            datetime:   actualDatetime  // 実際の送信日時をタイムスタンプに使用
          });
          existingLogKeys[dupKey] = true; // 同一ラン内の重複防止
          recorded++;
          Logger.log('  ✅ チラシSS記録: ' + p.flyerType + ' (' + actualDate + ')');
        } else {
          Logger.log('  ❌ 記録失敗: ' + (flyerRes.error || ''));
          failed++;
        }
      } else {
        recorded++;
      }
    });
  });

  Logger.log('====================');
  if (dryRun) {
    Logger.log('【ドライラン完了】ポスティング記録予定: ' + recorded + '件 / 店舗設置: ' + storeRecorded + '件 / 解析失敗: ' + failed + '件');
    Logger.log('内容を確認後 recordHistoricalMessages_Apr13() で記録してください');
  } else {
    Logger.log('【記録完了】ポスティング: ' + recorded + '件 / 店舗設置: ' + storeRecorded + '件 / スキップ: ' + skipped + '件 / 失敗: ' + failed + '件');
  }
}

// ============================================================
// 新聞折り込みエリア一括設定
// ============================================================

/**
 * 4/18 新聞折り込みエリアをマップで100%表示にする
 * GASエディタから手動実行してください（1回のみ）
 *
 * 対象エリア:
 *   函館市: 若松町・松風町・新川町・大森町・大手町・宝来町・桔梗町・広野町・駒場町
 *   北斗市: 七重浜
 */
function markNewspaperInsertAreas() {
  // 対象町名と市町村のマッピング
  var targets = [
    { city: '函館市', keywords: ['若松', '松風', '新川', '大森', '大手', '宝来', '桔梗', '広野', '駒場'] },
    { city: '北斗市', keywords: ['七重浜'] }
  ];

  // 全エリアを取得
  var allAreas = getAreaList(null);
  if (!allAreas || allAreas.length === 0) {
    Logger.log('❌ エリアマスタ取得失敗');
    return;
  }

  var updated = 0, notFound = [];

  targets.forEach(function(group) {
    group.keywords.forEach(function(keyword) {
      // 市町村 + キーワードで部分一致検索（丁目含む全行対象）
      var matches = allAreas.filter(function(a) {
        return a.city === group.city && (a.town || '').indexOf(keyword) !== -1;
      });

      if (matches.length === 0) {
        notFound.push(group.city + ' ' + keyword);
        Logger.log('⚠️ 未発見: ' + group.city + ' ' + keyword);
        return;
      }

      matches.forEach(function(area) {
        var households = parseInt(area.households, 10) || 0;
        // 世帯数が0の場合は既存distCountをそのまま維持しつつ配布済みに
        var distCount = households > 0 ? households : (parseInt(area.distCount, 10) || 1);

        var result = updateArea({
          city:       area.city,
          town:       area.town,
          chome:      area.chome      || '',
          status:     '配布済み',
          flyerType:  '新聞折り込み',
          distCount:  distCount,
          memberName: '新聞折り込み',
          distDate:   '2026-04-18',
          accumulate: false   // 上書きで100%設定
        });

        if (result.success) {
          Logger.log('✅ ' + area.city + ' ' + area.town + (area.chome || '') +
            '  世帯数=' + households + '  → 配布済み');
          updated++;

          // 配布記録にも追記
          appendDistLog({
            city:       area.city,
            address:    area.town + (area.chome || ''),
            flyerType:  '新聞折り込み',
            distCount:  distCount,
            memberName: '新聞折り込み',
            distType:   '新聞折り込み',
            source:     '手動設定'
          });
        } else {
          Logger.log('❌ 更新失敗: ' + area.city + ' ' + area.town + ' / ' + (result.error || ''));
        }
      });
    });
  });

  Logger.log('====================');
  Logger.log('【新聞折り込み設定完了】' + updated + 'エリアを配布済みに設定');
  if (notFound.length > 0) {
    Logger.log('未発見エリア: ' + notFound.join(', '));
    Logger.log('※ エリアマスタに存在しない可能性があります。addMissingBoundaryAreas等で追加後に再実行してください');
  }
}

// ============================================================

/**
 * プロジェクト600 SSの配布記録・エリアシートをクリアして最初から記録し直す
 * GASエディタから実行: resetAndRerecordProject600()
 */
function resetAndRerecordProject600() {
  var flyerName = 'プロジェクト600';

  // ① チラシSS 配布記録を全クリア
  var logSheet = _getFlyerSheet(flyerName, '配布記録');
  if (logSheet && logSheet.getLastRow() >= 2) {
    logSheet.getRange(2, 1, logSheet.getLastRow() - 1, logSheet.getLastColumn()).clearContent();
    Logger.log('✅ 配布記録クリア完了');
  }

  // ② チラシSS エリアシートを全リセット（未着手・枚数0）
  var areaSheet = _getFlyerSheet(flyerName, 'エリア');
  if (areaSheet && areaSheet.getLastRow() >= 2) {
    var lastRow = areaSheet.getLastRow();
    var data = areaSheet.getRange(2, 1, lastRow - 1, 12).getValues();
    data.forEach(function(row, i) {
      if (!row[0]) return;
      var rowNum = i + 2;
      areaSheet.getRange(rowNum, 5).setValue(STATUS.NOT_STARTED); // ステータス
      areaSheet.getRange(rowNum, 6).setValue('');                  // チラシ種別
      areaSheet.getRange(rowNum, 7).setValue(0);                   // 配布枚数
      areaSheet.getRange(rowNum, 8).setValue('');                  // 実施者名
      areaSheet.getRange(rowNum, 9).setValue('');                  // 実施日
    });
    Logger.log('✅ エリアシートリセット完了（' + (lastRow - 1) + '行）');
  }

  // ③ 4/28以降のChatworkデータを再記録
  Logger.log('4/28以降のデータを再記録中...');
  _processHistoricalMessages(false, new Date('2026-04-28T00:00:00+09:00'));

  // ④ 失敗エントリを手動補完
  Logger.log('失敗エントリを補完中...');
  recordFailedEntries_Project600();

  Logger.log('====================');
  Logger.log('✅ プロジェクト600 再記録完了');
}

/**
 * エリアマスタで「大野」を含む北斗市のエントリを検索する
 * GASエディタから実行: searchOnoHokutoAreas()
 */
function searchOnoHokutoAreas() {
  var sheet = getSheet(SHEET_NAMES.AREA_MASTER);
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return;
  var data = sheet.getRange(2, 1, lastRow - 1, 4).getValues();
  var found = 0;
  data.forEach(function(row, i) {
    var city  = String(row[0] || '');
    var town  = String(row[1] || '');
    var chome = String(row[2] || '');
    if (city === '北斗市' && town.indexOf('大野') !== -1) {
      Logger.log('行' + (i+2) + ': city=[' + city + '] town=[' + town + '] chome=[' + chome + '] 世帯数=' + row[3]);
      found++;
    }
  });
  if (found === 0) {
    Logger.log('北斗市に「大野」を含むエントリなし');
    Logger.log('→ 近い名前を検索:');
    data.forEach(function(row, i) {
      var city = String(row[0] || '');
      var town = String(row[1] || '');
      if (city === '北斗市' && (town.indexOf('本町') !== -1)) {
        Logger.log('  行' + (i+2) + ': town=[' + town + '] chome=[' + String(row[2]||'') + ']');
      }
    });
  }
}

/**
 * プロジェクト600の配布記録の重複を確認する
 * GASエディタから実行: checkProject600Duplicates()
 */
function checkProject600Duplicates() {
  var flyerName = 'プロジェクト600';

  // チラシSS配布記録を確認
  var flyerSheet = _getFlyerSheet(flyerName, '配布記録');
  if (!flyerSheet) { Logger.log('❌ プロジェクト600 SSが見つかりません'); return; }

  var lastRow = flyerSheet.getLastRow();
  if (lastRow < 2) { Logger.log('配布記録なし'); return; }

  var data = flyerSheet.getRange(2, 1, lastRow - 1, 8).getValues();
  Logger.log('【プロジェクト600 配布記録一覧】計' + (lastRow - 1) + '件');

  var seen = {};
  var duplicates = [];

  data.forEach(function(row, i) {
    if (!row[0]) return;
    var dt   = row[0] instanceof Date
      ? Utilities.formatDate(row[0], 'Asia/Tokyo', 'yyyy-MM-dd')
      : String(row[0]).substring(0, 10);
    var city  = String(row[1] || '');
    var addr  = String(row[2] || '');
    var count = row[4];
    var src   = String(row[7] || '');

    Logger.log('  行' + (i+2) + ': ' + dt + ' ' + city + ' ' + addr + ' ' + count + '枚 [' + src + ']');

    var key = dt + '|' + city + '|' + addr;
    if (seen[key]) {
      duplicates.push('⚠️ 重複: 行' + seen[key] + ' と 行' + (i+2) + ' → ' + city + ' ' + addr + ' (' + dt + ')');
    } else {
      seen[key] = i + 2;
    }
  });

  Logger.log('--------------------');
  if (duplicates.length === 0) {
    Logger.log('✅ 重複なし');
  } else {
    Logger.log('重複あり: ' + duplicates.length + '件');
    duplicates.forEach(function(d) { Logger.log(d); });
  }

  // 合計枚数
  var total = data.reduce(function(sum, row) { return sum + (parseInt(row[4], 10) || 0); }, 0);
  Logger.log('合計配布枚数: ' + total + '枚');
}

/**
 * recordHistoricalMessages_Apr28 で失敗したエントリを手動補完する
 * GASエディタから実行: recordFailedEntries_Project600()
 */
function recordFailedEntries_Project600() {
  var flyerName = 'プロジェクト600';
  var source    = 'Chatwork履歴（手動補完）';

  // 失敗した5件（city修正 + エリアマスタ未登録分）
  var entries = [
    // ① 市町村名なし → 函館市を付加
    { city:'函館市', town:'湯川町', chome:'2丁目', count:13,  member:'長澤ゆり子',  date:'2026-05-01' },
    { city:'函館市', town:'広野町', chome:'',       count:116, member:'古我健太',    date:'2026-05-01' },
    { city:'函館市', town:'深堀町', chome:'',       count:39,  member:'古我健太',    date:'2026-05-01' },
    // ② Claudeの解析ミス（town+chome結合 / 町が抜けた）→ 正しい名前で再登録
    { city:'北斗市', town:'大野本町', chome:'5丁目', count:102, member:'近藤令子',   date:'2026-04-29' },
    { city:'函館市', town:'日吉町',   chome:'4丁目', count:3,   member:'深見憲',     date:'2026-04-29' },
  ];

  var ok = 0, logOnly = 0, failed = 0;

  entries.forEach(function(e) {
    var label = e.city + ' ' + e.town + e.chome + ' ' + e.count + '枚 (' + e.member + ')';

    // チラシSSエリアシート更新を試みる（マスターには書かない）
    var flyerAreaResult = updateAreaInFlyerSs(flyerName, {
      city:      e.city,
      town:      e.town,
      chome:     e.chome,
      status:    STATUS.DONE,
      flyerType: flyerName,
      distCount: e.count,
      memberName:e.member,
      distDate:  e.date,
      accumulate:true
    });
    if (flyerAreaResult.success) {
      Logger.log('✅ チラシSSエリア更新: ' + label);
      ok++;
    } else {
      Logger.log('⚠️ チラシSSエリア更新失敗（配布記録のみ追記）: ' + label + ' / ' + (flyerAreaResult.error || ''));
      logOnly++;
    }

    // チラシSS配布記録に追記（マスターには書かない）
    appendDistLogToFlyerSs(flyerName, {
      city:      e.city,
      address:   e.town + e.chome,
      flyerType: flyerName,
      distCount: e.count,
      memberName:e.member,
      distType:  '町丁目',
      source:    source,
      datetime:  e.date ? new Date(e.date + 'T12:00:00+09:00') : new Date()  // 実際の実施日を使用
    });
    Logger.log('📝 チラシSS配布記録追記: ' + label);
  });

  Logger.log('====================');
  Logger.log('完了: チラシSSエリア更新 ' + ok + '件 / 配布記録のみ ' + logOnly + '件 / 失敗 ' + failed + '件');
  Logger.log('※ エリア更新失敗分（大野本町5丁目等）は配布記録のみ追記しました');
}

/**
 * マスターエリアマスタからプロジェクト600のデータをリセットする
 * （デフォルト表示をクリーンにする）
 * GASエディタから実行: clearProject600FromMaster()
 */
function clearProject600FromMaster() {
  var sheet = getSheet(SHEET_NAMES.AREA_MASTER);
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) { Logger.log('エリアマスタが空'); return; }

  var data = sheet.getRange(2, 1, lastRow - 1, 10).getValues();
  var cleared = 0;

  data.forEach(function(row, i) {
    var flyerType = String(row[COL_AREA.FLYER_TYPE - 1] || '');
    // プロジェクト600 / 600プロジェクト のデータをリセット
    var is600 = flyerType.indexOf('600') !== -1 &&
      (flyerType.indexOf('プロジェクト') !== -1 || flyerType.indexOf('project') !== -1 ||
       flyerType.indexOf('Project') !== -1);
    if (!is600) return;

    var rowNum = i + 2;
    sheet.getRange(rowNum, COL_AREA.STATUS).setValue(STATUS.NOT_STARTED);
    sheet.getRange(rowNum, COL_AREA.FLYER_TYPE).setValue('');
    sheet.getRange(rowNum, COL_AREA.DIST_COUNT).setValue(0);
    sheet.getRange(rowNum, COL_AREA.MEMBER_NAME).setValue('');
    sheet.getRange(rowNum, COL_AREA.DIST_DATE).setValue('');
    cleared++;
  });

  // マスター配布記録からもプロジェクト600エントリを削除
  var logSheet = getSheet(SHEET_NAMES.DIST_LOG);
  var logLastRow = logSheet.getLastRow();
  var logDeleted = 0;
  if (logLastRow >= 2) {
    var logData = logSheet.getRange(2, 1, logLastRow - 1, 8).getValues();
    var toDelete = [];
    logData.forEach(function(row, i) {
      var ft = String(row[3] || '');
      var is600 = ft.indexOf('600') !== -1 &&
        (ft.indexOf('プロジェクト') !== -1 || ft.toLowerCase().indexOf('project') !== -1);
      if (is600) toDelete.push(i + 2);
    });
    toDelete.sort(function(a, b) { return b - a; });
    toDelete.forEach(function(r) { logSheet.deleteRow(r); logDeleted++; });
  }

  Logger.log('✅ マスタークリア完了: エリア ' + cleared + '件リセット / 配布記録 ' + logDeleted + '件削除');
}

/**
 * プロジェクト600のAPIウィンドウ外・手動補完が必要な全エントリを追加する
 * 重複チェックあり（既に存在するエントリはスキップ）
 * ファイル: ChatworkPoller.gs
 * GASエディタから実行: addMissingProject600_All()
 */
function addMissingProject600_All() {
  var flyerName = 'プロジェクト600';

  // 追加すべき全エントリ（4/28開始分〜5/1手動分）
  var entries = [
    // 4/28：APIウィンドウ外のため手動追加（初回報告）
    { city:'函館市', town:'上湯川町', chome:'',    count:298, member:'近藤令子',   date:'2026-04-28' },
    // 4/29：APIで取れなかった or Claudeが市なしで失敗
    { city:'北斗市', town:'大野本町', chome:'5丁目', count:102, member:'近藤令子', date:'2026-04-29' },
    { city:'函館市', town:'日吉町',   chome:'4丁目', count:3,   member:'深見憲',   date:'2026-04-29' },
    // 5/1：市町村名なしでClaude解析失敗→手動補完
    { city:'函館市', town:'湯川町',   chome:'2丁目', count:13,  member:'長澤ゆり子', date:'2026-05-01' },
    { city:'函館市', town:'広野町',   chome:'',      count:116, member:'古我健太',   date:'2026-05-01' },
    { city:'函館市', town:'深堀町',   chome:'',      count:39,  member:'古我健太',   date:'2026-05-01' },
  ];

  // チラシSS配布記録の既存エントリをキー化（重複チェック用）
  var existingKeys = {};
  try {
    var existingLogs = getDistLogsFromFlyerSs(flyerName, {});
    (existingLogs || []).forEach(function(log) {
      var key = (log.city || '') + '|' + (log.address || '');
      existingKeys[key] = true;
    });
    Logger.log('既存ログ件数（重複チェック用）: ' + Object.keys(existingKeys).length + '件');
  } catch(e) {
    Logger.log('既存ログ取得失敗（続行）: ' + e.message);
  }

  var added = 0, skipped = 0, areaFailed = 0;

  entries.forEach(function(e) {
    var label   = e.city + ' ' + e.town + e.chome + ' ' + e.count + '枚 (' + e.member + ')';
    var dupKey  = e.city + '|' + e.town + e.chome;

    if (existingKeys[dupKey]) {
      Logger.log('⏭ 重複スキップ: ' + label);
      skipped++;
      return;
    }

    // チラシSSエリアシート更新
    var flyerAreaResult = updateAreaInFlyerSs(flyerName, {
      city:      e.city,
      town:      e.town,
      chome:     e.chome,
      status:    STATUS.DONE,
      flyerType: flyerName,
      distCount: e.count,
      memberName:e.member,
      distDate:  e.date,
      accumulate:true
    });
    if (!flyerAreaResult.success) {
      Logger.log('⚠️ エリア更新失敗（配布記録のみ追記）: ' + label + ' / ' + (flyerAreaResult.error || ''));
      areaFailed++;
    } else {
      Logger.log('✅ エリア更新: ' + label);
    }

    // チラシSS配布記録に追記（実際の実施日を使用）
    appendDistLogToFlyerSs(flyerName, {
      city:      e.city,
      address:   e.town + e.chome,
      flyerType: flyerName,
      distCount: e.count,
      memberName:e.member,
      distType:  '町丁目',
      source:    'Chatwork手動補完',
      datetime:  new Date(e.date + 'T12:00:00+09:00')
    });

    existingKeys[dupKey] = true; // 同一ラン内の重複防止
    added++;
    Logger.log('📝 追記完了: ' + label + ' (' + e.date + ')');
  });

  Logger.log('====================');
  Logger.log('完了: ' + added + '件追加 / ' + skipped + '件スキップ（重複） / エリア更新失敗: ' + areaFailed + '件');

  // 最終的なSS内の合計を表示
  try {
    var allLogs = getDistLogsFromFlyerSs(flyerName, {});
    var total = (allLogs || []).reduce(function(sum, log) {
      return sum + (parseInt(log.distCount, 10) || 0);
    }, 0);
    Logger.log('プロジェクト600 配布記録合計: ' + total + '枚');
  } catch(e) { /* ignore */ }
}

/**
 * 配布記録の重複エントリを削除して エリアを再計算する
 * 同日・同市町村・同住所・同チラシが複数ある場合、最古の1件を残して削除する
 * GASエディタから実行: deduplicateDistLog()
 */
function deduplicateDistLog() {
  var sheet = getSheet(SHEET_NAMES.DIST_LOG);
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) { Logger.log('配布記録なし'); return; }

  var data = sheet.getRange(2, 1, lastRow - 1, 8).getValues();
  var seen = {};      // key → 最初の行インデックス
  var toDelete = [];  // 削除対象行番号（逆順で削除するため後で整列）

  data.forEach(function(row, i) {
    var dt  = row[0] instanceof Date
      ? Utilities.formatDate(row[0], 'Asia/Tokyo', 'yyyy-MM-dd')
      : String(row[0]).substring(0, 10);
    var key = dt + '|' + String(row[1]) + '|' + String(row[2]) + '|' + String(row[3]);
    if (!key.replace(/\|/g,'').trim()) return; // 空行スキップ

    if (seen[key] !== undefined) {
      // 重複 → 削除対象（行番号は2始まり）
      toDelete.push(i + 2);
      Logger.log('重複検出（削除予定）: 行' + (i + 2) + ' [' + key + '] source=' + row[7]);
    } else {
      seen[key] = i + 2;
    }
  });

  if (toDelete.length === 0) {
    Logger.log('重複なし（' + (lastRow - 1) + '件チェック済み）');
    return;
  }

  // 逆順に削除（行番号がずれないよう下から）
  toDelete.sort(function(a, b) { return b - a; });
  toDelete.forEach(function(rowNum) {
    sheet.deleteRow(rowNum);
    Logger.log('削除: 行' + rowNum);
  });

  Logger.log('✅ 重複削除完了: ' + toDelete.length + '件削除');

  // エリアマスタを配布記録から再計算
  Logger.log('エリアマスタを再計算中...');
  recalcAllAreasFromDistLog();
}

/**
 * マスター配布記録全件からエリアマスタを再計算する
 */
function recalcAllAreasFromDistLog() {
  var sheet = getSheet(SHEET_NAMES.DIST_LOG);
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return;

  var logData = sheet.getRange(2, 1, lastRow - 1, 8).getValues();

  // city|addr → {count, memberName, latestDate, flyerType} で集計
  var accumMap = {};
  logData.forEach(function(row) {
    if (!row[0]) return;
    var distType  = String(row[6] || '');
    if (distType === 'マンション' || distType === '新聞折り込み') return;
    var city      = String(row[1] || '').trim();
    var addr      = String(row[2] || '').trim();
    var flyerType = String(row[3] || '').trim();
    var count     = parseInt(row[4], 10) || 0;
    var member    = String(row[5] || '').trim();
    var date      = row[0];
    if (!city || !addr) return;
    var key = city + '|' + addr + '|' + flyerType;
    if (!accumMap[key]) accumMap[key] = { count: 0, member: member, date: null, city: city, addr: addr, flyerType: flyerType };
    accumMap[key].count += count;
    if (!accumMap[key].date || (date && date > accumMap[key].date)) {
      accumMap[key].member = member;
      accumMap[key].date   = date;
    }
  });

  var areaSheet = getSheet(SHEET_NAMES.AREA_MASTER);
  var areaLastRow = areaSheet.getLastRow();
  if (areaLastRow < 2) return;
  var areaData = areaSheet.getRange(2, 1, areaLastRow - 1, 12).getValues();
  var updatedCount = 0;

  areaData.forEach(function(row, i) {
    var city  = String(row[0] || '').trim();
    var town  = String(row[1] || '').trim();
    var chome = String(row[2] || '').trim();
    var households = parseInt(row[3], 10) || 0;

    // この市町村・住所に対応する記録を全flyerTypeで集計
    var totalCount = 0; var latestMember = ''; var latestDate = null; var latestFlyer = '';
    Object.keys(accumMap).forEach(function(key) {
      var e = accumMap[key];
      if (e.city !== city) return;
      var addrNorm = e.addr.replace(/[一二三四五六七八九十百]/g, function(c) {
        return {'一':'1','二':'2','三':'3','四':'4','五':'5','六':'6','七':'7','八':'8','九':'9','十':'10'}[c] || c;
      });
      var townChome = (town + chome);
      if (addrNorm === townChome || e.addr === townChome) {
        totalCount += e.count;
        if (!latestDate || (e.date && e.date > latestDate)) {
          latestMember = e.member; latestDate = e.date; latestFlyer = e.flyerType;
        }
      }
    });

    if (totalCount > 0) {
      var rowNum = i + 2;
      areaSheet.getRange(rowNum, 5).setValue(STATUS.DONE);
      areaSheet.getRange(rowNum, 7).setValue(totalCount);
      if (latestMember) areaSheet.getRange(rowNum, 8).setValue(latestMember);
      if (latestFlyer)  areaSheet.getRange(rowNum, 6).setValue(latestFlyer);
      if (latestDate)   areaSheet.getRange(rowNum, 9).setValue(
        Utilities.formatDate(new Date(latestDate), 'Asia/Tokyo', 'yyyy-MM-dd'));
      updatedCount++;
    }
  });

  Logger.log('✅ エリアマスタ再計算完了: ' + updatedCount + '行更新');
}

/**
 * マスターエリアマスタ・配布記録からChatworkデータを全て削除する
 * （Chatwork→チラシSSのみへの移行後、マスターをクリーンにするための一回限りの実行）
 * ファイル: ChatworkPoller.gs
 * GASエディタから実行: clearAllChatworkFromMaster()
 */
function clearAllChatworkFromMaster() {
  Logger.log('=== マスターChatworkデータ全削除開始 ===');

  // ① マスター配布記録から Chatwork 由来エントリを削除
  var logSheet = getSheet(SHEET_NAMES.DIST_LOG);
  var logLastRow = logSheet.getLastRow();
  var logDeleted = 0;
  if (logLastRow >= 2) {
    var logData = logSheet.getRange(2, 1, logLastRow - 1, 8).getValues();
    var toDelete = [];
    logData.forEach(function(row, i) {
      var src = String(row[7] || '');
      // Chatwork自動・Chatwork履歴・手動補完 を全て対象
      if (src.indexOf('Chatwork') !== -1) {
        toDelete.push(i + 2);
      }
    });
    toDelete.sort(function(a, b) { return b - a; }); // 逆順で削除
    toDelete.forEach(function(r) { logSheet.deleteRow(r); logDeleted++; });
    Logger.log('配布記録削除: ' + logDeleted + '件');
  }

  // ② エリアマスタから配布データをリセット（Chatworkで書かれた分のみクリア）
  var areaSheet = getSheet(SHEET_NAMES.AREA_MASTER);
  var areaLastRow = areaSheet.getLastRow();
  var areaReset = 0;
  if (areaLastRow >= 2) {
    var areaData = areaSheet.getRange(2, 1, areaLastRow - 1, 10).getValues();
    areaData.forEach(function(row, i) {
      var status    = String(row[COL_AREA.STATUS - 1] || '');
      var flyerType = String(row[COL_AREA.FLYER_TYPE - 1] || '');
      // 配布済みステータス かつ チラシ種別あり → Chatworkで書かれた可能性が高い
      // ※ 手動入力分（アプリ経由）も含まれる可能性があるが、
      //    「マスターにはChatworkデータを書かない」方針に統一するため全リセット
      if (status === STATUS.DONE || status === STATUS.REVISIT || flyerType) {
        var rowNum = i + 2;
        areaSheet.getRange(rowNum, COL_AREA.STATUS).setValue(STATUS.NOT_STARTED);
        areaSheet.getRange(rowNum, COL_AREA.FLYER_TYPE).setValue('');
        areaSheet.getRange(rowNum, COL_AREA.DIST_COUNT).setValue('');
        areaSheet.getRange(rowNum, COL_AREA.MEMBER_NAME).setValue('');
        areaSheet.getRange(rowNum, COL_AREA.DIST_DATE).setValue('');
        areaReset++;
      }
    });
    Logger.log('エリアマスタリセット: ' + areaReset + '件');
  }

  Logger.log('=== 完了: 配布記録 ' + logDeleted + '件削除 / エリア ' + areaReset + '件リセット ===');
  Logger.log('※ 各チラシSSのデータは変更していません');
}

/**
 * プロジェクト600のチラシSSをリセットして4/28以降を再記録する
 * マスターには書かない（チラシSSのみ）
 * ファイル: ChatworkPoller.gs
 * GASエディタから実行: rerecordProject600_FlyerOnly()
 */
function rerecordProject600_FlyerOnly() {
  var flyerName = 'プロジェクト600';
  Logger.log('=== プロジェクト600 チラシSS再記録開始 ===');

  // ① チラシSS配布記録を全クリア
  var logSheet = _getFlyerSheet(flyerName, '配布記録');
  if (!logSheet) { Logger.log('❌ プロジェクト600 SSが見つかりません'); return; }
  if (logSheet.getLastRow() >= 2) {
    logSheet.getRange(2, 1, logSheet.getLastRow() - 1, logSheet.getLastColumn()).clearContent();
    Logger.log('✅ 配布記録クリア完了');
  }

  // ② チラシSS エリアシートを全リセット
  var areaSheet = _getFlyerSheet(flyerName, 'エリア');
  if (areaSheet && areaSheet.getLastRow() >= 2) {
    var lastRow = areaSheet.getLastRow();
    var data = areaSheet.getRange(2, 1, lastRow - 1, 10).getValues();
    data.forEach(function(row, i) {
      if (!row[0]) return;
      var rn = i + 2;
      areaSheet.getRange(rn, 5).setValue(STATUS.NOT_STARTED);
      areaSheet.getRange(rn, 6).setValue('');
      areaSheet.getRange(rn, 7).setValue('');
      areaSheet.getRange(rn, 8).setValue('');
      areaSheet.getRange(rn, 9).setValue('');
    });
    Logger.log('✅ エリアシートリセット完了');
  }

  // ③ 4/28以降のChatworkデータを再記録（チラシSSのみ）
  Logger.log('4/28以降のデータをチラシSSに再記録中...');
  _processHistoricalMessages(false, new Date('2026-04-28T00:00:00+09:00'));

  // ④ 失敗エントリを手動補完
  Logger.log('失敗エントリを補完中...');
  recordFailedEntries_Project600();

  Logger.log('=== プロジェクト600 チラシSS再記録完了 ===');
}

// ============================================================
// 風力発電(新) チラシ 過去データ検索・記録
// ============================================================

/**
 * Chatworkの最新メッセージから「風力発電」の報告を検索して表示（ドライラン）
 * ・いつから配布しているか確認できます
 * ・実際には記録しません
 * GASエディタから実行: checkFuryokuMessages()
 * ファイル: ChatworkPoller.gs
 */
function checkFuryokuMessages() {
  _processFuryokuMessages(true);
}

/**
 * Chatworkの最新メッセージから「風力発電」の報告を実際に記録する
 * ・checkFuryokuMessages() で内容を確認してから実行してください
 * ・風力発電(新) SSが存在しない場合は自動作成します
 * GASエディタから実行: recordFuryokuMessages()
 * ファイル: ChatworkPoller.gs
 */
function recordFuryokuMessages() {
  _processFuryokuMessages(false);
}

/**
 * 風力発電メッセージ処理の共通実装
 * @param {boolean} dryRun true=確認のみ / false=実際に記録
 */
function _processFuryokuMessages(dryRun) {
  var token  = getProp(PROP_KEYS.CHATWORK_TOKEN);
  var roomId = getProp(PROP_KEYS.CHATWORK_ROOM_ID);
  var flyerName = '風力発電(新)';

  Logger.log('=== 風力発電(新) 過去メッセージ検索 [' + (dryRun ? 'ドライラン' : '記録モード') + '] ===');

  // 最新100件を取得
  var url = 'https://api.chatwork.com/v2/rooms/' + roomId + '/messages?force=1';
  var resp;
  try {
    resp = UrlFetchApp.fetch(url, {
      headers: { 'X-ChatWorkToken': token },
      muteHttpExceptions: true
    });
  } catch(e) {
    Logger.log('❌ Chatwork API通信エラー: ' + e.message);
    return;
  }

  if (resp.getResponseCode() !== 200) {
    Logger.log('❌ API取得失敗: ' + resp.getResponseCode());
    return;
  }

  var messages = JSON.parse(resp.getContentText());
  Logger.log('取得メッセージ: ' + messages.length + '件（APIは最新100件のみ）');

  // 風力発電を含む #ポスティング メッセージを抽出
  var targets = messages.filter(function(msg) {
    var body = _normalizeBody(msg.body || '');
    return body.indexOf('風力発電') !== -1 && _isPostingMessage(body);
  });

  Logger.log('「風力発電」ポスティング報告: ' + targets.length + '件');

  if (targets.length === 0) {
    Logger.log('⚠️ 最新100件のメッセージに「風力発電」のポスティング報告が見つかりませんでした');
    Logger.log('→ もっと古いメッセージに含まれている可能性があります');
    Logger.log('→ Chatwork APIは最新100件のみ取得可能なため、それより古いデータは手動入力が必要です');
    return;
  }

  // 最古・最新の日付を表示（いつから配布しているか）
  var sortedByTime = targets.slice().sort(function(a, b) {
    return parseInt(a.send_time, 10) - parseInt(b.send_time, 10);
  });
  var firstDate = Utilities.formatDate(
    new Date(parseInt(sortedByTime[0].send_time, 10) * 1000), 'Asia/Tokyo', 'yyyy-MM-dd');
  var lastDate  = Utilities.formatDate(
    new Date(parseInt(sortedByTime[sortedByTime.length - 1].send_time, 10) * 1000), 'Asia/Tokyo', 'yyyy-MM-dd');

  Logger.log('---');
  Logger.log('📅 最初の報告（API範囲内）: ' + firstDate);
  Logger.log('📅 最新の報告: ' + lastDate);
  Logger.log('   ※ ' + firstDate + ' より前から配布している可能性があります');
  Logger.log('---');

  // 記録モードの場合: SSがなければ作成
  if (!dryRun) {
    if (!flyerSsExists(flyerName)) {
      Logger.log('SS作成中: ' + flyerName);
      var createResult = createFlyerSpreadsheet(flyerName);
      if (createResult.success) {
        Logger.log('✅ SS作成完了: ' + createResult.url);
      } else if (createResult.reason === 'exists') {
        Logger.log('ℹ️ SS既存（作成不要）');
      } else {
        Logger.log('❌ SS作成失敗: ' + (createResult.reason || '不明') + ' → 中断');
        return;
      }
    } else {
      Logger.log('ℹ️ SS既存');
    }
  }

  // 重複チェック用キー
  var existingKeys = {};
  if (!dryRun) {
    try {
      var existingLogs = getDistLogsFromFlyerSs(flyerName, {});
      (existingLogs || []).forEach(function(log) {
        var key = (log.city || '') + '|' + (log.address || '');
        existingKeys[key] = true;
      });
      Logger.log('既存ログ（重複チェック用）: ' + Object.keys(existingKeys).length + '件');
    } catch(e) {
      Logger.log('既存ログ取得失敗（続行）: ' + e.message);
    }
  }

  var recorded = 0, skipped = 0, failed = 0;

  sortedByTime.forEach(function(msg) {
    var body       = _normalizeBody(msg.body || '');
    var senderName = (msg.account && msg.account.name) || '';
    var sendDateLabel = Utilities.formatDate(
      new Date(parseInt(msg.send_time, 10) * 1000), 'Asia/Tokyo', 'M/d HH:mm');

    Logger.log('--------------------');
    Logger.log('[' + sendDateLabel + '] ' + senderName);
    Logger.log(body.length > 120 ? body.substring(0, 120) + '...' : body);

    var parsedList = parsePostingMessage(body);
    if (parsedList.error || !Array.isArray(parsedList) || parsedList.length === 0) {
      Logger.log('  ⚠️ 解析失敗: ' + (parsedList.error || '市町村・町名不明'));
      failed++;
      return;
    }

    parsedList.forEach(function(p) {
      Logger.log('  → ' + p.city + ' ' + p.town + (p.chome || '') +
        ' ' + p.distCount + '枚 [' + (p.flyerType || '-') + '] ' + (p.memberName || senderName));

      if (!dryRun) {
        var actualDate = Utilities.formatDate(
          new Date(parseInt(msg.send_time, 10) * 1000), 'Asia/Tokyo', 'yyyy-MM-dd');
        var dupKey = p.city + '|' + (p.town + (p.chome || ''));

        if (existingKeys[dupKey]) {
          Logger.log('  ⏭ 重複スキップ: ' + dupKey);
          skipped++;
          return;
        }

        var flyerRes = updateAreaInFlyerSs(flyerName, {
          city:       p.city,
          town:       p.town,
          chome:      p.chome || '',
          status:     STATUS.DONE,
          flyerType:  flyerName,
          distCount:  p.distCount || 0,
          memberName: p.memberName || senderName,
          distDate:   actualDate,
          accumulate: true
        });

        if (flyerRes.success) {
          appendDistLogToFlyerSs(flyerName, {
            city:       p.city,
            address:    p.town + (p.chome || ''),
            flyerType:  flyerName,
            distCount:  p.distCount || 0,
            memberName: p.memberName || senderName,
            distType:   _detectDistType(body),
            source:     'Chatwork履歴（風力発電検索）',
            datetime:   new Date(parseInt(msg.send_time, 10) * 1000)
          });
          existingKeys[dupKey] = true;
          recorded++;
          Logger.log('  ✅ 記録完了');
        } else {
          Logger.log('  ❌ 記録失敗: ' + (flyerRes.error || ''));
          failed++;
        }
      } else {
        recorded++;
      }
    });
  });

  Logger.log('====================');
  if (dryRun) {
    Logger.log('【ドライラン完了】記録予定: ' + recorded + '件 / 解析失敗: ' + failed + '件');
    Logger.log('');
    Logger.log('▶ 内容を確認後、以下を実行してマップに反映してください:');
    Logger.log('  ファイル: ChatworkPoller.gs');
    Logger.log('  関数: recordFuryokuMessages');
  } else {
    Logger.log('【記録完了】記録: ' + recorded + '件 / スキップ: ' + skipped + '件 / 失敗: ' + failed + '件');
    Logger.log('マップを開いてチラシ選択で「風力発電(新)」を選ぶと反映が確認できます');
  }
}

/**
 * 最後に処理したメッセージIDをリセットする
 * ※ リセット後の次回実行時は最新100件を全て再チェックします
 */
function resetLastMessageId() {
  PropertiesService.getScriptProperties().deleteProperty(LAST_MESSAGE_ID_KEY);
  Logger.log('最終メッセージIDをリセットしました');
}

/**
 * Chatworkルームのメンバーを取得してメンバーマスタに自動登録する
 * GASエディタから手動実行してください
 */
function importMembersFromChatwork() {
  var token  = getProp(PROP_KEYS.CHATWORK_TOKEN);
  var roomId = getProp(PROP_KEYS.CHATWORK_ROOM_ID);

  var resp = UrlFetchApp.fetch(
    'https://api.chatwork.com/v2/rooms/' + roomId + '/members',
    { headers: { 'X-ChatWorkToken': token }, muteHttpExceptions: true }
  );

  if (resp.getResponseCode() !== 200) {
    Logger.log('エラー: HTTP ' + resp.getResponseCode());
    return;
  }

  var members = JSON.parse(resp.getContentText());
  Logger.log('Chatworkメンバー: ' + members.length + '名');

  // 役割に応じた色とロール
  var roleColorMap = {
    'admin':    { color: '#1a237e', role: '管理者' },
    'member':   { color: '#4caf50', role: '一般'   },
    'readonly': { color: '#9e9e9e', role: '閲覧専用' }
  };

  var added = 0;
  var skipped = 0;

  members.forEach(function(m) {
    var name = m.name || '';
    if (!name) return;

    var cfg = roleColorMap[m.role] || roleColorMap['member'];

    var result = addMember(name, cfg.color, cfg.role);
    if (result && result.success) {
      Logger.log('✅ 登録: ' + name + ' (' + cfg.role + ')');
      added++;
    } else {
      Logger.log('スキップ（既存）: ' + name);
      skipped++;
    }
  });

  Logger.log('完了: ' + added + '名登録 / ' + skipped + '名スキップ（既存）');
}

/**
 * 参加中のChatworkルーム一覧を表示する
 */
function listChatworkRooms() {
  var token = getProp(PROP_KEYS.CHATWORK_TOKEN);
  var resp = UrlFetchApp.fetch('https://api.chatwork.com/v2/rooms', {
    headers: { 'X-ChatWorkToken': token },
    muteHttpExceptions: true
  });

  if (resp.getResponseCode() !== 200) {
    Logger.log('エラー: HTTP ' + resp.getResponseCode());
    return;
  }

  var rooms = JSON.parse(resp.getContentText());
  Logger.log('参加中ルーム一覧（' + rooms.length + '件）:');
  rooms.forEach(function(r) {
    Logger.log('  ID: ' + r.room_id + ' | 名前: ' + r.name + ' | 未読: ' + r.unread_num);
  });
}
