// ============================================================
// BoundaryData.gs — 町丁目境界GeoJSONの取得・キャッシュ・提供
// ============================================================
//
// 【データソース】
//   e-Stat（政府統計の総合窓口）の「国勢調査 小地域境界データ」を使用します。
//
// 【渡島半島 全18市町村 ダウンロードURL一覧】
//   ベースURL: https://www.e-stat.go.jp/gis/statmap-search?page=1&type=2&aggregateUnitForBoundary=A&toukeiCode=00200521&dataYear=2020&prefCode=01&cityCode=
//   ※各ページで「令和2年 世界測地系緯度経度・Shapefile」をダウンロード（ZIPファイル）
//
//   ▼ 渡島地方（渡島総合振興局）
//     函館市      cityCode=202  → r2ka01202.json  ★現在使用中
//     北斗市      cityCode=236  → r2ka01236.json  ★現在使用中
//     七飯町      cityCode=337  → r2ka01337.json  ★現在使用中
//     木古内町    cityCode=334  → r2ka01334.json  ★現在使用中
//     知内町      cityCode=333  → r2ka01333.json
//     福島町      cityCode=332  → r2ka01332.json
//     松前町      cityCode=331  → r2ka01331.json
//     鹿部町      cityCode=343  → r2ka01343.json
//     森町        cityCode=345  → r2ka01345.json  ★現在使用中
//     八雲町      cityCode=346  → r2ka01346.json
//     長万部町    cityCode=347  → r2ka01347.json
//
//   ▼ 檜山地方（檜山振興局）
//     江差町      cityCode=361  → r2ka01361.json
//     上ノ国町    cityCode=362  → r2ka01362.json
//     厚沢部町    cityCode=363  → r2ka01363.json
//     乙部町      cityCode=364  → r2ka01364.json
//     今金町      cityCode=370  → r2ka01370.json
//     せたな町    cityCode=371  → r2ka01371.json
//     奥尻町      cityCode=367  → r2ka01367.json  ※離島
//
// 【追加手順（新しい市町村を追加するとき）】
//   1. 上記URLから追加したい市町村のZIPをダウンロード
//   2. mapshaper.org でGeoJSONに変換（既存ZIPと一緒にドロップしてもOK）
//   3. 変換後のJSONを「r2ka01XXX.json」の名前でGoogle Driveにアップロード
//      ※ まとめファイルを使う場合は「d8posting_estat_raw.json」に名前変更してアップロード
//   4. GASエディタで importEStatBoundary() を実行
//   5. admin.html のドロップダウンに市町村名を追加（コメント解除）
//   6. clasp push → デプロイ
//
// ============================================================

var BOUNDARY_FILE_NAME     = 'd8posting_boundaries_v1.json';
var BOUNDARY_RAW_FILE_NAME = 'd8posting_estat_raw.json';

// ------------------------------------------------------------
// ① e-Stat GeoJSONをインポートして内部形式に変換・保存
//    GASエディタから手動実行（1回のみ）
// ------------------------------------------------------------

/**
 * Google DriveのGeoJSONファイルを読み込み、内部形式に変換・保存する
 *
 * 対応ファイル名（いずれでも可）:
 *   - r2ka01202.json / r2ka01236.json / r2ka01337.json  ← 3ファイル別々でOK
 *   - d8posting_estat_raw.json                          ← 1ファイルにまとめた場合
 */
