/* Grabo — service worker.
 * Menyimpan pengaturan, mengamati URL media di jaringan, membuka Studio,
 * menjalankan panen berantai dari daftar tautan, dan menjadi jalur unduhan cadangan. */
'use strict';

const DEFAULTS = {
  enabled: true,
  sidebarWidth: 25,
  dockMode: 'dock',
  sound: true,
  openTab: 'overview',
  autoWatch: true,
  sources: { dom: true, net: true, meta: true, css: true, canvas: true },
  filters: {
    kinds: { image: true, video: true, audio: false },
    minW: 0, minH: 0, minBytes: 0,
    skipSmall: true, skipThumbs: true, onlyVisible: false,
    include: [], exclude: []
  },
  scrollDepth: 4,
  scrollDelay: 500,
  loadMore: true,
  probeDims: true,
  probeLimit: 60,
  adapter: 'auto',
  queue: { concurrency: 2, gap: 400, retries: 2, dedup: true, overwrite: false },
  out: { mode: 'fs', template: '{host}/{date}/{base}-{n}.{ext}', manifest: true, folderName: '' },
  video: { quality: 'best', maxSegs: 4000 },
  profiles: {},
  totals: { files: 0, bytes: 0 }
};

const MEDIA_EXT = /\.(jpe?g|png|gif|webp|avif|bmp|svg|ico|tiff|heic|jfif|mp4|webm|mov|m4v|mkv|ts|m3u8|mpd|mp3|m4a|aac|wav|ogg|opus|flac)(\?|#|$)/i;
const NET_CAP = 1500;
const netByTab = new Map();

function deepMerge(base, patch) {
  const out = Object.assign({}, base);
  Object.keys(patch || {}).forEach((k) => {
    const v = patch[k];
    if (v && typeof v === 'object' && !Array.isArray(v) && base[k] && typeof base[k] === 'object' && !Array.isArray(base[k])) {
      out[k] = deepMerge(base[k], v);
    } else if (v !== undefined) {
      out[k] = v;
    }
  });
  return out;
}

async function getSettings() {
  const got = await chrome.storage.local.get('settings');
  return deepMerge(DEFAULTS, got.settings || {});
}

/* Penulisan setelan diantre: banyak kendali bisa berubah dalam satu detik. */
let writeChain = Promise.resolve();
function setSettings(patch) {
  const run = async () => {
    const cur = await getSettings();
    const next = deepMerge(cur, patch || {});
    await chrome.storage.local.set({ settings: next });
    return next;
  };
  const p = writeChain.then(run, run);
  writeChain = p.catch(() => {});
  return p;
}

/* ---------- pengamatan jaringan (hanya melihat, tidak memblokir) ---------- */
function headerVal(headers, name) {
  const h = (headers || []).find((x) => x.name && x.name.toLowerCase() === name);
  return h ? h.value || '' : '';
}

function kindFromMime(mime) {
  const m = String(mime).split(';')[0].trim().toLowerCase();
  if (/mpegurl|dash\+xml/.test(m)) return 'playlist';
  if (m.startsWith('image/')) return 'image';
  if (m.startsWith('video/')) return 'video';
  if (m.startsWith('audio/')) return 'audio';
  return '';
}

const flushNet = (() => {
  let t = 0;
  return () => {
    clearTimeout(t);
    t = setTimeout(() => {
      const obj = {};
      netByTab.forEach((v, k) => { obj['net_' + k] = v; });
      chrome.storage.session.set(obj).catch(() => {});
    }, 700);
  };
})();

chrome.webRequest.onCompleted.addListener((d) => {
  if (d.tabId < 0) return;
  if (d.type === 'main_frame' || d.type === 'sub_frame' || d.type === 'script' || d.type === 'stylesheet' || d.type === 'font') return;
  const mime = headerVal(d.responseHeaders, 'content-type');
  let kind = kindFromMime(mime);
  if (!kind && MEDIA_EXT.test(d.url)) {
    kind = /\.(m3u8|mpd)(\?|#|$)/i.test(d.url) ? 'playlist'
      : /\.(mp4|webm|mov|m4v|mkv|ts)(\?|#|$)/i.test(d.url) ? 'video'
      : /\.(mp3|m4a|aac|wav|ogg|opus|flac)(\?|#|$)/i.test(d.url) ? 'audio' : 'image';
  }
  if (!kind) return;
  if (/^data:|^chrome-extension:/.test(d.url)) return;
  const len = parseInt(headerVal(d.responseHeaders, 'content-length') || '0', 10) || 0;
  let list = netByTab.get(d.tabId);
  if (!list) { list = []; netByTab.set(d.tabId, list); }
  const hit = list.find((x) => x.url === d.url);
  if (hit) { if (len > hit.bytes) hit.bytes = len; return; }
  list.push({ url: d.url, mime, bytes: len, kind, at: Date.now() });
  if (list.length > NET_CAP) list.splice(0, list.length - NET_CAP);
  flushNet();
}, { urls: ['<all_urls>'] }, ['responseHeaders']);

chrome.tabs.onRemoved.addListener((tabId) => {
  netByTab.delete(tabId);
  chrome.storage.session.remove('net_' + tabId).catch(() => {});
});

chrome.tabs.onUpdated.addListener((tabId, info) => {
  if (info.status === 'loading' && info.url) {
    netByTab.delete(tabId);
    chrome.storage.session.remove('net_' + tabId).catch(() => {});
  }
});

async function netFor(tabId) {
  let list = netByTab.get(tabId);
  if (!list) {
    const got = await chrome.storage.session.get('net_' + tabId).catch(() => ({}));
    list = got['net_' + tabId] || [];
    netByTab.set(tabId, list);
  }
  return list;
}

/* ---------- badge & sidebar ---------- */
async function badge(tabId, text, color) {
  try {
    await chrome.action.setBadgeText({ tabId, text: text || '' });
    if (color) await chrome.action.setBadgeBackgroundColor({ tabId, color });
  } catch (e) { /* tab mungkin sudah tertutup */ }
}

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab || null;
}

async function sendToTab(tabId, msg) {
  try { return await chrome.tabs.sendMessage(tabId, msg); }
  catch (e) { return { ok: false, error: 'content script belum aktif di halaman ini' }; }
}

async function toggleSidebar(tabId) {
  const tab = tabId ? { id: tabId } : await activeTab();
  if (!tab) return;
  const res = await sendToTab(tab.id, { type: 'GB_TOGGLE' });
  if (!res || !res.ok) {
    /* Halaman khusus (chrome://, PDF, toko) tidak bisa disuntiki. */
    await badge(tab.id, '!', '#FF4D5E');
  }
}

const STUDIO_URL = chrome.runtime.getURL('studio.html');

async function openStudio(query) {
  const url = STUDIO_URL + (query ? '?' + query : '');
  const tabs = await chrome.tabs.query({ url: STUDIO_URL + '*' });
  if (tabs.length) {
    await chrome.tabs.update(tabs[0].id, { active: true });
    await chrome.windows.update(tabs[0].windowId, { focused: true });
    if (query) chrome.runtime.sendMessage({ type: 'GB_STUDIO_HINT', query }).catch(() => {});
    return { ok: true, tabId: tabs[0].id, reused: true };
  }
  const tab = await chrome.tabs.create({ url, active: true });
  return { ok: true, tabId: tab.id, reused: false };
}

/* ---------- panen berantai dari daftar tautan ---------- */
let batch = { running: false, done: 0, total: 0, cancel: false };

function waitComplete(tabId, timeout) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => { if (!done) { done = true; chrome.tabs.onUpdated.removeListener(onUpd); clearTimeout(t); resolve(v); } };
    const onUpd = (id, info) => { if (id === tabId && info.status === 'complete') finish(true); };
    chrome.tabs.onUpdated.addListener(onUpd);
    const t = setTimeout(() => finish(false), timeout || 25000);
    chrome.tabs.get(tabId).then((tb) => { if (tb && tb.status === 'complete') finish(true); }).catch(() => finish(false));
  });
}

