/**
 * @file 18_main.gs
 * 利用者が直接実行する関数（エントリポイント）。
 *
 * Apps Scriptエディタの関数選択欄に表示されるのは、ここに定義された関数である。
 * 実際の処理は各サービスへ委譲し、この層は「入口」に徹する。
 */

/**
 * 【初回セットアップ】
 * Google Driveにルートフォルダとサブフォルダを作成し、
 * 設定した法令をすべて取得して保存する。
 *
 * 2回目以降に実行しても、フォルダは重複作成されない。
 *
 * @return {!Object} セットアップ結果のサマリ
 */
function setup() {
  var logger = createLogger('setup');
  logger.info('===== 初回セットアップを開始します =====');

  // --- 1. 設定の検証 ---
  var configCheck = validateLawsConfig();
  if (configCheck.errors.length > 0) {
    logger.error('設定ファイルに問題があります。修正してから再実行してください');
    configCheck.errors.forEach(function (message) {
      logger.error('  ' + message);
    });
    return { ok: false, errors: configCheck.errors };
  }
  logger.info('設定ファイルを検証しました', { law_count: configCheck.valid.length });

  // --- 2. API仕様の自動チェック ---
  // 利用者が verifyApiSpec() を実行し忘れても気付けるよう、ここで自動照合する。
  // 照合に失敗しても処理は止めない（OpenAPI仕様書のURLが見つからないだけの
  // 場合もあり、その場合でもAPI自体は正常に動くことがあるため）。
  var specReport = runSpecPreCheck_(logger);

  // --- 3. ルートフォルダの作成／再利用 ---
  var rootResult = ensureRootFolder(logger);
  logger.info(rootResult.created
    ? 'ルートフォルダを新規作成しました'
    : '既存のルートフォルダを再利用しました', { folder_id: rootResult.folderId });

  // --- 4. フォルダ構成の作成 ---
  var driveService = new DriveService(rootResult.folderId, logger);
  var paths = ensureFolderStructure(driveService);
  logger.info('フォルダ構成を確認しました', { folder_count: paths.length });

  // --- 5. 初期ファイルの作成 ---
  var state = loadSyncState(driveService);
  writeDriveReadme(driveService, state);
  setProp(CONFIG.PROPERTY_KEYS.SETUP_COMPLETED_AT, nowIso());
  setProp(CONFIG.PROPERTY_KEYS.SCHEMA_VERSION, CONFIG.SCHEMA_VERSION);

  logger.saveToDrive(driveService);

  console.log('');
  console.log('フォルダの準備が完了しました。');
  console.log('ルートフォルダID: ' + rootResult.folderId);
  console.log('続けて、対象法令の取得を開始します...');
  console.log('');

  // --- 6. 全法令を取得する ---
  var syncSummary = runSync({ runName: 'setup_sync', forceAll: true, dryRun: false });

  printSetupResult_(rootResult, paths.length, syncSummary, specReport);

  return {
    ok: true,
    root_folder_id: rootResult.folderId,
    root_folder_created: rootResult.created,
    folder_count: paths.length,
    api_spec_ok: specReport.ok,
    sync: syncSummary
  };
}

/**
 * 【通常同期】
 * 改正された法令だけを取得して更新する。
 * 自動トリガーからも、この関数が呼ばれる。
 *
 * @return {!Object} 同期結果のサマリ
 */
function syncLaws() {
  return runSync({ runName: 'sync', dryRun: false });
}

/**
 * 【Dry Run】
 * 実際の取得・判定は行うが、Google Drive上のファイルは一切書き換えない。
 * 何が更新される予定かをログで確認できる。
 *
 * @return {!Object} 同期結果のサマリ（実行ログに変更予定が出力される）
 */
