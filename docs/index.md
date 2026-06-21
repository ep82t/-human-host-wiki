---
id: index
title: Human Host Wiki
slug: /
---

import useBaseUrl from '@docusaurus/useBaseUrl';

<div className="hh-hero">
  <img src={useBaseUrl('/images/human-host-logo.png')} alt="Human Host" className="hh-hero-logo" />
  <p className="hh-hero-subtitle">
    Human Hostの情報を、確認状態つきで整理する個人Wikiです。アーリーアクセス中のため、確認済み・未確認・開発中を分けて管理します。
  </p>
</div>

## まず見る場所

<div className="hh-card-grid">
  <a className="hh-card" href={useBaseUrl('/getting-started/start-flow/')}>
    <span className="hh-card-kicker">Start Here</span>
    <strong>ゲーム開始までの流れ</strong>
    <span>ニューゲーム、セーブスロット、難易度設定、キャラクター選択まで。</span>
  </a>
  <a className="hh-card" href={useBaseUrl('/getting-started/character-selection/')}>
    <span className="hh-card-kicker">Character</span>
    <strong>キャラクター選択</strong>
    <span>狩人、スカベンジャー、整備士のスキルと初期装備。</span>
  </a>
  <a className="hh-card" href={useBaseUrl('/getting-started/early-game/')}>
    <span className="hh-card-kicker">Early Game</span>
    <strong>序盤の進め方</strong>
    <span>F1手作り、簡易な石の稿、地下仮拠点の作り方。</span>
  </a>
  <a className="hh-card" href={useBaseUrl('/crafting/')}>
    <span className="hh-card-kicker">Recipes</span>
    <strong>クラフト</strong>
    <span>序盤に作るもの、素材、作業台、車両クラフト。</span>
  </a>
  <a className="hh-card" href={useBaseUrl('/biomes/')}>
    <span className="hh-card-kicker">World</span>
    <strong>バイオーム</strong>
    <span>10種類のバイオームと資源分布のメモ。</span>
  </a>
  <a className="hh-card" href={useBaseUrl('/resources/')}>
    <span className="hh-card-kicker">Materials</span>
    <strong>資源</strong>
    <span>採取方法、入手場所、用途を整理。</span>
  </a>
  <a className="hh-card" href={useBaseUrl('/items/')}>
    <span className="hh-card-kicker">Items</span>
    <strong>アイテム</strong>
    <span>食料、水、医薬品、素材、ツール、武器。</span>
  </a>
  <a className="hh-card" href={useBaseUrl('/settings/hotkeys/')}>
    <span className="hh-card-kicker">Controls</span>
    <strong>ホットキー</strong>
    <span>操作、インターフェース、移動、アイテム操作。</span>
  </a>
  <a className="hh-card" href={useBaseUrl('/trader-system/')}>
    <span className="hh-card-kicker">In Development</span>
    <strong>Trader System</strong>
    <span>開発中のNPC取引システムを追跡。</span>
  </a>
</div>

## 情報の状態

| 状態 | 意味 |
| --- | --- |
| 確認済み | ゲーム内、公式情報、スクリーンショットで確認した情報 |
| 未確認 | 情報はあるが、まだ確認できていない情報 |
| 開発中 | 開発者情報などで制作中とされている情報 |
| 実装予定 | 将来追加予定として扱う情報 |
| 変更可能性あり | アーリーアクセスのため変わる可能性が高い情報 |
