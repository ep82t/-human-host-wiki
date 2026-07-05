// ============================================================
// PeriodManager.gs — チラシ配布期間の管理
// ============================================================
//
// 【使い方】
//   1. GASエディタで archiveAndResetPeriod() を実行
//   2. 現在のエリアマスタをアーカイブシートにコピー
//   3. エリアマスタをリセットして新期間を開始
// ============================================================

/**
 * 現在の配布期間をアーカイブして新期間を開始する
 * GASエディタから手動実行してください
 *
 * @param {string} [newFlyerType] - 新しいチラシ種別（省略時は空白でスタート）
 */
function archiveAndResetPeriod(newFlyerType) {
  var ss = getSpreadsheet();
  var srcSheet = getSheet(SHEET_NAMES.AREA_MASTER);

  // アーカイブシート名: エリアマスタ_YYYYMM
  var label = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyyMM');
  var archiveName = 'エリアマスタ_' + label;

  // 既存アーカイブシートがあれば削除（上書き）
  var existing = ss.getSheetByName(archiveName);
  if (existing) {
    ss.deleteSheet(existing);
    Logger.log('既存アーカイブを削除: ' + archiveName);
  }

  // シートをコピーしてアーカイブ
  var archived = srcSheet.copyTo(ss);
  archived.setName(archiveName);
  Logger.log('✅ アーカイブ完了: ' + archiveName);

  // エリアマスタのステータス・配布データをリセット
  var lastRow = srcSheet.getLastRow();
  if (lastRow >= 2) {
    var rowCount = lastRow - 1;

    // ステータス → 未着手
    var statusRange = srcSheet.getRange(2, COL_AREA.STATUS, rowCount, 1);
    statusRange.setValue(STATUS.NOT_STARTED);

    // チラシ種別・配布枚数・実施者・実施日・メモ → 空白
    srcSheet.getRange(2, COL_AREA.FLYER_TYPE,  rowCount, 1).clearContent();
    srcSheet.getRange(2, COL_AREA.DIST_COUNT,  rowCount, 1).clearContent();
    srcSheet.getRange(2, COL_AREA.MEMBER_NAME, rowCount, 1).clearContent();
    srcSheet.getRange(2, COL_AREA.DIST_DATE,   rowCount, 1).clearContent();
    srcSheet.getRange(2, COL_AREA.MEMO,        rowCount, 1).clearContent();

    Logger.log('✅ エリアマスタリセット完了: ' + rowCount + '件');
  }

  // 新チラシ種別をスクリプトプロパティに保存（任意）
  if (newFlyerType) {
    var current = PropertiesService.getScriptProperties().getProperty('FLYER_TYPES') || '';
    var types = current ? current.split(',').map(function(s) { return s.trim(); }) : [];
    if (types.indexOf(newFlyerType) === -1) {
      types.unshift(newFlyerType); // 先頭に追加
      PropertiesService.getScriptProperties().setProperty('FLYER_TYPES', types.join(','));
      Logger.log('✅ チラシ種別に追加: ' + newFlyerType);
    }
  }

  Logger.log('=== 新期間開始準備完了 ===');
  Logger.log('アーカイブ: ' + archiveName);
  Logger.log('新チラシ: ' + (newFlyerType || '（未設定）'));
}

/**
 * アーカイブ済み期間の一覧を表示する
 */
function listArchivedPeriods() {
  var ss = getSpreadsheet();
  var sheets = ss.getSheets();
  Logger.log('=== アーカイブ済み期間 ===');
  var found = 0;
  sheets.forEach(function(s) {
    if (s.getName().indexOf('エリアマスタ_') === 0) {
      Logger.log('  ' + s.getName() + '（' + (s.getLastRow() - 1) + '件）');
      found++;
    }
  });
  if (found === 0) Logger.log('  （アーカイブなし）');
}
