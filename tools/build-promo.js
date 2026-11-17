/* Materi promosi Grabo: kotak software 3D, poster, citra sosial, dan video.
 * Semua dirender dari HTML/CSS + tangkapan layar asli ekstensi lewat Chrome headless. */
const fs = require('fs');
const path = require('path');
const puppeteer = require(process.env.GRABO_PUPPETEER || 'puppeteer-core');

const EXT = path.resolve(__dirname, '..');
const OUT = path.join(EXT, 'promo');
const SHOTS = path.join(EXT, 'tools', 'screenshots');
const WORK = path.join(__dirname, '.work-promo');
fs.mkdirSync(OUT, { recursive: true });
fs.mkdirSync(WORK, { recursive: true });

const Q = {
  name: 'GRABO',
  tag: 'BULK MEDIA GRABBER',
  font: 'Bricolage Grotesque', fontFile: 'bricolage.woff2',
  body: 'Plus Jakarta Sans', bodyFile: 'jakarta.woff2',
  mono: 'JetBrains Mono', monoFile: 'jetbrains.woff2',
  a: '#FF2E88', b: '#8B5CFF', c: '#00E5FF', spark: '#C6FF3D',
  danger: '#FF4D5E', warn: '#FFB020',
  ink: '#0B0611', ink2: '#1A1030', surface: '#150C26', dim: '#A79BC4', text: '#F4EEFF'
};

const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
const durl = (f) => `data:${MIME[path.extname(f).toLowerCase()] || 'application/octet-stream'};base64,${fs.readFileSync(f).toString('base64')}`;
const font = (fam, file) => `@font-face{font-family:'${fam}';src:url(${durl(path.join(EXT, 'fonts', file))}) format('woff2');font-weight:200 900;font-display:block}`;
const shot = (f) => durl(path.join(SHOTS, f));
let LOGO = '';   /* logo transparan disiapkan saat render (logo.png punya latar solid) */
const MARK = durl(path.join(EXT, 'brand', 'logomark.svg'));
const MONO = durl(path.join(EXT, 'brand', 'logomark-mono.png'));

const GRAIN = 'data:image/svg+xml;utf8,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="180" height="180"><filter id="n"><feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="3" stitchTiles="stitch"/><feColorMatrix type="saturate" values="0"/></filter><rect width="180" height="180" filter="url(#n)" opacity="0.5"/></svg>');

const COPY = {
  kicker: 'EKSTENSI CHROME · MANIFEST V3',
  head: ['SATU HALAMAN.', 'SEMUA MEDIANYA.', 'SATU ANTRIAN.'],
  lead: 'Panen gambar & video dari halaman yang kamu buka — termasuk galeri AI, Telegram, Discord, dan Bluesky. Antrian massal, folder tujuan pilihanmu, dedup isi, HLS/DASH non-DRM.',
  short: 'Unduh gambar & video secara massal, dengan antrian sungguhan.',
  stats: [['5', 'sumber panen'], ['9', 'tab vertikal'], ['¼', 'sidebar'], ['0', 'unggah']],
  feats: [
    ['Panen 5 sumber', 'DOM, jaringan, metadata, latar CSS, dan kanvas — termasuk gambar yang baru muncul saat digulir.'],
    ['Antrian yang jujur', 'Pekerja 1–4, jeda per-host, coba ulang berjenjang, dedup SHA-256 atas isi, dan tahan reload.'],
    ['Folder tujuanmu', 'File System Access menulis ke folder mana pun. HLS & DASH non-DRM digabung jadi satu berkas.']
  ],
  sources: ['Instagram', 'TikTok', 'Telegram', 'Discord', 'Bluesky', 'Dreamina', 'Midjourney', 'Leonardo', 'Runway', 'Kling', 'Civitai', 'dan situs lain'],
  repo: 'github.com/aisac-id/grabo',
  boxFront: 'BULK MEDIA GRABBER',
  boxLine: 'Panen massal gambar & video dari sesi loginmu sendiri.',
  sticker: 'ANTRIAN + DEDUP'
};

