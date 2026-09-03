/**
 * @file 13_drive_service.gs
 * Google Drive の操作。フォルダ構成の作成と、ファイルの冪等な作成・更新を担う。
 *
 * 冪等性の考え方
 * --------------
 *   - フォルダは「同名が既にあれば作らない」。毎回新しいフォルダを作らない。
 *   - ファイルは「記録済みファイルIDを更新」。同名ファイルを増やさない。
 *   - ファイルIDを失った場合は、親フォルダ内の同名ファイルから安全に再検出する。
 */

/**
 * Drive操作サービス。
 *
 * @param {string} rootFolderId ルートフォルダのID
 * @param {!Logger_} logger ロガー
 * @constructor
 */
function DriveService(rootFolderId, logger) {
  /** @private {string} */
  this.rootFolderId_ = rootFolderId;
  /** @private {!Logger_} */
  this.logger_ = logger;
  /** @private {!Object<string, !Folder>} フォルダのキャッシュ（パス文字列 → Folder） */
  this.folderCache_ = {};
  /** @private {?Folder} */
  this.root_ = null;
}

/**
 * ルートフォルダを返す。
 * @return {!Folder} ルートフォルダ
 * @throws {Error} フォルダIDが無効・削除済み・アクセス不可の場合
 */
DriveService.prototype.getRoot = function () {
  if (this.root_) {
    return this.root_;
  }
  this.root_ = openFolderById(this.rootFolderId_);
  return this.root_;
};

/**
 * 親フォルダ配下に、指定名のフォルダを取得または作成する（冪等）。
 *
 * @param {!Folder} parent 親フォルダ
 * @param {string} name フォルダ名
 * @return {!Folder} 取得または作成したフォルダ
 */
DriveService.prototype.ensureFolder = function (parent, name) {
  var existing = parent.getFoldersByName(name);
  while (existing.hasNext()) {
    var folder = existing.next();
    if (!folder.isTrashed()) {
      return folder;
    }
  }
  this.logger_.info('フォルダを作成しました', { name: name });
  return parent.createFolder(name);
};

/**
 * ルートからの相対パスでフォルダを取得または作成する（冪等）。
 *
 * @param {!Array<string>} pathParts フォルダ名の配列（例: ['01_税制', '01_法律']）
 * @return {!Folder} 末端のフォルダ
 */
DriveService.prototype.ensureFolderPath = function (pathParts) {
  var cacheKey = pathParts.join('/');
  if (this.folderCache_[cacheKey]) {
    return this.folderCache_[cacheKey];
  }

  var current = this.getRoot();
  var accumulated = [];
  for (var i = 0; i < pathParts.length; i++) {
    accumulated.push(pathParts[i]);
    var key = accumulated.join('/');
    if (this.folderCache_[key]) {
      current = this.folderCache_[key];
      continue;
    }
    current = this.ensureFolder(current, pathParts[i]);
    this.folderCache_[key] = current;
  }

  this.folderCache_[cacheKey] = current;
  return current;
};

/**
 * 00_システム情報 フォルダを返す。
 * @return {!Folder} フォルダ
 */
DriveService.prototype.getSystemFolder = function () {
  return this.ensureFolderPath([CONFIG.FOLDERS.SYSTEM]);
};

/**
 * エラーログフォルダを返す。
 * @return {!Folder} フォルダ
 */
DriveService.prototype.getErrorLogFolder = function () {
  return this.ensureFolderPath([CONFIG.FOLDERS.SYSTEM, CONFIG.FOLDERS.SYSTEM_ERROR_LOG]);
};

/**
 * 99_システムログ フォルダを返す。
 * @return {!Folder} フォルダ
 */
DriveService.prototype.getSystemLogFolder = function () {
  return this.ensureFolderPath([CONFIG.FOLDERS.SYSTEM_LOG]);
};

/**
 * 法令のMarkdownを保存するフォルダを返す。
 * 例: 01_税制/01_法律
 *
 * @param {string} categoryKey カテゴリキー
 * @param {string} lawTypeKey 法令種別キー
 * @return {!Folder} フォルダ
 */
