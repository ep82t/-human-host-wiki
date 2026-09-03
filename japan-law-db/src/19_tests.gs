/**
 * @file 19_tests.gs
 * テストスイート。
 *
 * runAllTests() を実行すると、要求されたテスト項目をすべて検証する。
 * 実際のe-Gov APIへはアクセスせず、HTTP通信をテスト用の関数へ差し替えて実行するため、
 * 公的APIに負荷をかけずに何度でも実行できる。
 *
 * Drive操作については、専用のテスト用フォルダを作成して実行し、
 * 終了時に片付ける（本番データには触れない）。
 */

/** @private {!Array<!Object>} テスト結果の蓄積先 */
var testResults_ = [];

/**
 * すべてのテストを実行する。
 *
 * @return {{total: number, passed: number, failed: number, results: !Array<!Object>}}
 */
function runAllTests() {
  testResults_ = [];

  console.log('===== テストを開始します =====');
  console.log('');

  // --- 純粋なロジックのテスト（外部サービス不要） ---
  test_設定ファイルの検証();
  test_APIのURL組み立て();
  test_法令種別の正規化();
  test_廃止法令の判定();
  test_レスポンス項目の寛容な読み取り();
  test_XML解析();
  test_XML解析エラー();
  test_Markdown変換();
  test_Markdown変換で原文が改変されないこと();
  test_構造化JSONの生成();
  test_ハッシュ計算と差分検出();
  test_CSV生成();

  // --- Drive・API を伴うテスト ---
  test_初回フォルダ作成();
  test_2回目実行でフォルダが重複しないこと();
  test_所得税法の取得();
  test_健康保険法の取得();
  test_同期時に変更がない場合();
  test_同期時に変更がある場合();
  test_APIエラー時に全体が停止しないこと();
  test_Drive書き込みエラー();
  test_法令検索結果が0件();
  test_法令検索結果が複数件();
  test_トリガーの重複防止();
  test_DryRunでファイルを書き換えないこと();
  test_単一法令の同期();
  test_カテゴリ単位の同期();
  test_長期間未同期時のフォールバック();
  test_廃止法令のステータス記録();
  test_本文がJSON形式で返る場合();
  test_XMLとJSONで同じ結果になること();
  test_部分一致で本命法令が埋もれる場合();

  return summarizeTests_();
}

// ============================================================
// テスト本体
// ============================================================

/** 設定ファイルが検証を通ること。 */
function test_設定ファイルの検証() {
  runTest_('設定ファイルの検証', function () {
    var result = validateLawsConfig();
    assertEquals_(0, result.errors.length,
      '設定エラーがない（' + result.errors.join(' / ') + '）');
    assertTrue_(result.valid.length >= 45, '45件以上の法令が登録されている');

    // 不正な設定が検出されること
    var bad = validateLawsConfig([
      { category: 'unknown_category', name: 'テスト法', enabled: true }
    ]);
    assertEquals_(1, bad.errors.length, '未定義カテゴリが検出される');
  });
}

/** URL組み立てが仕様マップどおりに行われること。 */
function test_APIのURL組み立て() {
  runTest_('APIのURL組み立て', function () {
    var contentParams = {};
    contentParams[EGOV_API_SPEC.PARAMS.LAW_FULL_TEXT_FORMAT] = EGOV_API_SPEC.FORMATS.XML;
    var url = buildEgovUrl('LAW_DATA',
      { lawIdOrNumOrRevisionId: '340AC0000000033' }, contentParams);
    assertEquals_(
      EGOV_API_SPEC.BASE_URL + '/law_data/340AC0000000033?law_full_text_format=xml',
      url, 'law_data のURLが正しい（law_full_text_format を使う）');

    // パスパラメータ不足は例外になる
    assertThrows_(function () {
      buildEgovUrl('LAW_DATA', {}, {});
    }, 'パスパラメータ不足で例外になる');

    // 空の値はクエリに含めない
    var url2 = buildEgovUrl('LAWS', {}, { law_title: '所得税法', limit: null });
    assertTrue_(url2.indexOf('limit') === -1, '空の値はクエリに含まれない');

    // 人間向けURLとAPI URLが区別されること
    var humanUrl = buildHumanLawUrl('340AC0000000033');
    assertTrue_(humanUrl.indexOf('/api/') === -1, '法令ページURLはAPIのURLではない');
  });
}

/** 法令種別が英語・日本語どちらの表記でも正規化されること。 */
function test_法令種別の正規化() {
  runTest_('法令種別の正規化', function () {
    assertEquals_('act', normalizeLawType('Act'), '英語のActを正規化');
    assertEquals_('cabinet_order', normalizeLawType('CabinetOrder'), '英語のCabinetOrder');
    assertEquals_('ministerial_ordinance',
      normalizeLawType('MinisterialOrdinance'), '英語のMinisterialOrdinance');
    assertEquals_('act', normalizeLawType('法律'), '日本語の法律');
    assertEquals_('cabinet_order', normalizeLawType('政令'), '日本語の政令');
    assertEquals_('ministerial_ordinance', normalizeLawType('省令'), '日本語の省令');
    assertEquals_('other', normalizeLawType(''), '空文字はother');

    // 法令番号からの推定
    assertEquals_('act',
      inferLawTypeFromNum('昭和四十年法律第三十三号'), '法令番号から法律を推定');
    assertEquals_('cabinet_order',
      inferLawTypeFromNum('昭和四十年政令第九十六号'), '法令番号から政令を推定');
  });
}

/** 廃止・失効の判定が公式フィールドに基づくこと。 */
function test_廃止法令の判定() {
  runTest_('廃止法令の判定', function () {
    assertEquals_(CONFIG.STATUS.ACTIVE,
      determineLawStatus({ repeal_status: '', repeal_date: '' }), '情報なしはactive');
    assertEquals_(CONFIG.STATUS.REPEALED,
      determineLawStatus({ repeal_status: 'Repeal', repeal_date: '' }), '英語のRepeal');
    assertEquals_(CONFIG.STATUS.REPEALED,
      determineLawStatus({ repeal_status: '廃止', repeal_date: '' }), '日本語の廃止');
    assertEquals_(CONFIG.STATUS.EXPIRED,
      determineLawStatus({ repeal_status: 'Expire', repeal_date: '' }), '失効');
    assertEquals_(CONFIG.STATUS.REPEALED,
      determineLawStatus({ repeal_status: '', repeal_date: '2020-01-01' }),
      '過去の廃止日はrepealed');
    assertEquals_(CONFIG.STATUS.ACTIVE,
      determineLawStatus({ repeal_status: 'None', repeal_date: '' }), 'Noneはactive');
  });
}

/** レスポンス項目名が想定と異なっても値が読めること。 */
function test_レスポンス項目の寛容な読み取り() {
  runTest_('レスポンス項目の寛容な読み取り', function () {
    var F = EGOV_API_SPEC.FIELD_CANDIDATES;

    // snake_case
    assertEquals_('340AC0000000033',
      pickField({ law_id: '340AC0000000033' }, F.LAW_ID, ''), 'snake_caseで読める');

    // camelCase
    assertEquals_('340AC0000000033',
      pickField({ lawId: '340AC0000000033' }, F.LAW_ID, ''), 'camelCaseで読める');

    // ネストした構造
    assertEquals_('所得税法',
      pickField({ revision_info: { law_title: '所得税法' } }, F.LAW_TITLE, ''),
      'ネストした項目を読める');

    // 想定外の命名でも正規化により読める
    assertEquals_('340AC0000000033',
      pickField({ 'Law-ID': '340AC0000000033' }, F.LAW_ID, ''),
      '記号違いの項目名でも読める');

    // 見つからない場合はフォールバック
    assertEquals_('', pickField({ foo: 'bar' }, F.LAW_ID, ''), '該当なしはフォールバック');

    // 一覧の取り出し（配列そのもの／項目名つきの両方）
    assertEquals_(2, pickLawList([{ a: 1 }, { b: 2 }]).length, '配列そのものを扱える');
    assertEquals_(1, pickLawList({ laws: [{ a: 1 }] }).length, 'laws項目から取り出せる');
    assertEquals_(1, pickLawList({ items: [{ a: 1 }] }).length, 'items項目から取り出せる');
  });
}

