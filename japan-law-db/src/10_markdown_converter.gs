/**
 * @file 10_markdown_converter.gs
 * 法令XML から Markdown への機械的変換。
 *
 * 絶対条件
 * --------
 * 条文本文の要約・意訳・改変を一切行わない。
 * 変換は「構造のマークアップ」だけであり、文字列そのものは原文のまま出力する。
 *
 * 未知の要素が現れた場合も、テキストを捨てずに再帰的に拾う
 * （フォールバック処理）。これによりスキーマ変更があっても本文が欠落しない。
 *
 * 見出しレベルの方針
 * ------------------
 *   #      法令名
 *   ##     編 / 附則 / 別表 など
 *   ###    章
 *   ####   節
 *   #####  款
 *   ###### 目
 *   条     直近の親より1段深い見出し（最大 ###### まで）
 * 項・号は見出しではなく、番号付きの本文行として構造を保持する。
 * 厳密な条・項・号の識別子は structured JSON 側で保持する。
 */

/** @const {number} Markdownの見出し最大レベル */
var MAX_HEADING_LEVEL = 6;

/**
 * 階層コンテナ要素の定義（要素名 → 見出しレベルとタイトル要素名）。
 * @const {!Object<string, {level: number, titleTag: string}>}
 */
var CONTAINER_ELEMENTS = {
  Part: { level: 2, titleTag: 'PartTitle' },
  Chapter: { level: 3, titleTag: 'ChapterTitle' },
  Section: { level: 4, titleTag: 'SectionTitle' },
  Subsection: { level: 5, titleTag: 'SubsectionTitle' },
  Division: { level: 6, titleTag: 'DivisionTitle' }
};

/**
 * 「号」より下の細分（イ・ロ・ハ…）の要素名。Subitem1〜Subitem10。
 * @const {!Array<string>}
 */
var SUBITEM_LEVELS = (function () {
  var levels = [];
  for (var i = 1; i <= 10; i++) {
    levels.push('Subitem' + i);
  }
  return levels;
})();

/**
 * 法令XMLをMarkdownへ変換する。
 *
 * @param {string} xmlText 法令XML（原本）
 * @param {!Object} meta メタデータ（YAML Front Matterに書き出す内容）
 * @return {{markdown: string, lawTitle: string, lawNum: string, warnings: !Array<string>}}
 * @throws {Error} XMLが解析できない場合
 */
function convertLawXmlToMarkdown(xmlText, meta) {
  var root = parseLawXml(xmlText);
  var warnings = [];

  if (root.attrs && root.attrs.__unclosed) {
    warnings.push('XMLに閉じられていない要素があります（本文は取得済み）');
  }

  var lawTitleNode = findDescendant(root, 'LawTitle');
  var lawNumNode = findDescendant(root, 'LawNum');
  var lawTitle = lawTitleNode ? getTrimmedText(lawTitleNode) : (meta && meta.law_name) || '';
  var lawNum = lawNumNode ? getTrimmedText(lawNumNode) : (meta && meta.law_number) || '';

  var out = [];

  // --- YAML Front Matter ---
  out.push(buildFrontMatter(meta || {}));
  out.push('');

  // --- 見出し ---
  out.push('# ' + (lawTitle || '(法令名不明)'));
  out.push('');
  if (lawNum) {
    out.push('法令番号：' + lawNum);
    out.push('');
  }
  out.push('取得元：e-Gov法令検索');
  out.push('');
  if (meta && meta.source_url) {
    out.push('法令ページ：' + meta.source_url);
    out.push('');
  }
  out.push('---');
  out.push('');

  var body = findDescendant(root, 'LawBody');
  var target = body || root;

  // --- 前文・制定文 ---
  var enactStatements = childElements(target, 'EnactStatement');
  enactStatements.forEach(function (node) {
    out.push(getTrimmedText(node));
    out.push('');
  });

  var preamble = firstChild(target, 'Preamble');
  if (preamble) {
    out.push('## 前文');
    out.push('');
    renderNode_(preamble, out, 2, warnings);
    out.push('');
  }

  // --- 目次 ---
  var toc = firstChild(target, 'TOC');
  if (toc) {
    out.push('## 目次');
    out.push('');
    renderTableOfContents_(toc, out);
    out.push('');
  }

  // --- 本則 ---
  var mainProvision = firstChild(target, 'MainProvision');
  if (mainProvision) {
    elementChildren(mainProvision).forEach(function (child) {
      renderNode_(child, out, 1, warnings);
    });
  } else {
    warnings.push('MainProvision（本則）が見つかりませんでした');
  }

  // --- 附則・別表など、LawBody直下の残りの要素 ---
  var handledTop = {
    LawTitle: true, TOC: true, MainProvision: true,
    EnactStatement: true, Preamble: true
  };
  elementChildren(target).forEach(function (child) {
    if (handledTop[child.name]) {
      return;
    }
    renderNode_(child, out, 1, warnings);
  });

  var markdown = out.join('\n').replace(/\n{4,}/g, '\n\n\n').replace(/\s+$/, '') + '\n';

  return {
    markdown: markdown,
    lawTitle: lawTitle,
    lawNum: lawNum,
    warnings: warnings
  };
}

