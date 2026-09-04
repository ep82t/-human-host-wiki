/**
 * @file 03_utils.gs
 * 汎用ユーティリティ。外部サービスに依存しない純粋関数を中心に置く。
 */

/**
 * 現在時刻をISO 8601形式（UTC）で返す。内部保存用。
 * @return {string} 例: '2026-09-03T03:00:00.000Z'
 */
function nowIso() {
  return new Date().toISOString();
}

/**
 * 日時を日本時間の表示用文字列へ整形する。
 * @param {(Date|string)=} date 対象日時（省略時は現在）
 * @return {string} 例: '2026-09-03 12:00:00 JST'
 */
function formatJst(date) {
  var d = toDate(date);
  if (!d) {
    return '';
  }
  return formatDateWithOffset(d, 9 * 60, 'yyyy-MM-dd HH:mm:ss') + ' JST';
}

/**
 * ファイル名に使う日本時間のタイムスタンプを返す。
 * @param {(Date|string)=} date 対象日時（省略時は現在）
 * @return {string} 例: '20260903_120000'
 */
function timestampForFileName(date) {
  var d = toDate(date) || new Date();
  return formatDateWithOffset(d, 9 * 60, 'yyyyMMdd_HHmmss');
}

/**
 * 指定のUTCオフセットで日時を整形する。
 * GASの Utilities.formatDate に依存せず、どの環境でも同じ結果になるようにする。
 *
 * @param {!Date} date 対象日時
 * @param {number} offsetMinutes UTCからのオフセット（分）。日本時間は 540。
 * @param {string} pattern 'yyyy-MM-dd HH:mm:ss' 形式のパターン
 * @return {string} 整形結果
 */
function formatDateWithOffset(date, offsetMinutes, pattern) {
  var shifted = new Date(date.getTime() + offsetMinutes * 60 * 1000);
  var parts = {
    yyyy: String(shifted.getUTCFullYear()),
    MM: pad2(shifted.getUTCMonth() + 1),
    dd: pad2(shifted.getUTCDate()),
    HH: pad2(shifted.getUTCHours()),
    mm: pad2(shifted.getUTCMinutes()),
    ss: pad2(shifted.getUTCSeconds())
  };
  return pattern.replace(/yyyy|MM|dd|HH|mm|ss/g, function (token) {
    return parts[token];
  });
}

/**
 * 2桁ゼロ埋め。
 * @param {number} n 数値
 * @return {string} 例: '03'
 */
function pad2(n) {
  return (n < 10 ? '0' : '') + n;
}

/**
 * 値を Date へ変換する。変換できない場合は null。
 * @param {(Date|string|number|null|undefined)} value 入力
 * @return {?Date} Date または null
 */
function toDate(value) {
  if (!value && value !== 0) {
    return new Date();
  }
  if (value instanceof Date) {
    return isNaN(value.getTime()) ? null : value;
  }
  var d = new Date(value);
  return isNaN(d.getTime()) ? null : d;
}

/**
 * 2つの日時の差を日数で返す。
 * @param {(Date|string)} from 起点
 * @param {(Date|string)} to 終点
 * @return {number} 日数（小数を含む）。算出不可なら Infinity
 */
function diffInDays(from, to) {
  var a = toDate(from);
  var b = toDate(to);
  if (!a || !b) {
    return Infinity;
  }
  return (b.getTime() - a.getTime()) / (24 * 60 * 60 * 1000);
}

/**
 * 法令名を比較用に正規化する。
 * 全角空白・半角空白・記号ゆれを吸収するが、文字そのものは置換しない
 * （別の法令と誤って一致させないため、正規化は最小限にとどめる）。
 *
 * @param {string} name 法令名
 * @return {string} 正規化後の法令名
 */
function normalizeLawName(name) {
  if (!name) {
    return '';
  }
  return String(name)
    .replace(/[\s　]+/g, '')   // 半角・全角空白を除去
    .replace(/[（(]/g, '(')        // 括弧を半角へ統一
    .replace(/[）)]/g, ')')
    .trim();
}

/**
 * Google Drive のファイル名として安全な文字列へ変換する。
 * 法令名に含まれ得る記号のうち、扱いにくいものだけを置換する。
 *
 * @param {string} name 元の名前
 * @return {string} 安全なファイル名
 */
function sanitizeFileName(name) {
  if (!name) {
    return 'unnamed';
  }
  var safe = String(name)
    .replace(/[\/\\]/g, '／')      // パス区切りを全角へ
    .replace(/[\r\n\t]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  // Driveのファイル名長制限に対する安全側の切り詰め
  var MAX_LENGTH = 120;
  if (safe.length > MAX_LENGTH) {
    safe = safe.substring(0, MAX_LENGTH);
  }
  return safe || 'unnamed';
}

/**
 * CSVの1セルをエスケープする（RFC 4180準拠）。
 * @param {*} value 値
 * @return {string} エスケープ済みの文字列
 */
function escapeCsvCell(value) {
  if (value === null || value === undefined) {
    return '';
  }
  var s = String(value);
  if (/[",\r\n]/.test(s)) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

/**
 * 行の配列からCSV文字列を生成する。
 * Excelでの文字化けを防ぐため BOM を付与する。
 *
 * @param {!Array<string>} headers ヘッダ行
 * @param {!Array<!Array<*>>} rows データ行
 * @return {string} CSV文字列（BOM付き）
 */
function buildCsv(headers, rows) {
  var BOM = '﻿';
  var lines = [headers.map(escapeCsvCell).join(',')];
  rows.forEach(function (row) {
    lines.push(row.map(escapeCsvCell).join(','));
  });
  return BOM + lines.join('\r\n') + '\r\n';
}

/**
 * オブジェクトから深いパス（'a.b.c'）で値を取り出す。
 * @param {*} obj 対象オブジェクト
 * @param {string} path ドット区切りのパス
 * @return {*} 値。見つからなければ undefined
 */
function getByPath(obj, path) {
  if (!obj || !path) {
    return undefined;
  }
  var parts = String(path).split('.');
  var current = obj;
  for (var i = 0; i < parts.length; i++) {
    if (current === null || current === undefined) {
      return undefined;
    }
    current = current[parts[i]];
  }
  return current;
}

/**
 * エラーオブジェクトを読みやすい1行の文字列にする。
 * @param {*} error 例外オブジェクトなど
 * @return {string} 説明文字列
 */
function describeError(error) {
  if (!error) {
    return '(不明なエラー)';
  }
  if (typeof error === 'string') {
    return error;
  }
  var message = error.message || String(error);
  return message;
}

/**
 * 指定ミリ秒だけ待機する。
 * @param {number} ms 待機時間（ミリ秒）
 */
function sleepMs(ms) {
  if (ms > 0) {
    Utilities.sleep(ms);
  }
}

/**
 * JSONを人間が読みやすい形式で文字列化する。
 * @param {*} value 対象
 * @return {string} 整形済みJSON
 */
function toPrettyJson(value) {
  return JSON.stringify(value, null, 2);
}

/**
 * JSONを安全にパースする。失敗しても例外を投げない。
 * @param {string} text JSON文字列
 * @param {*=} fallback 失敗時の戻り値
 * @return {*} パース結果、または fallback
 */
function safeJsonParse(text, fallback) {
  try {
    return JSON.parse(text);
  } catch (e) {
    return fallback === undefined ? null : fallback;
  }
}