function baseCSS() {
  return `
  ${font(Q.font, Q.fontFile)}${font(Q.body, Q.bodyFile)}${font(Q.mono, Q.monoFile)}
  *{box-sizing:border-box;margin:0;padding:0}
  html,body{width:100%;height:100%}
  :root{--a:${Q.a};--b:${Q.b};--c:${Q.c};--spark:${Q.spark};--ink:${Q.ink};--ink2:${Q.ink2};
        --surface:${Q.surface};--dim:${Q.dim};--text:${Q.text};
        --grad:linear-gradient(112deg,var(--a),var(--b) 52%,var(--c))}
  body{background:var(--ink);color:var(--text);font-family:'${Q.body}',system-ui,sans-serif;overflow:hidden;
       -webkit-font-smoothing:antialiased;position:relative}
  h1,h2,h3,.disp{font-family:'${Q.font}','${Q.body}',sans-serif}
  .mono{font-family:'${Q.mono}',monospace}
  .bg{position:absolute;inset:0;overflow:hidden;z-index:0}
  .bg .glow{position:absolute;border-radius:50%;filter:blur(90px)}
  .bg .g1{width:70%;height:70%;left:-18%;top:-26%;background:radial-gradient(circle,${Q.a}55,transparent 68%)}
  .bg .g2{width:66%;height:66%;right:-20%;top:6%;background:radial-gradient(circle,${Q.c}5c,transparent 66%)}
  .bg .g3{width:76%;height:60%;left:10%;bottom:-30%;background:radial-gradient(circle,${Q.b}4c,transparent 70%)}
  .bg .g4{width:32%;height:32%;right:8%;bottom:-6%;background:radial-gradient(circle,${Q.spark}30,transparent 68%)}
  .bg .grid{position:absolute;inset:0;opacity:.5;
    background-image:linear-gradient(${Q.dim}14 1px,transparent 1px),linear-gradient(90deg,${Q.dim}14 1px,transparent 1px);
    background-size:64px 64px;mask-image:radial-gradient(ellipse at 50% 40%,#000 20%,transparent 76%)}
  /* motif ban berjalan: jalur perforasi seperti tiket antrian */
  .bg .belt{position:absolute;left:0;right:0;height:26px;opacity:.5;
    background:repeating-linear-gradient(90deg,${Q.dim}44 0 22px,transparent 22px 44px)}
  .bg .belt.b1{top:16%}
  .bg .belt.b2{bottom:14%;opacity:.32}
  .bg .scan{position:absolute;inset:0;opacity:.14;background:repeating-linear-gradient(0deg,${Q.text}0c 0 1px,transparent 1px 4px)}
  .bg .grain{position:absolute;inset:-40px;background-image:url("${GRAIN}");opacity:.13;mix-blend-mode:overlay}
  .bg .vig{position:absolute;inset:0;background:radial-gradient(ellipse at 50% 45%,transparent 42%,${Q.ink}dd 100%)}
  .layer{position:relative;z-index:2}
  .grad-text{background:var(--grad);-webkit-background-clip:text;background-clip:text;color:transparent}
  .chip{display:inline-flex;align-items:center;gap:9px;border:1px solid ${Q.dim}3d;border-radius:999px;
        background:${Q.ink2}cc;color:var(--text);font-weight:700;letter-spacing:.14em;text-transform:uppercase}
  .chip .dot{width:7px;height:7px;border-radius:50%;background:var(--spark);box-shadow:0 0 10px var(--spark)}
  .rule{height:3px;border-radius:2px;background:var(--grad)}
  .frame{position:relative;border-radius:16px;overflow:hidden;background:${Q.ink2};
         border:1px solid ${Q.dim}33;box-shadow:0 40px 90px -30px #000c,0 0 0 1px #ffffff0d inset,0 0 70px -20px ${Q.b}66}
  .frame .bar{height:38px;display:flex;align-items:center;gap:8px;padding:0 14px;
              background:linear-gradient(180deg,${Q.ink2},${Q.surface});border-bottom:1px solid ${Q.dim}26}
  .frame .bar i{width:9px;height:9px;border-radius:50%;background:${Q.dim}66;display:block}
  .frame .bar i:first-child{background:${Q.a}cc}
  .frame .bar i:nth-child(2){background:${Q.b}cc}
  .frame .bar i:nth-child(3){background:${Q.spark}cc}
  .frame .bar .url{flex:1;height:22px;border-radius:7px;background:${Q.ink}cc;border:1px solid ${Q.dim}22;
                   display:flex;align-items:center;padding:0 10px;font-size:11px;color:var(--dim);letter-spacing:.06em}
  .frame img{display:block;width:100%}
  .frame .sheen{position:absolute;inset:0;pointer-events:none;background:linear-gradient(118deg,#ffffff14 0 18%,transparent 34%)}
  .badge-mit{border:1px solid ${Q.spark}55;color:var(--spark);background:${Q.spark}14}
  .ticket{position:relative;background:${Q.surface}e6;border:1px solid ${Q.dim}2e;border-radius:12px}
  .ticket:before,.ticket:after{content:'';position:absolute;width:14px;height:14px;border-radius:50%;background:var(--ink);top:50%;margin-top:-7px}
  .ticket:before{left:-8px}
  .ticket:after{right:-8px}
  `;
}

const bgHTML = () => `<div class="bg"><div class="glow g1"></div><div class="glow g2"></div><div class="glow g3"></div><div class="glow g4"></div>
  <div class="grid"></div><div class="belt b1"></div><div class="belt b2"></div><div class="scan"></div><div class="grain"></div><div class="vig"></div></div>`;

const frameHTML = (file, url, cls = '') => `<div class="frame ${cls}"><div class="bar"><i></i><i></i><i></i><span class="url mono">${url}</span></div>
  <img src="${shot(file)}" alt=""><div class="sheen"></div></div>`;

const page = (css, body) => `<!doctype html><html lang="id"><head><meta charset="utf-8"><style>${baseCSS()}${css}</style></head><body>${bgHTML()}${body}</body></html>`;

/* ---------------- kotak software 3D ---------------- */
function boxHTML(scale) {
  const W = 520, H = 720, D = 92;
  return `<div class="stage"><div class="box3d" style="--W:${W}px;--H:${H}px;--D:${D}px;transform:rotateX(-7deg) rotateY(24deg) scale(${scale || 1})">
    <div class="face front"><div class="f-art">
      <div class="f-glow"></div><div class="f-grid"></div>
      <div class="f-top mono">CHROME EXTENSION · MV3</div>
      <img class="f-mark" src="${MARK}" alt="">
      <div class="f-name disp">${Q.name}</div>
      <div class="f-tag mono">${COPY.boxFront}</div>
      <div class="f-rule"></div>
      <div class="f-line">${COPY.boxLine}</div>
      <div class="f-queue">
        <span class="q done" style="--w:100%"></span>
        <span class="q done" style="--w:100%"></span>
        <span class="q run" style="--w:64%"></span>
        <span class="q wait" style="--w:22%"></span>
      </div>
      <div class="f-foot"><span class="f-sticker mono">${COPY.sticker}</span><span class="f-mit mono">MIT · OPEN SOURCE</span></div>
      <div class="f-sheen"></div>
    </div></div>
    <div class="face spine"><div class="s-inner">
      <img class="s-mark" src="${MONO}" alt=""><div class="s-rule"></div>
      <div class="s-text mono">GRABO · V1.0</div>
      <div class="s-dots"><i></i><i></i><i></i></div>
    </div></div>
    <div class="face top"><div class="t-inner"><span class="t-rule"></span></div></div>
  </div>
  <div class="reflect"></div></div>`;
}

