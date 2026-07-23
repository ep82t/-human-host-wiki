// ============================================================
// ClaudeAPI.gs — Claude API を使ってチャットワーク投稿を解析する
// ============================================================

var CLAUDE_MODEL = 'claude-haiku-4-5-20251001'; // 軽量・高速なモデルを使用
var CLAUDE_API_URL = 'https://api.anthropic.com/v1/messages';

// ============================================================
// 地名マスタ（地名→市町村の推定表）
// ------------------------------------------------------------
// 従来はプロンプトにハードコードしていた地名リストを、スプレッドシートの
// 「地名マスタ」シートで管理できるようにする。シートが無い/空の場合は
// 下の DEFAULT_AREA_HINTS にフォールバックするので、未設定でも従来どおり動く。
//
// 【使い方】
//   setupAreaMasterSheet()  … シートを作成し既定の地名を書き込む（初回のみ）
//   以後はスプレッドシートの「地名マスタ」に行を足すだけで新しい地名に対応。
//   （反映はキャッシュの都合で最大1時間。すぐ反映したい場合 clearAreaHintCache()）
// ============================================================

var AREA_HINT_CACHE_KEY = 'AREA_HINT_TEXT_V1';

// 既定の地名リスト（シート未設定時のフォールバック兼・初期投入データ）
var DEFAULT_AREA_HINTS = [
  { city: '函館市', places: '湯川、上湯川、日吉、石川、神山、赤川、富岡、高丘、亀田、白鳥、五稜郭、千代台、杉並、旭岡、中道、港、万代、花園、深堀、東山、陣川、美原、桔梗、広野、駒場、大縄、東雲、弥生、末広、谷地頭、山の手、時任、中島、本通、本町（函館）、宝来、若松、松風、大森、新川、大手町、昭和、梁川、豊川、乃木、文庫歌、柳、榎本、的場、台、青柳、西旭岡、東旭岡、鍛治、銭亀、女那川、見晴' },
  { city: '北斗市', places: '七重浜、追分、中野通、常盤、飯生、大野本町、大野、茂辺地、清川、中山、谷好、上磯、本町（北斗）、東前、中央、柳川' },
  { city: '七飯町', places: '大中山、鳴川、本町（七飯）、上藤城、藤城、峠下、東大沼、緑町、鴇川、七飯' },
  { city: '木古内町', places: '本町（木古内）、木古内、前浜、泉沢、札苅' },
  { city: '森町', places: '本町（森）、砂原、姫川、尾白内' }
];

/**
 * 地名→市町村の推定リストをプロンプト用テキストで返す（キャッシュ付き）
 * @returns {string}
 */
function getAreaHintText() {
  try {
    var cached = CacheService.getScriptCache().get(AREA_HINT_CACHE_KEY);
    if (cached) return cached;
  } catch(e) { /* キャッシュ不可でも続行 */ }

  var hints = _readAreaHintsFromSheet();
  if (!hints || !hints.length) hints = DEFAULT_AREA_HINTS;

  var text = hints.map(function(h) {
    return h.city + 'の地名（これらが含まれる場合は city="' + h.city + '"）:\n  ' + h.places;
  }).join('\n\n');

  try { CacheService.getScriptCache().put(AREA_HINT_CACHE_KEY, text, 3600); } catch(e) {}
  return text;
}

/**
 * 「地名マスタ」シートから地名リストを読む（無ければ null）
 * @returns {Array<{city:string, places:string}>|null}
 */
function _readAreaHintsFromSheet() {
  try {
    var sheet = getSpreadsheet().getSheetByName(SHEET_NAMES.AREA_HINT);
    if (!sheet || sheet.getLastRow() < 2) return null;
    var data = sheet.getRange(2, 1, sheet.getLastRow() - 1, 2).getValues();
    var out = [];
    data.forEach(function(r) {
      var city = String(r[0] || '').trim();
      var places = String(r[1] || '').trim();
      if (city && places) out.push({ city: city, places: places });
    });
    return out.length ? out : null;
  } catch(e) {
    Logger.log('地名マスタ読込失敗（既定値を使用）: ' + e.message);
    return null;
  }
}

