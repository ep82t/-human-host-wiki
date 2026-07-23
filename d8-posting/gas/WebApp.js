// ============================================================
// WebApp.gs — GAS ウェブアプリのルーター
// doGet / doPost のエントリーポイント
// ============================================================

/**
 * GET リクエストのルーター
 * ?app=admin  → 管理者アプリ
 * ?app=mansion → マンション配布アプリ
 * （デフォルト）→ 管理者アプリ
 */
function doGet(e) {
  // ── アクセスキー検証 ──
  // スクリプトプロパティ APP_ACCESS_KEY が設定されている場合のみ有効。
  // URLに ?key=（設定した値） が必要になる。未設定の間は従来どおり全員アクセス可。
  var requiredKey = PropertiesService.getScriptProperties().getProperty(PROP_KEYS.APP_ACCESS_KEY);
  if (requiredKey) {
    var providedKey = (e.parameter && e.parameter.key) || '';
    if (providedKey !== requiredKey) {
      return HtmlService.createHtmlOutput(
        '<div style="font-family:sans-serif;text-align:center;padding:60px 20px;">' +
        '<h2>アクセスが許可されていません</h2>' +
        '<p>正しいURLは管理者にお問い合わせください。</p>' +
        '</div>'
      ).setTitle('アクセス拒否 | d8-posting');
    }
  }

  var app = (e.parameter && e.parameter.app) || 'admin';

  var template;
  if (app === 'mansion') {
    template = HtmlService.createTemplateFromFile('mansion');
  } else {
    template = HtmlService.createTemplateFromFile('admin');
  }

  // Maps API キーをテンプレートに渡す（クライアント側で使用）
  try {
    template.mapsApiKey = getProp(PROP_KEYS.MAPS_API_KEY);
  } catch (e) {
    template.mapsApiKey = '';
  }

  return template.evaluate()
    .setTitle(app === 'mansion' ? 'マンション配布 | d8-posting' : '管理者 | d8-posting')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/**
 * POST リクエストのルーター（Chatwork Webhook）
 * セキュリティ: スクリプトプロパティ CHATWORK_WEBHOOK_TOKEN が設定されている場合、
 * Webhook URL に ?token=（設定値）が含まれていないと拒否する。
 * ※ GASはHTTPヘッダーを読めないため、Chatwork公式の署名ヘッダー検証は使えない。
 *   代わりにURL埋め込みトークン方式（Chatwork側のWebhook URL設定に追記）を使う。
 */
function doPost(e) {
  var requiredToken = PropertiesService.getScriptProperties().getProperty(PROP_KEYS.CHATWORK_WEBHOOK_TOKEN);
  if (requiredToken) {
    var providedToken = (e && e.parameter && e.parameter.token) || '';
    if (providedToken !== requiredToken) {
      Logger.log('⚠️ Webhook拒否: トークン不一致または未指定');
      return ContentService
        .createTextOutput(JSON.stringify({ success: false, message: 'unauthorized' }))
        .setMimeType(ContentService.MimeType.JSON);
    }
  }

  var result = handleChatworkWebhook(e);
  return ContentService
    .createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
}

// ============================================================
// フロントエンドから google.script.run で呼び出すAPI関数
// ============================================================

/** 管理者アプリ：エリア一覧取得 */
function apiGetAreaList(cityFilter) {
  return getAreaList(cityFilter || null);
}

/** 管理者アプリ：チラシ専用シートからエリア一覧取得（なければエリアマスタ） */
function apiGetAreaListForFlyer(flyerName, cityFilter) {
  return getAreaListForFlyer(flyerName || null, cityFilter || null);
}

/** チラシSS経由でエリア更新（配布ログをチラシSSにも追記） */
function apiUpdateAreaInFlyer(flyerName, params) {
  var result = updateAreaInFlyerSs(flyerName, params);
  if (result.success && params.distCount > 0) {
    var logParams = {
      city:       params.city,
      address:    params.town + (params.chome || ''),
      flyerType:  params.flyerType || flyerName,
      distCount:  params.distCount,
      memberName: params.memberName || '',
      distType:   '町丁目',
      source:     'アプリ手入力'
    };
    // マスターの配布記録にも追記（全体集計用）
    appendDistLog(logParams);
    // チラシSS内の配布記録にも追記
    appendDistLogToFlyerSs(flyerName, logParams);
  }
  return result;
}

/** チラシSSの配布記録を取得 */
function apiGetDistLogsForFlyer(flyerName, cityFilter, limit) {
  return getDistLogsFromFlyerSs(flyerName, { city: cityFilter || null, limit: limit || 50 });
}

/** チラシSSからマンション一覧取得（SS未作成なら空配列） */
function apiGetMansionListForFlyer(flyerName, cityFilter, statusFilter) {
  // SSがない場合は getAreaListForFlyer の自動作成後に呼ばれる想定なので空配列を返す
  return getMansionListFromFlyerSs(flyerName, { city: cityFilter || null, status: statusFilter || null });
}

/** チラシSSにマンション訪問記録 */
function apiRecordMansionVisitInFlyer(flyerName, params) {
  return recordMansionVisitInFlyerSs(flyerName, params);
}

/** チラシSSにマンション新規追加（ジオコーディング付き） */
function apiAddMansionInFlyer(flyerName, params) {
  var lat = params.lat || '';
  var lng = params.lng || '';
  if (!lat || !lng) {
    var query = params.address || (params.name + ' ' + (params.city || '函館市'));
    try {
      var geoResult = Maps.newGeocoder().setLanguage('ja').geocode(query);
      if (geoResult.status === 'OK' && geoResult.results.length > 0) {
        var loc = geoResult.results[0].geometry.location;
        params.lat = loc.lat;
        params.lng = loc.lng;
      }
    } catch(e) {
      Logger.log('ジオコーディング失敗: ' + e.message);
    }
  }
  return addMansionToFlyerSs(flyerName, params);
}

/** チラシSSから店舗一覧取得 */
function apiGetStoreListForFlyer(flyerName) {
  return getStoreListFromFlyerSs(flyerName);
}

/** チラシSSの店舗更新（市町村・住所が変わった場合は再ジオコーディング） */
function apiUpdateStoreInFlyer(flyerName, rowNum, params) {
  // 市町村・住所が指定されている場合は再ジオコーディングして座標を更新
  if (params.city || params.address) {
    var city    = params.city    || '函館市';
    var address = params.address || '';
    var query   = '北海道' + city + ' ' + address;
    try {
      var geoResult = Maps.newGeocoder().setLanguage('ja').setRegion('JP').geocode(query);
      if (geoResult.status === 'OK' && geoResult.results.length > 0) {
        var loc = geoResult.results[0].geometry.location;
        // 渡島・檜山管内の範囲チェック（範囲外は座標クリア）
        if (loc.lat >= 41.0 && loc.lat <= 43.0 && loc.lng >= 139.0 && loc.lng <= 141.5) {
          params.lat = loc.lat;
          params.lng = loc.lng;
          Logger.log('店舗ジオコーディング成功: ' + query + ' → ' + loc.lat + ',' + loc.lng);
        } else {
          params.lat = '';
          params.lng = '';
          Logger.log('店舗ジオコーディング: 範囲外のため座標クリア / ' + query + ' → ' + loc.lat + ',' + loc.lng);
        }
      } else {
        params.lat = '';
        params.lng = '';
        Logger.log('店舗ジオコーディング失敗: ' + query);
      }
    } catch(e) {
      Logger.log('店舗ジオコーディングエラー: ' + e.message);
    }
  }
  return updateStoreInFlyerSs(flyerName, rowNum, params);
}

/** チラシ用スプレッドシートを作成（設定画面から呼び出し） */
function apiCreateFlyerSpreadsheet(flyerName) {
  return createFlyerSpreadsheet(flyerName);
}

/** チラシSSのURLを返す */
function apiGetFlyerSpreadsheetUrl(flyerName) {
  var ss = _getFlyerSpreadsheet(flyerName);
  return ss ? { success: true, url: ss.getUrl() } : { success: false };
}

/** 管理者アプリ：集計情報取得 */
function apiGetAreaSummary(cityFilter) {
  return getAreaSummary(cityFilter || null);
}

/** 管理者アプリ：エリアステータス更新 */
function apiUpdateArea(params) {
  var result = updateArea(params);
  if (result.success && params.distCount > 0) {
    // 配布記録にも追記
    appendDistLog({
      city:       params.city,
      address:    params.town + (params.chome || ''),
      flyerType:  params.flyerType || '',
      distCount:  params.distCount,
      memberName: params.memberName || '',
      distType:   '町丁目',
      source:     'アプリ手入力'
    });
  }
  return result;
}

/** 管理者アプリ：配布ログ取得 */
function apiGetDistLogs(cityFilter, limit) {
  return getDistLogs({ city: cityFilter || null, limit: limit || 50 });
}

/** 管理者アプリ：メンバー一覧 */
function apiGetMemberList() {
  return getMemberList();
}

/** マンションアプリ：マンション一覧取得 */
function apiGetMansionList(cityFilter, statusFilter) {
  return getMansionList({
    city:   cityFilter || null,
    status: statusFilter || null
  });
}

/** マンションアプリ：マンション新規登録 */
function apiAddMansion(params) {
  return addMansion(params);
}

/** マンションアプリ：マンション訪問記録 */
function apiRecordMansionVisit(params) {
  return recordMansionVisit(params);
}

/** マンションアプリ：マンション情報更新 */
function apiUpdateMansion(rowId, params) {
  return updateMansion(rowId, params);
}

/** 管理者アプリ：町丁目境界GeoJSONデータ取得 */
function apiGetBoundaryData(cityFilter) {
  return getBoundaryData(cityFilter || null);
}

/** 管理者アプリ：チラシ種別一覧取得 */
function apiGetFlyerTypes() {
  var val = PropertiesService.getScriptProperties().getProperty('FLYER_TYPES');
  if (!val) return ['419チラシ', 'DIYタイムズ１９チラシ'];
  return val.split(',').map(function(s) { return s.trim(); }).filter(function(s) { return s; });
}

/** 管理者アプリ：チラシシートのリネーム（設定で名前変更時に呼ばれる） */
function apiRenameFlyers(renames) {
  try {
    var ss = getSpreadsheet();
    var renamed = [];
    (renames || []).forEach(function(r) {
      if (!r.from || !r.to || r.from === r.to) return;
      // マスターSS内の旧シートをリネーム（後方互換・存在する場合のみ）
      var sheet = ss.getSheetByName(r.from);
      if (sheet) {
        sheet.setName(r.to);
        Logger.log('シート名変更(master): ' + r.from + ' → ' + r.to);
      } else {
        Logger.log('リネーム対象シートなし(master): ' + r.from);
      }
      // チラシSS のエントリをリネーム
      _renameFlyerSsEntry(r.from, r.to);
      renamed.push(r.from + ' → ' + r.to);
    });
    return { success: true, renamed: renamed };
  } catch(e) {
    return { success: false, error: e.message };
  }
}

/** 管理者アプリ：チラシ種別一覧保存（新種別追加時はチラシSSを作成） */
function apiSetFlyerTypes(types) {
  try {
    // 既存種別を取得して差分チェック
    var existing = (PropertiesService.getScriptProperties().getProperty('FLYER_TYPES') || '')
      .split(',').map(function(s) { return s.trim(); }).filter(function(s) { return s; });

    // 保存
    PropertiesService.getScriptProperties().setProperty('FLYER_TYPES', types.join(','));

    // 新規追加されたチラシに専用SSを作成（マスターSSにはシートを作らない）
    var created = [];
    types.forEach(function(flyerName) {
      if (!flyerName) return;
      if (existing.indexOf(flyerName) !== -1) return; // 既存はスキップ
      var result = createFlyerSpreadsheet(flyerName);
      if (result.success) {
        created.push(flyerName);
        Logger.log('チラシSS作成: ' + flyerName + ' / ' + result.url);
      } else {
        Logger.log('チラシSS作成スキップ: ' + flyerName + ' / ' + result.reason);
      }
    });

    return { success: true, created: created };
  } catch(e) {
    return { success: false, error: e.message };
  }
}

/**
 * チラシ専用シートをエリアマスタと同じ構造で作成する
 */
function _createFlyerSheet(ss, flyerName) {
  var sheet = ss.insertSheet(flyerName);

  var headers = ['市町村名', '町名', '丁目', '世帯数',
    'ステータス', 'チラシ種別', '配布枚数', '実施者名', '実施日', 'メモ'];
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);

  // ヘッダー書式
  var hRange = sheet.getRange(1, 1, 1, headers.length);
  hRange.setBackground('#1a237e').setFontColor('#ffffff').setFontWeight('bold');
  sheet.setFrozenRows(1);

  // ステータス入力規則
  var statusRule = SpreadsheetApp.newDataValidation()
    .requireValueInList(['未着手', '配布済み', '未配布', '再訪'], true).build();
  sheet.getRange(2, 5, 1000, 1).setDataValidation(statusRule);

  // エリアマスタから市町村・町名・丁目・世帯数をコピー
  var masterSheet = ss.getSheetByName(SHEET_NAMES.AREA_MASTER);
  if (masterSheet && masterSheet.getLastRow() >= 2) {
    var masterData = masterSheet.getRange(2, 1, masterSheet.getLastRow() - 1, 4).getValues();
    var rows = masterData.filter(function(r) { return r[0]; }); // 市町村名がある行のみ
    if (rows.length > 0) {
      // 世帯数はコピー、チラシ種別は自動設定、その他は空
      var insertRows = rows.map(function(r) {
        return [r[0], r[1], r[2], r[3], '未着手', flyerName, 0, '', '', ''];
      });
      sheet.getRange(2, 1, insertRows.length, 10).setValues(insertRows);
    }
  }

  // 列幅
  sheet.setColumnWidth(1, 80);  // 市町村名
  sheet.setColumnWidth(2, 120); // 町名
  sheet.setColumnWidth(3, 60);  // 丁目
  sheet.setColumnWidth(4, 70);  // 世帯数
  sheet.setColumnWidth(5, 80);  // ステータス
  sheet.setColumnWidth(6, 100); // チラシ種別
  sheet.setColumnWidth(7, 80);  // 配布枚数
  sheet.setColumnWidth(8, 90);  // 実施者名
  sheet.setColumnWidth(9, 90);  // 実施日
  sheet.setColumnWidth(10, 200); // メモ

  Logger.log('✅ チラシシート作成: ' + flyerName + '（' + (masterSheet ? 'エリアデータコピー済み' : 'ヘッダーのみ') + '）');
}

