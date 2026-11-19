// dsp.js — pure helpers: wave tables, shaper curves, noise, physical-model renderers, music theory.
'use strict';
const DSP = (() => {
  const TAU = Math.PI * 2;
  const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
  const lerp = (a, b, t) => a + (b - a) * t;
  const mtof = m => 440 * Math.pow(2, (m - 69) / 12);

  // Build a PeriodicWave from one cycle of samples via a plain DFT.
  function waveFromFn(ctx, fn, harmonics = 96, n = 1024) {
    const buf = new Float32Array(n);
    for (let i = 0; i < n; i++) buf[i] = fn(i / n);
    const real = new Float32Array(harmonics + 1), imag = new Float32Array(harmonics + 1);
    for (let k = 1; k <= harmonics; k++) {
      let re = 0, im = 0;
      for (let i = 0; i < n; i++) { const a = TAU * k * i / n; re += buf[i] * Math.cos(a); im += buf[i] * Math.sin(a); }
      real[k] = 2 * re / n; imag[k] = 2 * im / n;
    }
    return ctx.createPeriodicWave(real, imag);
  }

  // single-cycle shapes, phase p in [0,1)
  const shapes = {
    saw: p => 1 - 2 * p,
    square: p => (p < 0.5 ? 1 : -1),
    pulse: d => p => (p < d ? 1 : -1),
    tri: p => (p < 0.5 ? 4 * p - 1 : 3 - 4 * p),
    tri4: p => { const t = p < 0.5 ? 4 * p - 1 : 3 - 4 * p; return Math.round(t * 7.5) / 7.5; },
    sine: p => Math.sin(TAU * p),
    fm: idx => p => Math.sin(TAU * p + idx * Math.sin(TAU * p * 2)),
    fold: amt => p => Math.sin(Math.sin(TAU * p) * amt * Math.PI / 2),
    sync: r => p => 1 - 2 * ((p * r) % 1),
    formant: center => p => { let s = 0; for (let k = 1; k < 40; k++) { const w = Math.exp(-Math.pow((k - center) / (center * 0.35 + 1.2), 2)); s += w * Math.sin(TAU * k * p); } return s * 0.6; },
    supersaw: p => (1 - 2 * p) * 0.6 + (1 - 2 * ((p * 2.003) % 1)) * 0.25 + (1 - 2 * ((p * 0.997 * 3) % 1)) * 0.15,
    slope: (r, curve) => p => { // asymmetric triangle 0..1 for function generator
      let y = p < r ? p / Math.max(r, 1e-4) : 1 - (p - r) / Math.max(1 - r, 1e-4);
      if (curve > 0) y = Math.pow(y, 1 + curve * 3); else if (curve < 0) y = 1 - Math.pow(1 - y, 1 - curve * 3);
      return y * 2 - 1;
    }
  };

  // Wavetables for the dubstep synth: each has an A (pos 0) and B (pos 1) frame.
  const TABLES = [
    { name: 'SAW→SQR', a: shapes.saw, b: shapes.square },
    { name: 'GROWL', a: shapes.fm(1.2), b: shapes.fm(7) },
    { name: 'YOI', a: shapes.formant(3), b: shapes.formant(13) },
    { name: 'METAL', a: shapes.fold(1.2), b: shapes.fold(6) },
    { name: 'SYNC', a: shapes.sync(1.0), b: shapes.sync(3.7) },
    { name: 'SUPER', a: shapes.supersaw, b: shapes.pulse(0.12) }
  ];

  function curveTanh(amount) {
    const n = 2048, c = new Float32Array(n), k = 1 + amount * 30;
    for (let i = 0; i < n; i++) { const x = i / (n - 1) * 2 - 1; c[i] = Math.tanh(k * x) / Math.tanh(k); }
    return c;
  }
  function curveHard(amount) {
    const n = 2048, c = new Float32Array(n), k = 1 + amount * 60;
    for (let i = 0; i < n; i++) { const x = i / (n - 1) * 2 - 1; c[i] = clamp(x * k, -1, 1) * 0.9 + Math.tanh(x * k) * 0.1; }
    return c;
  }
  function curveFold(stages) {
    const n = 4096, c = new Float32Array(n);
    for (let i = 0; i < n; i++) { const x = i / (n - 1) * 2 - 1; c[i] = Math.sin(x * stages * Math.PI / 2); }
    return c;
  }
  function curveCrush(bits) {
    const n = 4096, c = new Float32Array(n), q = Math.pow(2, bits - 1);
    for (let i = 0; i < n; i++) { const x = i / (n - 1) * 2 - 1; c[i] = Math.round(x * q) / q; }
    return c;
  }

  function noiseBuffer(ctx, seconds = 2) {
    const len = ctx.sampleRate * seconds, b = ctx.createBuffer(1, len, ctx.sampleRate), d = b.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return b;
  }
  // 15-bit LFSR noise like an 8-bit sound chip; mode 'short' gives metallic periodic noise
  function lfsrBuffer(ctx, short) {
    const len = 32767 * 2, b = ctx.createBuffer(1, len, ctx.sampleRate), d = b.getChannelData(0);
    let r = 1;
    for (let i = 0; i < len; i++) {
      const bit = (r ^ (r >> (short ? 6 : 1))) & 1; r = (r >> 1) | (bit << 14);
      d[i] = (r & 1) ? 0.8 : -0.8;
    }
    return b;
  }
  function impulse(ctx, seconds = 2.8, decay = 2.6) {
    const len = Math.floor(ctx.sampleRate * seconds), b = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = b.getChannelData(ch);
      let lp = 0;
      for (let i = 0; i < len; i++) {
        const t = i / len; lp = lp * 0.6 + (Math.random() * 2 - 1) * 0.4;
        d[i] = lp * Math.pow(1 - t, decay) * (i < 200 ? i / 200 : 1);
      }
    }
    return b;
  }

  // ---------- Physical models, rendered per note to an AudioBuffer ----------
  const MODAL = {
    BELL: [1, 2.0, 2.42, 3.0, 4.5, 5.33, 6.8, 8.2],
    MARIMBA: [1, 3.99, 10.65, 2.0],
    MEMBRANE: [1, 1.594, 2.136, 2.296, 2.653, 2.918, 3.156, 3.501],
    GLASS: [1, 2.32, 4.25, 6.63, 9.38]
  };
  const PM_MODELS = ['STRING', 'BELL', 'MARIMBA', 'MEMBRANE', 'GLASS', 'TUBE'];
  const pmCache = new Map();
  function renderPM(ctx, model, freq, p) {
    // p: {bright, decay, pos, struct, damp}
    const key = [model, freq.toFixed(1), p.bright.toFixed(2), p.decay.toFixed(2), p.pos.toFixed(2), p.struct.toFixed(2), p.damp.toFixed(2)].join('|');
    if (pmCache.has(key)) return pmCache.get(key);
    const sr = ctx.sampleRate;
    const secs = 0.4 + p.decay * 3.6;
    const len = Math.floor(sr * secs);
    const buf = ctx.createBuffer(1, len, sr), out = buf.getChannelData(0);
    if (model === 'STRING' || model === 'TUBE') {
      const period = sr / freq, N = Math.max(2, Math.floor(period)), frac = period - N;
      const line = new Float32Array(N + 2);
      // excitation: noise, filtered by brightness, with pick-position comb
      let lp = 0; const bc = 0.15 + p.bright * 0.85;
      for (let i = 0; i < N + 2; i++) { lp = lp + bc * ((Math.random() * 2 - 1) - lp); line[i] = lp; }
      const pk = Math.max(1, Math.floor(N * (0.05 + p.pos * 0.45)));
      for (let i = N + 1; i >= pk; i--) line[i] -= line[i - pk] * 0.9;
      const loss = 0.990 + p.decay * 0.0099 - p.damp * 0.01;
      const s = 0.5 - (p.bright * 0.42) + 0.0;
      const sign = model === 'TUBE' ? -1 : 1;
      let idx = 0, prev = 0;
      for (let i = 0; i < len; i++) {
        const a = line[idx], b = line[(idx + 1) % (N + 1)];
        let y = a * (1 - frac) + b * frac;
        const filt = (1 - s) * y + s * prev; prev = y;
        let fb = sign * filt * loss;
        if (model === 'TUBE') fb += (Math.random() * 2 - 1) * 0.004 * (1 - i / len) * (1 + p.struct * 4);
        line[idx] = fb;
        out[i] = y;
        idx = (idx + 1) % (N + 1);
      }
    } else {
      const ratios = MODAL[model];
      const parts = ratios.map((r, k) => {
        const inh = 1 + p.struct * 0.08 * k * k * 0.1;
        const f = freq * r * inh;
        const amp = Math.pow(0.62 + p.bright * 0.35, k) * (1 - 0.6 * Math.abs(Math.sin(Math.PI * (k + 1) * (0.1 + p.pos * 0.4))));
        const dec = (0.15 + p.decay * 3.4) / (1 + k * (0.6 + p.damp * 2.5)) * (model === 'GLASS' ? 1.6 : 1);
        return { w: TAU * f / sr, amp, d: Math.exp(-1 / (dec * sr)) };
      }).filter(o => o.w < Math.PI * 0.95);
      for (const o of parts) {
        let env = o.amp, ph = Math.random() * TAU;
        for (let i = 0; i < len; i++) { out[i] += Math.sin(ph + o.w * i) * env; env *= o.d; }
      }
      // strike transient
      const tl = Math.floor(sr * 0.006 * (1.5 - p.bright));
      for (let i = 0; i < tl && i < len; i++) out[i] += (Math.random() * 2 - 1) * (1 - i / tl) * 0.5 * p.bright;
    }
    // normalise and fade out
    let pk = 0; for (let i = 0; i < len; i++) pk = Math.max(pk, Math.abs(out[i]));
    const g = pk > 0 ? 0.8 / pk : 1, fl = Math.floor(sr * 0.05);
    for (let i = 0; i < len; i++) out[i] *= g * (i > len - fl ? (len - i) / fl : 1);
    if (pmCache.size > 160) pmCache.delete(pmCache.keys().next().value);
    pmCache.set(key, buf);
    return buf;
  }

  // ---------- Music theory ----------
  const SCALES = {
    MINOR: [0, 2, 3, 5, 7, 8, 10], MAJOR: [0, 2, 4, 5, 7, 9, 11], PHRYG: [0, 1, 3, 5, 7, 8, 10],
    DORIAN: [0, 2, 3, 5, 7, 9, 10], PENT: [0, 3, 5, 7, 10], BLUES: [0, 3, 5, 6, 7, 10],
    HARM: [0, 2, 3, 5, 7, 8, 11], CHROM: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], WHOLE: [0, 2, 4, 6, 8, 10]
  };
  const SCALE_NAMES = Object.keys(SCALES);
  const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  function degreeToSemi(scale, deg) {
    const s = SCALES[scale] || SCALES.MINOR, n = s.length;
    const o = Math.floor(deg / n), i = ((deg % n) + n) % n;
    return s[i] + 12 * o;
  }

  return { TAU, clamp, lerp, mtof, waveFromFn, shapes, TABLES, curveTanh, curveHard, curveFold, curveCrush, noiseBuffer, lfsrBuffer, impulse, PM_MODELS, renderPM, SCALES, SCALE_NAMES, NOTE_NAMES, degreeToSemi };
})();
