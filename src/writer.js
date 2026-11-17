/* Grabo — penulis berkas.
 * Mode 'fs' menulis ke folder nyata pilihan pengguna (File System Access API).
 * Mode 'downloads' memakai chrome.downloads sebagai cadangan. */
(function (root) {
  'use strict';
  const U = root.GB;

  function splitPath(path) {
    return String(path).split('/').map((s) => s.trim()).filter(Boolean);
  }

  async function ensureDir(rootHandle, parts) {
    let dir = rootHandle;
    for (const p of parts) dir = await dir.getDirectoryHandle(p, { create: true });
    return dir;
  }

  async function exists(dir, name) {
    try { await dir.getFileHandle(name, { create: false }); return true; }
    catch (e) { return false; }
  }

  async function uniqueName(dir, name) {
    if (!(await exists(dir, name))) return name;
    const m = /^(.*?)(\.[a-z0-9]{2,5})?$/i.exec(name);
    const base = m[1] || name;
    const ext = m[2] || '';
    for (let i = 2; i < 10000; i++) {
      const cand = base + '-' + i + ext;
      if (!(await exists(dir, cand))) return cand;
    }
    return base + '-' + Date.now() + ext;
  }

  function create(opts) {
    const state = {
      mode: opts.mode || 'fs',
      root: opts.root || null,
      rootName: opts.rootName || '',
      template: opts.template || '{host}/{date}/{base}-{n}.{ext}',
      overwrite: !!opts.overwrite,
      manifest: opts.manifest !== false,
      records: [],
      written: 0,
      bytes: 0
    };
    const log = opts.onLog || function () {};

    async function permission(ask) {
      if (!state.root || !state.root.queryPermission) return 'granted';
      const q = await state.root.queryPermission({ mode: 'readwrite' });
      if (q === 'granted') return q;
      if (!ask) return q;
      return state.root.requestPermission({ mode: 'readwrite' });
    }

    async function pickFolder() {
      if (typeof showDirectoryPicker !== 'function') throw new Error('Browser ini tidak mendukung pemilih folder. Pakai mode Unduhan.');
      const handle = await showDirectoryPicker({ mode: 'readwrite', id: 'grabo-target' });
      state.root = handle;
      state.rootName = handle.name;
      state.mode = 'fs';
      await root.GBStore.setMeta('dir', handle);
      await root.GBStore.setMeta('dirName', handle.name);
      log('Folder tujuan: ' + handle.name);
      return handle.name;
    }

    async function restoreFolder() {
      const handle = await root.GBStore.getMeta('dir');
      if (!handle) return '';
      state.root = handle;
      state.rootName = (await root.GBStore.getMeta('dirName')) || handle.name || 'folder';
      state.mode = 'fs';
      return state.rootName;
    }

    /* Jalur internal untuk pengujian otomatis: OPFS memakai API yang sama persis. */
    async function useInternal() {
      const h = await navigator.storage.getDirectory();
      state.root = h;
      state.rootName = 'Penyimpanan internal';
      state.mode = 'fs';
      return state.rootName;
    }

    function pathFor(ctx) {
      return U.renderTemplate(state.template, ctx);
    }

    async function writeFs(bytes, ctx) {
      const perm = await permission(false);
      if (perm !== 'granted') throw new Error('izin folder belum diberikan — klik “Izinkan folder” di Studio');
      const path = pathFor(ctx);
      const parts = splitPath(path);
      const name = parts.pop();
      const dir = await ensureDir(state.root, parts);
      const finalName = state.overwrite ? name : await uniqueName(dir, name);
      const fh = await dir.getFileHandle(finalName, { create: true });
      const w = await fh.createWritable();
      await w.write(bytes);
      await w.close();
      return parts.concat(finalName).join('/');
    }

    async function writeDownloads(bytes, mime, ctx) {
      const path = pathFor(ctx);
      const blob = new Blob([bytes], { type: mime || 'application/octet-stream' });
      const url = URL.createObjectURL(blob);
      try {
        const res = await chrome.runtime.sendMessage({ type: 'GB_DOWNLOAD', url, filename: 'Grabo/' + path, overwrite: state.overwrite });
        if (!res || !res.ok) throw new Error((res && res.error) || 'unduhan ditolak');
        const id = res.id;
        const started = Date.now();
        for (;;) {
          await U.sleep(180);
          const st = await chrome.runtime.sendMessage({ type: 'GB_DOWNLOAD_STATE', id });
          if (!st || !st.ok) throw new Error('status unduhan tidak terbaca');
          if (st.state === 'complete') return 'Grabo/' + path;
          if (st.state === 'interrupted') throw new Error('unduhan terputus: ' + (st.error || 'tidak diketahui'));
          if (Date.now() - started > 180000) throw new Error('unduhan melewati batas waktu');
        }
      } finally {
        setTimeout(() => URL.revokeObjectURL(url), 4000);
      }
    }

    async function write(bytes, mime, ctx) {
      if (!bytes || !bytes.length) throw new Error('berkas kosong');
      const out = state.mode === 'fs' ? await writeFs(bytes, ctx) : await writeDownloads(bytes, mime, ctx);
      state.written++;
      state.bytes += bytes.length;
      if (state.manifest) {
        state.records.push({
          out,
          url: ctx.url,
          pageUrl: ctx.pageUrl || '',
          pageTitle: ctx.pageTitle || '',
          host: ctx.host || U.hostOf(ctx.url || ''),
          kind: ctx.kind || '',
          source: ctx.source || '',
          bytes: bytes.length,
          mime: mime || '',
          hash: ctx.hash || '',
          w: ctx.w || 0,
          h: ctx.h || 0,
          segments: ctx.segments || 0,
          at: new Date().toISOString()
        });
      }
      return out;
    }

    async function flushManifest() {
      if (!state.manifest || !state.records.length) return null;
      const doc = {
        generator: 'Grabo 1.0.0',
        createdAt: new Date().toISOString(),
        files: state.records.length,
        bytes: state.bytes,
        note: 'Manifest asal-usul: setiap berkas mencatat URL sumber dan halaman asalnya.',
        items: state.records
      };
      const bytes = new TextEncoder().encode(JSON.stringify(doc, null, 2));
      const name = 'grabo-manifest-' + new Date().toISOString().slice(0, 19).replace(/[:T]/g, '') + '.json';
      if (state.mode === 'fs' && state.root) {
        const fh = await state.root.getFileHandle(name, { create: true });
        const w = await fh.createWritable();
        await w.write(bytes);
        await w.close();
      } else {
        const blob = new Blob([bytes], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        await chrome.runtime.sendMessage({ type: 'GB_DOWNLOAD', url, filename: 'Grabo/' + name });
        setTimeout(() => URL.revokeObjectURL(url), 4000);
      }
      log('Manifest ditulis: ' + name + ' (' + state.records.length + ' berkas).');
      state.records = [];
      return name;
    }

    return {
      state,
      pickFolder,
      restoreFolder,
      useInternal,
      permission,
      write,
      flushManifest,
      pathFor,
      setMode(m) { state.mode = m; },
      setTemplate(t) { state.template = t; },
      setOverwrite(v) { state.overwrite = !!v; },
      setManifest(v) { state.manifest = !!v; }
    };
  }

  root.GBWriter = { create, splitPath, ensureDir, uniqueName };
})(globalThis);