/** 法令XMLが正しく解析されること。 */
function test_XML解析() {
  runTest_('XML解析', function () {
    var root = parseLawXml(getTestLawXml_('所得税法', '昭和四十年法律第三十三号'));

    assertEquals_('Law', root.name, 'ルート要素がLaw');
    assertEquals_('Act', root.attrs.LawType, '属性が読める');
    assertEquals_('所得税法',
      getTrimmedText(findDescendant(root, 'LawTitle')), '法令名が取れる');
    assertEquals_('昭和四十年法律第三十三号',
      getTrimmedText(findDescendant(root, 'LawNum')), '法令番号が取れる');

    // エンティティの復元
    var entityRoot = parseLawXml(
      '<Law><LawNum>x</LawNum><LawBody><LawTitle>A&amp;B&lt;C&gt;</LawTitle></LawBody></Law>');
    assertEquals_('A&B<C>',
      getTrimmedText(findDescendant(entityRoot, 'LawTitle')), 'エンティティが復元される');

    // 空要素タグ
    var selfClosing = parseLawXml(
      '<Law><LawNum>x</LawNum><LawBody><ParagraphNum/><LawTitle>T</LawTitle></LawBody></Law>');
    assertEquals_('T',
      getTrimmedText(findDescendant(selfClosing, 'LawTitle')), '空要素タグを扱える');

    // 全角スペースが保持されること（原文の一部であるため）
    var spaced = parseLawXml('<Law><PartTitle>第一編　総則</PartTitle></Law>');
    assertEquals_('第一編　総則',
      getTrimmedText(findDescendant(spaced, 'PartTitle')), '全角スペースが保持される');
  });
}

/** 壊れたXMLでエラーになること（黙って不正なデータを保存しない）。 */
function test_XML解析エラー() {
  runTest_('XML解析エラー', function () {
    assertThrows_(function () { parseLawXml(''); }, '空文字は例外');
    assertThrows_(function () { parseLawXml('これはXMLではありません'); }, '非XMLは例外');

    // 閉じタグ不足は例外にせず、印を付けて本文を守る
    var partial = parseLawXml('<Law><LawBody><LawTitle>所得税法</LawTitle></Law>');
    assertTrue_(!!partial.attrs.__unclosed, '閉じられていない要素に印が付く');
    assertEquals_('所得税法',
      getTrimmedText(findDescendant(partial, 'LawTitle')), '本文は失われない');
  });
}

/** Markdown変換で構造が保持されること。 */
function test_Markdown変換() {
  runTest_('Markdown変換', function () {
    var xml = getTestLawXml_('所得税法', '昭和四十年法律第三十三号');
    var result = convertLawXmlToMarkdown(xml, {
      law_name: '所得税法', law_id: '340AC0000000033', status: 'active'
    });
    var md = result.markdown;

    assertTrue_(md.indexOf('---') === 0, 'YAML Front Matterで始まる');
    assertTrue_(md.indexOf('law_name: "所得税法"') !== -1, 'メタデータが含まれる');
    assertTrue_(md.indexOf('# 所得税法') !== -1, '法令名が見出しになる');
    assertTrue_(md.indexOf('## 第一編　総則') !== -1, '編が見出しになる');
    assertTrue_(md.indexOf('### 第一章　通則') !== -1, '章が見出しになる');
    assertTrue_(md.indexOf('#### 第一条') !== -1, '条が見出しになる');
    assertTrue_(md.indexOf('一　国内') !== -1, '号が保持される');
    assertTrue_(md.indexOf('2　第二項の本文') !== -1, '第2項の番号が保持される');
    assertTrue_(md.indexOf('## 附　則') !== -1, '附則が保持される');
    assertEquals_('所得税法', result.lawTitle, '法令名が返る');
  });
}

/** 変換によって条文の文字列が改変されないこと（最重要）。 */
function test_Markdown変換で原文が改変されないこと() {
  runTest_('Markdown変換で原文が改変されないこと', function () {
    var sentence = 'この法律は、所得税について、納税義務者、課税所得の範囲、' +
      '税額の計算の方法、申告、納付及び還付の手続を定めるものとする。';
    var xml = '<Law Era="Showa" LawType="Act" Num="33" Year="40">' +
      '<LawNum>昭和四十年法律第三十三号</LawNum><LawBody>' +
      '<LawTitle>所得税法</LawTitle><MainProvision>' +
      '<Article Num="1"><ArticleTitle>第一条</ArticleTitle>' +
      '<Paragraph Num="1"><ParagraphNum/><ParagraphSentence>' +
      '<Sentence>' + sentence + '</Sentence>' +
      '</ParagraphSentence></Paragraph></Article>' +
      '</MainProvision></LawBody></Law>';

    var result = convertLawXmlToMarkdown(xml, { law_name: '所得税法' });

    assertTrue_(result.markdown.indexOf(sentence) !== -1,
      '条文が1文字も変わらずに出力される');

    // 要約された痕跡がないこと（本文が短くなっていない）
    assertTrue_(result.markdown.length > sentence.length,
      '本文が削られていない');
  });
}

/** 構造化JSONが条・項・号を正しく分解すること。 */
function test_構造化JSONの生成() {
  runTest_('構造化JSONの生成', function () {
    var xml = getTestLawXml_('所得税法', '昭和四十年法律第三十三号');
    var json = buildStructuredJson(xml, {
      law_id: '340AC0000000033', law_name: '所得税法'
    });

    assertTrue_(json.unit_count >= 4, '複数の条文単位に分解される');

    var first = json.units[0];
    assertEquals_('第一条', first.article, '条が識別できる');
    assertEquals_('1', first.paragraph, '項が識別できる');
    assertEquals_('第一章　通則', first.chapter, '所属する章が保持される');
    assertEquals_('本則', first.division, '本則と附則が区別される');
    assertTrue_(first.citation.indexOf('所得税法 第一条 第1項') === 0,
      '引用表記が生成される');

    // 号が単位化されていること
    var itemUnits = json.units.filter(function (u) { return u.item === '一'; });
    assertTrue_(itemUnits.length >= 1, '号が単位として取り出される');

    // 附則が本則と区別されていること
    var supplUnits = json.units.filter(function (u) {
      return u.division.indexOf('附') === 0;
    });
    assertTrue_(supplUnits.length >= 1, '附則が本則と区別される');
  });
}

/** ハッシュ計算と差分検出が正しく動くこと。 */
function test_ハッシュ計算と差分検出() {
  runTest_('ハッシュ計算と差分検出', function () {
    var hash = computeSha256Hex('abc');
    assertEquals_(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
      hash, 'SHA-256の既知の値と一致する');
    assertEquals_(64, hash.length, '16進64文字である');

    var xml = getTestLawXml_('所得税法', '昭和四十年法律第三十三号');
    assertEquals_(computeLawHash(xml), computeLawHash(xml), '同じ入力は同じハッシュ');
    assertEquals_(computeLawHash(xml), computeLawHash(xml.replace(/\n/g, '\r\n')),
      '改行コードの違いで差分と誤判定しない');
    assertTrue_(computeLawHash(xml) !== computeLawHash(xml.replace('所得税法', '法人税法')),
      '内容が違えばハッシュも違う');

    assertTrue_(isSameHash('a', 'a'), '同一ハッシュを検出できる');
    assertTrue_(!isSameHash('a', 'b'), '異なるハッシュを検出できる');
    assertTrue_(!isSameHash(null, null), 'null同士は同一と判定しない');
  });
}