function importEStatBoundary() {
  // ── 取り込み対象の市町村名（ファイルがなければ自動スキップ）──────────
  // 渡島地方
  var targetCities = {
    '函館市':   true,   // 現在使用中
    '北斗市':   true,   // 現在使用中
    '七飯町':   true,   // 現在使用中
    '木古内町': true,   // 現在使用中
    '森町':     true,   // 現在使用中
    '知内町':   true,
    '福島町':   true,
    '松前町':   true,
    '鹿部町':   true,
    '八雲町':   true,
    '長万部町': true,
    // 檜山地方
    '江差町':   true,
    '上ノ国町': true,
    '厚沢部町': true,
    '乙部町':   true,
    '今金町':   true,
    'せたな町': true,
    '奥尻町':   true    // 離島
  };

  // 読み込むファイル名の候補（Drive にあるものだけ読み込む）
  var candidateFiles = [
    'd8posting_estat_raw.json',  // まとめファイル（全市町村まとめて変換した場合）
    // ── 渡島地方 ──
    'r2ka01202.json',            // 函館市
    'r2ka01236.json',            // 北斗市
    'r2ka01337.json',            // 七飯町
    'r2ka01334.json',            // 木古内町
    'r2ka01345.json',            // 森町
    'r2ka01333.json',            // 知内町
    'r2ka01332.json',            // 福島町
    'r2ka01331.json',            // 松前町
    'r2ka01343.json',            // 鹿部町
    'r2ka01346.json',            // 八雲町
    'r2ka01347.json',            // 長万部町
    // ── 檜山地方 ──
    'r2ka01361.json',            // 江差町
    'r2ka01362.json',            // 上ノ国町
    'r2ka01363.json',            // 厚沢部町
    'r2ka01364.json',            // 乙部町
    'r2ka01370.json',            // 今金町
    'r2ka01371.json',            // せたな町
    'r2ka01367.json'             // 奥尻町（離島）
  ];

  var allFeatures = [];
  var loadedFiles = [];

  candidateFiles.forEach(function(fileName) {
    var json = _loadFromDrive(fileName);
    if (!json) return;  // ファイルがなければスキップ

    var raw;
    try { raw = JSON.parse(json); } catch (e) {
      Logger.log('❌ JSON解析エラー [' + fileName + ']: ' + e.message);
      return;
    }

    var count = 0;
    (raw.features || []).forEach(function(f) {
      var props    = f.properties || {};
      var cityName = props.CITY_NAME || props.city_name || '';
      var sName    = props.S_NAME    || props.s_name    || '';

      // 郡名付き（例: '上磯郡木古内町'）にも対応：末尾が一致すればOK
      var matchedCity = targetCities[cityName]
        ? cityName
        : Object.keys(targetCities).filter(function(c) { return cityName.indexOf(c) !== -1; })[0] || null;
      if (!matchedCity) return;
      cityName = matchedCity; // 正規化された名前を使用

      if (!sName || !f.geometry)   return;
      // 非居住エリアを除外
      if (sName.indexOf('水面調査区') !== -1) return;

      count++;
      // 字/大字プレフィックスを除去してから正規化（エリアマスタ側と一致させる）
      var cleanedSName = sName.replace(/^大字/, '').replace(/^字/, '').trim();
      // e-Stat の SETAI（世帯数）フィールドを取得
      var households = parseInt(props.SETAI || props.setai || props.WORLD_SETAI || 0, 10) || 0;
      allFeatures.push({
        type: 'Feature',
        properties: {
          name:           sName,
          normalizedName: _normalizeJaName(cleanedSName),
          cityName:       cityName,
          households:     households
        },
        geometry: f.geometry
      });
    });

    loadedFiles.push(fileName + ' (' + count + '件)');
  });

  if (allFeatures.length === 0) {
    Logger.log('❌ ファイルが見つかりません。');
    Logger.log('   以下のいずれかのファイルをGoogle Driveにアップロードしてください:');
    candidateFiles.forEach(function(f) { Logger.log('   - ' + f); });
    return;
  }

  Logger.log('読み込みファイル: ' + loadedFiles.join(', '));

  _saveToDrive(BOUNDARY_FILE_NAME, JSON.stringify({
    type: 'FeatureCollection',
    features: allFeatures
  }));

  Logger.log('✅ インポート完了: ' + allFeatures.length + '件保存');
  Logger.log('   次: WebAppを再デプロイしてください。');
}

// ------------------------------------------------------------
// ② 診断：Driveの境界ファイル確認
// ------------------------------------------------------------

/**
 * 保存済み境界データの件数・マッチ状況を確認する
 */
