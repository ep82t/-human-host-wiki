// ============================================================
// HouseholdData.gs — 函館市 世帯数データ取得・投入
// データソース: https://www.posting-nihon.com/hokkaido/hakodateshi.html
// ============================================================

/**
 * 函館市の世帯数データを取得してエリアマスタに投入する
 * GASエディタから手動実行する
 * 実行前に setupSpreadsheet() が完了していること
 */
function importHakodateHouseholdData() {
  var url = 'https://www.posting-nihon.com/hokkaido/hakodateshi.html';
  Logger.log('データ取得開始: ' + url);

  var response;
  try {
    response = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  } catch (e) {
    throw new Error('URLへのアクセスに失敗しました: ' + e.message);
  }

  if (response.getResponseCode() !== 200) {
    throw new Error('HTTPエラー: ' + response.getResponseCode());
  }

  var html = response.getContentText('UTF-8');
  var rows = _parseHouseholdTable(html);

  if (rows.length === 0) {
    throw new Error('テーブルデータが取得できませんでした。ページ構造が変わった可能性があります。');
  }

  Logger.log('取得件数: ' + rows.length + ' 行');
  _writeToAreaMaster(rows);
  Logger.log('エリアマスタへの投入が完了しました。');
}

/**
 * HTMLから町丁目名・世帯数を抽出する
 * @param {string} html
 * @returns {Array} [{city, town, chome, households}]
 */
function _parseHouseholdTable(html) {
  var results = [];

  // <tr>...</tr> を全て抽出
  var trPattern = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  var tdPattern = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;
  var tagPattern = /<[^>]+>/g;

  var trMatch;
  var isFirstRow = true;

  while ((trMatch = trPattern.exec(html)) !== null) {
    var rowHtml = trMatch[1];
    var cells = [];
    var tdMatch;

    while ((tdMatch = tdPattern.exec(rowHtml)) !== null) {
      var text = tdMatch[1].replace(tagPattern, '').replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
      cells.push(text);
    }

    // ヘッダー行スキップ
    if (isFirstRow) {
      isFirstRow = false;
      continue;
    }

    // HTMLの列構成は2パターン:
    // 丁目なし(5列): [0]町名 [1]男性 [2]女性 [3]総数 [4]世帯数
    // 丁目あり(6列): [0]町名 [1]丁目 [2]男性 [3]女性 [4]総数 [5]世帯数
    var town, chome, householdsStr;
    if (cells.length === 6) {
      town          = cells[0];
      chome         = cells[1]; // 例: "1丁目"
      householdsStr = cells[5];
    } else if (cells.length === 5) {
      town          = cells[0];
      chome         = '';
      householdsStr = cells[4];
    } else {
      continue; // 想定外の列数はスキップ
    }

    if (!town) continue;

    // 数値でない行（ヘッダー等）をスキップ
    var households = parseInt(String(householdsStr).replace(/,/g, ''), 10);
    if (isNaN(households)) continue;

    results.push({
      city: '函館市',
      town: town,
      chome: chome,
      households: households
    });
  }

  return results;
}

/**
 * 町丁目名を「町名」と「丁目」に分割する
 * 例: "西旭岡町2丁目" → {town: "西旭岡町", chome: "2丁目"}
 * 例: "湯川町"         → {town: "湯川町",   chome: ""}
 */
function _parseTownName(townFull) {
  // 「○丁目」パターン
  var chomeMatch = townFull.match(/^(.+?)(\d+丁目)$/);
  if (chomeMatch) {
    return { town: chomeMatch[1], chome: chomeMatch[2] };
  }

  // 「第○」「字○」等のパターンは町名のまま
  return { town: townFull, chome: '' };
}

/**
 * 抽出データをエリアマスタシートに書き込む
 * 既存の函館市データを全削除してから再投入する
 */
function _writeToAreaMaster(rows) {
  var sheet = getSheet(SHEET_NAMES.AREA_MASTER);
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);

  try {
    // 既存の函館市データを削除（ヘッダー行 = 1行目は保持）
    var lastRow = sheet.getLastRow();
    if (lastRow > 1) {
      var existingData = sheet.getRange(2, COL_AREA.CITY, lastRow - 1, 1).getValues();
      // 函館市行を後ろから削除
      for (var i = existingData.length - 1; i >= 0; i--) {
        if (existingData[i][0] === '函館市') {
          sheet.deleteRow(i + 2); // +2: ヘッダー行 + 0始まり補正
        }
      }
    }

    // 新データを追記
    if (rows.length === 0) return;

    var writeData = rows.map(function(r) {
      return [
        r.city,          // 市町村名
        r.town,          // 町名
        r.chome,         // 丁目
        r.households,    // 世帯数
        STATUS.NOT_STARTED, // ステータス
        '',              // チラシ種別
        '',              // 配布枚数
        '',              // 実施者名
        '',              // 実施日
        ''               // メモ
      ];
    });

    var nextRow = sheet.getLastRow() + 1;
    sheet.getRange(nextRow, 1, writeData.length, writeData[0].length)
      .setValues(writeData);

    // 市町村名でソート（A列昇順）
    var dataRange = sheet.getDataRange();
    if (dataRange.getLastRow() > 1) {
      sheet.getRange(2, 1, dataRange.getLastRow() - 1, dataRange.getLastColumn())
        .sort(COL_AREA.CITY);
    }

  } finally {
    lock.releaseLock();
  }
}