const boxCSS = () => `
  .stage{position:absolute;inset:0;display:grid;place-items:center;perspective:2200px;perspective-origin:50% 42%}
  .box3d{position:relative;width:var(--W);height:var(--H);transform-style:preserve-3d;transform:rotateX(-7deg) rotateY(24deg)}
  .box3d .face{position:absolute;overflow:hidden;backface-visibility:hidden}
  .front{left:0;top:0;width:var(--W);height:var(--H);transform:translateZ(calc(var(--D)/2));
         border-radius:5px 10px 10px 5px;background:linear-gradient(160deg,${Q.ink2},${Q.ink} 62%);box-shadow:0 0 0 1px ${Q.dim}2e inset}
  .spine{left:calc(var(--W)/2 - var(--D)/2);top:0;width:var(--D);height:var(--H);
         transform:rotateY(-90deg) translateZ(calc(var(--W)/2));background:linear-gradient(90deg,${Q.ink},${Q.ink2});border-radius:4px}
  .top{left:0;top:calc(var(--H)/2 - var(--D)/2);width:var(--W);height:var(--D);
       transform:rotateX(90deg) translateZ(calc(var(--H)/2));background:linear-gradient(180deg,${Q.surface},${Q.ink2})}
  .f-art{position:absolute;inset:0;padding:44px 40px;display:flex;flex-direction:column;align-items:flex-start}
  .f-glow{position:absolute;width:120%;height:60%;left:-20%;top:-16%;border-radius:50%;filter:blur(60px);background:radial-gradient(circle,${Q.a}66,transparent 66%)}
  .f-grid{position:absolute;inset:0;opacity:.5;background-image:linear-gradient(${Q.dim}12 1px,transparent 1px),linear-gradient(90deg,${Q.dim}12 1px,transparent 1px);
    background-size:34px 34px;mask-image:linear-gradient(180deg,#000,transparent 72%)}
  .f-top{position:relative;font-size:12px;letter-spacing:.26em;color:var(--dim)}
  .f-mark{position:relative;width:196px;height:196px;margin:24px 0 16px;filter:drop-shadow(0 18px 34px ${Q.b}55)}
  .f-name{position:relative;font-size:74px;font-weight:800;letter-spacing:.02em;line-height:1;
          background:var(--grad);-webkit-background-clip:text;background-clip:text;color:transparent}
  .f-tag{position:relative;margin-top:12px;font-size:13px;letter-spacing:.26em;color:var(--dim)}
  .f-rule{position:relative;width:132px;height:4px;border-radius:2px;background:var(--grad);margin:20px 0 16px}
  .f-line{position:relative;font-size:18px;line-height:1.45;color:${Q.text}dd;max-width:340px;font-weight:500}
  .f-queue{position:relative;margin-top:22px;display:flex;flex-direction:column;gap:10px;width:100%}
  .f-queue .q{position:relative;height:14px;border-radius:8px;background:${Q.dim}22;overflow:hidden}
  .f-queue .q:after{content:'';position:absolute;left:0;top:0;bottom:0;width:var(--w);border-radius:8px;background:var(--grad)}
  .f-queue .q.wait:after{opacity:.34}
  .f-queue .q.run:after{box-shadow:0 0 18px -2px ${Q.c}cc}
  .f-foot{position:relative;margin-top:auto;width:100%;display:flex;align-items:center;justify-content:space-between}
  .f-sticker{font-size:12px;letter-spacing:.14em;padding:8px 12px;border-radius:8px;background:${Q.spark}1f;border:1px solid ${Q.spark}66;color:var(--spark)}
  .f-mit{font-size:11px;letter-spacing:.18em;color:var(--dim)}
  .f-sheen{position:absolute;inset:0;pointer-events:none;background:linear-gradient(112deg,#ffffff1f 0 16%,transparent 32%,transparent 74%,#ffffff0f 92%)}
  .s-inner{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:20px}
  .s-mark{width:48px;height:48px;opacity:.95}
  .s-rule{width:5px;height:250px;border-radius:3px;background:var(--grad);opacity:.85}
  .s-text{writing-mode:vertical-rl;font-size:12px;letter-spacing:.3em;color:var(--dim)}
  .s-dots{display:flex;flex-direction:column;gap:9px}
  .s-dots i{width:7px;height:7px;border-radius:50%;background:${Q.spark}aa;display:block}
  .t-inner{position:absolute;inset:0;display:grid;place-items:center}
  .t-rule{width:70%;height:5px;border-radius:3px;background:var(--grad);opacity:.7}
  .reflect{position:absolute;left:50%;bottom:9%;width:640px;height:120px;transform:translateX(-50%);
           background:radial-gradient(ellipse,${Q.b}44,transparent 70%);filter:blur(26px)}
`;

