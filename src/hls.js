/* Grabo — pembaca aliran HLS/DASH tanpa DRM.
 * Playlist terenkripsi selalu ditolak: Grabo tidak membuka proteksi apa pun. */
(function (root) {
  'use strict';
  const U = root.GB;

  const KEY_RE = /^#EXT-X-(?:SESSION-)?KEY:(.*)$/;
  const MAP_RE = /^#EXT-X-MAP:(.*)$/;

  function attrs(line) {
    const out = {};
    const re = /([A-Z0-9-]+)=("([^"]*)"|[^,]*)/g;
    let m;
    while ((m = re.exec(line))) out[m[1]] = m[3] != null ? m[3] : m[2];
    return out;
  }

  function parseMaster(text, base) {
    const lines = text.split(/\r?\n/);
    const variants = [];
    let pending = null;
    let encrypted = false;
    for (const raw of lines) {
      const line = raw.trim();
      if (!line) continue;
      const key = KEY_RE.exec(line);
      if (key && (attrs(key[1]).METHOD || 'NONE').toUpperCase() !== 'NONE') encrypted = true;
      if (line.startsWith('#EXT-X-STREAM-INF:')) {
        const a = attrs(line.slice(18));
        pending = {
          bandwidth: Number(a.BANDWIDTH || a['AVERAGE-BANDWIDTH'] || 0),
          w: 0, h: 0,
          codecs: a.CODECS || '',
          name: a.NAME || ''
        };
        if (a.RESOLUTION) {
          const r = /(\d+)x(\d+)/.exec(a.RESOLUTION);
          if (r) { pending.w = Number(r[1]); pending.h = Number(r[2]); }
        }
        continue;
      }
      if (line.startsWith('#')) continue;
      const url = U.abs(line, base);
      if (!url) continue;
      variants.push(Object.assign(pending || { bandwidth: 0, w: 0, h: 0, codecs: '', name: '' }, { url }));
      pending = null;
    }
    return { variants, encrypted };
  }

  function pickVariant(variants, quality) {
    if (!variants.length) return null;
    const sorted = variants.slice().sort((a, b) => (b.bandwidth || b.h * b.w) - (a.bandwidth || a.h * a.w));
    if (quality === 'low') return sorted[sorted.length - 1];
    if (quality === 'mid') return sorted[Math.floor((sorted.length - 1) / 2)];
    return sorted[0];
  }

  function parseMedia(text, base) {
    const lines = text.split(/\r?\n/);
    const segs = [];
    let init = null;
    let duration = 0;
    let encrypted = false;
    let keyMethod = '';
    let pendingRange = null;
    let pendingDuration = 0;
    let seq = 0;
    let isFmp4 = false;
    let endList = false;
    for (const raw of lines) {
      const line = raw.trim();
      if (!line) continue;
      if (line.startsWith('#EXT-X-MEDIA-SEQUENCE:')) { seq = Number(line.split(':')[1]) || 0; continue; }
      if (line === '#EXT-X-ENDLIST') { endList = true; continue; }
      const key = KEY_RE.exec(line);
      if (key) {
        const a = attrs(key[1]);
        keyMethod = (a.METHOD || 'NONE').toUpperCase();
        if (keyMethod !== 'NONE') encrypted = true;
        continue;
      }
      const map = MAP_RE.exec(line);
      if (map) {
        const a = attrs(map[1]);
        if (a.URI) { init = { url: U.abs(a.URI, base), range: a.BYTERANGE || '' }; isFmp4 = true; }
        continue;
      }
      if (line.startsWith('#EXT-X-BYTERANGE:')) { pendingRange = line.split(':')[1]; continue; }
      if (line.startsWith('#EXTINF:')) {
        pendingDuration = parseFloat(line.slice(8)) || 0;
        duration += pendingDuration;
        continue;
      }
      if (line.startsWith('#')) continue;
      segs.push({ url: U.abs(line, base), range: pendingRange, dur: pendingDuration, n: seq + segs.length });
      pendingRange = null;
      pendingDuration = 0;
    }
    return { segs, init, duration, encrypted, keyMethod, isFmp4, endList };
  }

  function rangeHeader(range, prevEnd) {
    if (!range) return null;
    const m = /^(\d+)(?:@(\d+))?$/.exec(String(range).trim());
    if (!m) return null;
    const len = Number(m[1]);
    const start = m[2] != null ? Number(m[2]) : (prevEnd || 0);
    return { start, end: start + len - 1, header: 'bytes=' + start + '-' + (start + len - 1) };
  }

  function fillTemplate(tpl, vars) {
    return String(tpl).replace(/\$(RepresentationID|Number|Bandwidth|Time|SubNumber)(%0(\d+)d)?\$/g,
      (m, key, _f, width) => {
        if (key === '$') return '$';
        let v = vars[key];
        if (v == null) return m;
        v = String(v);
        return width ? v.padStart(Number(width), '0') : v;
      }).replace(/\$\$/g, '$');
  }

  function parseDash(xmlText, base) {
    const doc = new DOMParser().parseFromString(xmlText, 'application/xml');
    if (doc.getElementsByTagName('parsererror').length) throw new Error('MPD tidak bisa dibaca');
    const mpd = doc.documentElement;
    const prot = doc.getElementsByTagName('ContentProtection');
    if (prot.length) return { protected: true, reason: 'DASH memakai ContentProtection (DRM)' };
    const mediaDur = mpd.getAttribute('mediaPresentationDuration') || '';
    const duration = isoDur(mediaDur);
    const periods = Array.from(doc.getElementsByTagName('Period'));
    const out = [];
    for (const period of periods) {
      const pBase = baseUrlOf(period, base);
      const sets = Array.from(period.getElementsByTagName('AdaptationSet'));
      for (const set of sets) {
        const sBase = baseUrlOf(set, pBase);
        const mime = set.getAttribute('mimeType') || '';
        const reps = Array.from(set.getElementsByTagName('Representation'));
        for (const rep of reps) {
          const rBase = baseUrlOf(rep, sBase);
          const info = {
            id: rep.getAttribute('id') || '1',
            bandwidth: Number(rep.getAttribute('bandwidth') || 0),
            w: Number(rep.getAttribute('width') || set.getAttribute('width') || 0),
            h: Number(rep.getAttribute('height') || set.getAttribute('height') || 0),
            mime: mime || rep.getAttribute('mimeType') || '',
            kind: (mime || rep.getAttribute('mimeType') || '').startsWith('audio') ? 'audio' : 'video',
            codecs: rep.getAttribute('codecs') || set.getAttribute('codecs') || '',
            duration,
            base: rBase
          };
          const tpl = firstEl(rep, 'SegmentTemplate') || firstEl(set, 'SegmentTemplate');
          const list = firstEl(rep, 'SegmentList') || firstEl(set, 'SegmentList');
          if (tpl) {
            info.init = tpl.getAttribute('initialization') ? U.abs(fillTemplate(tpl.getAttribute('initialization'), varsFor(info, 0, 0)), rBase) : '';
            info.media = tpl.getAttribute('media') || '';
            info.startNumber = Number(tpl.getAttribute('startNumber') || 1);
            info.timescale = Number(tpl.getAttribute('timescale') || 1);
            info.segDur = Number(tpl.getAttribute('duration') || 0);
            const tl = firstEl(tpl, 'SegmentTimeline');
            info.timeline = tl ? Array.from(tl.getElementsByTagName('S')).map((s) => ({
              t: s.getAttribute('t') != null ? Number(s.getAttribute('t')) : null,
              d: Number(s.getAttribute('d') || 0),
              r: Number(s.getAttribute('r') || 0)
            })) : null;
          } else if (list) {
            const ini = firstEl(list, 'Initialization');
            info.init = ini && ini.getAttribute('sourceURL') ? U.abs(ini.getAttribute('sourceURL'), rBase) : '';
            info.urls = Array.from(list.getElementsByTagName('SegmentURL'))
              .map((s) => U.abs(s.getAttribute('media') || '', rBase)).filter(Boolean);
          } else {
            info.urls = [rBase];
          }
          out.push(info);
        }
      }
    }
    return { protected: false, reps: out, duration };
  }

  function varsFor(info, number, time) {
    return { RepresentationID: info.id, Number: number, Bandwidth: info.bandwidth, Time: time };
  }

  function firstEl(parent, tag) {
    for (const c of Array.from(parent.children)) if (c.tagName === tag) return c;
    return null;
  }

  function baseUrlOf(el, base) {
    const b = firstEl(el, 'BaseURL');
    return b && b.textContent ? U.abs(b.textContent.trim(), base) : base;
  }

  function isoDur(s) {
    const m = /^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:([\d.]+)S)?$/.exec(String(s || ''));
    if (!m) return 0;
    return (Number(m[1] || 0) * 86400) + (Number(m[2] || 0) * 3600) + (Number(m[3] || 0) * 60) + Number(m[4] || 0);
  }

  function dashSegments(info, maxSegs) {
    if (info.urls && !info.media) return info.urls.map((url, i) => ({ url, n: i + 1 }));
    const segs = [];
    if (info.timeline && info.timeline.length) {
      let t = 0, n = info.startNumber;
      for (const s of info.timeline) {
        if (s.t != null) t = s.t;
        for (let k = 0; k <= s.r; k++) {
          segs.push({ url: U.abs(fillTemplate(info.media, varsFor(info, n, t)), info.base), n });
          t += s.d; n++;
          if (segs.length >= maxSegs) return segs;
        }
      }
      return segs;
    }
    if (info.segDur > 0 && info.duration > 0) {
      const total = Math.ceil((info.duration * info.timescale) / info.segDur);
      for (let i = 0; i < Math.min(total, maxSegs); i++) {
        const n = info.startNumber + i;
        segs.push({ url: U.abs(fillTemplate(info.media, varsFor(info, n, i * info.segDur)), info.base), n });
      }
      return segs;
    }
    /* Tanpa durasi: jalan sampai server menolak. */
    for (let i = 0; i < maxSegs; i++) {
      const n = info.startNumber + i;
      segs.push({ url: U.abs(fillTemplate(info.media, varsFor(info, n, i * (info.segDur || 0))), info.base), n, probe: true });
    }
    return segs;
  }

  function sniffExt(parts, fallback) {
    for (const p of parts) {
      if (p.length < 12) continue;
      const s = String.fromCharCode.apply(null, p.subarray(4, 12));
      if (s.startsWith('ftyp')) return { ext: 'mp4', mime: 'video/mp4' };
      if (p[0] === 0x47 && p.length >= 188 && p[188] === 0x47) return { ext: 'ts', mime: 'video/mp2t' };
      if (p[0] === 0x1a && p[1] === 0x45 && p[2] === 0xdf && p[3] === 0xa3) return { ext: 'webm', mime: 'video/webm' };
      if (s.startsWith('moof') || s.startsWith('styp')) return { ext: 'mp4', mime: 'video/mp4' };
      break;
    }
    return fallback;
  }

  /* read(url, headers?) → Uint8Array. Disediakan pemanggil supaya bisa lewat konteks halaman. */
  function create(opts) {
    const read = opts.read;
    const log = opts.onLog || function () {};
    const maxSegs = opts.maxSegs || 4000;
    const quality = opts.quality || 'best';
    let cancelled = false;

    async function readText(url) {
      const b = await read(url);
      return new TextDecoder().decode(b);
    }

    async function grabHls(url, onProgress) {
      let text = await readText(url);
      let cur = url;
      let hops = 0;
      let variants = [];
      while (text.includes('#EXT-X-STREAM-INF') && hops < 4) {
        const m = parseMaster(text, cur);
        if (m.encrypted) return { protected: true, reason: 'playlist HLS terenkripsi' };
        const v = pickVariant(m.variants, quality);
        if (!v) break;
        variants = m.variants;
        log('Varian dipilih: ' + (v.w ? v.w + '×' + v.h : Math.round(v.bandwidth / 1000) + ' kbps'));
        cur = v.url;
        text = await readText(cur);
        hops++;
      }
      const media = parseMedia(text, cur);
      if (media.encrypted) return { protected: true, reason: 'segmen HLS memakai ' + media.keyMethod };
      if (!media.segs.length) throw new Error('playlist tidak berisi segmen');
      if (!media.endList) log('Playlist siaran langsung — hanya segmen yang tersedia saat ini diambil.');
      const parts = [];
      if (media.init) {
        const r = rangeHeader(media.init.range, 0);
        parts.push(await read(media.init.url, r ? { Range: r.header } : null));
      }
      let prevEnd = 0;
      const limit = Math.min(media.segs.length, maxSegs);
      for (let i = 0; i < limit; i++) {
        if (cancelled) throw new Error('dibatalkan');
        const s = media.segs[i];
        const r = rangeHeader(s.range, prevEnd);
        if (r) prevEnd = r.end + 1;
        parts.push(await read(s.url, r ? { Range: r.header } : null));
        if (onProgress) onProgress(i + 1, limit, parts.reduce((a, b) => a + b.length, 0));
      }
      const bytes = U.concatBytes(parts);
      const sniff = sniffExt(parts, media.isFmp4 ? { ext: 'mp4', mime: 'video/mp4' } : { ext: 'ts', mime: 'video/mp2t' });
      return {
        bytes, mime: sniff.mime, ext: sniff.ext,
        segments: limit, duration: media.duration,
        w: (variants.find((v) => v.url === cur) || {}).w || 0,
        h: (variants.find((v) => v.url === cur) || {}).h || 0,
        variants: variants.length
      };
    }

    async function grabDash(url, onProgress) {
      const text = await readText(url);
      const info = parseDash(text, url);
      if (info.protected) return { protected: true, reason: info.reason };
      const vids = info.reps.filter((r) => r.kind === 'video');
      const pool = vids.length ? vids : info.reps;
      if (!pool.length) throw new Error('MPD tidak berisi representasi');
      const rep = pickVariant(pool.map((r) => Object.assign({}, r, { url: r.base })), quality);
      const chosen = pool.find((r) => r.id === rep.id) || pool[0];
      log('Representasi DASH: ' + (chosen.w ? chosen.w + '×' + chosen.h : Math.round(chosen.bandwidth / 1000) + ' kbps'));
      const parts = [];
      if (chosen.init) parts.push(await read(chosen.init));
      const segs = dashSegments(chosen, maxSegs);
      let done = 0;
      for (const s of segs) {
        if (cancelled) throw new Error('dibatalkan');
        let b;
        try { b = await read(s.url); }
        catch (e) {
          if (s.probe) break;
          throw e;
        }
        if (!b || !b.length) { if (s.probe) break; continue; }
        parts.push(b);
        done++;
        if (onProgress) onProgress(done, segs.length, parts.reduce((a, x) => a + x.length, 0));
      }
      if (!parts.length) throw new Error('tidak ada segmen DASH yang bisa diambil');
      const bytes = U.concatBytes(parts);
      const sniff = sniffExt(parts, { ext: U.extOf(chosen.mime === 'audio/mp4' ? 'x.m4a' : 'x.mp4', chosen.mime), mime: chosen.mime || 'video/mp4' });
      return { bytes, mime: sniff.mime, ext: sniff.ext, segments: done, duration: info.duration, w: chosen.w, h: chosen.h, variants: pool.length };
    }

    return {
      cancel() { cancelled = true; },
      reset() { cancelled = false; },
      async resolve(url, onProgress) {
        const ext = U.extOf(url);
        if (ext === 'm3u8') return grabHls(url, onProgress);
        if (ext === 'mpd') return grabDash(url, onProgress);
        throw new Error('bukan playlist: ' + ext);
      }
    };
  }

  root.GBStream = { create, parseMaster, parseMedia, parseDash, pickVariant, dashSegments, fillTemplate, isoDur, sniffExt, rangeHeader };
})(globalThis);