function debugBoundaryData() {
  var cached = _loadFromDrive(BOUNDARY_FILE_NAME);
  if (!cached) {
    Logger.log('境界ファイルなし。importEStatBoundary() を先に実行してください。');
    return;
  }

  var geojson = JSON.parse(cached);
  var features = geojson.features || [];
  Logger.log('境界データ件数: ' + features.length + '件');

  // 市別集計
  var cities = {};
  features.forEach(function(f) {
    var c = f.properties.cityName || '不明';
    cities[c] = (cities[c] || 0) + 1;
  });
  Object.keys(cities).sort().forEach(function(c) {
    Logger.log('  ' + c + ': ' + cities[c] + '件');
  });

  // エリアとのマッチング確認（市町村名+町名で一意キー）
  var areas  = getAreaList(null);
  var areaMap = {};
  areas.forEach(function(a) {
    var key = (a.city || '') + '/' + _normalizeJaName(a.fullName || (a.town + (a.chome || '')));
    areaMap[key] = true;
  });

  var matched = 0;
  var unmatched = [];
  features.forEach(function(f) {
    var key = (f.properties.cityName || '') + '/' + (f.properties.normalizedName || '');
    if (areaMap[key]) {
      matched++;
    } else {
      unmatched.push(f.properties.name + ' (' + f.properties.cityName + ')');
    }
  });

  Logger.log('スプレッドシートとのマッチ: ' + matched + '/' + features.length + '件');
  if (unmatched.length > 0) {
    Logger.log('アンマッチ（最大10件）:');
    unmatched.slice(0, 10).forEach(function(n) { Logger.log('  ' + n); });
  }
}

/**
 * 指定市町村の境界データに登録されている全エリア名を表示する
 * GASエディタから実行: listBoundaryNames('北斗市')
 * ファイル: BoundaryData.gs
 */
function listBoundaryNames(cityName) {
  cityName = cityName || '北斗市';
  var cached = _loadFromDrive(BOUNDARY_FILE_NAME);
  if (!cached) { Logger.log('境界データなし'); return; }
  var geojson = JSON.parse(cached);
  var found = (geojson.features || []).filter(function(f) {
    return f.properties.cityName === cityName;
  });
  Logger.log('=== ' + cityName + ' の境界エリア一覧 (' + found.length + '件) ===');
  found.forEach(function(f) {
    Logger.log('  name=[' + f.properties.name + '] normalizedName=[' + f.properties.normalizedName + ']');
  });
}

/** 北斗市の境界エリア名一覧 — GASエディタから実行: listBoundaryNames_Hokuto() */
function listBoundaryNames_Hokuto()   { listBoundaryNames('北斗市'); }

/** 函館市の境界エリア名一覧 — GASエディタから実行: listBoundaryNames_Hakodate() */
function listBoundaryNames_Hakodate() { listBoundaryNames('函館市'); }

/**
 * チラシSSのエリアデータと境界データのマッチを確認する
 * マップで色が出ない原因を特定するために使う
 * GASエディタから実行: debugFlyerBoundaryMatch('プロジェクト600')
 * ファイル: BoundaryData.gs
 * @param {string} flyerName チラシ名
 */
function debugFlyerBoundaryMatch(flyerName) {
  flyerName = flyerName || 'プロジェクト600';

  var cached = _loadFromDrive(BOUNDARY_FILE_NAME);
  if (!cached) { Logger.log('境界データなし'); return; }

  var geojson = JSON.parse(cached);

  // 境界データのキーセットを作る
  var boundaryKeys = {};
  (geojson.features || []).forEach(function(f) {
    var key = (f.properties.cityName || '') + '/' + (f.properties.normalizedName || '');
    boundaryKeys[key] = f.properties.name;
  });

  // チラシSSのエリアデータを取得
  var flyerAreas = getAreaListFromFlyerSs(flyerName, null);
  if (!flyerAreas || flyerAreas.length === 0) {
    Logger.log('チラシSSのエリアデータが空です: ' + flyerName);
    return;
  }

  Logger.log('=== ' + flyerName + ' 境界マッチ確認 ===');
  Logger.log('チラシSSエリア数: ' + flyerAreas.length + '件');

  var matched = 0;
  var unmatched = [];
  flyerAreas.forEach(function(a) {
    var norm = _normalizeJaName(a.fullName || (a.town + (a.chome || '')));
    var key  = (a.city || '') + '/' + norm;
    if (boundaryKeys[key]) {
      matched++;
    } else {
      unmatched.push({
        key:    key,
        status: a.status || '未着手',
        count:  a.distCount || 0
      });
    }
  });

  Logger.log('マッチ: ' + matched + '/' + flyerAreas.length + '件');

  if (unmatched.length === 0) {
    Logger.log('✅ 全エリアが境界データと一致しています');
    Logger.log('→ 色が出ない場合は admin.html の _normalizeName との差異が原因の可能性あり');
  } else {
    Logger.log('❌ 境界データと一致しないエリア (' + unmatched.length + '件):');
    unmatched.forEach(function(u) {
      Logger.log('  [' + u.key + '] status=' + u.status + ' count=' + u.count);
    });
  }

  // 七重浜・大沼を特定してログ
  var targets = flyerAreas.filter(function(a) {
    return (a.town || '').indexOf('七重浜') !== -1 || (a.town || '').indexOf('大沼') !== -1;
  });
  if (targets.length > 0) {
    Logger.log('--- 七重浜・大沼のエリアデータ ---');
    targets.forEach(function(a) {
      var norm = _normalizeJaName(a.fullName || (a.town + (a.chome || '')));
      var key  = (a.city || '') + '/' + norm;
      Logger.log('  ' + key + ' / status=' + a.status + ' / 境界=' + (boundaryKeys[key] ? '一致' : '不一致'));
    });
  } else {
    Logger.log('⚠️ チラシSSに七重浜・大沼のエリアが見つかりません');
  }
}

