# ポスター管理アプリ

函館市（および道南地域）でのポスター掲出状況を記録・管理するWebアプリ。
掲出場所・設置日・貼替日・ステータス（🟢正常 / 🟡要確認 / 🔴撤去済み）・担当者をスマホから登録・更新できる。

- 公開URL: https://melodic-bunny-1fa47a.netlify.app
- データ保存先: Googleスプレッドシート「ポスター管理台帳_20260302」

## 構成

```
[ブラウザ] frontend/index.html（Netlifyでホスト）
    │  fetch (GET/POST, JSON)
    ▼
[GAS Webアプリ] gas/main.js（doGet/doPost）
    │
    ▼
[Googleスプレッドシート] ポスター管理 / ポスター種類 / 担当者 の3シート
```

フレームワーク・ビルド工程なし。フロントはHTML 1ファイル、バックエンドはGAS 1ファイル。
詳しい仕様（データ構造・API・コーディング規約）は [CLAUDE.md](./CLAUDE.md) を参照。

## ファイル構成

| パス | 内容 |
|---|---|
| `frontend/index.html` | フロントエンド一式（旧 `poster-app-v6.html`） |
| `gas/main.js` | GASバックエンド（旧 `poster-gas-v2.js`） |
| `gas/appsscript.json` | GASマニフェスト（V8 / Asia/Tokyo / Webアプリ設定） |

## デプロイ手順

### フロントエンド（Netlify・手動）

1. `frontend/index.html` を編集してコミット
2. https://app.netlify.com で対象サイト（melodic-bunny-1fa47a）を開く
3. 「Deploys」タブに `frontend/` フォルダをドラッグ＆ドロップ
   - フォルダ直下に `index.html` がある状態でドロップすること

#### 自動化する場合（netlify-cli・任意）

```bash
npm install -g netlify-cli
netlify login
netlify link            # 既存サイト melodic-bunny-1fa47a に紐付け
netlify deploy --dir=frontend --prod
```

### バックエンド（GAS・手動）

1. `gas/main.js` を編集してコミット
2. https://script.google.com でプロジェクト「ポスター管理」を開く
3. エディタの「コード.gs」に `gas/main.js` の内容を全文貼り付けて保存
4. **「デプロイ」→「デプロイを管理」→ 鉛筆アイコン → バージョン「新バージョン」→「デプロイ」**
   - ここまでやらないと公開URL（/exec）に反映されない
   - 「新しいデプロイ」を作るとURLが変わってしまうので、必ず既存デプロイの更新にすること

#### 自動化する場合（clasp・任意）

```bash
npm install -g @google/clasp
clasp login                      # 認証情報は ~/.clasprc.json に保存される（コミット禁止）
cd gas
clasp clone <スクリプトID>        # 初回のみ。以降は clasp push / clasp deploy
```

※ clasp導入時は `gas/.clasp.json`（スクリプトIDのみ）はコミット可、`~/.clasprc.json`（認証トークン）はコミット禁止。

## 開発フロー

1. ローカル（またはClaude Code）で `frontend/` / `gas/` を編集
2. `git commit` で変更を記録
3. 上記の手順でNetlify / GASへデプロイ
4. 動作確認: 公開URLで新規登録→スプレッドシートに行が追加されること、一覧タブで表示・修正・削除ができることを確認