/* ---------------- hero 1920×1080 ---------------- */
function heroHTML() {
  const stats = COPY.stats.map(([n, l]) => `<div class="st"><b class="disp grad-text">${n}</b><span class="mono">${l}</span></div>`).join('');
  return page(`
  .wrap{position:absolute;inset:0;display:grid;grid-template-columns:820px 1fr;gap:56px;padding:78px 84px;align-items:center}
  .kick{font-size:13px;padding:9px 16px}
  .logo{width:330px;margin:26px 0 22px;display:block}
  h1{font-size:76px;line-height:.98;font-weight:800;letter-spacing:-.01em}
  h1 span{display:block}
  .lead{margin-top:24px;font-size:21px;line-height:1.55;color:${Q.text}d0;max-width:660px;font-weight:500}
  .stats{margin-top:32px;display:flex;gap:34px}
  .st b{display:block;font-size:46px;line-height:1;font-weight:800}
  .st span{display:block;margin-top:6px;font-size:11px;letter-spacing:.18em;color:var(--dim);text-transform:uppercase}
  .foot{margin-top:34px;display:flex;align-items:center;gap:14px}
  .foot .badge-mit{font-size:12px;padding:9px 14px;border-radius:999px;letter-spacing:.16em;font-weight:700}
  .foot .repo{font-size:14px;color:var(--dim);letter-spacing:.06em}
  .right{position:relative}
  .right .main{transform:rotate(-1.2deg)}
  .right .side{position:absolute;right:-26px;bottom:-92px;width:404px;transform:rotate(2.4deg)}
  .tag{position:absolute;left:-18px;top:-26px;z-index:5;font-size:12px;padding:10px 15px;border-radius:10px;
       background:${Q.ink2}f2;border:1px solid ${Q.c}55;color:${Q.c};letter-spacing:.16em;font-weight:700}
  `, `<div class="wrap layer">
    <div>
      <span class="chip kick"><span class="dot"></span>${COPY.kicker}</span>
      <img class="logo" src="${LOGO}" alt="Grabo">
      <h1 class="disp">${COPY.head.map((l, i) => i === 1 ? `<span class="grad-text">${l}</span>` : `<span>${l}</span>`).join('')}</h1>
      <p class="lead">${COPY.lead}</p>
      <div class="stats">${stats}</div>
      <div class="foot"><span class="badge-mit mono">MIT · OPEN SOURCE</span><span class="repo mono">${COPY.repo}</span></div>
    </div>
    <div class="right">
      <span class="tag mono">ANTRIAN · 43 BERKAS</span>
      ${frameHTML('03-studio-antrian.png', 'chrome-extension://grabo/studio.html', 'main')}
      ${frameHTML('02-desktop-galeri.png', 'halaman mana pun · sidebar ¼ layar', 'side')}
    </div>
  </div>`);
}

/* ---------------- poster 1400×1980 ---------------- */
function posterHTML() {
  const feats = COPY.feats.map(([t, d], i) => `<div class="ft ticket"><span class="n mono">0${i + 1}</span><div><h3>${t}</h3><p>${d}</p></div></div>`).join('');
  const srcs = COPY.sources.map((s) => `<span class="src mono">${s}</span>`).join('');
  return page(`
  .wrap{position:absolute;inset:0;padding:82px 76px;display:flex;flex-direction:column}
  .top{display:flex;align-items:center;justify-content:space-between}
  .logo{width:300px;display:block}
  .kick{font-size:12px;padding:9px 15px}
  h1{margin-top:40px;font-size:92px;line-height:.96;font-weight:800;letter-spacing:-.015em}
  h1 span{display:block}
  .lead{margin-top:26px;font-size:22px;line-height:1.55;color:${Q.text}d0;font-weight:500;max-width:1080px}
  .shotwrap{margin-top:38px;position:relative}
  .shotwrap .frame{transform:rotate(-.6deg)}
  .pill{position:absolute;right:22px;top:-20px;z-index:4;font-size:12px;padding:10px 15px;border-radius:10px;
        background:${Q.ink2}f2;border:1px solid ${Q.spark}55;color:var(--spark);letter-spacing:.16em;font-weight:700}
  .feats{margin-top:44px;display:flex;flex-direction:column;gap:18px}
  .ft{display:flex;gap:22px;align-items:flex-start;padding:22px 28px}
  .ft .n{font-size:24px;font-weight:700;color:${Q.c};min-width:44px}
  .ft h3{font-size:27px;font-weight:700;letter-spacing:-.01em}
  .ft p{margin-top:7px;font-size:17px;line-height:1.5;color:${Q.text}c4}
  .srcs{margin-top:34px;display:flex;flex-wrap:wrap;gap:10px}
  .src{font-size:12px;padding:8px 13px;border-radius:999px;border:1px solid ${Q.dim}33;background:${Q.ink2}aa;color:${Q.text}cc;letter-spacing:.08em}
  .bottom{margin-top:auto;display:flex;align-items:center;justify-content:space-between;padding-top:34px}
  .bottom .repo{font-size:17px;color:var(--text);letter-spacing:.06em}
  .bottom .badge-mit{font-size:12px;padding:10px 15px;border-radius:999px;letter-spacing:.16em;font-weight:700}
  `, `<div class="wrap layer">
    <div class="top"><img class="logo" src="${LOGO}" alt="Grabo"><span class="chip kick"><span class="dot"></span>${COPY.kicker}</span></div>
    <h1 class="disp"><span>SATU HALAMAN.</span><span class="grad-text">SEMUA MEDIANYA.</span></h1>
    <p class="lead">${COPY.short} Folder tujuan pilihanmu, dedup berbasis isi, dan penggabungan HLS/DASH non-DRM — semuanya lokal di browsermu.</p>
    <div class="shotwrap"><span class="pill mono">SIDEBAR ¼ LAYAR · TAB MENURUN</span>${frameHTML('01-desktop-ringkas.png', 'sidebar Grabo · panen langsung')}</div>
    <div class="feats">${feats}</div>
    <div class="srcs">${srcs}</div>
    <div class="bottom"><span class="repo mono">${COPY.repo}</span><span class="badge-mit mono">MIT · OPEN SOURCE</span></div>
  </div>`);
}

