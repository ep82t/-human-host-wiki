---
title: キャラクター選択
slug: /getting-started/character-selection/
---

import useBaseUrl from '@docusaurus/useBaseUrl';

# キャラクター選択

Human Hostでは、ゲーム開始時にキャラクターを選びます。  
キャラクターごとにスキルと初期装備が違うため、最初の遊びやすさがかなり変わります。

このページは、ゲーム内画像で確認できた内容だけを整理しています。画像はクリックまたはタップすると大きく表示できます。

## 最初に選ぶなら

| 目的 | おすすめ | 理由 |
| --- | --- | --- |
| 迷ったら安定したい | スカベンジャー | 水・食料を持って始められ、戦利品の量も増える |
| 戦闘が不安 | 狩人 | 弓ダメージが大きく上がり、距離を取って戦いやすい |
| 車両クラフトを早く触りたい | 整備士 | 序盤から車両部品を持ち、ビーグルを組み立てられる |

## キャラクター比較

| キャラ | スキル | 得意なこと | 初心者向けメモ |
| --- | --- | --- | --- |
| 狩人 | アーチャー | 弓での遠距離戦闘 | 敵と距離を取りやすい。戦闘が苦手なら候補 |
| スカベンジャー | スカベンジャー | 物資集め、探索 | 水と食料があるので序盤の生存が安定しやすい |
| 整備士 | 整備士 | 車両作成、移動、防衛 | Human Hostらしい車両システムを早く試せる |

## 狩人

<div className="hh-character-card">
  <a className="hh-character-main-shot" href={useBaseUrl('/images/screenshots/characters/hunter-overview.png')} target="_blank" rel="noreferrer">
    <img src={useBaseUrl('/images/screenshots/characters/hunter-overview.png')} alt="狩人のキャラクター選択画面" />
  </a>
  <div>
    <h3>遠距離戦闘に強いキャラ</h3>
    <p>狩人は弓を中心に戦うキャラクターです。スキル「アーチャー」により、弓ダメージが大きく上がります。</p>
    <table>
      <tbody>
        <tr><th>スキル</th><td>アーチャー</td></tr>
        <tr><th>効果</th><td>弓ダメージが200%上昇</td></tr>
        <tr><th>向いている人</th><td>敵と距離を取って戦いたい人</td></tr>
        <tr><th>情報状態</th><td><span className="status-confirmed">確認済み</span></td></tr>
      </tbody>
    </table>
  </div>
</div>

### 狩人の初期装備

| アイテム | 数量 | 内容 |
| --- | ---: | --- |
| 木弓 | 1 | 遠隔武器。頭部ダメージ x3 |
| 石の矢 | 50 | ダメージ 12.5、速度 40m/s |
| 鉄の矢 | 10 | ダメージ 30、速度 75m/s |
| コンバットナイフ | 1 | 近接武器。頭部ダメージ x4 |
| ドアの盾 | 1 | 装備品。身体部位を保護 |
| 破損の木板 | 60 | 建築材料。形はブロック |

<details className="hh-image-details">
  <summary>狩人の確認画像</summary>
  <div className="hh-shot-grid">
    <a href={useBaseUrl('/images/screenshots/characters/hunter-skill-archer.png')} target="_blank" rel="noreferrer"><img src={useBaseUrl('/images/screenshots/characters/hunter-skill-archer.png')} alt="狩人 スキル アーチャー" /></a>
    <a href={useBaseUrl('/images/screenshots/characters/hunter-wooden-bow.png')} target="_blank" rel="noreferrer"><img src={useBaseUrl('/images/screenshots/characters/hunter-wooden-bow.png')} alt="狩人 木弓" /></a>
    <a href={useBaseUrl('/images/screenshots/characters/hunter-stone-arrow.png')} target="_blank" rel="noreferrer"><img src={useBaseUrl('/images/screenshots/characters/hunter-stone-arrow.png')} alt="狩人 石の矢" /></a>
    <a href={useBaseUrl('/images/screenshots/characters/hunter-iron-arrow.png')} target="_blank" rel="noreferrer"><img src={useBaseUrl('/images/screenshots/characters/hunter-iron-arrow.png')} alt="狩人 鉄の矢" /></a>
    <a href={useBaseUrl('/images/screenshots/characters/hunter-combat-knife.png')} target="_blank" rel="noreferrer"><img src={useBaseUrl('/images/screenshots/characters/hunter-combat-knife.png')} alt="狩人 コンバットナイフ" /></a>
    <a href={useBaseUrl('/images/screenshots/characters/hunter-door-shield.png')} target="_blank" rel="noreferrer"><img src={useBaseUrl('/images/screenshots/characters/hunter-door-shield.png')} alt="狩人 ドアの盾" /></a>
    <a href={useBaseUrl('/images/screenshots/characters/hunter-broken-wooden-board.png')} target="_blank" rel="noreferrer"><img src={useBaseUrl('/images/screenshots/characters/hunter-broken-wooden-board.png')} alt="狩人 破損の木板" /></a>
  </div>
