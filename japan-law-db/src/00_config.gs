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
    /**
     * この時間を超えたら安全に中断し、続きは次回実行へ回す（ミリ秒）。
     * GASの上限は6分。1法令あたり最大十数秒かかるため、
     * 余裕を1分残した5分を上限とする。
     */
    SOFT_TIME_LIMIT_MS: 5 * 60 * 1000,
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