// ------------------------------------------------------------
// ③ フロントエンド向け API
// ------------------------------------------------------------

/**
 * エリアデータと結合した境界GeoJSONを返す
 * @param {string|null} cityFilter
 * @returns {Object} GeoJSON FeatureCollection または { error: string }
 */
function getBoundaryData(cityFilter) {
  var cached = _loadFromDrive(BOUNDARY_FILE_NAME);
  if (!cached) {
    return { error: '境界データ未生成。importEStatBoundary() を実行してください。' };
  }

  var geojson = JSON.parse(cached);
  var areas   = getAreaList(cityFilter || null);

  // 市町村名+正規化名 → エリアデータ のルックアップマップ（同名町名の衝突防止）
  var areaMap = {};
  areas.forEach(function(a) {
    // 「総数」行はスキップ（集計行のため地図表示対象外）
    if ((a.town || '').indexOf('総数') !== -1) return;
    // 「字」「大字」プレフィックスを除去してから正規化（エリアマスタ側の表記ゆれに対応）
    var cleanTown  = (a.town  || '').replace(/^[大字字]{1,2}/, '').trim();
    var cleanChome = (a.chome || '').replace(/^[大字字]{1,2}/, '').trim();
    var city = a.city || '';

    function _reg(k, val) { if (k && !areaMap[k]) areaMap[k] = val; }

    // ① 基本キー（字除去済み）
    _reg(city + '/' + _normalizeJaName(cleanTown + cleanChome), a);
    // ② 元のキー
    _reg(city + '/' + _normalizeJaName(a.fullName || (a.town + (a.chome || ''))), a);
    // ③ 丁目なしキー（境界データが丁目を持たない場合: 公園通1丁目→公園通）
    if (cleanChome) {
      _reg(city + '/' + _normalizeJaName(cleanTown), a);
    }
    // ④ スペース区切り複合地名の先頭・末尾トークン
    var tokens = cleanTown.split(/[\s　]+/);
    if (tokens.length > 1) {
      _reg(city + '/' + _normalizeJaName(tokens[0]), a);
      _reg(city + '/' + _normalizeJaName(tokens[tokens.length - 1]), a);
    }
  });

  var features = [];

  (geojson.features || []).forEach(function(f) {
    if (cityFilter && f.properties.cityName !== cityFilter) return;

    var normName = f.properties.normalizedName || '';
    var cityName = f.properties.cityName || '';
    var area     = areaMap[cityName + '/' + normName];

    var props = {
      name:           f.properties.name || '',
      cityName:       f.properties.cityName || '',
      normalizedName: normName
    };

    if (area) {
      props.status     = area.status     || STATUS.NOT_STARTED;
      props.households = area.households || 0;
      props.distCount  = area.distCount  || 0;
      props.memberName = area.memberName || '';
      props.distDate   = area.distDate   || '';
      props.memo       = area.memo       || '';
      props.fullName   = area.fullName   || '';
      props.city       = area.city       || '';
      props.town       = area.town       || '';
      props.chome      = area.chome      || '';
      props.pct = (area.households > 0 && area.distCount > 0)
        ? Math.min(100, Math.round(area.distCount / area.households * 100))
        : 0;
      props.matched = true;
    } else {
      props.status  = STATUS.NOT_STARTED;
      props.households = 0;
      props.distCount  = 0;
      props.pct     = 0;
      props.matched = false;
    }

    features.push({
      type:       'Feature',
      properties: props,
      geometry:   f.geometry
    });
  });

  return { type: 'FeatureCollection', features: features };
}

