// ============================================================
// AreaMaster.gs — エリアマスタ CRUD
// ============================================================

/**
 * エリアマスタの全データを取得する
 * @param {string} [cityFilter] - 市町村名フィルター（省略時は全件）
 * @returns {Array} エリアオブジェクトの配列
 */
function getAreaList(cityFilter) {
  var sheet = getSheet(SHEET_NAMES.AREA_MASTER);
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];

  var data = sheet.getRange(2, 1, lastRow - 1, 12).getValues();
  var results = [];

  for (var i = 0; i < data.length; i++) {
    var row = data[i];
    if (!row[COL_AREA.CITY - 1]) continue; // 空行スキップ

    var city = row[COL_AREA.CITY - 1];
    if (cityFilter && city !== cityFilter) continue;

    results.push(_rowToArea(row, i + 2));
  }

  return results;
}

/**
 * チラシ専用シートがあればそこからエリア一覧を取得し、なければエリアマスタにフォールバック
 * @param {string|null} flyerName - チラシ種別名（null or '' → エリアマスタを使用）
 * @param {string|null} cityFilter
 * @returns {Array}
 */
function getAreaListForFlyer(flyerName, cityFilter) {
  if (flyerName) {
    // ── チラシ選択あり：チラシSSからデータを返す ──────────────
    var flyerResult = getAreaListFromFlyerSs(flyerName, cityFilter);
    if (flyerResult !== null) {
      return flyerResult;  // SS あり（空配列でもそのまま返す）
    }

    // チラシSSが未作成 → 自動作成してから返す
    Logger.log('チラシSS未作成のため自動作成: ' + flyerName);
    var created = createFlyerSpreadsheet(flyerName);
    if (created.success) {
      migrateAndDeleteOldFlyerSheet(flyerName);
      var newResult = getAreaListFromFlyerSs(flyerName, cityFilter);
      if (newResult !== null) return newResult;
    }
    Logger.log('SS自動作成失敗 → エリアマスタ構造のみ返す: ' + flyerName);
  }

  // ── チラシ未選択（「チラシを選択」状態）：リセット状態で返す ──
  // エリアの構造（住所・世帯数・緯度経度）だけ返し、配布データはすべてリセット
  var sheet = getSheet(SHEET_NAMES.AREA_MASTER);
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];

  var data = sheet.getRange(2, 1, lastRow - 1, 12).getValues();
  var results = [];
  for (var i = 0; i < data.length; i++) {
    var row = data[i];
    if (!row[COL_AREA.CITY - 1]) continue;
    if (cityFilter && row[COL_AREA.CITY - 1] !== cityFilter) continue;

    var town  = String(row[COL_AREA.TOWN  - 1] || '');
    var chome = String(row[COL_AREA.CHOME - 1] || '');
    results.push({
      rowIndex:   i + 2,
      city:       row[COL_AREA.CITY - 1],
      town:       town,
      chome:      chome,
      fullName:   town + chome,
      households: row[COL_AREA.HOUSEHOLDS - 1],
      status:     STATUS.NOT_STARTED,  // 常に未着手
      flyerType:  '',
      distCount:  0,
      memberName: '',
      distDate:   '',
      memo:       '',
      lat:        row[COL_AREA.LAT - 1] || null,
      lng:        row[COL_AREA.LNG - 1] || null
    });
  }
  return results;
}

/**
 * エリアマスタの集計情報を取得する
 * @param {string} [cityFilter]
 * @returns {Object} {total, done, skipped, revisit, notStarted, totalDist}
 */
function getAreaSummary(cityFilter) {
  var areas = getAreaList(cityFilter);
  var summary = {
    total: areas.length,
    done: 0,
    skipped: 0,
    revisit: 0,
    notStarted: 0,
    totalDistCount: 0
  };

  areas.forEach(function(a) {
    switch (a.status) {
      case STATUS.DONE:        summary.done++;        break;
      case STATUS.SKIPPED:     summary.skipped++;     break;
      case STATUS.REVISIT:     summary.revisit++;     break;
      case STATUS.NOT_STARTED: summary.notStarted++;  break;
    }
    summary.totalDistCount += (a.distCount || 0);
  });

  return summary;
}

/**
 * エリアのステータス・チラシ種別・配布枚数・実施者・メモを更新する
 * @param {Object} params
 * @param {string} params.city
 * @param {string} params.town
 * @param {string} params.chome
 * @param {string} params.status
 * @param {string} [params.flyerType]
 * @param {number} [params.distCount]
 * @param {string} [params.memberName]
 * @param {string} [params.distDate]
 * @param {string} [params.memo]
 * @returns {boolean} 成功時 true
 */
