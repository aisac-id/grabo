/* Grabo — penyimpanan IndexedDB untuk Studio.
 * Antrian bertahan setelah tab ditutup atau browser dimatikan. */
(function (root) {
  'use strict';

  const NAME = 'grabo';
  const VER = 1;
  let dbp = null;

  function open() {
    if (dbp) return dbp;
    dbp = new Promise((resolve, reject) => {
      const req = indexedDB.open(NAME, VER);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('jobs')) {
          const s = db.createObjectStore('jobs', { keyPath: 'id' });
          s.createIndex('state', 'state');
          s.createIndex('createdAt', 'createdAt');
        }
        if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'k' });
        if (!db.objectStoreNames.contains('hashes')) db.createObjectStore('hashes', { keyPath: 'hash' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbp;
  }

  async function tx(stores, mode, fn) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const t = db.transaction(stores, mode);
      let out;
      t.oncomplete = () => resolve(out);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error || new Error('transaksi dibatalkan'));
      out = fn(t);
      if (out && typeof out.then === 'function') out.then((v) => { out = v; });
    });
  }

  function reqP(req) {
    return new Promise((res, rej) => { req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error); });
  }

  async function putJobs(list) {
    if (!list.length) return;
    const db = await open();
    return new Promise((resolve, reject) => {
      const t = db.transaction('jobs', 'readwrite');
      const s = t.objectStore('jobs');
      list.forEach((j) => s.put(j));
      t.oncomplete = resolve;
      t.onerror = () => reject(t.error);
    });
  }

  async function allJobs() {
    const db = await open();
    const t = db.transaction('jobs', 'readonly');
    return reqP(t.objectStore('jobs').getAll());
  }

  async function delJobs(ids) {
    if (!ids.length) return;
    const db = await open();
    return new Promise((resolve, reject) => {
      const t = db.transaction('jobs', 'readwrite');
      const s = t.objectStore('jobs');
      ids.forEach((id) => s.delete(id));
      t.oncomplete = resolve;
      t.onerror = () => reject(t.error);
    });
  }

  async function clearJobs() {
    const db = await open();
    return new Promise((resolve, reject) => {
      const t = db.transaction('jobs', 'readwrite');
      t.objectStore('jobs').clear();
      t.oncomplete = resolve;
      t.onerror = () => reject(t.error);
    });
  }

  async function setMeta(k, v) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const t = db.transaction('meta', 'readwrite');
      t.objectStore('meta').put({ k, v });
      t.oncomplete = resolve;
      t.onerror = () => reject(t.error);
    });
  }

  async function getMeta(k) {
    const db = await open();
    const t = db.transaction('meta', 'readonly');
    const row = await reqP(t.objectStore('meta').get(k));
    return row ? row.v : undefined;
  }

  async function hasHash(hash) {
    const db = await open();
    const t = db.transaction('hashes', 'readonly');
    const row = await reqP(t.objectStore('hashes').get(hash));
    return row || null;
  }

  async function addHash(hash, info) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const t = db.transaction('hashes', 'readwrite');
      t.objectStore('hashes').put({ hash, name: info.name, out: info.out, at: Date.now(), bytes: info.bytes });
      t.oncomplete = resolve;
      t.onerror = () => reject(t.error);
    });
  }

  async function clearHashes() {
    const db = await open();
    return new Promise((resolve, reject) => {
      const t = db.transaction('hashes', 'readwrite');
      t.objectStore('hashes').clear();
      t.oncomplete = resolve;
      t.onerror = () => reject(t.error);
    });
  }

  async function countHashes() {
    const db = await open();
    const t = db.transaction('hashes', 'readonly');
    return reqP(t.objectStore('hashes').count());
  }

  root.GBStore = { open, putJobs, allJobs, delJobs, clearJobs, setMeta, getMeta, hasHash, addHash, clearHashes, countHashes, tx };
})(globalThis);