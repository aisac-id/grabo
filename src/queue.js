/* Grabo — mesin antrian massal.
 * Berjalan di halaman Studio (bukan service worker) supaya tetap hidup
 * selama panen besar, penulisan folder, dan penggabungan segmen video. */
(function (root) {
  'use strict';
  const U = root.GB;

  const ACTIVE = ['queued', 'running'];

  function create(opts) {
    const store = opts.store;
    const writer = opts.writer;
    const read = opts.read;                 // read(item, url, headers) → Uint8Array
    const log = opts.onLog || function () {};
    const emit = opts.onState || function () {};

    const cfg = Object.assign({ concurrency: 2, gap: 400, retries: 2, dedup: true, quality: 'best', maxSegs: 4000 }, opts.settings || {});
    const pacer = U.makePacer();
    const jobs = [];
    const byId = new Map();
    const streams = new Map();
    let running = false;
    let paused = false;
    let workers = 0;
    let seq = 0;
    let startedAt = 0;
    let finishedAt = 0;
    const window_ = [];                     // {at, bytes} untuk throughput bergulir
    let lastEmit = 0;
    let persistTimer = 0;

    function touch(force) {
      const now = Date.now();
      if (force || now - lastEmit > 120) { lastEmit = now; emit(snapshot()); }
      if (!persistTimer) {
        persistTimer = setTimeout(() => {
          persistTimer = 0;
          persist().catch(() => {});
        }, 700);
      }
    }

    async function persist() {
      await store.putJobs(jobs.map(strip));
    }

    function strip(j) {
      const c = Object.assign({}, j);
      delete c._live;
      return c;
    }

    function snapshot() {
      const counts = { queued: 0, running: 0, done: 0, failed: 0, skipped: 0, protected: 0, paused: 0 };
      let bytes = 0, totalBytes = 0;
      for (const j of jobs) {
        counts[j.state] = (counts[j.state] || 0) + 1;
        if (j.state === 'done') bytes += j.bytes || 0;
        totalBytes += j.bytes || 0;
      }
      const rate = throughput();
      const left = counts.queued + counts.running;
      const avg = counts.done ? bytes / counts.done : 0;
      const eta = rate > 0 && avg > 0 ? (left * avg) / rate * 1000 : 0;
      return {
        running, paused, workers,
        counts, total: jobs.length,
        bytes, totalBytes, rate, eta,
        elapsed: startedAt ? (finishedAt || Date.now()) - startedAt : 0,
        jobs: jobs.map(strip)
      };
    }

    function throughput() {
      const now = Date.now();
      while (window_.length && now - window_[0].at > 15000) window_.shift();
      if (window_.length < 2) return 0;
      const span = (now - window_[0].at) / 1000;
      if (span <= 0.2) return 0;
      return window_.reduce((a, b) => a + b.bytes, 0) / span;
    }

    async function load() {
      const saved = await store.allJobs();
      for (const j of saved) {
        if (j.state === 'running') { j.state = 'queued'; j.progress = 0; }
        jobs.push(j);
        byId.set(j.id, j);
        seq = Math.max(seq, j.n || 0);
      }
      if (jobs.length) log('Antrian dipulihkan: ' + jobs.length + ' pekerjaan.');
      touch(true);
      return jobs.length;
    }

    function makeJob(it) {
      seq++;
      return {
        id: U.uid('q'),
        n: seq,
        url: it.url,
        norm: U.normUrl(it.url),
        pageUrl: it.pageUrl || '',
        pageTitle: it.pageTitle || '',
        pageTabId: it.tabId || null,
        host: it.host || U.hostOf(it.url),
        kind: it.kind || U.kindOf(it.url, it.mime),
        source: it.source || 'dom',
        name: it.name || U.nameOf(it.url),
        mime: it.mime || '',
        w: it.w || 0, h: it.h || 0,
        bytes: it.bytes || 0,
        note: it.note || '',
        state: 'queued',
        attempts: 0,
        progress: 0,
        segments: 0,
        error: '',
        out: '',
        hash: '',
        createdAt: Date.now(),
        startedAt: 0,
        finishedAt: 0
      };
    }

    /* items → pekerjaan baru. Duplikat URL dibuang di sini, duplikat isi nanti setelah hash. */
    function add(items) {
      const seen = new Set(jobs.filter((j) => j.state !== 'failed').map((j) => j.norm));
      const added = [];
      let dupes = 0;
      for (const it of items || []) {
        if (!it || !it.url) continue;
        const norm = U.normUrl(it.url);
        if (seen.has(norm)) { dupes++; continue; }
        seen.add(norm);
        const j = makeJob(it);
        jobs.push(j);
        byId.set(j.id, j);
        added.push(j);
      }
      if (added.length) log(added.length + ' masuk antrian' + (dupes ? ', ' + dupes + ' duplikat dilewati' : '') + '.');
      touch(true);
      return { added: added.length, dupes };
    }

    async function alreadyHave(hash) {
      if (!cfg.dedup || !hash) return false;
      return store.hasHash(hash);
    }

    function ctxFor(j, extra) {
      return Object.assign({
        url: j.url, pageUrl: j.pageUrl, pageTitle: j.pageTitle, host: j.host,
        kind: j.kind, source: j.source, name: j.name, mime: j.mime,
        w: j.w, h: j.h, n: j.n, hash: j.hash, ext: extra && extra.ext
      }, extra || {});
    }

    async function process(j) {
      j.state = 'running';
      j.startedAt = Date.now();
      j.error = '';
      j.progress = 0;
      touch(true);
      await pacer.wait(j.host, cfg.gap);
      if (paused || !running) { j.state = 'queued'; touch(true); return; }

      let bytes, mime = j.mime, ext = U.extOf(j.url, j.mime), segments = 0;
      if (j.kind === 'playlist') {
        const st = root.GBStream.create({
          read: (url, headers) => read(j, url, headers),
          onLog: (m) => log('[' + j.host + '] ' + m),
          maxSegs: cfg.maxSegs,
          quality: cfg.quality
        });
        streams.set(j.id, st);
        const res = await st.resolve(j.url, (done, total, got) => {
          j.progress = total ? done / total : 0;
          j.segments = done;
          j.bytes = got;
          touch();
        });
        streams.delete(j.id);
        if (res.protected) {
          j.state = 'protected';
          j.error = res.reason;
          j.finishedAt = Date.now();
          log('Dilewati (terproteksi): ' + j.name + ' — ' + res.reason);
          touch(true);
          return;
        }
        bytes = res.bytes; mime = res.mime; ext = res.ext; segments = res.segments;
        if (res.w) j.w = res.w;
        if (res.h) j.h = res.h;
      } else {
        bytes = await read(j, j.url, null);
      }
      if (!bytes || !bytes.length) throw new Error('isi kosong');
      /* Byte ajaib adalah bukti jenis berkas yang paling jujur: pakai untuk melengkapi
       * ekstensi dan mime yang tidak diketahui (mis. item DOM tanpa jejak jaringan). */
      const guess = U.sniff(bytes);
      if (guess) {
        if (ext === 'bin' || !ext) ext = guess.ext;
        if (!mime) mime = guess.mime;
      }
      j.bytes = bytes.length;
      j.progress = 0.9;
      touch();

      const hash = await U.sha256Hex(bytes);
      j.hash = hash;
      if (await alreadyHave(hash)) {
        j.state = 'skipped';
        j.error = 'isi identik sudah tersimpan';
        j.finishedAt = Date.now();
        touch(true);
        return;
      }
      const out = await writer.write(bytes, mime, ctxFor(j, { ext, segments }));
      j.out = out;
      j.mime = mime;
      j.segments = segments;
      j.state = 'done';
      j.progress = 1;
      j.finishedAt = Date.now();
      window_.push({ at: Date.now(), bytes: bytes.length });
      if (cfg.dedup) await store.addHash(hash, { name: j.name, out, bytes: bytes.length });
      touch(true);
    }

    async function attempt(j) {
      const max = Math.max(0, cfg.retries) + 1;
      for (let k = 0; k < max; k++) {
        j.attempts = k + 1;
        try {
          await process(j);
          return;
        } catch (e) {
          const msg = String((e && e.message) || e);
          streams.delete(j.id);
          if (/dibatalkan/.test(msg)) { j.state = 'queued'; j.progress = 0; touch(true); return; }
          if (/terproteksi|DRM/.test(msg)) { j.state = 'protected'; j.error = msg; j.finishedAt = Date.now(); touch(true); return; }
          const fatal = /401|403|404|410|izin folder/.test(msg);
          if (k + 1 >= max || fatal) {
            j.state = 'failed';
            j.error = msg;
            j.finishedAt = Date.now();
            log('Gagal: ' + j.name + ' — ' + msg);
            touch(true);
            return;
          }
          const back = Math.min(8000, 600 * Math.pow(2, k));
          log('Coba lagi (' + (k + 2) + '/' + max + ') setelah ' + back + 'ms: ' + j.name);
          touch(true);
          await U.sleep(back);
          if (!running) { j.state = 'queued'; touch(true); return; }
        }
      }
    }

    function nextJob() {
      return jobs.find((j) => j.state === 'queued');
    }

    async function worker() {
      workers++;
      try {
        for (;;) {
          if (!running) break;
          if (paused) { await U.sleep(200); continue; }
          const j = nextJob();
          if (!j) break;
          await attempt(j);
        }
      } finally {
        workers--;
        if (workers === 0 && running && !paused && !nextJob()) await finish();
        else touch(true);
      }
    }

    async function finish() {
      running = false;
      finishedAt = Date.now();
      try { await writer.flushManifest(); } catch (e) { log('Manifest gagal ditulis: ' + e.message); }
      await persist();
      const done = jobs.filter((j) => j.state === 'done');
      const total = done.reduce((a, b) => a + (b.bytes || 0), 0);
      log('Selesai: ' + done.length + ' berkas, ' + U.bytes(total) + '.');
      try {
        chrome.runtime.sendMessage({ type: 'GB_TOTALS', files: done.length, bytes: total });
      } catch (e) { /* studio tanpa latar */ }
      touch(true);
    }

    function start() {
      if (running && !paused) return false;
      if (!nextJob()) { log('Tidak ada pekerjaan yang menunggu.'); return false; }
      paused = false;
      running = true;
      finishedAt = 0;
      if (!startedAt) startedAt = Date.now();
      const n = U.clamp(cfg.concurrency, 1, 4);
      log('Antrian jalan: ' + n + ' pekerja, jeda ' + cfg.gap + 'ms per host.');
      touch(true);
      for (let i = 0; i < n; i++) worker();
      return true;
    }

    function pause() {
      if (!running) return false;
      paused = true;
      for (const st of streams.values()) st.cancel();
      log('Antrian dijeda. Pekerjaan aktif dikembalikan ke antrean.');
      touch(true);
      return true;
    }

    function resume() {
      if (!paused) return start();
      paused = false;
      for (const st of streams.values()) st.reset();
      const need = U.clamp(cfg.concurrency, 1, 4) - workers;
      for (let i = 0; i < need; i++) worker();
      log('Antrian dilanjutkan.');
      touch(true);
      return true;
    }

    function cancel() {
      running = false;
      paused = false;
      for (const st of streams.values()) st.cancel();
      for (const j of jobs) {
        if (ACTIVE.includes(j.state)) { j.state = 'queued'; j.progress = 0; }
      }
      finishedAt = Date.now();
      log('Antrian dihentikan.');
      touch(true);
      persist().catch(() => {});
    }

    function retryFailed() {
      let n = 0;
      for (const j of jobs) {
        if (j.state === 'failed') { j.state = 'queued'; j.error = ''; j.attempts = 0; j.progress = 0; n++; }
      }
      if (n) log(n + ' pekerjaan gagal dimasukkan ulang.');
      touch(true);
      return n;
    }

    function remove(id) {
      const j = byId.get(id);
      if (!j) return false;
      if (j.state === 'running') { const st = streams.get(id); if (st) st.cancel(); }
      byId.delete(id);
      const i = jobs.indexOf(j);
      if (i >= 0) jobs.splice(i, 1);
      store.delJobs([id]).catch(() => {});
      touch(true);
      return true;
    }

    function clear(states) {
      const keep = [];
      const drop = [];
      for (const j of jobs) {
        if (!states || states.includes(j.state)) drop.push(j.id);
        else keep.push(j);
      }
      jobs.length = 0;
      byId.clear();
      for (const j of keep) { jobs.push(j); byId.set(j.id, j); }
      if (drop.length) store.delJobs(drop).catch(() => {});
      log(drop.length + ' pekerjaan dibersihkan.');
      touch(true);
      return drop.length;
    }

    async function clearAll() {
      cancel();
      jobs.length = 0;
      byId.clear();
      seq = 0;
      await store.clearJobs();
      touch(true);
    }

    function configure(next) {
      Object.assign(cfg, next || {});
      pacer.reset();
    }

    return {
      cfg, jobs, snapshot, load, add, start, pause, resume, cancel,
      retryFailed, remove, clear, clearAll, configure, persist,
      get running() { return running; },
      get paused() { return paused; }
    };
  }

  root.GBQueue = { create, ACTIVE };
})(globalThis);