</details>

## スカベンジャー

<div className="hh-character-card">
  <a className="hh-character-main-shot" href={useBaseUrl('/images/screenshots/characters/scavenger-overview.png')} target="_blank" rel="noreferrer">
    <img src={useBaseUrl('/images/screenshots/characters/scavenger-overview.png')} alt="スカベンジャーのキャラクター選択画面" />
  </a>
  <div>
    <h3>物資集めに強いキャラ</h3>
    <p>スカベンジャーは探索と物資集めに向いたキャラクターです。水と食料を持って始められるため、序盤の生存が安定しやすいです。</p>
    <table>
      <tbody>
        <tr><th>スキル</th><td>スカベンジャー</td></tr>
        <tr><th>効果</th><td>戦利品の品質上限 +5、戦利品の数量 +30%</td></tr>
        <tr><th>向いている人</th><td>まず食料・水・素材を集めたい人</td></tr>
        <tr><th>情報状態</th><td><span className="status-confirmed">確認済み</span></td></tr>
      </tbody>
    </table>
  </div>
</div>

### スカベンジャーの初期装備

| アイテム | 数量 | 内容 |
| --- | ---: | --- |
| 石の斧 | 1 | 木や地形を破壊して資源を採取できる |
| ボトルウォーター | 10 | 水分 +50 |
| 麺の缶詰 | 10 | 満腹度 +40、水分 -5、HP +10 |
| コンバットナイフ | 1 | 近接武器。頭部ダメージ x4 |
| ドアの盾 | 1 | 装備品。身体部位を保護 |
| 破損の木板 | 60 | 建築材料。形はブロック |

<details className="hh-image-details">
  <summary>スカベンジャーの確認画像</summary>
  <div className="hh-shot-grid">
    <a href={useBaseUrl('/images/screenshots/characters/scavenger-skill.png')} target="_blank" rel="noreferrer"><img src={useBaseUrl('/images/screenshots/characters/scavenger-skill.png')} alt="スカベンジャー スキル" /></a>
    <a href={useBaseUrl('/images/screenshots/characters/scavenger-stone-axe.png')} target="_blank" rel="noreferrer"><img src={useBaseUrl('/images/screenshots/characters/scavenger-stone-axe.png')} alt="スカベンジャー 石の斧" /></a>
    <a href={useBaseUrl('/images/screenshots/characters/scavenger-bottled-water.png')} target="_blank" rel="noreferrer"><img src={useBaseUrl('/images/screenshots/characters/scavenger-bottled-water.png')} alt="スカベンジャー ボトルウォーター" /></a>
    <a href={useBaseUrl('/images/screenshots/characters/scavenger-canned-noodles.png')} target="_blank" rel="noreferrer"><img src={useBaseUrl('/images/screenshots/characters/scavenger-canned-noodles.png')} alt="スカベンジャー 麺の缶詰" /></a>
    <a href={useBaseUrl('/images/screenshots/characters/scavenger-combat-knife.png')} target="_blank" rel="noreferrer"><img src={useBaseUrl('/images/screenshots/characters/scavenger-combat-knife.png')} alt="スカベンジャー コンバットナイフ" /></a>
    <a href={useBaseUrl('/images/screenshots/characters/scavenger-door-shield.png')} target="_blank" rel="noreferrer"><img src={useBaseUrl('/images/screenshots/characters/scavenger-door-shield.png')} alt="スカベンジャー ドアの盾" /></a>
    <a href={useBaseUrl('/images/screenshots/characters/scavenger-broken-wooden-board.png')} target="_blank" rel="noreferrer"><img src={useBaseUrl('/images/screenshots/characters/scavenger-broken-wooden-board.png')} alt="スカベンジャー 破損の木板" /></a>
  </div>
</details>

## 整備士