/**
 * 七飯町のエリアをe-Stat境界データから登録する
 * （posting-nihon.comに七飯町ページがないため境界データを使用）
 */
function importNanaeHouseholdData() {
  _importFromBoundary('七飯町');
}

/**
 * 森町のエリアをe-Stat境界データから登録する
 * （r2ka01345.json が取得済みのため境界データを使用）
 */
function importMoriHouseholdData() {
  _importFromBoundary('森町');
}

/**
 * 木古内町のエリアをe-Stat境界データから登録する
 */
function importKikonaiHouseholdData() {
  _importFromBoundary('木古内町');
}

/** 北斗市の未登録エリアを境界データから追加 */
function addMissingAreas_Hokuto() {
  addMissingBoundaryAreas('北斗市');
}

/** 函館市の未登録エリアを境界データから追加 */
function addMissingAreas_Hakodate() {
  addMissingBoundaryAreas('函館市');
}

/**
 * 境界データに存在するがエリアマスタに未登録のエリアだけを追加する
 * 既存データは一切変更しない（安全）
 * @param {string} cityName 市町村名
 */
function addMissingBoundaryAreas(cityName) {
  var cached = _loadFromDrive(BOUNDARY_FILE_NAME);
  if (!cached) {
    Logger.log('❌ 境界データなし。importEStatBoundary() を先に実行してください。');
    return;
  }
  var geojson = JSON.parse(cached);

  // 現在のエリアマスタを取得してキーセット作成
  var sheet = getSheet(SHEET_NAMES.AREA_MASTER);
  var lastRow = sheet.getLastRow();
  var existingKeys = {};
  if (lastRow > 1) {
    var data = sheet.getRange(2, COL_AREA.CITY, lastRow - 1, 3).getValues();
    data.forEach(function(r) {
      if (r[0] === cityName) existingKeys[String(r[1]) + String(r[2] || '')] = true;
    });
  }
  Logger.log(cityName + ' 既存: ' + Object.keys(existingKeys).length + '件');

  // 境界データから未登録分を抽出
  var newRows = [];
  (geojson.features || []).forEach(function(f) {
    var props = f.properties;
    if (props.cityName !== cityName) return;
    var name = props.name || '';
    name = name.replace(/^大字/, '').replace(/^字/, '').trim();
    // 漢数字丁目をアラビア数字に変換
    name = name.replace(/([一二三四五六七八九]|十[一二三四五六七八九]?)丁目/g, function(m, k) {
      var map = {'一':'1','二':'2','三':'3','四':'4','五':'5','六':'6','七':'7','八':'8','九':'9'};
      if (k === '十') return '10丁目';
      if (k.length === 2 && k[0] === '十') return '1' + (map[k[1]] || '') + '丁目';
      return (map[k] || k) + '丁目';
    });
    // 非居住エリアを除外
    if (name.indexOf('水面調査区') !== -1) return;
    var chomeMatch = name.match(/^(.+?)(\d+丁目)$/);
    var town = chomeMatch ? chomeMatch[1] : name;
    var chome = chomeMatch ? chomeMatch[2] : '';
    if (!town) return;
    var key = town + chome;
    if (!existingKeys[key]) {
      newRows.push({ city: cityName, town: town, chome: chome, households: 0 });
      existingKeys[key] = true; // 重複防止
    }
  });

  if (newRows.length === 0) {
    Logger.log('✅ ' + cityName + ': 追加すべき未登録エリアなし');
    return;
  }

  // 既存データを消さず末尾に追加
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var writeData = newRows.map(function(r) {
      return [r.city, r.town, r.chome, r.households, STATUS.NOT_STARTED, '', '', '', '', ''];
    });
    var nextRow = sheet.getLastRow() + 1;
    sheet.getRange(nextRow, 1, writeData.length, writeData[0].length).setValues(writeData);
    Logger.log('✅ ' + cityName + ': ' + newRows.length + '件追加');
    newRows.forEach(function(r) { Logger.log('  + ' + r.town + r.chome); });
  } finally {
    lock.releaseLock();
  }
}

/**
 * 境界データから指定市町村のエリアをインポートする共通関数
 */