function dryRunSync() {
  var summary = runSync({ runName: 'dry_run', dryRun: true });

  console.log('');
  console.log('===== Dry Run の結果 =====');
  console.log('対象件数　　　: ' + summary.target_count);
  console.log('更新される予定: ' + summary.updated_count + '件');
  console.log('変更なし　　　: ' + summary.unchanged_count + '件');
  console.log('失敗　　　　　: ' + summary.failed_count + '件');
  console.log('スキップ　　　: ' + summary.skipped_count + '件');

  if (summary.planned_changes.length > 0) {
    console.log('');
    console.log('--- 更新される予定の法令 ---');
    summary.planned_changes.forEach(function (plan) {
      console.log('  ' + plan);
    });
  } else {
    console.log('');
    console.log('更新される法令はありません。');
  }
  console.log('');
  console.log('※ Dry Run のため、Drive上のファイルは変更していません。');

  return summary;
}

/**
 * 【単一法令の同期】
 * 指定した法令だけを取得・更新する。
 *
 * 使い方の例:
 *   syncSingleLaw('所得税法')
 *
 * @param {string} lawName 設定ファイルに登録された法令名
 * @return {!Object} 同期結果のサマリ
 */
function syncSingleLaw(lawName) {
  if (!lawName) {
    console.log('法令名を指定してください。例: syncSingleLaw("所得税法")');
    return { ok: false, error: '法令名が指定されていません' };
  }
  return runSync({ runName: 'sync_single', lawName: lawName, dryRun: false });
}

/**
 * 【カテゴリ単位の同期】
 * 指定したカテゴリの法令だけを取得・更新する。
 *
 * 使い方の例:
 *   syncCategory('tax')
 *   syncCategory('social_insurance')
 *   syncCategory('labor_insurance')
 *
 * @param {string} categoryKey カテゴリキー
 * @return {!Object} 同期結果のサマリ
 */
function syncCategory(categoryKey) {
  if (!categoryKey || !CONFIG.CATEGORIES[categoryKey]) {
    var available = Object.keys(CONFIG.CATEGORIES).join(', ');
    console.log('カテゴリを指定してください。指定できる値: ' + available);
    return { ok: false, error: '不正なカテゴリです: ' + categoryKey };
  }
  return runSync({ runName: 'sync_' + categoryKey, categoryKey: categoryKey, dryRun: false });
}

/**
 * 【全件強制同期】
 * 更新情報に頼らず、設定された全法令を取得してハッシュ比較する。
 * 長期間同期していなかった場合や、データを作り直したい場合に使う。
 *
 * @return {!Object} 同期結果のサマリ
 */
function syncAllLaws() {
  return runSync({ runName: 'sync_all', forceAll: true, dryRun: false });
}

/**
 * 【状態の確認】
 * 現在の設定・フォルダ・同期状況を表示する。
 * エラー発生時、まずこの関数を実行して状況を把握するとよい。
 *
 * @return {!Object} 現在の状態
 */
function showStatus() {
  var logger = createLogger('status');
  var rootFolderId = getRootFolderId();

  console.log('===== 日本法令データベース：状態確認 =====');
  console.log('');
  console.log('[Script Properties]');
  console.log('  ルートフォルダID　: ' + (rootFolderId || '(未設定)'));
  console.log('  セットアップ完了　: ' +
    (getProp(CONFIG.PROPERTY_KEYS.SETUP_COMPLETED_AT) || '(未実行)'));
  console.log('  前回同期日時　　　: ' + (getLastSyncAt() || '(未同期)'));
  console.log('  API仕様の照合　　 : ' +
    (getProp(CONFIG.PROPERTY_KEYS.API_SPEC_VERIFIED_AT) || '(未実施)'));
  console.log('');

  var configCheck = validateLawsConfig();
  console.log('[設定ファイル]');
  console.log('  登録法令数　: ' + configCheck.valid.length);
  console.log('  有効な法令数: ' + getEnabledLaws().length);
  console.log('  設定エラー　: ' + configCheck.errors.length);
  configCheck.errors.forEach(function (message) {
    console.log('    - ' + message);
  });
  console.log('');

  var status = {
    root_folder_id: rootFolderId,
    last_sync_at: getLastSyncAt(),
    config_law_count: configCheck.valid.length,
    config_errors: configCheck.errors,
    drive_ok: false,
    law_count: 0
  };

  if (!rootFolderId) {
    console.log('[Google Drive]');
    console.log('  未セットアップです。setup() を実行してください。');
    return status;
  }

  try {
    var driveService = new DriveService(rootFolderId, logger);
    var folder = driveService.getRoot();
    var state = loadSyncState(driveService);
    var laws = Object.keys(state.laws);

    status.drive_ok = true;
    status.law_count = laws.length;

    console.log('[Google Drive]');
    console.log('  フォルダ名　　: ' + folder.getName());
    console.log('  保存済み法令数: ' + laws.length);
    console.log('  台帳更新日時　: ' + (state.updated_at || '(なし)'));
    console.log('');

    var byStatus = {};
    laws.forEach(function (key) {
      var record = state.laws[key];
      var recordStatus = (record && record.status) || 'unknown';
      byStatus[recordStatus] = (byStatus[recordStatus] || 0) + 1;
    });
    console.log('[法令ステータスの内訳]');
    Object.keys(byStatus).forEach(function (key) {
      console.log('  ' + key + ': ' + byStatus[key] + '件');
    });
    status.by_status = byStatus;

  } catch (e) {
    console.log('[Google Drive]');
    console.log('  アクセスできません: ' + describeError(e));
    console.log('  resetRootFolder() を実行すると再設定できます。');
    status.error = describeError(e);
  }

  console.log('');
  console.log('[トリガー]');
  listTriggers();

  return status;
}

