/* Grabo — ikon garis (satu sumber untuk sidebar & Studio). */
(function (root) {
  'use strict';
  const P = {
    claw: '<path d="M4 4v5a8 8 0 0 0 16 0V4"/><path d="M12 17v4"/><path d="M8 21h8"/>',
    gauge: '<path d="M12 13l4-4"/><path d="M3.5 18a9 9 0 1 1 17 0"/><circle cx="12" cy="13" r="1.6"/>',
    harvest: '<path d="M3 7h18"/><path d="M6 7V4h12v3"/><path d="M5 7l1.4 12.2A2 2 0 0 0 8.4 21h7.2a2 2 0 0 0 2-1.8L19 7"/><path d="M10 11v6M14 11v6"/>',
    grid: '<rect x="3" y="3" width="7.5" height="7.5" rx="1.5"/><rect x="13.5" y="3" width="7.5" height="7.5" rx="1.5"/><rect x="3" y="13.5" width="7.5" height="7.5" rx="1.5"/><rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.5"/>',
    queue: '<path d="M4 6h16M4 12h16M4 18h10"/><circle cx="19" cy="18" r="2.4"/>',
    film: '<rect x="2.5" y="4.5" width="19" height="15" rx="2.5"/><path d="M7 4.5v15M17 4.5v15M2.5 12h19"/>',
    filter: '<path d="M3 5h18l-7 8v6l-4 2v-8Z"/>',
    folder: '<path d="M3 7.5A2 2 0 0 1 5 5.5h4l2 2.5h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/><path d="M12 12v5M9.5 14.5h5"/>',
    plug: '<path d="M9 3v5M15 3v5"/><path d="M6 8h12v3a6 6 0 0 1-12 0Z"/><path d="M12 17v4"/>',
    cog: '<circle cx="12" cy="12" r="3"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.2 5.2l2.1 2.1M16.7 16.7l2.1 2.1M18.8 5.2l-2.1 2.1M7.3 16.7l-2.1 2.1"/>',
    links: '<path d="M9.5 14.5 14.5 9.5"/><path d="M11 6.5 13 4.5a4 4 0 0 1 5.7 5.7l-2 2"/><path d="M13 17.5 11 19.5a4 4 0 0 1-5.7-5.7l2-2"/>',
    bsky: '<path d="M12 10.5C10.6 7.4 7.2 4.3 4.7 3.4 3 2.8 2.5 4 2.5 5.6c0 1.7.6 6.2 1 7 .6 1.3 2 1.8 3.6 1.6-2.6.5-3.4 2-2 3.6 1.4 1.6 3.9.6 5.4-1.6l1.5-2.3 1.5 2.3c1.5 2.2 4 3.2 5.4 1.6 1.4-1.6.6-3.1-2-3.6 1.6.2 3-.3 3.6-1.6.4-.8 1-5.3 1-7 0-1.6-.5-2.8-2.2-2.2-2.5.9-5.9 4-7.3 7.1Z"/>',
    doc: '<path d="M6 3h8l4 4v14H6Z"/><path d="M14 3v4h4"/><path d="M9 12h6M9 16h6"/>',
    terminal: '<rect x="2.5" y="4.5" width="19" height="15" rx="2.5"/><path d="M7 10l2.5 2L7 14M12.5 15h4.5"/>',
    play: '<path d="M7 4.5 19 12 7 19.5Z"/>',
    pause: '<path d="M8 4.5v15M16 4.5v15"/>',
    stop: '<rect x="5.5" y="5.5" width="13" height="13" rx="2"/>',
    redo: '<path d="M20 5v5h-5"/><path d="M19.4 10a8 8 0 1 0-2.6 8.4"/>',
    down: '<path d="M12 3v12"/><path d="M7.5 11 12 15.5 16.5 11"/><path d="M4 20h16"/>',
    check: '<path d="M4.5 12.5 9.5 17.5 19.5 6.5"/>',
    x: '<path d="M6 6l12 12M18 6 6 18"/>',
    sound: '<path d="M4 9.5h3.5L12 5.5v13L7.5 14.5H4Z"/><path d="M16 9a4.5 4.5 0 0 1 0 6"/><path d="M18.8 6.4a8 8 0 0 1 0 11.2"/>',
    mute: '<path d="M4 9.5h3.5L12 5.5v13L7.5 14.5H4Z"/><path d="M16.5 9.5l5 5M21.5 9.5l-5 5"/>',
    image: '<rect x="3" y="4.5" width="18" height="15" rx="2.5"/><circle cx="8.5" cy="10" r="1.8"/><path d="M3.5 17 9 12l4 3.5 3-2.5 4.5 4"/>',
    bolt: '<path d="M13.5 2.5 5 13.5h5.5L9.5 21.5 19 10.5h-5.5Z"/>',
    trash: '<path d="M4 7h16"/><path d="M9 7V4.5h6V7"/><path d="M6 7l1 13h10l1-13"/><path d="M10 11v6M14 11v6"/>',
    eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z"/><circle cx="12" cy="12" r="3"/>',
    copy: '<rect x="8.5" y="8.5" width="12" height="12" rx="2"/><path d="M15.5 5.5h-9a2 2 0 0 0-2 2v9"/>',
    shield: '<path d="M12 3 5 5.5v6c0 4.5 3 7.6 7 9.5 4-1.9 7-5 7-9.5v-6Z"/><path d="M9.5 12l2 2 3.5-4"/>',
    clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>'
  };

  function svg(name, size) {
    const d = P[name] || P.claw;
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"' +
      (size ? ' width="' + size + '" height="' + size + '"' : '') + ' aria-hidden="true">' + d + '</svg>';
  }

  /* Logomark: capit penyambar di dalam bidang miring. */
  const MARK = '<svg class="mark" viewBox="0 0 64 64" aria-label="Grabo">' +
    '<defs><linearGradient id="gbg" x1="0" y1="0" x2="1" y2="1">' +
    '<stop offset="0" stop-color="#ff2e88"/><stop offset=".55" stop-color="#8b5cff"/><stop offset="1" stop-color="#00e5ff"/>' +
    '</linearGradient></defs>' +
    '<rect x="3" y="3" width="58" height="58" rx="16" fill="#0b0611" stroke="url(#gbg)" stroke-width="3"/>' +
    '<path d="M18 17v12a14 14 0 0 0 28 0V17" fill="none" stroke="url(#gbg)" stroke-width="5" stroke-linecap="round"/>' +
    '<path d="M32 43v8" stroke="#c6ff3d" stroke-width="5" stroke-linecap="round"/>' +
    '<circle cx="32" cy="54" r="3.4" fill="#c6ff3d"/>' +
    '</svg>';

  root.GBIcons = { svg, paths: P, MARK };
})(globalThis);