/* ---------------- kotak software ---------------- */
const boxPage = () => page(boxCSS(), boxHTML(1.18));

/* ---------------- og 1200×630 ---------------- */
function ogHTML() {
  return page(`
  .wrap{position:absolute;inset:0;padding:56px 60px;display:grid;grid-template-columns:1fr 470px;gap:40px;align-items:center}
  .logo{width:260px;display:block;margin-bottom:20px}
  h1{font-size:52px;line-height:1.02;font-weight:800}
  h1 span{display:block}
  .lead{margin-top:16px;font-size:18px;line-height:1.5;color:${Q.text}cc;max-width:560px}
  .row{margin-top:22px;display:flex;gap:10px;flex-wrap:wrap}
  .row span{font-size:11px;padding:7px 12px;border-radius:999px;border:1px solid ${Q.dim}33;background:${Q.ink2}aa;color:${Q.text}cc;letter-spacing:.1em}
  .repo{margin-top:22px;font-size:14px;color:var(--dim);letter-spacing:.06em}
  .right .frame{transform:rotate(1.6deg)}
  `, `<div class="wrap layer">
    <div>
      <img class="logo" src="${LOGO}" alt="Grabo">
      <h1 class="disp"><span>PANEN MASSAL,</span><span class="grad-text">ANTRIAN SUNGGUHAN.</span></h1>
      <p class="lead">${COPY.short}</p>
      <div class="row mono"><span>5 SUMBER</span><span>DEDUP SHA-256</span><span>HLS/DASH</span><span>FOLDER PILIHANMU</span></div>
      <div class="repo mono">${COPY.repo}</div>
    </div>
    <div class="right">${frameHTML('03-studio-antrian.png', 'studio · antrian')}</div>
  </div>`);
}

/* ---------------- banner 1500×500 ---------------- */
function bannerHTML() {
  return page(`
  .wrap{position:absolute;inset:0;padding:0 62px;display:grid;grid-template-columns:1fr 560px;gap:44px;align-items:center}
  .logo{width:230px;display:block;margin-bottom:16px}
  h1{font-size:44px;line-height:1.04;font-weight:800}
  .lead{margin-top:12px;font-size:17px;color:${Q.text}c8;max-width:600px;line-height:1.45}
  .row{margin-top:16px;display:flex;gap:9px}
  .row span{font-size:11px;padding:7px 12px;border-radius:999px;border:1px solid ${Q.dim}33;background:${Q.ink2}aa;color:${Q.text}cc;letter-spacing:.1em}
  .right{position:relative}
  .right .frame{transform:rotate(-1.4deg) translateY(28px)}
  `, `<div class="wrap layer">
    <div>
      <img class="logo" src="${LOGO}" alt="Grabo">
      <h1 class="disp">SEMUA MEDIA <span class="grad-text">SATU ANTRIAN.</span></h1>
      <p class="lead">${COPY.short}</p>
      <div class="row mono"><span>MIT</span><span>${COPY.repo}</span></div>
    </div>
    <div class="right">${frameHTML('02-desktop-galeri.png', 'galeri · pilih &amp; masukkan antrian')}</div>
  </div>`);
}

/* ---------------- sosial square 1080 ---------------- */
function squareHTML() {
  const stats = COPY.stats.map(([n, l]) => `<div class="st"><b class="disp grad-text">${n}</b><span class="mono">${l}</span></div>`).join('');
  return page(`
  .wrap{position:absolute;inset:0;padding:64px 60px;display:flex;flex-direction:column}
  .logo{width:270px;display:block}
  h1{margin-top:26px;font-size:60px;line-height:1;font-weight:800}
  h1 span{display:block}
  .lead{margin-top:20px;font-size:20px;line-height:1.5;color:${Q.text}cc}
  .shotwrap{margin-top:26px;position:relative}
  .shotwrap .frame{transform:rotate(-.8deg)}
  .shotwrap .frame img{height:400px;object-fit:cover;object-position:top left}
  .stats{margin-top:auto;padding-top:26px;display:flex;gap:30px;justify-content:space-between}
  .st b{display:block;font-size:44px;line-height:1;font-weight:800}
  .st span{display:block;margin-top:6px;font-size:11px;letter-spacing:.16em;color:var(--dim);text-transform:uppercase}
  .repo{margin-top:24px;font-size:14px;color:var(--dim);letter-spacing:.06em}
  `, `<div class="wrap layer">
    <img class="logo" src="${LOGO}" alt="Grabo">
    <h1 class="disp"><span>UNDUH MASSAL</span><span class="grad-text">TANPA DRAMA.</span></h1>
    <p class="lead">Gambar & video dari halaman yang kamu buka. Antrian, folder tujuan, dedup isi.</p>
    <div class="shotwrap">${frameHTML('04-studio-manifest.png', 'manifes · url + hash + jalur')}</div>
    <div class="stats">${stats}</div>
    <div class="repo mono">${COPY.repo} · MIT</div>
  </div>`);
}