/**
 * 【初回セットアップ】「地名マスタ」シートを作成し既定の地名を書き込む
 * GASエディタから実行: setupAreaMasterSheet()
 */
function setupAreaMasterSheet() {
  var ss = getSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_NAMES.AREA_HINT);
  if (!sheet) sheet = ss.insertSheet(SHEET_NAMES.AREA_HINT);
  sheet.clear();
  sheet.getRange(1, 1, 1, 2).setValues([['市町村名', '地名（読点「、」区切り）']]);
  sheet.getRange(1, 1, 1, 2).setBackground('#f97316').setFontColor('#ffffff').setFontWeight('bold');
  var rows = DEFAULT_AREA_HINTS.map(function(h) { return [h.city, h.places]; });
  sheet.getRange(2, 1, rows.length, 2).setValues(rows);
  sheet.setFrozenRows(1);
  sheet.setColumnWidth(1, 100);
  sheet.setColumnWidth(2, 640);
  clearAreaHintCache();
  Logger.log('✅ 「地名マスタ」シートを初期化しました（' + rows.length + '市町村）。');
  Logger.log('以後はこのシートに行を足すだけで新しい地名に対応できます。');
}

/**
 * 地名マスタのキャッシュをクリアする（シート編集を即反映したいとき）
 * GASエディタから実行: clearAreaHintCache()
 */
function clearAreaHintCache() {
  try {
    CacheService.getScriptCache().remove(AREA_HINT_CACHE_KEY);
    Logger.log('地名マスタのキャッシュをクリアしました（次回解析から新しい地名が反映されます）');
  } catch(e) {
    Logger.log('キャッシュクリア失敗: ' + e.message);
  }
}

/**
 * チャットワークの投稿テキストからポスティング情報を抽出する
 * 複数町対応: 配列で返す
 * @param {string} messageText - チャットワークの投稿テキスト
 * @returns {Array|Object} 成功時は配列 [{city,town,chome,flyerType,distCount,memberName},...], 失敗時は {error}
 */