DriveService.prototype.getMarkdownFolder = function (categoryKey, lawTypeKey) {
  var category = CONFIG.CATEGORIES[categoryKey];
  if (!category) {
    throw new Error('未定義のカテゴリです: ' + categoryKey);
  }
  var typeDef = CONFIG.LAW_TYPE_DEFS[lawTypeKey] || CONFIG.LAW_TYPE_DEFS.other;
  var subfolder = CONFIG.FOLDERS.LAW_TYPE_SUBFOLDERS[typeDef.folderKey];
  return this.ensureFolderPath([category.folderName, subfolder]);
};

/**
 * 原本XMLを保存するフォルダを返す。
 * 例: 90_RAW_XML/税制
 *
 * @param {string} categoryKey カテゴリキー
 * @return {!Folder} フォルダ
 */
DriveService.prototype.getRawXmlFolder = function (categoryKey) {
  var category = CONFIG.CATEGORIES[categoryKey];
  if (!category) {
    throw new Error('未定義のカテゴリです: ' + categoryKey);
  }
  return this.ensureFolderPath([CONFIG.FOLDERS.RAW_XML, category.rawFolderName]);
};

/**
 * 履歴フォルダを返す。
 * 例: 01_税制/99_履歴
 *
 * @param {string} categoryKey カテゴリキー
 * @return {!Folder} フォルダ
 */
DriveService.prototype.getHistoryFolder = function (categoryKey) {
  var category = CONFIG.CATEGORIES[categoryKey];
  if (!category) {
    throw new Error('未定義のカテゴリです: ' + categoryKey);
  }
  return this.ensureFolderPath([category.folderName, CONFIG.FOLDERS.HISTORY]);
};

/**
 * 構造化JSONを保存するフォルダを返す。
 * 例: 01_税制/structured
 *
 * @param {string} categoryKey カテゴリキー
 * @return {!Folder} フォルダ
 */
DriveService.prototype.getStructuredFolder = function (categoryKey) {
  var category = CONFIG.CATEGORIES[categoryKey];
  if (!category) {
    throw new Error('未定義のカテゴリです: ' + categoryKey);
  }
  return this.ensureFolderPath([category.folderName, CONFIG.FOLDERS.STRUCTURED]);
};

/**
 * ファイルIDを優先し、無ければ名前で再検出してテキストファイルを更新する（冪等）。
 *
 * 同名ファイルを毎回新規作成しないための中心的な関数。
 *
 * @param {!Folder} folder 親フォルダ
 * @param {string} fileName ファイル名
 * @param {string} content 内容
 * @param {?string=} knownFileId 記録済みのファイルID
 * @param {string=} mimeType MIMEタイプ
 * @return {{fileId: string, created: boolean, recovered: boolean}}
 *     created   : 新規作成した場合 true
 *     recovered : ファイルIDを失って再検出した場合 true
 */
DriveService.prototype.upsertTextFile = function (
    folder, fileName, content, knownFileId, mimeType) {
  var recovered = false;

  // --- 1. 記録済みファイルIDでの更新を試みる ---
  if (knownFileId) {
    try {
      var file = DriveApp.getFileById(knownFileId);
      if (!file.isTrashed()) {
        if (file.getName() !== fileName) {
          file.setName(fileName);
        }
        file.setContent(content);
        return { fileId: file.getId(), created: false, recovered: false };
      }
      this.logger_.warn('記録済みファイルがゴミ箱にあります。再作成します', {
        file_name: fileName, file_id: knownFileId
      });
    } catch (e) {
      this.logger_.warn('記録済みファイルIDでアクセスできません。名前から再検出します', {
        file_name: fileName, file_id: knownFileId, error: describeError(e)
      });
    }
    recovered = true;
  }

  // --- 2. 親フォルダ内の同名ファイルから再検出する ---
  var found = this.findFileByName(folder, fileName);
  if (found) {
    found.setContent(content);
    return { fileId: found.getId(), created: false, recovered: recovered };
  }

  // --- 3. 新規作成する ---
  var created = folder.createFile(fileName, content, mimeType || MimeType.PLAIN_TEXT);
  return { fileId: created.getId(), created: true, recovered: recovered };
};

/**
 * ファイル名だけを指定してテキストファイルを作成・更新する（ログ等で使う）。
 *
 * @param {!Folder} folder 親フォルダ
 * @param {string} fileName ファイル名
 * @param {string} content 内容
 * @param {string=} mimeType MIMEタイプ
 * @return {string} ファイルID
 */
