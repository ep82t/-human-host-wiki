# GitHub Pages公開手順

このWikiをiPadやスマホで見るには、GitHub Pagesで公開します。

## こちらで準備済みのこと

- GitHub Pages用の自動公開ワークフローを追加済み。
- GitHub上では `/-human-host-wiki/` でも動くようにDocusaurus設定を調整済み。
- ローカルでは今まで通り `http://127.0.0.1:3000/` で確認できます。

## GitHub側で必要なこと

1. GitHubで `-human-host-wiki` というリポジトリを作る。
2. このプロジェクトをGitHubへアップロードする。
3. GitHubのリポジトリで `Settings` を開く。
4. 左側の `Pages` を開く。
5. `Build and deployment` の `Source` を `GitHub Actions` にする。
6. `Actions` タブで `Deploy Wiki to GitHub Pages` が成功するのを待つ。

## 公開URL

公開後のURLは通常この形になります。

```text
https://GitHubユーザー名.github.io/-human-host-wiki/
```

## iPadでできること

- 公開されたWikiを見る。
- GitHub上でMarkdownを軽く編集する。
- 画像をアップロードする。

大量編集や画像整理はPCとCodexで行う方が楽です。
