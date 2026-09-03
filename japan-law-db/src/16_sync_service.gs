/**
 * @file 16_sync_service.gs
 * 同期処理の中核。取得・差分判定・保存・履歴退避を統括する。
 *
 * 重要な方針
 * ----------
 *   - 1件の失敗で全体を止めない（law単位でtry/catchする）
 *   - Dry Run では既存ファイルを一切書き換えない
 *   - ハッシュが同一なら書き込まない（無駄な更新をしない）
 *   - 変更がある場合のみ、旧データを履歴へ退避してから更新する
 */

/**
 * 同期オプション。
 * @typedef {{
 *   dryRun: boolean,
 *   categoryKey: ?string,
 *   lawName: ?string,
 *   forceAll: boolean,
 *   runName: string
 * }} SyncOptions
 */

/**
 * 同期処理を実行する。
 *
 * @param {!SyncOptions} options 同期オプション
 * @return {!Object} 同期結果のサマリ
 */
function runSync(options) {
  var opts = options || {};
  var logger = createLogger(opts.runName || 'sync');
  var startedAt = new Date();

  var summary = {
    run_name: opts.runName || 'sync',
    dry_run: !!opts.dryRun,
    started_at: startedAt.toISOString(),
    started_at_jst: formatJst(startedAt),
    finished_at: null,
    finished_at_jst: null,
    target_count: 0,
    success_count: 0,
    updated_count: 0,
    unchanged_count: 0,
    failed_count: 0,
    skipped_count: 0,
    strategy: 'unknown',
    failures: [],
    warnings: [],
    updated_laws: [],
    planned_changes: []
  };

  logger.info('===== 同期処理を開始します =====', {
    dry_run: !!opts.dryRun,
    category: opts.categoryKey || '(すべて)',
    law_name: opts.lawName || '(すべて)'
  });

  var driveService = null;

  try {
    // --- 設定の検証 ---
    var configCheck = validateLawsConfig();
    configCheck.errors.forEach(function (message) {
      logger.error('設定ファイルに問題があります: ' + message);
      summary.failures.push({ law_name: '(設定)', reason: message });
      summary.failed_count++;
    });

    // --- ルートフォルダの確認 ---
    var rootFolderId = getRootFolderId();
    if (!rootFolderId) {
      throw new Error(
        'ルートフォルダIDが設定されていません。先に setup() を実行してください。');
    }
    driveService = new DriveService(rootFolderId, logger);
    driveService.getRoot();  // アクセス可否をここで確認する

    // --- 対象法令の決定 ---
    var targets = selectTargets_(opts, logger);
    summary.target_count = targets.laws.length;
    summary.strategy = targets.strategy;
    logger.info('対象法令を決定しました', {
      count: targets.laws.length, strategy: targets.strategy
    });

    // --- 台帳の読み込み ---
    var state = loadSyncState(driveService);

    // --- 法令ごとの処理 ---
    for (var i = 0; i < targets.laws.length; i++) {
      if (isOverTimeLimit_(startedAt)) {
        logger.warn('実行時間の上限に近づいたため、残りは次回に持ち越します', {
          processed: i, remaining: targets.laws.length - i
        });
        summary.skipped_count += targets.laws.length - i;
        break;
      }

      var lawConfig = targets.laws[i];
      try {
        var outcome = syncOneLaw_(lawConfig, state, driveService, logger, !!opts.dryRun);
        applyOutcome_(summary, lawConfig, outcome);
      } catch (e) {
        // 1件の失敗で全体を止めない
        var reason = describeError(e);
        logger.error('法令の同期に失敗しました', {
          law_name: lawConfig.name, error: reason
        });
        summary.failed_count++;
        summary.failures.push({ law_name: lawConfig.name, reason: reason });
      }
    }

    // --- 台帳・CSV・READMEの更新 ---
    if (!opts.dryRun) {
      saveSyncState(driveService, state);
      var rowCount = writeLawListCsv(driveService, state);
      writeDriveReadme(driveService, state);
      logger.info('法令一覧CSVを更新しました', { rows: rowCount });
      setLastSyncAt();
    } else {
      logger.info('Dry Run のため、台帳・CSV・法令ファイルは書き換えていません');
    }

  } catch (e) {
    var fatal = describeError(e);
    logger.error('同期処理を続行できませんでした', { error: fatal });
    summary.failures.push({ law_name: '(全体)', reason: fatal });
    summary.failed_count++;
  }

  var finishedAt = new Date();
  summary.finished_at = finishedAt.toISOString();
  summary.finished_at_jst = formatJst(finishedAt);
  summary.duration_seconds = Math.round((finishedAt - startedAt) / 1000);
  summary.warnings = logger.getWarnings();

  logSummary_(logger, summary);

  if (driveService) {
    if (!opts.dryRun) {
      try {
        writeLastSyncInfo(driveService, summary);
      } catch (e) {
        logger.error('最終同期情報の保存に失敗しました', { error: describeError(e) });
      }
    }
    logger.saveToDrive(driveService);
  }

  return summary;
}