/**
 * YAML Front Matter を組み立てる。
 * 値は必ずクォートし、YAMLとして壊れないようにする。
 *
 * @param {!Object} meta メタデータ
 * @return {string} '---' で囲まれたFront Matter
 */
function buildFrontMatter(meta) {
  var lines = ['---'];
  Object.keys(meta).forEach(function (key) {
    var value = meta[key];
    if (value === null || value === undefined) {
      lines.push(key + ': null');
      return;
    }
    if (Array.isArray(value)) {
      lines.push(key + ':');
      value.forEach(function (item) {
        lines.push('  - ' + yamlScalar(item));
      });
      return;
    }
    lines.push(key + ': ' + yamlScalar(value));
  });
  lines.push('---');
  return lines.join('\n');
}

/**
 * YAMLのスカラー値を安全にクォートする。
 * @param {*} value 値
 * @return {string} YAML表現
 */
function yamlScalar(value) {
  if (typeof value === 'boolean' || typeof value === 'number') {
    return String(value);
  }
  var s = String(value === null || value === undefined ? '' : value);
  return '"' + s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, ' ') + '"';
}

/**
 * 目次を箇条書きとして出力する。
 * @param {!Object} toc TOC要素
 * @param {!Array<string>} out 出力バッファ
 * @private
 */
function renderTableOfContents_(toc, out) {
  var TOC_DEPTH = {
    TOCPart: 0, TOCChapter: 1, TOCSection: 2,
    TOCSubsection: 3, TOCDivision: 4, TOCArticle: 1,
    TOCSupplProvision: 0, TOCAppdxTableLabel: 0
  };

  function walk(node, depth) {
    elementChildren(node).forEach(function (child) {
      if (child.name === 'TOCLabel') {
        return;
      }
      // タイトル要素は親側で既に出力されているため重複出力しない
      if (/Title$|Label$/.test(child.name)) {
        return;
      }
      var childDepth = TOC_DEPTH[child.name];
      if (childDepth === undefined) {
        // 未知の目次要素もテキストだけは残す
        var text = getTrimmedText(child);
        if (text) {
          out.push(repeat_('  ', depth) + '- ' + text);
        }
        return;
      }
      var titleNode = elementChildren(child).filter(function (c) {
        return /Title$|Label$/.test(c.name);
      })[0];
      var label = titleNode ? getTrimmedText(titleNode) : getTrimmedText(child);
      if (label) {
        out.push(repeat_('  ', childDepth) + '- ' + label);
      }
      walk(child, childDepth + 1);
    });
  }
  walk(toc, 0);
}

/**
 * ノードをMarkdownへ変換して出力バッファへ追加する（再帰）。
 *
 * @param {!Object} node 対象ノード
 * @param {number} parentLevel 親の見出しレベル
 * @param {!Array<string>} out 出力バッファ
 * @param {!Array<string>} warnings 警告の蓄積先
 * @private
 */
