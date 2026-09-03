/**
 * @file 14_catalog_service.gs
 * 同期状態（同期状態.json）と法令一覧CSVの管理。
 *
 * 同期状態.json が本システムの「台帳」であり、
 * ファイルID・ハッシュ・取得日時などを保持する。
 * 法令一覧.csv は台帳から機械的に生成する派生物である。
 */

/**
 * 同期状態を読み込む。存在しなければ空の台帳を返す。
 *
 * @param {!DriveService} driveService Driveサービス
 * @return {{schema_version: string, updated_at: ?string, laws: !Object<string, !Object>}}
 */
function loadSyncState(driveService) {
  var systemFolder = driveService.getSystemFolder();
  var text = driveService.readTextFile(systemFolder, CONFIG.SYSTEM_FILES.SYNC_STATE);

  if (!text) {
    return { schema_version: CONFIG.SCHEMA_VERSION, updated_at: null, laws: {} };
  }

  var parsed = safeJsonParse(text, null);
  if (!parsed || typeof parsed !== 'object' || !parsed.laws) {
    // 壊れていても処理を止めない。空の台帳から作り直す。
    return { schema_version: CONFIG.SCHEMA_VERSION, updated_at: null, laws: {} };
  }
  return parsed;
}

/**
 * 同期状態を保存する。
 *
 * @param {!DriveService} driveService Driveサービス
 * @param {!Object} state 同期状態
 */
function saveSyncState(driveService, state) {
  state.schema_version = CONFIG.SCHEMA_VERSION;
  state.updated_at = nowIso();
  var systemFolder = driveService.getSystemFolder();
  driveService.upsertTextFileByName(
    systemFolder, CONFIG.SYSTEM_FILES.SYNC_STATE, toPrettyJson(state));
}

/**
 * 台帳のキーを作る。
 * 法令IDが確定していればそれを使い、未確定ならカテゴリと法令名で代用する。
 *
 * @param {!Object} lawConfig 設定エントリ
 * @param {?string=} lawId 法令ID
 * @return {string} 台帳キー
 */
function buildStateKey(lawConfig, lawId) {
  if (lawId) {
    return lawId;
  }
  return lawConfig.category + '::' + lawConfig.name;
}

/**
 * 台帳から法令のレコードを取得する。
 * 法令IDが後から確定した場合に備え、旧キー（カテゴリ::法令名）も探す。
 *
 * @param {!Object} state 同期状態
 * @param {!Object} lawConfig 設定エントリ
 * @param {?string=} lawId 法令ID
 * @return {?Object} レコード。無ければ null
 */
function findStateRecord(state, lawConfig, lawId) {
  if (lawId && state.laws[lawId]) {
    return state.laws[lawId];
  }
  var fallbackKey = lawConfig.category + '::' + lawConfig.name;
  if (state.laws[fallbackKey]) {
    return state.laws[fallbackKey];
  }
  // 設定名と一致するレコードを走査する（法令IDが変わった場合の救済）
  var found = null;
  Object.keys(state.laws).forEach(function (key) {
    if (found) {
      return;
    }
    var record = state.laws[key];
    if (record && record.config_name === lawConfig.name &&
        record.category === lawConfig.category) {
      found = record;
    }
  });
  return found;
}

/**
 * 台帳へレコードを書き込む。法令IDが確定したら旧キーを削除して移動する。
 *
 * @param {!Object} state 同期状態
 * @param {!Object} record レコード
 * @param {!Object} lawConfig 設定エントリ
 */
function putStateRecord(state, record, lawConfig) {
  var newKey = buildStateKey(lawConfig, record.law_id);
  var oldKey = lawConfig.category + '::' + lawConfig.name;

  if (newKey !== oldKey && state.laws[oldKey]) {
    delete state.laws[oldKey];
  }
  state.laws[newKey] = record;
}

/**
 * 台帳から法令一覧CSVを生成し、Driveへ保存する。
 *
 * @param {!DriveService} driveService Driveサービス
 * @param {!Object} state 同期状態
 * @return {number} 出力した行数
 */
