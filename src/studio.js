/* Grabo Studio — tuan rumah mesin.
 * Halaman ekstensi tingkat atas: boleh membuka pemilih folder, membaca byte,
 * menggabungkan segmen video, dan menjaga antrian tetap hidup. */
(function () {
  'use strict';
  const U = window.GB;
  const I = window.GBIcons;
  const S = window.GBSound;
  const $ = (id) => document.getElementById(id);

  const TABS = [
    { id: 'queue', label: 'Antrian', icon: 'queue' },
    { id: 'links', label: 'Tautan massal', icon: 'links' },
    { id: 'bluesky', label: 'Bluesky', icon: 'bsky' },
    { id: 'output', label: 'Folder & nama', icon: 'folder' },
    { id: 'video', label: 'Video', icon: 'film' },
    { id: 'manifest', label: 'Manifest', icon: 'doc' },
    { id: 'log', label: 'Catatan', icon: 'terminal' },
    { id: 'settings', label: 'Pengaturan', icon: 'cog' }
  ];

  let st = null;
  let writer = null;
  let queue = null;
  let tab = 'queue';
  let logs = [];
  let snap = null;
  let batch = { running: false, done: 0, total: 0 };
  let bskyCancel = false;
  let bskyItems = [];
  let lastBroadcast = 0;
  const pendingReads = new Map();
  const ranges = [], switches = [], selects = [], texts = [];

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function log(message) {
    logs.unshift({ message, ts: Date.now() });
    if (logs.length > 400) logs.length = 400;
    paintLog();
  }
  function cue(n) { S.play(n); }
  function bg(type, extra) { return chrome.runtime.sendMessage(Object.assign({ type }, extra || {})).catch(() => null); }

  async function saveSettings(patch) {
    const r = await bg('GB_SET_SETTINGS', { patch });
    if (r && r.ok) st = r.settings;
    applySettings();
    return st;
  }

  /* ---------- pembaca byte: tangga cadangan ---------- */
  async function pageRead(job, url) {
    if (!job.pageTabId) throw new Error('URL ini hanya bisa dibaca dari halaman asalnya, dan tab itu sudah tidak ada');
    const jobId = U.uid('rd');
    const box = { parts: [], mime: '', error: '' };
    pendingReads.set(jobId, box);
    try {
      const res = await chrome.tabs.sendMessage(job.pageTabId, { type: 'GB_PAGE_READ', jobId, url }).catch((e) => ({ ok: false, error: String(e && e.message || e) }));
      if (box.error) throw new Error(box.error);
      if (!res || !res.ok) throw new Error((res && res.error) || 'halaman menolak membaca');
      const bytes = U.concatBytes(box.parts);
      if (!bytes.length) throw new Error('isi kosong dari halaman');
      return bytes;
    } finally {
      pendingReads.delete(jobId);
    }
  }

  async function read(job, url, headers) {
    if (/^(blob:|data:)/i.test(url)) return pageRead(job, url);
    try {
      const res = await fetch(url, { credentials: 'include', headers: headers || undefined, redirect: 'follow' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const buf = await res.arrayBuffer();
      return new Uint8Array(buf);
    } catch (e) {
      if (job.pageTabId) {
        try { return await pageRead(job, url); }
        catch (e2) { throw new Error(e.message + ' (cadangan halaman: ' + e2.message + ')'); }
      }
      throw e;
    }
  }

  /* ---------- tab ---------- */
  function buildRail() {
    $('rail').innerHTML = TABS.map((t) =>
      '<button class="tab" role="tab" id="tab-' + t.id + '" data-tab="' + t.id + '" aria-selected="false" aria-controls="pane-' + t.id + '">' +
      I.svg(t.icon) + '<span>' + t.label + '</span><i id="badge-' + t.id + '"></i></button>').join('');
    $('rail').addEventListener('click', (e) => {
      const b = e.target.closest('.tab');
      if (b) setTab(b.dataset.tab, true);
    });
    $('rail').addEventListener('keydown', (e) => {
      const i = TABS.findIndex((t) => t.id === tab);
      if (e.key === 'ArrowDown') { setTab(TABS[(i + 1) % TABS.length].id, true); e.preventDefault(); }
      if (e.key === 'ArrowUp') { setTab(TABS[(i - 1 + TABS.length) % TABS.length].id, true); e.preventDefault(); }
    });
  }
  function setTab(id, sound) {
    if (!TABS.some((t) => t.id === id)) id = 'queue';
    tab = id;
    TABS.forEach((t) => {
      $('tab-' + t.id).setAttribute('aria-selected', String(t.id === id));
      $('pane-' + t.id).classList.toggle('on', t.id === id);
    });
    $('main').scrollTop = 0;
    if (sound) cue('tab');
    paint();
  }

  /* ---------- kendali ---------- */
  function fill(el) {
    const min = Number(el.min || 0), max = Number(el.max || 100);
    el.style.setProperty('--fill', ((Number(el.value) - min) / (max - min) * 100) + '%');
  }
  function bindRange(id, get, set, fmt, labelId) {
    const el = $(id);
    if (!el) return;
    const show = () => { fill(el); if (labelId && $(labelId)) $(labelId).textContent = fmt ? fmt(Number(el.value)) : el.value; };
    el.addEventListener('input', () => { show(); set(Number(el.value)); });
    el.addEventListener('change', () => cue('tick'));
    el._sync = () => { el.value = get(); show(); };
    ranges.push(el);
  }
  function bindSwitch(id, get, set) {
    const el = $(id);
    if (!el) return;
    el.addEventListener('change', () => { set(el.checked); cue('toggle'); });
    el._sync = () => { el.checked = !!get(); };
    switches.push(el);
  }
  function bindSelect(id, get, set) {
    const el = $(id);
    if (!el) return;
    el.addEventListener('change', () => { set(el.value); cue('tab'); });
    el._sync = () => { el.value = get(); };
    selects.push(el);
  }
  const ms = (v) => v + ' ms';
  const pct = (v) => v + '%';
  let autorun = false;
  let linkGap = 900;
  let bLimit = 200;

  function bindAll() {
    const setQ = (k) => (v) => { const p = {}; p[k] = v; saveSettings({ queue: p }); };
    bindRange('d-workers', () => st.queue.concurrency, setQ('concurrency'), null, 'd-v-workers');
    bindRange('d-gap', () => st.queue.gap, setQ('gap'), ms, 'd-v-gap');
    bindRange('d-retries', () => st.queue.retries, setQ('retries'), null, 'd-v-retries');
    bindRange('d-segs', () => st.video.maxSegs, (v) => saveSettings({ video: { maxSegs: v } }), null, 'd-v-segs');
    bindSelect('d-quality', () => st.video.quality, (v) => saveSettings({ video: { quality: v } }));
    bindSelect('d-mode', () => st.out.mode, (v) => setMode(v));
    bindSwitch('d-dedup', () => st.queue.dedup, setQ('dedup'));
    bindSwitch('d-manifest', () => st.out.manifest, (v) => saveSettings({ out: { manifest: v } }));
    bindSwitch('d-overwrite', () => st.queue.overwrite, setQ('overwrite'));
    bindSwitch('d-autorun', () => autorun, (v) => { autorun = v; });

    bindRange('s-workers', () => st.queue.concurrency, setQ('concurrency'), null, 's-v-workers');
    bindRange('s-gap', () => st.queue.gap, setQ('gap'), ms, 's-v-gap');
    bindRange('s-retries', () => st.queue.retries, setQ('retries'), null, 's-v-retries');
    bindSwitch('s-dedup', () => st.queue.dedup, setQ('dedup'));
    bindSwitch('s-sound', () => st.sound, (v) => setSound(v));
    bindRange('s-vol', () => st.volume == null ? 50 : st.volume, (v) => { S.setVolume(v / 100); saveSettings({ volume: v }); }, pct, 's-v-vol');
    bindRange('s-width', () => st.sidebarWidth, (v) => saveSettings({ sidebarWidth: v }), pct, 's-v-width');

    bindSelect('o-mode', () => st.out.mode, (v) => setMode(v));
    bindSwitch('o-manifest', () => st.out.manifest, (v) => saveSettings({ out: { manifest: v } }));
    bindSwitch('o-overwrite', () => st.queue.overwrite, setQ('overwrite'));
    bindSelect('v-quality', () => st.video.quality, (v) => saveSettings({ video: { quality: v } }));
    bindRange('v-segs', () => st.video.maxSegs, (v) => saveSettings({ video: { maxSegs: v } }), null, 'v-v-segs');
    bindRange('b-limit', () => bLimit, (v) => { bLimit = v; }, null, 'b-v-limit');
    bindRange('l-gap', () => linkGap, (v) => { linkGap = v; }, ms, 'l-v-gap');

    ['o-tpl', 'd-tpl'].forEach((id) => {
      const el = $(id);
      el.addEventListener('input', U.debounce(() => saveSettings({ out: { template: el.value } }), 380));
      texts.push(() => { if (document.activeElement !== el) el.value = st.out.template; });
    });
    const urls = $('l-urls');
    urls.addEventListener('input', () => { $('l-count').textContent = linkList().length + ' tautan'; });

    $('o-tokens').innerHTML = ['host', 'source', 'date', 'time', 'base', 'name', 'ext', 'n', 'w', 'h', 'hash8', 'kind', 'page']
      .map((t) => '<button class="chip" data-token="{' + t + '}">{' + t + '}</button>').join('');
    $('o-tokens').addEventListener('click', (e) => {
      const b = e.target.closest('[data-token]');
      if (!b) return;
      $('o-tpl').value += b.dataset.token;
      saveSettings({ out: { template: $('o-tpl').value } });
      cue('tick');
    });
  }

  function applySettings() {
    if (!writer || !queue) return;
    writer.setTemplate(st.out.template);
    writer.setMode(st.out.mode);
    writer.setOverwrite(st.queue.overwrite);
    writer.setManifest(st.out.manifest);
    queue.configure({
      concurrency: st.queue.concurrency, gap: st.queue.gap, retries: st.queue.retries,
      dedup: st.queue.dedup, quality: st.video.quality, maxSegs: st.video.maxSegs
    });
    S.setEnabled(st.sound !== false);
    S.setVolume((st.volume == null ? 50 : st.volume) / 100);
    paintSound();
    paint();
  }

  function setMode(v) {
    saveSettings({ out: { mode: v } }).then(() => {
      writer.setMode(v);
      paintOutput();
      broadcastFolder();
    });
  }

  function paintSound() {
    const b = $('btn-sound');
    b.innerHTML = I.svg(st.sound !== false ? 'sound' : 'mute');
    b.classList.toggle('on', st.sound !== false);
    b.setAttribute('aria-pressed', String(st.sound !== false));
    b.title = st.sound !== false ? 'Suara aktif — klik untuk membisukan' : 'Suara bisu — klik untuk mengaktifkan';
  }
  function setSound(v) {
    saveSettings({ sound: !!v }).then(() => { S.setEnabled(!!v); if (v) S.play('open'); paintSound(); });
  }

  /* ---------- folder ---------- */
  function broadcastFolder() {
    chrome.runtime.sendMessage({
      type: 'GB_FOLDER_CHANGED',
      name: writer.state.mode === 'fs' ? writer.state.rootName : 'Unduhan/Grabo',
      mode: writer.state.mode
    }).catch(() => {});
  }

  async function pickFolder() {
    try {
      const name = await writer.pickFolder();
      await saveSettings({ out: { folderName: name, mode: 'fs' } });
      cue('folder');
      paintOutput();
      broadcastFolder();
    } catch (e) {
      if (e && e.name === 'AbortError') { log('Pemilihan folder dibatalkan.'); return; }
      cue('fail');
      log('Gagal memilih folder: ' + e.message);
    }
  }

  async function allowFolder() {
    const p = await writer.permission(true);
    log('Izin folder: ' + p);
    cue(p === 'granted' ? 'done' : 'fail');
    paintOutput();
  }

  async function internalFolder() {
    const name = await writer.useInternal();
    await saveSettings({ out: { folderName: name, mode: 'fs' } });
    log('Memakai penyimpanan internal browser (OPFS) — API-nya sama dengan folder nyata.');
    cue('folder');
    paintOutput();
    broadcastFolder();
  }

  async function testWrite() {
    try {
      const bytes = new TextEncoder().encode('Grabo uji tulis ' + new Date().toISOString() + '\n');
      const out = await writer.write(bytes, 'text/plain', {
        url: 'https://uji.local/grabo.txt', name: 'grabo-uji.txt', ext: 'txt',
        host: 'uji.local', source: 'uji', kind: 'other', n: 1, hash: await U.sha256Hex(bytes)
      });
      log('Uji tulis berhasil: ' + out);
      cue('done');
      paintManifest();
    } catch (e) {
      log('Uji tulis gagal: ' + e.message);
      cue('fail');
    }
  }

  /* ---------- gambar ulang ---------- */
  function statCard(cls, v, label) { return '<div class="stat ' + cls + '"><b>' + v + '</b><small>' + label + '</small></div>'; }

  function paintQueue() {
    const s = snap || { counts: {}, total: 0, bytes: 0, rate: 0, eta: 0, workers: 0, jobs: [] };
    const c = s.counts || {};
    $('q-stats').innerHTML =
      statCard('a', (c.running || 0) + '/' + (s.workers || 0), 'pekerja aktif') +
      statCard('c', c.queued || 0, 'antre') +
      statCard('s', c.done || 0, 'selesai') +
      statCard('w', (c.failed || 0) + (c.protected || 0), 'gagal / dilindungi') +
      statCard('c', U.bytes(s.bytes || 0), 'data tertulis') +
      statCard('a', s.rate ? U.bytes(s.rate) + '/s' : '—', 'laju') +
      statCard('s', s.eta ? U.dur(s.eta) : '—', 'perkiraan sisa') +
      statCard('w', (c.skipped || 0), 'isi kembar');
    const jobs = s.jobs || [];
    $('q-list').innerHTML = jobs.slice(0, 200).map((j) => {
      const label = { queued: 'antre', running: 'jalan', done: 'selesai', failed: 'gagal', skipped: 'kembar', protected: 'terproteksi' }[j.state] || j.state;
      const sub = (j.state === 'failed' || j.state === 'protected') ? (j.error || '')
        : (j.out || (j.host + ' · ' + U.bytes(j.bytes || 0) + (j.segments ? ' · ' + j.segments + ' segmen' : '')));
      return '<div class="ticket ' + j.state + '" data-id="' + j.id + '">' +
        '<span class="n">' + j.n + '</span>' +
        '<span class="who"><b>' + esc(j.name) + '</b><small>' + esc(sub) + '</small></span>' +
        '<span class="st">' + label + '</span>' +
        '<span class="prog" style="width:' + Math.round((j.progress || 0) * 100) + '%"></span></div>';
    }).join('');
    $('q-empty').style.display = jobs.length ? 'none' : 'block';
    $('badge-queue').textContent = (c.queued || 0) + (c.running || 0) || '';
    $('dock-count').textContent = (c.queued || 0) + ' antre';
    $('dock-done').textContent = (c.done || 0) + ' selesai';
    $('dock-live').textContent = s.running ? (s.paused ? 'jeda' : 'mengunduh') : 'siap';
    $('statusline').textContent = 'mesin antrian · ' + (s.running ? (s.paused ? 'dijeda' : 'berjalan') : 'siap') + ' · ' + (s.total || 0) + ' pekerjaan';
    $('q-run').textContent = s.paused ? 'Lanjutkan' : 'Jalankan antrian';
    $('d-run').textContent = s.paused ? 'Lanjutkan' : 'Jalankan';
    const pl = jobs.filter((j) => j.kind === 'playlist');
    $('v-list').innerHTML = pl.map((j) =>
      '<div class="ticket ' + j.state + '"><span class="n">' + j.n + '</span>' +
      '<span class="who"><b>' + esc(j.name) + '</b><small>' + esc(j.out || j.error || j.url) + '</small></span>' +
      '<span class="st">' + (j.segments ? j.segments + ' seg' : j.state) + '</span></div>').join('');
    $('v-empty').style.display = pl.length ? 'none' : 'block';
    $('badge-video').textContent = pl.length || '';
  }

  function paintOutput() {
    const fs = writer.state.mode === 'fs';
    const has = fs && !!writer.state.root;
    $('o-box').classList.toggle('ok', has);
    $('o-icon').innerHTML = I.svg('folder', 22);
    $('o-name').textContent = fs ? (has ? writer.state.rootName : 'Belum ada folder tujuan') : 'Folder Unduhan / Grabo';
    $('o-sub').textContent = fs
      ? (has ? 'Berkas ditulis langsung ke folder ini lewat File System Access.' : 'Klik “Pilih folder” untuk menentukan tempat menyimpan.')
      : 'Chrome membatasi penulisan hanya di dalam folder Unduhan.';
    $('pill-folder').textContent = 'folder: ' + (fs ? (writer.state.rootName || '—') : 'Unduhan/Grabo');
    const ctx = { url: 'https://cdn.contoh.id/media/foto-besar.jpg', host: 'cdn.contoh.id', source: 'dom', name: 'foto-besar.jpg', ext: 'jpg', n: 7, w: 1600, h: 900, hash: 'a1b2c3d4e5f6', kind: 'image', pageTitle: 'Galeri karyaku' };
    $('o-preview').innerHTML =
      '<dt>Folder</dt><dd>' + esc(fs ? (writer.state.rootName || '(belum dipilih)') : 'Unduhan') + '</dd>' +
      '<dt>Jalur</dt><dd>' + esc((fs ? '' : 'Grabo/') + writer.pathFor(ctx)) + '</dd>' +
      '<dt>Manifest</dt><dd>' + (st.out.manifest ? 'aktif' : 'mati') + '</dd>' +
      '<dt>Bila nama sama</dt><dd>' + (st.queue.overwrite ? 'timpa' : 'tambah -2, -3, …') + '</dd>';
  }

  function paintManifest() {
    const recs = writer.state.records;
    const done = (snap && snap.jobs ? snap.jobs : []).filter((j) => j.state === 'done');
    const rows = recs.length ? recs.map((r, i) => ({ i: i + 1, out: r.out, url: r.url, bytes: r.bytes, hash: r.hash }))
      : done.map((j, i) => ({ i: i + 1, out: j.out, url: j.url, bytes: j.bytes, hash: j.hash }));
    $('m-rows').innerHTML = rows.slice(-300).map((r) =>
      '<tr><td class="mono">' + r.i + '</td><td class="mono">' + esc(r.out) + '</td><td class="mono">' + esc(r.url) + '</td>' +
      '<td class="mono">' + U.bytes(r.bytes) + '</td><td class="mono">' + esc(String(r.hash || '').slice(0, 12)) + '</td></tr>').join('');
    $('m-count').textContent = rows.length + ' berkas';
    $('m-empty').style.display = rows.length ? 'none' : 'block';
    $('badge-manifest').textContent = rows.length || '';
  }

  function paintLog() {
    $('log-box').innerHTML = logs.slice(0, 200).map((l) =>
      '<div><time>' + new Date(l.ts).toLocaleTimeString('id-ID', { hour12: false }) + '</time><span>' + esc(l.message) + '</span></div>').join('')
      || '<div><span>belum ada catatan</span></div>';
    $('log-count').textContent = logs.length + ' baris';
  }

  function paintBatch() {
    $('l-state').innerHTML = '<div class="kv">' +
      '<dt>Status</dt><dd>' + (batch.running ? 'berjalan' : 'diam') + '</dd>' +
      '<dt>Kemajuan</dt><dd>' + (batch.done || 0) + ' / ' + (batch.total || 0) + '</dd></div>';
    $('busy').classList.toggle('on', !!batch.running);
    if (batch.running) $('busy-label').textContent = 'Memanen berantai ' + batch.done + '/' + batch.total;
  }

  function paint() {
    ranges.forEach((el) => el._sync && el._sync());
    switches.forEach((el) => el._sync && el._sync());
    selects.forEach((el) => el._sync && el._sync());
    texts.forEach((fn) => fn());
    paintQueue();
    paintOutput();
    paintManifest();
    paintBatch();
    paintLog();
  }

  /* ---------- antrian ---------- */
  function onQueueState(s) {
    snap = s;
    paintQueue();
    if (tab === 'manifest') paintManifest();
    const now = Date.now();
    if (now - lastBroadcast > 260) {
      lastBroadcast = now;
      chrome.runtime.sendMessage({ type: 'GB_QUEUE_STATE', snap: s }).catch(() => {});
    }
  }

  function addItems(items, run) {
    const r = queue.add(items);
    if (r.added) cue('enqueue');
    if (run || autorun) queue.start();
    return r;
  }

  function linkList() {
    return String($('l-urls').value || '').split(/[\n\s,]+/).map((s) => s.trim()).filter((s) => /^https?:\/\//i.test(s));
  }

  async function runLinks() {
    const urls = linkList();
    if (!urls.length) { cue('fail'); log('Tidak ada tautan http(s) yang sah.'); return; }
    cue('start');
    log('Panen berantai dimulai: ' + urls.length + ' tautan, jeda ' + linkGap + 'ms.');
    const r = await bg('GB_BATCH_RUN', { urls, opts: { scroll: $('l-scroll').checked, keepTabs: $('l-keep').checked, gap: linkGap } });
    if (!r || !r.ok) { log('Panen berantai ditolak: ' + ((r && r.error) || 'tidak ada jawaban')); cue('fail'); }
  }

  async function runBluesky() {
    const handle = $('b-handle').value.trim();
    if (!handle) { cue('fail'); log('Handle Bluesky masih kosong.'); return; }
    bskyCancel = false;
    bskyItems = [];
    cue('scan');
    $('b-state').textContent = 'Mengambil…';
    try {
      const res = await window.GBBluesky.authorFeed({
        handle,
        filter: $('b-filter').value,
        limit: bLimit,
        cancelled: () => bskyCancel,
        onLog: log,
        onItems: (found) => {
          bskyItems = bskyItems.concat(found);
          $('b-grid').innerHTML = bskyItems.slice(0, 60).map((it) =>
            '<div class="tile"><img loading="lazy" src="' + esc(it.kind === 'image' ? it.url : '') + '" alt="">' +
            '<span class="kind ' + it.kind + '">' + it.kind + '</span></div>').join('');
        }
      });
      $('b-state').innerHTML = '<div class="kv"><dt>DID</dt><dd>' + esc(res.did) + '</dd><dt>Pos</dt><dd>' + res.posts + '</dd><dt>Media</dt><dd>' + res.items.length + '</dd></div>';
      const r = addItems(res.items, false);
      log('Bluesky: ' + r.added + ' masuk antrian.');
      cue('done');
      setTab('queue', false);
    } catch (e) {
      $('b-state').textContent = 'Gagal: ' + e.message;
      log('Bluesky gagal: ' + e.message);
      cue('fail');
    }
  }

  async function probePlaylist() {
    const url = $('v-url').value.trim();
    if (!url) { cue('fail'); return; }
    cue('scan');
    $('v-out').textContent = 'Memeriksa…';
    try {
      const text = new TextDecoder().decode(await read({ pageTabId: null }, url));
      if (U.extOf(url) === 'm3u8') {
        if (text.includes('#EXT-X-STREAM-INF')) {
          const m = window.GBStream.parseMaster(text, url);
          $('v-out').innerHTML = '<div class="kv"><dt>Jenis</dt><dd>master HLS</dd><dt>Varian</dt><dd>' + m.variants.length + '</dd>' +
            '<dt>Terenkripsi</dt><dd>' + (m.encrypted ? 'ya — akan dilewati' : 'tidak') + '</dd></div>' +
            '<div class="bars" style="margin-top:8px">' + m.variants.map((v) =>
              '<div class="bar"><em>' + (v.w ? v.w + '×' + v.h : 'audio') + '</em><u><i style="width:' +
              Math.min(100, (v.bandwidth / (m.variants[0].bandwidth || 1)) * 100) + '%"></i></u><b>' + Math.round(v.bandwidth / 1000) + 'k</b></div>').join('') + '</div>';
        } else {
          const m = window.GBStream.parseMedia(text, url);
          $('v-out').innerHTML = '<div class="kv"><dt>Jenis</dt><dd>media HLS</dd><dt>Segmen</dt><dd>' + m.segs.length + '</dd>' +
            '<dt>Durasi</dt><dd>' + m.duration.toFixed(1) + ' s</dd><dt>Init</dt><dd>' + (m.init ? 'ada (fMP4)' : 'tidak (TS)') + '</dd>' +
            '<dt>Terenkripsi</dt><dd>' + (m.encrypted ? m.keyMethod + ' — akan dilewati' : 'tidak') + '</dd></div>';
        }
      } else {
        const d = window.GBStream.parseDash(text, url);
        $('v-out').innerHTML = d.protected
          ? '<div class="kv"><dt>Status</dt><dd>terproteksi</dd><dt>Alasan</dt><dd>' + esc(d.reason) + '</dd></div>'
          : '<div class="kv"><dt>Jenis</dt><dd>DASH</dd><dt>Representasi</dt><dd>' + d.reps.length + '</dd><dt>Durasi</dt><dd>' + d.duration.toFixed(1) + ' s</dd></div>';
      }
      cue('found');
    } catch (e) {
      $('v-out').textContent = 'Gagal: ' + e.message;
      cue('fail');
    }
  }

  async function exportManifest() {
    const recs = writer.state.records.length ? writer.state.records
      : (snap && snap.jobs ? snap.jobs : []).filter((j) => j.state === 'done').map((j) => ({
        out: j.out, url: j.url, pageUrl: j.pageUrl, host: j.host, kind: j.kind, source: j.source, bytes: j.bytes, mime: j.mime, hash: j.hash, segments: j.segments
      }));
    const doc = { generator: 'Grabo 1.0.0', createdAt: new Date().toISOString(), files: recs.length, items: recs };
    const blob = new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    await bg('GB_DOWNLOAD', { url, filename: 'Grabo/grabo-manifest-salinan.json' });
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    cue('done');
    log('Salinan manifest diunduh (' + recs.length + ' berkas).');
  }

  /* ---------- aksi ---------- */
  function wire() {
    $('mark').innerHTML = I.MARK;
    $('btn-help').innerHTML = I.svg('shield');
    $('btn-help').addEventListener('click', () => setTab('settings', true));
    $('btn-sound').addEventListener('click', () => setSound(!(st.sound !== false)));

    const run = () => { cue('start'); queue.start(); };
    const pause = () => { cue('pause'); if (snap && snap.paused) queue.resume(); else queue.pause(); };
    $('q-run').addEventListener('click', () => { cue('start'); if (snap && snap.paused) queue.resume(); else queue.start(); });
    $('d-run').addEventListener('click', run);
    $('q-pause').addEventListener('click', pause);
    $('d-pause').addEventListener('click', pause);
    $('q-cancel').addEventListener('click', () => { cue('close'); queue.cancel(); });
    $('q-retry').addEventListener('click', () => { cue('tick'); queue.retryFailed(); queue.start(); });
    $('q-cleardone').addEventListener('click', () => { cue('close'); queue.clear(['done', 'skipped', 'protected']); });
    $('q-clearall').addEventListener('click', async () => { cue('close'); await queue.clearAll(); });
    $('q-list').addEventListener('click', (e) => {
      const t = e.target.closest('.ticket');
      if (!t || !e.altKey) return;
      queue.remove(t.dataset.id);
      cue('close');
    });

    $('d-folder').addEventListener('click', () => { setTab('output', true); });
    $('d-links').addEventListener('click', () => setTab('links', true));
    $('o-pick').addEventListener('click', pickFolder);
    $('o-allow').addEventListener('click', allowFolder);
    $('o-internal').addEventListener('click', internalFolder);
    $('o-test').addEventListener('click', testWrite);

    $('l-run').addEventListener('click', runLinks);
    $('l-stop').addEventListener('click', () => { bg('GB_BATCH_CANCEL'); cue('pause'); log('Permintaan hentikan panen berantai dikirim.'); });
    $('l-clear').addEventListener('click', () => { $('l-urls').value = ''; $('l-count').textContent = '0 tautan'; cue('close'); });
    $('l-paste').addEventListener('click', async () => {
      try {
        const txt = await navigator.clipboard.readText();
        $('l-urls').value = ($('l-urls').value ? $('l-urls').value + '\n' : '') + txt;
        $('l-count').textContent = linkList().length + ' tautan';
        cue('tick');
      } catch (e) { cue('fail'); log('Clipboard tidak bisa dibaca: ' + e.message); }
    });

    $('b-run').addEventListener('click', runBluesky);
    $('b-stop').addEventListener('click', () => { bskyCancel = true; cue('pause'); });

    $('v-probe').addEventListener('click', probePlaylist);
    $('v-enqueue').addEventListener('click', () => {
      const url = $('v-url').value.trim();
      if (!url) { cue('fail'); return; }
      addItems([{ url, kind: 'playlist', source: 'manual', name: U.nameOf(url), host: U.hostOf(url) }], false);
      setTab('queue', false);
    });

    $('m-flush').addEventListener('click', async () => {
      try { const n = await writer.flushManifest(); log(n ? 'Manifest ditulis: ' + n : 'Tidak ada catatan untuk ditulis.'); cue('done'); paintManifest(); }
      catch (e) { log('Manifest gagal: ' + e.message); cue('fail'); }
    });
    $('m-export').addEventListener('click', exportManifest);
    $('log-clear').addEventListener('click', () => { logs = []; paintLog(); cue('close'); });
    $('s-wipehash').addEventListener('click', async () => {
      await window.GBStore.clearHashes();
      $('s-hashcount').textContent = '0 hash';
      log('Daftar hash dikosongkan.');
      cue('close');
    });
    document.addEventListener('pointerdown', () => S.unlock(), { once: true });
  }

  /* ---------- pesan ---------- */
  chrome.runtime.onMessage.addListener((msg, sender, respond) => {
    if (!msg || typeof msg.type !== 'string') return;

    if (msg.type === 'GB_PAGE_CHUNK') {
      const box = pendingReads.get(msg.jobId);
      if (box) {
        if (msg.error) box.error = msg.error;
        else if (msg.data) box.parts.push(U.bytesFromB64(msg.data));
        if (msg.mime) box.mime = msg.mime;
      }
      return;
    }
    if (msg.type === 'GB_QUEUE_PING') { respond({ ok: true, snap: queue ? queue.snapshot() : null }); return; }
    if (msg.type === 'GB_QUEUE_CMD') {
      if (!queue) { respond({ ok: false }); return; }
      const c = msg.cmd;
      if (c === 'run') queue.start();
      else if (c === 'pause') queue.pause();
      else if (c === 'resume') queue.resume();
      else if (c === 'cancel') queue.cancel();
      else if (c === 'retry') { queue.retryFailed(); queue.start(); }
      else if (c === 'wipe') { queue.clearAll(); window.GBStore.clearHashes(); }
      respond({ ok: true, snap: queue.snapshot() });
      return;
    }
    if (msg.type === 'GB_ENQUEUE_ITEMS') {
      const r = addItems(msg.items || [], msg.autorun);
      respond({ ok: true, added: r.added });
      setTab('queue', false);
      return;
    }
    if (msg.type === 'GB_ENQUEUE_ONE') {
      if (msg.item) addItems([msg.item], false);
      respond({ ok: true });
      return;
    }
    if (msg.type === 'GB_BATCH_ITEMS') {
      if (msg.error) log('Tautan gagal: ' + msg.url + ' — ' + msg.error);
      const items = (msg.items || []).map((it) => Object.assign({}, it, { tabId: msg.tabId || null, pageUrl: it.pageUrl || msg.url }));
      const r = addItems(items, false);
      log(msg.url + ' → ' + r.added + ' media baru.');
      return;
    }
    if (msg.type === 'GB_BATCH_STATE') { batch = msg.batch || batch; paintBatch(); if (!batch.running && batch.total) { cue('done'); if (autorun) queue.start(); } return; }
    if (msg.type === 'GB_SETTINGS_CHANGED') { st = msg.settings; applySettings(); return; }
    if (msg.type === 'GB_STUDIO_HINT') {
      const m = /tab=(\w+)/.exec(msg.query || '');
      if (m) setTab(m[1], true);
      return;
    }
  });

  /* ---------- mulai ---------- */
  (async function boot() {
    buildRail();
    const r = await bg('GB_GET_SETTINGS');
    st = (r && r.ok) ? r.settings : {
      queue: { concurrency: 2, gap: 400, retries: 2, dedup: true, overwrite: false },
      out: { mode: 'fs', template: '{host}/{date}/{base}-{n}.{ext}', manifest: true, folderName: '' },
      video: { quality: 'best', maxSegs: 4000 }, sound: true, volume: 50, sidebarWidth: 25
    };
    await window.GBStore.open();
    writer = window.GBWriter.create({
      mode: st.out.mode, template: st.out.template, overwrite: st.queue.overwrite, manifest: st.out.manifest, onLog: log
    });
    const restored = await writer.restoreFolder().catch(() => '');
    if (restored) log('Folder tersimpan dipulihkan: ' + restored);
    queue = window.GBQueue.create({
      store: window.GBStore, writer, read, onLog: log, onState: onQueueState,
      settings: {
        concurrency: st.queue.concurrency, gap: st.queue.gap, retries: st.queue.retries,
        dedup: st.queue.dedup, quality: st.video.quality, maxSegs: st.video.maxSegs
      }
    });
    bindAll();
    wire();
    S.setEnabled(st.sound !== false);
    S.setVolume((st.volume == null ? 50 : st.volume) / 100);
    paintSound();
    await queue.load();
    $('s-hashcount').textContent = (await window.GBStore.countHashes()) + ' hash';
    const q = /tab=(\w+)/.exec(location.search);
    setTab(q ? q[1] : 'queue', false);
    log('Studio siap. Folder: ' + (writer.state.rootName || 'belum dipilih') + '.');
    paint();
    window.__graboStudio = { queue, writer, st: () => st, read, addItems, snap: () => snap };
  })();
})();