/**
 * gas-shim.js
 * Google Apps Script のグローバルサービスをNode上で再現するスタブ。
 * これにより src/*.gs のコードを「そのまま」ローカルで実行・検証できる。
 */
'use strict';
const crypto = require('crypto');

/** UrlFetchApp のスタブ。応答はテスト側が登録する。 */
class FakeUrlFetchApp {
  constructor() {
    this.handlers = [];
    this.calls = [];
  }
  /** URLパターンに対する応答を登録する */
  on(matcher, responder) {
    this.handlers.push({ matcher, responder });
  }
  reset() {
    this.handlers = [];
    this.calls = [];
  }
  fetch(url, options) {
    this.calls.push({ url, options: options || {} });
    for (let i = this.handlers.length - 1; i >= 0; i--) {
      const h = this.handlers[i];
      const matched = typeof h.matcher === 'function'
        ? h.matcher(url, options)
        : url.includes(h.matcher);
      if (matched) {
        const r = h.responder(url, options, this.calls.length);
        if (r && r.__throw) throw new Error(r.__throw);
        return makeResponse(r);
      }
    }
    return makeResponse({ code: 404, body: '{"message":"not found"}' });
  }
}

function makeResponse(r) {
  const code = r && r.code !== undefined ? r.code : 200;
  const body = r && r.body !== undefined ? r.body : '';
  const headers = (r && r.headers) || {};
  return {
    getResponseCode: () => code,
    getContentText: () => body,
    getAllHeaders: () => headers,
    getBlob: () => ({ getDataAsString: () => body })
  };
}

/** Drive のスタブ。フォルダ/ファイルをメモリ上で表現する。 */
let idSeq = 0;
const nextId = (prefix) => `${prefix}_${String(++idSeq).padStart(4, '0')}`;

class FakeFile {
  constructor(name, content, parent, mimeType) {
    this.id = nextId('file');
    this.name = name;
    this.content = content;
    this.parent = parent;
    this.mimeType = mimeType || 'text/plain';
    this.trashed = false;
    this.writeCount = 1;
  }
  getId() { return this.id; }
  getName() { return this.name; }
  setName(n) { this.name = n; return this; }
  getBlob() { return { getDataAsString: () => this.content }; }
  getMimeType() { return this.mimeType; }
  setContent(c) {
    if (FakeDriveApp.INSTANCE.failWrites) throw new Error('Drive書き込みエラー(テスト)');
    this.content = c;
    this.writeCount++;
    return this;
  }
  setTrashed(v) { this.trashed = v; return this; }
  isTrashed() { return this.trashed; }
  getParents() {
    const p = this.parent;
    let done = false;
    return { hasNext: () => !done && !!p, next: () => { done = true; return p; } };
  }
  moveTo(folder) {
    this.parent.files = this.parent.files.filter(f => f !== this);
    this.parent = folder;
    folder.files.push(this);
    return this;
  }
}

class FakeFolder {
  constructor(name, parent) {
    this.id = nextId('folder');
    this.name = name;
    this.parent = parent;
    this.folders = [];
    this.files = [];
    this.trashed = false;
  }
  getId() { return this.id; }
  getName() { return this.name; }
  isTrashed() { return this.trashed; }
  setTrashed(v) { this.trashed = v; return this; }
  createFolder(name) {
    const f = new FakeFolder(name, this);
    this.folders.push(f);
    FakeDriveApp.INSTANCE.index.set(f.id, f);
    return f;
  }
  createFile(name, content, mimeType) {
    if (FakeDriveApp.INSTANCE.failWrites) throw new Error('Drive書き込みエラー(テスト)');
    const f = new FakeFile(name, content, this, mimeType);
    this.files.push(f);
    FakeDriveApp.INSTANCE.index.set(f.id, f);
    return f;
  }
  getFoldersByName(name) { return iter(this.folders.filter(f => f.name === name && !f.trashed)); }
  getFilesByName(name) { return iter(this.files.filter(f => f.name === name && !f.trashed)); }
  getFolders() { return iter(this.folders.filter(f => !f.trashed)); }
  getFiles() { return iter(this.files.filter(f => !f.trashed)); }
  getParents() {
    const p = this.parent;
    let done = false;
    return { hasNext: () => !done && !!p, next: () => { done = true; return p; } };
  }
}

