/**
 * @file 00_config.gs
 * パブリックコメント通知システムの設定。
 *
 * 監視対象のキーワードや通知の挙動は、このファイルだけを編集すれば変えられる。
 */

/** @const {!Object} システム設定 */
var CONFIG = {

  /** Google Drive のマイドライブ直下に作るフォルダ名 */
  ROOT_FOLDER_NAME: 'パブリックコメント監視',

  /** タイムゾーン */
  TIMEZONE: 'Asia/Tokyo',

  /**
   * 通知対象を絞り込むキーワード。
   * 案件名・所管府省庁のいずれかに含まれていれば通知する。
   *
   * 空配列 [] にすると「すべての案件」を通知する（件数が多いので非推奨）。
   */
  KEYWORDS: [
    // --- 税制 ---
    '税', '所得税', '法人税', '消費税', '相続税', '地方税', '租税', '控除', '課税',
    // --- 社会保険 ---
    '健康保険', '年金', '介護保険', '医療保険', '社会保険', '保険料',
    // --- 労働 ---
    '雇用保険', '労災', '労働保険', '労働基準', '賃金', '最低賃金',
    // --- 事業者向け ---
    '中小企業', '事業者', 'インボイス', '電子帳簿'
  ],

  /**
   * 除外キーワード。
   * これらが案件名に含まれる場合、上のキーワードに合致しても通知しない。
   */
  EXCLUDE_KEYWORDS: [],

  /** 通知の挙動 */
  NOTIFY: {
    /**
     * 1回の実行で投稿する最大件数。
     * 初回実行時に大量投稿してしまうのを防ぐ安全弁。
     */
    MAX_MESSAGES_PER_RUN: 10,
    /**
     * 初回実行時、過去の案件をさかのぼって通知するか。
     * false の場合、初回は「通知済み」として記録するだけで投稿しない
     * （いきなり何十件も流れるのを防ぐため）。
     */
    NOTIFY_ON_FIRST_RUN: false,
    /** 締切リマインドを送る日数。締切のこの日数前に通知する。 */
    DEADLINE_REMINDER_DAYS: [7, 3, 1],
    /** 締切リマインドを有効にするか */
    ENABLE_DEADLINE_REMINDER: true,
    /** 1件のメッセージに含める本文の最大文字数 */
    MAX_BODY_CHARS: 400
  },

  /** HTTPアクセス制御（公的サイトへ負荷をかけない） */
  HTTP: {
    MIN_INTERVAL_MS: 1500,
    MAX_RETRIES: 3,
    BACKOFF_BASE_MS: 2000,
    BACKOFF_MAX_MS: 30000,
    RETRYABLE_STATUS: [408, 425, 429, 500, 502, 503, 504],
    USER_AGENT: 'PublicCommentNotifier-GAS/1.0'
  },

  /** ChatWork API */
  CHATWORK: {
    BASE_URL: 'https://api.chatwork.com/v2',
    /** 認証トークンを渡すHTTPヘッダ名 */
    TOKEN_HEADER: 'X-ChatWorkToken',
    /** 投稿間隔（ミリ秒）。連続投稿でレート制限に触れないようにする。 */
    POST_INTERVAL_MS: 1000
  },

  /** ログ設定 */
  LOG: {
    MIN_LEVEL: 'INFO',
    SAVE_TO_DRIVE: true,
    MAX_CHARS: 2 * 1000 * 1000
  },

  /** Script Properties のキー名 */
  PROPERTY_KEYS: {
    ROOT_FOLDER_ID: 'ROOT_FOLDER_ID',
    /** ChatWork APIトークン（コードには絶対に書かない） */
    CHATWORK_TOKEN: 'CHATWORK_TOKEN',
    /** 投稿先ルームID */
    CHATWORK_ROOM_ID: 'CHATWORK_ROOM_ID',
    /** 投稿を実際に行うか（'true' で解禁）。既定は投稿しない。 */
    POSTING_ENABLED: 'POSTING_ENABLED',
    /** 自動発見したRSSフィードのURL */
    DISCOVERED_FEED_URL: 'DISCOVERED_FEED_URL',
    LAST_RUN_AT: 'LAST_RUN_AT',
    SETUP_COMPLETED_AT: 'SETUP_COMPLETED_AT'
  },

  /** フォルダ構成 */
  FOLDERS: {
    SYSTEM: '00_システム情報',
    ITEMS: '01_案件',
    LOG: '99_システムログ'
  },

  /** システムファイル名 */
  FILES: {
    STATE: '通知済み.json',
    CSV: '案件一覧.csv',
    README: 'README.md'
  },

  /** 案件一覧CSVの列 */
  CSV_COLUMNS: [
    'item_id', 'title', 'ministry', 'status', 'published_at', 'deadline',
    'url', 'first_seen_at', 'notified_at', 'matched_keywords'
  ],

  /** 台帳に保持する案件の最大件数（古いものから削除） */
  MAX_STATE_ITEMS: 2000,

  /** トリガー設定 */
  TRIGGER: {
    HANDLER_FUNCTION: 'notifyNewPublicComments',
    HOUR_OF_DAY: 8
  }
};
