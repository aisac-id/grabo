/* Server fixture lokal untuk uji Grabo. Mendukung Range/206, rute 403, dan rute gagal-2x. */
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', 'demo');
const PORT = Number(process.env.PORT || 8731);
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml',
  '.webp': 'image/webp', '.gif': 'image/gif', '.mp4': 'video/mp4', '.webm': 'video/webm',
  '.m3u8': 'application/vnd.apple.mpegurl', '.mpd': 'application/dash+xml',
  '.ts': 'video/mp2t', '.m4s': 'video/iso.segment', '.json': 'application/json',
};

const hits = new Map();
const reqLog = [];
const stats = { total: 0, range: 0, forbidden: 0, flakyFail: 0, flakyOk: 0, byPath: {} };

const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://localhost');
  let rel = decodeURIComponent(u.pathname);
  if (rel === '/__stats') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify({ stats, hits: Object.fromEntries(hits), reqLog }));
    return;
  }
  if (rel === '/__reset') {
    hits.clear();
    reqLog.length = 0;
    for (const k of Object.keys(stats.byPath)) delete stats.byPath[k];
    stats.total = stats.range = stats.forbidden = stats.flakyFail = stats.flakyOk = 0;
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('ok');
    return;
  }
  if (rel === '/') rel = '/index.html';
  const file = path.join(ROOT, rel);
  if (!file.startsWith(ROOT)) { res.writeHead(403); res.end('no'); return; }

  stats.total++;
  stats.byPath[rel] = (stats.byPath[rel] || 0) + 1;
  reqLog.push({ rel, t: Date.now(), range: !!req.headers.range });
  if (reqLog.length > 4000) reqLog.splice(0, reqLog.length - 4000);
  const n = (hits.get(rel) || 0) + 1;
  hits.set(rel, n);

  const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Expose-Headers': 'Content-Length,Content-Range,Accept-Ranges' };

  if (rel === '/assets/expired-token.jpg') {
    stats.forbidden++;
    res.writeHead(403, Object.assign({ 'Content-Type': 'text/plain' }, cors));
    res.end('token kedaluwarsa');
    return;
  }
  if (rel === '/assets/flaky-01.jpg' && n <= 2) {
    stats.flakyFail++;
    res.writeHead(503, Object.assign({ 'Content-Type': 'text/plain' }, cors));
    res.end('coba lagi nanti');
    return;
  }
  if (rel === '/assets/flaky-01.jpg') stats.flakyOk++;

  let st;
  try { st = fs.statSync(file); } catch { res.writeHead(404, cors); res.end('404'); return; }
  if (st.isDirectory()) { res.writeHead(404, cors); res.end('404'); return; }

  const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
  const range = req.headers.range;
  const base = Object.assign({
    'Content-Type': type, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store',
  }, cors);

  if (range) {
    const m = /bytes=(\d*)-(\d*)/.exec(range);
    let start = m && m[1] ? parseInt(m[1], 10) : 0;
    let end = m && m[2] ? parseInt(m[2], 10) : st.size - 1;
    if (!m || (!m[1] && !m[2])) { start = 0; end = st.size - 1; }
    if (!m[1] && m[2]) { start = Math.max(0, st.size - parseInt(m[2], 10)); end = st.size - 1; }
    if (start >= st.size || end >= st.size || start > end) {
      res.writeHead(416, Object.assign({ 'Content-Range': `bytes */${st.size}` }, base));
      res.end(); return;
    }
    stats.range++;
    res.writeHead(206, Object.assign({
      'Content-Range': `bytes ${start}-${end}/${st.size}`, 'Content-Length': end - start + 1,
    }, base));
    fs.createReadStream(file, { start, end }).pipe(res);
    return;
  }
  res.writeHead(200, Object.assign({ 'Content-Length': st.size }, base));
  fs.createReadStream(file).pipe(res);
});

server.listen(PORT, '0.0.0.0', () => console.log('fixture demo di http://127.0.0.1:' + PORT));