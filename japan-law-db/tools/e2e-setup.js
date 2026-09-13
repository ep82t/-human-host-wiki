/**
 * e2e-setup.js
 * setup() を最初から最後まで実行し、Drive上に何が作られるかを確認する。
 * e-Gov APIはスタブに差し替える（実際のAPIへはアクセスしない）。
 */
'use strict';
const { loadGasProject } = require('./load-gas.js');
const s = loadGasProject();

// 設定された全法令に応答するスタブを作る
const laws = {};
s.getLawsConfig().forEach((law, i) => {
  laws[law.name] = {
    lawId: `TEST${String(i).padStart(3, '0')}AC0000000000`,
    lawNum: `令和六年法律第${i + 1}号`,
    lawType: { act: 'Act', cabinet_order: 'CabinetOrder',
               ministerial_ordinance: 'MinisterialOrdinance' }[law.expectedLawType]
  };
});
s.stubEgovApi_(laws);

const result = s.setup();

console.log('\n\n============ setup() 実行後のDrive構成 ============');
function walk(folder, depth) {
  const pad = '  '.repeat(depth);
  const fit = folder.getFolders();
  const subs = [];
  while (fit.hasNext()) subs.push(fit.next());
  const files = [];
  const fileIt = folder.getFiles();
  while (fileIt.hasNext()) files.push(fileIt.next());

  files.slice(0, 4).forEach(f => console.log(`${pad}  - ${f.getName()}`));
  if (files.length > 4) console.log(`${pad}  - ...他 ${files.length - 4} ファイル`);
  subs.forEach(sub => {
    console.log(`${pad}[${sub.getName()}]`);
    walk(sub, depth + 1);
  });
}
const root = s.DriveApp.getFolderById(result.root_folder_id);
console.log(`[${root.getName()}]`);
walk(root, 1);

console.log('\n============ 結果サマリ ============');
console.log('ルートフォルダ作成:', result.root_folder_created);
console.log('フォルダ数:', result.folder_count);
console.log('対象:', result.sync.target_count, '成功:', result.sync.success_count,
            '更新:', result.sync.updated_count, '失敗:', result.sync.failed_count);

// 2回目の setup() でフォルダが増えないことを確認
const before = s.DriveApp.getRootFolder().getFolders();
let rootCount = 0;
while (before.hasNext()) { before.next(); rootCount++; }
const result2 = s.setup();
const after = s.DriveApp.getRootFolder().getFolders();
let rootCount2 = 0;
while (after.hasNext()) { after.next(); rootCount2++; }
console.log('\n2回目 setup(): マイドライブ直下フォルダ数', rootCount, '→', rootCount2,
            rootCount === rootCount2 ? '(重複なし OK)' : '(重複あり NG)');
console.log('2回目 更新件数:', result2.sync.updated_count,
            '変更なし件数:', result2.sync.unchanged_count);
