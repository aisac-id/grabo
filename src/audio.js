/* Grabo — suara antarmuka.
 * WebAudio murni, tanpa berkas audio. Aktif secara bawaan, satu tombol bisu. */
(function (root) {
  'use strict';

  let ctx = null;
  let master = null;
  let enabled = true;
  let volume = 0.5;

  function ac() {
    if (!ctx) {
      const AC = root.AudioContext || root.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = volume;
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -14;
      comp.ratio.value = 6;
      master.connect(comp);
      comp.connect(ctx.destination);
    }
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    return ctx;
  }

  function env(node, t, a, d, peak) {
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
    node.connect(g);
    g.connect(master);
    return g;
  }

  function tone(freq, t, dur, type, peak, glide) {
    const o = ctx.createOscillator();
    o.type = type || 'sine';
    o.frequency.setValueAtTime(freq, t);
    if (glide) o.frequency.exponentialRampToValueAtTime(Math.max(20, glide), t + dur);
    env(o, t, Math.min(0.02, dur * 0.2), dur, peak == null ? 0.22 : peak);
    o.start(t);
    o.stop(t + dur + 0.06);
    return o;
  }

  function noise(t, dur, peak, freq, q) {
    const len = Math.ceil(ctx.sampleRate * dur);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = freq || 1800;
    bp.Q.value = q || 1.2;
    src.connect(bp);
    env(bp, t, 0.005, dur, peak == null ? 0.16 : peak);
    src.start(t);
    return src;
  }

  const cues = {
    /* tarikan pendek: sesuatu tersambar */
    grab(t) { noise(t, 0.09, 0.13, 2600, 0.9); tone(520, t, 0.1, 'triangle', 0.16, 880); },
    tick(t) { tone(1320, t, 0.035, 'square', 0.05); },
    tab(t) { tone(660, t, 0.06, 'sine', 0.1, 990); noise(t, 0.05, 0.05, 3200, 2); },
    scan(t) {
      for (let i = 0; i < 4; i++) tone(440 + i * 180, t + i * 0.055, 0.07, 'triangle', 0.08);
      noise(t, 0.22, 0.07, 1400, 0.7);
    },
    found(t) { tone(880, t, 0.07, 'sine', 0.12); tone(1320, t + 0.05, 0.09, 'sine', 0.09); },
    enqueue(t) { tone(300, t, 0.09, 'sawtooth', 0.09, 460); noise(t, 0.06, 0.06, 900, 1.4); },
    start(t) { [392, 523, 659].forEach((f, i) => tone(f, t + i * 0.07, 0.16, 'triangle', 0.13)); },
    done(t) { [659, 880, 1175].forEach((f, i) => tone(f, t + i * 0.06, 0.2, 'sine', 0.13)); noise(t + 0.02, 0.12, 0.05, 4200, 2); },
    file(t) { tone(1046, t, 0.05, 'sine', 0.07); },
    skip(t) { tone(420, t, 0.09, 'sine', 0.08, 300); },
    fail(t) { tone(220, t, 0.18, 'sawtooth', 0.11, 130); noise(t, 0.14, 0.07, 500, 0.8); },
    pause(t) { tone(520, t, 0.1, 'sine', 0.1, 330); },
    open(t) { tone(330, t, 0.14, 'sine', 0.11, 660); noise(t, 0.1, 0.05, 2200, 1); },
    close(t) { tone(660, t, 0.12, 'sine', 0.09, 300); },
    folder(t) { [523, 784].forEach((f, i) => tone(f, t + i * 0.08, 0.18, 'triangle', 0.12)); },
    toggle(t) { tone(760, t, 0.045, 'square', 0.06); }
  };

  function play(name) {
    if (!enabled) return false;
    const c = ac();
    if (!c) return false;
    const fn = cues[name] || cues.tick;
    try { fn(c.currentTime + 0.005); return true; } catch (e) { return false; }
  }

  root.GBSound = {
    play,
    setEnabled(v) { enabled = !!v; if (enabled) ac(); },
    get enabled() { return enabled; },
    setVolume(v) { volume = Math.max(0, Math.min(1, v)); if (master) master.gain.value = volume; },
    get volume() { return volume; },
    unlock() { ac(); },
    names: Object.keys(cues)
  };
})(globalThis);