/**
 * 【ルートフォルダの再設定】
 * 保存されたフォルダIDが無効になった場合に使う。
 *
 * 注意: この関数はDrive上のデータを削除しない。
 * Script Properties のフォルダIDを消して、次回の setup() で
 * フォルダを再検出・再作成できるようにするだけである。
 *
 * @return {!Object} 実行結果
 */
function resetRootFolder() {
  var previousId = getRootFolderId();
  deleteProp(CONFIG.PROPERTY_KEYS.ROOT_FOLDER_ID);

  console.log('ルートフォルダIDの設定を削除しました。');
  console.log('  削除したID: ' + (previousId || '(未設定)'));
  console.log('');
  console.log('次に setup() を実行してください。');
  console.log('マイドライブに「' + CONFIG.ROOT_FOLDER_NAME + '」が残っている場合は、');
  console.log('そのフォルダが再利用されます（データは失われません）。');

  return { ok: true, previous_folder_id: previousId };
}

/**
 * API仕様の事前チェックを行う。
 *
 * 照合に失敗しても例外は投げない。OpenAPI仕様書のURLが見つからないだけで
 * API自体は正常に動く場合があり、ここで処理を止めると
 * かえって原因が分かりにくくなるためである。
 *
 * @param {!Logger_} logger ロガー
 * @return {{ok: boolean, checked: boolean, missing_endpoints: !Array<string>}}
 * @private
 */
function runSpecPreCheck_(logger) {
  logger.info('e-Gov APIの仕様を公式OpenAPI仕様書と照合しています...');

  var report;
  try {
    report = verifyApiSpec();
  } catch (e) {
    logger.warn('API仕様の照合中にエラーが発生しました（処理は継続します）', {
      error: describeError(e)
    });
    return { ok: false, checked: false, missing_endpoints: [] };
  }

  if (report.ok) {
    logger.info('API仕様の照合に成功しました。設定は公式仕様と一致しています');
    return { ok: true, checked: true, missing_endpoints: [] };
  }

  if (!report.openapi_url) {
    logger.warn(
      'OpenAPI仕様書を自動取得できませんでした。設定値の正しさは未確認のまま処理を続けます。' +
      '法令の取得がすべて失敗する場合は、02_api_spec.gs の見直しが必要です');
    return { ok: false, checked: false, missing_endpoints: [] };
  }

  logger.error(
    '設定したAPIのパスが公式仕様と一致しません。02_api_spec.gs の修正が必要です', {
      missing: report.missing_endpoints.join(' / ')
    });
  return {
    ok: false, checked: true, missing_endpoints: report.missing_endpoints
  };
}

