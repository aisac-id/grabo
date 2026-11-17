/* Grabo — adapter per situs (konteks halaman).
 * Adapter DOM bekerja pada apa yang sudah dirender di halaman yang kamu buka.
 * `live: false` berarti adapter belum diuji pada akun nyata, hanya pada fixture lokal. */
(function (root) {
  'use strict';
  const U = root.GB;

  function vis(el) {
    return el && el.getClientRects && el.getClientRects().length > 0;
  }

  /* Mencari wadah yang benar-benar bisa digulir. */
  function scrollerOf(selectors) {
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el && el.scrollHeight > el.clientHeight + 40) return el;
    }
    const all = Array.from(document.querySelectorAll('div, main, section'))
      .filter((el) => el.scrollHeight > el.clientHeight + 200 && /auto|scroll/.test(getComputedStyle(el).overflowY));
    return all.sort((a, b) => b.scrollHeight - a.scrollHeight)[0] || null;
  }

  async function scrollUp(el, steps, delay) {
    if (!el) return 0;
    let moved = 0;
    for (let i = 0; i < steps; i++) {
      const before = el.scrollTop;
      el.scrollTop = Math.max(0, before - el.clientHeight * 0.9);
      await U.sleep(delay);
      if (el.scrollTop === before) break;
      moved++;
    }
    return moved;
  }

  const gallery = {
    id: 'gallery',
    label: 'Galeri umum',
    match: () => true,
    live: true,
    hosts: 'semua situs',
    note: 'Gulir + klik “muat lebih” untuk memuat semua item malas-muat.',
    async harvest({ add, log, settings }) {
      const before = document.querySelectorAll('img, video').length;
      const btn = Array.from(document.querySelectorAll('button, [role="button"]'))
        .filter((b) => vis(b) && /muat lebih|load more|tampilkan lebih|show more|lihat lebih/i.test(b.textContent || ''));
      for (const b of btn.slice(0, 6)) {
        b.click();
        await U.sleep(settings.scrollDelay || 500);
      }
      const after = document.querySelectorAll('img, video').length;
      if (after > before) log('Galeri memuat ' + (after - before) + ' elemen baru.');
      return Math.max(0, after - before);
    }
  };

  const telegram = {
    id: 'telegram',
    label: 'Telegram Web',
    hosts: 'web.telegram.org · webk · weba',
    match: (host) => /(^|\.)web\.telegram\.org$|(^|\.)webk\.telegram\.org$|(^|\.)weba\.telegram\.org$/.test(host),
    live: false,
    note: 'Buka Saved Messages atau chat milikmu, lalu panen. Gulir ke atas memuat riwayat. Konten berproteksi dilewati.',
    async harvest({ add, log, settings }) {
      const box = scrollerOf(['.bubbles-scroller', '.chat-container', '.messages-container', '.scrollable-y']);
      const steps = await scrollUp(box, settings.scrollDepth || 6, settings.scrollDelay || 600);
      let n = 0;
      document.querySelectorAll('.bubble img.photo, .bubble img.thumbnail, .bubble video, .media-photo img, .media-video video, img.media-photo').forEach((el) => {
        const url = el.currentSrc || el.getAttribute('src');
        if (!url) return;
        if (add({ url: U.abs(url, location.href), kind: el.tagName === 'VIDEO' ? 'video' : 'image', source: 'adapter', note: 'Telegram' })) n++;
      });
      document.querySelectorAll('.bubble a.download, .bubble a[href*="document"], a.attachment').forEach((el) => {
        const url = el.getAttribute('href');
        if (url && U.kindOf(url, '') !== 'other') {
          if (add({ url: U.abs(url, location.href), source: 'adapter', note: 'lampiran Telegram' })) n++;
        }
      });
      const locked = document.querySelectorAll('.bubble .protected, [class*="restrict"], [class*="no-save"]').length;
      if (locked) log(locked + ' media berproteksi terdeteksi dan dilewati.');
      log('Telegram: ' + steps + ' langkah gulir, ' + n + ' media baru.');
      return n;
    }
  };

  const discord = {
    id: 'discord',
    label: 'Discord',
    hosts: 'discord.com',
    match: (host) => /(^|\.)discord\.com$/.test(host),
    live: false,
    note: 'Untuk berkas milikmu sendiri: cari “from:me has:file” di Discord, lalu panen halaman hasilnya.',
    async harvest({ add, log, settings }) {
      const box = scrollerOf(['[class*="scrollerInner"]', '[class*="scroller_"]', 'ol[class*="scroller"]']);
      const steps = await scrollUp(box, settings.scrollDepth || 6, settings.scrollDelay || 700);
      let n = 0;
      const grab = (url, kind, note) => {
        if (!url) return;
        const abs = U.abs(url, location.href);
        if (add({ url: abs, kind, source: 'adapter', note })) n++;
      };
      document.querySelectorAll('[class*="imageWrapper"] img, [class*="lazyImg"], a[class*="originalLink"], [class*="attachment"] img').forEach((el) => {
        grab(el.getAttribute('src'), 'image', 'lampiran Discord');
      });
      document.querySelectorAll('video[src], video source[src]').forEach((el) => {
        grab(el.getAttribute('src'), 'video', 'video Discord');
      });
      document.querySelectorAll('a[href*="cdn.discordapp.com"], a[href*="media.discordapp.net"]').forEach((el) => {
        grab(el.getAttribute('href'), undefined, 'tautan CDN');
      });
      log('Discord: ' + steps + ' langkah gulir, ' + n + ' media baru.');
      return n;
    }
  };

  const aiStudio = {
    id: 'aistudio',
    label: 'Generator AI (galeri karyamu)',
    hosts: 'dreamina · capcut · leonardo · midjourney · ideogram · krea · runway · pika · kling · luma · civitai · tensor.art · seaart',
    match: (host) => /dreamina|capcut|leonardo|midjourney|playground|ideogram|krea|runway|pika|kling|haiper|luma|suno|civitai|tensor\.art|seaart/i.test(host),
    live: false,
    note: 'Buka halaman riwayat/galeri akunmu. Grabo memanen versi penuh yang benar-benar dimuat, bukan thumbnail.',
    async harvest({ add, log, settings }) {
      const before = document.querySelectorAll('img, video').length;
      for (let i = 0; i < Math.min(8, settings.scrollDepth || 6); i++) {
        window.scrollBy(0, innerHeight * 0.9);
        await U.sleep(settings.scrollDelay || 700);
        const btn = Array.from(document.querySelectorAll('button, [role="button"]'))
          .find((b) => vis(b) && /muat lebih|load more|show more|lihat lebih/i.test(b.textContent || ''));
        if (btn) { btn.click(); await U.sleep(settings.scrollDelay || 700); }
      }
      let n = 0;
      document.querySelectorAll('img[src], img[data-src], video[src], video source[src], a[download]').forEach((el) => {
        const url = el.getAttribute('src') || el.getAttribute('data-src') || el.getAttribute('href');
        if (!url) return;
        const kind = el.tagName === 'VIDEO' ? 'video' : undefined;
        if (add({ url: U.abs(url, location.href), kind, source: 'adapter', note: 'galeri AI' })) n++;
      });
      const after = document.querySelectorAll('img, video').length;
      log('Galeri AI: ' + before + ' → ' + after + ' elemen, ' + n + ' kandidat baru.');
      return n;
    }
  };

  const list = [gallery, aiStudio, telegram, discord];
  const byId = {};
  list.forEach((a) => { byId[a.id] = a; });

  root.GBAdapters = byId;
  root.GBAdapterList = list;
  root.GBAdapterFor = function (host) {
    const hit = list.find((a) => a.id !== 'gallery' && a.match(host));
    return hit ? hit.id : 'gallery';
  };
})(globalThis);