/** 管理者アプリ：店舗設置一覧取得 */
function apiGetStoreList() {
  return getStoreList();
}

/** 管理者アプリ：店舗情報更新 */
function apiUpdateStore(rowNum, params) {
  return updateStoreRow(rowNum, params);
}

/** 管理者アプリ：実行者一覧取得 */
function apiGetExecutors() {
  return getExecutorList();
}

/** 管理者アプリ：実行者を配布記録から自動同期 */
function apiSyncExecutors() {
  try {
    syncExecutorsFromLogs();
    return { success: true, names: getExecutorList() };
  } catch(e) {
    return { success: false, error: e.message };
  }
}

/** 管理者アプリ：チラシ目標枚数を取得 */
function apiGetFlyerTargets() {
  var val = PropertiesService.getScriptProperties().getProperty('FLYER_TARGETS');
  if (!val) return {};
  try { return JSON.parse(val); } catch(e) { return {}; }
}

/** 管理者アプリ：チラシ目標枚数を保存 */
function apiSetFlyerTargets(targets) {
  try {
    PropertiesService.getScriptProperties().setProperty('FLYER_TARGETS', JSON.stringify(targets));
    return { success: true };
  } catch(e) {
    return { success: false, error: e.message };
  }
}

/** 共通：Google Maps API キーをクライアントに返す */
function apiGetMapsApiKey() {
  try {
    return { success: true, key: getProp(PROP_KEYS.MAPS_API_KEY) };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

/** 緯度・経度から住所を返す（サーバーサイド逆ジオコーディング） */
function apiReverseGeocode(lat, lng) {
  try {
    var key = getProp(PROP_KEYS.MAPS_API_KEY);
    var url = 'https://maps.googleapis.com/maps/api/geocode/json?latlng=' +
      lat + ',' + lng + '&language=ja&key=' + key;
    var resp = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    var data = JSON.parse(resp.getContentText());
    if (data.status === 'OK' && data.results.length > 0) {
      var result = data.results[0];
      var address = result.formatted_address.replace('日本、', '').replace('日本 ', '');
      // 建物名を探す
      var buildingName = '';
      (result.address_components || []).forEach(function(c) {
        if (c.types.indexOf('premise') !== -1 || c.types.indexOf('subpremise') !== -1) {
          buildingName = c.long_name;
        }
      });
      return { success: true, address: address, buildingName: buildingName };
    }
    return { success: false };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

/** 住所文字列から緯度・経度を返す（サーバーサイドジオコーディング） */
function apiGeocodeAddress(address) {
  try {
    var key = getProp(PROP_KEYS.MAPS_API_KEY);
    var url = 'https://maps.googleapis.com/maps/api/geocode/json?address=' +
      encodeURIComponent(address) + '&language=ja&key=' + key;
    var resp = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    var data = JSON.parse(resp.getContentText());
    if (data.status === 'OK' && data.results.length > 0) {
      var loc = data.results[0].geometry.location;
      return { success: true, lat: loc.lat, lng: loc.lng };
    }
    Logger.log('ジオコーディング失敗: ' + data.status + ' / ' + address);
    return { success: false, status: data.status };
  } catch (e) {
    return { success: false, error: e.message };
  }
}
