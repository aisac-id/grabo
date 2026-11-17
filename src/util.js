/* Grabo — util bersama (content script, sidebar, dan studio).
 * Dipakai sebagai skrip biasa, jadi semuanya menggantung di globalThis.GB. */
(function (root) {
  'use strict';

  const IMG_EXT = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'avif', 'bmp', 'svg', 'ico', 'tiff', 'heic', 'jfif'];
  const VID_EXT = ['mp4', 'webm', 'mov', 'm4v', 'mkv', 'avi', 'flv', 'ts', 'm3u8', 'mpd', 'ogv'];
  const AUD_EXT = ['mp3', 'm4a', 'aac', 'wav', 'ogg', 'opus', 'flac'];

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function uid(prefix) {
    return (prefix || 'j') + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function bytes(n) {
    if (!Number.isFinite(n) || n < 0) return '—';
    if (n < 1024) return n + ' B';
    const u = ['KB', 'MB', 'GB', 'TB'];
    let i = -1, v = n;
    do { v /= 1024; i++; } while (v >= 1024 && i < u.length - 1);
    return (v >= 100 ? v.toFixed(0) : v >= 10 ? v.toFixed(1) : v.toFixed(2)) + ' ' + u[i];
  }

  function dur(ms) {
    if (!Number.isFinite(ms) || ms <= 0) return '—';
    const s = Math.round(ms / 1000);
    if (s < 60) return s + 'd';
    const m = Math.floor(s / 60);
    if (m < 60) return m + 'm ' + (s % 60) + 'd';
    return Math.floor(m / 60) + 'j ' + (m % 60) + 'm';
  }

  function clock(sec) {
    if (!Number.isFinite(sec)) return '00:00';
    const s = Math.max(0, Math.floor(sec));
    return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
  }

  function hostOf(url) {
    try { return new URL(url).hostname.replace(/^www\./, ''); } catch (e) { return 'lokal'; }
  }

  function abs(url, base) {
    try { return new URL(url, base || (typeof location !== 'undefined' ? location.href : undefined)).href; }
    catch (e) { return ''; }
  }

  /* URL dinormalkan supaya varian CDN yang sama tidak dihitung dua kali. */
  function normUrl(url) {
    try {
      const u = new URL(url);
      u.hash = '';
      const junk = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'fbclid', 'gclid', '_nc_ht', 'ig_cache_key'];
      junk.forEach((k) => u.searchParams.delete(k));
      return u.href;
    } catch (e) { return url; }
  }

  function extOf(url, mime) {
    const byMime = {
      'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/png': 'png', 'image/gif': 'gif',
      'image/webp': 'webp', 'image/avif': 'avif', 'image/bmp': 'bmp', 'image/svg+xml': 'svg',
      'image/x-icon': 'ico', 'image/tiff': 'tiff', 'image/heic': 'heic',
      'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov', 'video/x-matroska': 'mkv',
      'video/mp2t': 'ts', 'video/ogg': 'ogv',
      'audio/mpeg': 'mp3', 'audio/mp4': 'm4a', 'audio/aac': 'aac', 'audio/wav': 'wav',
      'audio/ogg': 'ogg', 'audio/opus': 'opus', 'audio/flac': 'flac',
      'application/vnd.apple.mpegurl': 'm3u8', 'application/x-mpegurl': 'm3u8',
      'application/dash+xml': 'mpd'
    };
    let path = '';
    const dm = /^data:([^;,]+)/i.exec(String(url || ''));
    if (dm && byMime[dm[1].toLowerCase()]) return byMime[dm[1].toLowerCase()];
    try { path = new URL(url, 'http://x/').pathname; } catch (e) { path = String(url || ''); }
    const m = /\.([a-z0-9]{2,5})$/i.exec(path);
    const fromUrl = m ? m[1].toLowerCase() : '';
    const all = IMG_EXT.concat(VID_EXT, AUD_EXT);
    if (fromUrl && all.includes(fromUrl)) return fromUrl === 'jpeg' ? 'jpg' : fromUrl;
    const key = String(mime || '').split(';')[0].trim().toLowerCase();
    if (byMime[key]) return byMime[key];
    if (fromUrl) return fromUrl;
    return 'bin';
  }

  function kindOf(url, mime) {
    const e = extOf(url, mime);
    if (e === 'm3u8' || e === 'mpd') return 'playlist';
    if (IMG_EXT.includes(e)) return 'image';
    if (VID_EXT.includes(e)) return 'video';
    if (AUD_EXT.includes(e)) return 'audio';
    const k = String(mime || '').split(';')[0].trim().toLowerCase();
    if (k.startsWith('image/')) return 'image';
    if (k.startsWith('video/')) return 'video';
    if (k.startsWith('audio/')) return 'audio';
    return 'other';
  }

  function nameOf(url) {
    try {
      const u = new URL(url, 'http://x/');
      const last = u.pathname.split('/').filter(Boolean).pop() || u.hostname;
      return decodeURIComponent(last).slice(0, 120);
    } catch (e) { return 'media'; }
  }

  function sanitize(name) {
    return String(name || 'media')
      .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')
      .replace(/\s+/g, ' ')
      .replace(/^\.+/, '')
      .trim()
      .slice(0, 140) || 'media';
  }

  /* {host} {source} {date} {time} {name} {base} {ext} {n} {w} {h} {hash8} {kind} {page} */
  function renderTemplate(tpl, ctx) {
    const d = new Date(ctx.when || Date.now());
    const pad = (n) => String(n).padStart(2, '0');
    const date = d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
    const time = pad(d.getHours()) + pad(d.getMinutes()) + pad(d.getSeconds());
    const full = sanitize(ctx.name || nameOf(ctx.url || ''));
    const ext = ctx.ext || extOf(ctx.url || '', ctx.mime);
    const base = full.replace(/\.[a-z0-9]{2,5}$/i, '');
    const map = {
      host: sanitize(ctx.host || hostOf(ctx.url || '')),
      source: sanitize(ctx.source || 'dom'),
      page: sanitize(ctx.pageTitle || ctx.host || 'halaman'),
      date, time, name: full, base: sanitize(base), ext,
      n: String(ctx.n || 1).padStart(3, '0'),
      w: String(ctx.w || 0), h: String(ctx.h || 0),
      hash8: String(ctx.hash || '').slice(0, 8),
      kind: ctx.kind || 'image'
    };
    return String(tpl || '{host}/{date}/{base}-{n}.{ext}')
      .replace(/\{(\w+)\}/g, (m, k) => (k in map ? map[k] : m))
      .split('/')
      .map((seg) => sanitize(seg))
      .filter(Boolean)
      .join('/');
  }

  function globToRe(glob) {
    const esc = String(glob).replace(/[.+^${}()|[\]\\]/g, '\\$&');
    return new RegExp('^' + esc.replace(/\*/g, '.*').replace(/\?/g, '.') + '$', 'i');
  }

  function matchAny(patterns, value) {
    return (patterns || []).some((p) => {
      const s = String(p || '').trim();
      if (!s) return false;
      if (s.startsWith('/') && s.lastIndexOf('/') > 0) {
        const end = s.lastIndexOf('/');
        try { return new RegExp(s.slice(1, end), s.slice(end + 1)).test(value); } catch (e) { return false; }
      }
      if (s.includes('*') || s.includes('?')) return globToRe(s).test(value);
      return value.toLowerCase().includes(s.toLowerCase());
    });
  }

  /* Tebak jenis dari isi berkas — dipakai saat URL tidak berekstensi (blob:, data:, CDN bertoken). */
  function sniff(u8) {
    if (!u8 || u8.length < 12) return null;
    const at = (i, s) => { for (let k = 0; k < s.length; k++) if (u8[i + k] !== s.charCodeAt(k)) return false; return true; };
    if (u8[0] === 0x89 && at(1, 'PNG')) return { ext: 'png', mime: 'image/png' };
    if (u8[0] === 0xff && u8[1] === 0xd8 && u8[2] === 0xff) return { ext: 'jpg', mime: 'image/jpeg' };
    if (at(0, 'GIF8')) return { ext: 'gif', mime: 'image/gif' };
    if (at(0, 'RIFF') && at(8, 'WEBP')) return { ext: 'webp', mime: 'image/webp' };
    if (at(0, 'BM')) return { ext: 'bmp', mime: 'image/bmp' };
    if (at(4, 'ftyp') || at(4, 'moof') || at(4, 'styp') || at(4, 'moov') || at(4, 'mdat')) return { ext: 'mp4', mime: 'video/mp4' };
    if (u8[0] === 0x1a && u8[1] === 0x45 && u8[2] === 0xdf && u8[3] === 0xa3) return { ext: 'webm', mime: 'video/webm' };
    if (u8[0] === 0x47 && u8[188] === 0x47) return { ext: 'ts', mime: 'video/mp2t' };
    if (at(0, 'ID3') || (u8[0] === 0xff && (u8[1] & 0xe0) === 0xe0)) return { ext: 'mp3', mime: 'audio/mpeg' };
    if (at(0, 'OggS')) return { ext: 'ogg', mime: 'audio/ogg' };
    if (at(0, '<svg') || at(0, '<?xml')) return { ext: 'svg', mime: 'image/svg+xml' };
    return null;
  }

  async function sha256Hex(buf) {
    const h = await crypto.subtle.digest('SHA-256', buf);
    return Array.from(new Uint8Array(h)).map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  function concatBytes(list, total) {
    const out = new Uint8Array(total != null ? total : list.reduce((a, b) => a + b.length, 0));
    let o = 0;
    for (const b of list) { out.set(b, o); o += b.length; }
    return out;
  }

  function b64FromBytes(u8) {
    let s = '';
    const CH = 0x8000;
    for (let i = 0; i < u8.length; i += CH) s += String.fromCharCode.apply(null, u8.subarray(i, i + CH));
    return btoa(s);
  }

  function bytesFromB64(b64) {
    const bin = atob(b64);
    const u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    return u8;
  }

  /* Pembatas laju per-host: satu angka untuk semua pekerjaan. */
  function makePacer() {
    const next = new Map();
    return {
      async wait(host, gapMs) {
        const now = Date.now();
        const at = next.get(host) || 0;
        const delay = Math.max(0, at - now);
        next.set(host, Math.max(now, at) + Math.max(0, gapMs || 0));
        if (delay > 0) await sleep(delay);
      },
      reset() { next.clear(); }
    };
  }

  function debounce(fn, ms) {
    let t = 0;
    return function () {
      const args = arguments;
      clearTimeout(t);
      t = setTimeout(() => fn.apply(null, args), ms);
    };
  }

  root.GB = {
    IMG_EXT, VID_EXT, AUD_EXT,
    clamp, sleep, uid, bytes, dur, clock, hostOf, abs, normUrl, extOf, kindOf, nameOf,
    sanitize, renderTemplate, globToRe, matchAny, sniff, sha256Hex, concatBytes,
    b64FromBytes, bytesFromB64, makePacer, debounce
  };
})(globalThis);