/* ---------------- story 1080×1920 ---------------- */
function storyHTML() {
  const feats = COPY.feats.map(([t, d], i) => `<div class="ft ticket"><span class="n mono">0${i + 1}</span><div><h3>${t}</h3><p>${d}</p></div></div>`).join('');
  return page(`
  .wrap{position:absolute;inset:0;padding:96px 66px;display:flex;flex-direction:column}
  .kick{font-size:12px;padding:9px 15px;align-self:flex-start}
  .logo{width:300px;display:block;margin:30px 0 26px}
  h1{font-size:68px;line-height:.98;font-weight:800}
  h1 span{display:block}
  .lead{margin-top:22px;font-size:21px;line-height:1.5;color:${Q.text}cc}
  .phone{margin:32px auto 0;width:372px;flex:none;border-radius:30px;overflow:hidden;border:1px solid ${Q.dim}3a;
         box-shadow:0 50px 100px -30px #000d,0 0 80px -24px ${Q.b}77}
  .phone img{display:block;width:100%}
  .feats{margin-top:34px;display:flex;flex-direction:column;gap:14px}
  .ft{display:flex;gap:18px;padding:18px 24px}
  .ft .n{font-size:20px;color:${Q.c};min-width:36px;font-weight:700}
  .ft h3{font-size:23px;font-weight:700}
  .ft p{margin-top:5px;font-size:15px;line-height:1.45;color:${Q.text}c0}
  .bottom{margin-top:auto;padding-top:36px;display:flex;align-items:center;justify-content:space-between}
  .bottom .repo{font-size:16px;color:var(--text)}
  .bottom .badge-mit{font-size:12px;padding:10px 14px;border-radius:999px;letter-spacing:.16em;font-weight:700}
  `, `<div class="wrap layer">
    <span class="chip kick"><span class="dot"></span>${COPY.kicker}</span>
    <img class="logo" src="${LOGO}" alt="Grabo">
    <h1 class="disp"><span>MEDIANMU,</span><span class="grad-text">DI FOLDERMU.</span></h1>
    <p class="lead">Grabo memanen halaman yang kamu buka dan menulisnya ke folder yang kamu pilih.</p>
    <div class="phone"><img src="${shot('08-ponsel-sidebar.png')}" alt=""></div>
    <div class="feats">${feats}</div>
    <div class="bottom"><span class="repo mono">${COPY.repo}</span><span class="badge-mit mono">MIT</span></div>
  </div>`);
}

/* ---------------- lembar fitur 1600×900 ---------------- */
function featureHTML() {
  const cards = [
    ['Panen 5 sumber', 'DOM · jaringan · metadata · latar CSS · kanvas', '01-desktop-ringkas.png', 'sidebar · ringkas'],
    ['Galeri & pilihan', 'Pilih semua, pratinjau besar, filter langsung', '02-desktop-galeri.png', 'sidebar · galeri'],
    ['Antrian massal', 'Pekerja, jeda/host, retry, dedup, tahan reload', '03-studio-antrian.png', 'studio · antrian'],
    ['Manifes berkas', 'URL, hash SHA-256, byte, segmen, jalur keluaran', '04-studio-manifest.png', 'studio · manifes']
  ].map(([t, d, f, u]) => `<div class="card"><div class="ch"><h3>${t}</h3><p>${d}</p></div>${frameHTML(f, u)}</div>`).join('');
  return page(`
  .wrap{position:absolute;inset:0;padding:56px 64px;display:flex;flex-direction:column}
  .top{display:flex;align-items:center;justify-content:space-between}
  .logo{width:250px;display:block}
  h1{font-size:40px;font-weight:800;line-height:1.05}
  .grid{margin-top:30px;display:grid;grid-template-columns:1fr 1fr;gap:26px 34px}
  .card{display:flex;flex-direction:column;gap:14px}
  .ch h3{font-size:26px;font-weight:700}
  .ch p{margin-top:5px;font-size:15px;color:${Q.text}b8}
  .card .frame{border-radius:12px}
  .card .frame .bar{height:28px}
  .card .frame .bar .url{height:18px;font-size:10px}
  .card .frame img{height:196px;object-fit:cover;object-position:top left}
  .foot{margin-top:26px;display:flex;align-items:center;justify-content:space-between}
  .foot .repo{font-size:14px;color:var(--dim)}
  .foot .badge-mit{font-size:11px;padding:8px 13px;border-radius:999px;letter-spacing:.16em;font-weight:700}
  `, `<div class="wrap layer">
    <div class="top"><img class="logo" src="${LOGO}" alt="Grabo"><h1 class="disp">EMPAT LANGKAH, <span class="grad-text">SATU ANTRIAN.</span></h1></div>
    <div class="grid">${cards}</div>
    <div class="foot"><span class="repo mono">${COPY.repo}</span><span class="badge-mit mono">MIT · OPEN SOURCE</span></div>
  </div>`);
}

async function launch() {
  return puppeteer.launch({
    executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome',
    headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--force-color-profile=srgb',
      '--font-render-hinting=none', '--hide-scrollbars', '--use-gl=swiftshader', '--enable-unsafe-swiftshader']
  });
}

