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
