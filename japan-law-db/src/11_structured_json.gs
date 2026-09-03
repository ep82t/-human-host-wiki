/**
 * @file 11_structured_json.gs
 * 法令XMLから、条・項・号を機械可読な単位へ分解した構造化JSONを生成する。
 * 将来のRAG（検索・引用）で「根拠条文」を正確に示すための土台となる。
 *
 * 出力の1件（LawUnit）は次の形をとる。
 * {
 *   law_id, law_name,
 *   part, chapter, section, subsection, division,  // 所属する階層のタイトル
 *   article,        // '第一条'
 *   article_num,    // '1'（XMLのNum属性）
 *   paragraph,      // '1'
 *   item,           // '一' または null
 *   subitem,        // 'イ' などの細分（連結表記）または null
 *   text,           // 原文（改変しない）
 *   citation,       // '所得税法 第一条 第1項 第一号'
 *   path            // 階層の配列（デバッグ・絞り込み用）
 * }
 */

/**
 * 法令XMLから構造化JSONを生成する。
 *
 * @param {string} xmlText 法令XML
 * @param {!Object} meta メタデータ（law_id / law_name を含む）
 * @return {{law_id: string, law_name: string, generated_at: string,
 *           unit_count: number, units: !Array<!Object>}}
 */
function buildStructuredJson(xmlText, meta) {
  return buildStructuredJsonFromTree(parseLawXml(xmlText), meta);
}

/**
 * 解析済みの法令木構造から構造化JSONを生成する。
 *
 * 取得形式がXMLでもJSONでも、木構造へ変換したあとは同じ処理を通る。
 *
 * @param {!LawNode} root 法令のルートノード
 * @param {!Object} meta メタデータ（law_id / law_name を含む）
 * @return {{law_id: string, law_name: string, generated_at: string,
 *           unit_count: number, units: !Array<!Object>}}
 */
function buildStructuredJsonFromTree(root, meta) {
  var info = meta || {};
  var lawTitleNode = findDescendant(root, 'LawTitle');
  var lawName = info.law_name || (lawTitleNode ? getTrimmedText(lawTitleNode) : '');
  var lawId = info.law_id || '';

  var units = [];
  var body = findDescendant(root, 'LawBody') || root;

  var mainProvision = firstChild(body, 'MainProvision');
  if (mainProvision) {
    collectUnits_(mainProvision, emptyContext_('本則'), units, lawId, lawName);
  }

  childElements(body, 'SupplProvision').forEach(function (suppl) {
    var labelNode = firstChild(suppl, 'SupplProvisionLabel');
    var label = labelNode ? getTrimmedText(labelNode) : '附則';
    var amend = suppl.attrs.AmendLawNum ? '（' + suppl.attrs.AmendLawNum + '）' : '';
    collectUnits_(suppl, emptyContext_(label + amend), units, lawId, lawName);
  });

  return {
    law_id: lawId,
    law_name: lawName,
    law_number: info.law_number || '',
    source: 'e-Gov法令検索',
    source_url: info.source_url || '',
    generated_at: nowIso(),
    schema_version: CONFIG.SCHEMA_VERSION,
    unit_count: units.length,
    units: units
  };
}

/**
 * 空の階層コンテキストを作る。
 * @param {string} division 所属区分（'本則' / '附則'）
 * @return {!Object} コンテキスト
 * @private
 */
function emptyContext_(division) {
  return {
    division_label: division,
    part: null,
    chapter: null,
    section: null,
    subsection: null,
    subdivision: null
  };
}

/**
 * 階層を辿りながら条・項・号の単位を収集する。
 *
 * @param {!Object} node 対象ノード
 * @param {!Object} context 現在の階層コンテキスト
 * @param {!Array<!Object>} units 収集先
 * @param {string} lawId 法令ID
 * @param {string} lawName 法令名
 * @private
 */
function collectUnits_(node, context, units, lawId, lawName) {
  elementChildren(node).forEach(function (child) {
    var name = child.name;

    if (CONTAINER_ELEMENTS[name]) {
      var titleNode = firstChild(child, CONTAINER_ELEMENTS[name].titleTag);
      var title = titleNode ? getTrimmedText(titleNode) : '';
      var nextContext = cloneContext_(context);
      var contextKey = {
        Part: 'part', Chapter: 'chapter', Section: 'section',
        Subsection: 'subsection', Division: 'subdivision'
      }[name];
      nextContext[contextKey] = title;
      collectUnits_(child, nextContext, units, lawId, lawName);
      return;
    }

    if (name === 'Article') {
      collectArticleUnits_(child, context, units, lawId, lawName);
      return;
    }

    // 附則直下の項など、条に属さない要素
    if (name === 'Paragraph') {
      collectParagraphUnits_(child, context, null, null, units, lawId, lawName);
      return;
    }

    // 別表等は条文ではないため単位化しない（Markdown/XML側に保持される）
    if (/^Appdx/.test(name) || name === 'TableStruct' || /Title$|Label$/.test(name)) {
      return;
    }

    collectUnits_(child, context, units, lawId, lawName);
  });
}

/**
 * 1つの条について、項・号の単位を収集する。
 *
 * @param {!Object} article Article要素
 * @param {!Object} context 階層コンテキスト
 * @param {!Array<!Object>} units 収集先
 * @param {string} lawId 法令ID
 * @param {string} lawName 法令名
 * @private
 */
