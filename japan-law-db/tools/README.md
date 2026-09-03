# ローカル検証ツール

Google Apps Script の各サービス（`DriveApp` / `UrlFetchApp` / `PropertiesService` /
`ScriptApp` / `Utilities`）をNode.js上で再現するスタブです。

これにより、**`src/*.gs` を1文字も書き換えずに** ローカルで実行・検証できます。
「テスト用に書き直したコピー」ではなく、GASへ配置するコードそのものを検証します。

## 使い方

```bash
node run-tests.js     # テストスイート（28件）
node e2e-setup.js     # setup() の通し実行とフォルダ構成の確認
```

e-Gov APIへは接続せず、`19_tests.gs` の `stubEgovApi_()` が返す
スタブ応答で実行されるため、公的APIに負荷をかけません。

## ファイル

| ファイル | 役割 |
| --- | --- |
| `gas-shim.js` | GASのグローバルサービスをNode上で再現 |
| `load-gas.js` | `src/*.gs` をスタブ環境へ読み込む |
| `run-tests.js` | `runAllTests()` を実行 |
| `e2e-setup.js` | `setup()` を通しで実行し、Drive構成を表示 |
| `fixtures/sample-law.xml` | 法令標準XMLスキーマに沿ったサンプル |

## スタブと本物の違い

スタブは検証に必要な範囲を再現したものであり、GASの完全な再現ではありません。

- `Utilities.sleep()` は何もしません（テストを高速化するため）
- `Utilities.computeDigest()` はNodeの `crypto` を使い、
  GASと同じ**符号付きバイト配列**を返します
- `FakeFile.writeCount` は書き込み回数を数えます
  （「変更なしのとき書き込まない」ことの検証に使用）
- `FakeDriveApp.failWrites` でDrive書き込みエラーを再現できます

通信部分は必ず、GAS上で `verifyApiSpec()` を実行して確認してください。
