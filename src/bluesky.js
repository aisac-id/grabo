/* Grabo — Bluesky lewat AT Protocol publik.
 * Endpoint ini terbuka tanpa token, jadi tidak ada kredensial yang disimpan. */
(function (root) {
  'use strict';
  const U = root.GB;
  const API = 'https://public.api.bsky.app/xrpc/';

  async function json(url) {
    const r = await fetch(url, { credentials: 'omit' });
    if (!r.ok) throw new Error('HTTP ' + r.status + ' dari ' + U.hostOf(url));
    return r.json();
  }

  async function resolveHandle(handle) {
    const h = String(handle || '').trim().replace(/^@/, '').replace(/^https?:\/\/bsky\.app\/profile\//, '').split('/')[0];
    if (!h) throw new Error('handle kosong');
    if (h.startsWith('did:')) return h;
    const d = await json(API + 'com.atproto.identity.resolveHandle?handle=' + encodeURIComponent(h));
    if (!d.did) throw new Error('handle tidak ditemukan: ' + h);
    return d.did;
  }

  function blobUrl(did, cid, mime) {
    const ext = U.extOf('x.bin', mime || '');
    const base = 'https://bsky.social/xrpc/com.atproto.sync.getBlob?did=' + encodeURIComponent(did) + '&cid=' + encodeURIComponent(cid);
    return { url: base, mime: mime || '', ext };
  }

  function cidOf(ref) {
    if (!ref) return '';
    if (typeof ref === 'string') return ref;
    if (ref.$link) return ref.$link;
    if (ref.ref && ref.ref.$link) return ref.ref.$link;
    return '';
  }

  function itemsFromPost(post, pageTitle) {
    const out = [];
    const did = post.author && post.author.did;
    const rec = post.record || {};
    const pageUrl = 'https://bsky.app/profile/' + (post.author.handle || did) + '/post/' + String(post.uri || '').split('/').pop();
    const push = (url, kind, mime, extra) => {
      if (!url) return;
      out.push(Object.assign({
        url, kind, mime,
        source: 'bluesky',
        pageUrl, pageTitle: pageTitle || (post.author.displayName || post.author.handle || 'Bluesky'),
        host: 'bsky.app',
        name: U.nameOf(url),
        selected: true,
        at: Date.now()
      }, extra || {}));
    };
    const embeds = [];
    if (post.embed) embeds.push(post.embed);
    if (rec.embed) embeds.push(rec.embed);
    for (const em of embeds) {
      const t = em.$type || '';
      const media = em.media || em;
      if (t.includes('images') || media.images) {
        for (const im of media.images || []) {
          const cid = cidOf(im.image);
          const mime = (im.image && im.image.mimeType) || 'image/jpeg';
          const asp = im.aspectRatio || {};
          if (cid && did) {
            const b = blobUrl(did, cid, mime);
            push(b.url, 'image', mime, { w: asp.width || 0, h: asp.height || 0, note: 'blob asli ' + cid.slice(0, 12) });
          } else if (im.fullsize) {
            push(im.fullsize, 'image', mime, { w: asp.width || 0, h: asp.height || 0 });
          }
        }
      }
      if (t.includes('video') || media.playlist) {
        if (media.playlist) push(media.playlist, 'playlist', 'application/vnd.apple.mpegurl', { note: 'HLS Bluesky' });
        const cid = cidOf(media.video || em.video);
        if (cid && did) push(blobUrl(did, cid, 'video/mp4').url, 'video', 'video/mp4', { note: 'blob video' });
        if (media.thumbnail) push(media.thumbnail, 'image', 'image/jpeg', { note: 'sampul video' });
      }
      if (t.includes('external') && em.external) {
        if (em.external.thumb) push(em.external.thumb, 'image', 'image/jpeg', { note: 'kartu tautan' });
      }
      if (t.includes('recordWithMedia') && em.media) embeds.push(em.media);
    }
    return out;
  }

  /* opts: {handle, limit, filter, onItems, onLog, signal} */
  async function authorFeed(opts) {
    const log = opts.onLog || function () {};
    const did = await resolveHandle(opts.handle);
    log('Bluesky: ' + (opts.handle || did) + ' → ' + did);
    const filter = opts.filter || 'posts_with_media';
    const limit = Math.max(1, opts.limit || 200);
    let cursor = '';
    let posts = 0;
    const items = [];
    const seen = new Set();
    while (items.length < limit) {
      const url = API + 'app.bsky.feed.getAuthorFeed?actor=' + encodeURIComponent(did) +
        '&filter=' + encodeURIComponent(filter) + '&limit=100' + (cursor ? '&cursor=' + encodeURIComponent(cursor) : '');
      const page = await json(url);
      const feed = page.feed || [];
      if (!feed.length) break;
      for (const f of feed) {
        if (opts.cancelled && opts.cancelled()) return { did, items, posts };
        const post = f.post;
        if (!post || seen.has(post.uri)) continue;
        seen.add(post.uri);
        posts++;
        const found = itemsFromPost(post);
        for (const it of found) {
          if (items.length >= limit) break;
          it.id = U.uid('bs');
          items.push(it);
        }
        if (opts.onItems && found.length) opts.onItems(found);
      }
      cursor = page.cursor || '';
      log('Bluesky: ' + posts + ' pos, ' + items.length + ' media.');
      if (!cursor) break;
      await U.sleep(350);
    }
    return { did, items, posts };
  }

  root.GBBluesky = { authorFeed, resolveHandle, itemsFromPost, blobUrl, cidOf };
})(globalThis);