// twin.js — daily-run module (2026-11-26): Twin, a stereo dual filter in the spirit of the new wave of stereo
// "two filters in one panel" designs (inspired by the ThreeTom Super Stereo MS-22 news). Each side has a 12 or 24 dB
// filter (LP, BP, HP, a high-pass into low-pass BAND, or NOTCH), Spread pulls the two cutoffs apart for width, Motion
// drifts them in opposite directions, Env opens them with the input's loudness, and Drive warms the input. The
// resonance is capped below self-oscillation and the cutoff is kept out of the shrill top octave on purpose.
'use strict';
const Twin = (() => {
  const E = Engine, ctx = E.ctx, { clamp } = DSP, M = E.Module;
  const now = () => ctx.currentTime, PI = Math.PI;
  const pct = v => Math.round(v * 100) + '%';
  const hz = v => v < 1000 ? Math.round(v) + 'Hz' : (v / 1000).toFixed(1) + 'k';
  const gain = (v = 1) => { const g = ctx.createGain(); g.gain.value = v; return g; };
  const smooth = (p, v, tc = 0.03) => { p.cancelScheduledValues(now()); p.setTargetAtTime(v, now(), tc); };
  const MODES = ['LP', 'BP', 'HP', 'BAND', 'NOTCH'];
  const POLES = ['12dB', '24dB'];
  const CUT_MAX = 9000; // keep the filter out of the top octave (no shrill peaks)

  function TwinMod(id) {
    const m = new M(id, { name: 'Twin', sub: 'stereo dual filter · spread · motion · env', width: 330, stripe: '#4fb3a9' });
    m.family = 'fx';
    const inp = gain(1); inp.channelCount = 2; inp.channelCountMode = 'explicit'; inp.channelInterpretation = 'speakers';
    const dry = gain(0), wet = gain(1), out = gain(1), tap = ctx.createAnalyser(); tap.fftSize = 1024; tap.smoothingTimeConstant = 0.7;
    const sp = ctx.createChannelSplitter(2), mg = ctx.createChannelMerger(2);
    const curve = k => { const n = 1024, c = new Float32Array(n); for (let i = 0; i < n; i++) { const x = i / (n - 1) * 2 - 1; c[i] = Math.tanh(x * k) / Math.tanh(k); } return c; };
    const pre = gain(1), sat = ctx.createWaveShaper(); sat.oversample = '2x'; sat.curve = curve(1.2);
    inp.connect(dry); dry.connect(out); inp.connect(pre); pre.connect(sat); sat.connect(sp);
    // modulation of both sides' detune (cents): Motion LFO (opposite phase on each side) and the envelope follower
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.08; lfo.start();
    const lfoL = gain(0), lfoR = gain(0); lfo.connect(lfoL); lfo.connect(lfoR);
    const env = FX.follower(inp, 10), envG = gain(0); env.connect(envG);
    const sides = [0, 1].map(c => {
      const a = ctx.createBiquadFilter(), b = ctx.createBiquadFilter(), comp = gain(1);
      sp.connect(a, c); a.connect(b); b.connect(comp); comp.connect(mg, 0, c);
      [a, b].forEach(f => { (c ? lfoR : lfoL).connect(f.detune); envG.connect(f.detune); });
      return { a, b, comp };
    });
    mg.connect(wet); wet.connect(out); out.connect(tap);
    m.tap = tap;
    m.cut = [0, 0];
    const set = () => {
      if (!m.params.mode || !m.params.poles || !m.params.cutoff || !m.params.spread || !m.params.res || !m.params.hp) return;
      const mode = m.params.mode.choice, two = m.params.poles.choice === '24dB', fc = m.v('cutoff'), spr = m.v('spread'), r = m.v('res');
      const q = 0.6 + r * r * 7.5; // capped well below a screaming self-oscillation
      sides.forEach((s, c) => {
        const f = clamp(fc * Math.pow(2, (c ? 1 : -1) * spr * 0.75), 30, CUT_MAX); m.cut[c] = f;
        const t = { LP: 'lowpass', BP: 'bandpass', HP: 'highpass', BAND: 'highpass', NOTCH: 'notch' }[mode];
        s.a.type = t;
        if (mode === 'BAND') { s.b.type = 'lowpass'; smooth(s.a.frequency, clamp(m.v('hp') * Math.pow(2, (c ? 1 : -1) * spr * 0.4), 20, CUT_MAX)); smooth(s.b.frequency, f); smooth(s.b.Q, q); smooth(s.a.Q, 0.7); }
        else {
          smooth(s.a.frequency, f); smooth(s.a.Q, two ? 0.54 + r * 0.6 : q);
          if (two) { s.b.type = t === 'notch' ? 'allpass' : t; smooth(s.b.frequency, f); smooth(s.b.Q, q); }
          else { s.b.type = 'allpass'; smooth(s.b.frequency, 20000); smooth(s.b.Q, 0.0001); }
        }
        // resonance and band modes lose level: make it up so the AI's mix stays put
        const make = (mode === 'BP' ? 2.2 : mode === 'BAND' ? 1.25 : mode === 'HP' ? 1.3 : 1) / (1 + r * 0.9);
        smooth(s.comp.gain, make);
      });
    };
    m.p('mode', { label: 'Mode', steps: MODES, def: 0, apply: set });
    m.p('poles', { label: 'Slope', steps: POLES, def: 1, apply: set });
    m.p('cutoff', { label: 'Cutoff', min: 60, max: CUT_MAX, curve: 'exp', def: 0.62, fmt: hz, apply: set });
    m.p('hp', { label: 'Low cut', min: 20, max: 2000, curve: 'exp', def: 0.25, fmt: hz, apply: set });
    m.p('res', { label: 'Reso', def: 0.25, fmt: pct, apply: set });
    m.p('spread', { label: 'Spread', def: 0.3, fmt: v => '±' + (v * 0.75).toFixed(2) + ' oct', apply: set });
    m.p('motion', { label: 'Motion', def: 0.2, fmt: pct, apply: v => { smooth(lfoL.gain, v * 900); smooth(lfoR.gain, -v * 900); } });
    m.p('rate', { label: 'Rate', min: 0.02, max: 2, curve: 'exp', def: 0.3, fmt: v => v.toFixed(2) + 'Hz', apply: v => smooth(lfo.frequency, v) });
    m.p('env', { label: 'Env', min: -1, max: 1, def: 0.5, fmt: v => (v >= 0 ? '+' : '') + Math.round(v * 100) + '%', apply: v => smooth(envG.gain, v * 2400) });
    m.p('drive', { label: 'Drive', min: 0.5, max: 3, curve: 'exp', def: 0.3, fmt: v => v.toFixed(1) + '×', apply: v => { smooth(pre.gain, v); } });
    m.p('mix', { label: 'Mix', def: 1, fmt: pct, apply: v => { smooth(dry.gain, Math.cos(v * PI / 2)); smooth(wet.gain, Math.sin(v * PI / 2)); } });
    m.inAudio('IN', inp, 'audio in (mono or stereo)');
    m.outAudio('OUT', out, 'stereo filtered out');
    m.layout = [{ custom: 'twin' }, { k: ['mode', 'poles', 'cutoff', 'hp', 'res', 'spread', 'motion', 'rate', 'env', 'drive', 'mix'], cls: 'kgrid' }];
    set();
    return m;
  }
  Mods.TYPES.Twin = { label: 'Twin stereo filter', desc: 'stereo dual filter: LP BP HP BAND(HP into LP) NOTCH, 12/24dB, Spread pulls the left and right cutoffs apart, Motion drifts them in opposite directions, Env opens them with loudness; insert on a voice or a bus for width and movement', prefix: 'twin', fx: true, make: id => TwinMod(id) };

  // panel: the two response curves (left teal, right amber) over the live spectrum
  UI.customs.twin = (m, el) => {
    const c = UI.h('canvas', 'scr'); el.append(c);
    let cx = null; const spec = new Uint8Array(m.tap.frequencyBinCount);
    const N = 96, fr = new Float32Array(N);
    for (let i = 0; i < N; i++) fr[i] = 30 * Math.pow(16000 / 30, i / (N - 1));
    UI.anim(() => {
      if (!cx) cx = UI.fitCanvas(c, 66);
      const { g, w, h: H } = cx; g.clearRect(0, 0, w, H);
      m.tap.getByteFrequencyData(spec);
      g.fillStyle = '#4fb3a92a';
      for (let x = 0; x < w; x += 2) { const f = 30 * Math.pow(16000 / 30, x / w), i = Math.min(spec.length - 1, Math.round(f / (ctx.sampleRate / 2) * spec.length)); const y = spec[i] / 255 * H; g.fillRect(x, H - y, 2, y); }
      ['#7fe6da', '#ffb85c'].forEach((col, side) => {
        g.strokeStyle = col; g.lineWidth = 1.5; g.beginPath();
        const f = m.cut[side] || 1000, q = 0.6 + m.v('res') ** 2 * 7.5, mode = m.params.mode.choice;
        for (let i = 0; i < N; i++) {
          const r = fr[i] / f; let a;
          if (mode === 'HP') a = r * r / Math.sqrt((1 - r * r) ** 2 + (r / q) ** 2);
          else if (mode === 'BP' || mode === 'BAND') a = (r / q) / Math.sqrt((1 - r * r) ** 2 + (r / q) ** 2) * (mode === 'BAND' ? 1.2 : 1);
          else if (mode === 'NOTCH') a = Math.abs(1 - r * r) / Math.sqrt((1 - r * r) ** 2 + (r / q) ** 2);
          else a = 1 / Math.sqrt((1 - r * r) ** 2 + (r / q) ** 2);
          if (m.params.poles.choice === '24dB' && mode !== 'NOTCH' && mode !== 'BAND') a = a * a / Math.max(1, q * 0.6);
          const x = i / (N - 1) * w, y = H * 0.62 - Math.log2(Math.max(1e-3, a)) * H * 0.08;
          i ? g.lineTo(x, clamp(y, 2, H - 2)) : g.moveTo(x, clamp(y, 2, H - 2));
        }
        g.stroke();
      });
      g.fillStyle = '#d8f5f1'; g.font = '10px "JetBrains Mono", monospace';
      g.fillText(`${m.params.mode.choice} ${m.params.poles.choice} · L ${hz(m.cut[0])} R ${hz(m.cut[1])}`, 4, 11);
    });
  };
  return { TwinMod, MODES };
})();
