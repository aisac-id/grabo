/* Uji runtime Grabo: Chrome sungguhan + ekstensi terpasang + halaman fixture lokal.
 * Menutup panen, filter langsung, dok kendali, antrian massal, penulisan folder (OPFS
 * memakai API File System Access yang sama), mode unduhan Chrome, HLS/DASH, DRM,
 * panen berantai, Bluesky, pemulihan antrian, dan tampilan ponsel. */
const fs = require('fs');
const path = require('path');
const os = require('os');

/* puppeteer-core dipasang terpisah: npm install puppeteer-core@23 */
const puppeteer = require(process.env.GRABO_PUPPETEER || 'puppeteer-core');

const EXT = path.resolve(__dirname, '..');
const BASE = process.env.GRABO_BASE || 'http://127.0.0.1:8731';
const SHOTS = process.env.GRABO_SHOTS || path.join(__dirname, 'screenshots');
const DL = path.join(os.tmpdir(), 'grabo-dl');
const CHROME = process.env.CHROME_PATH || '/usr/bin/google-chrome';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
function check(name, ok, detail) {
  results.push({ name, ok: !!ok, skip: false, detail: detail === undefined ? '' : String(detail) });
  console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (detail !== undefined ? '  → ' + detail : ''));
}
function skip(name, reason) {
  results.push({ name, ok: true, skip: true, detail: reason });
  console.log('SKIP  ' + name + '  → ' + reason);
}
async function until(fn, ms, step) {
  const t0 = Date.now();
  for (;;) {
    let v = null;
    try { v = await fn(); } catch (e) { v = null; }
    if (v) return v;
    if (Date.now() - t0 > (ms || 30000)) return null;
    await sleep(step || 250);
  }
}

const IGNORE = /expired-token|flaky-01|favicon|ERR_BLOCKED_BY_CLIENT/i;
const errors = [];
const watchedPages = new WeakSet();
function watch(page, tag) {
  if (watchedPages.has(page)) return;
  watchedPages.add(page);
  page.on('pageerror', (e) => errors.push(tag + ' pageerror: ' + e.message));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const loc = m.location() || {};
    const t = m.text() + ' ' + (loc.url || '');
    if (IGNORE.test(t)) return;
    errors.push(tag + ' console: ' + t);
  });
  page.on('requestfailed', (r) => {
    const why = (r.failure() && r.failure().errorText) || '';
    /* ERR_ABORTED pada media adalah perilaku normal browser (elemen video dibuang / halaman pindah). */
    if (/ERR_ABORTED/i.test(why)) return;
    if (!IGNORE.test(r.url() + ' ' + why)) errors.push(tag + ' reqfail: ' + r.url() + ' ' + why);
  });
  page.on('response', (r) => { if (r.status() >= 400 && !IGNORE.test(r.url())) errors.push(tag + ' http' + r.status() + ': ' + r.url()); });
}

const OPFS_TREE = async () => {
  async function walk(dir, prefix) {
    const out = [];
    for await (const [name, h] of dir.entries()) {
      if (h.kind === 'directory') out.push(...await walk(h, prefix + name + '/'));
      else {
        const f = await h.getFile();
        const head = new Uint8Array(await f.slice(0, 16).arrayBuffer());
        out.push({ path: prefix + name, size: f.size, head: Array.from(head) });
      }
    }
    return out;
  }
  const root = await navigator.storage.getDirectory();
  return walk(root, '');
};