/**
 * 同期対象の法令を決定する。
 *
 * 長期間同期していない場合や、更新情報が取得できない場合は、
 * 「更新なし」と誤判定せず全件を対象にする（安全側フォールバック）。
 *
 * @param {!SyncOptions} opts 同期オプション
 * @param {!Logger_} logger ロガー
 * @return {{laws: !Array<!Object>, strategy: string}}
 * @private
 */
function selectTargets_(opts, logger) {
  // --- 単一法令の指定 ---
  if (opts.lawName) {
    var one = findLawConfigByName(opts.lawName);
    if (!one) {
      throw new Error(
        '設定ファイルに "' + opts.lawName + '" が見つかりません。' +
        '01_laws_config.gs を確認してください。');
    }
    return { laws: [one], strategy: 'single_law' };
  }

  var all = getEnabledLaws(opts.categoryKey || undefined);

  // --- カテゴリ指定・強制全件・初回は全件 ---
  if (opts.categoryKey) {
    return { laws: all, strategy: 'category' };
  }
  if (opts.forceAll) {
    return { laws: all, strategy: 'force_all' };
  }

  var lastSyncAt = getLastSyncAt();
  if (!lastSyncAt) {
    logger.info('前回同期の記録がないため、全件を対象にします');
    return { laws: all, strategy: 'full_first_run' };
  }

  var elapsedDays = diffInDays(lastSyncAt, new Date());
  if (elapsedDays > CONFIG.SYNC.FULL_RESYNC_AFTER_DAYS) {
    logger.warn(
      '前回同期から' + Math.floor(elapsedDays) + '日経過しています。' +
      '更新情報の取得可能期間を超えている可能性があるため、全件を再取得します', {
        last_sync_at: lastSyncAt,
        threshold_days: CONFIG.SYNC.FULL_RESYNC_AFTER_DAYS
      });
    return { laws: all, strategy: 'fallback_full_resync' };
  }

  // --- 更新法令情報で絞り込む ---
  var updated = fetchUpdatedLaws(lastSyncAt, logger);
  if (!updated.ok) {
    logger.warn(
      '更新法令情報を取得できませんでした。「更新なし」と判定せず全件を確認します', {
        error: updated.error
      });
    return { laws: all, strategy: 'fallback_api_error' };
  }

  if (updated.laws.length === 0) {
    // 0件は「本当に更新がない」場合と「期間外で取得できない」場合がある。
    // 誤判定を避けるため、ハッシュ比較で最終確認する（全件を対象にする）。
    logger.info(
      '更新法令が0件でした。取得可能期間の制約による誤判定を避けるため、' +
      'ハッシュ比較で全件を確認します');
    return { laws: all, strategy: 'fallback_zero_updates' };
  }

  // 更新された法令IDと法令名の集合を作る
  var updatedIds = {};
  var updatedNames = {};
  updated.laws.forEach(function (item) {
    var info = readLawInfo(item);
    if (info.law_id) {
      updatedIds[info.law_id] = true;
    }
    if (info.law_title) {
      updatedNames[normalizeLawName(info.law_title)] = true;
    }
  });

  var state = null;
  var filtered = all.filter(function (lawConfig) {
    if (updatedNames[normalizeLawName(lawConfig.name)]) {
      return true;
    }
    if (lawConfig.lawId && updatedIds[lawConfig.lawId]) {
      return true;
    }
    return false;
  });

  logger.info('更新法令情報により対象を絞り込みました', {
    updated_total: updated.laws.length,
    matched_targets: filtered.length
  });

  return { laws: filtered, strategy: 'incremental' };
}

/**
 * 法令1件を同期する。
 *
 * @param {!Object} lawConfig 設定エントリ
 * @param {!Object} state 同期状態（台帳）
 * @param {!DriveService} driveService Driveサービス
 * @param {!Logger_} logger ロガー
 * @param {boolean} dryRun Dry Runかどうか
 * @return {{status: string, reason: string, record: ?Object, plan: ?string}}
 *     status: 'updated' | 'unchanged' | 'skipped' | 'failed'
 * @private
 */