function parsePostingMessage(messageText) {
  var apiKey;
  try {
    apiKey = getProp(PROP_KEYS.CLAUDE_API_KEY);
  } catch (e) {
    return { error: 'Claude APIキーが設定されていません。' };
  }

  var prompt = _buildParsePrompt(messageText);

  var payload = {
    model: CLAUDE_MODEL,
    max_tokens: 256,
    messages: [
      { role: 'user', content: prompt }
    ]
  };

  var options = {
    method: 'post',
    contentType: 'application/json',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  var response;
  try {
    response = UrlFetchApp.fetch(CLAUDE_API_URL, options);
  } catch (e) {
    return { error: 'Claude API呼び出し失敗: ' + e.message };
  }

  if (response.getResponseCode() !== 200) {
    Logger.log('Claude API error: ' + response.getContentText());
    return { error: 'Claude API エラー: HTTP ' + response.getResponseCode() };
  }

  var json;
  try {
    json = JSON.parse(response.getContentText());
  } catch (e) {
    return { error: 'Claude API レスポンスのパース失敗' };
  }

  var text = json.content && json.content[0] && json.content[0].text;
  if (!text) {
    return { error: 'Claude API から空のレスポンスが返りました' };
  }

  return _parseClaudeResponse(text);
}

/**
 * Claude に送るプロンプトを構築する
 */
function _buildParsePrompt(messageText) {
  return [
    'あなたはチラシ配布（ポスティング）の報告テキストを解析するAIです。',
    '以下のテキストからポスティング情報を抽出し、JSON配列形式のみで回答してください。',
    '余計な説明は不要です。複数の町がある場合は複数要素の配列にしてください。',
    '',
    '抽出する項目（各要素）:',
    '- city: 市町村名（必ず以下のルールで推定する。絶対に空文字にしない）',
    '- town: 町名（例: 西旭岡町）',
    '- chome: 丁目（例: 2丁目。丁目がない場合は空文字）',
    '- flyerType: チラシ種別（例: 419チラシ/街宣チラシ/プロジェクト600。不明な場合は空文字）',
    '  ※「チラシ:〇〇」と書かれていても flyerType には〇〇だけを入れること（「チラシ:」ラベルは含めない）',
    '- distCount: 配布枚数（整数。不明な場合は0）',
    '- memberName: 実施者名（不明な場合は空文字）',
    '',
    '【city推定ルール（必須）】',
    'テキストに市町村名が明示されていない場合も、以下のリストから推定してcityを必ず設定すること:',
    '',
    getAreaHintText(),
    '',
    '【flyerType推定ルール】',
    '"600プロジェクト" "600" "プロジェクト600" → flyerType="プロジェクト600"',
    '"419" "419チラシ" → flyerType="419チラシ"',
    '"DIY" "DIYタイムズ" → flyerType="DIYタイムズ１９チラシ"（数字は全角）',
    '"街宣" → flyerType="街宣チラシ"',
    '"風力発電(新)" "風力発電（新）" "風力発電新" → flyerType="風力発電(新)"',
    '"風力発電(旧)" "風力発電（旧）" "風力発電旧" → flyerType="風力発電(旧)"',
    '  ※「チラシ:風力発電(新)」と書かれていても flyerType には「風力発電(新)」のみを入れること',
    '',
    '回答例（市名なしの報告）:',
    '入力: "広野町 116枚 チラシ:プロジェクト600"',
    '出力: [{"city":"函館市","town":"広野町","chome":"","flyerType":"プロジェクト600","distCount":116,"memberName":""}]',
    '',
    '回答例（複数町）:',
    '[{"city":"函館市","town":"東雲町","chome":"","flyerType":"419チラシ","distCount":9,"memberName":"野坂"},',
    ' {"city":"函館市","town":"大縄町","chome":"","flyerType":"419チラシ","distCount":11,"memberName":"野坂"}]',
    '',
    '報告テンプレート形式（参考）:',
    '#ポスティング',
    '2026/04/08',
    '函館市 東雲町 9枚',
    '函館市 大縄町 11枚',
    'チラシ: 419チラシ',
    '担当: 野坂',
    '',
    '解析対象テキスト:',
    messageText
  ].join('\n');
}

/**
 * #店舗設置 メッセージから店舗情報を抽出する
 * @param {string} messageText
 * @returns {Object} {name, address, city, count, memberName, memo} または {error}
 */
function parseStoreSetupMessage(messageText) {
  var apiKey;
  try { apiKey = getProp(PROP_KEYS.CLAUDE_API_KEY); }
  catch (e) { return { error: 'Claude APIキー未設定' }; }

  var prompt = [
    'あなたはチラシ店舗設置の報告テキストを解析するAIです。',
    '以下のテキストから「実際に設置できた店舗」の情報をすべて抽出し、JSON配列形式のみで回答してください。',
    '複数の店舗がある場合は複数要素の配列にしてください。余計な説明は不要です。',
    '',
    '【重要】以下は抽出しないでください:',
    '- "#店舗設置不可" "#店舗設置不可" "設置不可" "受け取り不可" と記載された店舗',
    '- 断られた・置けなかった店舗',
    '- #ポスティング タグ以降のポスティング（チラシ配布枚数）の記録',
    '',
    '【市町村の推定ルール】',
    'テキストに市町村名が明示されていない場合も、以下のリストから市町村を推定すること:',
    '',
    getAreaHintText(),
    '',
    '【書き方の多様性への対応】',
    '店舗名と場所が同じ行に書かれている場合も正しく分離してください。',
    '例: "美容室 アントワーク 本通り2丁目 10枚" → name="美容室 アントワーク", address="本通り2丁目", city="函館市", count=10',
    '例: "SOHO 本町店　10部" → name="SOHO本町店", count=10',
    '「部」「冊」は枚として扱ってください。',
    '',
    '各要素の項目:',
    '- name: 店舗名',
    '- address: 住所または場所（町名・番地など）',
    '- city: 市町村名（函館市/七飯町/北斗市/森町/木古内町。不明なら空文字）',
    '- count: 設置枚数（整数。不明なら0）',
    '- memberName: 設置者名（不明なら空文字）',
    '- memo: その他メモ（不明なら空文字）',
    '',
    '回答例（複数店舗）:',
    '[{"name":"小いけ本店","address":"宝来町","city":"函館市","count":20,"memberName":"高野","memo":""},',
    ' {"name":"美容室アントワーク","address":"本通り2丁目","city":"函館市","count":10,"memberName":"吉村","memo":""}]',
    '',
    '解析対象テキスト:',
    messageText
  ].join('\n');

  var options = {
    method: 'post',
    contentType: 'application/json',
    headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    payload: JSON.stringify({
      model: CLAUDE_MODEL, max_tokens: 512,
      messages: [{ role: 'user', content: prompt }]
    }),
    muteHttpExceptions: true
  };

  var response;
  try { response = UrlFetchApp.fetch(CLAUDE_API_URL, options); }
  catch (e) { return { error: 'API呼び出し失敗: ' + e.message }; }

  if (response.getResponseCode() !== 200) return { error: 'APIエラー: HTTP ' + response.getResponseCode() };

  var json, text;
  try {
    json = JSON.parse(response.getContentText());
    text = json.content[0].text;
  } catch (e) { return { error: 'レスポンス解析失敗' }; }

  // 配列 [...] を優先、なければオブジェクト {...} を試みる
  var match = text.match(/\[[\s\S]*\]/) || text.match(/\{[\s\S]*\}/);
  if (!match) return { error: 'JSONが見つかりませんでした' };

  var parsed;
  try { parsed = JSON.parse(match[0]); }
  catch (e) { return { error: 'JSON解析失敗' }; }

  // 単一オブジェクトは配列に変換
  if (!Array.isArray(parsed)) parsed = [parsed];

  // 名前があるものだけ返す
  return parsed
    .filter(function(item) { return item.name; })
    .map(function(item) {
      return {
        name:       String(item.name       || ''),
        address:    String(item.address    || ''),
        city:       String(item.city       || ''),
        count:      parseInt(item.count, 10) || 0,
        memberName: String(item.memberName || ''),
        memo:       String(item.memo       || '')
      };
    });
}

/**
 * Claude のレスポンステキストを解析する（配列形式対応）
 * @returns {Array} [{city,town,chome,flyerType,distCount,memberName},...] または {error}
 */
function _parseClaudeResponse(text) {
  // 配列 [...] を優先して抽出、なければオブジェクト {...} を試みる
  var jsonMatch = text.match(/\[[\s\S]*\]/) || text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    return { error: 'JSONが見つかりませんでした: ' + text };
  }

  var parsed;
  try {
    parsed = JSON.parse(jsonMatch[0]);
  } catch (e) {
    return { error: 'JSON解析失敗: ' + jsonMatch[0] };
  }

  // 単一オブジェクトの場合は配列に変換
  if (!Array.isArray(parsed)) {
    parsed = [parsed];
  }

  return parsed.map(function(item) {
    return {
      city:       String(item.city || ''),
      town:       String(item.town || ''),
      chome:      String(item.chome || ''),
      flyerType:  String(item.flyerType || ''),
      distCount:  parseInt(item.distCount, 10) || 0,
      memberName: String(item.memberName || '')
    };
  }).filter(function(item) {
    return item.town; // 町名がないものは除外
  });
}