function updateArea(params) {
  var sheet = getSheet(SHEET_NAMES.AREA_MASTER);
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);

  try {
    var rowIndex = _findAreaRow(sheet, params.city, params.town, params.chome);
    if (rowIndex === -1) {
      return { success: false, error: 'エリアが見つかりません: ' + params.city + ' ' + params.town + params.chome };
    }

    if (params.status)     sheet.getRange(rowIndex, COL_AREA.STATUS).setValue(params.status);
    if (params.flyerType)  sheet.getRange(rowIndex, COL_AREA.FLYER_TYPE).setValue(params.flyerType);
    if (params.distCount != null) {
      if (params.accumulate) {
        // 累積加算モード（Chatwork自動記録で使用）
        var existing = parseInt(sheet.getRange(rowIndex, COL_AREA.DIST_COUNT).getValue() || 0, 10);
        sheet.getRange(rowIndex, COL_AREA.DIST_COUNT).setValue((existing || 0) + params.distCount);
      } else {
        sheet.getRange(rowIndex, COL_AREA.DIST_COUNT).setValue(params.distCount);
      }
    }
    if (params.memberName) sheet.getRange(rowIndex, COL_AREA.MEMBER_NAME).setValue(params.memberName);
    if (params.distDate)   sheet.getRange(rowIndex, COL_AREA.DIST_DATE).setValue(params.distDate);
    if (params.memo != null) sheet.getRange(rowIndex, COL_AREA.MEMO).setValue(params.memo);

    return { success: true };
  } finally {
    lock.releaseLock();
  }
}

/**
 * エリアを新規追加する（七飯・北斗など後から追加する用途）
 */
function addArea(params) {
  var sheet = getSheet(SHEET_NAMES.AREA_MASTER);
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);

  try {
    var nextRow = sheet.getLastRow() + 1;
    sheet.getRange(nextRow, 1, 1, 10).setValues([[
      params.city || '',
      params.town || '',
      params.chome || '',
      params.households || 0,
      params.status || STATUS.NOT_STARTED,
      params.flyerType || '',
      params.distCount || '',
      params.memberName || '',
      params.distDate || '',
      params.memo || ''
    ]]);
    return { success: true, row: nextRow };
  } finally {
    lock.releaseLock();
  }
}

// ------------------------------------------------------------
// 内部ヘルパー
// ------------------------------------------------------------

function _rowToArea(row, rowIndex) {
  var town  = String(row[COL_AREA.TOWN  - 1] || '');
  var chome = String(row[COL_AREA.CHOME - 1] || '');
  return {
    rowIndex:   rowIndex,
    city:       row[COL_AREA.CITY - 1],
    town:       town,
    chome:      chome,
    fullName:   town + chome,
    households: row[COL_AREA.HOUSEHOLDS - 1],
    status:     row[COL_AREA.STATUS - 1] || STATUS.NOT_STARTED,
    flyerType:  row[COL_AREA.FLYER_TYPE - 1],
    distCount:  row[COL_AREA.DIST_COUNT - 1],
    memberName: row[COL_AREA.MEMBER_NAME - 1],
    distDate:   row[COL_AREA.DIST_DATE - 1]
      ? Utilities.formatDate(new Date(row[COL_AREA.DIST_DATE - 1]), 'Asia/Tokyo', 'yyyy-MM-dd')
      : '',
    memo:       row[COL_AREA.MEMO - 1],
    lat:        row[COL_AREA.LAT - 1] || null,
    lng:        row[COL_AREA.LNG - 1] || null
  };
}

/**
 * 全エリアをジオコーディングして緯度経度をシートに保存する
 * GASエディタから手動実行 (1回だけ)
 * Maps API の無料枠: 40,000リクエスト/月
 */
