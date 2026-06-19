# Human Host Wiki

Human Hostの情報を個人で整理するためのWikiプロジェクトです。  
Docusaurus、Markdown、YAMLを使い、将来的にCodexによる記事整理、英語版対応、自動更新をしやすい構成にしています。

## 目的

- Human Hostの情報を見やすく整理する
- アーリーアクセス中の変更に対応しやすくする
- 確認済み、未確認、開発中、実装予定を分けて管理する
- Codexで記事作成、整理、翻訳、更新確認をしやすくする

## 主なページ

- トップ
- バイオーム
- 資源
- アイテム
- クラフト
- 建築
- 敵
- 車両
- Trader System
- アップデート履歴
- 未確認情報
- 用語集

## 必要なもの

- Node.js 18以上
- npm
- GitHubアカウント

Node.jsが入っているか確認するには、ターミナルで次を実行します。

```powershell
node --version
npm --version
```

## セットアップ

最初に依存関係をインストールします。

```powershell
npm install
```

ローカルでWikiを起動します。

```powershell
npm run start
```

表示されたURLをブラウザで開きます。通常は次のURLです。

```text
http://localhost:3000/
```

公開前のビルド確認をする場合は次を実行します。

```powershell
npm run build
```

## 記事の追加方法

記事は `docs/` の中にMarkdownファイルとして追加します。

例:

```text
docs/resources/wood.md
docs/biomes/forest.md
```

新しいページをサイドバーに出したい場合は `sidebars.js` に追加します。

## 画像の追加方法

スクリーンショットは `static/images/` の中に保存します。

例:

```text
static/images/screenshots/2026-06-19-example.png
static/images/biomes/example-biome.png
static/images/items/example-item.png
```

Markdownから画像を使う場合:

```md
![説明](/images/screenshots/2026-06-19-example.png)
```

## YAMLデータ

一覧化しやすい情報は `data/` にYAMLで保存します。

例:

```text
data/biomes.yml
data/resources.yml
data/items.yml
data/recipes.yml
```

今は空の配列やテンプレートだけを置いています。確認済み情報から追加してください。

## 状態管理

情報には必ず状態を付けます。

| 状態 | 意味 |
| --- | --- |
| 確認済み | ゲーム内で確認済み |
| 未確認 | まだ自分では確認していない |
| 開発中 | 開発者情報などで制作中 |
| 実装予定 | 将来追加予定 |
| 変更可能性あり | アーリーアクセスのため変わる可能性が高い |
| 不明 | 判断できない |

## Trader Systemの扱い

Trader Systemは開発中として扱います。  
実装済みのようには書かず、開発者情報とゲーム内確認を分けて管理します。

## Codexへの依頼例

```text
このプレイメモをHuman Host Wikiの資源ページ形式に整理してください。
確認済み、未確認、開発中、実装予定を分けてください。
推測は断定しないでください。
```

```text
この開発者情報をTrader Systemページに反映してください。
実装済みとは書かず、開発中情報として整理してください。
```

```text
この日本語記事を英語版に翻訳してください。
用語集の表記を優先し、未確認情報は未確認のままにしてください。
```

## GitHub Pagesで公開する場合

最初はローカルで確認できれば十分です。  
公開する段階になったら、GitHub ActionsまたはGitHub Pages用の設定を追加します。

公開時には `docusaurus.config.js` の以下を実際のGitHub情報に変更します。

```js
url: 'https://your-github-name.github.io',
baseUrl: '/human-host-wiki/',
organizationName: 'your-github-name',
projectName: 'human-host-wiki',
```

## 注意

- 架空データは入れないでください。
- 未確認情報は未確認として扱ってください。
- アーリーアクセス中のため、古い情報は更新確認が必要です。
- Trader Systemは開発中です。