// ------------------------------------------------------------
// ⑤ 境界データからエリアマスタへ一括登録
// ------------------------------------------------------------

/**
 * 境界ファイル（d8posting_boundaries_v1.json）から
 * 新規市町村のエリアをエリアマスタに一括追加する
 * 既存エントリは重複スキップ
 * GASエディタから実行（ファイル: BoundaryData）:
 *   importNewMunicipalitiesFromBoundary()
 */
function importNewMunicipalitiesFromBoundary() {
  // 追加対象（既存の函館市・北斗市・七飯町・木古内町・森町 は除く）
  var newCities = {
    '知内町':true, '福島町':true, '松前町':true, '鹿部町':true,
    '八雲町':true, '長万部町':true,
    '江差町':true, '上ノ国町':true, '厚沢部町':true, '乙部町':true,
    '今金町':true, 'せたな町':true, '奥尻町':true
  };

  var cached = _loadFromDrive(BOUNDARY_FILE_NAME);
  if (!cached) {
    Logger.log('❌ 境界ファイルなし。importEStatBoundary()を先に実行してください。');
    return;
  }

  var geojson  = JSON.parse(cached);
  var features = geojson.features || [];

  // エリアマスタの既存エントリを取得（重複チェック用）
  var sheet   = getSheet(SHEET_NAMES.AREA_MASTER);
  var lastRow = sheet.getLastRow();
  var existingKeys = {};
  if (lastRow >= 2) {
    var existing = sheet.getRange(2, 1, lastRow - 1, 3).getValues();
    existing.forEach(function(r) {
      if (r[0]) existingKeys[String(r[0]) + '|' + String(r[1]) + '|' + String(r[2])] = true;
    });
  }

  var newRows = [];
  features.forEach(function(f) {
    var cityName   = f.properties.cityName   || '';
    var households = f.properties.households || 0;
    var rawName    = f.properties.name       || '';

    if (!newCities[cityName] || !rawName) return;

    // 大字・字プレフィックスを除去
    var cleaned = rawName.replace(/^大字/, '').replace(/^字/, '').trim();

    // 丁目を分離（例: "本町一丁目" → town="本町" chome="一丁目"）
    var town  = cleaned;
    var chome = '';
    var m = cleaned.match(/^(.+?)([一二三四五六七八九十]+丁目|\d+丁目)$/);
    if (m) { town = m[1]; chome = m[2]; }

    var key = cityName + '|' + town + '|' + chome;
    if (existingKeys[key]) return;

    newRows.push([
      cityName, town, chome, households,
      STATUS.NOT_STARTED, '', 0, '', '', '', '', ''
    ]);
    existingKeys[key] = true;
  });

  if (newRows.length === 0) {
    Logger.log('追加対象なし（既に全て登録済み、または境界データに対象市町村なし）');
    return;
  }

  // エリアマスタに一括書き込み
  var insertRow = sheet.getLastRow() + 1;
  sheet.getRange(insertRow, 1, newRows.length, 12).setValues(newRows);

  // 市町村別件数ログ
  var cityCounts = {};
  newRows.forEach(function(r) { cityCounts[r[0]] = (cityCounts[r[0]] || 0) + 1; });
  Object.keys(cityCounts).sort().forEach(function(c) {
    Logger.log('  ' + c + ': ' + cityCounts[c] + '件');
  });

  Logger.log('✅ エリアマスタ追加完了: 合計 ' + newRows.length + '件');
  Logger.log('次: ① geocodeAllAreas() で緯度経度を取得（任意）');
  Logger.log('    ② importEStatBoundary() 再実行（世帯数を境界データと同期）');
  Logger.log('=== importNewMunicipalitiesFromBoundary 完了 ===');
}

// ------------------------------------------------------------
// ④ 内部ユーティリティ
// ------------------------------------------------------------

