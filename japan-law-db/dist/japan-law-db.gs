/**
 * =============================================================================
 *  日本税制・社会保険法令 自動収集／Google Drive保存システム
 *  （全ソースを1ファイルへ結合した配布用ファイル）
 * =============================================================================
 *
 *  このファイルは tools/build-single-file.js が自動生成したものです。
 *  直接編集せず、src/ 配下の各ファイルを編集して再生成してください。
 *
 *  生成元（20ファイル）:
 *    - 00_config.gs
 *    - 01_laws_config.gs
 *    - 02_api_spec.gs
 *    - 03_utils.gs
 *    - 04_logger.gs
 *    - 05_properties_service.gs
 *    - 06_http_client.gs
 *    - 07_egov_api.gs
 *    - 08_response_reader.gs
 *    - 09_xml_parser.gs
 *    - 10_markdown_converter.gs
 *    - 11_structured_json.gs
 *    - 12_hash_service.gs
 *    - 13_drive_service.gs
 *    - 14_catalog_service.gs
 *    - 15_law_service.gs
 *    - 16_sync_service.gs
 *    - 17_trigger_service.gs
 *    - 18_main.gs
 *    - 19_tests.gs
 *
 *  使い方
 *  ------
 *  1. Apps Scriptエディタで新しいスクリプトファイルを1つ作る
 *  2. このファイルの中身をすべて貼り付ける
 *  3. appsscript.json も別途貼り付ける（src/appsscript.json）
 *
 *  主な実行関数
 *  ------------
 *    verifyApiSpec()   API仕様を公式OpenAPI仕様書と照合する（最初に実行）
 *    setup()           初回セットアップ（フォルダ作成＋全法令の取得）
 *    syncLaws()        通常同期（改正された法令だけ更新）
 *    dryRunSync()      何も書き換えずに更新予定だけ確認
 *    installTrigger()  毎日の自動更新を設定
 *    removeTrigger()   自動更新を停止
 *    showStatus()      現在の状態を表示
 *    runAllTests()     テストを実行
 * =============================================================================
 */


// ===========================================================================
// 00_config.gs
// ===========================================================================

/**
 * @file 00_config.gs
 * システム全体の設定値・定数。マジックナンバーはすべてここに集約する。
 * 対象法令そのものは 01_laws_config.gs で管理する（本ファイルには書かない）。
 */

/** @const {!Object} システム設定 */
var CONFIG = {

  /** Google Drive のマイドライブ直下に作成するルートフォルダ名 */
  ROOT_FOLDER_NAME: '日本法令データベース',

  /** タイムゾーン（表示・ファイル名用） */
  TIMEZONE: 'Asia/Tokyo',

  /** HTTPアクセス制御 */
  HTTP: {
    /** リクエスト間の最小待機時間（ミリ秒）。サーバ負荷を避けるため必ず待つ。 */
    MIN_INTERVAL_MS: 1200,
    /** 最大リトライ回数（初回試行を除く） */
    MAX_RETRIES: 4,
    /** 指数バックオフの基準待機時間（ミリ秒） */
    BACKOFF_BASE_MS: 2000,
    /** 指数バックオフの上限待機時間（ミリ秒） */
    BACKOFF_MAX_MS: 32000,
    /** リトライ対象のHTTPステータス */
    RETRYABLE_STATUS: [408, 425, 429, 500, 502, 503, 504],
    /** User-Agent 相当の識別文字列（問い合わせ先が分かるようにする） */
    USER_AGENT: 'JapanLawDatabase-GAS/1.0 (+e-Gov Law API v2 client)',
    /**
     * 法令検索1ページあたりの取得件数。
     * law_title は部分一致で検索されるため、候補が多くなりやすい。
     */
    SEARCH_PAGE_SIZE: 100,
    /**
     * 法令検索でページを送る最大回数。
     * 「所得税法等の一部を改正する法律」のような同名を含む法令が
     * 大量に存在するため、本命が埋もれないよう複数ページを確認する。
     */
    MAX_SEARCH_PAGES: 5
  },

  /** 実行時間制御（GASは1実行あたり最大6分の制限がある） */
  EXECUTION: {
    /** この時間を超えたら安全に中断し、続きは次回実行へ回す（ミリ秒） */
    SOFT_TIME_LIMIT_MS: 4.5 * 60 * 1000,
    /** 1回の同期で処理する法令の最大件数（0 = 無制限） */
    MAX_LAWS_PER_RUN: 0
  },

  /** 同期の挙動 */
  SYNC: {
    /**
     * 前回同期からこの日数を超えている場合、更新情報に頼らず
     * 全対象法令を再取得してハッシュ比較する（安全側フォールバック）。
     */
    FULL_RESYNC_AFTER_DAYS: 14,
    /** 履歴フォルダへ退避するかどうか */
    KEEP_HISTORY: true,
    /** 構造化JSON（structured/）を生成するか。Phase 2機能。 */
    GENERATE_STRUCTURED_JSON: true,
    /**
     * 原本として優先する形式。'xml' を推奨。
     * XMLで取得できない場合は、e-Govが返したJSONをそのまま原本として保存する
     * （JSONから疑似的なXMLを組み立てることはしない）。
     */
    PREFERRED_RAW_FORMAT: 'xml'
  },

  /** ログ設定 */
  LOG: {
    /** 出力する最小ログレベル: 'INFO' | 'WARN' | 'ERROR' */
    MIN_LEVEL: 'INFO',
    /** ログをDriveへ保存するか */
    SAVE_TO_DRIVE: true,
    /** 1ログファイルの最大文字数（超過分は切り詰め） */
    MAX_CHARS: 4 * 1000 * 1000
  },

  /** Script Properties のキー名 */
  PROPERTY_KEYS: {
    ROOT_FOLDER_ID: 'ROOT_FOLDER_ID',
    LAST_SYNC_AT: 'LAST_SYNC_AT',
    SETUP_COMPLETED_AT: 'SETUP_COMPLETED_AT',
    API_SPEC_VERIFIED_AT: 'API_SPEC_VERIFIED_AT',
    SCHEMA_VERSION: 'SCHEMA_VERSION'
  },

  /** データ構造のバージョン（将来のマイグレーション判定用） */
  SCHEMA_VERSION: '1.0.0',

  /** フォルダ構成の定義 */
  FOLDERS: {
    SYSTEM: '00_システム情報',
    SYSTEM_ERROR_LOG: 'エラーログ',
    RAW_XML: '90_RAW_XML',
    SYSTEM_LOG: '99_システムログ',
    HISTORY: '99_履歴',
    STRUCTURED: 'structured',
    /** カテゴリ配下の法令種別サブフォルダ */
    LAW_TYPE_SUBFOLDERS: {
      act: '01_法律',
      cabinet_order: '02_政令',
      ministerial_ordinance: '03_省令',
      other: '04_その他'
    }
  },

  /** 00_システム情報 配下のファイル名 */
  SYSTEM_FILES: {
    README: 'README.md',
    LAW_LIST_CSV: '法令一覧.csv',
    SYNC_STATE: '同期状態.json',
    LAST_SYNC_INFO: '最終同期情報.json'
  },

  /**
   * カテゴリ定義。
   * key           : 設定ファイル・関数引数で使う識別子
   * folderName    : Drive上のフォルダ名
   * rawFolderName : 90_RAW_XML 配下のフォルダ名
   * label         : Markdown メタデータに書く日本語表記
   *
   * 将来 05_国税庁資料 等を追加する場合は、ここに定義を足すだけでよい。
   * ただし「法令本文」と「通達等」は必ず別カテゴリとして分離すること。
   */
  CATEGORIES: {
    tax: {
      key: 'tax',
      folderName: '01_税制',
      rawFolderName: '税制',
      label: '税制',
      isStatute: true
    },
    social_insurance: {
      key: 'social_insurance',
      folderName: '02_社会保険',
      rawFolderName: '社会保険',
      label: '社会保険',
      isStatute: true
    },
    labor_insurance: {
      key: 'labor_insurance',
      folderName: '03_労働保険',
      rawFolderName: '労働保険',
      label: '労働保険',
      isStatute: true
    },
    related: {
      key: 'related',
      folderName: '04_関連法令',
      rawFolderName: '関連法令',
      label: '関連法令',
      isStatute: true
    }
  },

  /**
   * 将来拡張用カテゴリ（Phase 4以降）。
   * 法令本文ではないため isStatute: false。
   * 有効化するには CATEGORIES へ移動するか、mergeFutureCategories() を呼ぶ。
   */
  FUTURE_CATEGORIES: {
    nta_documents: {
      key: 'nta_documents',
      folderName: '05_国税庁資料',
      rawFolderName: '国税庁資料',
      label: '国税庁資料',
      isStatute: false
    },
    mhlw_documents: {
      key: 'mhlw_documents',
      folderName: '06_厚生労働省資料',
      rawFolderName: '厚生労働省資料',
      label: '厚生労働省資料',
      isStatute: false
    },
    nenkin_documents: {
      key: 'nenkin_documents',
      folderName: '07_日本年金機構資料',
      rawFolderName: '日本年金機構資料',
      label: '日本年金機構資料',
      isStatute: false
    }
  },

  /**
   * 法令種別の正規化定義。
   * e-Gov側の表記ゆれ（英語enum / 日本語）を内部キーへ寄せる。
   * @type {!Object<string, {key: string, label: string, folderKey: string}>}
   */
  LAW_TYPE_DEFS: {
    act: { key: 'act', label: '法律', folderKey: 'act' },
    cabinet_order: { key: 'cabinet_order', label: '政令', folderKey: 'cabinet_order' },
    ministerial_ordinance: {
      key: 'ministerial_ordinance', label: '省令', folderKey: 'ministerial_ordinance'
    },
    constitution: { key: 'constitution', label: '憲法', folderKey: 'other' },
    imperial_order: { key: 'imperial_order', label: '勅令', folderKey: 'other' },
    rule: { key: 'rule', label: '規則', folderKey: 'other' },
    other: { key: 'other', label: 'その他', folderKey: 'other' }
  },

  /** 法令ステータス */
  STATUS: {
    ACTIVE: 'active',
    REPEALED: 'repealed',
    EXPIRED: 'expired',
    UNKNOWN: 'unknown'
  },

  /** 法令一覧CSVの列定義（順序が保存フォーマットになる） */
  CSV_COLUMNS: [
    'category', 'law_name', 'law_id', 'law_number', 'law_type', 'status',
    'promulgation_date', 'effective_date', 'revision_id', 'revision_date',
    'retrieved_at', 'updated_at', 'source_url', 'xml_file_id',
    'markdown_file_id', 'last_hash'
  ],

  /** トリガー設定 */
  TRIGGER: {
    /** 定期同期で呼び出す関数名 */
    HANDLER_FUNCTION: 'syncLaws',
    /** 実行時刻（0-23、日本時間）。1日1回。 */
    HOUR_OF_DAY: 3
  }
};

// ===========================================================================
// 01_laws_config.gs
// ===========================================================================

/**
 * @file 01_laws_config.gs
 * 同期対象の法令カタログ（データのみ）。
 *
 * 法令を追加・削除する場合、**このファイルだけ**を編集すればよい。
 * 他のソースコードを変更する必要はない。
 *
 * 各エントリの項目
 * ----------------
 * category        : CONFIG.CATEGORIES のキー（'tax' | 'social_insurance' |
 *                   'labor_insurance' | 'related'）
 * name            : 検索に使う法令名。e-Gov上の正式名称と異なる場合は、
 *                   同期時にe-Gov側の正式名称が採用され officialName に記録される。
 * expectedLawType : 期待する法令種別（CONFIG.LAW_TYPE_DEFS のキー）。
 *                   検索結果の絞り込みと誤取得防止に使う。
 * enabled         : false にすると同期対象から外れる（削除はされない）。
 * lawId           : 法令IDを直接指定したい場合に設定（最優先）。
 *                   検索が曖昧なとき、ここに正式な法令IDを書けば確実に特定できる。
 * lawNum          : 法令番号を指定して候補を絞り込みたい場合に設定。
 * aliases         : 別名・旧称。検索候補の照合に使う。
 * notes           : 人間向けの備考。処理には影響しない。
 *
 * 注意
 * ----
 * 存在しない法令名を推測で追加しないこと。
 * 検索で0件だった場合、システムは「推測で近い法令を保存」せず、
 * WARN として記録し、その法令をスキップする（誤ったデータを保存しないため）。
 */

/**
 * 同期対象法令の定義。
 * @return {!Array<!Object>} 法令設定の配列
 */