function geocodeAllAreas() {
  var sheet = getSheet(SHEET_NAMES.AREA_MASTER);
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return;

  var data = sheet.getRange(2, 1, lastRow - 1, 12).getValues();
  var geocoder = Maps.newGeocoder().setLanguage('ja').setRegion('JP');
  var updated = 0;
  var skipped = 0;

  for (var i = 0; i < data.length; i++) {
    var row = data[i];
    if (!row[COL_AREA.CITY - 1]) continue;

    // 既に座標がある場合はスキップ
    if (row[COL_AREA.LAT - 1] && row[COL_AREA.LNG - 1]) {
      skipped++;
      continue;
    }

    var town  = String(row[COL_AREA.TOWN  - 1] || '');
    var chome = String(row[COL_AREA.CHOME - 1] || '');
    var city  = String(row[COL_AREA.CITY  - 1] || '');
    var address = city + town + chome;

    try {
      var result = geocoder.geocode(address);
      if (result.status === 'OK' && result.results.length > 0) {
        var loc = result.results[0].geometry.location;
        sheet.getRange(i + 2, COL_AREA.LAT).setValue(loc.lat);
        sheet.getRange(i + 2, COL_AREA.LNG).setValue(loc.lng);
        updated++;
      }
    } catch(e) {
      Logger.log('ジオコーディング失敗: ' + address + ' / ' + e.message);
    }

    // 10件ごとに1秒待機（レート制限対策）
    if (updated % 10 === 0 && updated > 0) {
      Utilities.sleep(1000);
    }
  }

  Logger.log('ジオコーディング完了: 取得=' + updated + '件 / スキップ=' + skipped + '件');
}

/**
 * 市町村名・町名・丁目でエリア行を探す
 * @returns {number} 行番号（1始まり）、見つからない場合は -1
 */
/**
 * 漢数字→アラビア数字変換（丁目用）
 */
function _kanjiChomeToArabic(name) {
  if (!name) return '';
  var map = {'一':'1','二':'2','三':'3','四':'4','五':'5',
             '六':'6','七':'7','八':'8','九':'9'};
  return String(name).replace(/([一二三四五六七八九]|十[一二三四五六七八九]?)丁目/g, function(m, k) {
    if (k === '十') return '10丁目';
    if (k.length === 2 && k[0] === '十') return '1' + (map[k[1]] || '') + '丁目';
    return (map[k] || k) + '丁目';
  });
}

/**
 * 町名を正規化する（字/大字プレフィックス除去・漢数字変換）
 */
function _normalizeTownName(name) {
  if (!name) return '';
  var n = String(name)
    .replace(/^大字/, '')
    .replace(/^字/, '')
    .trim();
  return _kanjiChomeToArabic(n);
}

function _findAreaRow(sheet, city, town, chome) {
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return -1;

  var data = sheet.getRange(2, 1, lastRow - 1, 3).getValues();
  var chomeStr  = String(chome || '');
  var townNorm  = _normalizeTownName(town);

  // ① 完全一致（正規化あり）
  for (var i = 0; i < data.length; i++) {
    var rowTown = _normalizeTownName(String(data[i][1] || ''));
    if (data[i][0] === city &&
        rowTown === townNorm &&
        String(data[i][2]) === chomeStr) {
      return i + 2;
    }
  }

  // ② town+chome を結合した形でマスタに入っている場合
  if (chomeStr) {
    var combined = townNorm + chomeStr;
    for (var i = 0; i < data.length; i++) {
      var rowTown = _normalizeTownName(String(data[i][1] || ''));
      if (data[i][0] === city &&
          rowTown === combined &&
          String(data[i][2]) === '') {
        return i + 2;
      }
    }
  }

  // ③ town部分一致（chomeを無視）
  var partialMatch = -1;
  for (var i = 0; i < data.length; i++) {
    var rowTown = _normalizeTownName(String(data[i][1] || ''));
    if (data[i][0] === city && rowTown === townNorm) {
      if (partialMatch === -1) partialMatch = i + 2;
    }
  }
  if (partialMatch !== -1) {
    Logger.log('部分一致: ' + city + ' ' + town + ' → row ' + partialMatch);
    return partialMatch;
  }

  // ④ エリアマスタの town が「本町一丁目」のように丁目込みで保存されている場合
  //    → 検索キーが town のプレフィックスと一致するか確認
  var prefixMatch = -1;
  for (var i = 0; i < data.length; i++) {
    if (data[i][0] !== city) continue;
    var rowFull = _normalizeTownName(String(data[i][1] || '') + String(data[i][2] || ''));
    var searchFull = townNorm + chomeStr;
    if (rowFull === searchFull) { return i + 2; }
    // 丁目なし報告に対してプレフィックス一致
    if (!chomeStr && rowFull.indexOf(townNorm) === 0) {
      if (prefixMatch === -1) prefixMatch = i + 2;
    }
  }
  if (prefixMatch !== -1) {
    Logger.log('プレフィックス一致: ' + city + ' ' + town + ' → row ' + prefixMatch);
    return prefixMatch;
  }

  return -1;
}

