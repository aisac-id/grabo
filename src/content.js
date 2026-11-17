/* Grabo — content script.
 * Memasang sidebar 1/4 layar, menjalankan mesin panen, dan menjadi jembatan
 * antara sidebar, service worker, dan Studio (mesin antrian). */
(function () {
  'use strict';
  if (window.__graboLoaded) return;
  window.__graboLoaded = true;
  if (!document.documentElement || document.documentElement.tagName !== 'HTML') return;

  const U = window.GB;
  const CHANNEL = 'GRABO_BUS';

  const FALLBACK = {
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
    profiles: {}
  };

  function effective(base) {
    const b = base || {};
    const merged = Object.assign({}, FALLBACK, b, {
      sources: Object.assign({}, FALLBACK.sources, b.sources || {}),
      filters: Object.assign({}, FALLBACK.filters, b.filters || {}, {
        kinds: Object.assign({}, FALLBACK.filters.kinds, (b.filters || {}).kinds || {})
      }),
      queue: Object.assign({}, FALLBACK.queue, b.queue || {}),
      out: Object.assign({}, FALLBACK.out, b.out || {}),
      video: Object.assign({}, FALLBACK.video, b.video || {})
    });
    const prof = (merged.profiles || {})[location.hostname];
    if (prof) {
      Object.assign(merged, prof, {
        filters: Object.assign({}, merged.filters, prof.filters || {}),
        queue: Object.assign({}, merged.queue, prof.queue || {}),
        out: Object.assign({}, merged.out, prof.out || {})
      });
    }
    return merged;
  }

  const token = Math.random().toString(36).slice(2) + Date.now().toString(36);
  let settings = effective({});
  let engine = null;
  let frame = null;
  let open = false;
  let logs = [];
  let lastItems = [];
  let lastStats = { found: 0, kept: 0, byKind: {}, bySource: {}, dropped: {} };
  let netList = [];

  function post(payload) {
    if (frame && frame.contentWindow) frame.contentWindow.postMessage(Object.assign({ channel: CHANNEL, token }, payload), '*');
  }

  function log(message) {
    logs.unshift({ message, ts: Date.now() });
    logs = logs.slice(0, 80);
    post({ type: 'GB_LOG', logs });
  }

  function persist(patch) {
    chrome.runtime.sendMessage({ type: 'GB_SET_SETTINGS', patch }).catch(() => {});
  }

  function applyWidth() {
    const pct = U.clamp(Number(settings.sidebarWidth) || 25, 18, 50);
    document.documentElement.style.setProperty('--gb-sidebar-w', pct + 'vw');
    document.documentElement.classList.toggle('gb-docked', open && settings.dockMode === 'dock');
    document.documentElement.classList.toggle('gb-overlay', open && settings.dockMode === 'overlay');
  }

  function build() {
    if (frame) return frame;
    frame = document.createElement('iframe');
    frame.className = 'gb-sidebar-host';
    frame.setAttribute('data-gb-ignore', '');
    frame.setAttribute('title', 'Grabo — panel panen media');
    frame.setAttribute('allow', 'clipboard-write');
    frame.dataset.state = 'closed';
    frame.src = chrome.runtime.getURL('sidebar.html') + '#k=' + token;
    document.documentElement.appendChild(frame);
    return frame;
  }

  function setOpen(next) {
    build();
    open = next === true ? true : next === false ? false : !open;
    frame.dataset.state = open ? 'open' : 'closed';
    applyWidth();
    if (open) {
      setTimeout(() => {
        post({
          type: 'GB_HELLO',
          settings,
          stats: lastStats,
          items: lastItems,
          logs,
          url: location.href,
          title: document.title,
          host: location.hostname,
          adapter: settings.adapter === 'auto' ? window.GBAdapterFor(location.hostname) : settings.adapter
        });
      }, 240);
    }
    chrome.runtime.sendMessage({ type: 'GB_SIDEBAR_STATE', open }).catch(() => {});
  }

  function onItems(kept, stats, all) {
    lastItems = kept;
    lastStats = stats;
    post({ type: 'GB_ITEMS', items: kept, stats, allCount: all.length });
    chrome.runtime.sendMessage({ type: 'GB_STATS', kept: stats.kept, found: stats.found }).catch(() => {});
  }

  function boot(next) {
    settings = effective(next);
    applyWidth();
    engine = window.GBHarvest.create({ settings, onItems, onLog: log });
    chrome.runtime.sendMessage({ type: 'GB_GET_NET' }).then((res) => {
      if (res && res.ok && res.list) {
        netList = res.list;
        engine.setNet(netList);
      }
    }).catch(() => {});
    log('Grabo siap di ' + location.hostname + '.');
    if (settings.autoWatch) watch();
  }

  const rescan = U.debounce(() => {
    if (!engine || engine.scanning || !settings.enabled) return;
    engine.scan({});
  }, 900);

  function watch() {
    const mo = new MutationObserver((recs) => {
      let media = false;
      for (const r of recs) {
        for (const n of r.addedNodes) {
          if (n.nodeType !== 1) continue;
          if (n.closest && n.closest('[data-gb-ignore]')) continue;
          const tag = n.tagName;
          if (tag === 'IMG' || tag === 'VIDEO' || tag === 'AUDIO' || tag === 'PICTURE' || tag === 'CANVAS') { media = true; break; }
          if (n.querySelector && n.querySelector('img, video, audio, picture, canvas')) { media = true; break; }
        }
        if (media) break;
      }
      if (media) rescan();
    });
    mo.observe(document.documentElement, { childList: true, subtree: true });
  }

  /* ---------- perintah dari sidebar (postMessage) ---------- */
  window.addEventListener('message', async (ev) => {
    const d = ev.data;
    if (!d || d.channel !== CHANNEL || d.token !== token || ev.source !== (frame && frame.contentWindow)) return;
    if (d.type === 'GB_READY') {
      post({
        type: 'GB_HELLO', settings, stats: lastStats, items: lastItems, logs,
        url: location.href, title: document.title, host: location.hostname,
        adapter: settings.adapter === 'auto' ? window.GBAdapterFor(location.hostname) : settings.adapter
      });
      return;
    }
    if (d.type === 'GB_PATCH') {
      settings = effective(Object.assign({}, settings, d.patch));
      persist(d.patch);
      applyWidth();
      if (engine) { engine.setSettings(settings); engine.report(); }
      return;
    }
    if (d.type === 'GB_SCAN') {
      if (!settings.enabled) { log('Grabo sedang nonaktif.'); return; }
      post({ type: 'GB_BUSY', busy: true, label: 'Memanen…' });
      const adapter = settings.adapter === 'auto' ? window.GBAdapterFor(location.hostname) : settings.adapter;
      await engine.scan({ scroll: !!d.scroll, adapter: d.adapter === false ? null : adapter });
      post({ type: 'GB_BUSY', busy: false });
      return;
    }
    if (d.type === 'GB_SELECT') { engine.select(d.id, d.on); return; }
    if (d.type === 'GB_SELECT_ALL') { engine.selectAll(d.on); return; }
    if (d.type === 'GB_REMOVE') { engine.remove(d.id); return; }
    if (d.type === 'GB_CLEAR') { engine.clear(); log('Daftar panen dikosongkan.'); return; }
    if (d.type === 'GB_CLOSE') { setOpen(false); return; }
    if (d.type === 'GB_REFRESH_NET') {
      const res = await chrome.runtime.sendMessage({ type: 'GB_GET_NET' }).catch(() => null);
      if (res && res.ok) { netList = res.list || []; engine.setNet(netList); log(netList.length + ' URL jaringan dimuat.'); }
      return;
    }
  });

  /* ---------- perintah dari service worker / Studio ---------- */
  chrome.runtime.onMessage.addListener((msg, sender, respond) => {
    if (!msg || typeof msg.type !== 'string') return;

    if (msg.type === 'GB_TOGGLE') { setOpen(msg.open); respond({ ok: true, open }); return; }
    if (msg.type === 'GB_STATE') { respond({ ok: true, open, stats: lastStats, items: lastItems, settings }); return; }

    if (msg.type === 'GB_SETTINGS_CHANGED') {
      settings = effective(msg.settings || {});
      applyWidth();
      if (engine) { engine.setSettings(settings); engine.report(); }
      return;
    }

    if (msg.type === 'GB_DO_SCAN') {
      const adapter = settings.adapter === 'auto' ? window.GBAdapterFor(location.hostname) : settings.adapter;
      engine.scan({ scroll: !!msg.scroll, adapter }).then((stats) => {
        respond({ ok: true, stats, items: lastItems });
      }).catch((e) => respond({ ok: false, error: String(e) }));
      return true;
    }

    if (msg.type === 'GB_DO_SETTINGS') {
      settings = effective(Object.assign({}, settings, msg.patch || {}));
      applyWidth();
      if (engine) { engine.setSettings(settings); engine.report(); }
      respond({ ok: true });
      return;
    }

    /* Pembacaan byte dari konteks halaman: blob:, data:, atau URL yang butuh sesi halaman. */
    if (msg.type === 'GB_PAGE_READ') {
      (async () => {
        const jobId = msg.jobId;
        try {
          const out = await engine.readPageBytes(msg.url);
          const CH = 3 * 1024 * 1024;
          const total = out.bytes.length;
          if (total === 0) throw new Error('berkas kosong');
          for (let i = 0, seq = 0; i < total; i += CH, seq++) {
            const part = out.bytes.subarray(i, i + CH);
            await chrome.runtime.sendMessage({
              type: 'GB_PAGE_CHUNK', jobId, seq,
              data: U.b64FromBytes(part),
              done: i + CH >= total,
              mime: out.mime,
              total
            }).catch(() => {});
          }
          respond({ ok: true, total, mime: out.mime });
        } catch (e) {
          chrome.runtime.sendMessage({ type: 'GB_PAGE_CHUNK', jobId, error: String(e && e.message || e), done: true }).catch(() => {});
          respond({ ok: false, error: String(e && e.message || e) });
        }
      })();
      return true;
    }
  });

  chrome.runtime.sendMessage({ type: 'GB_GET_SETTINGS' }).then((res) => {
    boot(res && res.ok ? res.settings : {});
  }).catch(() => boot({}));
})();