/** CSVが正しくエスケープされること。 */
function test_CSV生成() {
  runTest_('CSV生成', function () {
    var csv = buildCsv(['a', 'b'], [['1', 'カンマ,入り'], ['"引用符"', '改行\n入り']]);
    assertTrue_(csv.indexOf('"カンマ,入り"') !== -1, 'カンマがエスケープされる');
    assertTrue_(csv.indexOf('"""引用符"""') !== -1, '引用符がエスケープされる');
    assertTrue_(csv.charCodeAt(0) === 0xFEFF, 'BOMが付与される');
  });
}

/** 初回実行でフォルダ構成が作成されること。 */
function test_初回フォルダ作成() {
  runTest_('初回フォルダ作成', function () {
    withTestContext_(function (ctx) {
      var paths = ensureFolderStructure(ctx.driveService);

      assertTrue_(paths.length > 20, '多数のフォルダが作成される');
      assertTrue_(hasFolder_(ctx.root, CONFIG.FOLDERS.SYSTEM), '00_システム情報がある');
      assertTrue_(hasFolder_(ctx.root, CONFIG.CATEGORIES.tax.folderName), '01_税制がある');
      assertTrue_(hasFolder_(ctx.root, CONFIG.FOLDERS.RAW_XML), '90_RAW_XMLがある');
      assertTrue_(hasFolder_(ctx.root, CONFIG.FOLDERS.SYSTEM_LOG), '99_システムログがある');

      var taxFolder = getFolder_(ctx.root, CONFIG.CATEGORIES.tax.folderName);
      assertTrue_(hasFolder_(taxFolder, '01_法律'), '税制配下に01_法律がある');
      assertTrue_(hasFolder_(taxFolder, '02_政令'), '税制配下に02_政令がある');
      assertTrue_(hasFolder_(taxFolder, '03_省令'), '税制配下に03_省令がある');
      assertTrue_(hasFolder_(taxFolder, CONFIG.FOLDERS.HISTORY), '税制配下に99_履歴がある');
    });
  });
}

/** 2回実行してもフォルダが重複しないこと（冪等性）。 */
function test_2回目実行でフォルダが重複しないこと() {
  runTest_('2回目実行でフォルダが重複しないこと', function () {
    withTestContext_(function (ctx) {
      ensureFolderStructure(ctx.driveService);
      var countAfterFirst = countFolders_(ctx.root);

      // キャッシュを使わない新しいサービスで再実行する
      var second = new DriveService(ctx.rootId, ctx.logger);
      ensureFolderStructure(second);
      var countAfterSecond = countFolders_(ctx.root);

      assertEquals_(countAfterFirst, countAfterSecond,
        '2回目の実行でフォルダが増えない');
      assertEquals_(1, countFoldersByName_(ctx.root, CONFIG.FOLDERS.SYSTEM),
        '00_システム情報は1つだけ');
    });
  });
}

/** 所得税法を取得して保存できること。 */
function test_所得税法の取得() {
  runTest_('所得税法の取得', function () {
    withTestContext_(function (ctx) {
      stubEgovApi_({
        '所得税法': {
          lawId: '340AC0000000033',
          lawNum: '昭和四十年法律第三十三号',
          lawType: 'Act'
        }
      });

      var summary = runSync({ runName: 'test', lawName: '所得税法', dryRun: false });

      assertEquals_(1, summary.target_count, '対象が1件');
      assertEquals_(1, summary.updated_count, '1件更新される');
      assertEquals_(0, summary.failed_count, '失敗がない');

      // 原本XMLが保存されていること
      var rawFolder = ctx.driveService.getRawXmlFolder('tax');
      var xmlContent = ctx.driveService.readTextFile(rawFolder, '所得税法.xml');
      assertTrue_(!!xmlContent, '原本XMLが保存されている');
      assertTrue_(xmlContent.indexOf('<Law') !== -1, '原本XMLがXMLのまま保存されている');

      // Markdownが保存されていること
      var mdFolder = ctx.driveService.getMarkdownFolder('tax', 'act');
      var mdContent = ctx.driveService.readTextFile(mdFolder, '所得税法.md');
      assertTrue_(!!mdContent, 'Markdownが保存されている');
      assertTrue_(mdContent.indexOf('# 所得税法') !== -1, 'Markdownに法令名がある');
      assertTrue_(mdContent.indexOf('law_id: "340AC0000000033"') !== -1,
        'メタデータに法令IDが記録される');
      assertTrue_(mdContent.indexOf('retrieved_at') !== -1, '取得日時が記録される');

      // 台帳に記録されていること
      var state = loadSyncState(ctx.driveService);
      var record = state.laws['340AC0000000033'];
      assertTrue_(!!record, '台帳にレコードがある');
      assertEquals_('所得税法', record.law_name, '法令名が記録される');
      assertEquals_('active', record.status, 'ステータスが記録される');
      assertTrue_(!!record.xml_file_id, 'XMLのファイルIDが記録される');
      assertTrue_(!!record.markdown_file_id, 'MarkdownのファイルIDが記録される');
      assertTrue_(!!record.last_hash, 'ハッシュが記録される');
      assertTrue_(record.source_url.indexOf('/api/') === -1,
        'source_urlは人間向けURLである');
      assertTrue_(record.api_source_url.indexOf('/api/') !== -1,
        'api_source_urlはAPIのURLである');
    });
  });
}

/** 健康保険法（別カテゴリ）を取得できること。 */
function test_健康保険法の取得() {
  runTest_('健康保険法の取得', function () {
    withTestContext_(function (ctx) {
      stubEgovApi_({
        '健康保険法': {
          lawId: '211AC0000000070',
          lawNum: '大正十一年法律第七十号',
          lawType: 'Act'
        }
      });

      var summary = runSync({ runName: 'test', lawName: '健康保険法', dryRun: false });
      assertEquals_(1, summary.updated_count, '1件更新される');

      // 社会保険カテゴリのフォルダへ保存されること
      var mdFolder = ctx.driveService.getMarkdownFolder('social_insurance', 'act');
      var mdContent = ctx.driveService.readTextFile(mdFolder, '健康保険法.md');
      assertTrue_(!!mdContent, '社会保険フォルダにMarkdownがある');
      assertTrue_(mdContent.indexOf('category: "社会保険"') !== -1,
        'カテゴリが正しく記録される');

      var rawFolder = ctx.driveService.getRawXmlFolder('social_insurance');
      assertTrue_(!!ctx.driveService.readTextFile(rawFolder, '健康保険法.xml'),
        '社会保険の原本XMLが保存されている');
    });
  });
}

/** 内容に変更がない場合、ファイルを書き換えないこと。 */
function test_同期時に変更がない場合() {
  runTest_('同期時に変更がない場合', function () {
    withTestContext_(function (ctx) {
      stubEgovApi_({
        '所得税法': { lawId: '340AC0000000033', lawNum: '昭和四十年法律第三十三号' }
      });

      runSync({ runName: 'test', lawName: '所得税法', dryRun: false });

      var state = loadSyncState(ctx.driveService);
      var fileId = state.laws['340AC0000000033'].markdown_file_id;
      var writesBefore = getWriteCountForTest_(fileId);

      var second = runSync({ runName: 'test', lawName: '所得税法', dryRun: false });

      assertEquals_(1, second.unchanged_count, '変更なしと判定される');
      assertEquals_(0, second.updated_count, '更新されない');
      assertEquals_(writesBefore, getWriteCountForTest_(fileId),
        'ファイルが書き換えられていない');

      // 履歴が作られていないこと
      var historyFolder = ctx.driveService.getHistoryFolder('tax');
      assertEquals_(0, countFiles_(historyFolder), '履歴ファイルが作られない');
    });
  });
}