function getLawsConfig() {
  return [
  // ------- 国税 -------
  {
    category: 'tax',
    name: '国税通則法',
    expectedLawType: 'act',
    enabled: true,
    lawId: null,
    lawNum: null,
    aliases: [],
    notes: '国税／法律'
  },
  {
    category: 'tax',
    name: '国税通則法施行令',
    expectedLawType: 'cabinet_order',
    enabled: true,
    lawId: null,
    lawNum: null,
    aliases: [],
    notes: '国税／政令'
  },
  {
    category: 'tax',
    name: '国税通則法施行規則',
    expectedLawType: 'ministerial_ordinance',
    enabled: true,
    lawId: null,
    lawNum: null,
    aliases: [],
    notes: '国税／省令'
  },
  {
    category: 'tax',
    name: '所得税法',
    expectedLawType: 'act',
    enabled: true,
    lawId: null,
    lawNum: null,
    aliases: [],
    notes: '国税／法律'
  },
  {
    category: 'tax',
    name: '所得税法施行令',
    expectedLawType: 'cabinet_order',
    enabled: true,
    lawId: null,
    lawNum: null,
    aliases: [],
    notes: '国税／政令'
  },
  {
    category: 'tax',
    name: '所得税法施行規則',
    expectedLawType: 'ministerial_ordinance',
    enabled: true,
    lawId: null,
    lawNum: null,
    aliases: [],
    notes: '国税／省令'
  },
  {
    category: 'tax',
    name: '法人税法',
    expectedLawType: 'act',
    enabled: true,
    lawId: null,
    lawNum: null,
    aliases: [],
    notes: '国税／法律'
  },
  {
    category: 'tax',
    name: '法人税法施行令',
    expectedLawType: 'cabinet_order',
    enabled: true,
    lawId: null,
    lawNum: null,
    aliases: [],
    notes: '国税／政令'
  },
  {
    category: 'tax',
    name: '法人税法施行規則',
    expectedLawType: 'ministerial_ordinance',
    enabled: true,
    lawId: null,
    lawNum: null,
    aliases: [],
    notes: '国税／省令'
  },
  {
    category: 'tax',
    name: '消費税法',
    expectedLawType: 'act',
    enabled: true,
    lawId: null,
    lawNum: null,
    aliases: [],
    notes: '国税／法律'
  },
  {
    category: 'tax',
    name: '消費税法施行令',
    expectedLawType: 'cabinet_order',
    enabled: true,
    lawId: null,
    lawNum: null,
    aliases: [],
    notes: '国税／政令'
  },
  {
    category: 'tax',
    name: '消費税法施行規則',
    expectedLawType: 'ministerial_ordinance',
    enabled: true,
    lawId: null,
    lawNum: null,
    aliases: [],
    notes: '国税／省令'
  },
  {
    category: 'tax',
    name: '相続税法',
    expectedLawType: 'act',
    enabled: true,
    lawId: null,
    lawNum: null,
    aliases: [],
    notes: '国税／法律'
  },
  {
    category: 'tax',
    name: '相続税法施行令',
    expectedLawType: 'cabinet_order',
    enabled: true,
    lawId: null,
    lawNum: null,
    aliases: [],
    notes: '国税／政令'
  },
  {
    category: 'tax',
    name: '相続税法施行規則',
    expectedLawType: 'ministerial_ordinance',
    enabled: true,
    lawId: null,
    lawNum: null,
    aliases: [],
    notes: '国税／省令'
  },
  {
    category: 'tax',
    name: '租税特別措置法',
    expectedLawType: 'act',
    enabled: true,
    lawId: null,
    lawNum: null,
    aliases: [],
    notes: '国税／法律'
  },
  {
    category: 'tax',
    name: '租税特別措置法施行令',
    expectedLawType: 'cabinet_order',
    enabled: true,
    lawId: null,
    lawNum: null,
    aliases: [],
    notes: '国税／政令'
  },
  {
    category: 'tax',
    name: '租税特別措置法施行規則',
    expectedLawType: 'ministerial_ordinance',
    enabled: true,
    lawId: null,
    lawNum: null,
    aliases: [],
    notes: '国税／省令'
  },

  // ------- 地方税 -------
  {
    category: 'tax',
    name: '地方税法',
    expectedLawType: 'act',
    enabled: true,
    lawId: null,
    lawNum: null,
    aliases: [],
    notes: '地方税／法律'
  },
  {
    category: 'tax',
    name: '地方税法施行令',
    expectedLawType: 'cabinet_order',
    enabled: true,
    lawId: null,
    lawNum: null,
    aliases: [],
    notes: '地方税／政令'
  },
  {
    category: 'tax',
    name: '地方税法施行規則',
    expectedLawType: 'ministerial_ordinance',
    enabled: true,
    lawId: null,
    lawNum: null,
    aliases: [],
    notes: '地方税／省令'
  },

  // ------- 社会保険 -------
  {
    category: 'social_insurance',
    name: '健康保険法',
    expectedLawType: 'act',
    enabled: true,
    lawId: null,
    lawNum: null,
    aliases: [],
    notes: '社会保険／法律'
  },
  {
    category: 'social_insurance',
    name: '健康保険法施行令',
    expectedLawType: 'cabinet_order',
    enabled: true,
    lawId: null,
    lawNum: null,
    aliases: [],
    notes: '社会保険／政令'
  },
  {
    category: 'social_insurance',
    name: '健康保険法施行規則',
    expectedLawType: 'ministerial_ordinance',
    enabled: true,
    lawId: null,
    lawNum: null,
    aliases: [],
    notes: '社会保険／省令'
  },
  {
    category: 'social_insurance',
    name: '厚生年金保険法',
    expectedLawType: 'act',
    enabled: true,
    lawId: null,
    lawNum: null,
    aliases: [],
    notes: '社会保険／法律'
  },
  {
    category: 'social_insurance',
    name: '厚生年金保険法施行令',
    expectedLawType: 'cabinet_order',
    enabled: true,
    lawId: null,
    lawNum: null,
    aliases: [],
    notes: '社会保険／政令'
  },
  {
    category: 'social_insurance',
    name: '厚生年金保険法施行規則',
    expectedLawType: 'ministerial_ordinance',
    enabled: true,
    lawId: null,
    lawNum: null,
    aliases: [],
    notes: '社会保険／省令'
  },
  {
    category: 'social_insurance',
    name: '国民年金法',
    expectedLawType: 'act',
    enabled: true,
    lawId: null,
    lawNum: null,
    aliases: [],
    notes: '社会保険／法律'
  },
  {
    category: 'social_insurance',
    name: '国民年金法施行令',
    expectedLawType: 'cabinet_order',
    enabled: true,
    lawId: null,
    lawNum: null,
    aliases: [],
    notes: '社会保険／政令'
  },
  {
    category: 'social_insurance',
    name: '国民年金法施行規則',
    expectedLawType: 'ministerial_ordinance',
    enabled: true,
    lawId: null,
    lawNum: null,
    aliases: [],
    notes: '社会保険／省令'
  },
  {
    category: 'social_insurance',
    name: '国民健康保険法',
    expectedLawType: 'act',
    enabled: true,
    lawId: null,
    lawNum: null,
    aliases: [],
    notes: '社会保険／法律'
  },
  {
    category: 'social_insurance',
    name: '国民健康保険法施行令',
    expectedLawType: 'cabinet_order',
    enabled: true,
    lawId: null,
    lawNum: null,
    aliases: [],
    notes: '社会保険／政令'
  },
  {
    category: 'social_insurance',
    name: '国民健康保険法施行規則',
    expectedLawType: 'ministerial_ordinance',
    enabled: true,
    lawId: null,
    lawNum: null,
    aliases: [],
    notes: '社会保険／省令'
  },
  {
    category: 'social_insurance',
    name: '介護保険法',
    expectedLawType: 'act',
    enabled: true,
    lawId: null,
    lawNum: null,
    aliases: [],
    notes: '社会保険／法律'
  },
  {
    category: 'social_insurance',
    name: '介護保険法施行令',
    expectedLawType: 'cabinet_order',
    enabled: true,
    lawId: null,
    lawNum: null,
    aliases: [],
    notes: '社会保険／政令'
  },
  {
    category: 'social_insurance',
    name: '介護保険法施行規則',
    expectedLawType: 'ministerial_ordinance',
    enabled: true,
    lawId: null,
    lawNum: null,
    aliases: [],
    notes: '社会保険／省令'
  },

  // ------- 労働保険 -------
  {
    category: 'labor_insurance',
    name: '雇用保険法',
    expectedLawType: 'act',
    enabled: true,
    lawId: null,
    lawNum: null,
    aliases: [],
    notes: '労働保険／法律'
  },
  {
    category: 'labor_insurance',
    name: '雇用保険法施行令',
    expectedLawType: 'cabinet_order',
    enabled: true,
    lawId: null,
    lawNum: null,
    aliases: [],
    notes: '労働保険／政令'
  },
  {
    category: 'labor_insurance',
    name: '雇用保険法施行規則',
    expectedLawType: 'ministerial_ordinance',
    enabled: true,
    lawId: null,
    lawNum: null,
    aliases: [],
    notes: '労働保険／省令'
  },
  {
    category: 'labor_insurance',
    name: '労働者災害補償保険法',
    expectedLawType: 'act',
    enabled: true,
    lawId: null,
    lawNum: null,
    aliases: [],
    notes: '労働保険／法律'
  },
  {
    category: 'labor_insurance',
    name: '労働者災害補償保険法施行令',
    expectedLawType: 'cabinet_order',
    enabled: true,
    lawId: null,
    lawNum: null,
    aliases: [],
    notes: '労働保険／政令'
  },
  {
    category: 'labor_insurance',
    name: '労働者災害補償保険法施行規則',
    expectedLawType: 'ministerial_ordinance',
    enabled: true,
    lawId: null,
    lawNum: null,
    aliases: [],
    notes: '労働保険／省令'
  },
  {
    category: 'labor_insurance',
    name: '労働保険の保険料の徴収等に関する法律',
    expectedLawType: 'act',
    enabled: true,
    lawId: null,
    lawNum: null,
    aliases: [],
    notes: '労働保険／法律'
  },
  {
    category: 'labor_insurance',
    name: '労働保険の保険料の徴収等に関する法律施行令',
    expectedLawType: 'cabinet_order',
    enabled: true,
    lawId: null,
    lawNum: null,
    aliases: [],
    notes: '労働保険／政令'
  },
  {
    category: 'labor_insurance',
    name: '労働保険の保険料の徴収等に関する法律施行規則',
    expectedLawType: 'ministerial_ordinance',
    enabled: true,
    lawId: null,
    lawNum: null,
    aliases: [],
    notes: '労働保険／省令'
  }

    // ------- 関連法令（必要に応じてここへ追加する） -------
    // 税制・社会保険・労働保険の各法令から直接参照される重要な法令を
    // 追加する場合は、以下の形式で追記する。
    //
    // {
    //   category: 'related',
    //   name: '（e-Gov上の正式名称）',
    //   expectedLawType: 'act',
    //   enabled: true,
    //   lawId: null,
    //   lawNum: null,
    //   aliases: [],
    //   notes: '追加理由をここに書く'
    // }
  ];
}

/**
 * 設定を検証し、不正なエントリを検出する。
 * setup() / syncLaws() の冒頭で必ず呼ぶ。
 *
 * @param {!Array<!Object>=} laws 検証対象（省略時は getLawsConfig()）
 * @return {{valid: !Array<!Object>, errors: !Array<string>}}
 *     valid  : 検証を通ったエントリ
 *     errors : 問題の説明（law単位）
 */
function validateLawsConfig(laws) {
  var entries = laws || getLawsConfig();
  var valid = [];
  var errors = [];
  var seen = {};

  entries.forEach(function (law, index) {
    var where = '[' + index + '] ' + (law && law.name ? law.name : '(名称なし)');

    if (!law || typeof law !== 'object') {
      errors.push(where + ': エントリがオブジェクトではありません');
      return;
    }
    if (!law.name || typeof law.name !== 'string') {
      errors.push(where + ': name が未設定です');
      return;
    }
    if (!law.category || !CONFIG.CATEGORIES[law.category]) {
      errors.push(where + ': category "' + law.category + '" は未定義です');
      return;
    }
    if (law.expectedLawType && !CONFIG.LAW_TYPE_DEFS[law.expectedLawType]) {
      errors.push(where + ': expectedLawType "' + law.expectedLawType + '" は未定義です');
      return;
    }

    // 同一カテゴリ内での法令名重複を検出する
    var dupKey = law.category + ' ' + law.name;
    if (seen[dupKey]) {
      errors.push(where + ': 同一カテゴリ内で法令名が重複しています');
      return;
    }
    seen[dupKey] = true;

    valid.push(law);
  });

  return { valid: valid, errors: errors };
}

/**
 * 有効（enabled）な対象法令のみを返す。
 *
 * @param {string=} categoryKey 指定するとそのカテゴリのみ
 * @return {!Array<!Object>} 対象法令の配列
 */
function getEnabledLaws(categoryKey) {
  var result = validateLawsConfig();
  return result.valid.filter(function (law) {
    if (law.enabled === false) {
      return false;
    }
    return !categoryKey || law.category === categoryKey;
  });
}

/**
 * 法令名（または別名）から設定エントリを1件検索する。
 * syncSingleLaw() で使う。
 *
 * @param {string} name 法令名
 * @return {?Object} 見つかった設定エントリ。なければ null
 */
function findLawConfigByName(name) {
  if (!name) {
    return null;
  }
  var needle = normalizeLawName(name);
  var result = validateLawsConfig();
  var found = null;

  result.valid.forEach(function (law) {
    if (found) {
      return;
    }
    if (normalizeLawName(law.name) === needle) {
      found = law;
      return;
    }
    (law.aliases || []).forEach(function (alias) {
      if (!found && normalizeLawName(alias) === needle) {
        found = law;
      }
    });
  });

  return found;
}

// ===========================================================================
// 02_api_spec.gs
// ===========================================================================

/**
 * @file 02_api_spec.gs
 * e-Gov 法令API Version 2 の「仕様マップ」。
 *
 * 設計方針
 * --------
 * 本システムでは、APIのパス・クエリパラメータ名・レスポンス項目名を
 * **このファイル1か所だけ**に集約する。他のファイルは必ずここを参照する。
 * これにより、e-Gov側の仕様変更が起きた場合でも、修正箇所がここに限定される。
 *
 * 重要（必ず読むこと）
 * --------------------
 * 実運用前に必ず {@link verifyApiSpec} を実行し、
 * 公式OpenAPI仕様（https://laws.e-gov.go.jp/api/2/swagger-ui/）と
 * 突き合わせて差異がないことを確認すること。
 * 差異があった場合は、コード本体ではなく **このファイルの値を修正** すれば動く。
 *
 * 確認状況（2026-09-03時点）
 * --------------------------
 * 実装環境から laws.e-gov.go.jp へ到達できなかったため、公式仕様書は未確認。
 * ただし、実際に稼働している公開クライアント実装
 * （npm: @gonuts555/e-gov-mcp, law-mcp-server）のソースコードを照合し、
 * 以下を確認済みとした。
 *
 *   - ベースURL          : https://laws.e-gov.go.jp/api/2
 *   - GET /laws          : law_title / law_num / law_type / limit
 *                          （law_title は「部分一致」で検索される）
 *   - GET /law_data/{id} : law_full_text_format / asof / revision
 *   - GET /keyword       : keyword
 *   - レスポンス構造     : { laws: [ { law_info: {...}, revision_info: {...} } ] }
 *                          { law_info, revision_info, law_full_text }
 *   - 本文のJSON表現     : { tag, attr, children } の入れ子。文字列は本文テキスト
 *
 * 特に注意：本文形式の指定は response_format ではなく
 * **law_full_text_format** である。
 *
 * レスポンス項目名については、単一の名前を決め打ちせず
 * FIELD_CANDIDATES に「あり得る名前の候補配列」を持たせ、
 * 08_response_reader.gs が候補を順に探索する（寛容な読み取り）。
 * これにより命名差異はクラッシュではなくWARNに縮退する。
 */

/** @const {!Object} e-Gov 法令API Version 2 の仕様定義 */
var EGOV_API_SPEC = {

  /** APIのベースURL（末尾スラッシュなし） */
  BASE_URL: 'https://laws.e-gov.go.jp/api/2',

  /** 人間がブラウザで法令を確認するためのページのベースURL */
  HUMAN_BASE_URL: 'https://laws.e-gov.go.jp/law',

  /** e-Gov 更新法令情報ページ（人間向け） */
  UPDATE_PAGE_URL: 'https://laws.e-gov.go.jp/update/',

  /**
   * OpenAPI仕様書(JSON)のURL候補。
   * Swagger UIが読み込む実体のパスは実装時点で確認が必要なため、
   * verifyApiSpec() が上から順に試行する。
   * @type {!Array<string>}
   */
  OPENAPI_URL_CANDIDATES: [
    'https://laws.e-gov.go.jp/api/2/openapi.json',
    'https://laws.e-gov.go.jp/api/2/swagger-ui/openapi.json',
    'https://laws.e-gov.go.jp/api/2/openapi.yaml',
    'https://laws.e-gov.go.jp/api/2/swagger.json',
    'https://laws.e-gov.go.jp/api/2/api-docs',
    'https://laws.e-gov.go.jp/api/2/v3/api-docs'
  ],

  /**
   * エンドポイント定義。
   * path 内の {name} は pathParams で置換される。
   * @type {!Object<string, {path: string, method: string, note: string}>}
   */
  ENDPOINTS: {
    /** 法令一覧取得 */
    LAWS: {
      path: '/laws',
      method: 'get',
      note: '法令一覧。法令種別・分類などで絞り込み、法令ID/法令番号/法令名を得る。'
    },
    /** 法令本文取得（法令ID・法令番号・法令履歴IDのいずれかで指定） */
    LAW_DATA: {
      path: '/law_data/{lawIdOrNumOrRevisionId}',
      method: 'get',
      note: '法令本文取得。law_full_text_format で json / xml を切り替える。'
    },
    /** 法令履歴一覧取得 */
    LAW_REVISIONS: {
      path: '/law_revisions/{lawIdOrNum}',
      method: 'get',
      note: '改正履歴一覧。Phase 4 で本格利用。'
    },
    /** キーワード検索 */
    KEYWORD: {
      path: '/keyword',
      method: 'get',
      note: '法令本文に対するキーワード検索。'
    },
    /** 法令本文ファイル取得 */
    LAW_FILE: {
      path: '/law_file/{fileType}/{lawIdOrNumOrRevisionId}',
      method: 'get',
      note: '法令本文ファイル（xml/json等）の取得。LAW_DATAが使えない場合の代替。'
    },
    /** 添付ファイル取得 */
    ATTACHMENT: {
      path: '/attachment',
      method: 'get',
      note: '添付ファイル取得。Phase 4 で利用予定。'
    }
  },

  /**
   * クエリパラメータ名の定義。
   * コード側は EGOV_API_SPEC.PARAMS.XXX を使い、生文字列を書かない。
   * @type {!Object<string, string>}
   */
  PARAMS: {
    // --- 実際に稼働しているクライアント実装で確認済みのパラメータ ---
    /** 法令本文の形式。'json' / 'xml'。※ response_format ではない点に注意 */
    LAW_FULL_TEXT_FORMAT: 'law_full_text_format',
    /** 法令名（部分一致で検索される。完全一致は呼び出し側で絞り込むこと） */
    LAW_TITLE: 'law_title',
    /** 法令番号 */
    LAW_NUM: 'law_num',
    /** 法令種別 */
    LAW_TYPE: 'law_type',
    /** 取得件数の上限 */
    LIMIT: 'limit',
    /** キーワード検索の検索語 */
    KEYWORD: 'keyword',
    /** 時点指定（YYYY-MM-DD）。その日時点で有効な法令を取得する */
    ASOF: 'asof',
    /** 改正版の指定（YYYY-MM-DD） */
    REVISION: 'revision',

    // --- 未確認のパラメータ（verifyApiSpec() で確認すること） ---
    RESPONSE_FORMAT: 'response_format',
    LAW_TITLE_KANA: 'law_title_kana',
    OFFSET: 'offset',
    CATEGORY_CD: 'category_cd',
    PROMULGATION_DATE_FROM: 'promulgation_date_from',
    PROMULGATION_DATE_TO: 'promulgation_date_to',
    UPDATED_FROM: 'updated_from',
    UPDATED_TO: 'updated_to',
    OMIT_CURRENT: 'omit_current',
    LAW_NUM_ERA: 'law_num_era',
    ELEMENT: 'elm',
    SENTENCE_TEXT_SIZE: 'sentence_text_size'
  },

  /** 本文形式パラメータ（law_full_text_format）に渡す値 */
  FORMATS: {
    JSON: 'json',
    XML: 'xml'
  },

  /**
   * 法令種別（law_type）の値。
   * e-Gov 側の enum 値は verifyApiSpec() で確認すること。
   * 値が異なっていた場合はここだけ直せばよい。
   * @type {!Object<string, string>}
   */
  LAW_TYPES: {
    CONSTITUTION: 'Constitution',
    ACT: 'Act',
    CABINET_ORDER: 'CabinetOrder',
    IMPERIAL_ORDER: 'ImperialOrder',
    MINISTERIAL_ORDINANCE: 'MinisterialOrdinance',
    RULE: 'Rule',
    MISC: 'Misc'
  },

  /**
   * レスポンス項目名の候補。
   * e-Gov側の命名（snake_case / camelCase / 日本語キー）に依存しないよう、
   * 候補を順に探索して最初に見つかった値を採用する。
   * 追加候補が判明したら配列に足すだけでよい。
   * @type {!Object<string, !Array<string>>}
   */
  FIELD_CANDIDATES: {
    /** 法令一覧の配列本体 */
    LAW_LIST: ['laws', 'law_list', 'lawList', 'items', 'results', 'data'],
    /** 法令ID */
    LAW_ID: ['law_id', 'lawId', 'LawId', 'law_info.law_id'],
    /** 法令番号 */
    LAW_NUM: ['law_num', 'lawNum', 'LawNum', 'law_info.law_num'],
    /** 法令名（正式名称） */
    LAW_TITLE: ['law_title', 'lawTitle', 'LawTitle', 'law_name', 'title',
                'revision_info.law_title', 'current_revision_info.law_title'],
    /** 法令名かな */
    LAW_TITLE_KANA: ['law_title_kana', 'lawTitleKana', 'LawTitleKana',
                     'revision_info.law_title_kana'],
    /** 法令種別 */
    LAW_TYPE: ['law_type', 'lawType', 'LawType', 'law_info.law_type'],
    /** 法令履歴ID（改正版ID） */
    REVISION_ID: ['law_revision_id', 'lawRevisionId', 'revision_id', 'revisionId',
                  'revision_info.law_revision_id', 'current_revision_info.law_revision_id'],
    /** 改正日 */
    REVISION_DATE: ['amendment_promulgate_date', 'revision_date', 'revisionDate',
                    'revision_info.amendment_promulgate_date',
                    'current_revision_info.amendment_promulgate_date'],
    /** 公布日 */
    PROMULGATION_DATE: ['promulgation_date', 'promulgationDate', 'promulgate_date',
                        'law_info.promulgation_date'],
    /** 施行日 */
    EFFECTIVE_DATE: ['amendment_enforcement_date', 'enforcement_date', 'effective_date',
                     'revision_info.amendment_enforcement_date',
                     'current_revision_info.amendment_enforcement_date'],
    /** 廃止日 */
    REPEAL_DATE: ['repeal_date', 'repealDate', 'abolition_date',
                  'revision_info.repeal_date', 'current_revision_info.repeal_date'],
    /** 廃止区分 */
    REPEAL_STATUS: ['repeal_status', 'repealStatus',
                    'revision_info.repeal_status', 'current_revision_info.repeal_status'],
    /** 法令本文（XML文字列 または 構造化オブジェクト） */
    LAW_FULL_TEXT: ['law_full_text', 'lawFullText', 'full_text', 'law_body', 'LawBody'],
    /** 総件数（ページング用） */
    TOTAL_COUNT: ['total_count', 'totalCount', 'count', 'total'],
    /** 次ページ情報 */
    NEXT_OFFSET: ['next_offset', 'nextOffset']
  },

  /**
   * verifyApiSpec() が「このパスは存在するはず」と確認する対象。
   * ENDPOINTS のキー名。
   * @type {!Array<string>}
   */
  REQUIRED_ENDPOINT_KEYS: ['LAWS', 'LAW_DATA', 'LAW_REVISIONS', 'KEYWORD'],

  /**
   * 仕様確認の状態。
   * verifyApiSpec() 成功時に Script Properties へ記録される。
   */
  SPEC_VERIFIED_PROPERTY: 'API_SPEC_VERIFIED_AT'
};