function renderNode_(node, out, parentLevel, warnings) {
  if (!node || typeof node !== 'object') {
    return;
  }
  var name = node.name;

  // --- 編・章・節・款・目 ---
  var container = CONTAINER_ELEMENTS[name];
  if (container) {
    var titleNode = firstChild(node, container.titleTag);
    var title = titleNode ? getTrimmedText(titleNode) : '';
    if (title) {
      out.push(heading_(container.level) + ' ' + title);
      out.push('');
    }
    elementChildren(node).forEach(function (child) {
      if (child.name === container.titleTag) {
        return;
      }
      renderNode_(child, out, container.level, warnings);
    });
    return;
  }

  // --- 条 ---
  if (name === 'Article') {
    renderArticle_(node, out, parentLevel, warnings);
    return;
  }

  // --- 附則 ---
  if (name === 'SupplProvision') {
    renderSupplProvision_(node, out, warnings);
    return;
  }

  // --- 別表・様式・付録類 ---
  if (/^Appdx/.test(name) || name === 'Appdx') {
    renderAppendix_(node, out, warnings);
    return;
  }

  // --- 項（条に属さない場合もある） ---
  if (name === 'Paragraph') {
    renderParagraph_(node, out, warnings);
    return;
  }

  // --- 表 ---
  if (name === 'TableStruct') {
    renderTableStruct_(node, out, warnings);
    return;
  }

  // --- 改正規定など、条を内包し得るコンテナ ---
  if (name === 'AmendProvision' || name === 'SupplProvisionAppdxTable' ||
      name === 'SupplProvisionAppdx' || name === 'SupplProvisionAppdxStyle') {
    var label = firstChildTextByPattern_(node, /Title$|Label$/);
    if (label) {
      out.push(heading_(Math.min(parentLevel + 1, MAX_HEADING_LEVEL)) + ' ' + label);
      out.push('');
    }
    elementChildren(node).forEach(function (child) {
      if (/Title$|Label$/.test(child.name)) {
        return;
      }
      renderNode_(child, out, parentLevel + 1, warnings);
    });
    return;
  }

  // --- 上記以外（未知要素を含む）: 本文を失わないためのフォールバック ---
  renderFallback_(node, out, parentLevel, warnings);
}

/**
 * 条を出力する。
 * @param {!Object} article Article要素
 * @param {!Array<string>} out 出力バッファ
 * @param {number} parentLevel 親の見出しレベル
 * @param {!Array<string>} warnings 警告の蓄積先
 * @private
 */
function renderArticle_(article, out, parentLevel, warnings) {
  var level = Math.min(parentLevel + 1, MAX_HEADING_LEVEL);
  var titleNode = firstChild(article, 'ArticleTitle');
  var captionNode = firstChild(article, 'ArticleCaption');

  var title = titleNode ? getTrimmedText(titleNode) : ('第' + (article.attrs.Num || '') + '条');
  var caption = captionNode ? getTrimmedText(captionNode) : '';

  out.push(heading_(level) + ' ' + title + (caption ? '　' + caption : ''));
  out.push('');

  elementChildren(article).forEach(function (child) {
    if (child.name === 'ArticleTitle' || child.name === 'ArticleCaption') {
      return;
    }
    if (child.name === 'Paragraph') {
      renderParagraph_(child, out, warnings);
      return;
    }
    renderNode_(child, out, level, warnings);
  });
}

/**
 * 項を出力する。
 * 第1項で項番号表記がない場合は番号を付けず、原文の見え方を保つ。
 *
 * @param {!Object} paragraph Paragraph要素
 * @param {!Array<string>} out 出力バッファ
 * @param {!Array<string>} warnings 警告の蓄積先
 * @private
 */
function renderParagraph_(paragraph, out, warnings) {
  var captionNode = firstChild(paragraph, 'ParagraphCaption');
  if (captionNode) {
    var caption = getTrimmedText(captionNode);
    if (caption) {
      out.push(caption);
      out.push('');
    }
  }

  var numNode = firstChild(paragraph, 'ParagraphNum');
  var numText = numNode ? getTrimmedText(numNode) : '';
  var sentenceNode = firstChild(paragraph, 'ParagraphSentence');
  var body = sentenceNode ? renderSentenceGroup_(sentenceNode) : '';

  var line = numText ? (numText + '　' + body) : body;
  if (line.trim()) {
    out.push(line);
    out.push('');
  }

  elementChildren(paragraph).forEach(function (child) {
    if (child.name === 'ParagraphNum' || child.name === 'ParagraphCaption' ||
        child.name === 'ParagraphSentence') {
      return;
    }
    if (child.name === 'Item') {
      renderItem_(child, out, 0, warnings);
      return;
    }
    renderNode_(child, out, MAX_HEADING_LEVEL, warnings);
  });
}

