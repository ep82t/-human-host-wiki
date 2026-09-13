/**
 * @file 09_xml_parser.gs
 * 法令XML（法令標準XMLスキーマ）のパーサ。
 *
 * 設計方針
 * --------
 * GASの XmlService に依存せず、依存関係のない純粋なJavaScriptで実装する。
 * 理由は2つ。
 *   1. GAS上とローカルのテスト環境で「まったく同じコード」が動くため、
 *      変換ロジックを実際に検証できる。
 *   2. XmlService特有の名前空間・エンティティの扱いに引きずられない。
 *
 * 出力する木構造（LawNode）は、後段の Markdown 変換・構造化JSON生成が
 * 扱いやすいプレーンなオブジェクトとする。
 *
 * @typedef {{
 *   name: string,
 *   attrs: !Object<string, string>,
 *   children: !Array<(!LawNode|string)>
 * }} LawNode
 */

/** @const {!Object<string, string>} XMLの定義済みエンティティ */
var XML_ENTITIES = {
  'lt': '<',
  'gt': '>',
  'amp': '&',
  'quot': '"',
  'apos': "'"
};

/**
 * XMLエンティティ参照を実際の文字へ復元する。
 * 数値文字参照（&#12345; / &#x3042;）にも対応する。
 *
 * @param {string} text 対象文字列
 * @return {string} 復元後の文字列
 */
function decodeXmlEntities(text) {
  if (!text || text.indexOf('&') === -1) {
    return text || '';
  }
  return text.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, function (whole, body) {
    if (body.charAt(0) === '#') {
      var codePoint;
      if (body.charAt(1) === 'x' || body.charAt(1) === 'X') {
        codePoint = parseInt(body.substring(2), 16);
      } else {
        codePoint = parseInt(body.substring(1), 10);
      }
      if (isNaN(codePoint) || codePoint < 0 || codePoint > 0x10FFFF) {
        return whole;
      }
      return String.fromCodePoint(codePoint);
    }
    var mapped = XML_ENTITIES[body];
    return mapped === undefined ? whole : mapped;
  });
}

/**
 * 法令XMLを解析して木構造へ変換する。
 *
 * 想定する入力は e-Gov の法令標準XML。名前空間接頭辞は付かない前提だが、
 * 付いていても要素名から接頭辞を除去して扱う。
 *
 * @param {string} xmlText XML文字列
 * @return {!LawNode} ルート要素のノード
 * @throws {Error} XMLとして解析できない場合
 */
function parseLawXml(xmlText) {
  if (!xmlText || typeof xmlText !== 'string') {
    throw new Error('XML解析エラー: 入力が空です');
  }

  var text = xmlText;

  // BOM を除去する
  if (text.charCodeAt(0) === 0xFEFF) {
    text = text.substring(1);
  }

  // XML宣言・DOCTYPE・処理命令・コメントを除去する
  text = text.replace(/<\?[\s\S]*?\?>/g, '');
  text = text.replace(/<!DOCTYPE[^>[]*(\[[\s\S]*?\])?>/gi, '');
  text = text.replace(/<!--[\s\S]*?-->/g, '');

  var root = null;
  var stack = [];
  // 閉じタグが欠けている要素の件数（本文欠落の可能性を呼び出し側へ伝えるため）
  var counter = { unclosed: 0 };
  // 要素・CDATA・テキストを走査する正規表現
  var tokenPattern = /<!\[CDATA\[([\s\S]*?)\]\]>|<\/([^>\s]+)\s*>|<([^!?\/>\s]+)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>/g;
  var lastIndex = 0;
  var match;

  while ((match = tokenPattern.exec(text)) !== null) {
    // 直前のテキストノードを取り込む
    if (match.index > lastIndex) {
      appendTextNode_(stack, text.substring(lastIndex, match.index));
    }
    lastIndex = tokenPattern.lastIndex;

    if (match[1] !== undefined) {
      // CDATAセクション（実体をそのまま保持する）
      appendRawText_(stack, match[1]);
      continue;
    }

    if (match[2] !== undefined) {
      // 終了タグ
      var closingName = stripNamespace_(match[2]);
      var closed = closeElement_(stack, closingName, counter);
      if (closed && stack.length === 0) {
        root = root || closed;
      }
      continue;
    }

    // 開始タグ（または空要素タグ）
    var name = stripNamespace_(match[3]);
    var node = {
      name: name,
      attrs: parseAttributes_(match[4] || ''),
      children: []
    };

    if (stack.length === 0 && root === null) {
      root = node;
    } else if (stack.length > 0) {
      stack[stack.length - 1].children.push(node);
    }

    var isSelfClosing = match[5] === '/';
    if (!isSelfClosing) {
      stack.push(node);
    }
  }

  if (root === null) {
    throw new Error('XML解析エラー: 要素が1つも見つかりませんでした');
  }
  // 閉じられていない要素がある場合でも、取得済みの内容は活かす。
  // 本文の欠落を避けるため例外にはせず、呼び出し側がWARNを出せるよう印を付ける。
  // 巻き戻しで捨てられた要素（counter）と、最後まで閉じられなかった要素（stack）の両方を数える。
  var unclosedTotal = counter.unclosed + stack.length;
  if (unclosedTotal > 0) {
    root.attrs = root.attrs || {};
    root.attrs['__unclosed'] = String(unclosedTotal);
  }

  return root;
}

/**
 * 名前空間接頭辞を取り除く。
 * @param {string} name 要素名
 * @return {string} 接頭辞なしの要素名
 * @private
 */
function stripNamespace_(name) {
  var trimmed = String(name).trim();
  var colon = trimmed.indexOf(':');
  return colon === -1 ? trimmed : trimmed.substring(colon + 1);
}

/**
 * 属性文字列を解析する。
 * @param {string} attrText 例: ' Num="1" Delete="false"'
 * @return {!Object<string, string>} 属性の連想配列
 * @private
 */
function parseAttributes_(attrText) {
  var attrs = {};
  if (!attrText) {
    return attrs;
  }
  var pattern = /([^\s=]+)\s*=\s*("([^"]*)"|'([^']*)')/g;
  var m;
  while ((m = pattern.exec(attrText)) !== null) {
    var key = stripNamespace_(m[1]);
    var value = m[3] !== undefined ? m[3] : (m[4] || '');
    attrs[key] = decodeXmlEntities(value);
  }
  return attrs;
}