// ============================================================
// エリアマスタ データ修正ユーティリティ
// ============================================================

/**
 * 赤川の重複エントリを完全修正する（エリアマスタ＋全チラシSS）
 * ・「赤川」（丁目なし、データなし）を削除
 * ・「赤川1丁目」（データあり）を残す
 * ・削除後、マップの「赤川」境界は自動的に「赤川1丁目」にリンクされる
 * GASエディタから実行: fixAkagawaFull()
 * ファイル: AreaMaster.gs
 */
function fixAkagawaFull() {
  Logger.log('=== 赤川 重複修正（エリアマスタ + 全チラシSS）===');

  _fixAkagawaInSheet('エリアマスタ', getSheet(SHEET_NAMES.AREA_MASTER));

  try {
    var map = _getFlyerSsMap();
    Object.keys(map).forEach(function(flyerName) {
      var sheet = _getFlyerSheet(flyerName, 'エリア');
      if (sheet) _fixAkagawaInSheet(flyerName, sheet);
    });
  } catch(e) {
    Logger.log('⚠️ チラシSS修正エラー: ' + e.message);
  }

  Logger.log('=== 修正完了 ===');
  Logger.log('マップを開き直すと「赤川」の重複が消えているはずです');
}

/**
 * 指定シートの赤川重複を修正する共通処理
 * 「赤川」（丁目なし）と「赤川1丁目」が共存している場合、丁目なしを削除する
 */
function _fixAkagawaInSheet(label, sheet) {
  if (!sheet) return;
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return;

  var data = sheet.getRange(2, 1, lastRow - 1, 10).getValues();

  // 赤川に関連する全エントリを収集（赤川町は除外）
  var entries = [];
  data.forEach(function(row, i) {
    var city      = String(row[0] || '').trim();
    var town      = String(row[1] || '').trim();
    var chome     = String(row[2] || '').trim();
    var status    = String(row[4] || '').trim();
    var distCount = parseInt(row[6], 10) || 0;
    var combined  = town + chome; // 例: "赤川1丁目" or "赤川"

    if (city !== '函館市') return;
    if (town === '赤川町') return; // 赤川町は別エリアなので除外
    // town="赤川"（丁目あり・なし両方）を対象
    if (town !== '赤川' && town !== '赤川1丁目') return;

    var hasData = distCount > 0 || (status !== '' && status !== '未着手' && status !== STATUS.NOT_STARTED);
    entries.push({
      rowNum:    i + 2,
      town:      town,
      chome:     chome,
      combined:  combined,
      distCount: distCount,
      status:    status,
      hasData:   hasData
    });
  });

  if (entries.length === 0) {
    return; // 赤川エントリなし（このシートは対象外）
  }

  Logger.log('[' + label + '] 赤川エントリ:');
  entries.forEach(function(e) {
    Logger.log('  行' + e.rowNum + ': combined=[' + e.combined + '] status=' + e.status + ' count=' + e.distCount + ' hasData=' + e.hasData);
  });

  // 「赤川1丁目」相当のエントリ（データあり or 丁目あり）
  var with1Chome = entries.filter(function(e) {
    return e.combined === '赤川1丁目';
  });

  // 「赤川」丁目なしエントリ
  var noChome = entries.filter(function(e) {
    return e.combined === '赤川';
  });

  if (with1Chome.length > 0 && noChome.length > 0) {
    // 「赤川1丁目」あり かつ 「赤川」(丁目なし)あり → 丁目なしを削除
    var toDelete = noChome
      .filter(function(e) { return !e.hasData; }) // データなしのみ削除
      .map(function(e) { return e.rowNum; })
      .sort(function(a, b) { return b - a; }); // 逆順（行番号ズレ防止）

    toDelete.forEach(function(rowNum) {
      sheet.deleteRow(rowNum);
      Logger.log('✅ [' + label + '] 行' + rowNum + ' 削除: 赤川（丁目なし・データなし）');
    });

    // データありの丁目なし行は警告のみ（自動削除しない）
    noChome.filter(function(e) { return e.hasData; }).forEach(function(e) {
      Logger.log('⚠️ [' + label + '] 行' + e.rowNum + ' データあり（count=' + e.distCount + '）→ 手動確認してください');
    });

    if (toDelete.length === 0) {
      Logger.log('  [' + label + ']: 削除対象なし');
    }

  } else if (with1Chome.length === 0 && noChome.length > 0) {
    // 「赤川1丁目」なし → 「赤川」を「1丁目」に補完
    noChome.forEach(function(e) {
      sheet.getRange(e.rowNum, COL_AREA.CHOME).setValue('1丁目');
      Logger.log('✅ [' + label + '] 行' + e.rowNum + ' 更新: 赤川 → 赤川 1丁目');
    });

  } else {
    Logger.log('  [' + label + ']: 既に正常');
  }
}