async function render(browser, html, w, h, file, dpr) {
  const p = await browser.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(String(e)));
  p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  await p.setViewport({ width: w, height: h, deviceScaleFactor: dpr || 1 });
  await p.setContent(html, { waitUntil: 'load', timeout: 60000 });
  await p.evaluate(() => document.fonts.ready);
  await new Promise((r) => setTimeout(r, 500));
  const over = await p.evaluate((hh) => {
    let worst = 0, who = '';
    document.querySelectorAll('body *').forEach((n) => {
      if (n.closest('.bg') || n.closest('.reflect')) return;
      const r = n.getBoundingClientRect();
      if (!r.width || !r.height) return;
      if (r.bottom - hh > worst) { worst = r.bottom - hh; who = n.className || n.tagName; }
    });
    return { over: Math.round(worst), who: String(who).slice(0, 40) };
  }, h);
  if (over.over > 1) console.log('  ! limpah bawah', over.over + 'px', over.who);
  await p.screenshot({ path: file });
  await p.close();
  if (errs.length) console.log('  ! galat render:', errs.slice(0, 3).join(' | '));
  return { over: over.over, errs };
}

/* Logo tanpa latar: rect latar pada logo.svg dibuang, lalu dirender transparan. */
async function prepLogo(b) {
  const file = path.join(EXT, 'brand', 'logo-transparent.png');
  const svg = fs.readFileSync(path.join(EXT, 'brand', 'logo.svg'), 'utf8')
    .replace(/<rect width="760" height="240"[^/]*\/>/, '');
  const p = await b.newPage();
  await p.setViewport({ width: 1520, height: 480, deviceScaleFactor: 1 });
  await p.setContent('<style>html,body{margin:0;width:1520px;height:480px}</style>' + svg, { waitUntil: 'load' });
  await p.screenshot({ path: file, omitBackground: true });
  await p.close();
  LOGO = durl(file);
}