async function runBatch(urls, opts) {
  if (batch.running) return { ok: false, error: 'panen berantai sedang berjalan' };
  const list = (urls || []).map((u) => String(u).trim()).filter((u) => /^https?:\/\//i.test(u));
  if (!list.length) return { ok: false, error: 'tidak ada tautan http(s) yang sah' };
  const settings = await getSettings();
  const gap = Math.max(300, Number(opts && opts.gap) || settings.queue.gap || 800);
  batch = { running: true, done: 0, total: list.length, cancel: false };
  chrome.runtime.sendMessage({ type: 'GB_BATCH_STATE', batch }).catch(() => {});

  for (const url of list) {
    if (batch.cancel) break;
    let tab = null;
    try {
      tab = await chrome.tabs.create({ url, active: false });
      await waitComplete(tab.id, 25000);
      await new Promise((r) => setTimeout(r, 900));
      const res = await sendToTab(tab.id, { type: 'GB_DO_SCAN', scroll: !!(opts && opts.scroll) });
      const items = res && res.ok ? res.items : [];
      chrome.runtime.sendMessage({ type: 'GB_BATCH_ITEMS', url, items, tabId: tab.id }).catch(() => {});
    } catch (e) {
      chrome.runtime.sendMessage({ type: 'GB_BATCH_ITEMS', url, items: [], error: String(e && e.message || e) }).catch(() => {});
    } finally {
      if (tab && !(opts && opts.keepTabs)) chrome.tabs.remove(tab.id).catch(() => {});
    }
    batch.done++;
    chrome.runtime.sendMessage({ type: 'GB_BATCH_STATE', batch }).catch(() => {});
    await new Promise((r) => setTimeout(r, gap));
  }
  batch.running = false;
  chrome.runtime.sendMessage({ type: 'GB_BATCH_STATE', batch }).catch(() => {});
  return { ok: true, done: batch.done, total: batch.total };
}

/* ---------- pesan ---------- */
chrome.runtime.onMessage.addListener((msg, sender, respond) => {
  if (!msg || typeof msg.type !== 'string') return;
  const tabId = sender.tab ? sender.tab.id : msg.tabId;

  switch (msg.type) {
    case 'GB_GET_SETTINGS':
      getSettings().then((s) => respond({ ok: true, settings: s }));
      return true;

    case 'GB_SET_SETTINGS':
      setSettings(msg.patch).then((s) => {
        chrome.runtime.sendMessage({ type: 'GB_SETTINGS_CHANGED', settings: s }).catch(() => {});
        respond({ ok: true, settings: s });
      });
      return true;

    case 'GB_GET_NET':
      netFor(tabId).then((list) => respond({ ok: true, list }));
      return true;

    case 'GB_STATS':
      badge(tabId, msg.kept ? String(msg.kept > 999 ? '999+' : msg.kept) : '', '#FF2E88');
      respond({ ok: true });
      return;

    case 'GB_SIDEBAR_STATE':
      respond({ ok: true });
      return;

    case 'GB_OPEN_STUDIO':
      openStudio(msg.query).then(respond);
      return true;

    case 'GB_TOGGLE_SIDEBAR':
      toggleSidebar(msg.tabId).then(() => respond({ ok: true }));
      return true;

    case 'GB_SCAN_TAB':
      sendToTab(msg.tabId, { type: 'GB_DO_SCAN', scroll: !!msg.scroll }).then(respond);
      return true;

    case 'GB_TAB_SETTINGS':
      sendToTab(msg.tabId, { type: 'GB_DO_SETTINGS', patch: msg.patch }).then(respond);
      return true;

    case 'GB_ACTIVE_TAB':
      activeTab().then((t) => respond({ ok: true, tab: t ? { id: t.id, url: t.url, title: t.title } : null }));
      return true;

    case 'GB_DOWNLOAD':
      chrome.downloads.download({
        url: msg.url,
        filename: msg.filename || undefined,
        saveAs: false,
        conflictAction: msg.overwrite ? 'overwrite' : 'uniquify'
      }).then((id) => respond({ ok: true, id })).catch((e) => respond({ ok: false, error: String(e && e.message || e) }));
      return true;

    case 'GB_DOWNLOAD_STATE':
      chrome.downloads.search({ id: msg.id }).then((d) => {
        const it = d && d[0];
        respond({ ok: true, state: it ? it.state : 'gone', bytes: it ? it.bytesReceived : 0, total: it ? it.totalBytes : 0, error: it ? it.error : '' });
      }).catch((e) => respond({ ok: false, error: String(e) }));
      return true;

    case 'GB_BATCH_RUN':
      runBatch(msg.urls, msg.opts).then(respond);
      return true;

    case 'GB_BATCH_CANCEL':
      batch.cancel = true;
      respond({ ok: true });
      return;

    case 'GB_BATCH_STATE':
      respond({ ok: true, batch });
      return;

    case 'GB_TOTALS':
      setSettings({ totals: msg.totals || { files: msg.files || 0, bytes: msg.bytes || 0 } }).then(() => respond({ ok: true }));
      return true;

    case 'GB_ENQUEUE':
      openStudio(msg.query).then(async (res) => {
        const originTab = sender.tab ? sender.tab.id : null;
        const items = (msg.items || []).map((it) => Object.assign({}, it, { tabId: it.tabId || originTab }));
        const payload = { type: 'GB_ENQUEUE_ITEMS', items, autorun: !!msg.autorun };
        let tries = 0;
        const push = () => {
          chrome.runtime.sendMessage(payload).then((r) => {
            if ((!r || !r.ok) && ++tries < 10) setTimeout(push, 600);
          }).catch(() => { if (++tries < 10) setTimeout(push, 600); });
        };
        setTimeout(push, res.reused ? 60 : 700);
        respond({ ok: true, tabId: res.tabId });
      });
      return true;

    default:
      return;
  }
});

/* ---------- pintasan, ikon, menu kanan ---------- */
chrome.commands.onCommand.addListener(async (cmd) => {
  if (cmd === 'toggle-sidebar') { const t = await activeTab(); if (t) toggleSidebar(t.id); }
  if (cmd === 'harvest') { const t = await activeTab(); if (t) { await sendToTab(t.id, { type: 'GB_TOGGLE', open: true }); sendToTab(t.id, { type: 'GB_DO_SCAN', scroll: true }); } }
  if (cmd === 'open-studio') openStudio();
});

chrome.action.onClicked.addListener((tab) => toggleSidebar(tab.id));

chrome.runtime.onInstalled.addListener(async () => {
  await setSettings({});
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: 'gb-open', title: 'Grabo — buka sidebar', contexts: ['page'] });
    chrome.contextMenus.create({ id: 'gb-scan', title: 'Grabo — panen halaman ini', contexts: ['page'] });
    chrome.contextMenus.create({ id: 'gb-grab-image', title: 'Grabo — antrekan gambar ini', contexts: ['image'] });
    chrome.contextMenus.create({ id: 'gb-grab-video', title: 'Grabo — antrekan video ini', contexts: ['video'] });
    chrome.contextMenus.create({ id: 'gb-grab-link', title: 'Grabo — antrekan media di tautan ini', contexts: ['link'] });
    chrome.contextMenus.create({ id: 'gb-studio', title: 'Grabo — buka Studio', contexts: ['page'] });
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === 'gb-open') return toggleSidebar(tab.id);
  if (info.menuItemId === 'gb-scan') {
    await sendToTab(tab.id, { type: 'GB_TOGGLE', open: true });
    return sendToTab(tab.id, { type: 'GB_DO_SCAN', scroll: true });
  }
  if (info.menuItemId === 'gb-studio') return openStudio();
  const url = info.srcUrl || info.linkUrl;
  if (!url) return;
  await openStudio();
  const kind = /\.(m3u8|mpd)(\?|#|$)/i.test(url) ? 'playlist'
    : /\.(mp4|webm|mov|m4v|mkv|ts)(\?|#|$)/i.test(url) ? 'video' : 'image';
  /* Studio mungkin baru dibuat; kirim berulang sampai ada yang menerima. */
  let tries = 0;
  const push = () => {
    chrome.runtime.sendMessage({
      type: 'GB_ENQUEUE_ONE',
      item: { url, kind, source: 'menu', pageUrl: tab.url, pageTitle: tab.title, host: new URL(url).hostname }
    }).then((r) => {
      if ((!r || !r.ok) && ++tries < 8) setTimeout(push, 700);
    }).catch(() => { if (++tries < 8) setTimeout(push, 700); });
  };
  push();
});