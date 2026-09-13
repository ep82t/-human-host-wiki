#!/usr/bin/env node
/**
 * run-tests.js
 * src/*.gs をGASスタブ環境で読み込み、19_tests.gs の runAllTests() を実行する。
 */
'use strict';
const { loadGasProject } = require('./load-gas.js');

const sandbox = loadGasProject();
const result = sandbox.runAllTests();

process.exit(result.failed === 0 ? 0 : 1);