/** 内容に変更がある場合、履歴を残して更新すること。 */
function test_同期時に変更がある場合() {
  runTest_('同期時に変更がある場合', function () {
    withTestContext_(function (ctx) {
      stubEgovApi_({
        '所得税法': { lawId: '340AC0000000033', lawNum: '昭和四十年法律第三十三号' }
      });
      runSync({ runName: 'test', lawName: '所得税法', dryRun: false });

      // 法令が改正されたものとしてXMLを差し替える
      stubEgovApi_({
        '所得税法': {
          lawId: '340AC0000000033',
          lawNum: '昭和四十年法律第三十三号',
          extraSentence: '改正により追加された条文である。'
        }
      });

      var second = runSync({ runName: 'test', lawName: '所得税法', dryRun: false });
      assertEquals_(1, second.updated_count, '変更が検出され更新される');

      // 新しい内容が反映されていること
      var mdFolder = ctx.driveService.getMarkdownFolder('tax', 'act');
      var mdContent = ctx.driveService.readTextFile(mdFolder, '所得税法.md');
      assertTrue_(mdContent.indexOf('改正により追加された条文である。') !== -1,
        '改正後の条文が保存される');

      // 改正前のデータが履歴に残っていること
      var historyFolder = ctx.driveService.getHistoryFolder('tax');
      assertTrue_(countFiles_(historyFolder) >= 2,
        '改正前のMarkdownとXMLが履歴へ退避される');

      var historyNames = listFileNames_(historyFolder);
      assertTrue_(historyNames.some(function (n) { return /^所得税法_\d{8}_\d{6}\.md$/.test(n); }),
        '履歴ファイル名が「法令名_日時.md」形式である');

      // ファイルIDが変わっていないこと（同名ファイルを増やしていない）
      var state = loadSyncState(ctx.driveService);
      assertEquals_(1, countFilesByName_(mdFolder, '所得税法.md'),
        '同名ファイルが重複していない');
      assertEquals_(2, state.laws['340AC0000000033'].revision_count,
        '更新回数が記録される');
    });
  });
}

/** 1件のAPIエラーで全体処理が止まらないこと。 */
function test_APIエラー時に全体が停止しないこと() {
  runTest_('APIエラー時に全体が停止しないこと', function () {
    withTestContext_(function (ctx) {
      // 所得税法だけ失敗し、法人税法は成功する状況を作る
      stubEgovApi_({
        '法人税法': { lawId: '340AC0000000034', lawNum: '昭和四十年法律第三十四号' }
      }, { failFor: ['所得税法'] });

      var summary = runSync({ runName: 'test', categoryKey: 'tax', dryRun: false });

      assertTrue_(summary.failed_count + summary.skipped_count > 0, '失敗が記録される');
      assertTrue_(summary.updated_count >= 1, '失敗があっても他の法令は保存される');
      assertTrue_(summary.failures.length > 0, '失敗内容が記録される');

      // 法人税法は保存されていること
      var mdFolder = ctx.driveService.getMarkdownFolder('tax', 'act');
      assertTrue_(!!ctx.driveService.readTextFile(mdFolder, '法人税法.md'),
        '成功した法令は保存されている');
    });
  });
}

/** Drive書き込みエラーが記録され、全体が停止しないこと。 */
function test_Drive書き込みエラー() {
  runTest_('Drive書き込みエラー', function () {
    withTestContext_(function (ctx) {
      stubEgovApi_({
        '所得税法': { lawId: '340AC0000000033', lawNum: '昭和四十年法律第三十三号' }
      });

      setDriveWriteFailureForTest_(true);
      var summary = runSync({ runName: 'test', lawName: '所得税法', dryRun: false });
      setDriveWriteFailureForTest_(false);

      assertTrue_(summary.failed_count >= 1, 'Drive書き込みエラーが失敗として記録される');
      assertTrue_(summary.failures.length >= 1, '失敗理由が残る');
      assertTrue_(!!summary.finished_at, '例外で処理が中断せず最後まで到達する');
    });
  });
}

/** 検索結果0件のとき、推測で別の法令を保存しないこと。 */
function test_法令検索結果が0件() {
  runTest_('法令検索結果が0件', function () {
    withTestContext_(function (ctx) {
      stubEgovApi_({});  // 何も一致しない

      var summary = runSync({ runName: 'test', lawName: '所得税法', dryRun: false });

      assertEquals_(0, summary.updated_count, '何も保存されない');
      assertEquals_(1, summary.skipped_count, 'スキップとして記録される');
      assertTrue_(summary.failures[0].reason.indexOf('見つかりません') !== -1,
        '検索結果0件が理由として記録される');

      // 誤ったファイルが作られていないこと
      var mdFolder = ctx.driveService.getMarkdownFolder('tax', 'act');
      assertEquals_(0, countFiles_(mdFolder), '誤った法令ファイルが作られていない');
    });
  });
}

/** 検索結果が複数件のとき、自動決定せずWARNとして記録すること。 */
function test_法令検索結果が複数件() {
  runTest_('法令検索結果が複数件', function () {
    withTestContext_(function (ctx) {
      // 同名の法令が2件返る状況（自動決定してはいけない）
      stubMultipleCandidates_('所得税法', [
        { law_id: '340AC0000000033', law_num: '昭和四十年法律第三十三号', law_type: 'Act' },
        { law_id: '999AC0000000099', law_num: '令和六年法律第九十九号', law_type: 'Act' }
      ]);

      var summary = runSync({ runName: 'test', lawName: '所得税法', dryRun: false });

      assertEquals_(0, summary.updated_count, '曖昧な場合は保存しない');
      assertEquals_(1, summary.skipped_count, 'スキップとして記録される');
      assertTrue_(summary.failures[0].reason.indexOf('確定できません') !== -1,
        '自動確定できない旨が記録される');
      assertTrue_(summary.warnings.length > 0, 'WARNが記録される');

      var mdFolder = ctx.driveService.getMarkdownFolder('tax', 'act');
      assertEquals_(0, countFiles_(mdFolder), '誤った法令が保存されていない');
    });
  });
}

/** トリガーが重複登録されないこと。 */
function test_トリガーの重複防止() {
  runTest_('トリガーの重複防止', function () {
    removeTrigger();

    var first = installTrigger();
    assertTrue_(first.created, '1回目でトリガーが作成される');
    assertEquals_(1, findTriggersByHandler_(CONFIG.TRIGGER.HANDLER_FUNCTION).length,
      'トリガーが1件ある');

    var second = installTrigger();
    assertTrue_(!second.created, '2回目は作成されない');
    assertEquals_(1, findTriggersByHandler_(CONFIG.TRIGGER.HANDLER_FUNCTION).length,
      'トリガーは1件のままである');

    var removed = removeTrigger();
    assertEquals_(1, removed.removed, 'トリガーを削除できる');
    assertEquals_(0, findTriggersByHandler_(CONFIG.TRIGGER.HANDLER_FUNCTION).length,
      'トリガーが削除されている');
  });
}