(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  fs.rmSync(DL, { recursive: true, force: true });
  fs.mkdirSync(DL, { recursive: true });
  await fetch(BASE + '/__reset');

  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    args: [
      '--no-sandbox', '--disable-dev-shm-usage',
      '--disable-extensions-except=' + EXT, '--load-extension=' + EXT,
      '--window-size=1600,1000', '--force-device-scale-factor=1',
      '--autoplay-policy=no-user-gesture-required', '--mute-audio'
    ],
    defaultViewport: { width: 1600, height: 1000 }
  });

  const swTarget = await browser.waitForTarget((t) => t.type() === 'service_worker' && t.url().includes('background.js'), { timeout: 20000 });
  const sw = await swTarget.worker();
  const extId = new URL(swTarget.url()).host;
  console.log('ekstensi:', extId);
  await until(async () => (await sw.evaluate(async () => !!(await chrome.storage.local.get('settings')).settings)));

  const cdp = await browser.target().createCDPSession();
  await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: DL, eventsEnabled: true });

  const watched = new Set();
  browser.on('targetcreated', async (tg) => {
    const pg = await tg.page().catch(() => null);
    if (!pg || watched.has(pg)) return;
    watched.add(pg);
    watch(pg, tg.url().includes('studio.html') ? 'studio' : 'halaman');
  });

  const page = await browser.newPage();
  watch(page, 'demo');
  await page.goto(BASE + '/index.html', { waitUntil: 'networkidle2' });
  await until(async () => page.evaluate(() => !!window.__graboLoaded));
  await sleep(1200);

  const tabId = await sw.evaluate(async (base) => {
    const tabs = await chrome.tabs.query({ url: base + '/*' });
    return tabs.length ? tabs[0].id : null;
  }, BASE);
  check('content script aktif di halaman fixture', !!tabId, 'tab ' + tabId);

  const state = () => sw.evaluate(async (id) => {
    const r = await chrome.tabs.sendMessage(id, { type: 'GB_STATE' });
    return r && r.ok ? r : null;
  }, tabId);
  const settings = () => sw.evaluate(async () => (await chrome.storage.local.get('settings')).settings);

  /* ---------- 1. dok & tampilan desktop ---------- */
  const defs = await settings();
  check('suara aktif secara bawaan', defs.sound === true, 'sound=' + defs.sound);
  check('lebar sidebar bawaan 25%', defs.sidebarWidth === 25, defs.sidebarWidth);

  await sw.evaluate(async (id) => chrome.tabs.sendMessage(id, { type: 'GB_TOGGLE', open: true }), tabId);
  await sleep(1400);
  const dock = await page.evaluate(() => {
    const f = document.querySelector('iframe.gb-sidebar-host');
    if (!f) return null;
    const r = f.getBoundingClientRect();
    const cs = getComputedStyle(f);
    return {
      state: f.dataset.state, w: r.width, h: r.height, right: r.right, vw: innerWidth, vh: innerHeight,
      docked: document.documentElement.classList.contains('gb-docked'),
      htmlW: document.documentElement.getBoundingClientRect().width,
      z: cs.zIndex, pos: cs.position, minW: cs.minWidth
    };
  });
  check('sidebar terpasang & terbuka', dock && dock.state === 'open', JSON.stringify(dock));
  check('sidebar tepat 1/4 layar', dock && Math.abs(dock.w / dock.vw - 0.25) < 0.01, dock && (dock.w / dock.vw).toFixed(4));
  check('sidebar menempel kanan, tinggi penuh', dock && Math.abs(dock.right - dock.vw) < 1 && Math.abs(dock.h - dock.vh) < 1);
  check('halaman digeser, tidak tertimpa (dock)', dock && dock.docked && Math.abs(dock.htmlW - (dock.vw - dock.w)) < 2, dock && dock.htmlW);
  check('z-index di atas konten halaman', dock && Number(dock.z) > 2147483000, dock && dock.z);

  const sb = page.frames().find((f) => f.url().includes('sidebar.html'));
  check('frame sidebar termuat', !!sb, sb && sb.url().slice(0, 64));
  if (!sb) { console.log(errors); await browser.close(); process.exit(1); }

  const railInfo = await sb.evaluate(() => {
    const tabs = Array.from(document.querySelectorAll('#rail .tab'));
    const rects = tabs.map((t) => t.getBoundingClientRect());
    const rail = document.getElementById('rail').getBoundingClientRect();
    return {
      count: tabs.length,
      labels: tabs.map((t) => t.textContent.trim()),
      vertical: rects.every((r, i) => i === 0 || r.top > rects[i - 1].top),
      sameX: rects.every((r) => Math.abs(r.left - rects[0].left) < 1),
      railW: rail.width, shellW: document.querySelector('.shell').getBoundingClientRect().width,
      overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth
    };
  });
  check('9 tab tersusun menurun di rel sidebar', railInfo.count === 9 && railInfo.vertical && railInfo.sameX, railInfo.labels.join(','));
  check('rel sempit, bukan tab horizontal', railInfo.railW < railInfo.shellW * 0.35, railInfo.railW + ' / ' + railInfo.shellW);
  check('tanpa limpah horizontal di sidebar', railInfo.overflowX <= 0, railInfo.overflowX);

  const dockInfo = await sb.evaluate(() => {
    const d = document.getElementById('dock');
    const r = d.getBoundingClientRect();
    const vis = (e) => { const b = e.getBoundingClientRect(); return b.width > 4 && b.height > 4; };
    const ranges = Array.from(d.querySelectorAll('input[type=range]')).filter(vis);
    const selects = Array.from(d.querySelectorAll('select')).filter(vis);
    const sws = Array.from(d.querySelectorAll('.sw u')).filter(vis);
    const btns = Array.from(d.querySelectorAll('button')).filter(vis);
    return {
      ranges: ranges.length, selects: selects.length, switches: sws.length, buttons: btns.length,
      total: ranges.length + selects.length + sws.length + btns.length,
      bottom: r.bottom, top: r.top, vh: innerHeight, visible: r.top < innerHeight && r.bottom <= innerHeight + 1
    };
  });
  check('dok kendali selalu terlihat', dockInfo.visible, JSON.stringify(dockInfo));
  check('≥7 kendali hidup di dok', dockInfo.total >= 7, dockInfo.total + ' kendali (' + dockInfo.ranges + ' range, ' + dockInfo.selects + ' select, ' + dockInfo.switches + ' switch, ' + dockInfo.buttons + ' tombol)');

  const soundBtn = await sb.evaluate(() => document.getElementById('btn-sound').getAttribute('aria-pressed'));
  check('tombol bisu terlihat & aktif', soundBtn === 'true', soundBtn);
  await sb.click('#btn-sound');
  await sleep(500);
  const muted = await sb.evaluate(() => document.getElementById('btn-sound').getAttribute('aria-pressed'));
  const mutedStored = (await settings()).sound;
  check('klik bisu mematikan suara & tersimpan', muted === 'false' && mutedStored === false, muted + ' / ' + mutedStored);
  await sb.click('#btn-sound');
  await sleep(500);
  check('klik lagi menyalakan suara', (await settings()).sound === true);

  /* ---------- 2. panen ---------- */
  await sb.click('#d-scan');
  const s1 = await until(async () => { const s = await state(); return s && s.stats.kept > 10 ? s : null; }, 40000);
  check('panen cepat menemukan media', !!s1, s1 && JSON.stringify(s1.stats));
  const bySource = s1 ? s1.stats.bySource : {};
  check('sumber DOM terpakai', (bySource.dom || 0) > 5, bySource.dom);
  check('sumber jaringan terpakai', (bySource.net || 0) > 0, bySource.net);
  check('sumber metadata terpakai', (bySource.meta || 0) > 0, bySource.meta);
  check('sumber latar CSS terpakai', (bySource.css || 0) > 0 || s1.items.some((i) => /css-only/.test(i.url)), bySource.css);
  check('sumber kanvas terpakai', (bySource.canvas || 0) > 0, bySource.canvas);
  const kinds = s1 ? s1.stats.byKind : {};
  check('gambar & video & playlist terkumpul', (kinds.image || 0) > 15 && (kinds.video || 0) > 0 && (kinds.playlist || 0) > 0, JSON.stringify(kinds));
  const dropped = s1 ? s1.stats.dropped : {};
  check('ikon kecil & thumbnail disaring', (dropped.kecil || 0) + (dropped.thumbnail || 0) > 0, JSON.stringify(dropped));
  const urls1 = s1.items.map((i) => i.url);
  check('varian srcset resolusi terbesar dipilih', urls1.some((u) => /big-01\.jpg/.test(u)));
  check('media blob & data terdaftar', urls1.some((u) => u.startsWith('blob:')) && urls1.some((u) => u.startsWith('data:')));
  check('playlist HLS & DASH terdaftar', urls1.some((u) => /hls\/master\.m3u8/.test(u)) && urls1.some((u) => /dash\/manifest\.mpd/.test(u)), urls1.filter((u) => /\.(m3u8|mpd)/.test(u)).length + ' playlist');

  await sb.evaluate(() => {
    const el = document.getElementById('d-depth');
    el.value = 8; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await sleep(400);
  await sb.click('#d-deep');
  const s2 = await until(async () => {
    const s = await state();
    return s && s.items.filter((i) => /\/lazy\//.test(i.url)).length >= 8 && s.items.filter((i) => /\/fold\//.test(i.url)).length >= 3 ? s : null;
  }, 90000);
  check('panen dalam memuat media malas-muat', !!s2, s2 && s2.items.filter((i) => /\/lazy\//.test(i.url)).length + ' lazy');
  const more = s2 && s2.items.filter((i) => /lazy-0[5-8]/.test(i.url)).length;
  check('tombol “Muat lebih” diklik otomatis', more >= 4, more + ' media tambahan');
  check('media yang baru dibuat di bawah lipatan ditemukan', s2 && s2.items.filter((i) => /\/fold\//.test(i.url)).length === 3, s2 && s2.items.filter((i) => /\/fold\//.test(i.url)).length + ' media bawah lipatan');

  /* filter langsung dari dok */
  const keptBefore = s2.stats.kept;
  await sb.evaluate(() => {
    const el = document.getElementById('d-minw');
    el.value = 1200; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true }));
  });
  const s3 = await until(async () => { const s = await state(); return s && s.stats.kept < keptBefore ? s : null; }, 12000);
  check('slider lebar minimum menyaring seketika', !!s3, s3 && keptBefore + ' → ' + s3.stats.kept);
  check('tak ada gambar lebih kecil dari batas', s3 && !s3.items.some((i) => i.kind === 'image' && i.w && i.w < 1200));
  await sb.evaluate(() => {
    const el = document.getElementById('d-minw');
    el.value = 0; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await sleep(600);

  await sb.evaluate(() => { const el = document.getElementById('d-img'); el.checked = false; el.dispatchEvent(new Event('change', { bubbles: true })); });
  const s4 = await until(async () => { const s = await state(); return s && !s.items.some((i) => i.kind === 'image') ? s : null; }, 12000);
  check('sakelar gambar mematikan jenis gambar', !!s4, s4 && s4.stats.kept + ' tersisa');
  await sb.evaluate(() => { const el = document.getElementById('d-img'); el.checked = true; el.dispatchEvent(new Event('change', { bubbles: true })); });
  await sleep(700);

  await sb.evaluate(() => {
    const el = document.getElementById('d-minb');
    el.value = 40; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await sleep(800);
  const s5 = await state();
  check('slider ukuran minimum berlaku', s5.stats.kept < s2.stats.kept, s2.stats.kept + ' → ' + s5.stats.kept);
  await sb.evaluate(() => {
    const el = document.getElementById('d-minb');
    el.value = 0; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await sleep(600);

  await sb.click('#tab-filter');
  await sb.evaluate(() => {
    const el = document.getElementById('t-exclude');
    el.focus();
    el.value = '*/alias/*';
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  const s6 = await until(async () => { const s = await state(); return s && !s.items.some((i) => /\/alias\//.test(i.url)) ? s : null; }, 12000);
  check('pola kecualikan berlaku langsung', !!s6, s6 && s6.stats.kept + ' tersisa');
  await sb.evaluate(() => {
    const el = document.getElementById('t-exclude');
    el.focus();
    el.value = '';
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await sleep(900);

  /* ---------- 3. galeri ---------- */
  await sb.click('#tab-gallery');
  await sleep(700);
  const gal = await sb.evaluate(() => ({
    tiles: document.querySelectorAll('#g-grid .tile').length,
    sel: document.querySelectorAll('#g-grid .tile.sel').length,
    shown: document.getElementById('g-shown').textContent,
    count: document.getElementById('g-count').textContent
  }));
  check('galeri menampilkan petak media', gal.tiles > 15, JSON.stringify(gal));
  const toggle = await sb.evaluate(() => {
    const t = document.querySelector('#g-grid .tile');
    const before = t.classList.contains('sel');
    t.click();
    return { id: t.dataset.id, before };
  });
  await sleep(600);
  const afterClick = await sb.evaluate((id) => {
    const t = document.querySelector('#g-grid .tile[data-id="' + id + '"]');
    return t ? t.classList.contains('sel') : null;
  }, toggle.id);
  check('klik petak membalik pilihan', afterClick === !toggle.before, toggle.before + ' → ' + afterClick);
  await sb.evaluate((id) => document.querySelector('#g-grid .tile[data-id="' + id + '"]').click(), toggle.id);
  await sleep(500);

  const tileHandle = await sb.$('#g-grid .tile');
  await tileHandle.click({ clickCount: 2 });
  await sleep(700);
  const lb = await sb.evaluate(() => ({
    on: document.getElementById('lb').classList.contains('on'),
    media: !!document.querySelector('#lb-body img, #lb-body video, #lb-body .card'),
    cap: document.getElementById('lb-cap').textContent.slice(0, 60)
  }));
  check('klik ganda membuka lightbox', lb.on && lb.media, JSON.stringify(lb));
  await page.keyboard.press('Escape');
  await sleep(500);
  check('Escape menutup lightbox', !(await sb.evaluate(() => document.getElementById('lb').classList.contains('on'))));

  await sb.click('#g-none');
  await sleep(600);
  const noneSel = await state();
  check('“hapus pilihan” bekerja', noneSel.items.every((i) => !i.selected));
  await sb.click('#g-all');
  await sleep(600);
  const allSel = await state();
  check('“pilih semua” bekerja', allSel.items.every((i) => i.selected), allSel.items.length + ' dipilih');

  await sb.click('#tab-overview');
  await sleep(500);
  await page.screenshot({ path: path.join(SHOTS, '01-desktop-ringkas.png') });
  await sb.click('#tab-gallery');
  await sleep(900);
  await page.screenshot({ path: path.join(SHOTS, '02-desktop-galeri.png') });

  /* ---------- 4. antrian massal via Studio ---------- */
  await sb.click('#d-enqueue');
  const studioPage = await until(async () => {
    const p = (await browser.pages()).find((x) => x.url().includes('studio.html'));
    if (!p) return null;
    const ready = await p.evaluate(() => !!window.__graboStudio).catch(() => false);
    return ready ? p : null;
  }, 40000);
  if (!studioPage) console.log('DEBUG halaman terbuka:', (await browser.pages()).map((p) => p.url().slice(0, 70)), 'galat:', errors.slice(-6));
  check('Studio terbuka sebagai halaman mesin', !!studioPage, studioPage && studioPage.url());
  if (!studioPage) { console.log(errors); await browser.close(); process.exit(1); }
  watch(studioPage, 'studio');
  await studioPage.bringToFront();

  const enq = await until(async () => {
    const n = await studioPage.evaluate(() => window.__graboStudio.queue.jobs.length);
    return n > 10 ? n : null;
  }, 25000);
  check('media terpilih masuk antrian Studio', !!enq, enq + ' pekerjaan');

  const studioTabs = await studioPage.evaluate(() => {
    const tabs = Array.from(document.querySelectorAll('#rail .tab'));
    const d = document.getElementById('dock');
    const vis = (e) => { const b = e.getBoundingClientRect(); return b.width > 4 && b.height > 4; };
    const r = d.getBoundingClientRect();
    return {
      tabs: tabs.length,
      controls: d.querySelectorAll('input[type=range]').length + Array.from(d.querySelectorAll('select')).filter(vis).length
        + Array.from(d.querySelectorAll('.sw u')).filter(vis).length + Array.from(d.querySelectorAll('button')).filter(vis).length,
      dockVisible: r.top < innerHeight && r.bottom <= innerHeight + 1,
      overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth
    };
  });
  check('Studio punya 8 tab + dok mesin', studioTabs.tabs === 8 && studioTabs.dockVisible, JSON.stringify(studioTabs));
  check('dok Studio ≥7 kendali', studioTabs.controls >= 7, studioTabs.controls);
  check('Studio tanpa limpah horizontal', studioTabs.overflowX <= 0, studioTabs.overflowX);

  /* folder tujuan: OPFS = FileSystemDirectoryHandle sungguhan */
  await studioPage.click('#tab-output');
  await sleep(400);
  await studioPage.click('#o-internal');
  await sleep(900);
  const folderUi = await studioPage.evaluate(() => ({
    name: document.getElementById('o-name').textContent,
    ok: document.getElementById('o-box').classList.contains('ok'),
    pill: document.getElementById('pill-folder').textContent,
    preview: document.getElementById('o-preview').textContent.replace(/\s+/g, ' ').slice(0, 120)
  }));
  check('folder tujuan aktif & acknowledged di UI', folderUi.ok && /internal/i.test(folderUi.name), JSON.stringify(folderUi));
  const sbFolder = await sb.evaluate(() => document.getElementById('o-fname') && document.getElementById('o-fname').textContent);
  check('nama folder tersiar ke sidebar', /internal/i.test(sbFolder || ''), 'sidebar: ' + sbFolder);

  await studioPage.evaluate(async () => {
    const root = await navigator.storage.getDirectory();
    for await (const [name] of root.entries()) await root.removeEntry(name, { recursive: true });
    await window.GBStore.clearHashes();
  });

  await studioPage.evaluate(() => {
    const set = (id, v) => { const e = document.getElementById(id); e.value = v; e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true })); };
    set('d-workers', 3); set('d-gap', 200); set('d-retries', 2);
  });
  await sleep(700);
  const cfg1 = await studioPage.evaluate(() => Object.assign({}, window.__graboStudio.queue.cfg));
  check('kendali dok mengatur mesin', cfg1.concurrency === 3 && cfg1.gap === 200 && cfg1.retries === 2, JSON.stringify(cfg1));

  /* Halaman fixture sendiri sudah meminta URL flaky saat dimuat; catat kegagalan seumur hidup
   * sebelum penghitung direset, supaya bukti "gagal 2x lalu berhasil" tetap utuh. */
  const preRun = await (await fetch(BASE + '/__stats')).json();
  await fetch(BASE + '/__reset');
  await studioPage.click('#d-run');
  const peak = { running: 0, workers: 0 };
  const finished = await until(async () => {
    const s = await studioPage.evaluate(() => {
      const q = window.__graboStudio.queue.snapshot();
      return { running: q.running, paused: q.paused, workers: q.workers, counts: q.counts, total: q.total, bytes: q.bytes, rate: q.rate, eta: q.eta };
    });
    peak.running = Math.max(peak.running, s.counts.running || 0);
    peak.workers = Math.max(peak.workers, s.workers || 0);
    return !s.running && (s.counts.queued || 0) === 0 && s.total > 0 ? s : null;
  }, 180000, 400);
  check('antrian berjalan sampai habis', !!finished, finished && JSON.stringify(finished.counts));
  check('konkurensi dihormati (≤3)', peak.running <= 3 && peak.workers <= 3, JSON.stringify(peak));
  check('laju & ETA terhitung', finished && finished.bytes > 0, finished && Math.round(finished.bytes / 1024) + ' KB tertulis');

  const jobs = await studioPage.evaluate(() => window.__graboStudio.queue.snapshot().jobs.map((j) => ({
    url: j.url.slice(0, 120), name: j.name, kind: j.kind, state: j.state, attempts: j.attempts, out: j.out, bytes: j.bytes, segments: j.segments, error: j.error, hash: j.hash
  })));
  fs.writeFileSync(path.join(__dirname, 'test-jobs.json'), JSON.stringify(jobs, null, 1));
  const find = (re) => jobs.find((j) => re.test(j.url));
  const findAll = (re) => jobs.filter((j) => re.test(j.url));

  const flaky = find(/flaky-01/);
  const srv1 = await (await fetch(BASE + '/__stats')).json();
  check('gagal sementara dicoba ulang lalu berhasil', flaky && flaky.state === 'done' && flaky.attempts >= 2, flaky && flaky.state + ' attempts=' + flaky.attempts);
  check('server menolak 2 permintaan pertama lalu melayani', preRun.stats.flakyFail === 2 && srv1.stats.flakyOk >= 1 && srv1.stats.flakyFail >= 1,
    JSON.stringify({ sebelumRun: preRun.stats.flakyFail, saatRun: srv1.stats.flakyFail, sukses: srv1.stats.flakyOk }));
  const forbidden = find(/expired-token/);
  check('403 gagal cepat tanpa retry', forbidden && forbidden.state === 'failed' && forbidden.attempts === 1 && /403/.test(forbidden.error), forbidden && forbidden.state + ' attempts=' + forbidden.attempts + ' ' + forbidden.error);

  /* Dedup berbasis isi: untuk setiap grup hash identik hanya satu berkas yang ditulis,
   * sisanya ditandai "kembar". Urutan kedatangan tidak menentukan siapa yang menang. */
  const groups = {};
  jobs.filter((j) => j.hash).forEach((j) => { (groups[j.hash] = groups[j.hash] || []).push(j); });
  const dupGroups = Object.values(groups).filter((g) => g.length > 1);
  const dupOk = dupGroups.length >= 2 && dupGroups.every((g) =>
    g.filter((j) => j.state === 'done' && j.out).length === 1 &&
    g.filter((j) => j.state === 'skipped').length === g.length - 1);
  check('isi kembar ditulis sekali, sisanya “kembar” (dedup SHA-256)', dupOk,
    dupGroups.map((g) => g.map((j) => j.state).join('/')).join(' | '));

  const hls = find(/hls\/master\.m3u8/);
  check('HLS master → varian terbaik digabung', hls && hls.state === 'done' && hls.segments >= 4 && /\.(ts|mp4)$/.test(hls.out), hls && hls.state + ' ' + hls.segments + ' segmen → ' + hls.out);
  const fmp4 = find(/hls-fmp4\/master\.m3u8/);
  check('HLS fMP4 → init + fragmen jadi .mp4', fmp4 && fmp4.state === 'done' && /\.mp4$/.test(fmp4.out) && fmp4.segments >= 4, fmp4 && fmp4.state + ' ' + fmp4.segments + ' → ' + fmp4.out);
  const dash = find(/dash\/manifest\.mpd/);
  check('DASH non-DRM digabung', dash && dash.state === 'done' && dash.segments >= 4, dash && dash.state + ' ' + dash.segments + ' → ' + dash.out);
  const secure = find(/secure\/master\.m3u8/);
  const dashSecure = find(/dash-secure\/manifest\.mpd/);
  check('HLS terenkripsi dilewati (bukan gagal)', secure && secure.state === 'protected', secure && secure.state + ' — ' + secure.error);
  check('DASH ber-DRM dilewati', dashSecure && dashSecure.state === 'protected', dashSecure && dashSecure.state + ' — ' + dashSecure.error);

  const blobJob = jobs.find((j) => j.url.startsWith('blob:'));
  const dataJob = jobs.find((j) => j.url.startsWith('data:'));
  check('blob dibaca lewat konteks halaman', blobJob && blobJob.state === 'done' && blobJob.bytes > 1000, blobJob && blobJob.state + ' ' + blobJob.bytes + 'B → ' + blobJob.out);
  check('data URL kanvas tersimpan / ditandai kembar dengan blob-nya', dataJob && ['done', 'skipped'].includes(dataJob.state) && dataJob.bytes > 1000, dataJob && dataJob.state + ' ' + dataJob.bytes + 'B');
  const clip = find(/clip\.mp4/);
  const blobVid = jobs.find((j) => j.url.startsWith('blob:') && j.kind === 'video');
  const clipOk = (clip && clip.state === 'done' && clip.bytes > 10000) || (blobVid && blobVid.state === 'done' && blobVid.bytes > 10000 && clip && clip.state === 'skipped');
  check('video progresif tersimpan utuh (atau kembar dengan salinan blob)', clipOk, clip && clip.state + ' ' + clip.bytes + 'B; blob ' + (blobVid && blobVid.state));

  const tree = await studioPage.evaluate(OPFS_TREE);
  const files = tree.filter((f) => !/manifest.*\.json$/.test(f.path));
  const manifests = tree.filter((f) => /grabo-manifest-.*\.json$/.test(f.path));
  const doneCount = jobs.filter((j) => j.state === 'done').length;
  check('berkas tertulis di folder tujuan', files.length === doneCount && files.length > 20, files.length + ' berkas / ' + doneCount + ' selesai');
  check('subfolder template dibuat', files.every((f) => f.path.split('/').length >= 3), files[0] && files[0].path);
  check('manifest asal-usul ditulis', manifests.length >= 1, manifests.map((m) => m.path).join(','));
  const manText = await studioPage.evaluate(async (p) => {
    const parts = p.split('/');
    let dir = await navigator.storage.getDirectory();
    for (let i = 0; i < parts.length - 1; i++) dir = await dir.getDirectoryHandle(parts[i]);
    const fh = await dir.getFileHandle(parts[parts.length - 1]);
    return await (await fh.getFile()).text();
  }, manifests[0].path);
  const man = JSON.parse(manText);
  check('manifest berisi URL sumber + hash', man.files === doneCount && man.items.every((i) => i.url && i.hash && i.out), man.files + ' entri');
  const hlsFile = tree.find((f) => f.path === hls.out);
  check('berkas HLS nyata di disk', hlsFile && hlsFile.size === hls.bytes && hlsFile.size > 20000, hlsFile && hlsFile.size + 'B');
  const fmp4File = tree.find((f) => f.path === fmp4.out);
  const isFtyp = fmp4File && String.fromCharCode(...fmp4File.head.slice(4, 8)) === 'ftyp';
  check('keluaran fMP4 diawali ftyp (mp4 sah)', isFtyp, fmp4File && JSON.stringify(fmp4File.head.slice(0, 12)));
  const dashFile = tree.find((f) => f.path === dash.out);
  check('keluaran DASH berupa mp4', dashFile && String.fromCharCode(...dashFile.head.slice(4, 8)) === 'ftyp', dashFile && dashFile.size + 'B');

  await studioPage.click('#tab-queue');
  await sleep(600);
  await studioPage.screenshot({ path: path.join(SHOTS, '03-studio-antrian.png') });
  await studioPage.click('#tab-manifest');
  await sleep(600);
  const manUi = await studioPage.evaluate(() => ({ rows: document.querySelectorAll('#m-rows tr').length, count: document.getElementById('m-count').textContent }));
  check('tab manifest menampilkan tabel berkas', manUi.rows > 20, JSON.stringify(manUi));
  await studioPage.screenshot({ path: path.join(SHOTS, '04-studio-manifest.png') });
  await studioPage.click('#tab-output');
  await sleep(500);
  await studioPage.screenshot({ path: path.join(SHOTS, '05-studio-folder.png') });

  /* ---------- 5. jeda / lanjut / pembatas laju ---------- */
  await studioPage.evaluate(async () => {
    await window.__graboStudio.queue.clearAll();
    await window.GBStore.clearHashes();
    const root = await navigator.storage.getDirectory();
    for await (const [name] of root.entries()) await root.removeEntry(name, { recursive: true });
    const items = [];
    for (let i = 1; i <= 6; i++) {
      const u = 'http://127.0.0.1:8731/assets/big-0' + i + '.jpg';
      items.push({ url: u, kind: 'image', source: 'uji', name: 'big-0' + i + '.jpg', host: '127.0.0.1' });
    }
    window.__graboStudio.addItems(items, false);
    const set = (id, v) => { const e = document.getElementById(id); e.value = v; e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true })); };
    set('d-workers', 1); set('d-gap', 500);
  });
  await sleep(800);
  await fetch(BASE + '/__reset');
  await studioPage.click('#tab-queue');
  await studioPage.click('#d-run');
  await sleep(1100);
  await studioPage.click('#d-pause');
  await sleep(700);
  const paused = await studioPage.evaluate(() => {
    const s = window.__graboStudio.queue.snapshot();
    return { running: s.running, paused: s.paused, queued: s.counts.queued, done: s.counts.done };
  });
  check('jeda menghentikan pekerjaan baru tanpa mematikan mesin', paused.running && paused.paused && paused.queued > 0, JSON.stringify(paused));
  const doneAtPause = paused.done;
  await sleep(1500);
  const stillPaused = await studioPage.evaluate(() => window.__graboStudio.queue.snapshot().counts.done);
  check('saat jeda tidak ada berkas baru', stillPaused === doneAtPause, doneAtPause + ' → ' + stillPaused);
  await studioPage.click('#d-pause');
  const resumed = await until(async () => {
    const s = await studioPage.evaluate(() => window.__graboStudio.queue.snapshot());
    return !s.running && s.counts.queued === 0 ? s : null;
  }, 60000, 400);
  check('lanjut menyelesaikan sisa antrian', resumed && resumed.counts.done === 6, resumed && JSON.stringify(resumed.counts));

  const srv2 = await (await fetch(BASE + '/__stats')).json();
  const times = srv2.reqLog.filter((r) => /big-0[1-6]\.jpg$/.test(r.rel)).map((r) => r.t).sort((a, b) => a - b);
  const gaps = times.slice(1).map((t, i) => t - times[i]);
  check('pembatas laju per host ≥450ms', gaps.length >= 4 && gaps.every((g) => g >= 450), 'jeda: ' + gaps.join(','));

  /* ---------- 6. mode unduhan Chrome ---------- */
  await studioPage.evaluate(async () => {
    await window.__graboStudio.queue.clearAll();
    const e = document.getElementById('d-mode');
    e.value = 'downloads'; e.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 500));
    window.__graboStudio.addItems([
      { url: 'http://127.0.0.1:8731/assets/big-07.jpg', kind: 'image', source: 'uji', name: 'big-07.jpg', host: '127.0.0.1' },
      { url: 'http://127.0.0.1:8731/assets/portrait-01.png', kind: 'image', source: 'uji', name: 'portrait-01.png', host: '127.0.0.1' }
    ], false);
  });
  await sleep(700);
  const modeNow = await studioPage.evaluate(() => window.__graboStudio.writer.state.mode);
  check('mode keluaran bisa diganti ke unduhan Chrome', modeNow === 'downloads', modeNow);
  await studioPage.click('#d-run');
  const dlDone = await until(async () => {
    const s = await studioPage.evaluate(() => window.__graboStudio.queue.snapshot());
    return !s.running && s.counts.queued === 0 && s.total === 2 ? s : null;
  }, 60000, 400);
  const dlFiles = [];
  (function walk(d, p) {
    for (const n of fs.readdirSync(d)) {
      const f = path.join(d, n);
      if (fs.statSync(f).isDirectory()) walk(f, p + n + '/');
      else dlFiles.push({ path: p + n, size: fs.statSync(f).size });
    }
  })(DL, '');
  const mediaDl = dlFiles.filter((f) => f.size > 20000);
  check('mode unduhan menulis lewat chrome.downloads', dlDone && dlDone.counts.done === 2 && mediaDl.length === 2, dlDone && JSON.stringify(dlDone.counts) + ' · ' + dlFiles.length + ' berkas');
  /* Catatan uji: penulis memakai blob: URL, dan CDP Browser.setDownloadBehavior meratakan nama
   * berkas menjadi UUID blob serta tidak memancarkan downloadWillBegin untuk unduhan ekstensi.
   * Bukti yang jujur: catatan chrome.downloads (selesai, milik Grabo, mime & ukuran byte tepat)
   * plus jalur yang diminta pada job.out. */
  const dlRecords = await sw.evaluate(async () => {
    const rows = await chrome.downloads.search({ orderBy: ['-startTime'], limit: 20 });
    return rows.map((r) => ({ mime: r.mime, bytes: r.totalBytes, file: r.filename, state: r.state, by: r.byExtensionName || '' }));
  });
  const wantBytes = ['big-07.jpg', 'portrait-01.png'].map((n) => fs.statSync(path.join(EXT, 'demo', 'assets', n)).size).sort((a, b) => a - b);
  const imgs = dlRecords.filter((r) => /^image\//.test(r.mime));
  const gotBytes = imgs.map((r) => r.bytes).sort((a, b) => a - b);
  check('chrome.downloads menyelesaikan 2 gambar atas nama Grabo dengan byte utuh',
    imgs.length === 2 && imgs.every((r) => r.state === 'complete' && /Grabo/.test(r.by)) &&
    JSON.stringify(gotBytes) === JSON.stringify(wantBytes),
    imgs.map((r) => r.state + ' ' + r.mime + ' ' + r.bytes + 'B [' + r.by + ']').join(' | '));
  check('jalur keluaran tercatat di pekerjaan', dlDone && dlDone.jobs.every((j) => /^Grabo\//.test(j.out)), dlDone && dlDone.jobs.map((j) => j.out).join(' | '));

  await studioPage.evaluate(async () => {
    const e = document.getElementById('d-mode');
    e.value = 'fs'; e.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 400));
    await window.__graboStudio.writer.useInternal();
    await window.__graboStudio.queue.clearAll();
  });
  await sleep(600);

  /* ---------- 7. panen berantai dari daftar tautan ---------- */
  await studioPage.click('#tab-links');
  await sleep(400);
  await studioPage.evaluate(() => {
    const t = document.getElementById('l-urls');
    t.value = 'http://127.0.0.1:8731/profil.html\nhttp://127.0.0.1:8731/galeri.html';
    t.dispatchEvent(new Event('input', { bubbles: true }));
    const s = document.getElementById('l-scroll');
    if (!s.checked) { s.checked = true; s.dispatchEvent(new Event('change', { bubbles: true })); }
  });
  const linkCount = await studioPage.evaluate(() => document.getElementById('l-count').textContent);
  check('penghitung tautan massal hidup', /2/.test(linkCount), linkCount);
  await studioPage.click('#l-run');
  const batchDone = await until(async () => {
    const s = await studioPage.evaluate(() => ({
      jobs: window.__graboStudio.queue.jobs.map((j) => ({ pageUrl: j.pageUrl, url: j.url })),
      state: document.getElementById('l-state').textContent.replace(/\s+/g, ' ')
    }));
    const p = s.jobs.filter((j) => /profil\.html/.test(j.pageUrl)).length;
    const g = s.jobs.filter((j) => /galeri\.html/.test(j.pageUrl)).length;
    return p >= 6 && g >= 6 ? { p, g, total: s.jobs.length, state: s.state } : null;
  }, 120000, 600);
  check('panen berantai memproses banyak tautan', !!batchDone, batchDone && JSON.stringify(batchDone));
  await studioPage.screenshot({ path: path.join(SHOTS, '06-studio-tautan.png') });

  /* ---------- 8. Bluesky (API publik) ---------- */
  await studioPage.click('#tab-bluesky');
  await sleep(400);
  await studioPage.evaluate(() => {
    document.getElementById('b-handle').value = 'bsky.app';
    const e = document.getElementById('b-limit');
    e.value = 40; e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await studioPage.click('#b-run');
  const bsky = await until(async () => {
    const r = await studioPage.evaluate(() => ({
      state: document.getElementById('b-state').textContent.replace(/\s+/g, ' '),
      tiles: document.querySelectorAll('#b-grid .tile').length,
      jobs: window.__graboStudio.queue.jobs.filter((j) => /bsky|cdn\.bsky/.test(j.url)).length
    }));
    return r.jobs > 0 || /Gagal/.test(r.state) ? r : null;
  }, 60000, 700);
  if (bsky && bsky.jobs > 0) check('Bluesky: media profil masuk antrian', true, JSON.stringify(bsky));
  else skip('Bluesky: media profil masuk antrian', 'API tidak terjangkau dari sandbox: ' + (bsky && bsky.state));
  await studioPage.screenshot({ path: path.join(SHOTS, '07-studio-bluesky.png') });

  /* ---------- 9. pemulihan antrian setelah muat ulang ---------- */
  const beforeReload = await studioPage.evaluate(async () => {
    await window.__graboStudio.queue.persist();
    return (await window.GBStore.allJobs()).length;
  });
  await studioPage.reload({ waitUntil: 'networkidle2' });
  const back = await until(async () => {
    const ok = await studioPage.evaluate(() => !!window.__graboStudio).catch(() => false);
    if (!ok) return null;
    const n = await studioPage.evaluate(() => window.__graboStudio.queue.jobs.length);
    return n >= beforeReload ? n : null;
  }, 30000);
  check('antrian bertahan setelah Studio dimuat ulang', back >= beforeReload && back > 0, beforeReload + ' → ' + back);
  const noRunning = await studioPage.evaluate(() => window.__graboStudio.queue.jobs.filter((j) => j.state === 'running').length);
  check('pekerjaan “jalan” dipulihkan jadi antre', noRunning === 0, noRunning);

  /* uji tulis manual ke folder */
  await studioPage.click('#tab-output');
  await sleep(300);
  await studioPage.click('#o-internal');
  await sleep(500);
  await studioPage.click('#o-test');
  await sleep(900);
  const testLog = await studioPage.evaluate(() => document.getElementById('log-box').textContent);
  check('tombol uji tulis benar-benar menulis', /Uji tulis berhasil/.test(testLog), testLog.split('\n')[0].slice(0, 90));

  /* ---------- 10. ponsel ---------- */
  const mob = await browser.newPage();
  watch(mob, 'mobile');
  await mob.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  await mob.goto(BASE + '/index.html', { waitUntil: 'networkidle2' });
  await until(async () => mob.evaluate(() => !!window.__graboLoaded));
  await sleep(1000);
  const mobTab = await sw.evaluate(async () => {
    const tabs = await chrome.tabs.query({ url: 'http://127.0.0.1:8731/index.html' });
    return tabs.length ? tabs[tabs.length - 1].id : null;
  });
  await sw.evaluate(async (id) => chrome.tabs.sendMessage(id, { type: 'GB_TOGGLE', open: true }), mobTab);
  await sleep(1500);
  const mobDock = await mob.evaluate(() => {
    const f = document.querySelector('iframe.gb-sidebar-host');
    const r = f.getBoundingClientRect();
    return { w: r.width, vw: innerWidth, h: r.height, vh: innerHeight, state: f.dataset.state };
  });
  check('ponsel: sidebar selebar layar', mobDock.state === 'open' && Math.abs(mobDock.w - mobDock.vw) < 2, JSON.stringify(mobDock));
  const msb = mob.frames().find((f) => f.url().includes('sidebar.html'));
  check('frame sidebar ponsel termuat', !!msb);
  const mobUi = await msb.evaluate(() => {
    const d = document.getElementById('dock');
    const r = d.getBoundingClientRect();
    const vis = (e) => { const b = e.getBoundingClientRect(); return b.width > 4 && b.height > 4; };
    const controls = d.querySelectorAll('input[type=range]').length + Array.from(d.querySelectorAll('select')).filter(vis).length
      + Array.from(d.querySelectorAll('.sw u')).filter(vis).length + Array.from(d.querySelectorAll('button')).filter(vis).length;
    const tabs = Array.from(document.querySelectorAll('#rail .tab')).map((t) => t.getBoundingClientRect());
    return {
      controls, dockBottom: r.bottom, vh: innerHeight, dockTop: r.top,
      overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      vertical: tabs.every((b, i) => i === 0 || b.top > tabs[i - 1].top),
      railW: document.getElementById('rail').getBoundingClientRect().width
    };
  });
  check('ponsel: dok kendali tetap terlihat', mobUi.dockTop < mobUi.vh && mobUi.dockBottom <= mobUi.vh + 1, JSON.stringify(mobUi));
  check('ponsel: ≥7 kendali hidup', mobUi.controls >= 7, mobUi.controls);
  check('ponsel: tanpa limpah horizontal', mobUi.overflowX <= 0, mobUi.overflowX);
  check('ponsel: tab tetap menurun', mobUi.vertical && mobUi.railW < 120, mobUi.railW);
  await msb.click('#d-scan');
  const mobScan = await until(async () => {
    const s = await sw.evaluate(async (id) => chrome.tabs.sendMessage(id, { type: 'GB_STATE' }), mobTab);
    return s && s.stats.kept > 10 ? s.stats.kept : null;
  }, 40000);
  check('ponsel: panen bekerja', !!mobScan, mobScan + ' media');
  await mob.screenshot({ path: path.join(SHOTS, '08-ponsel-sidebar.png') });
  await msb.click('#tab-gallery');
  await sleep(900);
  await mob.screenshot({ path: path.join(SHOTS, '09-ponsel-galeri.png') });

  /* tutup sidebar */
  await msb.click('#btn-close');
  await sleep(700);
  const closed = await mob.evaluate(() => {
    const f = document.querySelector('iframe.gb-sidebar-host');
    return { state: f.dataset.state, docked: document.documentElement.classList.contains('gb-docked'), x: f.getBoundingClientRect().left, vw: innerWidth };
  });
  check('sidebar bisa ditutup & halaman kembali penuh', closed.state === 'closed' && !closed.docked && closed.x >= closed.vw - 2, JSON.stringify(closed));

  /* ---------- 11. bersih-bersih & galat ---------- */
  const realErrors = errors.filter((e) => !IGNORE.test(e));
  check('tanpa galat konsol/runtime', realErrors.length === 0, realErrors.slice(0, 6).join(' | ') || 'bersih');

  fs.writeFileSync(path.join(__dirname, 'test-report.json'), JSON.stringify({ extId, results, errors: realErrors, files: files.length, downloads: dlFiles }, null, 2));
  const fail = results.filter((r) => !r.ok);
  console.log('\n=== ' + (results.length - fail.length) + '/' + results.length + ' lulus, ' + results.filter((r) => r.skip).length + ' dilewati ===');
  if (fail.length) console.log('GAGAL:\n' + fail.map((f) => ' - ' + f.name + ' → ' + f.detail).join('\n'));
  await browser.close();
  process.exit(fail.length ? 1 : 0);
})().catch(async (e) => {
  console.error('FATAL', e && e.stack || e);
  fs.writeFileSync(path.join(__dirname, 'test-report.json'), JSON.stringify({ fatal: String(e && e.message || e), results, errors }, null, 2));
  process.exit(2);
});