function syncOneLaw_(lawConfig, state, driveService, logger, dryRun) {
  logger.info('--- 処理開始: ' + lawConfig.name + ' ---');

  // --- 1. 法令を1件に確定する ---
  var resolution = resolveLaw(lawConfig, logger);
  if (!resolution.resolved) {
    var level = resolution.ambiguous ? 'warn' : 'error';
    logger[level]('法令を確定できませんでした', {
      law_name: lawConfig.name, reason: resolution.reason
    });
    return { status: 'skipped', reason: resolution.reason, record: null, plan: null };
  }

  var lawInfo = resolution.lawInfo;
  var identifier = lawInfo.law_id || lawInfo.law_num;

  // --- 2. 本文XMLを取得する ---
  var fetched = fetchLawXml(identifier, logger);
  if (!fetched.ok) {
    return { status: 'failed', reason: fetched.error, record: null, plan: null };
  }

  // --- 3. XMLを検証する（保存前に壊れたデータを弾く） ---
  var parsedRoot;
  try {
    parsedRoot = parseLawXml(fetched.xml);
  } catch (e) {
    return {
      status: 'failed', record: null, plan: null,
      reason: 'XML解析エラー: ' + describeError(e)
    };
  }
  if (parsedRoot.name !== 'Law') {
    return {
      status: 'failed', record: null, plan: null,
      reason: '取得したXMLのルート要素が Law ではありません（実際: ' + parsedRoot.name + '）'
    };
  }

  // 検索結果に書誌情報が無い場合、XML本体から補完する
  enrichLawInfoFromXml_(lawInfo, parsedRoot);

  var status = determineLawStatus(lawInfo);
  if (status !== CONFIG.STATUS.ACTIVE) {
    logger.warn('この法令は現在有効ではありません（削除せずステータスを記録します）', {
      law_name: lawInfo.law_title, status: status, repeal_date: lawInfo.repeal_date
    });
  }

  // --- 4. ハッシュで差分を判定する ---
  var newHash = computeLawHash(fetched.xml);
  var previous = findStateRecord(state, lawConfig, lawInfo.law_id);
  var isUnchanged = previous && isSameHash(previous.last_hash, newHash);

  if (isUnchanged) {
    logger.info('変更はありません（ファイルは更新しません）', {
      law_name: lawInfo.law_title, hash: newHash.substring(0, 12)
    });
    // ステータスと確認日時だけは最新化する
    if (!dryRun) {
      previous.status = status;
      previous.last_checked_at = nowIso();
      putStateRecord(state, previous, lawConfig);
    }
    return { status: 'unchanged', reason: 'ハッシュ一致', record: previous, plan: null };
  }

  var changeType = previous ? '更新' : '新規';
  var planText = changeType + ': ' + lawInfo.law_title +
    '（法令ID: ' + lawInfo.law_id + '）' +
    (previous ? ' ハッシュ ' + String(previous.last_hash).substring(0, 12) +
      ' → ' + newHash.substring(0, 12) : '');

  // --- 5. Dry Run はここまで（書き込まない） ---
  if (dryRun) {
    logger.info('[Dry Run] 変更が検出されました: ' + planText);
    return { status: 'updated', reason: 'Dry Run', record: null, plan: planText };
  }

  // --- 6. Markdownと構造化JSONを生成する ---
  var lawTypeKey = decideLawTypeKey(lawInfo, lawConfig);
  var meta = buildLawMetadata(lawConfig, lawInfo, lawTypeKey, status, fetched.url);
  var converted = convertLawXmlToMarkdown(fetched.xml, meta);

  converted.warnings.forEach(function (warning) {
    logger.warn('Markdown変換の警告: ' + warning, { law_name: lawInfo.law_title });
  });

  // --- 7. 旧データを履歴へ退避する ---
  var baseName = sanitizeFileName(lawInfo.law_title || lawConfig.name);
  if (previous && CONFIG.SYNC.KEEP_HISTORY) {
    archivePrevious_(previous, baseName, lawConfig, driveService, logger);
  }

  // --- 8. 原本XMLを保存する（加工しない） ---
  var rawFolder = driveService.getRawXmlFolder(lawConfig.category);
  var xmlResult = driveService.upsertTextFile(
    rawFolder, baseName + '.xml', fetched.xml,
    previous ? previous.xml_file_id : null, MimeType.PLAIN_TEXT);

  // --- 9. Markdownを保存する ---
  var mdFolder = driveService.getMarkdownFolder(lawConfig.category, lawTypeKey);
  var mdResult = driveService.upsertTextFile(
    mdFolder, baseName + '.md', converted.markdown,
    previous ? previous.markdown_file_id : null, MimeType.PLAIN_TEXT);

  // --- 10. 構造化JSONを保存する ---
  var structuredFileId = previous ? previous.structured_file_id : null;
  if (CONFIG.SYNC.GENERATE_STRUCTURED_JSON) {
    try {
      var structured = buildStructuredJson(fetched.xml, meta);
      var structuredFolder = driveService.getStructuredFolder(lawConfig.category);
      structuredFileId = driveService.upsertTextFile(
        structuredFolder, baseName + '.json', toPrettyJson(structured),
        structuredFileId, MimeType.PLAIN_TEXT).fileId;
      logger.info('構造化JSONを保存しました', {
        law_name: lawInfo.law_title, units: structured.unit_count
      });
    } catch (e) {
      // 構造化JSONは補助データのため、失敗しても本体の保存は成功扱いにする
      logger.warn('構造化JSONの生成に失敗しました（本文の保存は完了しています）', {
        law_name: lawInfo.law_title, error: describeError(e)
      });
    }
  }

  // --- 11. 台帳を更新する ---
  var record = buildStateRecord_(
    lawConfig, lawInfo, lawTypeKey, status, newHash,
    xmlResult.fileId, mdResult.fileId, structuredFileId, previous, fetched);
  putStateRecord(state, record, lawConfig);

  logger.info('保存が完了しました', {
    law_name: lawInfo.law_title,
    change: changeType,
    xml_file_id: xmlResult.fileId,
    markdown_file_id: mdResult.fileId
  });

  return { status: 'updated', reason: changeType, record: record, plan: planText };
}