/** Dry Runでは既存ファイルを書き換えないこと。 */
function test_DryRunでファイルを書き換えないこと() {
  runTest_('Dry Runでファイルを書き換えないこと', function () {
    withTestContext_(function (ctx) {
      stubEgovApi_({
        '所得税法': { lawId: '340AC0000000033', lawNum: '昭和四十年法律第三十三号' }
      });
      runSync({ runName: 'test', lawName: '所得税法', dryRun: false });

      var state = loadSyncState(ctx.driveService);
      var fileId = state.laws['340AC0000000033'].markdown_file_id;
      var writesBefore = getWriteCountForTest_(fileId);
      var stateBefore = JSON.stringify(state);

      // 改正があった状態にしてDry Runする
      stubEgovApi_({
        '所得税法': {
          lawId: '340AC0000000033',
          lawNum: '昭和四十年法律第三十三号',
          extraSentence: 'Dry Run用の改正条文。'
        }
      });

      var summary = runSync({ runName: 'test', lawName: '所得税法', dryRun: true });

      assertTrue_(summary.dry_run, 'Dry Runとして実行される');
      assertEquals_(1, summary.updated_count, '更新予定として検出される');
      assertTrue_(summary.planned_changes.length > 0, '変更予定の内容がログに残る');

      assertEquals_(writesBefore, getWriteCountForTest_(fileId),
        'Drive上のファイルが書き換えられていない');
      assertEquals_(stateBefore, JSON.stringify(loadSyncState(ctx.driveService)),
        '台帳が書き換えられていない');

      var mdContent = ctx.driveService.readFileById(fileId);
      assertTrue_(mdContent.indexOf('Dry Run用の改正条文。') === -1,
        '新しい内容は書き込まれていない');
    });
  });
}

/** 単一法令の同期が、指定した法令だけを対象にすること。 */
function test_単一法令の同期() {
  runTest_('単一法令の同期', function () {
    withTestContext_(function (ctx) {
      stubEgovApi_({
        '所得税法': { lawId: '340AC0000000033', lawNum: '昭和四十年法律第三十三号' },
        '法人税法': { lawId: '340AC0000000034', lawNum: '昭和四十年法律第三十四号' }
      });

      var summary = syncSingleLaw('所得税法');

      assertEquals_(1, summary.target_count, '対象が1件だけである');
      assertEquals_('single_law', summary.strategy, '単一法令の方式で実行される');

      var mdFolder = ctx.driveService.getMarkdownFolder('tax', 'act');
      assertTrue_(!!ctx.driveService.readTextFile(mdFolder, '所得税法.md'),
        '指定した法令が保存される');
      assertTrue_(!ctx.driveService.readTextFile(mdFolder, '法人税法.md'),
        '指定していない法令は取得されない');

      // 設定にない法令名を指定した場合
      var missing = syncSingleLaw('存在しない法令名');
      assertTrue_(missing.failed_count >= 1, '未登録の法令名はエラーになる');
    });
  });
}

/** カテゴリ単位の同期が、そのカテゴリだけを対象にすること。 */
function test_カテゴリ単位の同期() {
  runTest_('カテゴリ単位の同期', function () {
    withTestContext_(function (ctx) {
      stubEgovApi_({
        '雇用保険法': { lawId: '349AC0000000116', lawNum: '昭和四十九年法律第百十六号' }
      });

      var summary = runSync({
        runName: 'test', categoryKey: 'labor_insurance', dryRun: false
      });

      assertEquals_('category', summary.strategy, 'カテゴリ方式で実行される');
      assertEquals_(getEnabledLaws('labor_insurance').length, summary.target_count,
        '労働保険の法令だけが対象になる');

      var laborFolder = ctx.driveService.getMarkdownFolder('labor_insurance', 'act');
      assertTrue_(!!ctx.driveService.readTextFile(laborFolder, '雇用保険法.md'),
        '労働保険の法令が保存される');

      // 不正なカテゴリ
      var invalid = syncCategory('存在しないカテゴリ');
      assertTrue_(!invalid.ok, '不正なカテゴリは拒否される');
    });
  });
}

/** 長期間同期していない場合、全件再取得へフォールバックすること。 */
function test_長期間未同期時のフォールバック() {
  runTest_('長期間未同期時のフォールバック', function () {
    withTestContext_(function (ctx) {
      stubEgovApi_({}, { updatedLawsEmpty: true });

      // 前回同期を「しきい値を超えた過去」に設定する
      var longAgo = new Date(
        Date.now() - (CONFIG.SYNC.FULL_RESYNC_AFTER_DAYS + 10) * 24 * 3600 * 1000);
      setLastSyncAt(longAgo.toISOString());

      var summary = runSync({ runName: 'test', dryRun: true });

      assertEquals_('fallback_full_resync', summary.strategy,
        '長期間未同期のため全件再取得へフォールバックする');
      assertEquals_(getEnabledLaws().length, summary.target_count,
        '全対象法令が確認対象になる');

      // 直近に同期していて更新0件の場合も、誤って「更新なし」と断定しないこと
      setLastSyncAt(new Date().toISOString());
      var recent = runSync({ runName: 'test', dryRun: true });
      assertEquals_('fallback_zero_updates', recent.strategy,
        '更新0件でもハッシュ比較で全件確認する');
    });
  });
}

/** 廃止された法令が削除されず、ステータスとして記録されること。 */
function test_廃止法令のステータス記録() {
  runTest_('廃止法令のステータス記録', function () {
    withTestContext_(function (ctx) {
      stubEgovApi_({
        '所得税法': {
          lawId: '340AC0000000033',
          lawNum: '昭和四十年法律第三十三号',
          repealStatus: 'Repeal',
          repealDate: '2020-03-31'
        }
      });

      var summary = runSync({ runName: 'test', lawName: '所得税法', dryRun: false });

      assertEquals_(1, summary.updated_count, '廃止法令でも取得・保存される');

      var state = loadSyncState(ctx.driveService);
      var record = state.laws['340AC0000000033'];
      assertEquals_('repealed', record.status, 'ステータスがrepealedになる');
      assertEquals_('2020-03-31', record.repeal_date, '廃止日が記録される');

      // ファイルが削除されていないこと
      var mdFolder = ctx.driveService.getMarkdownFolder('tax', 'act');
      var mdContent = ctx.driveService.readTextFile(mdFolder, '所得税法.md');
      assertTrue_(!!mdContent, '廃止法令のファイルは削除されない');
      assertTrue_(mdContent.indexOf('status: "repealed"') !== -1,
        'Markdownにも廃止ステータスが記録される');

      assertTrue_(summary.warnings.length > 0, '廃止についてWARNが記録される');
    });
  });
}

// ============================================================
// テスト用のヘルパー
// ============================================================

/**
 * テスト用のフォルダとプロパティを用意し、終了後に元へ戻す。
 *
 * @param {function(!Object)} body テスト本体
 * @private
 */
function withTestContext_(body) {
  var logger = createLogger('test');
  var savedRootId = getRootFolderId();
  var savedLastSync = getLastSyncAt();

  var testRoot = DriveApp.getRootFolder().createFolder(
    '__test_日本法令DB_' + timestampForFileName(new Date()) + '_' +
    Math.floor(Math.random() * 100000));

  try {
    setRootFolderId(testRoot.getId());
    deleteProp(CONFIG.PROPERTY_KEYS.LAST_SYNC_AT);

    var driveService = new DriveService(testRoot.getId(), logger);
    ensureFolderStructure(driveService);

    body({
      root: testRoot,
      rootId: testRoot.getId(),
      driveService: driveService,
      logger: logger
    });

  } finally {
    // 後片付け（本番データには触れない）
    setHttpOverrideForTest(null);
    setDriveWriteFailureForTest_(false);
    try {
      testRoot.setTrashed(true);
    } catch (e) {
      console.log('テストフォルダの片付けに失敗しました: ' + describeError(e));
    }
    if (savedRootId) {
      setRootFolderId(savedRootId);
    } else {
      deleteProp(CONFIG.PROPERTY_KEYS.ROOT_FOLDER_ID);
    }
    if (savedLastSync) {
      setLastSyncAt(savedLastSync);
    } else {
      deleteProp(CONFIG.PROPERTY_KEYS.LAST_SYNC_AT);
    }
  }
}

