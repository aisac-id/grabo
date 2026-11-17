/* Grabo — sidebar (remote control).
 * Semua kendali di sini langsung; mesin berat tinggal di Studio. */
(function () {
  'use strict';
  const U = window.GB;
  const I = window.GBIcons;
  const S = window.GBSound;
  const CHANNEL = 'GRABO_BUS';
  const token = (location.hash.match(/k=([^&]+)/) || [])[1] || '';

  const $ = (id) => document.getElementById(id);
  const TABS = [
    { id: 'overview', label: 'Ringkas', icon: 'gauge' },
    { id: 'harvest', label: 'Panen', icon: 'harvest' },
    { id: 'gallery', label: 'Galeri', icon: 'grid' },
    { id: 'queue', label: 'Antrian', icon: 'queue' },
    { id: 'video', label: 'Video', icon: 'film' },
    { id: 'filter', label: 'Filter', icon: 'filter' },
    { id: 'output', label: 'Keluaran', icon: 'folder' },
    { id: 'sources', label: 'Sumber', icon: 'plug' },
    { id: 'settings', label: 'Aturan', icon: 'cog' }
  ];

  const DEFAULTS = {
    enabled: true, sidebarWidth: 25, dockMode: 'dock', sound: true, openTab: 'overview', autoWatch: true,
    sources: { dom: true, net: true, meta: true, css: true, canvas: true },
    filters: { kinds: { image: true, video: true, audio: false }, minW: 0, minH: 0, minBytes: 0, skipSmall: true, skipThumbs: true, onlyVisible: false, include: [], exclude: [] },
    scrollDepth: 4, scrollDelay: 500, loadMore: true, probeDims: true, probeLimit: 60, adapter: 'auto',
    queue: { concurrency: 2, gap: 400, retries: 2, dedup: true, overwrite: false },
    out: { mode: 'fs', template: '{host}/{date}/{base}-{n}.{ext}', manifest: true, folderName: '' },
    video: { quality: 'best', maxSegs: 4000 },
    profiles: {}, totals: { files: 0, bytes: 0 }, volume: 50
  };

  let st = JSON.parse(JSON.stringify(DEFAULTS));
  let items = [];
  let stats = { found: 0, kept: 0, byKind: {}, bySource: {}, dropped: {} };
  let logs = [];
  let page = { url: '', title: '', host: '' };
  let queue = null;
  let tab = 'overview';
  let sort = 'found';
  let lbItem = null;
  let ready = false;

  function post(payload) {
    parent.postMessage(Object.assign({ channel: CHANNEL, token }, payload), '*');
  }
  function patch(p) {
    st = merge(st, p);
    post({ type: 'GB_PATCH', patch: p });
    paint();
  }
  function merge(base, p) {
    const out = Object.assign({}, base);
    Object.keys(p || {}).forEach((k) => {
      const v = p[k];
      if (v && typeof v === 'object' && !Array.isArray(v) && base[k] && typeof base[k] === 'object' && !Array.isArray(base[k])) out[k] = merge(base[k], v);
      else if (v !== undefined) out[k] = v;
    });
    return out;
  }
  function bg(type, extra) {
    return chrome.runtime.sendMessage(Object.assign({ type }, extra || {})).catch(() => null);
  }
  function cue(name) { S.play(name); }

  /* ---------- rel tab ---------- */
  function buildRail() {
    const rail = $('rail');
    rail.innerHTML = TABS.map((t) =>
      '<button class="tab" role="tab" id="tab-' + t.id + '" data-tab="' + t.id + '" aria-selected="false" aria-controls="pane-' + t.id + '" title="' + t.label + '">' +
      I.svg(t.icon) + '<span>' + t.label + '</span><i id="badge-' + t.id + '"></i></button>'
    ).join('');
    rail.addEventListener('click', (e) => {
      const b = e.target.closest('.tab');
      if (b) setTab(b.dataset.tab, true);
    });
    rail.addEventListener('keydown', (e) => {
      const i = TABS.findIndex((t) => t.id === tab);
      if (e.key === 'ArrowDown' || e.key === 'ArrowRight') { setTab(TABS[(i + 1) % TABS.length].id, true); e.preventDefault(); }
      if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') { setTab(TABS[(i - 1 + TABS.length) % TABS.length].id, true); e.preventDefault(); }
    });
  }

  function setTab(id, sound) {
    if (!TABS.some((t) => t.id === id)) id = 'overview';
    tab = id;
    TABS.forEach((t) => {
      $('tab-' + t.id).setAttribute('aria-selected', String(t.id === id));
      $('pane-' + t.id).classList.toggle('on', t.id === id);
    });
    $('main').scrollTop = 0;
    if (sound) { cue('tab'); patch({ openTab: id }); }
    paint();
  }

  /* ---------- pengikatan kendali ---------- */
  function fill(el) {
    const min = Number(el.min || 0), max = Number(el.max || 100);
    el.style.setProperty('--fill', ((Number(el.value) - min) / (max - min) * 100) + '%');
  }
  function bindRange(id, get, set, fmt, labelId) {
    const el = $(id);
    if (!el) return;
    const show = () => {
      fill(el);
      const txt = fmt ? fmt(Number(el.value)) : el.value;
      if (labelId && $(labelId)) $(labelId).textContent = txt;
    };
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
  const ranges = [], switches = [], selects = [];

  const pct = (v) => v + '%';
  const px = (v) => v + ' px';
  const ms = (v) => v + ' ms';
  const kb = (v) => v + ' KB';
  const QLABEL = { best: 'terbaik', mid: 'menengah', low: 'terkecil' };

  function bindAll() {
    bindRange('d-width', () => st.sidebarWidth, (v) => patch({ sidebarWidth: v }), pct, 'd-v-width');
    bindRange('d-depth', () => st.scrollDepth, (v) => patch({ scrollDepth: v }), null, 'd-v-depth');
    bindRange('d-workers', () => st.queue.concurrency, (v) => patch({ queue: { concurrency: v } }), null, 'd-v-workers');
    bindRange('d-gap', () => st.queue.gap, (v) => patch({ queue: { gap: v } }), ms, 'd-v-gap');
    bindRange('d-minw', () => st.filters.minW, (v) => patch({ filters: { minW: v } }), px, 'd-v-minw');
    bindRange('d-minb', () => Math.round(st.filters.minBytes / 1024), (v) => patch({ filters: { minBytes: v * 1024 } }), kb, 'd-v-minb');
    bindSelect('d-quality', () => st.video.quality, (v) => patch({ video: { quality: v } }));
    bindSelect('d-out', () => st.out.mode, (v) => patch({ out: { mode: v } }));
    bindSwitch('d-img', () => st.filters.kinds.image, (v) => patch({ filters: { kinds: { image: v } } }));
    bindSwitch('d-vid', () => st.filters.kinds.video, (v) => patch({ filters: { kinds: { video: v } } }));
    bindSwitch('d-thumbs', () => st.filters.skipThumbs, (v) => patch({ filters: { skipThumbs: v } }));
    bindSwitch('d-dedup', () => st.queue.dedup, (v) => patch({ queue: { dedup: v } }));

    bindRange('r-scrollDepth', () => st.scrollDepth, (v) => patch({ scrollDepth: v }), null, 'v-scrollDepth');
    bindRange('r-scrollDelay', () => st.scrollDelay, (v) => patch({ scrollDelay: v }), ms, 'v-scrollDelay');
    bindRange('r-probeLimit', () => st.probeLimit, (v) => patch({ probeLimit: v }), null, 'v-probeLimit');
    bindSwitch('s-loadMore', () => st.loadMore, (v) => patch({ loadMore: v }));
    bindSwitch('s-probeDims', () => st.probeDims, (v) => patch({ probeDims: v }));

    bindRange('r-minW', () => st.filters.minW, (v) => patch({ filters: { minW: v } }), px, 'v-minW');
    bindRange('r-minH', () => st.filters.minH, (v) => patch({ filters: { minH: v } }), px, 'v-minH');
    bindRange('r-minBytes', () => Math.round(st.filters.minBytes / 1024), (v) => patch({ filters: { minBytes: v * 1024 } }), kb, 'v-minBytes');
    bindSwitch('s-skipSmall', () => st.filters.skipSmall, (v) => patch({ filters: { skipSmall: v } }));
    bindSwitch('s-skipThumbs', () => st.filters.skipThumbs, (v) => patch({ filters: { skipThumbs: v } }));
    bindSwitch('s-onlyVisible', () => st.filters.onlyVisible, (v) => patch({ filters: { onlyVisible: v } }));

    bindSelect('sel-quality', () => st.video.quality, (v) => patch({ video: { quality: v } }));
    bindRange('r-maxSegs', () => st.video.maxSegs, (v) => patch({ video: { maxSegs: v } }), null, 'v-maxSegs');
    bindSelect('sel-outMode', () => st.out.mode, (v) => patch({ out: { mode: v } }));
    bindSwitch('s-manifest', () => st.out.manifest, (v) => patch({ out: { manifest: v } }));
    bindSwitch('s-overwrite', () => st.queue.overwrite, (v) => patch({ queue: { overwrite: v } }));

    bindRange('r-sidebarWidth', () => st.sidebarWidth, (v) => patch({ sidebarWidth: v }), pct, 'v-sidebarWidth');
    bindSelect('sel-dockMode', () => st.dockMode, (v) => patch({ dockMode: v }));
    bindSelect('sel-openTab', () => st.openTab, (v) => patch({ openTab: v }));
    bindSwitch('s-enabled', () => st.enabled, (v) => patch({ enabled: v }));
    bindSwitch('s-autoWatch', () => st.autoWatch, (v) => patch({ autoWatch: v }));
    bindSwitch('s-sound', () => st.sound, (v) => setSound(v));
    bindRange('r-volume', () => st.volume == null ? 50 : st.volume, (v) => { S.setVolume(v / 100); patch({ volume: v }); }, pct, 'v-volume');
    bindRange('r-concurrency', () => st.queue.concurrency, (v) => patch({ queue: { concurrency: v } }), null, 'v-concurrency');
    bindRange('r-gap', () => st.queue.gap, (v) => patch({ queue: { gap: v } }), ms, 'v-gap');
    bindRange('r-retries', () => st.queue.retries, (v) => patch({ queue: { retries: v } }), null, 'v-retries');
    bindSwitch('s-dedup', () => st.queue.dedup, (v) => patch({ queue: { dedup: v } }));
    bindSelect('sel-adapter', () => st.adapter, (v) => patch({ adapter: v }));

    $('sel-openTab').innerHTML = TABS.map((t) => '<option value="' + t.id + '">' + t.label + '</option>').join('');
    $('sel-adapter').innerHTML = '<option value="auto">otomatis (menurut situs)</option>' +
      window.GBAdapterList.map((a) => '<option value="' + a.id + '">' + a.label + '</option>').join('');

    const tInclude = $('t-include'), tExclude = $('t-exclude');
    const pushPatterns = U.debounce(() => {
      patch({ filters: { include: lines(tInclude.value), exclude: lines(tExclude.value) } });
    }, 420);
    tInclude.addEventListener('input', pushPatterns);
    tExclude.addEventListener('input', pushPatterns);
    texts.push(() => {
      if (document.activeElement !== tInclude) tInclude.value = (st.filters.include || []).join('\n');
      if (document.activeElement !== tExclude) tExclude.value = (st.filters.exclude || []).join('\n');
    });

    const tpl = $('t-template');
    tpl.addEventListener('input', U.debounce(() => patch({ out: { template: tpl.value } }), 400));
    texts.push(() => { if (document.activeElement !== tpl) tpl.value = st.out.template; });

    $('g-sort').addEventListener('change', () => { sort = $('g-sort').value; cue('tick'); paintGallery(); });
  }
  const texts = [];
  const lines = (v) => String(v || '').split('\n').map((s) => s.trim()).filter(Boolean);

  /* ---------- sumber & jenis ---------- */
  const SOURCE_LABEL = { dom: 'DOM', net: 'jaringan', meta: 'metadata', css: 'latar CSS', canvas: 'kanvas' };
  const KIND_LABEL = { image: 'Gambar', video: 'Video', audio: 'Audio', playlist: 'Playlist' };

  function buildToggles() {
    $('h-sources').innerHTML = Object.keys(SOURCE_LABEL).map((k) =>
      '<label class="sw"><input type="checkbox" id="src-' + k + '"><u></u><span>' + SOURCE_LABEL[k] + '</span></label>').join('');
    Object.keys(SOURCE_LABEL).forEach((k) => bindSwitch('src-' + k, () => st.sources[k], (v) => patch({ sources: { [k]: v } })));
    $('f-kinds').innerHTML = ['image', 'video', 'audio'].map((k) =>
      '<label class="sw"><input type="checkbox" id="kind-' + k + '"><u></u><span>' + KIND_LABEL[k] + '</span></label>').join('');
    ['image', 'video', 'audio'].forEach((k) => bindSwitch('kind-' + k, () => st.filters.kinds[k], (v) => patch({ filters: { kinds: { [k]: v } } })));

    $('s-adapters').innerHTML = window.GBAdapterList.map((a) =>
      '<div class="card"><div class="row"><b style="font-size:12px">' + a.label + '</b>' +
      '<span class="pill ' + (a.live ? 's' : 'w') + '">' + (a.live ? 'teruji langsung' : 'pola umum') + '</span></div>' +
      '<div style="color:var(--dim);font-size:11px;margin-top:4px">' + a.note + '</div>' +
      '<div class="mono" style="font-size:9.5px;color:var(--b);margin-top:4px">' + a.hosts + '</div></div>').join('');

    $('o-tokens').innerHTML = ['host', 'source', 'date', 'time', 'base', 'name', 'ext', 'n', 'w', 'h', 'hash8', 'kind', 'page']
      .map((t) => '<button class="chip" data-token="{' + t + '}">{' + t + '}</button>').join('');
    $('o-tokens').addEventListener('click', (e) => {
      const b = e.target.closest('[data-token]');
      if (!b) return;
      const el = $('t-template');
      el.value = el.value + b.dataset.token;
      patch({ out: { template: el.value } });
      cue('tick');
    });
  }

  /* ---------- suara ---------- */
  function paintSound() {
    const b = $('btn-sound');
    b.innerHTML = I.svg(st.sound ? 'sound' : 'mute');
    b.classList.toggle('on', !!st.sound);
    b.setAttribute('aria-pressed', String(!!st.sound));
    b.title = st.sound ? 'Suara aktif — klik untuk membisukan' : 'Suara bisu — klik untuk mengaktifkan';
  }
  function setSound(v) {
    st.sound = !!v;
    S.setEnabled(st.sound);
    paintSound();
    if (st.sound) S.play('open');
    patch({ sound: st.sound });
  }

  /* ---------- gambar ulang ---------- */
  function bars(el, map, total) {
    const keys = Object.keys(map || {});
    if (!keys.length) { el.innerHTML = '<div style="color:var(--dim);font-size:11px">belum ada data</div>'; return; }
    const max = Math.max.apply(null, keys.map((k) => map[k])) || 1;
    el.innerHTML = keys.sort((a, b) => map[b] - map[a]).slice(0, 8).map((k) =>
      '<div class="bar"><em>' + (KIND_LABEL[k] || SOURCE_LABEL[k] || k) + '</em>' +
      '<u><i style="width:' + (map[k] / max * 100) + '%"></i></u><b>' + map[k] + '</b></div>').join('');
  }

  function statCard(cls, value, label) {
    return '<div class="stat ' + cls + '"><b>' + value + '</b><small>' + label + '</small></div>';
  }

  function paintOverview() {
    const q = queue && queue.counts ? queue.counts : { queued: 0, running: 0, done: 0, failed: 0 };
    $('ov-stats').innerHTML =
      statCard('a', stats.kept || 0, 'lolos filter') +
      statCard('c', stats.found || 0, 'kandidat') +
      statCard('s', items.filter((i) => i.selected).length, 'dipilih') +
      statCard('w', (q.queued || 0) + (q.running || 0), 'menunggu unduh');
    bars($('ov-kinds'), stats.byKind);
    bars($('ov-sources'), stats.bySource);
    bars($('ov-dropped'), stats.dropped);
    const done = q.done || 0;
    $('ov-queue').innerHTML = '<div class="kv">' +
      '<dt>Selesai</dt><dd>' + done + ' berkas</dd>' +
      '<dt>Gagal</dt><dd>' + (q.failed || 0) + '</dd>' +
      '<dt>Dilewati</dt><dd>' + ((q.skipped || 0) + (q.protected || 0)) + '</dd>' +
      '<dt>Data tersimpan</dt><dd>' + U.bytes(queue ? queue.bytes : (st.totals ? st.totals.bytes : 0)) + '</dd>' +
      '<dt>Laju</dt><dd>' + (queue && queue.rate ? U.bytes(queue.rate) + '/s' : '—') + '</dd>' +
      '<dt>Perkiraan sisa</dt><dd>' + (queue && queue.eta ? U.dur(queue.eta) : '—') + '</dd></div>';
    const a = window.GBAdapterFor(page.host || '');
    const ad = window.GBAdapterList.find((x) => x.id === (st.adapter === 'auto' ? a : st.adapter));
    $('ov-adapter').innerHTML = ad
      ? '<b>' + ad.label + '</b> — ' + ad.note + (ad.live ? '' : ' Adapter ini memakai pola umum; hasilnya perlu dicek di Galeri.')
      : 'Adapter generik: sapu DOM, jaringan, dan metadata.';
  }

  function tileHtml(it) {
    const kind = it.kind || U.kindOf(it.url, it.mime);
    let media;
    if (kind === 'image' && !/^blob:/.test(it.url)) media = '<img loading="lazy" src="' + esc(it.url) + '" alt="">';
    else if (kind === 'video' && !/^blob:/.test(it.url)) media = '<video muted preload="metadata" src="' + esc(it.url) + '#t=0.6"></video>';
    else media = '<div class="ph">' + I.svg(kind === 'playlist' ? 'film' : kind === 'audio' ? 'sound' : 'image') + '</div>';
    const dim = it.w && it.h ? it.w + '×' + it.h : (it.bytes ? U.bytes(it.bytes) : kind);
    return '<div class="tile' + (it.selected ? ' sel' : '') + '" data-id="' + it.id + '" title="' + esc(it.url) + '">' +
      media + '<span class="kind ' + kind + '">' + kind + '</span>' +
      '<span class="pick">' + I.svg('check') + '</span>' +
      '<span class="meta"><span>' + esc(U.sanitize(it.name || '').slice(0, 14)) + '</span><span>' + dim + '</span></span></div>';
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function sorted(list) {
    const l = list.slice();
    if (sort === 'big') l.sort((a, b) => (b.bytes || 0) - (a.bytes || 0));
    if (sort === 'dim') l.sort((a, b) => (b.w * b.h || 0) - (a.w * a.h || 0));
    if (sort === 'name') l.sort((a, b) => String(a.name).localeCompare(String(b.name)));
    return l;
  }

  function paintGallery() {
    const list = sorted(items);
    const grid = $('g-grid');
    const cap = list.slice(0, 400);
    grid.innerHTML = cap.map(tileHtml).join('');
    $('g-empty').style.display = list.length ? 'none' : 'block';
    $('g-count').textContent = items.filter((i) => i.selected).length + ' dipilih';
    $('g-shown').textContent = cap.length + (list.length > cap.length ? ' dari ' + list.length : '') + ' tampil';
  }

  function ticketHtml(j) {
    const label = { queued: 'antre', running: 'jalan', done: 'selesai', failed: 'gagal', skipped: 'kembar', protected: 'terproteksi', paused: 'jeda' }[j.state] || j.state;
    const sub = j.state === 'failed' || j.state === 'protected' ? (j.error || '') : (j.out || j.host + ' · ' + U.bytes(j.bytes || 0));
    return '<div class="ticket ' + j.state + '" data-id="' + j.id + '">' +
      '<span class="n">' + (j.n || '–') + '</span>' +
      '<span class="who"><b>' + esc(j.name) + '</b><small>' + esc(sub) + '</small></span>' +
      '<span class="st">' + label + '</span>' +
      '<span class="prog" style="width:' + Math.round((j.progress || 0) * 100) + '%"></span></div>';
  }

  function paintQueue() {
    const c = queue && queue.counts ? queue.counts : { queued: 0, running: 0, done: 0, failed: 0, skipped: 0, protected: 0 };
    $('q-stats').innerHTML =
      statCard('a', (c.running || 0) + '/' + (queue ? queue.workers : 0), 'pekerja aktif') +
      statCard('c', c.queued || 0, 'antre') +
      statCard('s', c.done || 0, 'selesai') +
      statCard('w', (c.failed || 0) + (c.protected || 0), 'gagal / dilindungi');
    const jobs = queue ? queue.jobs : [];
    $('q-list').innerHTML = jobs.slice(0, 60).map(ticketHtml).join('');
    $('q-empty').style.display = jobs.length ? 'none' : 'block';
    $('q-run').textContent = queue && queue.paused ? 'Lanjutkan' : 'Jalankan';
    $('badge-queue').textContent = (c.queued || 0) + (c.running || 0) || '';
    $('dock-live').textContent = queue && queue.running ? (queue.paused ? 'jeda' : 'mengunduh') : 'siap';
  }

  function paintVideo() {
    const pl = items.filter((i) => i.kind === 'playlist');
    $('v-list').innerHTML = pl.map((it) =>
      '<div class="ticket ' + (it.selected ? 'queued' : 'skipped') + '" data-id="' + it.id + '">' +
      '<span class="n">' + I.svg('film', 12) + '</span>' +
      '<span class="who"><b>' + esc(it.name) + '</b><small>' + esc(it.url) + '</small></span>' +
      '<span class="st">' + U.extOf(it.url) + '</span></div>').join('');
    $('v-empty').style.display = pl.length ? 'none' : 'block';
    $('v-quality').textContent = QLABEL[st.video.quality] || st.video.quality;
    $('badge-video').textContent = pl.length || '';
  }

  function paintOutput() {
    const has = !!st.out.folderName;
    $('o-folder').classList.toggle('ok', has && st.out.mode === 'fs');
    $('o-ficon').innerHTML = I.svg('folder', 22);
    $('o-fname').textContent = st.out.mode === 'fs' ? (has ? st.out.folderName : 'Belum ada folder') : 'Folder Unduhan / Grabo';
    $('o-fmode').textContent = 'mode: ' + (st.out.mode === 'fs' ? 'folder nyata (File System Access)' : 'unduhan Chrome');
    $('o-sample').textContent = U.renderTemplate(st.out.template, {
      url: 'https://cdn.contoh.id/media/foto-besar.jpg', host: page.host || 'cdn.contoh.id',
      source: 'dom', name: 'foto-besar.jpg', ext: 'jpg', n: 7, w: 1600, h: 900,
      hash: 'a1b2c3d4e5', kind: 'image', pageTitle: page.title || 'Halaman'
    });
  }

  function paintSettings() {
    $('set-host').textContent = page.host || 'situs ini';
    const profs = Object.keys(st.profiles || {});
    $('set-list').innerHTML = profs.length
      ? profs.map((h) => '<span class="chip' + (h === page.host ? ' on' : '') + '">' + esc(h) + '</span>').join('')
      : '<span style="color:var(--dim);font-size:11px">belum ada profil tersimpan</span>';
  }

  function paintLog() {
    $('h-log').innerHTML = logs.slice(0, 60).map((l) =>
      '<div><time>' + new Date(l.ts).toLocaleTimeString('id-ID', { hour12: false }) + '</time><span>' + esc(l.message) + '</span></div>').join('')
      || '<div><span>belum ada catatan</span></div>';
  }

  function paint() {
    ranges.forEach((el) => el._sync && el._sync());
    switches.forEach((el) => el._sync && el._sync());
    selects.forEach((el) => el._sync && el._sync());
    texts.forEach((fn) => fn());
    $('hostline').textContent = page.host ? page.host + ' · ' + (stats.kept || 0) + ' media' : 'belum terhubung';
    $('dock-count').textContent = (stats.kept || 0) + ' media';
    $('badge-gallery').textContent = items.length || '';
    $('badge-harvest').textContent = stats.found || '';
    paintOverview();
    paintQueue();
    if (tab === 'gallery') paintGallery();
    if (tab === 'video') paintVideo();
    if (tab === 'output') paintOutput();
    if (tab === 'settings') paintSettings();
    paintLog();
  }

  /* ---------- aksi ---------- */
  function scan(scroll) {
    cue('scan');
    post({ type: 'GB_SCAN', scroll: !!scroll });
  }
  function enqueue(list) {
    const chosen = (list || items.filter((i) => i.selected)).map((i) => Object.assign({}, i, { tabId: null, pageUrl: page.url, pageTitle: page.title }));
    if (!chosen.length) { cue('fail'); flash('Tidak ada yang dipilih.'); return; }
    cue('enqueue');
    bg('GB_ENQUEUE', { items: chosen });
    flash(chosen.length + ' media dikirim ke antrian Studio.');
    setTab('queue', false);
  }
  function flash(msg) {
    logs.unshift({ message: msg, ts: Date.now() });
    logs = logs.slice(0, 80);
    paintLog();
  }
  function qcmd(cmd) {
    cue(cmd === 'pause' ? 'pause' : 'start');
    chrome.runtime.sendMessage({ type: 'GB_QUEUE_CMD', cmd }).then((r) => {
      if (!r || !r.ok) { bg('GB_OPEN_STUDIO'); flash('Studio dibuka untuk menjalankan antrian.'); }
    }).catch(() => { bg('GB_OPEN_STUDIO'); });
  }

  function openLb(it) {
    lbItem = it;
    const kind = it.kind;
    $('lb-body').innerHTML = kind === 'video'
      ? '<video controls autoplay muted src="' + esc(it.url) + '"></video>'
      : kind === 'image' ? '<img src="' + esc(it.url) + '" alt="">'
      : '<div class="card mono" style="max-width:70vw">' + esc(it.url) + '</div>';
    $('lb-cap').textContent = (it.name || '') + ' · ' + (it.w && it.h ? it.w + '×' + it.h + ' · ' : '') + U.bytes(it.bytes || 0) + ' · ' + (it.source || '') + ' · ' + it.url;
    $('lb').classList.add('on');
    cue('open');
  }
  function closeLb() {
    $('lb').classList.remove('on');
    $('lb-body').innerHTML = '';
    lbItem = null;
    cue('close');
  }

  function wire() {
    $('mark').innerHTML = I.MARK;
    $('btn-studio').innerHTML = I.svg('bolt');
    $('btn-close').innerHTML = I.svg('x');
    $('lb-x').innerHTML = I.svg('x');
    $('btn-close').addEventListener('click', () => { cue('close'); post({ type: 'GB_CLOSE' }); });
    $('btn-studio').addEventListener('click', () => { cue('open'); bg('GB_OPEN_STUDIO'); });
    $('btn-sound').addEventListener('click', () => setSound(!st.sound));

    $('d-scan').addEventListener('click', () => scan(false));
    $('d-deep').addEventListener('click', () => scan(true));
    $('d-enqueue').addEventListener('click', () => enqueue());
    $('h-scan').addEventListener('click', () => scan(false));
    $('h-deep').addEventListener('click', () => scan(true));
    $('h-net').addEventListener('click', () => { cue('tick'); post({ type: 'GB_REFRESH_NET' }); });

    $('g-all').addEventListener('click', () => { cue('toggle'); post({ type: 'GB_SELECT_ALL', on: true }); });
    $('g-none').addEventListener('click', () => { cue('toggle'); post({ type: 'GB_SELECT_ALL', on: false }); });
    $('g-img').addEventListener('click', () => { cue('toggle'); items.forEach((i) => post({ type: 'GB_SELECT', id: i.id, on: i.kind === 'image' })); });
    $('g-vid').addEventListener('click', () => { cue('toggle'); items.forEach((i) => post({ type: 'GB_SELECT', id: i.id, on: i.kind === 'video' || i.kind === 'playlist' })); });
    $('g-clear').addEventListener('click', () => { cue('close'); post({ type: 'GB_CLEAR' }); });
    $('g-enqueue').addEventListener('click', () => enqueue());
    $('g-grid').addEventListener('click', (e) => {
      const t = e.target.closest('.tile');
      if (!t) return;
      const it = items.find((x) => x.id === t.dataset.id);
      if (!it) return;
      cue('grab');
      post({ type: 'GB_SELECT', id: it.id, on: !it.selected });
    });
    $('g-grid').addEventListener('dblclick', (e) => {
      const t = e.target.closest('.tile');
      if (!t) return;
      const it = items.find((x) => x.id === t.dataset.id);
      if (it) openLb(it);
    });

    $('q-run').addEventListener('click', () => qcmd(queue && queue.paused ? 'resume' : 'run'));
    $('q-pause').addEventListener('click', () => qcmd('pause'));
    $('q-retry').addEventListener('click', () => qcmd('retry'));
    $('q-open').addEventListener('click', () => { cue('open'); bg('GB_OPEN_STUDIO'); });

    $('o-pick').addEventListener('click', () => { cue('folder'); bg('GB_OPEN_STUDIO', { query: 'tab=output' }); });
    $('s-batch').addEventListener('click', () => { cue('open'); bg('GB_OPEN_STUDIO', { query: 'tab=links' }); });

    $('lb-x').addEventListener('click', closeLb);
    $('lb').addEventListener('click', (e) => { if (e.target === $('lb')) closeLb(); });
    $('lb-enqueue').addEventListener('click', () => { if (lbItem) enqueue([lbItem]); closeLb(); });
    $('lb-copy').addEventListener('click', () => {
      if (!lbItem) return;
      navigator.clipboard.writeText(lbItem.url).then(() => { cue('tick'); flash('URL disalin.'); }).catch(() => cue('fail'));
    });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && $('lb').classList.contains('on')) closeLb(); });

    $('set-save').addEventListener('click', () => {
      if (!page.host) return;
      const prof = { sources: st.sources, filters: st.filters, scrollDepth: st.scrollDepth, queue: st.queue, out: st.out, video: st.video, adapter: st.adapter };
      const next = Object.assign({}, st.profiles); next[page.host] = prof;
      patch({ profiles: next });
      cue('done');
      flash('Profil disimpan untuk ' + page.host + '.');
    });
    $('set-drop').addEventListener('click', () => {
      const next = Object.assign({}, st.profiles); delete next[page.host];
      patch({ profiles: next });
      cue('close');
      flash('Profil ' + page.host + ' dihapus.');
    });
    $('set-reset').addEventListener('click', () => {
      st = JSON.parse(JSON.stringify(DEFAULTS));
      post({ type: 'GB_PATCH', patch: st });
      S.setEnabled(st.sound);
      setSound(st.sound);
      cue('done');
      flash('Setelan dikembalikan ke awal.');
    });
    $('set-wipe').addEventListener('click', () => {
      chrome.runtime.sendMessage({ type: 'GB_QUEUE_CMD', cmd: 'wipe' }).catch(() => {});
      cue('close');
      flash('Perintah hapus antrian & hash dikirim ke Studio.');
    });
  }

  /* ---------- pesan ---------- */
  window.addEventListener('message', (ev) => {
    const d = ev.data;
    if (!d || d.channel !== CHANNEL || d.token !== token) return;
    if (d.type === 'GB_HELLO') {
      st = merge(DEFAULTS, d.settings || {});
      items = d.items || [];
      stats = d.stats || stats;
      logs = d.logs || [];
      page = { url: d.url || '', title: d.title || '', host: d.host || '' };
      S.setEnabled(st.sound !== false);
      S.setVolume((st.volume == null ? 50 : st.volume) / 100);
      paintSound();
      if (!ready) { ready = true; setTab(st.openTab || 'overview', false); }
      paint();
      return;
    }
    if (d.type === 'GB_ITEMS') {
      const before = items.length;
      items = d.items || [];
      stats = d.stats || stats;
      if (items.length > before) cue('found');
      paint();
      return;
    }
    if (d.type === 'GB_LOG') { logs = d.logs || []; paintLog(); return; }
    if (d.type === 'GB_BUSY') {
      $('busy').classList.toggle('on', !!d.busy);
      if (d.label) $('busy-label').textContent = d.label;
      $('dock-live').textContent = d.busy ? 'memanen' : 'siap';
      return;
    }
  });

  chrome.runtime.onMessage.addListener((msg, sender, respond) => {
    if (!msg || typeof msg.type !== 'string') return;
    if (msg.type === 'GB_QUEUE_STATE') { queue = msg.snap; paintOverview(); paintQueue(); return; }
    if (msg.type === 'GB_SETTINGS_CHANGED') {
      st = merge(DEFAULTS, msg.settings || {});
      S.setEnabled(st.sound !== false);
      paint();
      return;
    }
    if (msg.type === 'GB_FOLDER_CHANGED') {
      st = merge(st, { out: { folderName: msg.name || '', mode: msg.mode || st.out.mode } });
      paintOutput();
      return;
    }
  });

  buildRail();
  buildToggles();
  bindAll();
  wire();
  S.setEnabled(st.sound !== false);
  paintSound();
  paint();
  post({ type: 'GB_READY' });
  chrome.runtime.sendMessage({ type: 'GB_QUEUE_PING' }).then((r) => { if (r && r.ok) { queue = r.snap; paint(); } }).catch(() => {});
  bg('GB_GET_SETTINGS').then((r) => {
    if (r && r.ok && !ready) { st = merge(DEFAULTS, r.settings); S.setEnabled(st.sound !== false); paintSound(); paint(); }
  });
  document.addEventListener('pointerdown', () => S.unlock(), { once: true });
})();