/**
 * セットアップ結果を分かりやすく表示する。
 *
 * @param {{folderId: string, created: boolean}} rootResult ルートフォルダの作成結果
 * @param {number} folderCount 作成・確認したフォルダ数
 * @param {!Object} syncSummary 同期結果のサマリ
 * @param {!Object=} specReport API仕様チェックの結果
 * @private
 */
function printSetupResult_(rootResult, folderCount, syncSummary, specReport) {
  // 1件も取得できなかった場合、「完了しました」は誤解を招くため表示を変える
  var allFailed = syncSummary.target_count > 0 && syncSummary.success_count === 0;

  console.log('');
  console.log('==========================================');
  if (allFailed) {
    console.log('  セットアップは未完了です（法令を取得できていません）');
  } else {
    console.log('  初回セットアップが完了しました');
  }
  console.log('==========================================');
  console.log('');
  console.log('[Google Drive]');
  console.log('  フォルダ名　　: ' + CONFIG.ROOT_FOLDER_NAME);
  console.log('  フォルダID　　: ' + rootResult.folderId);
  console.log('  状態　　　　　: ' + (rootResult.created ? '新規作成' : '既存を再利用'));
  console.log('  作成フォルダ数: ' + folderCount);
  console.log('');
  console.log('[法令の取得結果]');
  console.log('  対象件数　　: ' + syncSummary.target_count);
  console.log('  成功件数　　: ' + syncSummary.success_count);
  console.log('  更新件数　　: ' + syncSummary.updated_count);
  console.log('  変更なし件数: ' + syncSummary.unchanged_count);
  console.log('  スキップ件数: ' + syncSummary.skipped_count);
  console.log('  失敗件数　　: ' + syncSummary.failed_count);
  console.log('');

  console.log('[API仕様の照合]');
  if (!specReport) {
    console.log('  未実施');
  } else if (specReport.ok) {
    console.log('  OK（設定は公式仕様と一致しています）');
  } else if (!specReport.checked) {
    console.log('  未確認（公式のOpenAPI仕様書を取得できませんでした）');
  } else {
    console.log('  ⚠ 不一致あり: ' + specReport.missing_endpoints.join(' / '));
  }
  console.log('');

  if (syncSummary.failures.length > 0) {
    // 全件失敗時に45行並ぶと読みにくいため、先頭のみ表示する。
    // 全件は 99_システムログ のログファイルに記録されている。
    var MAX_SHOWN = 10;
    console.log('[取得できなかった法令]');
    syncSummary.failures.slice(0, MAX_SHOWN).forEach(function (failure) {
      console.log('  - ' + failure.law_name + ': ' + failure.reason);
    });
    if (syncSummary.failures.length > MAX_SHOWN) {
      console.log('  ...他 ' + (syncSummary.failures.length - MAX_SHOWN) + ' 件' +
        '（全件は ' + CONFIG.FOLDERS.SYSTEM_LOG + ' のログを参照）');
    }
    console.log('');
  }

  console.log('[次にすること]');
  if (allFailed) {
    console.log('  ⚠ 1件も取得できていません。次の順に確認してください。');
    console.log('');
    console.log('  1. verifyApiSpec() を実行し、レポートを確認する');
    console.log('  2. レポートの「公式仕様に存在するパス」と「GET ... のパラメータ」を見て、');
    console.log('     02_api_spec.gs の ENDPOINTS と PARAMS を実際の値に修正する');
    console.log('  3. もう一度 setup() を実行する');
    console.log('');
    console.log('  ※ Drive上のフォルダは作成済みです。作り直す必要はありません。');
  } else {
    console.log('  1. Google Drive で「' + CONFIG.ROOT_FOLDER_NAME + '」を開いて中身を確認する');
    console.log('  2. installTrigger() を実行して毎日の自動更新を設定する');
    console.log('  3. 詳しい状態は showStatus() で確認できる');
    if (syncSummary.failures.length > 0) {
      console.log('');
      console.log('  取得できなかった法令については、法令名がe-Govの正式名称と');
      console.log('  一致しているか 01_laws_config.gs を確認してください。');
    }
  }
  console.log('');
}