(async () => {
  const b = await launch();
  await prepLogo(b);
  const jobs = [
    ['box-grabo.png', boxPage(), 1500, 1500, 1],
    ['poster-grabo.png', posterHTML(), 1400, 1980, 1],
    ['hero-1920x1080.png', heroHTML(), 1920, 1080, 1],
    ['og-1200x630.png', ogHTML(), 1200, 630, 1],
    ['banner-1500x500.png', bannerHTML(), 1500, 500, 1],
    ['social-square-1080.png', squareHTML(), 1080, 1080, 1],
    ['story-1080x1920.png', storyHTML(), 1080, 1920, 1],
    ['features-1600x900.png', featureHTML(), 1600, 900, 1]
  ];
  const report = [];
  for (const [name, html, w, h, dpr] of jobs) {
    const r = await render(b, html, w, h, path.join(OUT, name), dpr);
    console.log('✓', name, w + '×' + h, r.over ? '(limpah ' + r.over + ')' : '');
    report.push({ name, w, h, ...r });
  }
  /* bingkai video: kartu judul + tangkapan asli, dirender 1920×1080 */
  const frames = [
    ['v1-title.png', page(`
      .wrap{position:absolute;inset:0;display:flex;flex-direction:column;justify-content:center;padding:0 130px}
      .kick{font-size:14px;padding:10px 17px;align-self:flex-start}
      .logo{width:430px;margin:34px 0 30px;display:block}
      h1{font-size:104px;line-height:.96;font-weight:800}
      h1 span{display:block}
      .lead{margin-top:28px;font-size:26px;color:${Q.text}cc;max-width:1100px;line-height:1.5}
      .row{margin-top:36px;display:flex;gap:12px}
      .row span{font-size:13px;padding:9px 15px;border-radius:999px;border:1px solid ${Q.dim}33;background:${Q.ink2}aa;color:${Q.text}cc;letter-spacing:.12em}
    `, `<div class="wrap layer"><span class="chip kick"><span class="dot"></span>${COPY.kicker}</span>
      <img class="logo" src="${LOGO}" alt="">
      <h1 class="disp"><span>SATU HALAMAN.</span><span class="grad-text">SEMUA MEDIANYA.</span></h1>
      <p class="lead">${COPY.short}</p>
      <div class="row mono"><span>5 SUMBER PANEN</span><span>ANTRIAN MASAL</span><span>DEDUP SHA-256</span><span>HLS / DASH</span></div></div>`)],
    ['v2-harvest.png', page(`
      .wrap{position:absolute;inset:0;padding:70px 90px;display:grid;grid-template-columns:1fr 620px;gap:56px;align-items:center}
      h2{font-size:62px;line-height:1.02;font-weight:800}
      .lead{margin-top:22px;font-size:23px;line-height:1.55;color:${Q.text}cc}
      .list{margin-top:26px;display:flex;flex-direction:column;gap:12px}
      .list div{display:flex;gap:12px;align-items:center;font-size:19px;color:${Q.text}dd}
      .list i{width:9px;height:9px;border-radius:50%;background:var(--spark);box-shadow:0 0 10px var(--spark);display:block}
      .right .frame{transform:rotate(-1.2deg)}
    `, `<div class="wrap layer"><div><h2 class="disp">PANEN <span class="grad-text">5 SUMBER</span></h2>
      <p class="lead">Yang terlihat di DOM, yang lewat di jaringan, metadata, latar CSS, sampai isi kanvas.</p>
      <div class="list"><div><i></i>Gulir dalam untuk galeri malas-muat</div><div><i></i>Varian srcset resolusi terbesar</div><div><i></i>Filter langsung tanpa pindai ulang</div></div></div>
      <div class="right">${frameHTML('01-desktop-ringkas.png', 'sidebar · ringkas')}</div></div>`)],
    ['v3-gallery.png', page(`
      .wrap{position:absolute;inset:0;padding:70px 90px;display:grid;grid-template-columns:620px 1fr;gap:56px;align-items:center}
      h2{font-size:62px;line-height:1.02;font-weight:800}
      .lead{margin-top:22px;font-size:23px;line-height:1.55;color:${Q.text}cc}
      .left .frame{transform:rotate(1.2deg)}
      .nums{margin-top:28px;display:flex;gap:30px}
      .nums b{display:block;font-size:52px;font-weight:800;line-height:1}
      .nums span{display:block;margin-top:6px;font-size:12px;letter-spacing:.16em;color:var(--dim);text-transform:uppercase}
    `, `<div class="wrap layer"><div class="left">${frameHTML('02-desktop-galeri.png', 'galeri · 45 dipilih')}</div>
      <div><h2 class="disp">PILIH, <span class="grad-text">LALU ANTRIKAN.</span></h2>
      <p class="lead">Pratinjau besar, pilih sebagian atau semuanya, lalu masukkan ke antrian Studio.</p>
      <div class="nums"><div><b class="disp grad-text">45</b><span class="media">media dipilih</span></div><div><b class="disp grad-text">9</b><span class="media">tab menurun</span></div></div></div></div>`)],
    ['v4-queue.png', page(`
      .wrap{position:absolute;inset:0;padding:70px 90px;display:grid;grid-template-columns:1fr 660px;gap:56px;align-items:center}
      h2{font-size:62px;line-height:1.02;font-weight:800}
      .lead{margin-top:22px;font-size:23px;line-height:1.55;color:${Q.text}cc}
      .list{margin-top:26px;display:flex;flex-direction:column;gap:12px}
      .list div{display:flex;gap:12px;align-items:center;font-size:19px;color:${Q.text}dd}
      .list i{width:9px;height:9px;border-radius:50%;background:${Q.c};box-shadow:0 0 10px ${Q.c};display:block}
      .right .frame{transform:rotate(-1deg)}
    `, `<div class="wrap layer"><div><h2 class="disp">ANTRIAN <span class="grad-text">YANG JUJUR.</span></h2>
      <p class="lead">Pekerja 1–4, jeda per-host, coba ulang berjenjang, dan dedup atas isi berkas — bukan atas nama.</p>
      <div class="list"><div><i></i>Laju &amp; ETA nyata</div><div><i></i>Jeda / lanjut tanpa kehilangan pekerjaan</div><div><i></i>Tahan reload browser</div></div></div>
      <div class="right">${frameHTML('03-studio-antrian.png', 'studio · antrian')}</div></div>`)],
    ['v5-out.png', page(`
      .wrap{position:absolute;inset:0;padding:70px 90px;display:grid;grid-template-columns:660px 1fr;gap:56px;align-items:center}
      h2{font-size:62px;line-height:1.02;font-weight:800}
      .lead{margin-top:22px;font-size:23px;line-height:1.55;color:${Q.text}cc}
      .list{margin-top:26px;display:flex;flex-direction:column;gap:12px}
      .list div{display:flex;gap:12px;align-items:center;font-size:19px;color:${Q.text}dd}
      .list i{width:9px;height:9px;border-radius:50%;background:var(--spark);box-shadow:0 0 10px var(--spark);display:block}
      .left .frame{transform:rotate(1deg)}
    `, `<div class="wrap layer"><div class="left">${frameHTML('04-studio-manifest.png', 'studio · manifes')}</div>
      <div><h2 class="disp">FOLDERMU, <span class="grad-text">CATATANMU.</span></h2>
      <p class="lead">Tulis ke folder mana pun yang kamu pilih. Setiap berkas tercatat: URL, hash, byte, dan jalurnya.</p>
      <div class="list"><div><i></i>HLS &amp; DASH non-DRM digabung</div><div><i></i>Konten terproteksi dilewati</div><div><i></i>Tanpa server, tanpa telemetry</div></div></div></div>`)],
    ['v6-end.png', page(`
      .wrap{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center}
      .mark{width:210px;height:210px;filter:drop-shadow(0 24px 50px ${Q.b}66)}
      h1{margin-top:34px;font-size:112px;font-weight:800;line-height:1;letter-spacing:.02em}
      .tag{margin-top:16px;font-size:16px;letter-spacing:.34em;color:var(--dim)}
      .repo{margin-top:40px;font-size:26px;color:var(--text);letter-spacing:.06em}
      .row{margin-top:26px;display:flex;gap:12px}
      .row span{font-size:13px;padding:9px 15px;border-radius:999px;border:1px solid ${Q.spark}55;background:${Q.spark}14;color:var(--spark);letter-spacing:.16em}
    `, `<div class="wrap layer"><img class="mark" src="${MARK}" alt="">
      <h1 class="disp grad-text">GRABO</h1><div class="tag mono">${Q.tag}</div>
      <div class="repo mono">${COPY.repo}</div>
      <div class="row mono"><span>MIT · OPEN SOURCE</span><span>CHROME 116+</span></div></div>`)]
  ];
  for (const [name, html] of frames) {
    const r = await render(b, html, 1920, 1080, path.join(WORK, name), 1);
    console.log('✓ frame', name, r.over ? '(limpah ' + r.over + ')' : '');
    report.push({ name, w: 1920, h: 1080, ...r });
  }
  await b.close();
  fs.writeFileSync(path.join(WORK, 'render-report.json'), JSON.stringify(report, null, 2));
  console.log('selesai:', jobs.length + ' aset +', frames.length + ' bingkai video');
})().catch((e) => { console.error('FATAL', e && e.stack || e); process.exit(1); });