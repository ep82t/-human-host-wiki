# CLAUDE.md — ポスター管理アプリ

このファイルは、Claude Code がこのプロジェクトで作業する際のガイドです。

## プロジェクト概要

函館市（および道南地域）でのポスター掲出状況を記録・管理するWebアプリ。
掲出場所の住所・設置日・貼替日・ステータス・担当者などをスマホから登録・更新できる。

- 画面構成: 「📌新規貼付」「📋一覧・管理」の2タブ
- ステータス表示: 🟢正常 / 🟡要確認 / 🔴撤去済み（フィルター機能あり）
- 昼夜テーマ切り替え: OS設定の自動検出＋手動トグル＋localStorage保存

## 技術構成

フレームワークなし・ビルド工程なしの構成。**素のHTML/CSS/JSのまま維持すること**（npm依存やバンドラーを勝手に導入しない）。

| レイヤー | 技術 | ホスティング |
|---|---|---|
| フロントエンド | 素のHTML/CSS/JS 1ファイル（`frontend/index.html`） | Netlify（手動デプロイ） |
| バックエンド | Google Apps Script Webアプリ（`gas/main.js`） | GASエディタから手動デプロイ |
| データ保存 | Googleスプレッドシート | — |

フロントエンドは GAS WebアプリのURL（`/exec`）に対して `fetch` でGET/POSTする。
GAS側は `ContentService` でJSONを返す（`access: ANYONE_ANONYMOUS` の匿名アクセス）。

## ファイル構成

```
poster-app/
├── CLAUDE.md            # このファイル
├── README.md            # アプリの目的・構成・デプロイ手順
├── .gitignore
├── frontend/
│   └── index.html       # フロントエンド一式（旧 poster-app-v6.html）
└── gas/
    ├── main.js          # GASコード（旧 poster-gas-v2.js。GASエディタ上のファイル名は「コード.gs」）
    └── appsscript.json  # GASマニフェスト（V8 / Asia/Tokyo / Webアプリ設定）
```

## データ構造

スプレッドシートは3シート構成。

### シート「ポスター管理」（メイン台帳・15列）

| # | 列名 | 備考 |
|---|---|---|
| 1 | 記号 | |
| 2 | 形態 | 企業 / 民家 / 立看 / その他 など |
| 3 | 許可の有無 | ○ / あり / なし など |
| 4 | 名称 | 場所の呼び名 |
| 5 | 住所（数字ハイフンは半角） | |
| 6 | 枚数 | |
| 7 | 補足 | メモ |
| 8 | 記入者 | |
| 9 | 設置者 | |
| 10 | 設置日 | `yyyy.MM.dd` 形式（フォームの `-` は `.` に変換して保存） |
| 11 | ポスター種類 | マスター「ポスター種類」から選択 |
| 12 | 修復・交換日 | `yyyy.MM.dd` 形式 |
| 13 | 入力種別 | 新規貼付 / 修正・貼替 |
| 14 | 入力日時 | `yyyy/MM/dd HH:mm:ss`。更新時は `（修正）` を付加 |
| 15 | ステータス | 正常 / 要確認 / 撤去済み（未設定は「正常」扱い） |

### マスターシート

- 「ポスター種類」: A列=名前（1行目ヘッダー）。プルダウン候補
- 「担当者」: A列=名前（1行目ヘッダー）。プルダウン候補

## GAS API仕様（gas/main.js）

- `doGet` … `?action=getAll`（全件取得。新しい順。各行に `_rowIndex`=実シート行番号を付与）/ `?action=getMaster`（ポスター種類・担当者の取得）
- `doPost` … JSONボディの `action` で分岐:
  - なし（デフォルト）: 新規行追加（`mode: 'new'` → 入力種別「新規貼付」、それ以外は「修正・貼替」）
  - `update`: `rowIndex` 指定でセル更新
  - `delete`: `rowIndex` 指定で行削除
  - `addMaster` / `deleteMaster`: `listKey`（`posterTypes` or 担当者）でマスター編集

**注意**: 行の特定は `_rowIndex`（物理行番号）ベース。複数人が同時に削除すると行ズレの可能性がある（既知の設計上の割り切り）。

## GAS特有の制約・コーディング規約

- ランタイムはV8だが、コードは互換性重視で **`var` と `function(){}` スタイルで統一**している。テンプレートリテラル・アロー関数・`const`/`let` は既存コードでは使っていないので、追記時もこのスタイルに合わせること
- `doPost` へのブラウザからのPOSTはCORSプリフライトを避けるため、フロント側は `Content-Type: text/plain` 相当のシンプルリクエストで送る（GAS Webアプリの定番回避策）
- GASの変更は保存しただけでは公開URLに反映されない。**「デプロイ」→「デプロイを管理」→ 新バージョンとして更新**が必要
- レスポンスは必ず `buildResponse()`（ContentService+JSON）経由で返す

## 環境情報

- スプレッドシートID: `1y2REf6tQVETw9qfzastIOXlfzJR_I8RFAv6JrwhvVHc`（`gas/main.js` の `SPREADSHEET_ID` にハードコード）
- スプレッドシート名: ポスター管理台帳_20260302
- Netlify 公開URL: https://melodic-bunny-1fa47a.netlify.app
- GASプロジェクト名: 「ポスター管理」（Drive上。Webアプリとしてデプロイ済み、匿名アクセス可）
- GAS WebアプリURL（/exec）: `frontend/index.html` 内の定数を参照

## 開発フロー・運用ルール

1. このリポジトリの `poster-app/` 配下を編集する（フロント=`frontend/index.html`、GAS=`gas/main.js`）
2. 変更はGitでコミットしてからデプロイする（デプロイ済みと未デプロイの差分が追えるように）
3. デプロイ:
   - フロント: `frontend/` フォルダをNetlifyにドラッグ＆ドロップ（詳細はREADME）
   - GAS: GASエディタに `gas/main.js` を貼り付け → 新バージョンとしてデプロイ
   - ※ clasp / netlify-cli による自動化は未導入（導入する場合はREADMEの該当セクション参照）
4. GAS WebアプリのURL（/exec）が変わった場合（新規デプロイを作り直した場合）は、`frontend/index.html` 内のURL定数も更新すること
5. スプレッドシートの列構成を変える場合は、`HEADERS` / `COL` / doGet・doPostの入出力 / フロントの表示、の4か所を必ずセットで更新する
6. 認証情報（`.clasprc.json` など）はコミットしない（.gitignore済み）