/**
 * @deprecated fixAkagawaFull() を使用してください
 */
function fixAkagawa1Chome() {
  Logger.log('⚠️ この関数は廃止されました。fixAkagawaFull() を実行してください。');
  fixAkagawaFull();
}

/**
 * 【読み取り専用・診断】赤川の現状を全シート＋マップ境界データで確認する
 * 何も変更しません。ログをそのままコピーして報告してください。
 * GASエディタから実行: diagnoseAkagawa()
 * ファイル: AreaMaster.gs
 */
function diagnoseAkagawa() {
  Logger.log('========== 赤川 診断（読み取り専用）==========');

  // ① マップ境界データ（GeoJSON）の赤川ポリゴン
  Logger.log('--- ① マップ境界データ（GeoJSON）---');
  try {
    var raw = _loadFromDrive(BOUNDARY_FILE_NAME);
    if (!raw) {
      Logger.log('  ❌ 境界ファイルなし: ' + BOUNDARY_FILE_NAME);
    } else {
      var gj = JSON.parse(raw);
      var hits = (gj.features || []).filter(function(f) {
        var p = f.properties || {};
        return (p.normalizedName || '').indexOf('赤川') !== -1
            && (p.cityName || '') === '函館市';
      });
      Logger.log('  函館市・赤川系ポリゴン数: ' + hits.length);
      hits.forEach(function(f) {
        var p = f.properties || {};
        Logger.log('   ・name=[' + p.name + '] normalizedName=[' + p.normalizedName + '] 世帯=' + (p.households||0));
      });
    }
  } catch(e) {
    Logger.log('  ⚠️ 境界データ読み取りエラー: ' + e.message);
  }

  // ② エリアマスタの赤川行
  Logger.log('--- ② エリアマスタ ---');
  _dumpAkagawaRows('エリアマスタ', getSheet(SHEET_NAMES.AREA_MASTER));

  // ③ 全チラシSSの赤川行
  Logger.log('--- ③ 各チラシSS（エリアシート）---');
  try {
    var map = _getFlyerSsMap();
    var names = Object.keys(map);
    if (names.length === 0) Logger.log('  チラシSSなし');
    names.forEach(function(flyerName) {
      var sheet = _getFlyerSheet(flyerName, 'エリア');
      if (!sheet) { Logger.log('  [' + flyerName + '] エリアシートなし'); return; }
      _dumpAkagawaRows(flyerName, sheet);
    });
  } catch(e) {
    Logger.log('  ⚠️ チラシSS読み取りエラー: ' + e.message);
  }

  Logger.log('========== 診断完了（変更なし）==========');
}

/**
 * 赤川の重複行を削除する（住宅地「赤川」系の重複を統合）
 * ・town=赤川（赤川町以外）の行が複数ある場合、データ量が最大の行を「keeper」とする
 * ・keeper の chome を「1丁目」に統一
 * ・データのない重複行を削除する（データのある重複は警告のみ・手動確認）
 * エリアマスタ＋全チラシSSに適用
 * GASエディタから実行: fixAkagawaDuplicates()
 * ファイル: AreaMaster.gs
 */
function fixAkagawaDuplicates() {
  Logger.log('========== 赤川 重複削除 ==========');
  _dedupeAkagawaInSheet('エリアマスタ', getSheet(SHEET_NAMES.AREA_MASTER));
  try {
    var map = _getFlyerSsMap();
    Object.keys(map).forEach(function(flyerName) {
      var sheet = _getFlyerSheet(flyerName, 'エリア');
      if (sheet) _dedupeAkagawaInSheet(flyerName, sheet);
    });
  } catch(e) {
    Logger.log('⚠️ チラシSS処理エラー: ' + e.message);
  }
  Logger.log('========== 完了。マップを開き直してください ==========');
}

