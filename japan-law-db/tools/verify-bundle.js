#!/usr/bin/env node
/**
 * verify-bundle.js
 * 生成された dist/japan-law-db.gs（結合済みの配布用ファイル）そのものを
 * GASスタブ環境で読み込み、テスト28件が通ることを確認する。
 *
 * 「分割版は動くが結合版は壊れている」という事態を防ぐための検証。
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { createGasEnvironment } = require('./gas-shim.js');

const BUNDLE = path.join(__dirname, '..', 'dist', 'japan-law-db.gs');
if (!fs.existsSync(BUNDLE)) {
  console.error('先に node build-single-file.js を実行してください。');
  process.exit(1);
}

const sandbox = Object.assign({}, createGasEnvironment());
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(BUNDLE, 'utf8'), sandbox, { filename: 'bundle.gs' });

console.log('=== 結合版ファイルに対するテスト ===\n');
const result = sandbox.runAllTests();
process.exit(result.failed === 0 ? 0 : 1);