/**
 * エンドポイント定義から実際のURLを組み立てる。
 *
 * @param {string} endpointKey EGOV_API_SPEC.ENDPOINTS のキー（例: 'LAW_DATA'）
 * @param {!Object<string, string>=} pathParams パスパラメータ（例: {lawIdOrNumOrRevisionId: '...'}）
 * @param {!Object<string, (string|number|boolean)>=} queryParams クエリパラメータ
 * @return {string} 完成したURL
 * @throws {Error} 未知のエンドポイントキー、またはパスパラメータ不足の場合
 */
function buildEgovUrl(endpointKey, pathParams, queryParams) {
  var endpoint = EGOV_API_SPEC.ENDPOINTS[endpointKey];
  if (!endpoint) {
    throw new Error('未知のエンドポイントキーです: ' + endpointKey);
  }

  var path = endpoint.path;
  var params = pathParams || {};

  // {name} を置換する。未指定のプレースホルダが残っていたらエラーにする。
  path = path.replace(/\{([^}]+)\}/g, function (whole, name) {
    var value = params[name];
    if (value === undefined || value === null || value === '') {
      throw new Error(
        'パスパラメータ "' + name + '" が指定されていません（endpoint=' + endpointKey + '）');
    }
    return encodeURIComponent(String(value));
  });

  var url = EGOV_API_SPEC.BASE_URL + path;
  var query = buildQueryString(queryParams);
  return query ? url + '?' + query : url;
}

/**
 * クエリ文字列を組み立てる。null / undefined / '' の値は送信しない。
 *
 * @param {!Object<string, (string|number|boolean)>=} queryParams
 * @return {string} 'a=1&b=2' 形式（空なら ''）
 */
function buildQueryString(queryParams) {
  if (!queryParams) {
    return '';
  }
  var pairs = [];
  Object.keys(queryParams).forEach(function (key) {
    var value = queryParams[key];
    if (value === undefined || value === null || value === '') {
      return;
    }
    pairs.push(encodeURIComponent(key) + '=' + encodeURIComponent(String(value)));
  });
  return pairs.join('&');
}

/**
 * 人間がブラウザで確認するための e-Gov 法令ページURLを組み立てる。
 * API URL とは明確に区別して保存する（source_url / api_source_url）。
 *
 * @param {string} lawId 法令ID
 * @return {string} 法令ページURL
 */
function buildHumanLawUrl(lawId) {
  return EGOV_API_SPEC.HUMAN_BASE_URL + '/' + encodeURIComponent(lawId);
}

// ===========================================================================
// 03_utils.gs
// ===========================================================================

/**
 * @file 03_utils.gs
 * 汎用ユーティリティ。外部サービスに依存しない純粋関数を中心に置く。
 */

/**
 * 現在時刻をISO 8601形式（UTC）で返す。内部保存用。
 * @return {string} 例: '2026-09-03T03:00:00.000Z'
 */
function nowIso() {
  return new Date().toISOString();
}

/**
 * 日時を日本時間の表示用文字列へ整形する。
 * @param {(Date|string)=} date 対象日時（省略時は現在）
 * @return {string} 例: '2026-09-03 12:00:00 JST'
 */
function formatJst(date) {
  var d = toDate(date);
  if (!d) {
    return '';
  }
  return formatDateWithOffset(d, 9 * 60, 'yyyy-MM-dd HH:mm:ss') + ' JST';
}

/**
 * ファイル名に使う日本時間のタイムスタンプを返す。
 * @param {(Date|string)=} date 対象日時（省略時は現在）
 * @return {string} 例: '20260903_120000'
 */
function timestampForFileName(date) {
  var d = toDate(date) || new Date();
  return formatDateWithOffset(d, 9 * 60, 'yyyyMMdd_HHmmss');
}

/**
 * 指定のUTCオフセットで日時を整形する。
 * GASの Utilities.formatDate に依存せず、どの環境でも同じ結果になるようにする。
 *
 * @param {!Date} date 対象日時
 * @param {number} offsetMinutes UTCからのオフセット（分）。日本時間は 540。
 * @param {string} pattern 'yyyy-MM-dd HH:mm:ss' 形式のパターン
 * @return {string} 整形結果
 */
function formatDateWithOffset(date, offsetMinutes, pattern) {
  var shifted = new Date(date.getTime() + offsetMinutes * 60 * 1000);
  var parts = {
    yyyy: String(shifted.getUTCFullYear()),
    MM: pad2(shifted.getUTCMonth() + 1),
    dd: pad2(shifted.getUTCDate()),
    HH: pad2(shifted.getUTCHours()),
    mm: pad2(shifted.getUTCMinutes()),
    ss: pad2(shifted.getUTCSeconds())
  };
  return pattern.replace(/yyyy|MM|dd|HH|mm|ss/g, function (token) {
    return parts[token];
  });
}

/**
 * 2桁ゼロ埋め。
 * @param {number} n 数値
 * @return {string} 例: '03'
 */
function pad2(n) {
  return (n < 10 ? '0' : '') + n;
}

/**
 * 値を Date へ変換する。変換できない場合は null。
 * @param {(Date|string|number|null|undefined)} value 入力
 * @return {?Date} Date または null
 */
function toDate(value) {
  if (!value && value !== 0) {
    return new Date();
  }
  if (value instanceof Date) {
    return isNaN(value.getTime()) ? null : value;
  }
  var d = new Date(value);
  return isNaN(d.getTime()) ? null : d;
}

/**
 * 2つの日時の差を日数で返す。
 * @param {(Date|string)} from 起点
 * @param {(Date|string)} to 終点
 * @return {number} 日数（小数を含む）。算出不可なら Infinity
 */
function diffInDays(from, to) {
  var a = toDate(from);
  var b = toDate(to);
  if (!a || !b) {
    return Infinity;
  }
  return (b.getTime() - a.getTime()) / (24 * 60 * 60 * 1000);
}

/**
 * 法令名を比較用に正規化する。
 * 全角空白・半角空白・記号ゆれを吸収するが、文字そのものは置換しない
 * （別の法令と誤って一致させないため、正規化は最小限にとどめる）。
 *
 * @param {string} name 法令名
 * @return {string} 正規化後の法令名
 */
function normalizeLawName(name) {
  if (!name) {
    return '';
  }
  return String(name)
    .replace(/[\s　]+/g, '')   // 半角・全角空白を除去
    .replace(/[（(]/g, '(')        // 括弧を半角へ統一
    .replace(/[）)]/g, ')')
    .trim();
}

/**
 * Google Drive のファイル名として安全な文字列へ変換する。
 * 法令名に含まれ得る記号のうち、扱いにくいものだけを置換する。
 *
 * @param {string} name 元の名前
 * @return {string} 安全なファイル名
 */