/**
 * 漢数字を含む丁目名をアラビア数字に正規化する
 * 例: "西旭岡町二丁目" → "西旭岡町2丁目"
 *     "上野町十一丁目" → "上野町11丁目"
 */
function _normalizeJaName(name) {
  // 2桁の漢数字を先に処理（例: 十一→11）
  var twoChar = {
    '十一':'11','十二':'12','十三':'13','十四':'14','十五':'15',
    '十六':'16','十七':'17','十八':'18','十九':'19','二十':'20'
  };
  // 1桁の漢数字
  var oneChar = {
    '一':'1','二':'2','三':'3','四':'4','五':'5',
    '六':'6','七':'7','八':'8','九':'9','十':'10'
  };
  var result = String(name || '');
  Object.keys(twoChar).forEach(function(k) {
    result = result.split(k).join(twoChar[k]);
  });
  Object.keys(oneChar).forEach(function(k) {
    result = result.split(k).join(oneChar[k]);
  });
  return result;
}

function _saveToDrive(fileName, content) {
  var files = DriveApp.getFilesByName(fileName);
  while (files.hasNext()) { files.next().setTrashed(true); }
  DriveApp.createFile(fileName, content, MimeType.PLAIN_TEXT);
  Logger.log('Drive保存: ' + fileName + ' (' + content.length + ' bytes)');
}

function _loadFromDrive(fileName) {
  var files = DriveApp.getFilesByName(fileName);
  if (!files.hasNext()) return null;
  return files.next().getBlob().getDataAsString();
}

// ============================================================
// GeoJSON 診断ツール
// ============================================================

/**
 * 指定キーワードを含む GeoJSON フィーチャーの詳細を表示する
 * GASエディタから実行: inspectGeoJsonFeatures('赤川')
 * ファイル: BoundaryData.gs
 * @param {string} keyword 検索キーワード（例: '赤川', '公園通'）
 */
function inspectGeoJsonFeatures(keyword) {
  var raw = _loadFromDrive(BOUNDARY_FILE_NAME);
  if (!raw) { Logger.log('❌ 境界ファイルが見つかりません: ' + BOUNDARY_FILE_NAME); return; }

  var data;
  try { data = JSON.parse(raw); } catch(e) { Logger.log('❌ JSON解析失敗: ' + e.message); return; }

  var features = data.features || [];
  Logger.log('総フィーチャー数: ' + features.length);
  Logger.log('検索キーワード: [' + keyword + ']');
  Logger.log('--------------------');

  var found = 0;
  features.forEach(function(f) {
    var props = f.properties || {};
    var norm     = props.normalizedName || '';
    var city     = props.cityName       || '';
    var original = props.originalName   || '';
    var town     = props.town           || '';
    var chome    = props.chome          || '';

    // キーワードが含まれるフィーチャーを表示
    if (norm.indexOf(keyword) !== -1 || original.indexOf(keyword) !== -1 ||
        town.indexOf(keyword) !== -1  || city.indexOf(keyword) !== -1) {

      Logger.log('cityName:       [' + city     + ']');
      Logger.log('normalizedName: [' + norm     + ']');
      Logger.log('originalName:   [' + original + ']');
      Logger.log('town:           [' + town     + ']');
      Logger.log('chome:          [' + chome    + ']');

      // ジオメトリの概要（座標数）
      var geom = f.geometry || {};
      var coordCount = 0;
      if (geom.coordinates) {
        var coords = geom.coordinates;
        // Polygon or MultiPolygon
        try {
          if (geom.type === 'Polygon') {
            coordCount = coords[0] ? coords[0].length : 0;
          } else if (geom.type === 'MultiPolygon') {
            coords.forEach(function(poly) { coordCount += poly[0] ? poly[0].length : 0; });
          }
        } catch(e2) {}
      }
      Logger.log('geometryType:   ' + (geom.type || '不明') + ' (' + coordCount + '頂点)');
      Logger.log('--------------------');
      found++;
    }
  });

  Logger.log('該当フィーチャー: ' + found + '件');
}

/**
 * 赤川 に関するGeoJSONフィーチャーを全て表示する
 * GASエディタから実行: inspectAkagawaFeatures()
 * ファイル: BoundaryData.gs
 */
function inspectAkagawaFeatures() {
  inspectGeoJsonFeatures('赤川');
}
