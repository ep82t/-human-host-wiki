# web — そのままブラウザで開ける公開用ページ

`web/` の下は、ビルド不要の静的HTMLです。1ファイルで完結していて、
外部から読み込むのは Google Fonts だけです。データはどこにも送信されません。

## kuni-receipt — 国からの年間レシート

`web/kuni-receipt/index.html`

暮らし方ごとの平均年収から始めて、税・社会保険料・賦課金・生活費・保険・手当を
すべて足し、1年で国にいくら納め、いくら手元に残るのかを出す計算機です。
入力内容は利用者のブラウザの `localStorage` にだけ保存されます。

### 動かして確認する

ファイルをダブルクリックしてブラウザで開くだけで動きます。
ローカルサーバで見たい場合は次のとおりです。

```
cd web && python3 -m http.server 8000
# http://localhost:8000/kuni-receipt/ を開く
```

### Webで公開する

静的ファイルを置ければどこでも動きます。

- **GitHub Pages** — リポジトリの Settings → Pages で
  Source を「Deploy from a branch」、ブランチを `main`、フォルダを `/ (root)` にすると
  `https://<ユーザー名>.github.io/<リポジトリ名>/web/kuni-receipt/` で公開されます。
- **Netlify / Cloudflare Pages / Vercel** — `web` フォルダを公開ディレクトリに指定します。
- **レンタルサーバ** — `kuni-receipt` フォルダをそのままアップロードします。

独自ドメインの直下に置きたい場合は、`kuni-receipt/index.html` を
公開ディレクトリの `index.html` として置いてください。

### 数字を直すとき

税率・平均値の出典と確認日は、ページ最下部の表にすべて書いてあります。
制度改正があったときは、その表の行と、`index.html` 内の対応する初期値
（`value="..."` と `PRESETS`）を直してください。
利用者側でもすべての数字をその場で変更できます。