function collectArticleUnits_(article, context, units, lawId, lawName) {
  var titleNode = firstChild(article, 'ArticleTitle');
  var captionNode = firstChild(article, 'ArticleCaption');
  var articleTitle = titleNode ? getTrimmedText(titleNode) : '';
  var articleNum = article.attrs.Num || '';
  var caption = captionNode ? getTrimmedText(captionNode) : '';

  childElements(article, 'Paragraph').forEach(function (paragraph) {
    collectParagraphUnits_(
      paragraph, context, articleTitle, articleNum, units, lawId, lawName, caption);
  });
}

/**
 * 1つの項について、項本体と各号の単位を収集する。
 *
 * @param {!Object} paragraph Paragraph要素
 * @param {!Object} context 階層コンテキスト
 * @param {?string} articleTitle 条のタイトル
 * @param {?string} articleNum 条のNum属性
 * @param {!Array<!Object>} units 収集先
 * @param {string} lawId 法令ID
 * @param {string} lawName 法令名
 * @param {string=} caption 条見出し
 * @private
 */
function collectParagraphUnits_(
    paragraph, context, articleTitle, articleNum, units, lawId, lawName, caption) {
  var paragraphNum = paragraph.attrs.Num || '1';
  var sentenceNode = firstChild(paragraph, 'ParagraphSentence');
  var paragraphText = sentenceNode ? renderSentenceGroup_(sentenceNode) : '';

  if (paragraphText) {
    units.push(makeUnit_({
      lawId: lawId, lawName: lawName, context: context, caption: caption,
      articleTitle: articleTitle, articleNum: articleNum,
      paragraph: paragraphNum, item: null, subitem: null, text: paragraphText
    }));
  }

  childElements(paragraph, 'Item').forEach(function (item) {
    collectItemUnits_(
      item, context, articleTitle, articleNum, paragraphNum, [], units, lawId, lawName, caption);
  });
}

/**
 * 号およびその細分（イ・ロ・ハ…）の単位を収集する。
 *
 * @param {!Object} item Item / Subitem{N} 要素
 * @param {!Object} context 階層コンテキスト
 * @param {?string} articleTitle 条のタイトル
 * @param {?string} articleNum 条のNum属性
 * @param {string} paragraphNum 項番号
 * @param {!Array<string>} subitemTitles 上位の細分タイトル
 * @param {!Array<!Object>} units 収集先
 * @param {string} lawId 法令ID
 * @param {string} lawName 法令名
 * @param {string=} caption 条見出し
 * @private
 */
function collectItemUnits_(
    item, context, articleTitle, articleNum, paragraphNum, subitemTitles,
    units, lawId, lawName, caption) {
  var titleNode = elementChildren(item).filter(function (c) {
    return /Title$/.test(c.name);
  })[0];
  var sentenceNode = elementChildren(item).filter(function (c) {
    return /Sentence$/.test(c.name);
  })[0];

  var title = titleNode ? getTrimmedText(titleNode) : '';
  var text = sentenceNode ? renderSentenceGroup_(sentenceNode) : '';

  var isSubitem = SUBITEM_LEVELS.indexOf(item.name) !== -1;
  var itemTitle = isSubitem ? (subitemTitles.length > 0 ? subitemTitles[0] : null) : title;
  var subitemChain = isSubitem ? subitemTitles.concat([title]) : [];

  if (text) {
    units.push(makeUnit_({
      lawId: lawId, lawName: lawName, context: context, caption: caption,
      articleTitle: articleTitle, articleNum: articleNum,
      paragraph: paragraphNum,
      item: isSubitem ? itemTitle : (title || null),
      subitem: isSubitem ? subitemChain.slice(1).join('') || title : null,
      text: text
    }));
  }

  elementChildren(item).forEach(function (child) {
    if (SUBITEM_LEVELS.indexOf(child.name) === -1) {
      return;
    }
    var nextChain = isSubitem ? subitemChain : [title];
    collectItemUnits_(
      child, context, articleTitle, articleNum, paragraphNum, nextChain,
      units, lawId, lawName, caption);
  });
}

/**
 * 単位オブジェクトを組み立て、引用表記（citation）を付与する。
 *
 * @param {!Object} spec 単位の構成要素
 * @return {!Object} LawUnit
 * @private
 */
function makeUnit_(spec) {
  var citationParts = [spec.lawName];
  if (spec.articleTitle) {
    citationParts.push(spec.articleTitle);
  }
  if (spec.paragraph) {
    citationParts.push('第' + spec.paragraph + '項');
  }
  if (spec.item) {
    citationParts.push('第' + spec.item + '号');
  }
  if (spec.subitem) {
    citationParts.push(spec.subitem);
  }

  var path = [spec.context.division_label];
  ['part', 'chapter', 'section', 'subsection', 'subdivision'].forEach(function (key) {
    if (spec.context[key]) {
      path.push(spec.context[key]);
    }
  });
  if (spec.articleTitle) {
    path.push(spec.articleTitle);
  }

  return {
    law_id: spec.lawId,
    law_name: spec.lawName,
    division: spec.context.division_label,
    part: spec.context.part,
    chapter: spec.context.chapter,
    section: spec.context.section,
    subsection: spec.context.subsection,
    subdivision: spec.context.subdivision,
    article: spec.articleTitle || null,
    article_num: spec.articleNum || null,
    article_caption: spec.caption || null,
    paragraph: spec.paragraph || null,
    item: spec.item || null,
    subitem: spec.subitem || null,
    text: spec.text,
    citation: citationParts.join(' '),
    path: path
  };
}

/**
 * 階層コンテキストを複製する。
 * @param {!Object} context 元のコンテキスト
 * @return {!Object} 複製
 * @private
 */
function cloneContext_(context) {
  return {
    division_label: context.division_label,
    part: context.part,
    chapter: context.chapter,
    section: context.section,
    subsection: context.subsection,
    subdivision: context.subdivision
  };
}