<div className="hh-character-card">
  <a className="hh-character-main-shot" href={useBaseUrl('/images/screenshots/characters/mechanic-overview.png')} target="_blank" rel="noreferrer">
    <img src={useBaseUrl('/images/screenshots/characters/mechanic-overview.png')} alt="整備士のキャラクター選択画面" />
  </a>
  <div>
    <h3>車両作成に強いキャラ</h3>
    <p>整備士は序盤からビーグル部品を持って始められます。探索範囲を広げたい人や、車両クラフトをすぐ試したい人に向いています。</p>
    <table>
      <tbody>
        <tr><th>スキル</th><td>整備士</td></tr>
        <tr><th>効果</th><td>100m範囲内のビーグルが受ける全ダメージを50%軽減</td></tr>
        <tr><th>注意</th><td>この効果は重複しない</td></tr>
        <tr><th>情報状態</th><td><span className="status-confirmed">確認済み</span></td></tr>
      </tbody>
    </table>
  </div>
</div>

### 整備士の初期装備

| アイテム | 数量 | 内容 |
| --- | ---: | --- |
| クレーン | 1 | 地面に置き、上に車両部品を配置して車両を組み立てる |
| 運転席 | 1 | ビーグルの移動を制御する |
| ペダル発電機 | 1 | ペダル踏みでビーグル上の電動モーターエンジンに充電する |
| 車輪 | 6 | 乗り物の下部に取り付けると移動できるようになる |
| フレキシブルローター | 6 | 車両駆動メカニカルレッグの建造に使用 |
| 破損の木板 | 60 | 建築材料。形はブロック |
| コンバットナイフ | 1 | 近接武器。頭部ダメージ x4 |
| ドアの盾 | 1 | 装備品。身体部位を保護 |
| レーザートラップ | 1 | トラップダメージ300。味方を攻撃しない |

<details className="hh-image-details">
  <summary>整備士の確認画像</summary>
  <div className="hh-shot-grid">
    <a href={useBaseUrl('/images/screenshots/characters/mechanic-skill.png')} target="_blank" rel="noreferrer"><img src={useBaseUrl('/images/screenshots/characters/mechanic-skill.png')} alt="整備士 スキル" /></a>
    <a href={useBaseUrl('/images/screenshots/characters/mechanic-crane.png')} target="_blank" rel="noreferrer"><img src={useBaseUrl('/images/screenshots/characters/mechanic-crane.png')} alt="整備士 クレーン" /></a>
    <a href={useBaseUrl('/images/screenshots/characters/mechanic-driver-seat.png')} target="_blank" rel="noreferrer"><img src={useBaseUrl('/images/screenshots/characters/mechanic-driver-seat.png')} alt="整備士 運転席" /></a>
    <a href={useBaseUrl('/images/screenshots/characters/mechanic-pedal-generator.png')} target="_blank" rel="noreferrer"><img src={useBaseUrl('/images/screenshots/characters/mechanic-pedal-generator.png')} alt="整備士 ペダル発電機" /></a>
    <a href={useBaseUrl('/images/screenshots/characters/mechanic-wheel.png')} target="_blank" rel="noreferrer"><img src={useBaseUrl('/images/screenshots/characters/mechanic-wheel.png')} alt="整備士 車輪" /></a>
    <a href={useBaseUrl('/images/screenshots/characters/mechanic-flexible-rotor.png')} target="_blank" rel="noreferrer"><img src={useBaseUrl('/images/screenshots/characters/mechanic-flexible-rotor.png')} alt="整備士 フレキシブルローター" /></a>
    <a href={useBaseUrl('/images/screenshots/characters/mechanic-broken-wooden-board.png')} target="_blank" rel="noreferrer"><img src={useBaseUrl('/images/screenshots/characters/mechanic-broken-wooden-board.png')} alt="整備士 破損の木板" /></a>
    <a href={useBaseUrl('/images/screenshots/characters/mechanic-combat-knife.png')} target="_blank" rel="noreferrer"><img src={useBaseUrl('/images/screenshots/characters/mechanic-combat-knife.png')} alt="整備士 コンバットナイフ" /></a>
    <a href={useBaseUrl('/images/screenshots/characters/mechanic-door-shield.png')} target="_blank" rel="noreferrer"><img src={useBaseUrl('/images/screenshots/characters/mechanic-door-shield.png')} alt="整備士 ドアの盾" /></a>
    <a href={useBaseUrl('/images/screenshots/characters/mechanic-laser-trap.png')} target="_blank" rel="noreferrer"><img src={useBaseUrl('/images/screenshots/characters/mechanic-laser-trap.png')} alt="整備士 レーザートラップ" /></a>
  </div>
</details>

## 現時点の注意

- パラメーター差は、現時点では未確認です。
- アップデートで初期装備やスキル効果が変わる可能性があります。
- このページはゲーム内画像で確認できた情報を優先します。