/**
 * e-Gov APIの応答を差し替える。
 *
 * @param {!Object<string, !Object>} lawsByName 法令名 → 応答内容の定義
 * @param {!Object=} options { failFor: !Array<string>, updatedLawsEmpty: boolean }
 * @private
 */
function stubEgovApi_(lawsByName, options) {
  var opts = options || {};
  var failFor = opts.failFor || [];

  setHttpOverrideForTest(function (url) {
    // --- 更新法令情報 ---
    if (url.indexOf('/laws?') !== -1 && url.indexOf('updated_from') !== -1) {
      return okJson_(url, { laws: [] });
    }

    // --- 法令検索 ---
    if (url.indexOf('/laws?') !== -1 || url.indexOf('/keyword?') !== -1) {
      var searched = decodeURIComponent(url).match(/(?:law_title|keyword)=([^&]+)/);
      var name = searched ? searched[1] : '';

      if (failFor.indexOf(name) !== -1) {
        return errorResult_(url, 503, 'サーバエラー（テスト）');
      }
      var found = lawsByName[name];
      if (!found) {
        return okJson_(url, { laws: [] });
      }
      return okJson_(url, {
        laws: [{
          law_info: {
            law_id: found.lawId,
            law_num: found.lawNum,
            law_type: found.lawType || 'Act',
            promulgation_date: found.promulgationDate || '1965-03-31'
          },
          revision_info: {
            law_title: name,
            law_revision_id: found.revisionId || (found.lawId + '_20240401'),
            amendment_enforcement_date: found.effectiveDate || '2024-04-01',
            amendment_promulgate_date: found.revisionDate || '2024-03-31',
            repeal_status: found.repealStatus || '',
            repeal_date: found.repealDate || ''
          }
        }]
      });
    }

    // --- 法令本文の取得 ---
    if (url.indexOf('/law_data/') !== -1 || url.indexOf('/law_file/') !== -1) {
      var idMatch = url.match(/\/(?:law_data|law_file(?:\/[^/]+)?)\/([^?]+)/);
      var lawId = idMatch ? decodeURIComponent(idMatch[1]) : '';

      var matchedName = null;
      Object.keys(lawsByName).forEach(function (key) {
        if (lawsByName[key].lawId === lawId) {
          matchedName = key;
        }
      });
      if (!matchedName) {
        return errorResult_(url, 404, '法令が見つかりません（テスト）');
      }
      var def = lawsByName[matchedName];
      var xml = getTestLawXml_(matchedName, def.lawNum, def.extraSentence);

      // JSONモード: XMLを返さず、e-Gov v2 と同じ形のJSONを返す
      if (opts.jsonOnly) {
        if (url.indexOf('law_full_text_format=xml') !== -1 ||
            url.indexOf('/law_file/') !== -1) {
          return errorResult_(url, 406, 'XML形式は利用できません（テスト）');
        }
        return okJson_(url, {
          law_info: { law_id: def.lawId, law_num: def.lawNum, law_type: 'Act' },
          revision_info: { law_title: matchedName },
          law_full_text: lawNodeToEgovJson_(parseLawXml(xml))
        });
      }

      return {
        ok: true, status: 200, url: url, attempts: 1, error: null,
        body: xml
      };
    }

    return errorResult_(url, 404, '未対応のURL（テスト）: ' + url);
  });
}

/**
 * 同名の候補が複数返る状況を作る。
 *
 * @param {string} lawName 法令名
 * @param {!Array<!Object>} candidates 候補
 * @private
 */
function stubMultipleCandidates_(lawName, candidates) {
  setHttpOverrideForTest(function (url) {
    if (url.indexOf('/laws?') !== -1 && url.indexOf('updated_from') !== -1) {
      return okJson_(url, { laws: [] });
    }
    if (url.indexOf('/laws?') !== -1 || url.indexOf('/keyword?') !== -1) {
      return okJson_(url, {
        laws: candidates.map(function (c) {
          return {
            law_info: {
              law_id: c.law_id, law_num: c.law_num, law_type: c.law_type
            },
            revision_info: { law_title: lawName }
          };
        })
      });
    }
    return errorResult_(url, 404, '本文は取得されないはず');
  });
}

/**
 * 成功したJSON応答を作る。
 * @param {string} url URL
 * @param {!Object} payload 応答本体
 * @return {!Object} HttpResult
 * @private
 */
function okJson_(url, payload) {
  return {
    ok: true, status: 200, body: JSON.stringify(payload),
    url: url, attempts: 1, error: null
  };
}

/**
 * 失敗した応答を作る。
 * @param {string} url URL
 * @param {number} status HTTPステータス
 * @param {string} message エラーメッセージ
 * @return {!Object} HttpResult
 * @private
 */
function errorResult_(url, status, message) {
  return {
    ok: false, status: status, body: '', url: url, attempts: 1, error: message
  };
}

/**
 * テスト用の法令XMLを生成する。
 *
 * @param {string} lawTitle 法令名
 * @param {string} lawNum 法令番号
 * @param {string=} extraSentence 追加の条文（改正を再現するために使う）
 * @return {string} 法令XML
 * @private
 */
function getTestLawXml_(lawTitle, lawNum, extraSentence) {
  var extra = extraSentence
    ? '<Article Num="3"><ArticleTitle>第三条</ArticleTitle>' +
      '<Paragraph Num="1"><ParagraphNum/><ParagraphSentence>' +
      '<Sentence>' + extraSentence + '</Sentence>' +
      '</ParagraphSentence></Paragraph></Article>'
    : '';

  return '<?xml version="1.0" encoding="UTF-8"?>' +
    '<Law Era="Showa" Lang="ja" LawType="Act" Num="33" Year="40">' +
    '<LawNum>' + lawNum + '</LawNum>' +
    '<LawBody>' +
    '<LawTitle Kana="てすと">' + lawTitle + '</LawTitle>' +
    '<MainProvision>' +
    '<Part Num="1"><PartTitle>第一編　総則</PartTitle>' +
    '<Chapter Num="1"><ChapterTitle>第一章　通則</ChapterTitle>' +
    '<Article Num="1">' +
    '<ArticleCaption>（趣旨）</ArticleCaption>' +
    '<ArticleTitle>第一条</ArticleTitle>' +
    '<Paragraph Num="1"><ParagraphNum/><ParagraphSentence>' +
    '<Sentence>この法律は、' + lawTitle + 'について必要な事項を定めるものとする。</Sentence>' +
    '</ParagraphSentence></Paragraph></Article>' +
    '<Article Num="2">' +
    '<ArticleCaption>（定義）</ArticleCaption>' +
    '<ArticleTitle>第二条</ArticleTitle>' +
    '<Paragraph Num="1"><ParagraphNum/><ParagraphSentence>' +
    '<Sentence>この法律において、次の各号に掲げる用語の意義は、当該各号に定めるところによる。</Sentence>' +
    '</ParagraphSentence>' +
    '<Item Num="1"><ItemTitle>一</ItemTitle><ItemSentence>' +
    '<Column Num="1"><Sentence>国内</Sentence></Column>' +
    '<Column Num="2"><Sentence>この法律の施行地をいう。</Sentence></Column>' +
    '</ItemSentence></Item>' +
    '</Paragraph>' +
    '<Paragraph Num="2"><ParagraphNum>2</ParagraphNum><ParagraphSentence>' +
    '<Sentence>第二項の本文である。</Sentence>' +
    '</ParagraphSentence></Paragraph>' +
    '</Article>' +
    extra +
    '</Chapter></Part>' +
    '</MainProvision>' +
    '<SupplProvision Type="New">' +
    '<SupplProvisionLabel>附　則</SupplProvisionLabel>' +
    '<Article Num="1"><ArticleTitle>第一条</ArticleTitle>' +
    '<Paragraph Num="1"><ParagraphNum/><ParagraphSentence>' +
    '<Sentence>この法律は、公布の日から施行する。</Sentence>' +
    '</ParagraphSentence></Paragraph></Article>' +
    '</SupplProvision>' +
    '</LawBody></Law>';
}

