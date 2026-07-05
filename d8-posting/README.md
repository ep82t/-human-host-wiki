# d8-posting — チラシ配布（ポスティング）管理システム

道南エリアのチラシ配布・店舗設置・辻立ちをChatwork報告から自動集計し、管理マップに可視化するGoogle Apps Scriptプロジェクト。
Drive上のGASプロジェクト「d8-posting」のソースをバージョン管理している。

## 全体像

```
[Chatwork] #ポスティング / #チラシ配布 / #辻立ち / #店舗設置 の報告投稿
    │ ①Webhook（リアルタイム, WebApp.js doPost → ChatworkWebhook.js）
    │ ②ポーリング（1時間毎トリガー, ChatworkPoller.js）※取りこぼし補完
    ▼
[Claude API] 投稿文から 市町村・町名・丁目・チラシ名・枚数・実施者 を抽出（ClaudeAPI.js）
    ▼
[チラシ別スプレッドシート]（FLYER_SS_MAP: チラシ名→SS ID）
    ・エリア / マンション / 店舗 / 実行者 / 配布記録 の5シート
    ・未知のチラシ名は createFlyerSpreadsheet() で自動作成
      → FLYER_TYPES にも自動追加 → 管理マップのチラシ選択に即反映
    ▼
[管理マップ]（admin.html, GAS Webアプリ）チラシ別に町丁目の配布状況を地図表示
```

## 新チラシの自動追加フロー

Chatworkに未知のチラシ名で報告が投稿されると:

1. チラシ名を正規化（`_normalizeFlyerName`: 全半角数字・語順・「チラシ:」プレフィックスを吸収）
2. `FLYER_SS_MAP` に無ければ新しいスプレッドシート「D8-Posting: チラシ名」を自動作成
   （エリアマスタから全町丁目をコピーしてステータス未着手で初期化）
3. `FLYER_TYPES` に自動追加 → 管理マップのドロップダウンに出現（＝マップ反映）
4. 作成したスプレッドシートに配布実績を記録（エリア更新＋配布記録追記）
5. Chatworkに「🆕 新チラシのマップを自動作成しました」と通知
6. SS作成に失敗した場合はキュー（`PENDING_POSTING_ENTRIES`）に保存し、次回ポーリングで再処理

この処理はWebhook（リアルタイム）とポーラー（毎時）の両方に実装されており、
Webhookで記録済みのメッセージIDは `CHATWORK_WEBHOOK_PROCESSED_IDS` に保存してポーラーが二重記録しないようにしている。

## 必要なスクリプトプロパティ

| キー | 内容 |
|---|---|
| `SPREADSHEET_ID` | マスターSS（エリアマスタ・配布記録・マンション台帳等）のID |
| `CHATWORK_TOKEN` | Chatwork APIトークン |
| `CHATWORK_ROOM_ID` | 報告を受け付けるルームID |
| `CHATWORK_REPORT_ROOM_ID` | （任意）集計報告の送信先ルームID |
| `CLAUDE_API_KEY` | 投稿文解析用のClaude APIキー |
| `MAPS_API_KEY` | Google Maps APIキー（ジオコーディング・地図表示） |
| `FLYER_TYPES` | チラシ名のカンマ区切りリスト（自動追加される） |
| `FLYER_SS_MAP` | チラシ名→SS IDのJSONマップ（自動追加される） |
| `APP_ACCESS_KEY` | （任意）WebアプリURLの合言葉。`setupSecurity()` で生成 |
| `CHATWORK_WEBHOOK_TOKEN` | （任意）Webhook検証トークン。`setupSecurity()` で生成 |

## デプロイ手順

1. このフォルダの `.js` ファイルの内容を、GASエディタ（プロジェクト「d8-posting」）の同名ファイル（拡張子 `.gs`）に貼り付けて保存
2. `admin.html` / `mansion.html` はHTMLファイルとして同名のまま貼り付け
3. 「デプロイ」→「デプロイを管理」→ 既存デプロイを**新バージョンで更新**（URLを変えないため）
4. Webhook利用時: Chatwork管理者設定のWebhook URLが `（WebアプリURL）?token=（CHATWORK_WEBHOOK_TOKEN）` になっていることを確認
5. ポーラー利用時: GASエディタで `setupPollTrigger()` を1回実行（既に設定済みなら不要）

※ ポスター掲出管理アプリ（別システム）は [`../poster-app/`](../poster-app/) を参照。
