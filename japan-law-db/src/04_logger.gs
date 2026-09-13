/**
 * @file 04_logger.gs
 * ログ処理。INFO / WARN / ERROR の3レベルを扱い、
 * 実行単位でバッファに蓄積して 99_システムログ へ保存する。
 */

/** @const {!Object<string, number>} ログレベルの優先度 */
var LOG_LEVELS = { INFO: 10, WARN: 20, ERROR: 30 };

/**
 * 実行単位のログを蓄積するロガー。
 *
 * @param {string} runName 実行名（ログファイル名に使う。例: 'sync'）
 * @constructor
 */
function Logger_(runName) {
  /** @private {string} */
  this.runName_ = runName || 'run';
  /** @private {!Array<string>} */
  this.lines_ = [];
  /** @private {!Array<!Object>} */
  this.errors_ = [];
  /** @private {!Array<!Object>} */
  this.warnings_ = [];
  /** @private {!Date} */
  this.startedAt_ = new Date();
  /** @private {number} */
  this.minLevel_ = LOG_LEVELS[CONFIG.LOG.MIN_LEVEL] || LOG_LEVELS.INFO;
}

/**
 * ログを1行記録する。
 *
 * @param {string} level 'INFO' | 'WARN' | 'ERROR'
 * @param {string} message 本文
 * @param {!Object=} context 付随情報（法令名など）
 */
Logger_.prototype.log = function (level, message, context) {
  var priority = LOG_LEVELS[level] || LOG_LEVELS.INFO;
  if (priority < this.minLevel_) {
    return;
  }

  var contextText = '';
  if (context && Object.keys(context).length > 0) {
    contextText = ' ' + JSON.stringify(context);
  }

  var line = '[' + formatJst(new Date()) + '] [' + level + '] ' + message + contextText;
  this.lines_.push(line);

  if (level === 'ERROR') {
    this.errors_.push({ at: nowIso(), message: message, context: context || {} });
  } else if (level === 'WARN') {
    this.warnings_.push({ at: nowIso(), message: message, context: context || {} });
  }

  // GAS実行トランスクリプトにも出す（デバッグ時に便利）
  if (typeof console !== 'undefined' && console.log) {
    console.log(line);
  }
};

/**
 * INFOレベルのログ。
 * @param {string} message 本文
 * @param {!Object=} context 付随情報
 */
Logger_.prototype.info = function (message, context) {
  this.log('INFO', message, context);
};

/**
 * WARNレベルのログ。処理は継続するが人間の確認が必要な事象に使う。
 * @param {string} message 本文
 * @param {!Object=} context 付随情報
 */
Logger_.prototype.warn = function (message, context) {
  this.log('WARN', message, context);
};

/**
 * ERRORレベルのログ。1件の失敗であり、全体処理は継続する。
 * @param {string} message 本文
 * @param {!Object=} context 付随情報
 */
Logger_.prototype.error = function (message, context) {
  this.log('ERROR', message, context);
};

/**
 * 蓄積したログの全文を返す。
 * @return {string} ログ本文
 */
Logger_.prototype.getText = function () {
  var text = this.lines_.join('\n');
  if (text.length > CONFIG.LOG.MAX_CHARS) {
    text = text.substring(0, CONFIG.LOG.MAX_CHARS) +
      '\n... (ログが上限に達したため以降は省略されました)';
  }
  return text;
};

/**
 * 記録されたWARNの一覧を返す。
 * @return {!Array<!Object>} WARN一覧
 */
Logger_.prototype.getWarnings = function () {
  return this.warnings_.slice();
};

/**
 * 記録されたERRORの一覧を返す。
 * @return {!Array<!Object>} ERROR一覧
 */
Logger_.prototype.getErrors = function () {
  return this.errors_.slice();
};

/**
 * ログファイル名を返す。
 * @return {string} 例: 'sync_20260903_120000.log'
 */
Logger_.prototype.getFileName = function () {
  return this.runName_ + '_' + timestampForFileName(this.startedAt_) + '.log';
};

/**
 * ログをDriveへ保存する。
 * ログ保存自体の失敗で本処理を落とさないよう、例外は握りつぶして戻り値で示す。
 *
 * @param {!DriveService} driveService Drive操作サービス
 * @return {boolean} 保存に成功したら true
 */
Logger_.prototype.saveToDrive = function (driveService) {
  if (!CONFIG.LOG.SAVE_TO_DRIVE) {
    return false;
  }
  try {
    var folder = driveService.getSystemLogFolder();
    driveService.upsertTextFileByName(folder, this.getFileName(), this.getText());

    // エラーが発生していた場合は、エラーログフォルダにも要約を残す
    if (this.errors_.length > 0) {
      var errorFolder = driveService.getErrorLogFolder();
      var summary = toPrettyJson({
        run: this.runName_,
        started_at: this.startedAt_.toISOString(),
        finished_at: nowIso(),
        error_count: this.errors_.length,
        warning_count: this.warnings_.length,
        errors: this.errors_,
        warnings: this.warnings_
      });
      driveService.upsertTextFileByName(
        errorFolder, 'errors_' + timestampForFileName(this.startedAt_) + '.json', summary);
    }
    return true;
  } catch (e) {
    if (typeof console !== 'undefined' && console.log) {
      console.log('ログのDrive保存に失敗しました: ' + describeError(e));
    }
    return false;
  }
};

/**
 * ロガーを生成する。
 * @param {string} runName 実行名
 * @return {!Logger_} ロガー
 */
function createLogger(runName) {
  return new Logger_(runName);
}