/**
 * 検索結果に不足している書誌情報を、取得したXML本体から補う。
 *
 * @param {!Object} lawInfo 法令情報（破壊的に更新する）
 * @param {!Object} root XMLのルートノード
 * @private
 */
function enrichLawInfoFromXml_(lawInfo, root) {
  if (!lawInfo.law_title) {
    var titleNode = findDescendant(root, 'LawTitle');
    if (titleNode) {
      lawInfo.law_title = getTrimmedText(titleNode);
    }
  }
  if (!lawInfo.law_num) {
    var numNode = findDescendant(root, 'LawNum');
    if (numNode) {
      lawInfo.law_num = getTrimmedText(numNode);
    }
  }
  if ((!lawInfo.law_type || lawInfo.law_type === 'other') && root.attrs) {
    var typeFromXml = normalizeLawType(root.attrs.LawType || '');
    if (typeFromXml !== 'other') {
      lawInfo.law_type = typeFromXml;
    }
  }
}

/**
 * 更新前のXML・Markdownを履歴フォルダへ退避する。
 *
 * @param {!Object} previous 前回のレコード
 * @param {string} baseName ファイル名の基礎部分
 * @param {!Object} lawConfig 設定エントリ
 * @param {!DriveService} driveService Driveサービス
 * @param {!Logger_} logger ロガー
 * @private
 */
function archivePrevious_(previous, baseName, lawConfig, driveService, logger) {
  try {
    var historyFolder = driveService.getHistoryFolder(lawConfig.category);
    var archivedAt = new Date();

    var oldMarkdown = previous.markdown_file_id
      ? driveService.readFileById(previous.markdown_file_id) : null;
    if (oldMarkdown) {
      driveService.archiveToHistory(
        historyFolder, baseName, 'md', oldMarkdown, archivedAt);
    }

    var oldXml = previous.xml_file_id
      ? driveService.readFileById(previous.xml_file_id) : null;
    if (oldXml) {
      driveService.archiveToHistory(
        historyFolder, baseName, 'xml', oldXml, archivedAt);
    }
  } catch (e) {
    // 履歴退避の失敗で本体の更新を止めない
    logger.warn('履歴への退避に失敗しました（本体の更新は継続します）', {
      law_name: baseName, error: describeError(e)
    });
  }
}

/**
 * 台帳に保存するレコードを組み立てる。
 *
 * @param {!Object} lawConfig 設定エントリ
 * @param {!Object} lawInfo 法令情報
 * @param {string} lawTypeKey 法令種別キー
 * @param {string} status ステータス
 * @param {string} hash ハッシュ値
 * @param {string} xmlFileId 原本XMLのファイルID
 * @param {string} markdownFileId MarkdownのファイルID
 * @param {?string} structuredFileId 構造化JSONのファイルID
 * @param {?Object} previous 前回のレコード
 * @param {!Object} fetched 取得結果
 * @return {!Object} レコード
 * @private
 */
