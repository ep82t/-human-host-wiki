# e-Gov 法令API Version 2 仕様に関する注意事項

このドキュメントは、**何が検証済みで、何が未検証か** を明示するものです。
実装を引き継ぐ人・運用する人は、必ず最初に読んでください。

---

## 1. 前提：実装環境での制約

このシステムのコードを書いた環境では、ネットワークの外向き通信ポリシーにより
`laws.e-gov.go.jp` へのアクセスが **すべて遮断** されていました。

```
$ curl https://laws.e-gov.go.jp/api/2/swagger-ui/
curl: (56) CONNECT tunnel failed, response 403

recentRelayFailures:
  kind:   "connect_rejected"
  detail: "gateway answered 403 to CONNECT (policy denial or upstream failure)"
  host:   "laws.e-gov.go.jp:443"
```

Webページ取得ツールでも同じく遮断されました
（`laws.e-gov.go.jp` および解説記事を掲載する `qiita.com` `zenn.dev` `api-zukan.com` も同様）。

そのため、**公式OpenAPI仕様書を直接確認することができませんでした。**

「推測したAPI仕様で実装しない」という要件に対し、
できる限り誠実に対応するための設計を以下に説明します。

---

## 2. 検証済みのもの / 未検証のもの

### ✅ 実際に実行して検証済み

以下は、Google Apps Script の各サービスをNode.js上で再現し、
`src/*.gs` を**書き換えずそのまま実行**して検証しました（テスト28件すべて成功）。

| 対象 | 検証内容 |
| --- | --- |
| XML解析 | 法令標準XMLの解析、属性、エンティティ、空要素タグ、閉じタグ欠落 |
| 全角スペースの保持 | 「第一編　総則」の全角空白が半角に変換されないこと |
| Markdown変換 | 編・章・節・条・項・号の構造保持、表の変換、附則・別表 |
| **条文が改変されないこと** | 入力した条文の文字列が1文字も変わらずに出力されること |
| 構造化JSON | 条・項・号への分解、引用表記の生成、本則と附則の区別 |
| ハッシュ差分検出 | SHA-256の既知値との一致、改行コード差で誤判定しないこと |
| フォルダ作成の冪等性 | 2回実行してもフォルダが増えないこと |
| ファイル更新の冪等性 | 同名ファイルを新規作成せず、既存ファイルIDを更新すること |
| 変更なし時の非書き込み | ハッシュ一致時にDriveへ書き込まないこと |
| 履歴の退避 | 改正時に改正前のXML/Markdownが `99_履歴` へ退避されること |
| 廃止法令の扱い | 削除せず `status: repealed` として記録されること |
| Dry Run | ファイルも台帳も一切書き換えないこと |
| 検索0件・複数件 | 推測で保存せず、WARNとしてスキップすること |
| エラー時の継続 | 1件の失敗で全体が停止しないこと |
| トリガー重複防止 | 2回実行してもトリガーが1件のままであること |
| 長期間未同期 | 「更新なし」と誤判定せず全件再取得へフォールバックすること |
| 通し実行 | `setup()` で45件を取得し、36フォルダを作成できること |

### ❌ 未検証（実運用前に必ず確認が必要）

| 対象 | 内容 |
| --- | --- |
| **APIのパス** | `/laws` `/law_data/{...}` `/law_revisions/{...}` `/keyword` |
| **クエリパラメータ名** | `response_format` `law_title` `keyword` `asof` `limit` など |
| **レスポンス項目名** | `law_id` `law_num` `law_title` `law_full_text` など |
| **`law_type` の enum 値** | `Act` `CabinetOrder` `MinisterialOrdinance` など |
| **廃止状態のフィールド** | `repeal_status` `repeal_date` の実際の名前と値 |
| **更新法令情報の取得方法** | `updated_from` パラメータの有無と取得可能期間 |
| **XML形式での取得可否** | `response_format=xml` が使えるか |
| **利用制限** | レート制限の明示的な規定の有無 |

