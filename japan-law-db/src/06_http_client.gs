/**
 * @file 06_http_client.gs
 * HTTPアクセス制御。
 *
 * 公的APIへ過度な負荷をかけないため、以下を必ず守る。
 *   - リクエスト間の最小待機（MIN_INTERVAL_MS）
 *   - 429 / 5xx に対する指数バックオフ付きリトライ
 *   - 最大リトライ回数の上限
 *   - Retry-After ヘッダの尊重
 */

/** @private {number} 直近のリクエスト時刻（ミリ秒） */
var lastRequestTimeMs_ = 0;

/**
 * @private {?function(string, !Object=): !HttpResult}
 * テスト用の差し替えフック。null のときは実際の通信を行う。
 * 本番実行では常に null であり、通信経路に影響しない。
 */
var httpOverrideForTest_ = null;

/**
 * HTTP通信をテスト用の関数へ差し替える。
 * 実際のe-Gov APIへアクセスせずにエラー処理を検証するために使う。
 *
 * @param {?function(string, !Object=): !HttpResult} fn 差し替える関数（null で解除）
 */
function setHttpOverrideForTest(fn) {
  httpOverrideForTest_ = fn;
}

/**
 * HTTPアクセスの結果。
 * @typedef {{
 *   ok: boolean,
 *   status: number,
 *   body: string,
 *   url: string,
 *   attempts: number,
 *   error: ?string
 * }} HttpResult
 */

/**
 * GETリクエストを送信する（リトライ・バックオフ込み）。
 *
 * 例外を投げず、必ず HttpResult を返す。
 * 1件の失敗で全体処理を止めないための設計である。
 *
 * @param {string} url リクエストURL
 * @param {!Logger_} logger ロガー
 * @param {!Object=} options 追加オプション
 *     {number=} maxRetries リトライ回数の上書き
 *     {boolean=} muteHttpExceptions 既定 true
 * @return {!HttpResult} 結果
 */
function httpGet(url, logger, options) {
  if (httpOverrideForTest_) {
    return httpOverrideForTest_(url, options);
  }

  var opts = options || {};
  var maxRetries = opts.maxRetries === undefined ? CONFIG.HTTP.MAX_RETRIES : opts.maxRetries;
  var attempt = 0;
  var lastError = null;
  var lastStatus = 0;
  var lastBody = '';

  while (attempt <= maxRetries) {
    attempt++;
    throttle_();

    try {
      var response = UrlFetchApp.fetch(url, {
        method: 'get',
        muteHttpExceptions: true,
        followRedirects: true,
        validateHttpsCertificates: true,
        headers: {
          'Accept': 'application/json, application/xml, text/xml, */*',
          'User-Agent': CONFIG.HTTP.USER_AGENT
        }
      });

      lastStatus = response.getResponseCode();
      lastBody = response.getContentText();

      if (lastStatus >= 200 && lastStatus < 300) {
        return {
          ok: true, status: lastStatus, body: lastBody,
          url: url, attempts: attempt, error: null
        };
      }

      if (CONFIG.HTTP.RETRYABLE_STATUS.indexOf(lastStatus) === -1) {
        // リトライしても回復しないステータス（404など）
        return {
          ok: false, status: lastStatus, body: lastBody, url: url,
          attempts: attempt,
          error: 'HTTP ' + lastStatus + '（リトライ対象外）'
        };
      }

      lastError = 'HTTP ' + lastStatus;
      var retryAfterMs = readRetryAfterMs_(response);
      if (attempt <= maxRetries) {
        var waitMs = retryAfterMs !== null ? retryAfterMs : backoffDelayMs_(attempt);
        logger.warn('リトライします: ' + lastError, {
          url: url, attempt: attempt, wait_ms: waitMs
        });
        sleepMs(waitMs);
      }

    } catch (e) {
      // ネットワークエラー・タイムアウトなど
      lastError = describeError(e);
      if (attempt <= maxRetries) {
        var backoff = backoffDelayMs_(attempt);
        logger.warn('通信エラーのためリトライします: ' + lastError, {
          url: url, attempt: attempt, wait_ms: backoff
        });
        sleepMs(backoff);
      }
    }
  }

  return {
    ok: false, status: lastStatus, body: lastBody, url: url,
    attempts: attempt,
    error: lastError || '不明な通信エラー'
  };
}

/**
 * 直前のリクエストから最小間隔が空くまで待機する。
 * @private
 */
function throttle_() {
  var now = Date.now();
  var elapsed = now - lastRequestTimeMs_;
  if (lastRequestTimeMs_ > 0 && elapsed < CONFIG.HTTP.MIN_INTERVAL_MS) {
    sleepMs(CONFIG.HTTP.MIN_INTERVAL_MS - elapsed);
  }
  lastRequestTimeMs_ = Date.now();
}

/**
 * 指数バックオフの待機時間を計算する。
 * ランダムなゆらぎ（ジッタ）を加え、リトライの集中を避ける。
 *
 * @param {number} attempt 試行回数（1始まり）
 * @return {number} 待機時間（ミリ秒）
 * @private
 */
function backoffDelayMs_(attempt) {
  var exponential = CONFIG.HTTP.BACKOFF_BASE_MS * Math.pow(2, attempt - 1);
  var capped = Math.min(exponential, CONFIG.HTTP.BACKOFF_MAX_MS);
  var jitter = Math.floor(Math.random() * (capped * 0.2));
  return capped + jitter;
}

/**
 * Retry-After ヘッダを読み取り、待機時間（ミリ秒）を返す。
 * @param {!HTTPResponse} response レスポンス
 * @return {?number} 待機時間。ヘッダがなければ null
 * @private
 */
function readRetryAfterMs_(response) {
  try {
    var headers = response.getAllHeaders() || {};
    var value = headers['Retry-After'] || headers['retry-after'];
    if (!value) {
      return null;
    }
    var seconds = parseInt(String(value), 10);
    if (!isNaN(seconds) && seconds >= 0) {
      return Math.min(seconds * 1000, CONFIG.HTTP.BACKOFF_MAX_MS);
    }
    var date = new Date(String(value));
    if (!isNaN(date.getTime())) {
      return Math.max(0, Math.min(date.getTime() - Date.now(), CONFIG.HTTP.BACKOFF_MAX_MS));
    }
    return null;
  } catch (e) {
    return null;
  }
}

/**
 * スロットリング状態をリセットする（テスト用）。
 */
function resetThrottleForTest() {
  lastRequestTimeMs_ = 0;
}
