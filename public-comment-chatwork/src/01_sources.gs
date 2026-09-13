/**
 * @file 01_sources.gs
 * パブリックコメントの取得元定義。
 *
 * 設計方針
 * --------
 * e-Gov パブリックコメントには法令APIのような公式APIが確認できていない。
 * ただしRSS配信が提供されているため、それを利用する。
 *
 * フィードの正確なURLを推測で決め打ちすると、URLが変わった瞬間に動かなくなる。
 * そこで本システムは、
 *
 *   1. 保存済みのフィードURL（前回、発見に成功したもの）
 *   2. 候補URLの直接試行
 *   3. **案内ページからフィードURLを自動発見**
 *
 * の順に試す。3があるため、候補URLが全滅しても自力で見つけられる。
 */

/** @const {!Object} パブリックコメントの取得元 */
var PUBCOM_SOURCE = {

  /** サイトのベースURL */
  BASE_URL: 'https://public-comment.e-gov.go.jp',

  /** 人間が案件一覧を見るページ */
  LIST_PAGE_URL: 'https://public-comment.e-gov.go.jp/pcm/list',

  /**
   * RSSフィードのURL候補。上から順に試す。
   * 正しいURLが判明したら、この配列の先頭に足せばよい。
   * @type {!Array<string>}
   */
  FEED_URL_CANDIDATES: [
    'https://public-comment.e-gov.go.jp/rss/pcm.xml',
    'https://public-comment.e-gov.go.jp/rss/public-comment.xml',
    'https://public-comment.e-gov.go.jp/rss/pcm_list.xml',
    'https://public-comment.e-gov.go.jp/pcm/rss',
    'https://public-comment.e-gov.go.jp/rss.xml'
  ],

  /**
   * RSSフィードの案内ページ。
   * 候補URLで見つからない場合、このページ内のリンクから
   * フィードのURLを自動的に探し出す。
   * @type {!Array<string>}
   */
  FEED_GUIDE_PAGES: [
    'https://public-comment.e-gov.go.jp/contents/help/guide/rss.html',
    'https://public-comment.e-gov.go.jp/contents/service-policy/rssfeed.html',
    'https://public-comment.e-gov.go.jp/contents/sitemap'
  ],

  /**
   * RSS項目から値を取り出すときの候補タグ名。
   * RSS 2.0 / RDF(RSS 1.0) / Atom のいずれでも読めるようにする。
   * @type {!Object<string, !Array<string>>}
   */
  FIELD_TAGS: {
    /** 案件を表す要素名 */
    ITEM: ['item', 'entry'],
    TITLE: ['title'],
    LINK: ['link'],
    DESCRIPTION: ['description', 'summary', 'content'],
    DATE: ['pubDate', 'date', 'published', 'updated', 'issued'],
    CATEGORY: ['category', 'dc:subject', 'subject']
  }
};

/**
 * ChatWorkのメッセージ投稿URLを組み立てる。
 *
 * @param {string} roomId ルームID
 * @return {string} 投稿先URL
 */
function buildChatworkMessageUrl(roomId) {
  return CONFIG.CHATWORK.BASE_URL + '/rooms/' + encodeURIComponent(roomId) + '/messages';
}

/**
 * ChatWorkの自分の情報を取得するURL（トークン確認に使う）。
 * @return {string} URL
 */
function buildChatworkMeUrl() {
  return CONFIG.CHATWORK.BASE_URL + '/me';
}

/**
 * ChatWorkのルーム一覧を取得するURL（ルームID確認に使う）。
 * @return {string} URL
 */
function buildChatworkRoomsUrl() {
  return CONFIG.CHATWORK.BASE_URL + '/rooms';
}