/** fixAkagawaDuplicates 用：1シートの住宅地「赤川」重複を統合・削除する */
function _dedupeAkagawaInSheet(label, sheet) {
  if (!sheet) return;
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return;

  var data = sheet.getRange(2, 1, lastRow - 1, 10).getValues();

  // 住宅地「赤川」（赤川町を除く town=赤川）の行を収集
  var entries = [];
  data.forEach(function(row, i) {
    var city = String(row[0] || '').trim();
    var town = String(row[1] || '').trim();
    if (city !== '函館市') return;
    if (town === '赤川町') return;       // 赤川町は別エリア
    if (town !== '赤川') return;         // 住宅地「赤川」のみ対象
    var chome     = String(row[2] || '').trim();
    var house     = parseInt(row[3], 10) || 0;
    var status    = String(row[4] || '').trim();
    var distCount = parseInt(row[6], 10) || 0;
    var member    = String(row[7] || '').trim();
    // データ量スコア（大きいほど残すべき行）
    var score = distCount * 1000
              + (house > 0 ? 100 : 0)
              + (member ? 50 : 0)
              + (status && status !== '未着手' && status !== STATUS.NOT_STARTED ? 10 : 0);
    entries.push({ rowNum: i + 2, chome: chome, score: score, distCount: distCount, house: house });
  });

  if (entries.length === 0) { Logger.log('  [' + label + '] 対象なし'); return; }
  if (entries.length === 1) {
    // 単一行 → chome を「1丁目」に統一するだけ
    var e0 = entries[0];
    if (e0.chome !== '1丁目') {
      sheet.getRange(e0.rowNum, COL_AREA.CHOME).setValue('1丁目');
      Logger.log('  ✅ [' + label + '] 行' + e0.rowNum + ' chome→1丁目 に統一');
    } else {
      Logger.log('  [' + label + '] 既に正常（赤川1丁目 単一）');
    }
    return;
  }

  // 複数行 → スコア最大を keeper に
  entries.sort(function(a, b) { return b.score - a.score; });
  var keeper = entries[0];
  if (keeper.chome !== '1丁目') {
    sheet.getRange(keeper.rowNum, COL_AREA.CHOME).setValue('1丁目');
    Logger.log('  ✅ [' + label + '] 行' + keeper.rowNum + ' を残す（chome→1丁目 統一）');
  } else {
    Logger.log('  ・[' + label + '] 行' + keeper.rowNum + ' を残す（赤川1丁目, 枚数=' + keeper.distCount + '）');
  }

  // keeper 以外を削除（データありは警告のみ）
  var toDelete = [];
  entries.slice(1).forEach(function(e) {
    if (e.score === 0) {
      toDelete.push(e.rowNum);
    } else {
      Logger.log('  ⚠️ [' + label + '] 行' + e.rowNum + ' はデータあり（枚数=' + e.distCount + ', 世帯=' + e.house + '）→ 手動確認');
    }
  });
  toDelete.sort(function(a, b) { return b - a; }); // 逆順で削除
  toDelete.forEach(function(rowNum) {
    sheet.deleteRow(rowNum);
    Logger.log('  ✅ [' + label + '] 行' + rowNum + ' 削除（空の重複 赤川1丁目）');
  });
}

/** diagnoseAkagawa 用：指定シートの赤川関連行をログ出力（変更なし） */
function _dumpAkagawaRows(label, sheet) {
  if (!sheet) { Logger.log('  [' + label + '] シートなし'); return; }
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) { Logger.log('  [' + label + '] データなし'); return; }

  var data = sheet.getRange(2, 1, lastRow - 1, 10).getValues();
  var count = 0;
  data.forEach(function(row, i) {
    var city  = String(row[0] || '').trim();
    var town  = String(row[1] || '').trim();
    if (city !== '函館市') return;
    if (town.indexOf('赤川') === -1) return;
    var chome     = String(row[2] || '').trim();
    var house     = parseInt(row[3], 10) || 0;
    var status    = String(row[4] || '').trim();
    var distCount = parseInt(row[6], 10) || 0;
    var member    = String(row[7] || '').trim();
    Logger.log('  [' + label + '] 行' + (i+2)
      + ': town=[' + town + '] chome=[' + chome + '] 世帯=' + house
      + ' status=[' + status + '] 枚数=' + distCount
      + (member ? ' 担当=' + member : ''));
    count++;
  });
  if (count === 0) Logger.log('  [' + label + '] 赤川行なし');
}
