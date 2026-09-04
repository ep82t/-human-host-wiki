/**
 * load-gas.js
 * src/*.gs を実際に読み込み、GASスタブ環境の中で評価する。
 * 「テスト用に書き直したコピー」ではなく本番コードそのものを検証する。
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { createGasEnvironment } = require('./gas-shim.js');

const SRC_DIR = path.join(__dirname, '..', 'src');

/**
 * すべての .gs を1つのグローバルスコープへ読み込む（GASと同じ挙動）。
 * @return {object} sandbox（全関数・全変数にアクセスできる）
 */
function loadGasProject() {
  const env = createGasEnvironment();
  const sandbox = Object.assign({}, env);
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);

  const files = fs.readdirSync(SRC_DIR)
    .filter(f => f.endsWith('.gs'))
    .sort();

  for (const file of files) {
    const code = fs.readFileSync(path.join(SRC_DIR, file), 'utf8');
    try {
      vm.runInContext(code, sandbox, { filename: file });
    } catch (e) {
      throw new Error(`${file} の読み込みに失敗: ${e.message}`);
    }
  }
  sandbox.__env = env;
  sandbox.__files = files;
  return sandbox;
}

module.exports = { loadGasProject, SRC_DIR };