/**
 * テキストノードをスタック最上位の要素へ追加する。
 * 空白のみのテキストは、意味を持たないため無視する。
 *
 * @param {!Array<!LawNode>} stack 要素スタック
 * @param {string} raw 生テキスト
 * @private
 */
function appendTextNode_(stack, raw) {
  if (stack.length === 0) {
    return;
  }
  // 法令XMLでは要素間の改行・インデントは意味を持たない
  if (/^[\s　]*$/.test(raw)) {
    return;
  }
  appendRawText_(stack, decodeXmlEntities(raw));
}

/**
 * テキストをスタック最上位の要素へそのまま追加する。
 * @param {!Array<!LawNode>} stack 要素スタック
 * @param {string} value テキスト
 * @private
 */
function appendRawText_(stack, value) {
  if (stack.length === 0 || value === '') {
    return;
  }
  stack[stack.length - 1].children.push(value);
}

/**
 * 終了タグに対応する要素をスタックから閉じる。
 * 対応が取れない場合でも壊れないよう、名前が一致する直近の要素まで巻き戻す。
 *
 * @param {!Array<!LawNode>} stack 要素スタック
 * @param {string} name 終了タグの要素名
 * @param {{unclosed: number}} counter 閉じられなかった要素数の集計先
 * @return {?LawNode} 閉じた要素
 * @private
 */
function closeElement_(stack, name, counter) {
  for (var i = stack.length - 1; i >= 0; i--) {
    if (stack[i].name === name) {
      var closed = stack[i];
      // 巻き戻しで捨てられる要素は「閉じられなかった要素」である。
      // 件数を記録し、呼び出し側が警告を出せるようにする。
      counter.unclosed += (stack.length - 1 - i);
      stack.length = i;
      return closed;
    }
  }
  // 対応する開始タグがない終了タグは無視する
  return null;
}

/**
 * 指定した要素名の子要素をすべて返す（直下のみ）。
 * @param {!LawNode} node 親ノード
 * @param {string} name 要素名
 * @return {!Array<!LawNode>} 該当する子要素
 */
function childElements(node, name) {
  if (!node || !node.children) {
    return [];
  }
  return node.children.filter(function (child) {
    return typeof child === 'object' && child.name === name;
  });
}

/**
 * 指定した要素名の子要素を1つ返す（直下のみ）。
 * @param {!LawNode} node 親ノード
 * @param {string} name 要素名
 * @return {?LawNode} 該当する子要素。なければ null
 */
function firstChild(node, name) {
  var found = childElements(node, name);
  return found.length > 0 ? found[0] : null;
}

/**
 * ノード直下の全子要素（テキストを除く）を返す。
 * @param {!LawNode} node 親ノード
 * @return {!Array<!LawNode>} 子要素の配列
 */
function elementChildren(node) {
  if (!node || !node.children) {
    return [];
  }
  return node.children.filter(function (child) {
    return typeof child === 'object';
  });
}

/**
 * 木構造を深さ優先で探索し、最初に見つかった指定要素を返す。
 * @param {!LawNode} node 起点ノード
 * @param {string} name 要素名
 * @return {?LawNode} 見つかった要素。なければ null
 */
