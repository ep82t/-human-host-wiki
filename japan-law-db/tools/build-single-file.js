#!/usr/bin/env node
/**
 * build-single-file.js
 * src/*.gs を1つのファイルへ結合し、dist/日本法令データベース.gs を生成する。
 *
 * 目的
 * ----
 * Apps Scriptエディタへ20ファイルをコピペするのは負担が大きいため、
 * 貼り付け1回で済む配布用ファイルを用意する。
 *
 * 開発時のファイル分割（責務ごと）はそのまま維持し、
 * これはあくまで配布用の生成物である。src/ を編集したら再実行すること。
 *
 * GASでは全ファイルが同じグローバルスコープを共有するため、
 * ファイル名順に連結したものは分割時とまったく同じ動作になる。
 */
'use strict';
const fs = require('fs');
const path = require('path');

const SRC_DIR = path.join(__dirname, '..', 'src');
const DIST_DIR = path.join(__dirname, '..', 'dist');
const OUT_FILE = path.join(DIST_DIR, '日本法令データベース.gs');

const files = fs.readdirSync(SRC_DIR).filter(f => f.endsWith('.gs')).sort();

const header = `/**
 * =============================================================================
 *  日本税制・社会保険法令 自動収集／Google Drive保存システム
 *  （全ソースを1ファイルへ結合した配布用ファイル）
 * =============================================================================
 *
 *  このファイルは tools/build-single-file.js が自動生成したものです。
 *  直接編集せず、src/ 配下の各ファイルを編集して再生成してください。
 *
 *  生成元（${files.length}ファイル）:
${files.map(f => ` *    - ${f}`).join('\n')}
 *
 *  使い方
 *  ------
 *  1. Apps Scriptエディタで新しいスクリプトファイルを1つ作る
 *  2. このファイルの中身をすべて貼り付ける
 *  3. appsscript.json も別途貼り付ける（src/appsscript.json）
 *
 *  主な実行関数
 *  ------------
 *    verifyApiSpec()   API仕様を公式OpenAPI仕様書と照合する（最初に実行）
 *    setup()           初回セットアップ（フォルダ作成＋全法令の取得）
 *    syncLaws()        通常同期（改正された法令だけ更新）
 *    dryRunSync()      何も書き換えずに更新予定だけ確認
 *    installTrigger()  毎日の自動更新を設定
 *    removeTrigger()   自動更新を停止
 *    showStatus()      現在の状態を表示
 *    runAllTests()     テストを実行
 * =============================================================================
 */

`;

const parts = [header];
for (const file of files) {
  const code = fs.readFileSync(path.join(SRC_DIR, file), 'utf8');
  parts.push(
    '\n// ' + '='.repeat(75) + '\n' +
    '// ' + file + '\n' +
    '// ' + '='.repeat(75) + '\n\n' +
    code.replace(/\s+$/, '') + '\n'
  );
}

fs.mkdirSync(DIST_DIR, { recursive: true });
fs.writeFileSync(OUT_FILE, parts.join(''));

// appsscript.json も dist へコピーして、貼り付け対象をまとめる
fs.copyFileSync(
  path.join(SRC_DIR, 'appsscript.json'),
  path.join(DIST_DIR, 'appsscript.json')
);

const stat = fs.statSync(OUT_FILE);
const lines = fs.readFileSync(OUT_FILE, 'utf8').split('\n').length;
console.log(`生成しました: dist/日本法令データベース.gs`);
console.log(`  結合ファイル数: ${files.length}`);
console.log(`  行数          : ${lines.toLocaleString()}`);
console.log(`  サイズ        : ${(stat.size / 1024).toFixed(1)} KB`);
console.log(`  appsscript.json も dist/ へコピーしました`);