/**
 * 号（およびその細分）を出力する。インデントで階層を表現する。
 *
 * @param {!Object} item Item / Subitem{N} 要素
 * @param {!Array<string>} out 出力バッファ
 * @param {number} depth インデントの深さ
 * @param {!Array<string>} warnings 警告の蓄積先
 * @private
 */
function renderItem_(item, out, depth, warnings) {
  var titleNode = elementChildren(item).filter(function (c) {
    return /Title$/.test(c.name);
  })[0];
  var sentenceNode = elementChildren(item).filter(function (c) {
    return /Sentence$/.test(c.name);
  })[0];

  var title = titleNode ? getTrimmedText(titleNode) : '';
  var body = sentenceNode ? renderSentenceGroup_(sentenceNode) : '';
  var indent = repeat_('　', depth);

  var line = indent + (title ? title + '　' : '') + body;
  if (line.trim()) {
    out.push(line);
    out.push('');
  }

  elementChildren(item).forEach(function (child) {
    if (/Title$/.test(child.name) || /Sentence$/.test(child.name)) {
      return;
    }
    if (SUBITEM_LEVELS.indexOf(child.name) !== -1) {
      renderItem_(child, out, depth + 1, warnings);
      return;
    }
    renderNode_(child, out, MAX_HEADING_LEVEL, warnings);
  });
}

/**
 * Sentence群（ParagraphSentence / ItemSentence など）をテキスト化する。
 * Column（表形式の項目）は全角スペースで区切って原文の並びを保つ。
 *
 * @param {!Object} node Sentence群を含む要素
 * @return {string} 連結したテキスト
 * @private
 */
function renderSentenceGroup_(node) {
  var columns = childElements(node, 'Column');
  if (columns.length > 0) {
    return columns.map(function (col) {
      return getTrimmedText(col);
    }).filter(function (t) {
      return t !== '';
    }).join('　');
  }

  var sentences = childElements(node, 'Sentence');
  if (sentences.length > 0) {
    return sentences.map(getTrimmedText).filter(function (t) {
      return t !== '';
    }).join('');
  }

  return getTrimmedText(node);
}

/**
 * 附則を出力する。
 * @param {!Object} node SupplProvision要素
 * @param {!Array<string>} out 出力バッファ
 * @param {!Array<string>} warnings 警告の蓄積先
 * @private
 */
function renderSupplProvision_(node, out, warnings) {
  var labelNode = firstChild(node, 'SupplProvisionLabel');
  var label = labelNode ? getTrimmedText(labelNode) : '附則';
  var amendLawNum = node.attrs.AmendLawNum || '';

  out.push('## ' + label + (amendLawNum ? '（' + amendLawNum + '）' : ''));
  out.push('');

  if (node.attrs.Extract === 'true') {
    out.push('※ この附則は抄録（抜粋）です。');
    out.push('');
  }

  elementChildren(node).forEach(function (child) {
    if (child.name === 'SupplProvisionLabel') {
      return;
    }
    renderNode_(child, out, 2, warnings);
  });
}

/**
 * 別表・様式などの付録類を出力する。
 * @param {!Object} node Appdx系要素
 * @param {!Array<string>} out 出力バッファ
 * @param {!Array<string>} warnings 警告の蓄積先
 * @private
 */
function renderAppendix_(node, out, warnings) {
  var title = firstChildTextByPattern_(node, /Title$|Label$/);
  out.push('## ' + (title || node.name));
  out.push('');

  var related = firstChild(node, 'RelatedArticleNum');
  if (related) {
    out.push(getTrimmedText(related));
    out.push('');
  }

  elementChildren(node).forEach(function (child) {
    if (/Title$|Label$/.test(child.name) || child.name === 'RelatedArticleNum') {
      return;
    }
    renderNode_(child, out, 2, warnings);
  });
}

/**
 * 表をMarkdownの表として出力する。
 * セル内改行はMarkdownの表を壊すため <br> へ置換する（文字は削除しない）。
 *
 * @param {!Object} tableStruct TableStruct要素
 * @param {!Array<string>} out 出力バッファ
 * @param {!Array<string>} warnings 警告の蓄積先
 * @private
 */