function sanitizeFileName(name) {
  if (!name) {
    return 'unnamed';
  }
  var safe = String(name)
    .replace(/[\/\\]/g, '／')      // パス区切りを全角へ
    .replace(/[\r\n\t]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  // Driveのファイル名長制限に対する安全側の切り詰め
  var MAX_LENGTH = 120;
  if (safe.length > MAX_LENGTH) {
    safe = safe.substring(0, MAX_LENGTH);
  }
  return safe || 'unnamed';
}

/**
 * CSVの1セルをエスケープする（RFC 4180準拠）。
 * @param {*} value 値
 * @return {string} エスケープ済みの文字列
 */
function escapeCsvCell(value) {
  if (value === null || value === undefined) {
    return '';
  }
  var s = String(value);
  if (/[",\r\n]/.test(s)) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

/**
 * 行の配列からCSV文字列を生成する。
 * Excelでの文字化けを防ぐため BOM を付与する。
 *
 * @param {!Array<string>} headers ヘッダ行
 * @param {!Array<!Array<*>>} rows データ行
 * @return {string} CSV文字列（BOM付き）
 */
function buildCsv(headers, rows) {
  var BOM = '﻿';
  var lines = [headers.map(escapeCsvCell).join(',')];
  rows.forEach(function (row) {
    lines.push(row.map(escapeCsvCell).join(','));
  });
  return BOM + lines.join('\r\n') + '\r\n';
}

/**
 * オブジェクトから深いパス（'a.b.c'）で値を取り出す。
 * @param {*} obj 対象オブジェクト
 * @param {string} path ドット区切りのパス
 * @return {*} 値。見つからなければ undefined
 */
function getByPath(obj, path) {
  if (!obj || !path) {
    return undefined;
  }
  var parts = String(path).split('.');
  var current = obj;
  for (var i = 0; i < parts.length; i++) {
    if (current === null || current === undefined) {
      return undefined;
    }
    current = current[parts[i]];
  }
  return current;
}

/**
 * エラーオブジェクトを読みやすい1行の文字列にする。
 * @param {*} error 例外オブジェクトなど
 * @return {string} 説明文字列
 */
function describeError(error) {
  if (!error) {
    return '(不明なエラー)';
  }
  if (typeof error === 'string') {
    return error;
  }
  var message = error.message || String(error);
  return message;
}

/**
 * 指定ミリ秒だけ待機する。
 * @param {number} ms 待機時間（ミリ秒）
 */
function sleepMs(ms) {
  if (ms > 0) {
    Utilities.sleep(ms);
  }
}

/**
 * JSONを人間が読みやすい形式で文字列化する。
 * @param {*} value 対象
 * @return {string} 整形済みJSON
 */
function toPrettyJson(value) {
  return JSON.stringify(value, null, 2);
}

/**
 * JSONを安全にパースする。失敗しても例外を投げない。
 * @param {string} text JSON文字列
 * @param {*=} fallback 失敗時の戻り値
 * @return {*} パース結果、または fallback
 */
function safeJsonParse(text, fallback) {
  try {
    return JSON.parse(text);
  } catch (e) {
    return fallback === undefined ? null : fallback;
  }
}

// ===========================================================================
// 04_logger.gs
// ===========================================================================

/**
 * @file 04_logger.gs
 * ログ処理。INFO / WARN / ERROR の3レベルを扱い、
 * 実行単位でバッファに蓄積して 99_システムログ へ保存する。
 */

/** @const {!Object<string, number>} ログレベルの優先度 */
var LOG_LEVELS = { INFO: 10, WARN: 20, ERROR: 30 };

/**
 * 実行単位のログを蓄積するロガー。
 *
 * @param {string} runName 実行名（ログファイル名に使う。例: 'sync'）
 * @constructor
 */
function Logger_(runName) {
  /** @private {string} */
  this.runName_ = runName || 'run';
  /** @private {!Array<string>} */
  this.lines_ = [];
  /** @private {!Array<!Object>} */
  this.errors_ = [];
  /** @private {!Array<!Object>} */
  this.warnings_ = [];
  /** @private {!Date} */
  this.startedAt_ = new Date();
  /** @private {number} */
  this.minLevel_ = LOG_LEVELS[CONFIG.LOG.MIN_LEVEL] || LOG_LEVELS.INFO;
}

/**
 * ログを1行記録する。
 *
 * @param {string} level 'INFO' | 'WARN' | 'ERROR'
 * @param {string} message 本文
 * @param {!Object=} context 付随情報（法令名など）
 */
Logger_.prototype.log = function (level, message, context) {
  var priority = LOG_LEVELS[level] || LOG_LEVELS.INFO;
  if (priority < this.minLevel_) {
    return;
  }

  var contextText = '';
  if (context && Object.keys(context).length > 0) {
    contextText = ' ' + JSON.stringify(context);
  }

  var line = '[' + formatJst(new Date()) + '] [' + level + '] ' + message + contextText;
  this.lines_.push(line);

  if (level === 'ERROR') {
    this.errors_.push({ at: nowIso(), message: message, context: context || {} });
  } else if (level === 'WARN') {
    this.warnings_.push({ at: nowIso(), message: message, context: context || {} });
  }

  // GAS実行トランスクリプトにも出す（デバッグ時に便利）
  if (typeof console !== 'undefined' && console.log) {
    console.log(line);
  }
};

/**
 * INFOレベルのログ。
 * @param {string} message 本文
 * @param {!Object=} context 付随情報
 */
Logger_.prototype.info = function (message, context) {
  this.log('INFO', message, context);
};

/**
 * WARNレベルのログ。処理は継続するが人間の確認が必要な事象に使う。
 * @param {string} message 本文
 * @param {!Object=} context 付随情報
 */
Logger_.prototype.warn = function (message, context) {
  this.log('WARN', message, context);
};

/**
 * ERRORレベルのログ。1件の失敗であり、全体処理は継続する。
 * @param {string} message 本文
 * @param {!Object=} context 付随情報
 */
Logger_.prototype.error = function (message, context) {
  this.log('ERROR', message, context);
};

/**
 * 蓄積したログの全文を返す。
 * @return {string} ログ本文
 */
Logger_.prototype.getText = function () {
  var text = this.lines_.join('\n');
  if (text.length > CONFIG.LOG.MAX_CHARS) {
    text = text.substring(0, CONFIG.LOG.MAX_CHARS) +
      '\n... (ログが上限に達したため以降は省略されました)';
  }
  return text;
};

/**
 * 記録されたWARNの一覧を返す。
 * @return {!Array<!Object>} WARN一覧
 */
Logger_.prototype.getWarnings = function () {
  return this.warnings_.slice();
};

/**
 * 記録されたERRORの一覧を返す。
 * @return {!Array<!Object>} ERROR一覧
 */
Logger_.prototype.getErrors = function () {
  return this.errors_.slice();
};

/**
 * ログファイル名を返す。
 * @return {string} 例: 'sync_20260903_120000.log'
 */
Logger_.prototype.getFileName = function () {
  return this.runName_ + '_' + timestampForFileName(this.startedAt_) + '.log';
};

/**
 * ログをDriveへ保存する。
 * ログ保存自体の失敗で本処理を落とさないよう、例外は握りつぶして戻り値で示す。
 *
 * @param {!DriveService} driveService Drive操作サービス
 * @return {boolean} 保存に成功したら true
 */
Logger_.prototype.saveToDrive = function (driveService) {
  if (!CONFIG.LOG.SAVE_TO_DRIVE) {
    return false;
  }
  try {
    var folder = driveService.getSystemLogFolder();
    driveService.upsertTextFileByName(folder, this.getFileName(), this.getText());

    // エラーが発生していた場合は、エラーログフォルダにも要約を残す
    if (this.errors_.length > 0) {
      var errorFolder = driveService.getErrorLogFolder();
      var summary = toPrettyJson({
        run: this.runName_,
        started_at: this.startedAt_.toISOString(),
        finished_at: nowIso(),
        error_count: this.errors_.length,
        warning_count: this.warnings_.length,
        errors: this.errors_,
        warnings: this.warnings_
      });
      driveService.upsertTextFileByName(
        errorFolder, 'errors_' + timestampForFileName(this.startedAt_) + '.json', summary);
    }
    return true;
  } catch (e) {
    if (typeof console !== 'undefined' && console.log) {
      console.log('ログのDrive保存に失敗しました: ' + describeError(e));
    }
    return false;
  }
};

/**
 * ロガーを生成する。
 * @param {string} runName 実行名
 * @return {!Logger_} ロガー
 */
function createLogger(runName) {
  return new Logger_(runName);
}

// ===========================================================================
// 05_properties_service.gs
// ===========================================================================

/**
 * @file 05_properties_service.gs
 * Script Properties の読み書き。
 * Google Drive のフォルダIDなど、コードに直接書いてはいけない値を安全に管理する。
 *
 * e-Gov 法令APIは認証不要のため、APIキーは扱わない。
 * 不要な認証情報を保持しないこと自体がセキュリティ上の方針である。
 */

/**
 * Script Properties を取得する。
 * @return {!Properties} Script Properties
 */
function getScriptProps() {
  return PropertiesService.getScriptProperties();
}

/**
 * プロパティを取得する。
 * @param {string} key キー
 * @param {?string=} defaultValue 未設定時の戻り値
 * @return {?string} 値
 */
function getProp(key, defaultValue) {
  var value = getScriptProps().getProperty(key);
  return (value === null || value === undefined || value === '')
    ? (defaultValue === undefined ? null : defaultValue)
    : value;
}

/**
 * プロパティを設定する。
 * @param {string} key キー
 * @param {string} value 値
 */
function setProp(key, value) {
  getScriptProps().setProperty(key, String(value));
}

/**
 * プロパティを削除する。
 * @param {string} key キー
 */
function deleteProp(key) {
  getScriptProps().deleteProperty(key);
}

/**
 * 保存されているルートフォルダIDを返す。
 * @return {?string} フォルダID。未設定なら null
 */
function getRootFolderId() {
  return getProp(CONFIG.PROPERTY_KEYS.ROOT_FOLDER_ID);
}

/**
 * ルートフォルダIDを保存する。
 * @param {string} folderId フォルダID
 */
function setRootFolderId(folderId) {
  setProp(CONFIG.PROPERTY_KEYS.ROOT_FOLDER_ID, folderId);
}

/**
 * 前回の同期完了日時（ISO 8601）を返す。
 * @return {?string} 日時。未同期なら null
 */
function getLastSyncAt() {
  return getProp(CONFIG.PROPERTY_KEYS.LAST_SYNC_AT);
}

/**
 * 同期完了日時を記録する。
 * @param {string=} isoString ISO 8601形式の日時（省略時は現在）
 */
function setLastSyncAt(isoString) {
  setProp(CONFIG.PROPERTY_KEYS.LAST_SYNC_AT, isoString || nowIso());
}

/**
 * 現在のプロパティ設定を一覧表示する（運用時の確認用）。
 * 認証情報は保持しないため、そのまま表示して問題ない。
 *
 * @return {!Object<string, string>} プロパティの一覧
 */
function showProperties() {
  var props = getScriptProps().getProperties();
  console.log('--- Script Properties ---');
  Object.keys(props).forEach(function (key) {
    console.log(key + ' = ' + props[key]);
  });
  if (Object.keys(props).length === 0) {
    console.log('(未設定です。setup() をまだ実行していない可能性があります)');
  }
  return props;
}

// ===========================================================================
// 06_http_client.gs
// ===========================================================================

/**
 * @file 06_http_client.gs
 * HTTPアクセス制御。
 *
 * 公的APIへ過度な負荷をかけないため、以下を必ず守る。
 *   - リクエスト間の最小待機（MIN_INTERVAL_MS）
 *   - 429 / 5xx に対する指数バックオフ付きリトライ
 *   - 最大リトライ回数の上限
 *   - Retry-After ヘッダの尊重
 */

/** @private {number} 直近のリクエスト時刻（ミリ秒） */
var lastRequestTimeMs_ = 0;

/**
 * @private {?function(string, !Object=): !HttpResult}
 * テスト用の差し替えフック。null のときは実際の通信を行う。
 * 本番実行では常に null であり、通信経路に影響しない。
 */
var httpOverrideForTest_ = null;

/**
 * HTTP通信をテスト用の関数へ差し替える。
 * 実際のe-Gov APIへアクセスせずにエラー処理を検証するために使う。
 *
 * @param {?function(string, !Object=): !HttpResult} fn 差し替える関数（null で解除）
 */
function setHttpOverrideForTest(fn) {
  httpOverrideForTest_ = fn;
}

/**
 * HTTPアクセスの結果。
 * @typedef {{
 *   ok: boolean,
 *   status: number,
 *   body: string,
 *   url: string,
 *   attempts: number,
 *   error: ?string
 * }} HttpResult
 */

/**
 * GETリクエストを送信する（リトライ・バックオフ込み）。
 *
 * 例外を投げず、必ず HttpResult を返す。
 * 1件の失敗で全体処理を止めないための設計である。
 *
 * @param {string} url リクエストURL
 * @param {!Logger_} logger ロガー
 * @param {!Object=} options 追加オプション
 *     {number=} maxRetries リトライ回数の上書き
 *     {boolean=} muteHttpExceptions 既定 true
 * @return {!HttpResult} 結果
 */
function httpGet(url, logger, options) {
  if (httpOverrideForTest_) {
    return httpOverrideForTest_(url, options);
  }

  var opts = options || {};
  var maxRetries = opts.maxRetries === undefined ? CONFIG.HTTP.MAX_RETRIES : opts.maxRetries;
  var attempt = 0;
  var lastError = null;
  var lastStatus = 0;
  var lastBody = '';

  while (attempt <= maxRetries) {
    attempt++;
    throttle_();

    try {
      var response = UrlFetchApp.fetch(url, {
        method: 'get',
        muteHttpExceptions: true,
        followRedirects: true,
        validateHttpsCertificates: true,
        headers: {
          'Accept': 'application/json, application/xml, text/xml, */*',
          'User-Agent': CONFIG.HTTP.USER_AGENT
        }
      });

      lastStatus = response.getResponseCode();
      lastBody = response.getContentText();

      if (lastStatus >= 200 && lastStatus < 300) {
        return {
          ok: true, status: lastStatus, body: lastBody,
          url: url, attempts: attempt, error: null
        };
      }

      if (CONFIG.HTTP.RETRYABLE_STATUS.indexOf(lastStatus) === -1) {
        // リトライしても回復しないステータス（404など）
        return {
          ok: false, status: lastStatus, body: lastBody, url: url,
          attempts: attempt,
          error: 'HTTP ' + lastStatus + '（リトライ対象外）'
        };
      }

      lastError = 'HTTP ' + lastStatus;
      var retryAfterMs = readRetryAfterMs_(response);
      if (attempt <= maxRetries) {
        var waitMs = retryAfterMs !== null ? retryAfterMs : backoffDelayMs_(attempt);
        logger.warn('リトライします: ' + lastError, {
          url: url, attempt: attempt, wait_ms: waitMs
        });
        sleepMs(waitMs);
      }

    } catch (e) {
      // ネットワークエラー・タイムアウトなど
      lastError = describeError(e);
      if (attempt <= maxRetries) {
        var backoff = backoffDelayMs_(attempt);
        logger.warn('通信エラーのためリトライします: ' + lastError, {
          url: url, attempt: attempt, wait_ms: backoff
        });
        sleepMs(backoff);
      }
    }
  }

  return {
    ok: false, status: lastStatus, body: lastBody, url: url,
    attempts: attempt,
    error: lastError || '不明な通信エラー'
  };
}

/**
 * 直前のリクエストから最小間隔が空くまで待機する。
 * @private
 */
function throttle_() {
  var now = Date.now();
  var elapsed = now - lastRequestTimeMs_;
  if (lastRequestTimeMs_ > 0 && elapsed < CONFIG.HTTP.MIN_INTERVAL_MS) {
    sleepMs(CONFIG.HTTP.MIN_INTERVAL_MS - elapsed);
  }
  lastRequestTimeMs_ = Date.now();
}

/**
 * 指数バックオフの待機時間を計算する。
 * ランダムなゆらぎ（ジッタ）を加え、リトライの集中を避ける。
 *
 * @param {number} attempt 試行回数（1始まり）
 * @return {number} 待機時間（ミリ秒）
 * @private
 */
function backoffDelayMs_(attempt) {
  var exponential = CONFIG.HTTP.BACKOFF_BASE_MS * Math.pow(2, attempt - 1);
  var capped = Math.min(exponential, CONFIG.HTTP.BACKOFF_MAX_MS);
  var jitter = Math.floor(Math.random() * (capped * 0.2));
  return capped + jitter;
}

/**
 * Retry-After ヘッダを読み取り、待機時間（ミリ秒）を返す。
 * @param {!HTTPResponse} response レスポンス
 * @return {?number} 待機時間。ヘッダがなければ null
 * @private
 */
function readRetryAfterMs_(response) {
  try {
    var headers = response.getAllHeaders() || {};
    var value = headers['Retry-After'] || headers['retry-after'];
    if (!value) {
      return null;
    }
    var seconds = parseInt(String(value), 10);
    if (!isNaN(seconds) && seconds >= 0) {
      return Math.min(seconds * 1000, CONFIG.HTTP.BACKOFF_MAX_MS);
    }
    var date = new Date(String(value));
    if (!isNaN(date.getTime())) {
      return Math.max(0, Math.min(date.getTime() - Date.now(), CONFIG.HTTP.BACKOFF_MAX_MS));
    }
    return null;
  } catch (e) {
    return null;
  }
}

/**
 * スロットリング状態をリセットする（テスト用）。
 */
function resetThrottleForTest() {
  lastRequestTimeMs_ = 0;
}

// ===========================================================================
// 07_egov_api.gs
// ===========================================================================

/**
 * @file 07_egov_api.gs
 * e-Gov 法令API Version 2 のクライアント。
 *
 * このファイルはAPIの「呼び出し方」だけを担い、
 * 保存やMarkdown変換などの業務処理は一切持たない。
 * パス・パラメータ名は必ず 02_api_spec.gs を参照する。
 */

/**
 * API呼び出しの結果。
 * @typedef {{
 *   ok: boolean, status: number, body: string, data: *,
 *   url: string, error: ?string
 * }} ApiResult
 */

/**
 * APIへGETし、必要に応じてJSONをパースする。
 *
 * @param {string} url リクエストURL
 * @param {!Logger_} logger ロガー
 * @param {boolean} parseJson JSONとしてパースするか
 * @return {!ApiResult} 結果
 * @private
 */
function apiGet_(url, logger, parseJson) {
  var result = httpGet(url, logger);

  if (!result.ok) {
    return {
      ok: false, status: result.status, body: result.body, data: null,
      url: url, error: result.error
    };
  }

  if (!parseJson) {
    return {
      ok: true, status: result.status, body: result.body, data: null,
      url: url, error: null
    };
  }

  var data = safeJsonParse(result.body, undefined);
  if (data === undefined) {
    return {
      ok: false, status: result.status, body: result.body, data: null, url: url,
      error: 'レスポンスをJSONとして解析できませんでした（API仕様変更の可能性）'
    };
  }

  return {
    ok: true, status: result.status, body: result.body, data: data,
    url: url, error: null
  };
}

/**
 * 法令名で法令を検索する。
 *
 * 重要な注意点
 * ------------
 * e-Gov の law_title は **部分一致** で検索される。
 * 例えば「所得税法」で検索すると、次のようなものも大量にヒットする。
 *
 *   - 所得税法（本命）
 *   - 所得税法等の一部を改正する法律（年度ごとに多数存在する）
 *   - ...所得税法等の臨時特例に関する法律
 *
 * そのため1ページ目だけを見ていると、本命の法令が埋もれて
 * 「見つからない」と誤判定する恐れがある。
 * 本関数は **完全一致する法令が見つかるまでページを送る**。
 *
 * @param {string} lawName 法令名
 * @param {!Logger_} logger ロガー
 * @return {{ok: boolean, candidates: !Array<!Object>, error: ?string, url: string,
 *           pages: number, exactFound: boolean}}
 */
function searchLawsByName(lawName, logger) {
  var collected = [];
  var seenIds = {};
  var pages = 0;
  var lastUrl = '';
  var target = normalizeLawName(lawName);
  var exactFound = false;

  for (var page = 0; page < CONFIG.HTTP.MAX_SEARCH_PAGES; page++) {
    var queryParams = {};
    queryParams[EGOV_API_SPEC.PARAMS.LAW_TITLE] = lawName;
    queryParams[EGOV_API_SPEC.PARAMS.LIMIT] = CONFIG.HTTP.SEARCH_PAGE_SIZE;
    if (page > 0) {
      queryParams[EGOV_API_SPEC.PARAMS.OFFSET] = page * CONFIG.HTTP.SEARCH_PAGE_SIZE;
    }

    var url = buildEgovUrl('LAWS', {}, queryParams);
    lastUrl = url;
    var result = apiGet_(url, logger, true);

    if (!result.ok) {
      if (page === 0) {
        logger.warn('法令一覧APIの呼び出しに失敗しました。キーワード検索へ切り替えます', {
          law_name: lawName, error: result.error, status: result.status
        });
        return searchLawsByKeyword_(lawName, logger);
      }
      break;  // 2ページ目以降の失敗は、取得済みの分で判断する
    }

    var list = pickLawList(result.data);
    if (list.length === 0) {
      break;
    }

    // 同じ結果が返ってきた場合、offset が効いていないためページ送りを止める
    var newCount = 0;
    list.forEach(function (item) {
      var info = readLawInfo(item);
      var key = info.law_id || info.law_num || JSON.stringify(item);
      if (seenIds[key]) {
        return;
      }
      seenIds[key] = true;
      newCount++;
      collected.push(item);
      if (normalizeLawName(info.law_title) === target) {
        exactFound = true;
      }
    });

    pages++;

    if (newCount === 0) {
      // offset が無視されている（同じページが返ってきた）
      break;
    }
    if (exactFound) {
      break;  // 本命が見つかったので、これ以上ページを送らない
    }
    if (list.length < CONFIG.HTTP.SEARCH_PAGE_SIZE) {
      break;  // 最終ページ
    }
  }

  if (collected.length === 0) {
    logger.info('法令一覧APIで0件のため、キーワード検索を試みます', { law_name: lawName });
    return searchLawsByKeyword_(lawName, logger);
  }

  if (!exactFound) {
    logger.warn(
      '完全一致する法令名が見つかりませんでした（部分一致の候補のみ）', {
        law_name: lawName, candidates: collected.length, pages: pages
      });
  }

  return {
    ok: true, candidates: collected, error: null, url: lastUrl,
    pages: pages, exactFound: exactFound
  };
}

/**
 * キーワード検索で法令を探す（法令一覧APIが使えない場合のフォールバック）。
 *
 * @param {string} lawName 法令名
 * @param {!Logger_} logger ロガー
 * @return {{ok: boolean, candidates: !Array<!Object>, error: ?string, url: string,
 *           pages: number, exactFound: boolean}}
 * @private
 */
function searchLawsByKeyword_(lawName, logger) {
  var kwParams = {};
  kwParams[EGOV_API_SPEC.PARAMS.KEYWORD] = lawName;
  kwParams[EGOV_API_SPEC.PARAMS.LIMIT] = CONFIG.HTTP.SEARCH_PAGE_SIZE;

  var kwUrl = buildEgovUrl('KEYWORD', {}, kwParams);
  var kwResult = apiGet_(kwUrl, logger, true);

  if (!kwResult.ok) {
    return {
      ok: false, candidates: [], url: kwUrl, pages: 0, exactFound: false,
      error: kwResult.error || 'キーワード検索に失敗しました'
    };
  }

  var candidates = pickLawList(kwResult.data);
  var target = normalizeLawName(lawName);
  var exactFound = candidates.some(function (item) {
    return normalizeLawName(readLawInfo(item).law_title) === target;
  });

  return {
    ok: true, candidates: candidates, error: null, url: kwUrl,
    pages: 1, exactFound: exactFound
  };
}

/**
 * 法令本文を取得する。
 *
 * 原本の優先順位
 * --------------
 *   1. XML形式（長期保存の原本として最も望ましい）
 *   2. JSON形式（XMLが得られない場合。**レスポンスをそのまま原本として保存する**）
 *
 * JSONで取得した場合も、本文は e-Gov が返した構造をそのまま保持する。
 * JSONから疑似的なXMLを組み立てるようなことはしない（原本性が失われるため）。
 *
 * @param {string} lawIdOrNum 法令IDまたは法令番号（法令履歴IDも可）
 * @param {!Logger_} logger ロガー
 * @return {{ok: boolean, raw: ?string, tree: ?Object, format: string,
 *           extension: string, source: string, url: string,
 *           error: ?string, meta: ?Object}}
 *     raw       : 保存すべき原本の文字列（無加工）
 *     tree      : 解析済みの法令木構造
 *     format    : 'xml' | 'json'
 *     extension : 保存時の拡張子
 */
function fetchLawContent(lawIdOrNum, logger) {
  var pathParams = { lawIdOrNumOrRevisionId: lawIdOrNum };
  var attempts = [];

  // --- 1. XML形式での取得を試みる（原本として最優先） ---
  var xmlParams = {};
  xmlParams[EGOV_API_SPEC.PARAMS.LAW_FULL_TEXT_FORMAT] = EGOV_API_SPEC.FORMATS.XML;
  var xmlUrl = buildEgovUrl('LAW_DATA', pathParams, xmlParams);
  var xmlResult = apiGet_(xmlUrl, logger, false);

  if (xmlResult.ok && looksLikeLawXml_(xmlResult.body)) {
    try {
      return {
        ok: true, raw: xmlResult.body, tree: parseLawXml(xmlResult.body),
        format: 'xml', extension: 'xml', source: 'law_data(xml)',
        url: xmlUrl, error: null, meta: null
      };
    } catch (e) {
      attempts.push('law_data(xml): 解析失敗 ' + describeError(e));
    }
  } else {
    attempts.push('law_data(xml): ' + (xmlResult.error || 'HTTP ' + xmlResult.status));
  }

  // --- 2. JSON形式で取得する ---
  var jsonParams = {};
  jsonParams[EGOV_API_SPEC.PARAMS.LAW_FULL_TEXT_FORMAT] = EGOV_API_SPEC.FORMATS.JSON;
  var jsonUrl = buildEgovUrl('LAW_DATA', pathParams, jsonParams);
  var jsonResult = apiGet_(jsonUrl, logger, true);

  if (jsonResult.ok) {
    var fullText = pickField(
      jsonResult.data, EGOV_API_SPEC.FIELD_CANDIDATES.LAW_FULL_TEXT, null);

    // 本文がXML文字列で返る場合
    if (typeof fullText === 'string' && looksLikeLawXml_(fullText)) {
      try {
        return {
          ok: true, raw: fullText, tree: parseLawXml(fullText),
          format: 'xml', extension: 'xml', source: 'law_data(json.law_full_text=xml)',
          url: jsonUrl, error: null, meta: jsonResult.data
        };
      } catch (e) {
        attempts.push('law_data(json内XML): 解析失敗 ' + describeError(e));
      }
    }

    // 本文が構造化JSONで返る場合（法令API v2 の既定の形式）
    if (fullText && typeof fullText === 'object') {
      try {
        var tree = parseLawContent(fullText, 'json');
        logger.info('本文をJSON形式で取得しました（原本はJSONのまま保存します）', {
          law: lawIdOrNum
        });
        return {
          ok: true,
          // レスポンス全体を原本として保存する（書誌情報も含まれるため）
          raw: JSON.stringify(jsonResult.data, null, 2),
          tree: tree, format: 'json', extension: 'json',
          source: 'law_data(json)', url: jsonUrl, error: null, meta: jsonResult.data
        };
      } catch (e) {
        attempts.push('law_data(json): 構造変換に失敗 ' + describeError(e));
      }
    } else if (!fullText) {
      attempts.push('law_data(json): 本文フィールドが見つかりません');
    }
  } else {
    attempts.push('law_data(json): ' + (jsonResult.error || 'HTTP ' + jsonResult.status));
  }

  // --- 3. law_file エンドポイントを試す ---
  var fileUrl = buildEgovUrl(
    'LAW_FILE', { fileType: 'xml', lawIdOrNumOrRevisionId: lawIdOrNum }, {});
  var fileResult = apiGet_(fileUrl, logger, false);

  if (fileResult.ok && looksLikeLawXml_(fileResult.body)) {
    try {
      return {
        ok: true, raw: fileResult.body, tree: parseLawXml(fileResult.body),
        format: 'xml', extension: 'xml', source: 'law_file(xml)',
        url: fileUrl, error: null, meta: null
      };
    } catch (e) {
      attempts.push('law_file(xml): 解析失敗 ' + describeError(e));
    }
  } else {
    attempts.push('law_file(xml): ' + (fileResult.error || 'HTTP ' + fileResult.status));
  }

  return {
    ok: false, raw: null, tree: null, format: '', extension: '',
    source: 'none', url: xmlUrl, meta: null,
    error: '法令本文を取得できませんでした（' + attempts.join(' / ') + '）'
  };
}

/**
 * 法令の改正履歴一覧を取得する。
 *
 * @param {string} lawIdOrNum 法令IDまたは法令番号
 * @param {!Logger_} logger ロガー
 * @return {{ok: boolean, revisions: !Array<!Object>, error: ?string, url: string}}
 */
function fetchLawRevisions(lawIdOrNum, logger) {
  var params = {};
  params[EGOV_API_SPEC.PARAMS.RESPONSE_FORMAT] = EGOV_API_SPEC.FORMATS.JSON;
  var url = buildEgovUrl('LAW_REVISIONS', { lawIdOrNum: lawIdOrNum }, params);
  var result = apiGet_(url, logger, true);

  if (!result.ok) {
    return { ok: false, revisions: [], error: result.error, url: url };
  }
  return { ok: true, revisions: pickLawList(result.data), error: null, url: url };
}

/**
 * 指定期間に更新された法令の一覧を取得する。
 *
 * 取得可能期間には制約があり得るため、呼び出し側は
 * 「0件＝更新なし」と即断せず、ok と件数の両方を確認すること。
 *
 * @param {string} fromIso 取得開始日時（ISO 8601）
 * @param {!Logger_} logger ロガー
 * @return {{ok: boolean, laws: !Array<!Object>, error: ?string, url: string}}
 */
function fetchUpdatedLaws(fromIso, logger) {
  var params = {};
  params[EGOV_API_SPEC.PARAMS.RESPONSE_FORMAT] = EGOV_API_SPEC.FORMATS.JSON;
  params[EGOV_API_SPEC.PARAMS.UPDATED_FROM] = toDateOnly_(fromIso);
  params[EGOV_API_SPEC.PARAMS.LIMIT] = 500;

  var url = buildEgovUrl('LAWS', {}, params);
  var result = apiGet_(url, logger, true);

  if (!result.ok) {
    return { ok: false, laws: [], error: result.error, url: url };
  }
  return { ok: true, laws: pickLawList(result.data), error: null, url: url };
}

/**
 * ISO 8601の日時から日付部分（YYYY-MM-DD）だけを取り出す。
 * @param {string} iso ISO 8601形式の日時
 * @return {string} 'YYYY-MM-DD'
 * @private
 */
function toDateOnly_(iso) {
  var date = toDate(iso);
  if (!date) {
    return '';
  }
  return date.toISOString().substring(0, 10);
}

/**
 * 文字列が法令XMLらしいか判定する。
 * HTMLのエラーページやJSONを誤って原本として保存しないための防波堤。
 *
 * @param {string} text 判定対象
 * @return {boolean} 法令XMLらしければ true
 * @private
 */
function looksLikeLawXml_(text) {
  if (!text || typeof text !== 'string') {
    return false;
  }
  var head = text.substring(0, 2000);
  if (head.indexOf('<Law') === -1) {
    return false;
  }
  // 本文の骨格が含まれていることを確認する
  return text.indexOf('<LawBody') !== -1 || text.indexOf('<LawNum') !== -1;
}

/**
 * 公式OpenAPI仕様を取得し、このプロジェクトの仕様マップと突き合わせる。
 *
 * ネットワークが遮断された環境では実装時に検証できないため、
 * 実運用の前に必ずGAS上でこの関数を実行し、差異がないことを確認すること。
 *
 * 差異が見つかった場合、修正すべきなのは 02_api_spec.gs の値だけである。
 *
 * @return {{ok: boolean, openapi_url: ?string, missing_endpoints: !Array<string>,
 *           found_paths: !Array<string>, notes: !Array<string>}}
 */
function verifyApiSpec() {
  var logger = createLogger('verify_api_spec');
  var notes = [];
  var document = null;
  var openapiUrl = null;

  logger.info('公式OpenAPI仕様の取得を開始します');

  for (var i = 0; i < EGOV_API_SPEC.OPENAPI_URL_CANDIDATES.length; i++) {
    var candidate = EGOV_API_SPEC.OPENAPI_URL_CANDIDATES[i];
    var result = httpGet(candidate, logger, { maxRetries: 1 });
    if (!result.ok) {
      notes.push('取得できず: ' + candidate + '（' + (result.error || result.status) + '）');
      continue;
    }
    var parsed = safeJsonParse(result.body, null);
    if (parsed && parsed.paths) {
      document = parsed;
      openapiUrl = candidate;
      notes.push('OpenAPI仕様を取得しました: ' + candidate);
      break;
    }
    notes.push('JSONとして解析できないかpathsが無い: ' + candidate);
  }

  if (!document) {
    notes.push(
      'OpenAPI仕様を自動取得できませんでした。' +
      'ブラウザで ' + EGOV_API_SPEC.BASE_URL + '/swagger-ui/ を開き、' +
      '各エンドポイントのパスとパラメータ名を 02_api_spec.gs と照合してください。');
    logger.error('OpenAPI仕様を取得できませんでした', { tried: notes.length });
    printSpecReport_({
      ok: false, openapi_url: null, missing_endpoints: [], found_paths: [], notes: notes
    });
    return {
      ok: false, openapi_url: null, missing_endpoints: [], found_paths: [], notes: notes
    };
  }

  var foundPaths = Object.keys(document.paths || {});
  var missing = [];

  EGOV_API_SPEC.REQUIRED_ENDPOINT_KEYS.forEach(function (key) {
    var endpoint = EGOV_API_SPEC.ENDPOINTS[key];
    // パスパラメータ名は仕様書と異なり得るため、形を無視して比較する
    var wanted = normalizePathShape_(endpoint.path);
    var matched = foundPaths.some(function (p) {
      return normalizePathShape_(p) === wanted;
    });
    if (!matched) {
      missing.push(key + ' (' + endpoint.path + ')');
      logger.warn('設定したパスが公式仕様に見つかりません', {
        endpoint: key, configured: endpoint.path
      });
    }
  });

  // 各エンドポイントの実際のパラメータ名を記録する
  foundPaths.forEach(function (p) {
    var operations = document.paths[p] || {};
    var getOp = operations.get;
    if (!getOp || !getOp.parameters) {
      return;
    }
    var names = getOp.parameters.map(function (param) {
      return param.name + (param.in ? '(' + param.in + ')' : '');
    });
    notes.push('GET ' + p + ' のパラメータ: ' + names.join(', '));
  });

  var ok = missing.length === 0;
  if (ok) {
    setProp(CONFIG.PROPERTY_KEYS.API_SPEC_VERIFIED_AT, nowIso());
    logger.info('API仕様の照合に成功しました', { openapi_url: openapiUrl });
  } else {
    logger.error('API仕様に差異があります。02_api_spec.gs を修正してください', {
      missing: missing.join(' / ')
    });
  }

  var report = {
    ok: ok, openapi_url: openapiUrl, missing_endpoints: missing,
    found_paths: foundPaths, notes: notes
  };
  printSpecReport_(report);
  return report;
}

/**
 * パスの形を比較用に正規化する（{xxx} を {} に統一する）。
 * @param {string} path APIパス
 * @return {string} 正規化後のパス
 * @private
 */
function normalizePathShape_(path) {
  return String(path).replace(/\{[^}]*\}/g, '{}').replace(/\/+$/, '');
}

/**
 * 仕様照合の結果を実行ログへ見やすく出力する。
 * @param {!Object} report verifyApiSpec() の戻り値
 * @private
 */
function printSpecReport_(report) {
  console.log('========== API仕様 照合レポート ==========');
  console.log('結果: ' + (report.ok ? 'OK（設定と公式仕様は一致）' : '要確認'));
  console.log('OpenAPI: ' + (report.openapi_url || '(取得できず)'));
  if (report.missing_endpoints.length > 0) {
    console.log('--- 公式仕様に見つからなかったパス ---');
    report.missing_endpoints.forEach(function (m) { console.log('  ' + m); });
  }
  if (report.found_paths.length > 0) {
    console.log('--- 公式仕様に存在するパス ---');
    report.found_paths.forEach(function (p) { console.log('  ' + p); });
  }
  console.log('--- 詳細 ---');
  report.notes.forEach(function (n) { console.log('  ' + n); });
  console.log('=========================================');
}

/**
 * 実際にAPIを呼び出して、設定が正しいかを確かめる。
 *
 * verifyApiSpec() は公式のOpenAPI仕様書と突き合わせるが、
 * 仕様書のURLが不明な場合は確認できない。
 * 本関数は仕様書に頼らず、**実際のAPIを数回だけ呼び出して**
 * 応答の中身から設定の正しさを判定する。
 *
 * 公的APIへの負荷を避けるため、呼び出しは3回までに抑えている。
 *
 * @param {string=} lawName 確認に使う法令名（既定: '所得税法'）
 * @return {{ok: boolean, steps: !Array<!Object>, lawId: string, contentFormat: string}}
 */
function probeApiSpec(lawName) {
  var logger = createLogger('probe_api');
  var target = lawName || '所得税法';
  var steps = [];
  var lawId = '';
  var contentFormat = '';

  console.log('========== API 実接続テスト ==========');
  console.log('確認に使う法令: ' + target);
  console.log('');

  // --- 1. 法令一覧APIで検索できるか ---
  var searchParams = {};
  searchParams[EGOV_API_SPEC.PARAMS.LAW_TITLE] = target;
  // 部分一致のため候補が多い。本命が埋もれないよう多めに取得する
  searchParams[EGOV_API_SPEC.PARAMS.LIMIT] = CONFIG.HTTP.SEARCH_PAGE_SIZE;
  var searchUrl = buildEgovUrl('LAWS', {}, searchParams);

  console.log('[1] 法令検索');
  console.log('    ' + searchUrl);
  var searchResult = apiGet_(searchUrl, logger, true);

  if (!searchResult.ok) {
    console.log('    結果: 失敗 — ' + (searchResult.error || 'HTTP ' + searchResult.status));
    console.log('');
    console.log('    → /laws のパスかパラメータ名が違う可能性があります。');
    steps.push({ step: 'search', ok: false, detail: searchResult.error });
    printProbeVerdict_(steps);
    return { ok: false, steps: steps, lawId: '', contentFormat: '' };
  }

  var candidates = pickLawList(searchResult.data);
  console.log('    結果: 成功（候補 ' + candidates.length + ' 件）');

  if (candidates.length === 0) {
    console.log('    → 通信はできましたが、法令一覧を取り出せませんでした。');
    console.log('      レスポンスの先頭: ' + searchResult.body.substring(0, 300));
    steps.push({ step: 'search', ok: false, detail: '一覧を取り出せない' });
    printProbeVerdict_(steps);
    return { ok: false, steps: steps, lawId: '', contentFormat: '' };
  }

  // law_title は部分一致で検索されるため、1件目が目的の法令とは限らない。
  // 実際の同期処理と同じく「法令名が完全一致するもの」を選ぶ。
  var normalizedTarget = normalizeLawName(target);
  var exact = null;
  candidates.forEach(function (item) {
    if (exact) {
      return;
    }
    var candidateInfo = readLawInfo(item);
    if (normalizeLawName(candidateInfo.law_title) === normalizedTarget) {
      exact = candidateInfo;
    }
  });

  if (!exact) {
    console.log('    ⚠ 「' + target + '」と完全一致する法令が見つかりませんでした。');
    console.log('      e-Govの検索は部分一致のため、名前に「' + target + '」を含む');
    console.log('      別の法令だけがヒットしています。候補の例:');
    candidates.slice(0, 3).forEach(function (item) {
      console.log('        - ' + readLawInfo(item).law_title);
    });
    steps.push({ step: 'search', ok: false, detail: '完全一致なし' });
    printProbeVerdict_(steps);
    return { ok: false, steps: steps, lawId: '', contentFormat: '' };
  }

  var info = exact;
  lawId = info.law_id;
  console.log('    （部分一致の候補から、名前が完全一致するものを選びました）');
  console.log('    法令名  : ' + (info.law_title || '(読み取れず)'));
  console.log('    法令番号: ' + (info.law_num || '(読み取れず)'));
  console.log('    法令ID  : ' + (info.law_id || '(読み取れず)'));
  console.log('    法令種別: ' + (info.law_type_raw || '(読み取れず)'));

  var fieldsOk = !!(info.law_id && info.law_title);
  if (!fieldsOk) {
    console.log('    → 項目名が想定と異なります。レスポンスの先頭を確認してください:');
    console.log('      ' + searchResult.body.substring(0, 400));
  }
  steps.push({ step: 'search', ok: fieldsOk, detail: info.law_title });
  console.log('');

  if (!lawId) {
    printProbeVerdict_(steps);
    return { ok: false, steps: steps, lawId: '', contentFormat: '' };
  }

  // --- 2. 本文をXML形式で取得できるか ---
  var xmlParams = {};
  xmlParams[EGOV_API_SPEC.PARAMS.LAW_FULL_TEXT_FORMAT] = EGOV_API_SPEC.FORMATS.XML;
  var xmlUrl = buildEgovUrl('LAW_DATA', { lawIdOrNumOrRevisionId: lawId }, xmlParams);

  console.log('[2] 本文取得（XML形式）');
  console.log('    ' + xmlUrl);
  var xmlResult = apiGet_(xmlUrl, logger, false);
  var xmlOk = xmlResult.ok && looksLikeLawXml_(xmlResult.body);
  console.log('    結果: ' + (xmlOk ? '成功（XMLで取得できます）'
    : '取得できず — ' + (xmlResult.error || 'HTTP ' + xmlResult.status)));
  if (xmlOk) {
    contentFormat = 'xml';
  }
  steps.push({ step: 'content_xml', ok: xmlOk, detail: xmlResult.status });
  console.log('');

  // --- 3. 本文をJSON形式で取得できるか（XMLが駄目だった場合のみ） ---
  if (!xmlOk) {
    var jsonParams = {};
    jsonParams[EGOV_API_SPEC.PARAMS.LAW_FULL_TEXT_FORMAT] = EGOV_API_SPEC.FORMATS.JSON;
    var jsonUrl = buildEgovUrl('LAW_DATA', { lawIdOrNumOrRevisionId: lawId }, jsonParams);

    console.log('[3] 本文取得（JSON形式）');
    console.log('    ' + jsonUrl);
    var jsonResult = apiGet_(jsonUrl, logger, true);

    var jsonOk = false;
    if (jsonResult.ok) {
      var fullText = pickField(
        jsonResult.data, EGOV_API_SPEC.FIELD_CANDIDATES.LAW_FULL_TEXT, null);
      if (fullText && typeof fullText === 'object') {
        try {
          var tree = parseLawContent(fullText, 'json');
          jsonOk = (tree.name === 'Law');
          contentFormat = 'json';
          console.log('    結果: 成功（JSONで取得できます。原本はJSONのまま保存します）');
        } catch (e) {
          console.log('    結果: 本文の構造を解釈できませんでした — ' + describeError(e));
        }
      } else if (typeof fullText === 'string') {
        jsonOk = looksLikeLawXml_(fullText);
        contentFormat = jsonOk ? 'xml' : '';
        console.log('    結果: ' + (jsonOk ? '成功（JSONの中にXMLが入っています）'
          : '本文が想定の形式ではありません'));
      } else {
        console.log('    結果: 本文の項目が見つかりません');
        console.log('      レスポンスの先頭: ' + jsonResult.body.substring(0, 400));
      }
    } else {
      console.log('    結果: 失敗 — ' + (jsonResult.error || 'HTTP ' + jsonResult.status));
    }
    steps.push({ step: 'content_json', ok: jsonOk, detail: contentFormat });
    console.log('');
  }

  printProbeVerdict_(steps);
  // XML取得の失敗は「JSONで取得できれば問題なし」であるため、
  // 全段階の成否ではなく「検索できたか」「本文を取得できたか」で判定する
  return {
    ok: isProbeSuccessful_(steps),
    steps: steps, lawId: lawId, contentFormat: contentFormat
  };
}

/**
 * 実接続テストが成功と言えるかを判定する。
 *
 * 本文はXMLとJSONのどちらか一方で取得できれば十分であり、
 * XML取得の失敗だけを理由に失敗とはしない。
 *
 * @param {!Array<!Object>} steps 各段階の結果
 * @return {boolean} 成功なら true
 * @private
 */
function isProbeSuccessful_(steps) {
  var searchOk = steps.some(function (s) { return s.step === 'search' && s.ok; });
  var contentOk = steps.some(function (s) {
    return (s.step === 'content_xml' || s.step === 'content_json') && s.ok;
  });
  return searchOk && contentOk;
}

/**
 * 実接続テストの判定を表示する。
 * @param {!Array<!Object>} steps 各段階の結果
 * @private
 */
function printProbeVerdict_(steps) {
  var searchOk = steps.some(function (s) { return s.step === 'search' && s.ok; });
  var contentOk = steps.some(function (s) {
    return (s.step === 'content_xml' || s.step === 'content_json') && s.ok;
  });

  console.log('========== 判定 ==========');
  if (isProbeSuccessful_(steps)) {
    console.log('✅ 問題ありません。setup() を実行してください。');
    console.log('   法令の検索・本文の取得ともに成功しました。');
    setProp(CONFIG.PROPERTY_KEYS.API_SPEC_VERIFIED_AT, nowIso());
  } else if (!searchOk) {
    console.log('❌ 法令を特定できませんでした。');
    console.log('   通信自体は成功している場合、法令名がe-Govの正式名称と');
    console.log('   異なっている可能性があります。');
    console.log('   通信から失敗している場合は、02_api_spec.gs の');
    console.log('   ENDPOINTS.LAWS と PARAMS.LAW_TITLE を確認してください。');
  } else {
    console.log('❌ 法令は検索できましたが、本文を取得できませんでした。');
    console.log('   02_api_spec.gs の ENDPOINTS.LAW_DATA と');
    console.log('   PARAMS.LAW_FULL_TEXT_FORMAT を確認してください。');
  }
  console.log('==========================');
}

// ===========================================================================
// 08_response_reader.gs
// ===========================================================================

/**
 * @file 08_response_reader.gs
 * APIレスポンスから値を「寛容に」取り出すための層。
 *
 * なぜ必要か
 * ----------
 * レスポンス項目名を1つに決め打ちすると、e-Gov側の命名が想定と異なった瞬間に
 * 全件が失敗する。本層では EGOV_API_SPEC.FIELD_CANDIDATES の候補を順に探索し、
 * さらに見つからない場合はキー名を正規化して再探索する。
 * その結果、命名差異は「処理停止」ではなく「WARN付きで継続」に縮退する。
 */

/**
 * オブジェクトから、候補リストのいずれかに一致する値を取り出す。
 *
 * 探索の順序
 *   1. 候補のパス（'a.b' 形式にも対応）を順に直接参照
 *   2. 見つからなければ、キー名を正規化（小文字化・記号除去）して深さ優先で探索
 *
 * @param {*} obj 対象オブジェクト
 * @param {!Array<string>} candidates 候補となる項目名（優先順）
 * @param {*=} fallback 見つからなかった場合の戻り値
 * @return {*} 見つかった値、または fallback
 */
function pickField(obj, candidates, fallback) {
  if (!obj || typeof obj !== 'object') {
    return fallback;
  }

  // 1. 候補を直接参照する
  for (var i = 0; i < candidates.length; i++) {
    var value = getByPath(obj, candidates[i]);
    if (value !== undefined && value !== null && value !== '') {
      return value;
    }
  }

  // 2. キー名を正規化して深さ優先で探索する
  var normalizedTargets = candidates.map(function (c) {
    var parts = String(c).split('.');
    return normalizeKey_(parts[parts.length - 1]);
  });
  var found = searchByNormalizedKey_(obj, normalizedTargets, 0);
  return found === undefined ? fallback : found;
}

/**
 * 法令一覧レスポンスから法令の配列を取り出す。
 * レスポンスが配列そのものである場合にも対応する。
 *
 * @param {*} parsed パース済みレスポンス
 * @return {!Array<!Object>} 法令の配列（見つからなければ空配列）
 */
function pickLawList(parsed) {
  if (Array.isArray(parsed)) {
    return parsed;
  }
  var list = pickField(parsed, EGOV_API_SPEC.FIELD_CANDIDATES.LAW_LIST, null);
  if (Array.isArray(list)) {
    return list;
  }
  // レスポンス直下に配列が1つだけある場合はそれを採用する
  if (parsed && typeof parsed === 'object') {
    var arrays = Object.keys(parsed).filter(function (key) {
      return Array.isArray(parsed[key]);
    });
    if (arrays.length === 1) {
      return parsed[arrays[0]];
    }
  }
  return [];
}

/**
 * 法令1件分のレスポンス（または一覧の1要素）から、正規化した書誌情報を作る。
 *
 * @param {*} item レスポンスの1要素
 * @return {{law_id: string, law_num: string, law_title: string, law_title_kana: string,
 *           law_type_raw: string, law_type: string, revision_id: string,
 *           revision_date: string, promulgation_date: string, effective_date: string,
 *           repeal_date: string, repeal_status: string}}
 */
function readLawInfo(item) {
  var F = EGOV_API_SPEC.FIELD_CANDIDATES;
  var lawTypeRaw = String(pickField(item, F.LAW_TYPE, '') || '');

  return {
    law_id: String(pickField(item, F.LAW_ID, '') || ''),
    law_num: String(pickField(item, F.LAW_NUM, '') || ''),
    law_title: String(pickField(item, F.LAW_TITLE, '') || ''),
    law_title_kana: String(pickField(item, F.LAW_TITLE_KANA, '') || ''),
    law_type_raw: lawTypeRaw,
    law_type: normalizeLawType(lawTypeRaw),
    revision_id: String(pickField(item, F.REVISION_ID, '') || ''),
    revision_date: String(pickField(item, F.REVISION_DATE, '') || ''),
    promulgation_date: String(pickField(item, F.PROMULGATION_DATE, '') || ''),
    effective_date: String(pickField(item, F.EFFECTIVE_DATE, '') || ''),
    repeal_date: String(pickField(item, F.REPEAL_DATE, '') || ''),
    repeal_status: String(pickField(item, F.REPEAL_STATUS, '') || '')
  };
}

/**
 * e-Gov の法令種別表記を内部キーへ正規化する。
 * 英語enum・日本語表記の双方に対応する。
 *
 * @param {string} raw e-Gov側の法令種別
 * @return {string} CONFIG.LAW_TYPE_DEFS のキー。判定できなければ 'other'
 */
function normalizeLawType(raw) {
  if (!raw) {
    return 'other';
  }
  var text = String(raw).trim();
  var lower = text.toLowerCase().replace(/[\s_-]/g, '');

  var MAP = {
    'act': 'act',
    'constitution': 'constitution',
    'cabinetorder': 'cabinet_order',
    'imperialorder': 'imperial_order',
    'ministerialordinance': 'ministerial_ordinance',
    'rule': 'rule',
    'misc': 'other'
  };
  if (MAP[lower]) {
    return MAP[lower];
  }

  // 日本語表記
  if (text.indexOf('憲法') !== -1) { return 'constitution'; }
  if (text.indexOf('法律') !== -1) { return 'act'; }
  if (text.indexOf('政令') !== -1) { return 'cabinet_order'; }
  if (text.indexOf('勅令') !== -1) { return 'imperial_order'; }
  if (text.indexOf('省令') !== -1 || text.indexOf('府令') !== -1) {
    return 'ministerial_ordinance';
  }
  if (text.indexOf('規則') !== -1) { return 'rule'; }

  return 'other';
}

/**
 * 法令番号の文字列から法令種別を推定する。
 * law_type が返らなかった場合の補助手段。
 *
 * @param {string} lawNum 法令番号（例: '昭和四十年法律第三十三号'）
 * @return {string} 推定した法令種別キー
 */
function inferLawTypeFromNum(lawNum) {
  if (!lawNum) {
    return 'other';
  }
  return normalizeLawType(lawNum);
}

/**
 * 廃止・失効の状態を判定する。
 *
 * 重要: 判定はe-Govが返すフィールドに基づいて行い、推測しない。
 * 判断材料が無い場合は 'unknown' とし、'active' と断定しない。
 *
 * @param {!Object} lawInfo readLawInfo() の戻り値
 * @return {string} CONFIG.STATUS のいずれか
 */
function determineLawStatus(lawInfo) {
  var statusText = String(lawInfo.repeal_status || '').toLowerCase();

  if (statusText) {
    if (statusText.indexOf('repeal') !== -1 || statusText.indexOf('廃止') !== -1) {
      return CONFIG.STATUS.REPEALED;
    }
    if (statusText.indexOf('expire') !== -1 || statusText.indexOf('失効') !== -1) {
      return CONFIG.STATUS.EXPIRED;
    }
    if (statusText.indexOf('none') !== -1 || statusText.indexOf('has_not') !== -1) {
      return CONFIG.STATUS.ACTIVE;
    }
  }

  // 廃止日が設定され、かつ現在日を過ぎていれば廃止扱い
  if (lawInfo.repeal_date) {
    var repealDate = toDate(lawInfo.repeal_date);
    if (repealDate && repealDate.getTime() <= Date.now()) {
      return CONFIG.STATUS.REPEALED;
    }
  }

  // 廃止に関する情報が一切ない場合は、有効とみなす
  if (!lawInfo.repeal_status && !lawInfo.repeal_date) {
    return CONFIG.STATUS.ACTIVE;
  }

  return CONFIG.STATUS.UNKNOWN;
}

/**
 * キー名を比較用に正規化する。
 * @param {string} key キー名
 * @return {string} 正規化後のキー名
 * @private
 */
function normalizeKey_(key) {
  return String(key).toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * 正規化したキー名で、オブジェクトを深さ優先探索する。
 *
 * @param {*} obj 対象
 * @param {!Array<string>} normalizedTargets 正規化済みの探索対象キー
 * @param {number} depth 現在の深さ
 * @return {*} 見つかった値。なければ undefined
 * @private
 */
function searchByNormalizedKey_(obj, normalizedTargets, depth) {
  var MAX_DEPTH = 6;
  if (!obj || typeof obj !== 'object' || depth > MAX_DEPTH) {
    return undefined;
  }

  var keys = Object.keys(obj);

  // まず同じ階層で一致を探す（優先順を維持するため候補順にループする）
  for (var t = 0; t < normalizedTargets.length; t++) {
    for (var k = 0; k < keys.length; k++) {
      if (normalizeKey_(keys[k]) === normalizedTargets[t]) {
        var value = obj[keys[k]];
        if (value !== undefined && value !== null && value !== '') {
          return value;
        }
      }
    }
  }

  // 見つからなければ子オブジェクトを探索する
  for (var i = 0; i < keys.length; i++) {
    var child = obj[keys[i]];
    if (child && typeof child === 'object' && !Array.isArray(child)) {
      var found = searchByNormalizedKey_(child, normalizedTargets, depth + 1);
      if (found !== undefined) {
        return found;
      }
    }
  }

  return undefined;
}

// ===========================================================================
// 09_xml_parser.gs
// ===========================================================================

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

// ===========================================================================
// 10_markdown_converter.gs
// ===========================================================================

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
  return convertLawToMarkdown(parseLawXml(xmlText), meta);
}

/**
 * 解析済みの法令木構造をMarkdownへ変換する。
 *
 * 取得形式がXMLでもJSONでも、木構造へ変換したあとは同じ処理を通る。
 *
 * @param {!LawNode} root 法令のルートノード
 * @param {!Object} meta メタデータ（YAML Front Matterに書き出す内容）
 * @return {{markdown: string, lawTitle: string, lawNum: string, warnings: !Array<string>}}
 */
function convertLawToMarkdown(root, meta) {
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

// ===========================================================================
// 11_structured_json.gs
// ===========================================================================

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

// ===========================================================================
// 12_hash_service.gs
// ===========================================================================

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

// ===========================================================================
// 13_drive_service.gs
// ===========================================================================

/**
 * @file 13_drive_service.gs
 * Google Drive の操作。フォルダ構成の作成と、ファイルの冪等な作成・更新を担う。
 *
 * 冪等性の考え方
 * --------------
 *   - フォルダは「同名が既にあれば作らない」。毎回新しいフォルダを作らない。
 *   - ファイルは「記録済みファイルIDを更新」。同名ファイルを増やさない。
 *   - ファイルIDを失った場合は、親フォルダ内の同名ファイルから安全に再検出する。
 */

/**
 * Drive操作サービス。
 *
 * @param {string} rootFolderId ルートフォルダのID
 * @param {!Logger_} logger ロガー
 * @constructor
 */
function DriveService(rootFolderId, logger) {
  /** @private {string} */
  this.rootFolderId_ = rootFolderId;
  /** @private {!Logger_} */
  this.logger_ = logger;
  /** @private {!Object<string, !Folder>} フォルダのキャッシュ（パス文字列 → Folder） */
  this.folderCache_ = {};
  /** @private {?Folder} */
  this.root_ = null;
}

/**
 * ルートフォルダを返す。
 * @return {!Folder} ルートフォルダ
 * @throws {Error} フォルダIDが無効・削除済み・アクセス不可の場合
 */
DriveService.prototype.getRoot = function () {
  if (this.root_) {
    return this.root_;
  }
  this.root_ = openFolderById(this.rootFolderId_);
  return this.root_;
};

/**
 * 親フォルダ配下に、指定名のフォルダを取得または作成する（冪等）。
 *
 * @param {!Folder} parent 親フォルダ
 * @param {string} name フォルダ名
 * @return {!Folder} 取得または作成したフォルダ
 */
DriveService.prototype.ensureFolder = function (parent, name) {
  var existing = parent.getFoldersByName(name);
  while (existing.hasNext()) {
    var folder = existing.next();
    if (!folder.isTrashed()) {
      return folder;
    }
  }
  this.logger_.info('フォルダを作成しました', { name: name });
  return parent.createFolder(name);
};

/**
 * ルートからの相対パスでフォルダを取得または作成する（冪等）。
 *
 * @param {!Array<string>} pathParts フォルダ名の配列（例: ['01_税制', '01_法律']）
 * @return {!Folder} 末端のフォルダ
 */
DriveService.prototype.ensureFolderPath = function (pathParts) {
  var cacheKey = pathParts.join('/');
  if (this.folderCache_[cacheKey]) {
    return this.folderCache_[cacheKey];
  }

  var current = this.getRoot();
  var accumulated = [];
  for (var i = 0; i < pathParts.length; i++) {
    accumulated.push(pathParts[i]);
    var key = accumulated.join('/');
    if (this.folderCache_[key]) {
      current = this.folderCache_[key];
      continue;
    }
    current = this.ensureFolder(current, pathParts[i]);
    this.folderCache_[key] = current;
  }

  this.folderCache_[cacheKey] = current;
  return current;
};

/**
 * 00_システム情報 フォルダを返す。
 * @return {!Folder} フォルダ
 */
DriveService.prototype.getSystemFolder = function () {
  return this.ensureFolderPath([CONFIG.FOLDERS.SYSTEM]);
};

/**
 * エラーログフォルダを返す。
 * @return {!Folder} フォルダ
 */
DriveService.prototype.getErrorLogFolder = function () {
  return this.ensureFolderPath([CONFIG.FOLDERS.SYSTEM, CONFIG.FOLDERS.SYSTEM_ERROR_LOG]);
};

/**
 * 99_システムログ フォルダを返す。
 * @return {!Folder} フォルダ
 */
DriveService.prototype.getSystemLogFolder = function () {
  return this.ensureFolderPath([CONFIG.FOLDERS.SYSTEM_LOG]);
};

/**
 * 法令のMarkdownを保存するフォルダを返す。
 * 例: 01_税制/01_法律
 *
 * @param {string} categoryKey カテゴリキー
 * @param {string} lawTypeKey 法令種別キー
 * @return {!Folder} フォルダ
 */
DriveService.prototype.getMarkdownFolder = function (categoryKey, lawTypeKey) {
  var category = CONFIG.CATEGORIES[categoryKey];
  if (!category) {
    throw new Error('未定義のカテゴリです: ' + categoryKey);
  }
  var typeDef = CONFIG.LAW_TYPE_DEFS[lawTypeKey] || CONFIG.LAW_TYPE_DEFS.other;
  var subfolder = CONFIG.FOLDERS.LAW_TYPE_SUBFOLDERS[typeDef.folderKey];
  return this.ensureFolderPath([category.folderName, subfolder]);
};

/**
 * 原本XMLを保存するフォルダを返す。
 * 例: 90_RAW_XML/税制
 *
 * @param {string} categoryKey カテゴリキー
 * @return {!Folder} フォルダ
 */
DriveService.prototype.getRawXmlFolder = function (categoryKey) {
  var category = CONFIG.CATEGORIES[categoryKey];
  if (!category) {
    throw new Error('未定義のカテゴリです: ' + categoryKey);
  }
  return this.ensureFolderPath([CONFIG.FOLDERS.RAW_XML, category.rawFolderName]);
};

/**
 * 履歴フォルダを返す。
 * 例: 01_税制/99_履歴
 *
 * @param {string} categoryKey カテゴリキー
 * @return {!Folder} フォルダ
 */
DriveService.prototype.getHistoryFolder = function (categoryKey) {
  var category = CONFIG.CATEGORIES[categoryKey];
  if (!category) {
    throw new Error('未定義のカテゴリです: ' + categoryKey);
  }
  return this.ensureFolderPath([category.folderName, CONFIG.FOLDERS.HISTORY]);
};

/**
 * 構造化JSONを保存するフォルダを返す。
 * 例: 01_税制/structured
 *
 * @param {string} categoryKey カテゴリキー
 * @return {!Folder} フォルダ
 */
DriveService.prototype.getStructuredFolder = function (categoryKey) {
  var category = CONFIG.CATEGORIES[categoryKey];
  if (!category) {
    throw new Error('未定義のカテゴリです: ' + categoryKey);
  }
  return this.ensureFolderPath([category.folderName, CONFIG.FOLDERS.STRUCTURED]);
};

/**
 * ファイルIDを優先し、無ければ名前で再検出してテキストファイルを更新する（冪等）。
 *
 * 同名ファイルを毎回新規作成しないための中心的な関数。
 *
 * @param {!Folder} folder 親フォルダ
 * @param {string} fileName ファイル名
 * @param {string} content 内容
 * @param {?string=} knownFileId 記録済みのファイルID
 * @param {string=} mimeType MIMEタイプ
 * @return {{fileId: string, created: boolean, recovered: boolean}}
 *     created   : 新規作成した場合 true
 *     recovered : ファイルIDを失って再検出した場合 true
 */
DriveService.prototype.upsertTextFile = function (
    folder, fileName, content, knownFileId, mimeType) {
  var recovered = false;

  // --- 1. 記録済みファイルIDでの更新を試みる ---
  if (knownFileId) {
    try {
      var file = DriveApp.getFileById(knownFileId);
      if (!file.isTrashed()) {
        if (file.getName() !== fileName) {
          file.setName(fileName);
        }
        file.setContent(content);
        return { fileId: file.getId(), created: false, recovered: false };
      }
      this.logger_.warn('記録済みファイルがゴミ箱にあります。再作成します', {
        file_name: fileName, file_id: knownFileId
      });
    } catch (e) {
      this.logger_.warn('記録済みファイルIDでアクセスできません。名前から再検出します', {
        file_name: fileName, file_id: knownFileId, error: describeError(e)
      });
    }
    recovered = true;
  }

  // --- 2. 親フォルダ内の同名ファイルから再検出する ---
  var found = this.findFileByName(folder, fileName);
  if (found) {
    found.setContent(content);
    return { fileId: found.getId(), created: false, recovered: recovered };
  }

  // --- 3. 新規作成する ---
  var created = folder.createFile(fileName, content, mimeType || MimeType.PLAIN_TEXT);
  return { fileId: created.getId(), created: true, recovered: recovered };
};

/**
 * ファイル名だけを指定してテキストファイルを作成・更新する（ログ等で使う）。
 *
 * @param {!Folder} folder 親フォルダ
 * @param {string} fileName ファイル名
 * @param {string} content 内容
 * @param {string=} mimeType MIMEタイプ
 * @return {string} ファイルID
 */
DriveService.prototype.upsertTextFileByName = function (folder, fileName, content, mimeType) {
  return this.upsertTextFile(folder, fileName, content, null, mimeType).fileId;
};

/**
 * 親フォルダ内から、指定名のファイルを1件検出する。
 * 同名ファイルが複数ある場合はWARNを出し、最初の1件を使う。
 *
 * @param {!Folder} folder 親フォルダ
 * @param {string} fileName ファイル名
 * @return {?File} 見つかったファイル。なければ null
 */
DriveService.prototype.findFileByName = function (folder, fileName) {
  var iterator = folder.getFilesByName(fileName);
  var matches = [];
  while (iterator.hasNext()) {
    var file = iterator.next();
    if (!file.isTrashed()) {
      matches.push(file);
    }
  }
  if (matches.length === 0) {
    return null;
  }
  if (matches.length > 1) {
    this.logger_.warn('同名ファイルが複数あります。最初の1件を更新します', {
      file_name: fileName, count: matches.length
    });
  }
  return matches[0];
};

/**
 * ファイルの内容を読み取る。
 * @param {string} fileId ファイルID
 * @return {?string} 内容。読めなければ null
 */
DriveService.prototype.readFileById = function (fileId) {
  try {
    var file = DriveApp.getFileById(fileId);
    if (file.isTrashed()) {
      return null;
    }
    return file.getBlob().getDataAsString();
  } catch (e) {
    return null;
  }
};

/**
 * フォルダ内の指定名ファイルの内容を読み取る。
 * @param {!Folder} folder 親フォルダ
 * @param {string} fileName ファイル名
 * @return {?string} 内容。無ければ null
 */
DriveService.prototype.readTextFile = function (folder, fileName) {
  var file = this.findFileByName(folder, fileName);
  return file ? file.getBlob().getDataAsString() : null;
};

/**
 * 既存ファイルの内容を履歴フォルダへ退避する。
 *
 * 改正前のデータを削除せず、後から参照できるようにするための処理。
 *
 * @param {!Folder} historyFolder 履歴フォルダ
 * @param {string} baseName 拡張子を除いたファイル名（例: '所得税法'）
 * @param {string} extension 拡張子（例: 'md'）
 * @param {string} content 退避する内容
 * @param {(Date|string)=} timestamp 退避時刻
 * @return {string} 作成した履歴ファイルのID
 */
DriveService.prototype.archiveToHistory = function (
    historyFolder, baseName, extension, content, timestamp) {
  var fileName = sanitizeFileName(baseName) + '_' +
    timestampForFileName(timestamp) + '.' + extension;
  var file = historyFolder.createFile(fileName, content, MimeType.PLAIN_TEXT);
  this.logger_.info('履歴へ退避しました', { file_name: fileName });
  return file.getId();
};

/**
 * フォルダIDからフォルダを開く。
 * 無効・削除済み・権限なしの場合は分かりやすい例外を投げる。
 *
 * @param {string} folderId フォルダID
 * @return {!Folder} フォルダ
 * @throws {Error} 開けない場合
 */
function openFolderById(folderId) {
  if (!folderId) {
    throw new Error('フォルダIDが設定されていません');
  }
  var folder;
  try {
    folder = DriveApp.getFolderById(folderId);
  } catch (e) {
    throw new Error(
      'フォルダID "' + folderId + '" にアクセスできません。' +
      '削除されたか、権限がない可能性があります。' +
      'resetRootFolder() を実行すると再設定できます。（詳細: ' + describeError(e) + '）');
  }
  if (folder.isTrashed()) {
    throw new Error(
      'フォルダID "' + folderId + '" はゴミ箱にあります。' +
      'Driveで復元するか、resetRootFolder() を実行して再作成してください。');
  }
  return folder;
}

/**
 * ルートフォルダを取得または作成し、フォルダIDをScript Propertiesへ保存する。
 *
 * 2回目以降は保存済みのIDを使い、新しい「日本法令データベース」フォルダを作らない。
 * IDが無効な場合のみ、安全に作り直す。
 *
 * @param {!Logger_} logger ロガー
 * @return {{folderId: string, created: boolean, reused: boolean}}
 */
function ensureRootFolder(logger) {
  var savedId = getRootFolderId();

  if (savedId) {
    try {
      var folder = openFolderById(savedId);
      logger.info('既存のルートフォルダを使用します', {
        folder_id: savedId, name: folder.getName()
      });
      return { folderId: savedId, created: false, reused: true };
    } catch (e) {
      logger.warn('保存されたフォルダIDが使用できないため作り直します', {
        folder_id: savedId, error: describeError(e)
      });
    }
  }

  // マイドライブ直下に同名フォルダが既にあれば、それを再利用する
  // （setup() の再実行でフォルダが増えないようにするため）
  var root = DriveApp.getRootFolder();
  var existing = root.getFoldersByName(CONFIG.ROOT_FOLDER_NAME);
  while (existing.hasNext()) {
    var candidate = existing.next();
    if (!candidate.isTrashed()) {
      setRootFolderId(candidate.getId());
      logger.info('マイドライブ上の既存フォルダを再利用します', {
        folder_id: candidate.getId(), name: candidate.getName()
      });
      return { folderId: candidate.getId(), created: false, reused: true };
    }
  }

  var newFolder = root.createFolder(CONFIG.ROOT_FOLDER_NAME);
  setRootFolderId(newFolder.getId());
  logger.info('ルートフォルダを新規作成しました', {
    folder_id: newFolder.getId(), name: CONFIG.ROOT_FOLDER_NAME
  });
  return { folderId: newFolder.getId(), created: true, reused: false };
}

/**
 * 規定のフォルダ構成をすべて作成する（冪等）。
 *
 * @param {!DriveService} driveService Driveサービス
 * @return {!Array<string>} 作成・確認したフォルダパスの一覧
 */
function ensureFolderStructure(driveService) {
  var createdPaths = [];

  // 00_システム情報（配下にエラーログ）
  driveService.ensureFolderPath([CONFIG.FOLDERS.SYSTEM]);
  createdPaths.push(CONFIG.FOLDERS.SYSTEM);
  driveService.ensureFolderPath([CONFIG.FOLDERS.SYSTEM, CONFIG.FOLDERS.SYSTEM_ERROR_LOG]);
  createdPaths.push(CONFIG.FOLDERS.SYSTEM + '/' + CONFIG.FOLDERS.SYSTEM_ERROR_LOG);

  // カテゴリごとのフォルダ
  Object.keys(CONFIG.CATEGORIES).forEach(function (key) {
    var category = CONFIG.CATEGORIES[key];
    driveService.ensureFolderPath([category.folderName]);
    createdPaths.push(category.folderName);

    // 04_関連法令 は種別サブフォルダを持たせず、直下に法令を置く構成もあり得るが、
    // 一貫性を優先して他カテゴリと同じ構造にする
    Object.keys(CONFIG.FOLDERS.LAW_TYPE_SUBFOLDERS).forEach(function (typeKey) {
      var sub = CONFIG.FOLDERS.LAW_TYPE_SUBFOLDERS[typeKey];
      driveService.ensureFolderPath([category.folderName, sub]);
      createdPaths.push(category.folderName + '/' + sub);
    });

    driveService.ensureFolderPath([category.folderName, CONFIG.FOLDERS.HISTORY]);
    createdPaths.push(category.folderName + '/' + CONFIG.FOLDERS.HISTORY);

    if (CONFIG.SYNC.GENERATE_STRUCTURED_JSON) {
      driveService.ensureFolderPath([category.folderName, CONFIG.FOLDERS.STRUCTURED]);
      createdPaths.push(category.folderName + '/' + CONFIG.FOLDERS.STRUCTURED);
    }
  });

  // 90_RAW_XML 配下（法令カテゴリのみ）
  driveService.ensureFolderPath([CONFIG.FOLDERS.RAW_XML]);
  createdPaths.push(CONFIG.FOLDERS.RAW_XML);
  Object.keys(CONFIG.CATEGORIES).forEach(function (key) {
    var category = CONFIG.CATEGORIES[key];
    driveService.ensureFolderPath([CONFIG.FOLDERS.RAW_XML, category.rawFolderName]);
    createdPaths.push(CONFIG.FOLDERS.RAW_XML + '/' + category.rawFolderName);
  });

  // 99_システムログ
  driveService.ensureFolderPath([CONFIG.FOLDERS.SYSTEM_LOG]);
  createdPaths.push(CONFIG.FOLDERS.SYSTEM_LOG);

  return createdPaths;
}

// ===========================================================================
// 14_catalog_service.gs
// ===========================================================================

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
    '| `' + CONFIG.FOLDERS.RAW_XML + '` | **原本**（加工していないe-Govデータ。.xml または .json） |',
    '| `' + CONFIG.FOLDERS.SYSTEM_LOG + '` | 実行ログ |',
    '',
    '各カテゴリの `' + CONFIG.FOLDERS.HISTORY + '` には、改正前のファイルが退避されます。',
    '`' + CONFIG.FOLDERS.STRUCTURED + '` には、条・項・号に分解した構造化JSONが入ります。',
    '',
    '## 原本データと加工データの区別',
    '',
    '- **原本**：`' + CONFIG.FOLDERS.RAW_XML + '` 配下のファイル。e-Govから取得したまま。',
    '- **加工**：各カテゴリのMarkdown・構造化JSON。原本から機械的に変換したもの。',
    '',
    '条文の正確性が問題になる場合は、必ず原本またはe-Gov公式サイトを確認してください。',
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

// ===========================================================================
// 15_law_service.gs
// ===========================================================================

/**
 * @file 15_law_service.gs
 * 法令の同定（どの法令データを取得すべきかの特定）。
 *
 * データの信頼性に関する最重要ルール
 * ----------------------------------
 * 法令名が似ているだけの別法令を保存してはならない。
 * 候補が複数あり自動で確定できない場合、**推測で選ばず** WARN を記録して
 * その法令をスキップする。誤ったデータを保存するより、取得しない方が安全である。
 *
 * 利用者は、設定ファイルに lawId を直接書くことで確実に確定できる。
 */

/**
 * 法令同定の結果。
 * @typedef {{
 *   resolved: boolean,
 *   lawInfo: ?Object,
 *   reason: string,
 *   candidates: !Array<!Object>,
 *   ambiguous: boolean
 * }} ResolveResult
 */

/**
 * 設定エントリから、取得対象の法令を1件に確定する。
 *
 * @param {!Object} lawConfig 設定エントリ
 * @param {!Logger_} logger ロガー
 * @return {!ResolveResult} 同定結果
 */
function resolveLaw(lawConfig, logger) {
  // --- 1. 設定で法令IDが指定されていれば、それを最優先で使う ---
  if (lawConfig.lawId) {
    logger.info('設定の法令IDを使用します', {
      law_name: lawConfig.name, law_id: lawConfig.lawId
    });
    return {
      resolved: true,
      lawInfo: {
        law_id: lawConfig.lawId,
        law_num: lawConfig.lawNum || '',
        law_title: lawConfig.name,
        law_title_kana: '',
        law_type_raw: '',
        law_type: lawConfig.expectedLawType || 'other',
        revision_id: '', revision_date: '', promulgation_date: '',
        effective_date: '', repeal_date: '', repeal_status: ''
      },
      reason: '設定ファイルで法令IDが指定されています',
      candidates: [],
      ambiguous: false
    };
  }

  // --- 2. e-Govで検索する ---
  var search = searchLawsByName(lawConfig.name, logger);
  if (!search.ok) {
    return {
      resolved: false, lawInfo: null, candidates: [], ambiguous: false,
      reason: '検索APIの呼び出しに失敗しました: ' + search.error
    };
  }

  var candidates = search.candidates.map(readLawInfo).filter(function (info) {
    return info.law_id || info.law_num;
  });

  if (candidates.length === 0) {
    return {
      resolved: false, lawInfo: null, candidates: [], ambiguous: false,
      reason: '法令が見つかりませんでした（検索結果0件）'
    };
  }

  // --- 3. 法令名の完全一致で絞り込む ---
  var targetName = normalizeLawName(lawConfig.name);
  var aliases = (lawConfig.aliases || []).map(normalizeLawName);

  var exactMatches = candidates.filter(function (info) {
    var name = normalizeLawName(info.law_title);
    return name === targetName || aliases.indexOf(name) !== -1;
  });

  if (exactMatches.length === 0) {
    // 部分一致しかない場合は自動決定しない。誤った法令の保存を防ぐため。
    var samples = candidates.slice(0, 5).map(function (info) {
      return info.law_title + '（' + info.law_num + '）';
    });
    return {
      resolved: false, lawInfo: null, candidates: candidates, ambiguous: true,
      reason: '法令名が完全一致する候補がありません。' +
              '設定の name をe-Gov上の正式名称に修正するか、lawId を指定してください。' +
              '（候補: ' + samples.join(' / ') + '）'
    };
  }

  // --- 4. 法令番号の指定があれば、さらに絞り込む ---
  var narrowed = exactMatches;
  if (lawConfig.lawNum) {
    var wantedNum = normalizeLawName(lawConfig.lawNum);
    var byNum = narrowed.filter(function (info) {
      return normalizeLawName(info.law_num) === wantedNum;
    });
    if (byNum.length > 0) {
      narrowed = byNum;
    }
  }

  // --- 5. 期待する法令種別で絞り込む ---
  if (lawConfig.expectedLawType && narrowed.length > 1) {
    var byType = narrowed.filter(function (info) {
      var actualType = info.law_type !== 'other'
        ? info.law_type
        : inferLawTypeFromNum(info.law_num);
      return actualType === lawConfig.expectedLawType;
    });
    if (byType.length > 0) {
      narrowed = byType;
    }
  }

  if (narrowed.length === 1) {
    var resolved = narrowed[0];
    verifyLawTypeMatch_(lawConfig, resolved, logger);
    return {
      resolved: true, lawInfo: resolved, candidates: candidates, ambiguous: false,
      reason: '法令名の完全一致により確定しました'
    };
  }

  // --- 6. 複数候補が残った場合は自動決定しない ---
  var candidateText = narrowed.slice(0, 5).map(function (info) {
    return info.law_title + '（法令番号: ' + info.law_num + ' / 法令ID: ' + info.law_id + '）';
  });
  return {
    resolved: false, lawInfo: null, candidates: narrowed, ambiguous: true,
    reason: '候補が' + narrowed.length + '件あり、自動で確定できません。' +
            '設定ファイルの lawId に正しい法令IDを指定してください。' +
            '（候補: ' + candidateText.join(' / ') + '）'
  };
}

/**
 * 確定した法令の種別が、設定の期待値と一致するか確認する。
 * 一致しない場合はWARNを出すが、処理は継続する（法令名は完全一致しているため）。
 *
 * @param {!Object} lawConfig 設定エントリ
 * @param {!Object} lawInfo 確定した法令情報
 * @param {!Logger_} logger ロガー
 * @private
 */
function verifyLawTypeMatch_(lawConfig, lawInfo, logger) {
  if (!lawConfig.expectedLawType) {
    return;
  }
  var actualType = lawInfo.law_type !== 'other'
    ? lawInfo.law_type
    : inferLawTypeFromNum(lawInfo.law_num);

  if (actualType !== lawConfig.expectedLawType) {
    logger.warn('法令種別が設定の期待値と一致しません（要確認）', {
      law_name: lawConfig.name,
      expected: lawConfig.expectedLawType,
      actual: actualType,
      law_num: lawInfo.law_num,
      law_id: lawInfo.law_id
    });
  }
}

/**
 * 法令の保存に使う種別キーを決める。
 * e-Govが種別を返さない場合は法令番号から推定する。
 *
 * @param {!Object} lawInfo 法令情報
 * @param {!Object} lawConfig 設定エントリ
 * @return {string} CONFIG.LAW_TYPE_DEFS のキー
 */
function decideLawTypeKey(lawInfo, lawConfig) {
  if (lawInfo.law_type && lawInfo.law_type !== 'other') {
    return lawInfo.law_type;
  }
  var inferred = inferLawTypeFromNum(lawInfo.law_num);
  if (inferred !== 'other') {
    return inferred;
  }
  return lawConfig.expectedLawType || 'other';
}

/**
 * Markdownに書き出すメタデータを組み立てる。
 *
 * 「いつ取得したか（retrieved_at）」と
 * 「いつ時点で有効な法令か（effective_date / revision_date）」は
 * 意味が異なるため、必ず別項目として保持する。
 *
 * @param {!Object} lawConfig 設定エントリ
 * @param {!Object} lawInfo 法令情報
 * @param {string} lawTypeKey 法令種別キー
 * @param {string} status ステータス
 * @param {string} apiSourceUrl 取得に使ったAPIのURL
 * @return {!Object} メタデータ
 */
function buildLawMetadata(lawConfig, lawInfo, lawTypeKey, status, apiSourceUrl) {
  var category = CONFIG.CATEGORIES[lawConfig.category];
  var typeDef = CONFIG.LAW_TYPE_DEFS[lawTypeKey] || CONFIG.LAW_TYPE_DEFS.other;

  return {
    law_name: lawInfo.law_title || lawConfig.name,
    law_id: lawInfo.law_id,
    law_number: lawInfo.law_num,
    law_type: typeDef.label,
    law_type_key: lawTypeKey,
    category: category.label,
    category_key: lawConfig.category,
    source: 'e-Gov法令検索',
    source_url: lawInfo.law_id ? buildHumanLawUrl(lawInfo.law_id) : '',
    api_source_url: apiSourceUrl,
    retrieved_at: nowIso(),
    retrieved_at_jst: formatJst(new Date()),
    promulgation_date: lawInfo.promulgation_date || '',
    effective_date: lawInfo.effective_date || '',
    revision_id: lawInfo.revision_id || '',
    revision_date: lawInfo.revision_date || '',
    repeal_date: lawInfo.repeal_date || '',
    status: status,
    content_note: '本文はe-Govの正式XMLから機械的に変換したものであり、要約・改変はしていません。'
  };
}

// ===========================================================================
// 16_sync_service.gs
// ===========================================================================

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

  // --- 2. 本文を取得する（XMLを優先し、得られなければJSON） ---
  var fetched = fetchLawContent(identifier, logger);
  if (!fetched.ok) {
    return { status: 'failed', reason: fetched.error, record: null, plan: null };
  }

  // --- 3. 内容を検証する（保存前に壊れたデータを弾く） ---
  var parsedRoot = fetched.tree;
  if (!parsedRoot || parsedRoot.name !== 'Law') {
    return {
      status: 'failed', record: null, plan: null,
      reason: '取得した本文のルート要素が Law ではありません（実際: ' +
              (parsedRoot ? parsedRoot.name : 'なし') + '）'
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
  var newHash = computeLawHash(fetched.raw);
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
  var converted = convertLawToMarkdown(parsedRoot, meta);

  converted.warnings.forEach(function (warning) {
    logger.warn('Markdown変換の警告: ' + warning, { law_name: lawInfo.law_title });
  });

  // --- 7. 旧データを履歴へ退避する ---
  var baseName = sanitizeFileName(lawInfo.law_title || lawConfig.name);
  if (previous && CONFIG.SYNC.KEEP_HISTORY) {
    archivePrevious_(previous, baseName, lawConfig, driveService, logger,
      previous.raw_file_name ? previous.raw_file_name.split('.').pop() : 'xml');
  }

  // --- 8. 原本を保存する（加工しない） ---
  // 取得形式がXMLなら .xml、JSONなら .json として保存する。
  // どちらの場合も、e-Govが返した内容をそのまま保存する。
  var rawFolder = driveService.getRawXmlFolder(lawConfig.category);
  var rawFileName = baseName + '.' + fetched.extension;
  var previousRawName = previous && previous.raw_file_name ? previous.raw_file_name : null;

  // 前回と形式が変わった場合、古い形式のファイルIDは使えないため作り直す
  var reusableRawId = (previousRawName === null || previousRawName === rawFileName)
    ? (previous ? previous.xml_file_id : null)
    : null;

  var xmlResult = driveService.upsertTextFile(
    rawFolder, rawFileName, fetched.raw, reusableRawId, MimeType.PLAIN_TEXT);

  // 台帳へ記録するため、実際に使ったファイル名を取得結果へ持たせる
  fetched.rawFileName = rawFileName;

  // --- 9. Markdownを保存する ---
  var mdFolder = driveService.getMarkdownFolder(lawConfig.category, lawTypeKey);
  var mdResult = driveService.upsertTextFile(
    mdFolder, baseName + '.md', converted.markdown,
    previous ? previous.markdown_file_id : null, MimeType.PLAIN_TEXT);

  // --- 10. 構造化JSONを保存する ---
  var structuredFileId = previous ? previous.structured_file_id : null;
  if (CONFIG.SYNC.GENERATE_STRUCTURED_JSON) {
    try {
      var structured = buildStructuredJsonFromTree(parsedRoot, meta);
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
function archivePrevious_(previous, baseName, lawConfig, driveService, logger, rawExt) {
  try {
    var historyFolder = driveService.getHistoryFolder(lawConfig.category);
    var archivedAt = new Date();

    var oldMarkdown = previous.markdown_file_id
      ? driveService.readFileById(previous.markdown_file_id) : null;
    if (oldMarkdown) {
      driveService.archiveToHistory(
        historyFolder, baseName, 'md', oldMarkdown, archivedAt);
    }

    var oldRaw = previous.xml_file_id
      ? driveService.readFileById(previous.xml_file_id) : null;
    if (oldRaw) {
      driveService.archiveToHistory(
        historyFolder, baseName, rawExt || 'xml', oldRaw, archivedAt);
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
    raw_format: fetched.format,
    raw_file_name: fetched.rawFileName || '',
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

// ===========================================================================
// 17_trigger_service.gs
// ===========================================================================

/**
 * @file 17_trigger_service.gs
 * 時間主導型トリガーの管理。
 * PCを起動していなくてもGoogle側で自動実行されるようにする。
 */

/**
 * 定期同期トリガーを作成する（重複登録しない）。
 *
 * 既に同じ関数のトリガーが存在する場合は新規作成せず、既存のものを使う。
 *
 * @return {{created: boolean, triggerCount: number, message: string}}
 */
function installTrigger() {
  var handler = CONFIG.TRIGGER.HANDLER_FUNCTION;
  var existing = findTriggersByHandler_(handler);

  if (existing.length > 0) {
    var message = 'トリガーは既に設定されています（' + existing.length + '件）。' +
      '重複登録はしていません。';
    console.log(message);
    return { created: false, triggerCount: existing.length, message: message };
  }

  try {
    ScriptApp.newTrigger(handler)
      .timeBased()
      .atHour(CONFIG.TRIGGER.HOUR_OF_DAY)
      .everyDays(1)
      .inTimezone(CONFIG.TIMEZONE)
      .create();
  } catch (e) {
    var errorMessage = 'トリガーの作成に失敗しました: ' + describeError(e);
    console.log(errorMessage);
    return { created: false, triggerCount: 0, message: errorMessage };
  }

  var successMessage = '毎日 ' + CONFIG.TRIGGER.HOUR_OF_DAY + '時台（日本時間）に ' +
    handler + '() を実行するトリガーを作成しました。';
  console.log(successMessage);
  return { created: true, triggerCount: 1, message: successMessage };
}

/**
 * 定期同期トリガーを削除する。
 *
 * @return {{removed: number, message: string}}
 */
function removeTrigger() {
  var handler = CONFIG.TRIGGER.HANDLER_FUNCTION;
  var targets = findTriggersByHandler_(handler);

  targets.forEach(function (trigger) {
    ScriptApp.deleteTrigger(trigger);
  });

  var message = targets.length > 0
    ? 'トリガーを' + targets.length + '件削除しました。自動同期は停止しました。'
    : '削除対象のトリガーはありませんでした。';
  console.log(message);
  return { removed: targets.length, message: message };
}

/**
 * 現在設定されているトリガーを一覧表示する。
 *
 * @return {!Array<{handler: string, id: string}>} トリガーの一覧
 */
function listTriggers() {
  var triggers = ScriptApp.getProjectTriggers();
  var result = triggers.map(function (trigger) {
    return { handler: trigger.getHandlerFunction(), id: trigger.getUniqueId() };
  });

  console.log('--- 設定済みトリガー（' + result.length + '件） ---');
  result.forEach(function (item) {
    console.log('  ' + item.handler + ' (ID: ' + item.id + ')');
  });
  if (result.length === 0) {
    console.log('  (なし) installTrigger() で自動同期を設定できます。');
  }
  return result;
}

/**
 * 指定した関数名のトリガーを探す。
 * @param {string} handlerFunction 関数名
 * @return {!Array<!Trigger>} 該当するトリガー
 * @private
 */
function findTriggersByHandler_(handlerFunction) {
  return ScriptApp.getProjectTriggers().filter(function (trigger) {
    return trigger.getHandlerFunction() === handlerFunction;
  });
}

// ===========================================================================
// 18_main.gs
// ===========================================================================

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

// ===========================================================================
// 19_tests.gs
// ===========================================================================

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