function findDescendant(node, name) {
  if (!node || typeof node !== 'object') {
    return null;
  }
  if (node.name === name) {
    return node;
  }
  var children = elementChildren(node);
  for (var i = 0; i < children.length; i++) {
    var found = findDescendant(children[i], name);
    if (found) {
      return found;
    }
  }
  return null;
}

/**
 * ノード配下のテキストをすべて連結して返す。
 *
 * ルビ（Ruby/Rt）は本文の読みであり条文そのものではないため、
 * Rt要素の内容は括弧付きで併記する（情報を失わないため削除はしない）。
 *
 * @param {(!LawNode|string|null)} node 対象ノード
 * @return {string} 連結したテキスト
 */
function getTextContent(node) {
  if (node === null || node === undefined) {
    return '';
  }
  if (typeof node === 'string') {
    return node;
  }
  if (node.name === 'Rt') {
    // ルビの読み。本文と区別できるよう括弧で囲む。
    return '（' + node.children.map(getTextContent).join('') + '）';
  }
  return node.children.map(getTextContent).join('');
}

/**
 * ノードのテキストを取得し、XMLの整形に由来する空白のみを除去する。
 *
 * 重要: 全角スペース（U+3000）は法令原文の一部（例:「第一編　総則」）であり、
 * 半角スペースへ置換してはならない。ここで除去するのは
 * XMLを人間可読に整形した際の改行とインデントだけである。
 *
 * @param {(!LawNode|string|null)} node 対象ノード
 * @return {string} 整形済みテキスト
 */
function getTrimmedText(node) {
  return getTextContent(node)
    .replace(/[\r\n]+[ \t]*/g, '')  // 改行＋インデントを除去（原文の文字ではない）
    .replace(/[ \t]{2,}/g, ' ')      // 連続する半角空白・タブのみ1つに畳む
    .trim();
}

/**
 * e-Gov の法令本文JSON表現を、本ファイルの木構造（LawNode）へ変換する。
 *
 * 背景
 * ----
 * 法令API v2 は law_full_text_format=json を指定すると、法令本文を
 * XMLと同じ構造のJSONとして返す。その形は次のとおりで、
 * 本ファイルが生成する LawNode とキー名が違うだけである。
 *
 *   { "tag": "Article", "attr": { "Num": "1" }, "children": [ ... ] }
 *      tag      → LawNode.name
 *      attr     → LawNode.attrs
 *      children → LawNode.children（入れ子のノード、または本文の文字列）
 *
 * この変換により、XMLで取得できた場合と同じ処理
 * （Markdown変換・構造化JSON生成）をそのまま流用できる。
 *
 * 注意: これは表現形式の相互変換であり、本文の加工ではない。
 * 文字列は一切書き換えない。
 *
 * @param {(!Object|string)} jsonNode e-Gov のJSONノード
 * @return {(!LawNode|string)} 変換後のノード
 * @throws {Error} 変換できない形式の場合
 */
function convertJsonToLawNode(jsonNode) {
  if (typeof jsonNode === 'string') {
    return jsonNode;
  }
  if (!jsonNode || typeof jsonNode !== 'object') {
    throw new Error('法令本文JSONの形式が想定と異なります');
  }

  // tag / name のどちらで来ても扱えるようにする
  var name = jsonNode.tag || jsonNode.name || jsonNode.Tag;
  if (!name) {
    throw new Error('法令本文JSONに要素名（tag）がありません');
  }

  var sourceAttrs = jsonNode.attr || jsonNode.attrs || jsonNode.Attr || {};
  var attrs = {};
  Object.keys(sourceAttrs).forEach(function (key) {
    var value = sourceAttrs[key];
    if (value !== null && value !== undefined) {
      attrs[key] = String(value);
    }
  });

  var children = [];
  var sourceChildren = jsonNode.children || jsonNode.Children || [];
  if (Array.isArray(sourceChildren)) {
    sourceChildren.forEach(function (child) {
      if (child === null || child === undefined) {
        return;
      }
      if (typeof child === 'string') {
        // 要素間の空白のみの文字列は、XML解析時と同様に無視する
        if (!/^[\s　]*$/.test(child)) {
          children.push(child);
        }
        return;
      }
      children.push(convertJsonToLawNode(child));
    });
  } else if (typeof sourceChildren === 'string') {
    children.push(sourceChildren);
  }

  return { name: name, attrs: attrs, children: children };
}

/**
 * 取得した法令本文を、形式を問わず木構造（LawNode）へ変換する。
 *
 * @param {(string|!Object)} content 本文（XML文字列、またはJSONノード）
 * @param {string} format 'xml' または 'json'
 * @return {!LawNode} ルート要素のノード
 * @throws {Error} 解析できない場合
 */
function parseLawContent(content, format) {
  if (format === 'json') {
    var node = convertJsonToLawNode(content);
    if (typeof node === 'string') {
      throw new Error('法令本文JSONのルートが要素ではありません');
    }
    return node;
  }
  return parseLawXml(String(content));
}