// ------------------------------------------------------------
// Drive検査用のヘルパー
// ------------------------------------------------------------

/**
 * 指定名のサブフォルダが存在するか。
 * @param {!Folder} parent 親フォルダ
 * @param {string} name フォルダ名
 * @return {boolean} 存在すれば true
 * @private
 */
function hasFolder_(parent, name) {
  return parent.getFoldersByName(name).hasNext();
}

/**
 * 指定名のサブフォルダを取得する。
 * @param {!Folder} parent 親フォルダ
 * @param {string} name フォルダ名
 * @return {!Folder} フォルダ
 * @private
 */
function getFolder_(parent, name) {
  var it = parent.getFoldersByName(name);
  if (!it.hasNext()) {
    throw new Error('フォルダが見つかりません: ' + name);
  }
  return it.next();
}

/**
 * フォルダ配下のフォルダ数を再帰的に数える。
 * @param {!Folder} folder 対象フォルダ
 * @return {number} フォルダ数
 * @private
 */
function countFolders_(folder) {
  var count = 0;
  var it = folder.getFolders();
  while (it.hasNext()) {
    count += 1 + countFolders_(it.next());
  }
  return count;
}

/**
 * 指定名のフォルダ数を数える。
 * @param {!Folder} parent 親フォルダ
 * @param {string} name フォルダ名
 * @return {number} 件数
 * @private
 */
function countFoldersByName_(parent, name) {
  var count = 0;
  var it = parent.getFoldersByName(name);
  while (it.hasNext()) {
    it.next();
    count++;
  }
  return count;
}

/**
 * フォルダ直下のファイル数を数える。
 * @param {!Folder} folder 対象フォルダ
 * @return {number} ファイル数
 * @private
 */
function countFiles_(folder) {
  var count = 0;
  var it = folder.getFiles();
  while (it.hasNext()) {
    it.next();
    count++;
  }
  return count;
}

/**
 * 指定名のファイル数を数える。
 * @param {!Folder} folder 対象フォルダ
 * @param {string} name ファイル名
 * @return {number} 件数
 * @private
 */
function countFilesByName_(folder, name) {
  var count = 0;
  var it = folder.getFilesByName(name);
  while (it.hasNext()) {
    it.next();
    count++;
  }
  return count;
}

/**
 * フォルダ直下のファイル名を列挙する。
 * @param {!Folder} folder 対象フォルダ
 * @return {!Array<string>} ファイル名の配列
 * @private
 */
function listFileNames_(folder) {
  var names = [];
  var it = folder.getFiles();
  while (it.hasNext()) {
    names.push(it.next().getName());
  }
  return names;
}

/**
 * ファイルの書き込み回数を返す（テスト環境のみ計測できる）。
 * GAS上では計測できないため、内容のハッシュで代用する。
 *
 * @param {string} fileId ファイルID
 * @return {(number|string)} 書き込み回数、または内容のハッシュ
 * @private
 */
function getWriteCountForTest_(fileId) {
  try {
    var file = DriveApp.getFileById(fileId);
    if (file.writeCount !== undefined) {
      return file.writeCount;   // テスト環境（スタブ）
    }
    return computeSha256Hex(file.getBlob().getDataAsString());  // GAS本番環境
  } catch (e) {
    return -1;
  }
}

/**
 * Drive書き込みを強制的に失敗させる（テスト環境のみ有効）。
 * @param {boolean} shouldFail 失敗させるなら true
 * @private
 */
function setDriveWriteFailureForTest_(shouldFail) {
  if (DriveApp && DriveApp.failWrites !== undefined) {
    DriveApp.failWrites = shouldFail;
  }
}

// ------------------------------------------------------------
// テスト実行の基盤
// ------------------------------------------------------------

/**
 * 1つのテストを実行し、結果を記録する。
 * @param {string} name テスト名
 * @param {function()} body テスト本体
 * @private
 */
function runTest_(name, body) {
  var assertions = [];
  var currentTest = { name: name, passed: true, assertions: assertions, error: null };

  currentTest_ = currentTest;
  try {
    body();
  } catch (e) {
    currentTest.passed = false;
    currentTest.error = describeError(e);
  }
  currentTest_ = null;

  var failedAssertions = assertions.filter(function (a) { return !a.passed; });
  if (failedAssertions.length > 0) {
    currentTest.passed = false;
  }

  testResults_.push(currentTest);

  console.log((currentTest.passed ? '[PASS] ' : '[FAIL] ') + name);
  failedAssertions.forEach(function (a) {
    console.log('        × ' + a.message);
  });
  if (currentTest.error) {
    console.log('        × 例外: ' + currentTest.error);
  }
}

/** @private {?Object} 実行中のテスト */
var currentTest_ = null;

/**
 * 検証結果を記録する。
 * @param {boolean} passed 成否
 * @param {string} message 説明
 * @private
 */
function recordAssertion_(passed, message) {
  if (currentTest_) {
    currentTest_.assertions.push({ passed: passed, message: message });
  }
  if (!passed) {
    throw new Error('検証に失敗しました: ' + message);
  }
}

/**
 * 値が等しいことを検証する。
 * @param {*} expected 期待値
 * @param {*} actual 実際の値
 * @param {string} message 説明
 * @private
 */
function assertEquals_(expected, actual, message) {
  var passed = expected === actual;
  recordAssertion_(passed, message +
    (passed ? '' : '（期待: ' + expected + ' / 実際: ' + actual + '）'));
}

/**
 * 条件が真であることを検証する。
 * @param {boolean} condition 条件
 * @param {string} message 説明
 * @private
 */
function assertTrue_(condition, message) {
  recordAssertion_(!!condition, message);
}

/**
 * 例外が発生することを検証する。
 * @param {function()} fn 実行する関数
 * @param {string} message 説明
 * @private
 */
function assertThrows_(fn, message) {
  var threw = false;
  try {
    fn();
  } catch (e) {
    threw = true;
  }
  recordAssertion_(threw, message);
}

/**
 * テスト結果を集計して表示する。
 * @return {{total: number, passed: number, failed: number, results: !Array<!Object>}}
 * @private
 */
function summarizeTests_() {
  var passed = testResults_.filter(function (r) { return r.passed; }).length;
  var failed = testResults_.length - passed;

  console.log('');
  console.log('===== テスト結果 =====');
  console.log('実行　: ' + testResults_.length + '件');
  console.log('成功　: ' + passed + '件');
  console.log('失敗　: ' + failed + '件');

  if (failed > 0) {
    console.log('');
    console.log('--- 失敗したテスト ---');
    testResults_.filter(function (r) { return !r.passed; }).forEach(function (r) {
      console.log('  ' + r.name);
      if (r.error) {
        console.log('    ' + r.error);
      }
    });
  } else {
    console.log('');
    console.log('すべてのテストに成功しました。');
  }

  return {
    total: testResults_.length, passed: passed, failed: failed, results: testResults_
  };
}