function renderTableStruct_(tableStruct, out, warnings) {
  var titleNode = firstChild(tableStruct, 'TableStructTitle');
  if (titleNode) {
    out.push('**' + getTrimmedText(titleNode) + '**');
    out.push('');
  }

  var table = firstChild(tableStruct, 'Table');
  if (!table) {
    renderFallback_(tableStruct, out, MAX_HEADING_LEVEL, warnings);
    return;
  }

  var rows = childElements(table, 'TableRow').concat(childElements(table, 'TableHeaderRow'));
  if (rows.length === 0) {
    renderFallback_(table, out, MAX_HEADING_LEVEL, warnings);
    return;
  }

  var matrix = rows.map(function (row) {
    var cells = elementChildren(row).filter(function (c) {
      return c.name === 'TableColumn' || c.name === 'TableHeaderColumn';
    });
    return cells.map(function (cell) {
      return getTrimmedText(cell).replace(/\|/g, '\\|').replace(/\n/g, '<br>');
    });
  });

  var width = matrix.reduce(function (max, row) {
    return Math.max(max, row.length);
  }, 0);
  if (width === 0) {
    return;
  }

  // 1行目をヘッダとして扱う（法令の表はヘッダ行を持つことが多い）
  var header = padRow_(matrix[0], width);
  out.push('| ' + header.join(' | ') + ' |');
  out.push('|' + repeat_(' --- |', width));
  for (var i = 1; i < matrix.length; i++) {
    out.push('| ' + padRow_(matrix[i], width).join(' | ') + ' |');
  }
  out.push('');
}

/**
 * 未知・その他の要素を、本文を失わずに出力するフォールバック。
 * 子要素があれば再帰し、テキストだけの要素はそのまま1行として出す。
 *
 * @param {!Object} node 対象ノード
 * @param {!Array<string>} out 出力バッファ
 * @param {number} parentLevel 親の見出しレベル
 * @param {!Array<string>} warnings 警告の蓄積先
 * @private
 */
function renderFallback_(node, out, parentLevel, warnings) {
  var children = elementChildren(node);

  // 構造を持つ要素は再帰する
  var hasStructural = children.some(function (child) {
    return CONTAINER_ELEMENTS[child.name] || child.name === 'Article' ||
      child.name === 'Paragraph' || child.name === 'Item' ||
      child.name === 'TableStruct' || /^Appdx/.test(child.name) ||
      child.name === 'SupplProvision';
  });

  if (hasStructural) {
    children.forEach(function (child) {
      renderNode_(child, out, parentLevel, warnings);
    });
    return;
  }

  // 画像は参照情報を残す（本文には現れないが出典として重要）
  if (node.name === 'Fig' && node.attrs.src) {
    out.push('（図：' + node.attrs.src + '）');
    out.push('');
    return;
  }

  var text = getTrimmedText(node);
  if (text) {
    out.push(text);
    out.push('');
  }
}

/**
 * 指定パターンに一致する最初の子要素のテキストを返す。
 * @param {!Object} node 親ノード
 * @param {!RegExp} pattern 要素名のパターン
 * @return {string} テキスト（見つからなければ ''）
 * @private
 */
function firstChildTextByPattern_(node, pattern) {
  var found = elementChildren(node).filter(function (c) {
    return pattern.test(c.name);
  })[0];
  return found ? getTrimmedText(found) : '';
}

/**
 * 行の列数を揃える。
 * @param {!Array<string>} row 行
 * @param {number} width 目標の列数
 * @return {!Array<string>} 列数を揃えた行
 * @private
 */
function padRow_(row, width) {
  var result = row.slice();
  while (result.length < width) {
    result.push('');
  }
  return result;
}

/**
 * 指定レベルの見出し記号を返す。
 * @param {number} level 見出しレベル（1-6）
 * @return {string} '#' の連なり
 * @private
 */
function heading_(level) {
  var clamped = Math.max(1, Math.min(level, MAX_HEADING_LEVEL));
  return repeat_('#', clamped);
}

/**
 * 文字列を繰り返す（GASのランタイム差異を避けるため自前で実装）。
 * @param {string} text 繰り返す文字列
 * @param {number} count 回数
 * @return {string} 繰り返した結果
 * @private
 */
function repeat_(text, count) {
  var result = '';
  for (var i = 0; i < count; i++) {
    result += text;
  }
  return result;
}