function writeLawListCsv(driveService, state) {
  var rows = [];

  Object.keys(state.laws).sort().forEach(function (key) {
    var record = state.laws[key];
    if (!record) {
      return;
    }
    rows.push(CONFIG.CSV_COLUMNS.map(function (column) {
      return record[column] === undefined || record[column] === null ? '' : record[column];
    }));
  });

  var csv = buildCsv(CONFIG.CSV_COLUMNS, rows);
  var systemFolder = driveService.getSystemFolder();
  driveService.upsertTextFileByName(
    systemFolder, CONFIG.SYSTEM_FILES.LAW_LIST_CSV, csv, MimeType.CSV);
  return rows.length;
}

/**
 * 最終同期情報を保存する。
 *
 * @param {!DriveService} driveService Driveサービス
 * @param {!Object} summary 同期結果のサマリ
 */
function writeLastSyncInfo(driveService, summary) {
  var systemFolder = driveService.getSystemFolder();
  driveService.upsertTextFileByName(
    systemFolder, CONFIG.SYSTEM_FILES.LAST_SYNC_INFO, toPrettyJson(summary));
}

/**
 * 00_システム情報/README.md を生成する。
 * Drive上でフォルダ構成と運用方法が分かるようにするためのもの。
 *
 * @param {!DriveService} driveService Driveサービス
 * @param {!Object} state 同期状態
 */
function writeDriveReadme(driveService, state) {
  var lawCount = Object.keys(state.laws).length;
  var lines = [
    '# 日本法令データベース',
    '',
    'このフォルダは Google Apps Script により自動生成・自動更新されています。',
    '**フォルダ名やファイル名を手動で変更しないでください。**',
    '変更すると自動更新が正しく動作しなくなります。',
    '',
    '- 最終更新：' + formatJst(new Date()),
    '- 登録法令数：' + lawCount + ' 件',
    '- データ構造バージョン：' + CONFIG.SCHEMA_VERSION,
    '',
    '## データの出典',
    '',
    '- e-Gov法令検索（https://laws.e-gov.go.jp/）',
    '- 法令API Version 2',
    '',
    '法令本文は e-Gov が提供する正式なXMLをそのまま保存しています。',
    '要約・意訳・書き換えは一切行っていません。',
    '',
    '## フォルダ構成',
    '',
    '| フォルダ | 内容 |',
    '| --- | --- |',
    '| `' + CONFIG.FOLDERS.SYSTEM + '` | 法令一覧CSV・同期状態・エラーログ |',
    '| `' + CONFIG.CATEGORIES.tax.folderName + '` | 税制のMarkdown（法律／政令／省令） |',
    '| `' + CONFIG.CATEGORIES.social_insurance.folderName + '` | 社会保険のMarkdown |',
    '| `' + CONFIG.CATEGORIES.labor_insurance.folderName + '` | 労働保険のMarkdown |',
    '| `' + CONFIG.CATEGORIES.related.folderName + '` | 関連法令のMarkdown |',
    '| `' + CONFIG.FOLDERS.RAW_XML + '` | **原本XML**（加工していないe-Govデータ） |',
    '| `' + CONFIG.FOLDERS.SYSTEM_LOG + '` | 実行ログ |',
    '',
    '各カテゴリの `' + CONFIG.FOLDERS.HISTORY + '` には、改正前のファイルが退避されます。',
    '`' + CONFIG.FOLDERS.STRUCTURED + '` には、条・項・号に分解した構造化JSONが入ります。',
    '',
    '## 原本データと加工データの区別',
    '',
    '- **原本**：`' + CONFIG.FOLDERS.RAW_XML + '` 配下のXML。e-Govから取得したまま。',
    '- **加工**：各カテゴリのMarkdown・構造化JSON。原本XMLから機械的に変換したもの。',
    '',
    '条文の正確性が問題になる場合は、必ず原本XMLまたはe-Gov公式サイトを確認してください。',
    '',
    '## ステータスの意味',
    '',
    '| status | 意味 |',
    '| --- | --- |',
    '| `active` | 現在有効 |',
    '| `repealed` | 廃止 |',
    '| `expired` | 失効 |',
    '| `unknown` | 判定できなかった（要確認） |',
    '',
    '廃止・失効した法令もファイルは削除されず、ステータスだけが変わります。',
    ''
  ];

  var systemFolder = driveService.getSystemFolder();
  driveService.upsertTextFileByName(
    systemFolder, CONFIG.SYSTEM_FILES.README, lines.join('\n'));
}