function _importFromBoundary(cityName) {
  var cached = _loadFromDrive(BOUNDARY_FILE_NAME);
  if (!cached) {
    Logger.log('❌ 境界データなし。importEStatBoundary() を先に実行してください。');
    return;
  }
  var geojson = JSON.parse(cached);
  var rows = [];
  (geojson.features || []).forEach(function(f) {
    var props = f.properties;
    if (props.cityName !== cityName) return;
    var name = props.name || '';
    // 字/大字プレフィックスを除去・漢数字→アラビア数字変換
    name = name.replace(/^大字/, '').replace(/^字/, '').trim();
    name = _kanjiChomeToArabic(name);
    var chomeMatch = name.match(/^(.+?)(\d+丁目)$/);
    var town, chome;
    if (chomeMatch) { town = chomeMatch[1]; chome = chomeMatch[2]; }
    else             { town = name;          chome = ''; }
    if (!town) return;
    var households = parseInt(props.households || 0, 10) || 0;
    rows.push({ city: cityName, town: town, chome: chome, households: households });
  });
  if (rows.length === 0) {
    Logger.log('❌ 境界データに ' + cityName + ' が見つかりません。');
    return;
  }
  _writeToAreaMasterForCity(cityName, rows);
  var totalHouseholds = rows.reduce(function(s, r) { return s + (r.households || 0); }, 0);
  Logger.log('✅ ' + cityName + ': ' + rows.length + '件追加完了（世帯数合計: ' + totalHouseholds + '）');
}

/**
 * エリアマスタの指定市町村のデータ名を確認する診断関数
 */
function debugNanaeAndMoriAreas() {
  debugCityAreas('七飯町');
  debugCityAreas('森町');
}

function debugHokutoAreas() {
  debugCityAreas('北斗市');
}

function debugCityAreas(cityName) {
  var sheet = getSheet(SHEET_NAMES.AREA_MASTER);
  var lastRow = sheet.getLastRow();
  var data = sheet.getRange(2, 1, lastRow - 1, 3).getValues();
  var entries = data.filter(function(r) { return r[0] === cityName; });
  Logger.log('=== ' + cityName + ' (' + entries.length + '件) ===');
  entries.forEach(function(r) {
    Logger.log('  [' + r[1] + '] [' + r[2] + ']');
  });
}

/**
 * 北斗市の世帯数データを取得してエリアマスタに投入する
 */
function importHokutoHouseholdData() {
  var url = 'https://www.posting-nihon.com/hokkaido/hokutoshi.html';
  Logger.log('データ取得開始: ' + url);
  var response = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  if (response.getResponseCode() !== 200) {
    throw new Error('HTTPエラー: ' + response.getResponseCode());
  }
  var rows = _parseHouseholdTableForCity(response.getContentText('UTF-8'), '北斗市');
  if (rows.length === 0) throw new Error('データが取得できませんでした。');
  Logger.log('取得件数: ' + rows.length + ' 行');
  _writeToAreaMasterForCity('北斗市', rows);
  Logger.log('北斗市 エリアマスタ投入完了');
}

/**
 * 指定市町村のHTMLを解析して世帯数データを返す
 */
function _parseHouseholdTableForCity(html, cityName) {
  var results = [];
  var trPattern = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  var tdPattern = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;
  var tagPattern = /<[^>]+>/g;
  var isFirstRow = true;
  var trMatch;
  while ((trMatch = trPattern.exec(html)) !== null) {
    var rowHtml = trMatch[1];
    var cells = [];
    var tdMatch;
    while ((tdMatch = tdPattern.exec(rowHtml)) !== null) {
      var text = tdMatch[1].replace(tagPattern, '').replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
      cells.push(text);
    }
    if (isFirstRow) { isFirstRow = false; continue; }
    var town, chome, householdsStr;
    if (cells.length === 6) {
      town = cells[0]; chome = cells[1]; householdsStr = cells[5];
    } else if (cells.length === 5) {
      town = cells[0]; chome = ''; householdsStr = cells[4];
    } else { continue; }
    if (!town) continue;
    var households = parseInt(String(householdsStr).replace(/,/g, ''), 10);
    if (isNaN(households)) continue;
    results.push({ city: cityName, town: town, chome: chome, households: households });
  }
  return results;
}

/**
 * 指定市町村のエリアマスタデータを削除して新データを投入する
 */
function _writeToAreaMasterForCity(cityName, rows) {
  var sheet = getSheet(SHEET_NAMES.AREA_MASTER);
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var lastRow = sheet.getLastRow();
    if (lastRow > 1) {
      var existingData = sheet.getRange(2, COL_AREA.CITY, lastRow - 1, 1).getValues();
      for (var i = existingData.length - 1; i >= 0; i--) {
        if (existingData[i][0] === cityName) sheet.deleteRow(i + 2);
      }
    }
    if (rows.length === 0) return;
    var writeData = rows.map(function(r) {
      return [r.city, r.town, r.chome, r.households, STATUS.NOT_STARTED, '', '', '', '', ''];
    });
    var nextRow = sheet.getLastRow() + 1;
    sheet.getRange(nextRow, 1, writeData.length, writeData[0].length).setValues(writeData);
    Logger.log(cityName + ': ' + rows.length + '件追加完了');
  } finally {
    lock.releaseLock();
  }
}

/**
 * 七飯町・北斗市のデータを手動で一括追加するためのサンプル関数
 */
function addManualAreaData(cityName, areaList) {
  var rows = areaList.map(function(a) {
    return { city: cityName, town: a.town, chome: a.chome || '', households: a.households || 0 };
  });
  _writeToAreaMasterForCity(cityName, rows);
  Logger.log(cityName + ' のデータを ' + rows.length + ' 件追加しました。');
}