DriveService.prototype.upsertTextFileByName = function (folder, fileName, content, mimeType) {
  return this.upsertTextFile(folder, fileName, content, null, mimeType).fileId;
};

/**
 * 親フォルダ内から、指定名のファイルを1件検出する。
 * 同名ファイルが複数ある場合はWARNを出し、最初の1件を使う。
 *
 * @param {!Folder} folder 親フォルダ
 * @param {string} fileName ファイル名
 * @return {?File} 見つかったファイル。なければ null
 */
DriveService.prototype.findFileByName = function (folder, fileName) {
  var iterator = folder.getFilesByName(fileName);
  var matches = [];
  while (iterator.hasNext()) {
    var file = iterator.next();
    if (!file.isTrashed()) {
      matches.push(file);
    }
  }
  if (matches.length === 0) {
    return null;
  }
  if (matches.length > 1) {
    this.logger_.warn('同名ファイルが複数あります。最初の1件を更新します', {
      file_name: fileName, count: matches.length
    });
  }
  return matches[0];
};

/**
 * ファイルの内容を読み取る。
 * @param {string} fileId ファイルID
 * @return {?string} 内容。読めなければ null
 */
DriveService.prototype.readFileById = function (fileId) {
  try {
    var file = DriveApp.getFileById(fileId);
    if (file.isTrashed()) {
      return null;
    }
    return file.getBlob().getDataAsString();
  } catch (e) {
    return null;
  }
};

/**
 * フォルダ内の指定名ファイルの内容を読み取る。
 * @param {!Folder} folder 親フォルダ
 * @param {string} fileName ファイル名
 * @return {?string} 内容。無ければ null
 */
DriveService.prototype.readTextFile = function (folder, fileName) {
  var file = this.findFileByName(folder, fileName);
  return file ? file.getBlob().getDataAsString() : null;
};

/**
 * 既存ファイルの内容を履歴フォルダへ退避する。
 *
 * 改正前のデータを削除せず、後から参照できるようにするための処理。
 *
 * @param {!Folder} historyFolder 履歴フォルダ
 * @param {string} baseName 拡張子を除いたファイル名（例: '所得税法'）
 * @param {string} extension 拡張子（例: 'md'）
 * @param {string} content 退避する内容
 * @param {(Date|string)=} timestamp 退避時刻
 * @return {string} 作成した履歴ファイルのID
 */
DriveService.prototype.archiveToHistory = function (
    historyFolder, baseName, extension, content, timestamp) {
  var fileName = sanitizeFileName(baseName) + '_' +
    timestampForFileName(timestamp) + '.' + extension;
  var file = historyFolder.createFile(fileName, content, MimeType.PLAIN_TEXT);
  this.logger_.info('履歴へ退避しました', { file_name: fileName });
  return file.getId();
};

/**
 * フォルダIDからフォルダを開く。
 * 無効・削除済み・権限なしの場合は分かりやすい例外を投げる。
 *
 * @param {string} folderId フォルダID
 * @return {!Folder} フォルダ
 * @throws {Error} 開けない場合
 */
function openFolderById(folderId) {
  if (!folderId) {
    throw new Error('フォルダIDが設定されていません');
  }
  var folder;
  try {
    folder = DriveApp.getFolderById(folderId);
  } catch (e) {
    throw new Error(
      'フォルダID "' + folderId + '" にアクセスできません。' +
      '削除されたか、権限がない可能性があります。' +
      'resetRootFolder() を実行すると再設定できます。（詳細: ' + describeError(e) + '）');
  }
  if (folder.isTrashed()) {
    throw new Error(
      'フォルダID "' + folderId + '" はゴミ箱にあります。' +
      'Driveで復元するか、resetRootFolder() を実行して再作成してください。');
  }
  return folder;
}

/**
 * ルートフォルダを取得または作成し、フォルダIDをScript Propertiesへ保存する。
 *
 * 2回目以降は保存済みのIDを使い、新しい「日本法令データベース」フォルダを作らない。
 * IDが無効な場合のみ、安全に作り直す。
 *
 * @param {!Logger_} logger ロガー
 * @return {{folderId: string, created: boolean, reused: boolean}}
 */
