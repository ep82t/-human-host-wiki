// ============================================================
// ClaudeAPI.gs — Claude API を使ってチャットワーク投稿を解析する
// ============================================================

var CLAUDE_MODEL = 'claude-haiku-4-5-20251001'; // 軽量・高速なモデルを使用
var CLAUDE_API_URL = 'https://api.anthropic.com/v1/messages';

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
    '函館市の地名（これらが含まれる場合は city="函館市"）:',
    '  湯川、上湯川、日吉、石川、神山、赤川、富岡、高丘、亀田、白鳥、五稜郭、千代台、杉並、',
    '  旭岡、中道、港、万代、花園、深堀、東山、陣川、美原、桔梗、広野、駒場、大縄、東雲、',
    '  弥生、末広、谷地頭、山の手、時任、中島、本通、本町（函館）、宝来、若松、松風、大森、',
    '  新川、大手町、昭和、梁川、豊川、乃木、文庫歌、柳、榎本、的場、台、青柳、',
    '  西旭岡、東旭岡、鍛治、銭亀、女那川、見晴',
    '',
    '北斗市の地名（これらが含まれる場合は city="北斗市"）:',
    '  七重浜、追分、中野通、常盤、飯生、大野本町、大野、茂辺地、清川、中山、谷好、',
    '  上磯、本町（北斗）、東前、中央、柳川',
    '',
    '七飯町の地名（これらが含まれる場合は city="七飯町"）:',
    '  大中山、鳴川、本町（七飯）、上藤城、藤城、峠下、東大沼、緑町、鴇川、七飯',
    '',
    '木古内町の地名: 本町（木古内）、木古内、前浜、泉沢、札苅',
    '森町の地名: 本町（森）、砂原、姫川、尾白内',
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
    '以下の地名は函館市と推定してください:',
    '  本通、本町、宝来、若松、松風、大森、新川、大手町、谷地頭、末広、弥生、山の手、',
    '  時任、神山、中島、湯川、石川、日吉、陣川、東山、旭岡、上湯川、桔梗、美原、',
    '  的場、柳、榎本、昭和、梁川、豊川、乃木、文庫歌、駒場、広野、亀田、白鳥、',
    '  港、万代、花園、深堀、東、中道、千代台、五稜郭、杉並、赤川、富岡、高丘、',
    '  本通り、本通2丁目 など函館市内の地名',
    '以下は北斗市:',
    '  七重浜、大野、追分、本町（北斗市）、中山、茂辺地、清川、谷好',
    '以下は七飯町:',
    '  大中山、鳴川、本町（七飯町）、上藤城、藤城、峠下、東大沼',
    '以下は木古内町:',
    '  本町（木古内町）、木古内、前浜、泉沢、札苅',
    '以下は森町:',
    '  本町（森町）、砂原、姫川、尾白内',
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
