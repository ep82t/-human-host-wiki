/**
 * @file 12_hash_service.gs
 * 差分検出のためのハッシュ計算。
 * 内容が前回と同一ならDriveへ書き込まない（無駄な更新履歴を作らない）。
 */

/**
 * 文字列のSHA-256ハッシュを16進文字列で返す。
 *
 * @param {string} text 対象文字列
 * @return {string} 64文字の16進文字列
 */
function computeSha256Hex(text) {
  var bytes = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256, text || '', Utilities.Charset.UTF_8);
  var hex = '';
  for (var i = 0; i < bytes.length; i++) {
    // GASは符号付きバイト（-128〜127）を返すため符号なしへ戻す
    var value = bytes[i] < 0 ? bytes[i] + 256 : bytes[i];
    hex += (value < 16 ? '0' : '') + value.toString(16);
  }
  return hex;
}

/**
 * 法令の原本XMLからハッシュを計算する。
 *
 * 注意: ハッシュは「原本XML」に対して計算する。
 * Markdownは変換ロジックの改良で変わり得るため、
 * 法令自体が改正されたかどうかの判定には使わない。
 *
 * @param {string} xmlText 原本XML
 * @return {string} ハッシュ値
 */
function computeLawHash(xmlText) {
  return computeSha256Hex(normalizeForHash(xmlText));
}

/**
 * ハッシュ計算前の正規化。
 * 取得のたびに変わり得る空白・改行コードの差異で
 * 「改正あり」と誤判定しないようにする。
 *
 * @param {string} text 対象文字列
 * @return {string} 正規化後の文字列
 */
function normalizeForHash(text) {
  if (!text) {
    return '';
  }
  return String(text)
    .replace(/\r\n/g, '\n')   // 改行コードを統一
    .replace(/\s+$/g, '')      // 末尾の空白を除去
    .trim();
}

/**
 * 2つのハッシュが一致するか判定する。
 * @param {?string} a ハッシュA
 * @param {?string} b ハッシュB
 * @return {boolean} 一致すれば true
 */
function isSameHash(a, b) {
  return !!a && !!b && a === b;
}