function iter(arr) {
  let i = 0;
  return { hasNext: () => i < arr.length, next: () => arr[i++] };
}

class FakeDriveApp {
  constructor() {
    this.root = new FakeFolder('マイドライブ', null);
    this.index = new Map([[this.root.id, this.root]]);
    this.failWrites = false;
    FakeDriveApp.INSTANCE = this;
  }
  getRootFolder() { return this.root; }
  getFolderById(id) {
    const f = this.index.get(id);
    if (!f || !(f instanceof FakeFolder)) throw new Error('フォルダが見つかりません: ' + id);
    return f;
  }
  getFileById(id) {
    const f = this.index.get(id);
    if (!f || !(f instanceof FakeFile)) throw new Error('ファイルが見つかりません: ' + id);
    return f;
  }
}

class FakeProperties {
  constructor() { this.store = new Map(); }
  getProperty(k) { return this.store.has(k) ? this.store.get(k) : null; }
  setProperty(k, v) { this.store.set(k, String(v)); return this; }
  deleteProperty(k) { this.store.delete(k); return this; }
  getProperties() { return Object.fromEntries(this.store); }
  setProperties(o) { Object.entries(o).forEach(([k, v]) => this.store.set(k, String(v))); return this; }
}

class FakeTrigger {
  constructor(fn) { this.fn = fn; this.id = nextId('trigger'); }
  getHandlerFunction() { return this.fn; }
  getUniqueId() { return this.id; }
}

class FakeScriptApp {
  constructor() { this.triggers = []; this.failCreate = false; }
  getProjectTriggers() { return this.triggers.slice(); }
  deleteTrigger(t) { this.triggers = this.triggers.filter(x => x !== t); }
  newTrigger(fn) {
    const app = this;
    const builder = {
      timeBased: () => ({
        atHour: () => builder.timeBasedInner,
        everyDays: () => builder.timeBasedInner
      })
    };
    const inner = {
      atHour: () => inner,
      everyDays: () => inner,
      inTimezone: () => inner,
      nearMinute: () => inner,
      create: () => {
        if (app.failCreate) throw new Error('トリガー作成失敗(テスト)');
        const t = new FakeTrigger(fn);
        app.triggers.push(t);
        return t;
      }
    };
    builder.timeBasedInner = inner;
    return { timeBased: () => inner };
  }
}

const Utilities = {
  sleep: () => {},                       // テストでは待機しない
  DigestAlgorithm: { SHA_256: 'SHA_256' },
  Charset: { UTF_8: 'UTF_8' },
  computeDigest(alg, value) {
    const buf = crypto.createHash('sha256').update(value, 'utf8').digest();
    // GASは符号付きバイト配列を返すため、それに合わせる
    return Array.from(buf).map(b => (b > 127 ? b - 256 : b));
  },
  formatDate(date, tz, pattern) {
    const shifted = new Date(date.getTime() + 9 * 3600 * 1000);
    const p = (n) => String(n).padStart(2, '0');
    return pattern
      .replace('yyyy', shifted.getUTCFullYear())
      .replace('MM', p(shifted.getUTCMonth() + 1))
      .replace('dd', p(shifted.getUTCDate()))
      .replace('HH', p(shifted.getUTCHours()))
      .replace('mm', p(shifted.getUTCMinutes()))
      .replace('ss', p(shifted.getUTCSeconds()));
  }
};

/** テスト用のGAS環境一式を作る */
function createGasEnvironment() {
  const driveApp = new FakeDriveApp();
  const scriptProps = new FakeProperties();
  const scriptApp = new FakeScriptApp();
  const urlFetchApp = new FakeUrlFetchApp();
  return {
    DriveApp: driveApp,
    ScriptApp: scriptApp,
    UrlFetchApp: urlFetchApp,
    PropertiesService: {
      getScriptProperties: () => scriptProps,
      getUserProperties: () => scriptProps,
      getDocumentProperties: () => scriptProps
    },
    Utilities,
    Session: { getScriptTimeZone: () => 'Asia/Tokyo' },
    MimeType: { PLAIN_TEXT: 'text/plain', CSV: 'text/csv' },
    console
  };
}

module.exports = { createGasEnvironment, FakeDriveApp, FakeFolder, FakeFile };