/**
 * 内部の木構造を、e-Gov の法令本文JSON表現へ変換する（テスト用）。
 * 実際のAPIが返す { tag, attr, children } の形を再現する。
 *
 * @param {(!Object|string)} node 木構造のノード
 * @return {(!Object|string)} JSON表現
 * @private
 */
function lawNodeToEgovJson_(node) {
  if (typeof node === 'string') {
    return node;
  }
  return {
    tag: node.name,
    attr: node.attrs,
    children: node.children.map(lawNodeToEgovJson_)
  };
}

/** 本文がJSON形式で返る場合でも、保存まで完了すること。 */
function test_本文がJSON形式で返る場合() {
  runTest_('本文がJSON形式で返る場合', function () {
    withTestContext_(function (ctx) {
      stubEgovApi_({
        '所得税法': { lawId: '340AC0000000033', lawNum: '昭和四十年法律第三十三号' }
      }, { jsonOnly: true });

      var summary = runSync({ runName: 'test', lawName: '所得税法', dryRun: false });

      assertEquals_(0, summary.failed_count, 'JSON形式でも失敗しない');
      assertEquals_(1, summary.updated_count, 'JSON形式でも保存される');

      // 原本は .json として無加工で保存されること
      var rawFolder = ctx.driveService.getRawXmlFolder('tax');
      var rawJson = ctx.driveService.readTextFile(rawFolder, '所得税法.json');
      assertTrue_(!!rawJson, '原本が .json として保存される');
      assertTrue_(!ctx.driveService.readTextFile(rawFolder, '所得税法.xml'),
        'XMLは作られない（疑似XMLを生成しない）');

      var parsed = safeJsonParse(rawJson, null);
      assertTrue_(!!parsed && !!parsed.law_full_text,
        '原本はe-Govのレスポンスそのままである');
      assertEquals_('Law', parsed.law_full_text.tag,
        '原本の構造が改変されていない');

      // Markdownは通常どおり生成されること
      var mdFolder = ctx.driveService.getMarkdownFolder('tax', 'act');
      var md = ctx.driveService.readTextFile(mdFolder, '所得税法.md');
      assertTrue_(!!md, 'Markdownが生成される');
      assertTrue_(md.indexOf('#### 第一条') !== -1, '条の構造が保持される');
      assertTrue_(md.indexOf('一　国内') !== -1, '号が保持される');

      // 台帳に取得形式が記録されること
      var state = loadSyncState(ctx.driveService);
      var record = state.laws['340AC0000000033'];
      assertEquals_('json', record.raw_format, '取得形式が記録される');
      assertEquals_('所得税法.json', record.raw_file_name, '原本のファイル名が記録される');

      // 2回目は変更なしと判定されること
      var second = runSync({ runName: 'test', lawName: '所得税法', dryRun: false });
      assertEquals_(1, second.unchanged_count, 'JSON形式でも差分検出が働く');
    });
  });
}

/** XMLで取得した場合とJSONで取得した場合で、生成物が一致すること。 */
function test_XMLとJSONで同じ結果になること() {
  runTest_('XMLとJSONで同じ結果になること', function () {
    var xml = getTestLawXml_('所得税法', '昭和四十年法律第三十三号');
    var fromXml = parseLawXml(xml);
    var fromJson = parseLawContent(lawNodeToEgovJson_(fromXml), 'json');

    assertEquals_(JSON.stringify(fromXml), JSON.stringify(fromJson),
      'XMLとJSONから同じ木構造が得られる');

    var meta = { law_name: '所得税法', law_id: '340AC0000000033' };
    assertEquals_(
      convertLawToMarkdown(fromXml, meta).markdown,
      convertLawToMarkdown(fromJson, meta).markdown,
      '生成されるMarkdownが完全に一致する');

    assertEquals_(
      buildStructuredJsonFromTree(fromXml, meta).unit_count,
      buildStructuredJsonFromTree(fromJson, meta).unit_count,
      '構造化JSONの条文単位数が一致する');
  });
}

/**
 * 部分一致検索で似た名前の法令が大量にヒットしても、
 * 本命の法令を正しく特定できること。
 *
 * これは実際のe-Govで起きた事象を再現したもの。
 * 「所得税法」で検索すると、次のような法令が先に返ってくる。
 *   - 日本国とアメリカ合衆国との間の...所得税法等の臨時特例に関する法律
 *   - 所得税法等の一部を改正する法律（年度ごとに多数存在）
 */
function test_部分一致で本命法令が埋もれる場合() {
  runTest_('部分一致で本命法令が埋もれる場合', function () {
    withTestContext_(function (ctx) {
      // 1ページ目は紛らわしい法令だけ、2ページ目に本命が現れる状況を作る
      var decoys = [];
      for (var i = 0; i < 100; i++) {
        decoys.push({
          law_info: {
            law_id: 'DECOY' + i, law_num: '令和' + i + '年法律第1号', law_type: 'Act'
          },
          revision_info: { law_title: '所得税法等の一部を改正する法律' }
        });
      }
      decoys[0].revision_info.law_title =
        '日本国とアメリカ合衆国との間の相互協力及び安全保障条約第六条に基づく' +
        '施設及び区域並びに日本国における合衆国軍隊の地位に関する協定の実施に伴う' +
        '所得税法等の臨時特例に関する法律';

      var realLaw = {
        law_info: {
          law_id: '340AC0000000033',
          law_num: '昭和四十年法律第三十三号',
          law_type: 'Act'
        },
        revision_info: { law_title: '所得税法' }
      };

      setHttpOverrideForTest(function (url) {
        if (url.indexOf('/laws?') !== -1 && url.indexOf('updated_from') !== -1) {
          return okJson_(url, { laws: [] });
        }
        if (url.indexOf('/laws?') !== -1) {
          // offset に応じてページを返す（2ページ目に本命がいる）
          var offsetMatch = url.match(/offset=(\d+)/);
          var offset = offsetMatch ? parseInt(offsetMatch[1], 10) : 0;
          if (offset === 0) {
            return okJson_(url, { laws: decoys });
          }
          return okJson_(url, { laws: [realLaw] });
        }
        if (url.indexOf('/law_data/340AC0000000033') !== -1) {
          return {
            ok: true, status: 200, url: url, attempts: 1, error: null,
            body: getTestLawXml_('所得税法', '昭和四十年法律第三十三号')
          };
        }
        return errorResult_(url, 404, '対象外のURL');
      });

      var summary = runSync({ runName: 'test', lawName: '所得税法', dryRun: false });

      assertEquals_(1, summary.updated_count,
        '紛らわしい候補が100件あっても本命を取得できる');
      assertEquals_(0, summary.skipped_count, 'スキップされない');

      var state = loadSyncState(ctx.driveService);
      var record = state.laws['340AC0000000033'];
      assertTrue_(!!record, '本命の法令IDで保存されている');
      assertEquals_('所得税法', record.law_name, '正しい法令名で保存されている');

      // 紛らわしい法令が保存されていないこと
      assertTrue_(!state.laws['DECOY0'], '紛らわしい法令は保存されていない');

      var mdFolder = ctx.driveService.getMarkdownFolder('tax', 'act');
      assertEquals_(1, countFiles_(mdFolder), '保存されたのは1件だけである');
      assertTrue_(!!ctx.driveService.readTextFile(mdFolder, '所得税法.md'),
        '所得税法.md が保存されている');
    });
  });
}
