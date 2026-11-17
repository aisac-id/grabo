/* Grabo — mesin panen di konteks halaman.
 * Menemukan media dari DOM, metadata, CSS, canvas, dan URL yang terlihat di jaringan. */
(function (root) {
  'use strict';
  const U = root.GB;

  const LAZY_ATTRS = ['data-src', 'data-lazy', 'data-lazy-src', 'data-original', 'data-url',
    'data-image', 'data-full', 'data-hi-res', 'data-large', 'data-srcset', 'data-bg', 'data-background'];
  const SMALL_HINT = /(thumb|thumbnail|icon|avatar|emoji|sprite|spacer|blank|placeholder|1x1|pixel|beacon|badge|logo-)/i;
  const META_KEYS = ['og:image', 'og:image:secure_url', 'og:video', 'og:video:url', 'og:video:secure_url',
    'twitter:image', 'twitter:image:src', 'twitter:player:stream', 'og:audio'];

  function pickSrcset(list) {
    if (!list) return [];
    return String(list).split(',').map((part) => {
      const bits = part.trim().split(/\s+/);
      const url = bits[0];
      let w = 0;
      const d = bits[1] || '';
      if (/^\d+w$/.test(d)) w = parseInt(d, 10);
      else if (/^[\d.]+x$/.test(d)) w = Math.round(parseFloat(d) * 1000);
      return { url, w };
    }).filter((x) => x.url);
  }

  function bestSrcset(list) {
    const all = pickSrcset(list);
    if (!all.length) return '';
    return all.sort((a, b) => b.w - a.w)[0].url;
  }

  function visible(el) {
    if (!el.getClientRects || !el.getClientRects().length) return false;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return false;
    const st = getComputedStyle(el);
    return st.visibility !== 'hidden' && st.display !== 'none' && Number(st.opacity) > 0.05;
  }

  function create(opts) {
    let settings = opts.settings;
    const onItems = opts.onItems || function () {};
    const onLog = opts.onLog || function () {};
    const items = new Map();
    let netUrls = [];
    let scanning = false;
    let lastReport = { found: 0, kept: 0, byKind: {}, bySource: {}, dropped: {} };

    function key(url) { return U.normUrl(url); }

    function add(raw) {
      const url = raw.url;
      if (!url) return false;
      if (/^javascript:/i.test(url)) return false;
      /* data: URL bisa sangat panjang (kanvas PNG); batas panjang hanya untuk URL biasa. */
      if (!/^data:/i.test(url) && url.length > 4000) return false;
      if (url.length > 12000000) return false;
      const k = key(url);
      const kind = raw.kind && raw.kind !== 'other' ? raw.kind : U.kindOf(url, raw.mime);
      if (kind === 'other') return false;
      const prev = items.get(k);
      if (prev) {
        /* Gabungkan bukti: ukuran terbesar dan sumber paling informatif yang menang. */
        let touched = false;
        if ((raw.w || 0) > (prev.w || 0)) { prev.w = raw.w; prev.h = raw.h; touched = true; }
        if ((raw.bytes || 0) > (prev.bytes || 0)) { prev.bytes = raw.bytes; touched = true; }
        if (!prev.mime && raw.mime) { prev.mime = raw.mime; touched = true; }
        if (raw.source === 'dom' && prev.source === 'net') { prev.source = 'dom'; touched = true; }
        if (raw.note && !prev.note) { prev.note = raw.note; touched = true; }
        if (!prev.sources.includes(raw.source)) { prev.sources.push(raw.source); touched = true; }
        return touched;
      }
      items.set(k, {
        id: U.uid('m'),
        url,
        kind,
        mime: raw.mime || '',
        w: raw.w || 0,
        h: raw.h || 0,
        bytes: raw.bytes || 0,
        source: raw.source || 'dom',
        sources: [raw.source || 'dom'],
        name: raw.name || U.nameOf(url),
        note: raw.note || '',
        pageUrl: location.href,
        pageTitle: document.title || location.hostname,
        host: U.hostOf(url),
        selected: true,
        at: Date.now()
      });
      return true;
    }

    /* ---------- sumber: DOM ---------- */
    function fromDom() {
      const base = location.href;
      const push = (u, extra) => {
        if (!u) return;
        const url = U.abs(u, base);
        if (url) add(Object.assign({ url }, extra || {}));
      };

      document.querySelectorAll('img').forEach((el) => {
        if (el.closest('[data-gb-ignore]')) return;
        /* Gambar yang gagal dimuat punya kotak sebesar teks alt-nya, bukan ukuran aslinya.
         * Perlakukan dimensinya sebagai "belum diketahui" agar tidak dibuang sebagai berkas kecil. */
        const failed = el.complete && !el.naturalWidth;
        const w = failed ? 0 : (el.naturalWidth || el.width || 0);
        const h = failed ? 0 : (el.naturalHeight || el.height || 0);
        const vis = visible(el);
        const best = bestSrcset(el.getAttribute('srcset')) || el.currentSrc || el.getAttribute('src');
        push(best, { kind: 'image', w, h, source: 'dom', note: failed ? 'gagal dimuat' : vis ? '' : 'tersembunyi' });
        pickSrcset(el.getAttribute('srcset')).forEach((c) => {
          if (c.url !== best) push(c.url, { kind: 'image', source: 'dom', note: 'varian srcset' });
        });
        LAZY_ATTRS.forEach((a) => {
          const v = el.getAttribute(a);
          if (!v) return;
          if (a === 'data-srcset') push(bestSrcset(v), { kind: 'image', source: 'dom', note: 'lazy' });
          else push(v, { kind: 'image', source: 'dom', note: 'lazy' });
        });
      });

      document.querySelectorAll('picture source, video source, audio source').forEach((el) => {
        const best = bestSrcset(el.getAttribute('srcset')) || el.getAttribute('src');
        const parent = el.parentElement;
        const kind = parent && parent.tagName === 'AUDIO' ? 'audio'
          : el.getAttribute('type') ? U.kindOf('', el.getAttribute('type')) : undefined;
        push(best, { kind, mime: el.getAttribute('type') || '', source: 'dom' });
      });

      document.querySelectorAll('video, audio').forEach((el) => {
        const isVid = el.tagName === 'VIDEO';
        const kind = isVid ? 'video' : 'audio';
        push(el.currentSrc || el.getAttribute('src'), {
          kind, source: 'dom', w: el.videoWidth || 0, h: el.videoHeight || 0,
          note: el.currentSrc && el.currentSrc.startsWith('blob:') ? 'blob media' : ''
        });
        if (isVid) push(el.getAttribute('poster'), { kind: 'image', source: 'dom', note: 'poster video' });
        el.querySelectorAll('track').forEach(() => {});
      });

      document.querySelectorAll('a[href]').forEach((el) => {
        const href = el.getAttribute('href') || '';
        const kind = U.kindOf(href, '');
        if (kind === 'other' && !el.hasAttribute('download')) return;
        push(href, { kind: kind === 'other' ? undefined : kind, source: 'dom', note: 'tautan unduhan' });
      });

      document.querySelectorAll('input[type="image"][src]').forEach((el) => {
        push(el.getAttribute('src'), { kind: 'image', source: 'dom' });
      });

      document.querySelectorAll('object[data], embed[src]').forEach((el) => {
        push(el.getAttribute('data') || el.getAttribute('src'), { source: 'dom' });
      });

      document.querySelectorAll('svg image').forEach((el) => {
        push(el.getAttribute('href') || el.getAttribute('xlink:href'), { kind: 'image', source: 'dom' });
      });

      if (settings.sources.css) {
        const nodes = document.querySelectorAll('*');
        let budget = 4000;
        for (const el of nodes) {
          if (budget-- <= 0) break;
          if (el.closest('[data-gb-ignore]')) continue;
          const bg = getComputedStyle(el).backgroundImage;
          if (!bg || bg === 'none' || !bg.includes('url(')) continue;
          const urls = bg.match(/url\((['"]?)(.*?)\1\)/g) || [];
          urls.forEach((chunk) => {
            const m = /url\((['"]?)(.*?)\1\)/.exec(chunk);
            if (m && m[2] && !/^data:image\/svg/.test(m[2])) push(m[2], { kind: 'image', source: 'css', note: 'background CSS' });
          });
        }
      }

      if (settings.sources.canvas) {
        document.querySelectorAll('canvas').forEach((el, i) => {
          if (el.width < 32 || el.height < 32) return;
          try {
            const data = el.toDataURL('image/png');
            if (data && data.length > 2000) {
              add({ url: data, kind: 'image', w: el.width, h: el.height, source: 'canvas',
                name: 'canvas-' + (i + 1) + '.png', bytes: Math.round(data.length * 0.75) });
            }
          } catch (e) {
            onLog('Canvas ke-' + (i + 1) + ' terkunci lintas-origin, dilewati.');
          }
        });
      }
    }

    /* ---------- sumber: metadata ---------- */
    function fromMeta() {
      document.querySelectorAll('meta').forEach((el) => {
        const k = (el.getAttribute('property') || el.getAttribute('name') || '').toLowerCase();
        if (!META_KEYS.includes(k)) return;
        const v = el.getAttribute('content');
        if (v) add({ url: U.abs(v, location.href), source: 'meta', note: k });
      });
      document.querySelectorAll('link[rel~="preload"], link[rel~="image_src"], link[rel~="icon"]').forEach((el) => {
        const as = el.getAttribute('as');
        if (as && as !== 'image' && as !== 'video' && as !== 'audio') return;
        const href = el.getAttribute('href');
        if (href) add({ url: U.abs(href, location.href), source: 'meta', note: 'link ' + (el.getAttribute('rel') || '') });
        const set = el.getAttribute('imagesrcset');
        if (set) add({ url: U.abs(bestSrcset(set), location.href), source: 'meta', note: 'preload srcset' });
      });
    }

    /* ---------- sumber: jaringan (dikirim service worker) ---------- */
    function fromNet() {
      netUrls.forEach((n) => {
        add({ url: n.url, mime: n.mime || '', bytes: n.bytes || 0, kind: n.kind, source: 'net', note: 'terlihat di jaringan' });
      });
    }

    /* ---------- penyaringan ---------- */
    function pass(it) {
      const f = settings.filters;
      if (!f.kinds[it.kind === 'playlist' ? 'video' : it.kind]) return 'jenis';
      if (it.kind === 'image' && f.minW && it.w && it.w < f.minW) return 'lebar';
      if (it.kind === 'image' && f.minH && it.h && it.h < f.minH) return 'tinggi';
      if (f.minBytes && it.bytes && it.bytes < f.minBytes) return 'ukuran';
      if (f.skipSmall && it.w && it.h && (it.w < 64 || it.h < 64)) return 'kecil';
      if (f.skipThumbs && SMALL_HINT.test(it.url) && !(it.w >= 400 || it.bytes > 120000)) return 'thumbnail';
      if (f.onlyVisible && it.note === 'tersembunyi') return 'tak terlihat';
      if (f.exclude.length && U.matchAny(f.exclude, it.url)) return 'dikecualikan';
      if (f.include.length && !U.matchAny(f.include, it.url)) return 'tak cocok';
      return '';
    }

    function report() {
      const all = Array.from(items.values());
      const kept = [];
      const dropped = {};
      const byKind = {};
      const bySource = {};
      all.forEach((it) => {
        const why = pass(it);
        it.dropped = why;
        if (why) { dropped[why] = (dropped[why] || 0) + 1; return; }
        kept.push(it);
        byKind[it.kind] = (byKind[it.kind] || 0) + 1;
        bySource[it.source] = (bySource[it.source] || 0) + 1;
      });
      kept.sort((a, b) => (b.w * b.h || b.bytes || 0) - (a.w * a.h || a.bytes || 0) || a.url.localeCompare(b.url));
      lastReport = { found: all.length, kept: kept.length, byKind, bySource, dropped };
      onItems(kept, lastReport, all);
      return kept;
    }

    /* ---------- pengukuran dimensi untuk item jaringan ---------- */
    async function probeDims(limit) {
      const todo = Array.from(items.values())
        .filter((it) => it.kind === 'image' && !it.w && !/^data:/.test(it.url) && !/^blob:/.test(it.url))
        .slice(0, limit || 60);
      let i = 0;
      async function worker() {
        while (i < todo.length) {
          const it = todo[i++];
          await new Promise((res) => {
            const im = new Image();
            const done = () => res();
            im.onload = () => { it.w = im.naturalWidth; it.h = im.naturalHeight; done(); };
            im.onerror = done;
            setTimeout(done, 4000);
            im.src = it.url;
          });
        }
      }
      await Promise.all([worker(), worker(), worker(), worker()]);
    }

    /* ---------- gulir otomatis untuk galeri malas-muat ---------- */
    async function autoScroll(depth, loadMore) {
      const startY = window.scrollY;
      const step = Math.max(400, Math.round(innerHeight * 0.85));
      for (let i = 0; i < depth; i++) {
        window.scrollBy(0, step);
        await U.sleep(settings.scrollDelay || 450);
        fromDom();
        if (loadMore) {
          const btn = Array.from(document.querySelectorAll('button, a[role="button"], [role="button"]'))
            .find((b) => visible(b) && /muat lebih|load more|tampilkan lebih|show more|lihat lebih|more results/i.test(b.textContent || ''));
          if (btn) { btn.click(); await U.sleep(settings.scrollDelay || 450); fromDom(); }
        }
        if (window.scrollY + innerHeight >= document.documentElement.scrollHeight - 4) {
          await U.sleep(300);
          fromDom();
          if (window.scrollY + innerHeight >= document.documentElement.scrollHeight - 4) break;
        }
      }
      window.scrollTo(0, startY);
    }

    async function scan(options) {
      if (scanning) return lastReport;
      scanning = true;
      const o = options || {};
      try {
        if (settings.sources.net) fromNet();
        if (settings.sources.meta) fromMeta();
        if (settings.sources.dom) fromDom();
        if (o.adapter && root.GBAdapters && root.GBAdapters[o.adapter]) {
          const extra = await root.GBAdapters[o.adapter].harvest({ add, log: onLog, settings });
          if (extra) onLog('Adapter ' + o.adapter + ' menambah ' + extra + ' kandidat.');
        }
        if (o.scroll && settings.scrollDepth > 0) {
          onLog('Menggulir halaman ' + settings.scrollDepth + ' langkah untuk memuat media malas-muat…');
          await autoScroll(settings.scrollDepth, settings.loadMore);
        }
        if (settings.probeDims) await probeDims(settings.probeLimit);
        const kept = report();
        onLog('Panen selesai: ' + kept.length + ' lolos dari ' + items.size + ' kandidat.');
        return lastReport;
      } finally {
        scanning = false;
      }
    }

    /* blob: dan data: hanya bisa dibaca dari konteks halaman. */
    async function readPageBytes(url) {
      const res = await fetch(url, { credentials: 'include' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const buf = await res.arrayBuffer();
      return { bytes: new Uint8Array(buf), mime: res.headers.get('content-type') || '' };
    }

    return {
      scan,
      report,
      add,
      setSettings(next) { settings = next; },
      setNet(list) { netUrls = Array.isArray(list) ? list : []; },
      readPageBytes,
      selectAll(on) { items.forEach((it) => { it.selected = !!on; }); return report(); },
      select(id, on) { const it = items.get(key(id)) || Array.from(items.values()).find((x) => x.id === id); if (it) it.selected = !!on; return report(); },
      clear() { items.clear(); return report(); },
      remove(id) {
        const it = Array.from(items.values()).find((x) => x.id === id);
        if (it) items.delete(key(it.url));
        return report();
      },
      all() { return Array.from(items.values()); },
      stats() { return lastReport; },
      get scanning() { return scanning; }
    };
  }

  root.GBHarvest = { create, bestSrcset, pickSrcset };
})(globalThis);