function ensureRootFolder(logger) {
  var savedId = getRootFolderId();

  if (savedId) {
    try {
      var folder = openFolderById(savedId);
      logger.info('既存のルートフォルダを使用します', {
        folder_id: savedId, name: folder.getName()
      });
      return { folderId: savedId, created: false, reused: true };
    } catch (e) {
      logger.warn('保存されたフォルダIDが使用できないため作り直します', {
        folder_id: savedId, error: describeError(e)
      });
    }
  }

  // マイドライブ直下に同名フォルダが既にあれば、それを再利用する
  // （setup() の再実行でフォルダが増えないようにするため）
  var root = DriveApp.getRootFolder();
  var existing = root.getFoldersByName(CONFIG.ROOT_FOLDER_NAME);
  while (existing.hasNext()) {
    var candidate = existing.next();
    if (!candidate.isTrashed()) {
      setRootFolderId(candidate.getId());
      logger.info('マイドライブ上の既存フォルダを再利用します', {
        folder_id: candidate.getId(), name: candidate.getName()
      });
      return { folderId: candidate.getId(), created: false, reused: true };
    }
  }

  var newFolder = root.createFolder(CONFIG.ROOT_FOLDER_NAME);
  setRootFolderId(newFolder.getId());
  logger.info('ルートフォルダを新規作成しました', {
    folder_id: newFolder.getId(), name: CONFIG.ROOT_FOLDER_NAME
  });
  return { folderId: newFolder.getId(), created: true, reused: false };
}

/**
 * 規定のフォルダ構成をすべて作成する（冪等）。
 *
 * @param {!DriveService} driveService Driveサービス
 * @return {!Array<string>} 作成・確認したフォルダパスの一覧
 */
function ensureFolderStructure(driveService) {
  var createdPaths = [];

  // 00_システム情報（配下にエラーログ）
  driveService.ensureFolderPath([CONFIG.FOLDERS.SYSTEM]);
  createdPaths.push(CONFIG.FOLDERS.SYSTEM);
  driveService.ensureFolderPath([CONFIG.FOLDERS.SYSTEM, CONFIG.FOLDERS.SYSTEM_ERROR_LOG]);
  createdPaths.push(CONFIG.FOLDERS.SYSTEM + '/' + CONFIG.FOLDERS.SYSTEM_ERROR_LOG);

  // カテゴリごとのフォルダ
  Object.keys(CONFIG.CATEGORIES).forEach(function (key) {
    var category = CONFIG.CATEGORIES[key];
    driveService.ensureFolderPath([category.folderName]);
    createdPaths.push(category.folderName);

    // 04_関連法令 は種別サブフォルダを持たせず、直下に法令を置く構成もあり得るが、
    // 一貫性を優先して他カテゴリと同じ構造にする
    Object.keys(CONFIG.FOLDERS.LAW_TYPE_SUBFOLDERS).forEach(function (typeKey) {
      var sub = CONFIG.FOLDERS.LAW_TYPE_SUBFOLDERS[typeKey];
      driveService.ensureFolderPath([category.folderName, sub]);
      createdPaths.push(category.folderName + '/' + sub);
    });

    driveService.ensureFolderPath([category.folderName, CONFIG.FOLDERS.HISTORY]);
    createdPaths.push(category.folderName + '/' + CONFIG.FOLDERS.HISTORY);

    if (CONFIG.SYNC.GENERATE_STRUCTURED_JSON) {
      driveService.ensureFolderPath([category.folderName, CONFIG.FOLDERS.STRUCTURED]);
      createdPaths.push(category.folderName + '/' + CONFIG.FOLDERS.STRUCTURED);
    }
  });

  // 90_RAW_XML 配下（法令カテゴリのみ）
  driveService.ensureFolderPath([CONFIG.FOLDERS.RAW_XML]);
  createdPaths.push(CONFIG.FOLDERS.RAW_XML);
  Object.keys(CONFIG.CATEGORIES).forEach(function (key) {
    var category = CONFIG.CATEGORIES[key];
    driveService.ensureFolderPath([CONFIG.FOLDERS.RAW_XML, category.rawFolderName]);
    createdPaths.push(CONFIG.FOLDERS.RAW_XML + '/' + category.rawFolderName);
  });

  // 99_システムログ
  driveService.ensureFolderPath([CONFIG.FOLDERS.SYSTEM_LOG]);
  createdPaths.push(CONFIG.FOLDERS.SYSTEM_LOG);

  return createdPaths;
}