function buildStateRecord_(
    lawConfig, lawInfo, lawTypeKey, status, hash,
    xmlFileId, markdownFileId, structuredFileId, previous, fetched) {
  var typeDef = CONFIG.LAW_TYPE_DEFS[lawTypeKey] || CONFIG.LAW_TYPE_DEFS.other;
  var now = nowIso();

  return {
    category: lawConfig.category,
    category_label: CONFIG.CATEGORIES[lawConfig.category].label,
    config_name: lawConfig.name,
    law_name: lawInfo.law_title || lawConfig.name,
    law_id: lawInfo.law_id,
    law_number: lawInfo.law_num,
    law_type: typeDef.label,
    law_type_key: lawTypeKey,
    status: status,
    promulgation_date: lawInfo.promulgation_date || '',
    effective_date: lawInfo.effective_date || '',
    revision_id: lawInfo.revision_id || '',
    revision_date: lawInfo.revision_date || '',
    repeal_date: lawInfo.repeal_date || '',
    retrieved_at: now,
    updated_at: now,
    last_checked_at: now,
    first_retrieved_at: previous ? (previous.first_retrieved_at || now) : now,
    source: 'e-Gov法令検索',
    source_url: lawInfo.law_id ? buildHumanLawUrl(lawInfo.law_id) : '',
    api_source_url: fetched.url,
    fetch_source: fetched.source,
    xml_file_id: xmlFileId,
    markdown_file_id: markdownFileId,
    structured_file_id: structuredFileId || '',
    last_hash: hash,
    previous_hash: previous ? (previous.last_hash || '') : '',
    revision_count: previous ? (previous.revision_count || 0) + 1 : 1
  };
}

/**
 * 1件の処理結果をサマリへ反映する。
 *
 * @param {!Object} summary サマリ
 * @param {!Object} lawConfig 設定エントリ
 * @param {!Object} outcome 処理結果
 * @private
 */
function applyOutcome_(summary, lawConfig, outcome) {
  switch (outcome.status) {
    case 'updated':
      summary.success_count++;
      summary.updated_count++;
      summary.updated_laws.push(lawConfig.name);
      if (outcome.plan) {
        summary.planned_changes.push(outcome.plan);
      }
      break;
    case 'unchanged':
      summary.success_count++;
      summary.unchanged_count++;
      break;
    case 'skipped':
      summary.skipped_count++;
      summary.failures.push({ law_name: lawConfig.name, reason: outcome.reason });
      break;
    default:
      summary.failed_count++;
      summary.failures.push({ law_name: lawConfig.name, reason: outcome.reason });
  }
}

/**
 * 実行時間の上限に近づいているか判定する。
 * @param {!Date} startedAt 開始時刻
 * @return {boolean} 上限に近ければ true
 * @private
 */
function isOverTimeLimit_(startedAt) {
  return (Date.now() - startedAt.getTime()) > CONFIG.EXECUTION.SOFT_TIME_LIMIT_MS;
}

/**
 * 同期結果のサマリをログへ出力する。
 * @param {!Logger_} logger ロガー
 * @param {!Object} summary サマリ
 * @private
 */
function logSummary_(logger, summary) {
  logger.info('===== 同期処理が完了しました =====');
  logger.info('対象件数　　: ' + summary.target_count);
  logger.info('成功件数　　: ' + summary.success_count);
  logger.info('更新件数　　: ' + summary.updated_count);
  logger.info('変更なし件数: ' + summary.unchanged_count);
  logger.info('スキップ件数: ' + summary.skipped_count);
  logger.info('失敗件数　　: ' + summary.failed_count);
  logger.info('所要時間　　: ' + summary.duration_seconds + '秒');
  logger.info('対象決定方法: ' + summary.strategy);

  if (summary.dry_run && summary.planned_changes.length > 0) {
    logger.info('--- Dry Run: 実際に更新される予定の内容 ---');
    summary.planned_changes.forEach(function (plan) {
      logger.info('  ' + plan);
    });
  }

  if (summary.failures.length > 0) {
    logger.info('--- 失敗・スキップした法令 ---');
    summary.failures.forEach(function (failure) {
      logger.info('  ' + failure.law_name + ': ' + failure.reason);
    });
  }
}