---

## 3. 公開情報から確認できた内容

Web検索で得られた情報（**公式仕様書そのものではありません**）：

- 法令API Version 2 は 2025年3月19日に公開された。
- 認証不要でHTTPS経由で利用できる。
- 主なエンドポイントは
  `GET /laws`（法令一覧）、
  `GET /law_data/{id}`（法令本文）、
  `GET /law_revisions/{id}`（改正履歴一覧）、
  `GET /keyword`（キーワード検索）。
- ベースURLは `https://laws.e-gov.go.jp/api/2`。
- `response_format` パラメータで `json` / `xml` を切り替える。
- 法令本文は `law_data` のレスポンスの `law_full_text` に含まれる。
- `asof` パラメータで時点指定検索ができる。
- OpenAPI仕様は `https://laws.e-gov.go.jp/api/2/swagger-ui/` で確認できる。

出典（検索結果として得られたもの）：

- [法令API（Version 1） - 法令データ ドキュメンテーション（α版）](https://laws.e-gov.go.jp/docs/law-data-basic/8529371-law-api-v1/)
- [法令種別と法令ID - 法令データ ドキュメンテーション（α版）](https://laws.e-gov.go.jp/docs/law-data-basic/607318a-lawtypes-and-lawid/)
- [お知らせ | e-Gov法令検索](https://laws.e-gov.go.jp/news/)
- [e-Gov法令APIの使い方完全ガイド | API図鑑](https://api-zukan.com/blog/e-gov-api-guide)
- [e-Gov法令API Verson2とPythonで作るミニQAエージェント - Qiita](https://qiita.com/Lian/items/f46eaf14b3c5a8021b1f)
- [e-Gov ってなんだ 法令APIたたいてみた件 - Zenn](https://zenn.dev/braindumper/articles/02874e7b52d23e)

**これらは二次情報です。必ず公式仕様で確認してください。**

---

## 4. 未検証であることへの対処設計

未検証のまま動かないコードを納品しないため、次の3つを実装しています。

### 対処1：仕様を1か所に集約した

APIのパス・パラメータ名・レスポンス項目名は、すべて
**`src/02_api_spec.gs` の `EGOV_API_SPEC` だけ** に書かれています。
他のファイルは生の文字列を書かず、必ずこの定義を参照します。

```javascript
// ❌ このような書き方はしていない
var url = 'https://laws.e-gov.go.jp/api/2/law_data/' + id + '?response_format=xml';

// ✅ 実際の書き方
var params = {};
params[EGOV_API_SPEC.PARAMS.RESPONSE_FORMAT] = EGOV_API_SPEC.FORMATS.XML;
var url = buildEgovUrl('LAW_DATA', { lawIdOrNumOrRevisionId: id }, params);
```

**仕様が違っていた場合、修正するのは `02_api_spec.gs` の値だけです。**
業務ロジックに手を入れる必要はありません。

### 対処2：`verifyApiSpec()` で自動照合する

GAS上（e-Govへ到達できる環境）で `verifyApiSpec()` を実行すると：

1. 公式OpenAPI仕様書を候補URLから順に取得する
2. 設定した `ENDPOINTS` のパスが実際に存在するか照合する
3. 各エンドポイントの **実際のパラメータ名を一覧表示** する
4. 差異があれば、どこが違うかをレポートする
5. 成功時は照合日時を Script Properties へ記録する

パスの比較では `{lawId}` と `{law_id}` のような
パラメータ名の違いを無視し、パスの形だけを比べます。

### 対処3：レスポンス項目名を寛容に読む

項目名を1つに決め打ちせず、`FIELD_CANDIDATES` に候補の配列を持ち、
`08_response_reader.gs` が順に探索します。

```javascript
LAW_TITLE: ['law_title', 'lawTitle', 'LawTitle', 'law_name', 'title',
            'revision_info.law_title', 'current_revision_info.law_title'],
```

候補にない名前でも、キー名を正規化（小文字化・記号除去）して
深さ優先で再探索します。そのため `Law-ID` `lawID` `LAW_ID` なども読み取れます。

**結果として、命名の差異は「全件失敗」ではなく
「WARN付きで処理継続」に縮退します。**

さらに、取得したデータが法令XMLらしいかを保存前に検証し
（`looksLikeLawXml_`）、HTMLのエラーページやJSONを
誤って「原本XML」として保存することを防いでいます。

---

## 5. 運用開始前のチェックリスト

- [ ] `verifyApiSpec()` を実行し、`結果: OK` になることを確認した
- [ ] `OK` にならなかった場合、レポートを見て `02_api_spec.gs` を修正した
- [ ] `runAllTests()` を実行し、28件すべて成功することを確認した
- [ ] `dryRunSync()` を実行し、想定どおりの法令が対象になることを確認した
- [ ] `setup()` を実行し、Drive上に法令が保存されたことを確認した
- [ ] `90_RAW_XML` の中身が **XMLとして正しく** 保存されていることを目視確認した
- [ ] Markdownの条文が、e-Gov公式サイトの条文と **一致している** ことを数件確認した
- [ ] 失敗・スキップされた法令がないか、ログで確認した
- [ ] `installTrigger()` で自動実行を設定した

### 特に確認してほしいこと

**Markdownの条文とe-Gov公式サイトの条文を、必ず数件は目視で比較してください。**

`10_markdown_converter.gs` は法令標準XMLスキーマの要素名にもとづいて
変換していますが、実際のe-Govデータには、このスキーマの想定を超えた
要素が含まれている可能性があります。

未知の要素に遭遇した場合、コンバータは
**テキストを捨てずに再帰的に拾うフォールバック処理** を行うため
本文が欠落することはありませんが、**見出しの階層が意図と異なる**
可能性はあります。

原本XML（`90_RAW_XML`）は常に無加工で保存されているため、
変換ロジックを修正して `syncAllLaws()` を再実行すれば、
Markdownはいつでも作り直せます。

---

## 6. API仕様が変わったときの対応手順

1. `verifyApiSpec()` を実行し、レポートを確認する
2. `02_api_spec.gs` の `ENDPOINTS` / `PARAMS` / `FIELD_CANDIDATES` を修正する
3. ローカルで `node tools/run-tests.js` を実行し、28件が通ることを確認する
4. `dryRunSync()` で影響範囲を確認する
5. `syncAllLaws()` を実行する

**`90_RAW_XML` の原本は無加工で保存されているため、
変換ロジックの修正だけであれば、APIへ再アクセスせずに
Markdownと構造化JSONを作り直すこともできます。**

---

## 7. アクセス制御について

公的APIに負荷をかけないため、以下を実装しています。

| 項目 | 設定値 | 定義場所 |
| --- | --- | --- |
| リクエスト間の最小間隔 | 1,200ミリ秒 | `CONFIG.HTTP.MIN_INTERVAL_MS` |
| 最大リトライ回数 | 4回 | `CONFIG.HTTP.MAX_RETRIES` |
| 指数バックオフの基準 | 2,000ミリ秒 | `CONFIG.HTTP.BACKOFF_BASE_MS` |
| バックオフの上限 | 32,000ミリ秒 | `CONFIG.HTTP.BACKOFF_MAX_MS` |
| リトライ対象ステータス | 408, 425, 429, 500, 502, 503, 504 | `CONFIG.HTTP.RETRYABLE_STATUS` |

- `Retry-After` ヘッダがある場合は、その指示を優先して待機します。
- バックオフにはランダムなゆらぎ（ジッタ）を加え、リトライの集中を避けます。
- 404 などリトライしても回復しないステータスでは、再試行しません。

**e-Gov が利用制限を明示している場合は、必ずその規定に合わせて
上記の設定値を調整してください。** 公式の規定が実装時点で確認できなかったため、
現在の値は「十分に控えめな」推定値です。
