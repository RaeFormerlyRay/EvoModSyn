// fx.js — the effects rack: reverb, tape echo, ensemble, phaser, drive/crusher, frequency shifter, sympathetic
// resonator, vowel filter, pump/OTT dynamics, stutter/glitch, pitch-shift harmonizer, cassette and a chaotic
// feedback delay network. Every effect has an audio IN and OUT and a Mix knob; any knob can also be modulated by
// dropping a cable from an LFO onto it.
'use strict';
const FX = (() => {
  const E = Engine, ctx = E.ctx, { clamp } = DSP, M = E.Module;
  const now = () => ctx.currentTime, rnd = Math.random, PI = Math.PI;
  const pct = v => Math.round(v * 100) + '%';
  const secs = v => v < 1 ? Math.round(v * 1000) + 'ms' : v.toFixed(2) + 's';
  const hz = v => Math.abs(v) < 1000 ? Math.round(v) + 'Hz' : (v / 1000).toFixed(1) + 'k';
  const bip = v => (v >= 0 ? '+' : '') + Math.round(v * 100) + '%';
  const gain = (v = 1) => { const g = ctx.createGain(); g.gain.value = v; return g; };
  const constSrc = (v = 0) => { const c = ctx.createConstantSource(); c.offset.value = v; c.start(); return c; };
  const filt = (type, f, q) => { const b = ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; if (q != null) b.Q.value = q; return b; };
  const smooth = (param, v, tc = 0.02) => { param.cancelScheduledValues(now()); param.setTargetAtTime(v, now(), tc); };
  const shaper = (curve, os = '4x') => { const s = ctx.createWaveShaper(); s.curve = curve; s.oversample = os; return s; };
  const stereo = () => { const g = gain(1); g.channelCount = 2; g.channelCountMode = 'explicit'; g.channelInterpretation = 'speakers'; return g; };
  // sine oscillator with a phase offset (radians); all of these started together stay phase-locked
  const waves = new Map();
  const phaseWave = ph => { const k = Math.round(ph * 100); if (!waves.has(k)) waves.set(k, ctx.createPeriodicWave(new Float32Array([0, Math.sin(ph)]), new Float32Array([0, Math.cos(ph)]), { disableNormalization: true })); return waves.get(k); };
  const lfoOsc = (ph = 0, freqSrc) => { const o = ctx.createOscillator(); o.setPeriodicWave(phaseWave(ph)); o.frequency.value = 0; if (freqSrc) freqSrc.connect(o.frequency); o.start(); return o; };
  const curveOf = (fn, n = 4096) => { const c = new Float32Array(n); for (let i = 0; i < n; i++) c[i] = fn(i / (n - 1) * 2 - 1); return c; };
  const ABS = curveOf(x => 1 - Math.exp(-4 * Math.abs(x)), 1025); // full-wave rectifier, gently compressed into 0..1
  // envelope follower: audio in → 0..1 control signal
  const follower = (src, hzCut = 8) => { const r = shaper(ABS, 'none'), lp = filt('lowpass', hzCut, 0.5); src.connect(r); r.connect(lp); return lp; };
  const memo = new Map();
  const memoCurve = (key, fn) => { if (!memo.has(key)) { if (memo.size > 400) memo.clear(); memo.set(key, fn()); } return memo.get(key); };

  // tempo-synced times, in beats
  const SYNC = [['1/64', 1 / 16], ['1/32', 1 / 8], ['1/16T', 1 / 6], ['1/16', 1 / 4], ['1/8T', 1 / 3], ['1/16.', 3 / 8], ['1/8', 1 / 2], ['1/4T', 2 / 3], ['1/8.', 3 / 4], ['1/4', 1], ['1/2T', 4 / 3], ['1/4.', 1.5], ['1/2', 2], ['1/2.', 3], ['1 BAR', 4], ['2 BAR', 8], ['4 BAR', 16], ['8 BAR', 32]];
  const syncIx = (n, lo = 0, hi = SYNC.length - 1) => lo + Math.round(clamp(n) * (hi - lo));
  const spb = () => 60 / E.bpm;

  // ---------- shared building blocks ----------
  // Dry/wet shell: IN, OUT, Mix knob, and a tap the panel display reads
  function shell(m, mixDef = 0.5, opts = {}) {
    const inp = stereo(), dry = gain(1), wet = gain(0), out = gain(1), tap = ctx.createAnalyser();
    tap.fftSize = 1024; tap.smoothingTimeConstant = 0.7;
    inp.connect(dry); dry.connect(out); wet.connect(out); out.connect(tap);
    if (opts.mix !== false) m.p('mix', { label: 'Mix', def: mixDef, fmt: pct, apply: v => { smooth(dry.gain, Math.cos(v * PI / 2)); smooth(wet.gain, Math.sin(v * PI / 2)); } });
    else { dry.gain.value = 0; wet.gain.value = 1; }
    m.inAudio('IN', inp, 'audio in'); m.outAudio('OUT', out, 'effect out');
    m.tap = tap; m.family = 'fx';
    return { inp, dry, wet, out };
  }
  // Doppler pitch shifter: two delay taps swept by a ramp and cross-faded by sin² windows (Web Audio nodes only)
  function pitchShifter(W = 0.06) {
    const N = 4096, sr = ctx.sampleRate, b = ctx.createBuffer(4, N, sr), d = [0, 1, 2, 3].map(c => b.getChannelData(c));
    for (let i = 0; i < N; i++) { const p = i / N, q = (p + 0.5) % 1; d[0][i] = p; d[1][i] = Math.sin(PI * p) ** 2; d[2][i] = q; d[3][i] = Math.sin(PI * q) ** 2; }
    const src = ctx.createBufferSource(); src.buffer = b; src.loop = true; src.playbackRate.value = 0; src.start();
    const sp = ctx.createChannelSplitter(4); src.connect(sp);
    const inp = gain(1), out = gain(1);
    const taps = [0, 1].map(k => { const dl = ctx.createDelay(1), rg = gain(0), win = gain(0); dl.delayTime.value = 0.005; sp.connect(rg, 2 * k); rg.connect(dl.delayTime); sp.connect(win.gain, 2 * k + 1); inp.connect(dl); dl.connect(win); win.connect(out); return { dl, rg }; });
    let cur = 1;
    const set = r => {
      if (Math.abs(r - cur) < 1e-4) return; cur = r; const t = now();
      if (Math.abs(r - 1) < 1e-3) { src.playbackRate.setTargetAtTime(0, t, 0.02); taps.forEach(x => { x.rg.gain.setTargetAtTime(0, t, 0.02); x.dl.delayTime.setTargetAtTime(0.005, t, 0.02); }); return; }
      src.playbackRate.setTargetAtTime(Math.abs(r - 1) / W * N / sr, t, 0.02);
      taps.forEach(x => { if (r > 1) { x.dl.delayTime.setTargetAtTime(W + 0.002, t, 0.02); x.rg.gain.setTargetAtTime(-W, t, 0.02); } else { x.dl.delayTime.setTargetAtTime(0.002, t, 0.02); x.rg.gain.setTargetAtTime(W, t, 0.02); } });
    };
    return { inp, out, set };
  }
  // Sample-rate reducer: a delay whose time follows a sawtooth with slope 1 holds each sample (zero-order hold)
  function decimator() {
    const N = 512, sr = ctx.sampleRate, b = ctx.createBuffer(1, N, sr), d = b.getChannelData(0);
    for (let i = 0; i < N; i++) d[i] = i / N;
    const src = ctx.createBufferSource(); src.buffer = b; src.loop = true; src.start();
    const inp = gain(1), out = gain(1), dl = ctx.createDelay(0.1), rg = gain(0), byp = gain(1), wetg = gain(0);
    dl.delayTime.value = 0; src.connect(rg); rg.connect(dl.delayTime);
    inp.connect(byp); byp.connect(out); inp.connect(dl); dl.connect(wetg); wetg.connect(out);
    const set = fs => {
      const on = fs < sr * 0.45; smooth(byp.gain, on ? 0 : 1, 0.01); smooth(wetg.gain, on ? 1 : 0, 0.01);
      if (on) { src.playbackRate.setTargetAtTime(fs * N / sr, now(), 0.01); rg.gain.setTargetAtTime(1 / fs, now(), 0.01); }
    };
    return { inp, out, set };
  }
  // stereo width: 0 = mono, 1 = as is, up to 1.5 = wider
  function widener() {
    const inp = stereo(), sp = ctx.createChannelSplitter(2), mg = ctx.createChannelMerger(2), ll = gain(1), lr = gain(0), rl = gain(0), rr = gain(1);
    inp.connect(sp); sp.connect(ll, 0); sp.connect(lr, 0); sp.connect(rr, 1); sp.connect(rl, 1);
    ll.connect(mg, 0, 0); rl.connect(mg, 0, 0); rr.connect(mg, 0, 1); lr.connect(mg, 0, 1);
    const set = w => { const a = (1 + w) / 2, b = (1 - w) / 2; [ll, rr].forEach(g => smooth(g.gain, a)); [lr, rl].forEach(g => smooth(g.gain, b)); };
    return { inp, out: mg, set };
  }
  const iir = (ff, fb) => ctx.createIIRFilter(ff, fb);

  // ======================= HALLS: algorithmic-impulse reverb =======================
  const HALL_TYPES = ['PLATE', 'ROOM', 'HALL', 'CATHEDRAL', 'SPRING', 'BLOOM', 'REVERSE', 'GATED'];
  function makeIR(type, decay, size, damp) {
    const sr = ctx.sampleRate;
    let len = decay * 1.15 + 0.06;
    if (type === 'GATED') len = Math.min(0.12 + decay * 0.12, 0.9);
    if (type === 'REVERSE' || type === 'BLOOM') len = Math.min(decay, 7) + 0.05;
    len = Math.min(len, 14);
    const n = Math.floor(len * sr), buf = ctx.createBuffer(2, n, sr);
    const fc0 = 17000 - damp * 9000, fc1 = 300 + 7000 * (1 - damp) ** 2;
    const build = { PLATE: 0.002, ROOM: 0.004, HALL: 0.02 + size * 0.05, CATHEDRAL: 0.06 + size * 0.08, SPRING: 0.001, GATED: 0.003 }[type] || 0.003;
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch); let y = 0, a = 0;
      for (let i = 0; i < n; i++) {
        const t = i / sr, x = t / len;
        if ((i & 31) === 0) { const fc = fc0 * Math.pow(fc1 / fc0, Math.min(1, t / Math.max(0.2, decay))); a = 1 - Math.exp(-2 * PI * fc / sr); }
        let e;
        if (type === 'BLOOM') e = Math.pow(x, 1.6) * Math.pow(1 - x, 0.7) * 2.6;
        else if (type === 'REVERSE') e = Math.pow(x, 2.5) * Math.min(1, (1 - x) * len / 0.02);
        else if (type === 'GATED') e = (1 - Math.exp(-t / 0.003)) * Math.min(1, (1 - x) * len / 0.03);
        else e = Math.exp(-6.9 * t / decay) * (1 - Math.exp(-t / build));
        const w = rnd() * 2 - 1;
        y += a * (w - y);
        d[i] = y * e * (type === 'SPRING' ? 0.35 : 1);
      }
      // early reflections: sparse taps whose spacing grows with the room
      if (type === 'ROOM' || type === 'HALL' || type === 'CATHEDRAL') {
        const taps = type === 'ROOM' ? 14 : 10, sc = 0.4 + size * 1.6;
        for (let k = 0; k < taps; k++) { const tt = (0.004 + rnd() * 0.07) * sc * (type === 'CATHEDRAL' ? 1.8 : 1), i = Math.floor(tt * sr); if (i < n) d[i] += (rnd() < 0.5 ? -1 : 1) * 0.7 * Math.exp(-tt / 0.12); }
      }
      // spring: a train of dispersive chirps bouncing along the coil
      if (type === 'SPRING') {
        const Tp = 0.022 + size * 0.05 + ch * 0.003;
        for (let r = 0; r * Tp < len; r++) {
          const t0 = r * Tp, amp = Math.exp(-6.9 * t0 / decay) * 0.8, i0 = Math.floor(t0 * sr); let ph = 0;
          for (let j = 0; j < 0.035 * sr && i0 + j < n; j++) { const tau = j / sr, f = 180 + 3800 * Math.exp(-tau / 0.007); ph += 2 * PI * f / sr; d[i0 + j] += amp * Math.sin(ph) * Math.sin(PI * tau / 0.035); }
        }
      }
    }
    return buf;
  }
  function Halls(id) {
    const m = new M(id, { name: 'Halls', sub: 'algorithmic reverb · 8 spaces · shimmer', width: 360, stripe: '#9ec9ff' });
    const S = shell(m, 0.35);
    const hp = filt('highpass', 60, 0.7), pre = ctx.createDelay(1), convs = [ctx.createConvolver(), ctx.createConvolver()], cg = [gain(1), gain(0)], sum = gain(1);
    const tone = filt('lowpass', 9000, 0.5), cho = ctx.createDelay(0.05), choCS = constSrc(0.25), W = widener(), modG = gain(0);
    S.inp.connect(hp); hp.connect(pre); convs.forEach((c, i) => { pre.connect(c); c.connect(cg[i]); cg[i].connect(sum); });
    sum.connect(tone); tone.connect(cho); cho.connect(W.inp); W.out.connect(S.wet);
    cho.delayTime.value = 0.008; const lo = lfoOsc(0, choCS); lo.connect(modG); modG.connect(cho.delayTime);
    // shimmer: the tail, an octave up, fed back into the room
    const ps = pitchShifter(0.07), shimG = gain(0), shHp = filt('highpass', 400, 0.7); ps.set(2);
    sum.connect(ps.inp); ps.out.connect(shHp); shHp.connect(shimG); shimG.connect(pre);
    let live = 0, tmr = 0;
    const regen = () => { clearTimeout(tmr); tmr = setTimeout(() => {
      const ir = makeIR(m.params.type.choice, m.v('decay'), m.v('size'), m.v('damp'));
      const nx = 1 - live; convs[nx].buffer = ir; m.ir = ir;
      const t = now(); cg[nx].gain.setTargetAtTime(1, t + 0.03, 0.06); cg[live].gain.setTargetAtTime(0, t + 0.03, 0.06); live = nx;
      m.ui?.ir?.();
    }, m.ir ? 140 : 0); };
    m.p('type', { label: 'Space', steps: HALL_TYPES, def: 0, apply: regen });
    m.p('decay', { label: 'Decay', min: 0.2, max: 16, curve: 'exp', def: 0.52, fmt: secs, nomod: true, apply: regen });
    m.p('size', { label: 'Size', def: 0.5, fmt: pct, nomod: true, apply: regen });
    m.p('damp', { label: 'Damping', def: 0.45, fmt: pct, nomod: true, apply: regen });
    m.p('pre', { label: 'Pre-delay', min: 0, max: 0.25, def: 0.08, fmt: secs, apply: v => smooth(pre.delayTime, v, 0.05) });
    m.p('tone', { label: 'Tone', min: 800, max: 18000, curve: 'exp', def: 0.62, fmt: hz, apply: v => smooth(tone.frequency, v) });
    m.p('locut', { label: 'Low cut', min: 20, max: 1000, curve: 'exp', def: 0.35, fmt: hz, apply: v => smooth(hp.frequency, v) });
    m.p('mod', { label: 'Motion', def: 0.25, fmt: pct, apply: v => { smooth(modG.gain, v * 0.004); smooth(choCS.offset, 0.15 + v * 0.6); } });
    m.p('shim', { label: 'Shimmer', min: 0, max: 0.8, def: 0, fmt: pct, apply: v => smooth(shimG.gain, v) });
    m.p('width', { label: 'Width', min: 0, max: 1.5, def: 0.7, fmt: pct, apply: v => W.set(v) });
    m.layout = [{ custom: 'fxview' }, { k: ['type', 'decay', 'size', 'damp', 'pre', 'tone', 'locut', 'mod', 'shim', 'width', 'mix'], cls: 'kgrid' }];
    return m;
  }

  // ======================= ECHOES: tape / digital / ping-pong / multi-head / cloud delay =======================
  const ECHO_MODES = ['TAPE', 'DIGITAL', 'PINGPONG', 'MULTI', 'CLOUD'];
  function Echoes(id) {
    const m = new M(id, { name: 'Echoes', sub: 'tape · digital · ping-pong · multi-head · cloud', width: 380, stripe: '#ffcf6b' });
    const S = shell(m, 0.3);
    const inG = gain(1), dA = ctx.createDelay(4), dB = ctx.createDelay(4), hp = filt('highpass', 80, 0.7), lp = filt('lowpass', 5000, 0.6);
    const sat = shaper(curveOf(x => Math.tanh(x)), '2x'), drv = gain(1), undrv = gain(1);
    const aps = [430, 1020, 2300, 4100].map(f => filt('allpass', f, 0.5)), gD = gain(1), gAP = gain(0), proc = gain(1);
    const loopDirect = gain(1), toB = gain(0), fromB = gain(0), inB = gain(0), fbG = gain(0.4);
    const mg = ctx.createChannelMerger(2), pL = gain(1), pR = gain(1), bL = gain(0), bR = gain(0), duckG = gain(1);
    S.inp.connect(inG); inG.connect(dA); inG.connect(inB); inB.connect(dB);
    dA.connect(hp); hp.connect(lp); lp.connect(drv); drv.connect(sat); sat.connect(undrv); undrv.connect(gD); undrv.connect(aps[0]);
    for (let i = 0; i < 3; i++) aps[i].connect(aps[i + 1]); aps[3].connect(gAP); gD.connect(proc); gAP.connect(proc);
    proc.connect(loopDirect); loopDirect.connect(fbG); proc.connect(toB); toB.connect(dB); dB.connect(fromB); fromB.connect(fbG); fbG.connect(dA);
    proc.connect(pL); proc.connect(pR); dB.connect(bL); dB.connect(bR); pL.connect(mg, 0, 0); bL.connect(mg, 0, 0); pR.connect(mg, 0, 1); bR.connect(mg, 0, 1);
    mg.connect(duckG); duckG.connect(S.wet);
    // wow, flutter and slow drift on the tape heads
    const wow = gain(0), flut = gain(0), wo = lfoOsc(0, constSrc(0.55)), fo = lfoOsc(0, constSrc(7.1));
    wo.connect(wow); fo.connect(flut); [wow, flut].forEach(g => { g.connect(dA.delayTime); g.connect(dB.delayTime); });
    // ducking: the echoes step back while you play
    const env = follower(S.inp, 6), duckAmt = gain(0); env.connect(duckAmt); duckAmt.connect(duckG.gain);
    const tcv = m.inCV('TIME', [dA.delayTime, dB.delayTime], 0.02, 'delay time CV (warble)');
    const setTime = () => {
      const sync = m.v('sync') === 0, n = m.params.time.nm, md = m.params.mode.choice;
      let t = sync ? SYNC[syncIx(n, 1, 15)][1] * spb() : 0.02 * Math.pow(100, n);
      t = Math.min(3.8, Math.max(0.01, t)); m.secs = t;
      const tc = md === 'DIGITAL' ? 0.02 : 0.12;
      dA.delayTime.setTargetAtTime(t, now(), tc); dB.delayTime.setTargetAtTime(md === 'MULTI' ? Math.min(3.9, t * 1.5) : t, now(), tc);
    };
    const setMode = () => {
      const md = m.params.mode.choice, pp = md === 'PINGPONG', mu = md === 'MULTI';
      smooth(loopDirect.gain, pp ? 0 : 1); smooth(toB.gain, pp ? 1 : 0); smooth(fromB.gain, pp ? 1 : mu ? 0.5 : 0); smooth(inB.gain, mu && !m.v('freeze') ? 1 : 0);
      smooth(pR.gain, pp ? 0 : 1); smooth(bL.gain, mu ? 0.7 : 0); smooth(bR.gain, pp ? 1 : mu ? 0.7 : 0);
      smooth(gD.gain, md === 'CLOUD' ? 0.3 : 1); smooth(gAP.gain, md === 'CLOUD' ? 0.85 : 0);
      setTime(); setDrive(); setFb();
    };
    const setDrive = () => { const d = m.params.mode.choice === 'DIGITAL' ? 0.05 : 0.2 + m.v('drive') * 3; smooth(drv.gain, 1 + d); smooth(undrv.gain, 1 / (1 + d * 0.8)); };
    const setFb = () => { const fr = m.v('freeze') === 1; smooth(fbG.gain, fr ? 1.0 : m.v('fb'), 0.03); smooth(inG.gain, fr ? 0 : 1, 0.03); };
    m.p('mode', { label: 'Mode', steps: ECHO_MODES, def: 0, apply: setMode });
    m.p('sync', { label: 'Sync', steps: ['ON', 'OFF'], def: 0, apply: setTime });
    m.p('time', { label: 'Time', def: 0.57, fmt: () => m.v('sync') === 0 ? SYNC[syncIx(m.params.time.nm, 1, 15)][0] : secs(0.02 * Math.pow(100, m.params.time.nm)), apply: setTime });
    m.p('fb', { label: 'Feedback', min: 0, max: 1.1, def: 0.42, fmt: pct, apply: setFb });
    m.p('wow', { label: 'Wow', def: 0.25, fmt: pct, apply: v => { smooth(wow.gain, v * 0.0035); smooth(flut.gain, v * 0.0004); } });
    m.p('drive', { label: 'Saturate', def: 0.3, fmt: pct, apply: setDrive });
    m.p('tone', { label: 'Tone', min: 600, max: 16000, curve: 'exp', def: 0.55, fmt: hz, apply: v => smooth(lp.frequency, v) });
    m.p('locut', { label: 'Low cut', min: 20, max: 1500, curve: 'exp', def: 0.4, fmt: hz, apply: v => smooth(hp.frequency, v) });
    m.p('duck', { label: 'Duck', def: 0.2, fmt: pct, apply: v => smooth(duckAmt.gain, -v * 0.95) });
    m.p('freeze', { label: 'Freeze', steps: ['OFF', 'ON'], def: 0, apply: () => { setFb(); setMode(); } });
    E.on('bpm', () => { if (!m.disposed) setTime(); });
    void tcv;
    m.layout = [{ custom: 'fxview' }, { k: ['mode', 'sync', 'time', 'fb', 'wow', 'drive', 'tone', 'locut', 'duck', 'freeze', 'mix'], cls: 'kgrid' }];
    return m;
  }

  // ======================= ENSEMBLE: chorus · string ensemble · dimension · flanger · through-zero · vibrato =======================
  const ENS_MODES = ['CHORUS', 'ENSEMBLE', 'DIMENSION', 'FLANGER', 'TZF', 'VIBRATO'];
  const ENS = {
    CHORUS: { base: [0.014, 0.019, 0], depth: 0.004, taps: [1, 1, 0], pan: [-1, 1, 0] },
    ENSEMBLE: { base: [0.009, 0.0115, 0.013], depth: 0.0035, taps: [0.8, 0.8, 0.8], pan: [-1, 0, 1], vib: 1 },
    DIMENSION: { base: [0.006, 0.0068, 0], depth: 0.0009, taps: [1, 1, 0], pan: [-1, 1, 0], rate: 0.4 },
    FLANGER: { base: [0.0026, 0, 0], depth: 0.0023, taps: [1, 0, 0], pan: [0, 0, 0], fb: 1 },
    TZF: { base: [0.003, 0, 0], depth: 0.0029, taps: [1, 0, 0], pan: [0, 0, 0], fb: 1, tz: 1 },
    VIBRATO: { base: [0.006, 0, 0], depth: 0.004, taps: [1, 0, 0], pan: [0, 0, 0] }
  };
  function Ensemble(id) {
    const m = new M(id, { name: 'Ensemble', sub: 'chorus · strings · dimension · flanger · through-zero', width: 340, stripe: '#7fe0d0' });
    const S = shell(m, 0.5), rateCS = constSrc(0.6), wetSum = gain(1);
    const lines = [0, 1, 2].map(k => { const dl = ctx.createDelay(0.1), lg = gain(0), tg = gain(0), pan = ctx.createStereoPanner(), o = lfoOsc(k * 2 * PI / 3, rateCS); o.connect(lg); lg.connect(dl.delayTime); S.inp.connect(dl); dl.connect(tg); tg.connect(pan); pan.connect(wetSum); return { dl, lg, tg, pan, o }; });
    // flanger "feedback" without a loop: extra taps at 2× and 3× the swept delay
    const fl = [2, 3].map(k => { const dl = ctx.createDelay(0.1), lg = gain(0), tg = gain(0); lines[0].o.connect(lg); lg.connect(dl.delayTime); S.inp.connect(dl); dl.connect(tg); tg.connect(wetSum); return { k, dl, lg, tg }; });
    const tzD = ctx.createDelay(0.05), tzG = gain(0); S.inp.connect(tzD); tzD.connect(tzG); tzG.connect(wetSum);
    const vib = gain(0), vo = lfoOsc(0, constSrc(6.3)); vo.connect(vib); lines.forEach(l => vib.connect(l.dl.delayTime));
    wetSum.connect(S.wet);
    const set = () => {
      const C = ENS[m.params.mode.choice], d = m.v('depth'), w = m.v('width'), fb = m.v('fb');
      smooth(rateCS.offset, m.v('rate') * (C.rate || 1));
      lines.forEach((l, k) => { smooth(l.dl.delayTime, C.base[k] || 0.005, 0.05); smooth(l.lg.gain, C.taps[k] ? C.depth * d : 0); smooth(l.tg.gain, C.taps[k] * (C.fb ? 0.7 : 1)); l.pan.pan.setTargetAtTime(C.pan[k] * w, now(), 0.05); });
      fl.forEach(f => { smooth(f.dl.delayTime, C.fb ? C.base[0] * f.k : 0.005, 0.05); smooth(f.lg.gain, C.fb ? C.depth * d * f.k : 0); smooth(f.tg.gain, C.fb ? Math.pow(fb, f.k - 1) * 0.7 * Math.sign(fb || 1) ** (f.k - 1) : 0); });
      smooth(tzD.delayTime, C.base[0]); smooth(tzG.gain, C.tz ? -0.7 : 0); smooth(vib.gain, C.vib ? 0.00025 * d : 0);
    };
    m.p('mode', { label: 'Mode', steps: ENS_MODES, def: 0, apply: set });
    m.p('rate', { label: 'Rate', min: 0.03, max: 12, curve: 'exp', def: 0.38, fmt: v => v.toFixed(2) + 'Hz', apply: set });
    m.p('depth', { label: 'Depth', def: 0.6, fmt: pct, apply: set });
    m.p('fb', { label: 'Feedback', min: -0.95, max: 0.95, def: 0.75, fmt: bip, apply: set });
    m.p('width', { label: 'Width', def: 0.8, fmt: pct, apply: set });
    m.layout = [{ custom: 'fxview' }, { k: ['mode', 'rate', 'depth', 'fb', 'width', 'mix'], cls: 'kgrid' }];
    return m;
  }

  // ======================= PHASE 12: stereo phaser =======================
  function Phaser(id) {
    const m = new M(id, { name: 'Phase 12', sub: '4–12 stage stereo phaser · LFO or envelope sweep', width: 330, stripe: '#d68bff' });
    const S = shell(m, 0.6), sp = ctx.createChannelSplitter(2), mg = ctx.createChannelMerger(2), rateCS = constSrc(0.4);
    S.inp.connect(sp);
    const env = follower(S.inp, 14), envG = gain(0);
    env.connect(envG);
    const chains = [0, 1].map(c => {
      const inG = gain(1), aps = Array.from({ length: 12 }, (_, k) => filt('allpass', 600 * (1 + k * 0.11), 0.7)), outG = gain(1), fbD = ctx.createDelay(0.05), fbG = gain(0);
      const o = ctx.createOscillator(); o.frequency.value = 0; rateCS.connect(o.frequency); o.start(); const lg = gain(0); o.connect(lg);
      aps.forEach(a => { lg.connect(a.detune); envG.connect(a.detune); });
      sp.connect(inG, c); outG.connect(mg, 0, c); outG.connect(fbD); fbD.connect(fbG); fbG.connect(inG);
      return { inG, aps, outG, o, lg, fbG, n: 0 };
    });
    mg.connect(S.wet);
    const wire = n => chains.forEach(ch => {
      ch.inG.disconnect(); ch.aps.forEach(a => a.disconnect()); ch.inG.connect(ch.aps[0]);
      for (let k = 0; k < n - 1; k++) ch.aps[k].connect(ch.aps[k + 1]); ch.aps[n - 1].connect(ch.outG);
      ch.aps.forEach(a => { /* detune and the LFO stay connected to the AudioParams */ });
    });
    const setWave = () => { const st = m.v('stereo') * PI, tri = m.v('shape') === 1; chains.forEach((ch, c) => { const ph = c ? st : 0; ch.o.setPeriodicWave(tri ? DSP.waveFromFn(ctx, p => DSP.shapes.tri((p + ph / (2 * PI)) % 1), 16, 256) : phaseWave(ph)); }); };
    const setSweep = () => { const envMode = m.v('src') === 1, d = m.v('depth'); chains.forEach(ch => smooth(ch.lg.gain, envMode ? 0 : d * 2400)); smooth(envG.gain, envMode ? d * 5000 : 0); };
    m.p('stages', { label: 'Stages', steps: [4, 6, 8, 12], def: 2 / 3, apply: v => wire([4, 6, 8, 12][v]) });
    m.p('rate', { label: 'Rate', min: 0.02, max: 10, curve: 'exp', def: 0.35, fmt: v => v.toFixed(2) + 'Hz', apply: v => smooth(rateCS.offset, v) });
    m.p('depth', { label: 'Depth', def: 0.7, fmt: pct, apply: setSweep });
    m.p('center', { label: 'Center', min: 120, max: 4000, curve: 'exp', def: 0.45, fmt: hz, apply: v => chains.forEach(ch => ch.aps.forEach((a, k) => smooth(a.frequency, v * (1 + k * 0.11)))) });
    m.p('res', { label: 'Notch Q', min: 0.3, max: 6, curve: 'exp', def: 0.35, fmt: v => v.toFixed(1), apply: v => chains.forEach(ch => ch.aps.forEach(a => smooth(a.Q, v))) });
    m.p('regen', { label: 'Regen', min: 0, max: 0.85, def: 0.4, fmt: pct, apply: v => chains.forEach(ch => smooth(ch.fbG.gain, v)) });
    m.p('stereo', { label: 'Stereo', def: 0.5, fmt: v => Math.round(v * 180) + '°', nomod: true, apply: setWave });
    m.p('shape', { label: 'Shape', steps: ['SINE', 'TRI'], def: 0, apply: setWave });
    m.p('src', { label: 'Sweep', steps: ['LFO', 'ENV'], def: 0, apply: setSweep });
    m.layout = [{ custom: 'fxview' }, { k: ['stages', 'rate', 'depth', 'center', 'res', 'regen', 'stereo', 'shape', 'src', 'mix'], cls: 'kgrid' }];
    return m;
  }

  // ======================= HEAT: drive, shapers and crusher =======================
  const HEAT_MODELS = ['TUBE', 'TAPE', 'FUZZ', 'FOLD', 'SINE', 'PARABOLA', 'RECTIFY', 'CRUSH'];
  const triFold = x => { const y = ((x + 1) / 4) % 1; return 1 - 4 * Math.abs((y < 0 ? y + 1 : y) - 0.5) - 0; };
  function heatCurve(model, drive, bias, bits) {
    return memoCurve(['heat', model, Math.round(drive * 40), Math.round(bias * 20), bits].join('|'), () => {
      const g = 1 + drive * (model === 'FOLD' || model === 'SINE' || model === 'PARABOLA' ? 7 : 30), b = bias * 0.6;
      const f = {
        TUBE: x => { const u = x * g + b; return u >= 0 ? Math.tanh(u) : Math.tanh(u * 0.6) / 0.85; },
        TAPE: x => { const u = x * g * 0.6 + b; return u / (1 + Math.abs(u)) * 1.5; },
        FUZZ: x => { const u = x * g * 2 + b; return Math.max(-1, Math.min(1, u)) * (Math.abs(u) < 0.04 ? Math.abs(u) / 0.04 : 1); },
        FOLD: x => triFold(x * g + b),
        SINE: x => Math.sin((x * g + b) * PI / 2),
        PARABOLA: x => { let u = x * g + b; u = ((u + 1) % 4 + 4) % 4 - 1; if (u > 1) u = 2 - u; return 2 * u - u * Math.abs(u); },
        RECTIFY: x => Math.tanh(Math.abs(x * g * 0.5) + b) * 2 - 1,
        CRUSH: x => { const L = Math.pow(2, bits - 1), u = Math.max(-1, Math.min(1, x * (1 + drive * 4) + b)); return Math.round(u * L) / L; }
      }[model];
      const c = curveOf(f); let mx = 1e-6; for (const v of c) mx = Math.max(mx, Math.abs(v));
      for (let i = 0; i < c.length; i++) c[i] /= mx;
      return c;
    });
  }
  function Heat(id) {
    const m = new M(id, { name: 'Heat', sub: 'tube · tape · fuzz · folders · rectifier · bitcrusher', width: 360, stripe: '#ff7a3d' });
    const S = shell(m, 1);
    const tight = filt('highpass', 30, 0.7), pre = gain(1), sh = shaper(heatCurve('TUBE', 0.3, 0, 8)), dcb = filt('highpass', 12, 0.7);
    const lo = filt('lowshelf', 400, 0), hi = filt('highshelf', 2200, 0), cab = filt('lowpass', 12000, 0.6), D = decimator(), post = gain(0.7);
    S.inp.connect(tight); tight.connect(pre); pre.connect(sh); sh.connect(dcb); dcb.connect(lo); lo.connect(hi); hi.connect(cab); cab.connect(D.inp); D.out.connect(post); post.connect(S.wet);
    m.inCV('DRIVE', pre.gain, 1.5, 'drive CV (pushes the input harder)');
    const setCurve = () => {
      const md = m.params.model.choice, d = m.v('drive');
      const c = heatCurve(md, d, m.v('bias'), m.v('bits')); if (sh.curve !== c) sh.curve = c; m.curve = c;
      const comp = md === 'FOLD' || md === 'SINE' || md === 'PARABOLA' || md === 'CRUSH' ? 0.75 : 1 / (1 + d * 1.6);
      smooth(post.gain, comp * m.v('level') * 1.4);
      m.ui?.curve?.();
    };
    m.p('model', { label: 'Model', steps: HEAT_MODELS, def: 0, apply: setCurve });
    m.p('drive', { label: 'Drive', def: 0.35, fmt: pct, apply: setCurve });
    m.p('bias', { label: 'Bias', min: -1, max: 1, def: 0.5, fmt: bip, apply: setCurve });
    m.p('bits', { label: 'Bits', min: 1, max: 12, def: 0.55, fmt: v => v.toFixed(1), nomod: true, apply: setCurve });
    m.p('rate', { label: 'Sample rate', min: 300, max: 24000, curve: 'exp', def: 1, fmt: v => v >= 21600 ? 'FULL' : hz(v), apply: v => D.set(v >= 21600 ? 1e9 : v) });
    m.p('tight', { label: 'Tight', min: 20, max: 800, curve: 'exp', def: 0.2, fmt: hz, apply: v => smooth(tight.frequency, v) });
    m.p('tone', { label: 'Tone', min: -1, max: 1, def: 0.4, fmt: v => v < -0.1 ? 'DARK' : v > 0.1 ? 'BRIGHT' : 'FLAT', apply: v => { smooth(lo.gain, -v * 9); smooth(hi.gain, v * 7); smooth(cab.frequency, 7000 + (v + 1) * 4500); } });
    m.p('level', { label: 'Level', def: 0.6, fmt: pct, apply: setCurve });
    m.layout = [{ custom: 'fxview' }, { k: ['model', 'drive', 'bias', 'bits', 'rate', 'tight', 'tone', 'level', 'mix'], cls: 'kgrid' }];
    return m;
  }

  // ======================= BODE: frequency shifter, ring modulator, barber-pole spiral =======================
  const HIL_A = [0.6923878, 0.9360654322959, 0.9882295226860, 0.9987488452737];
  const HIL_B = [0.4021921162426, 0.8561710882420, 0.9722909545651, 0.9952884791278];
  const shiftHz = n => { const u = n * 2 - 1; return Math.sign(u) * (Math.pow(2501, Math.abs(u)) - 1); };
  function Bode(id) {
    const m = new M(id, { name: 'Bode', sub: 'frequency shifter · ring mod · spiral feedback', width: 330, stripe: '#5fe3ff' });
    const S = shell(m, 0.6), sum = gain(1);
    S.inp.connect(sum);
    // Hilbert pair: two chains of 2nd-order all-passes 90° apart from 20 Hz to 20 kHz
    let a = sum, b = sum;
    for (const c of HIL_A) { const f = iir([c * c, 0, -1], [1, 0, -c * c]); a.connect(f); a = f; }
    const z1 = iir([0, 1], [1]); a.connect(z1); a = z1;
    for (const c of HIL_B) { const f = iir([c * c, 0, -1], [1, 0, -c * c]); b.connect(f); b = f; }
    const fCS = constSrc(0), cosO = ctx.createOscillator(), sinO = ctx.createOscillator();
    cosO.setPeriodicWave(ctx.createPeriodicWave(new Float32Array([0, 1]), new Float32Array([0, 0]), { disableNormalization: true }));
    sinO.setPeriodicWave(ctx.createPeriodicWave(new Float32Array([0, 0]), new Float32Array([0, 1]), { disableNormalization: true }));
    [cosO, sinO].forEach(o => { o.frequency.value = 0; fCS.connect(o.frequency); });
    const t0 = now() + 0.03; cosO.start(t0); sinO.start(t0);
    const mI = gain(0), mQ = gain(0); b.connect(mI); a.connect(mQ); cosO.connect(mI.gain); sinO.connect(mQ.gain);
    const up = gain(1), down = gain(1), negQ = gain(-1); mI.connect(up); mQ.connect(negQ); negQ.connect(up); mI.connect(down); mQ.connect(down);
    const ring = gain(0); sum.connect(ring); cosO.connect(ring.gain);
    const mg = ctx.createChannelMerger(2), uL = gain(1), uR = gain(1), dR = gain(0), rL = gain(0), rR = gain(0);
    up.connect(uL); up.connect(uR); down.connect(dR); ring.connect(rL); ring.connect(rR);
    uL.connect(mg, 0, 0); rL.connect(mg, 0, 0); uR.connect(mg, 0, 1); dR.connect(mg, 0, 1); rR.connect(mg, 0, 1);
    mg.connect(S.wet);
    // spiral: the shifted sound goes round again and shifts further each time
    const fbD = ctx.createDelay(2), fbLp = filt('lowpass', 6000, 0.5), fbG = gain(0), fbSel = gain(1), fbRing = gain(0);
    up.connect(fbSel); ring.connect(fbRing); fbSel.connect(fbD); fbRing.connect(fbD); fbD.connect(fbLp); fbLp.connect(fbG); fbG.connect(sum);
    m.inCV('SHIFT', [cosO.frequency, sinO.frequency], 250, 'shift CV (250 Hz per unit)');
    const setMode = () => { const md = m.params.mode.choice; smooth(uL.gain, md === 'RING' ? 0 : 1); smooth(uR.gain, md === 'SINGLE' ? 1 : 0); smooth(dR.gain, md === 'STEREO' ? 1 : 0); smooth(rL.gain, md === 'RING' ? 1 : 0); smooth(rR.gain, md === 'RING' ? 1 : 0); smooth(fbSel.gain, md === 'RING' ? 0 : 1); smooth(fbRing.gain, md === 'RING' ? 1 : 0); };
    m.p('shift', { label: 'Shift', def: 0.56, fmt: () => { const v = shiftHz(m.params.shift.nm); return (v >= 0 ? '+' : '') + (Math.abs(v) < 10 ? v.toFixed(1) : Math.round(v)) + 'Hz'; }, apply: () => smooth(fCS.offset, shiftHz(m.params.shift.nm), 0.03) });
    m.p('mode', { label: 'Mode', steps: ['SINGLE', 'STEREO', 'RING'], def: 0, apply: setMode });
    m.p('fb', { label: 'Spiral', min: 0, max: 0.95, def: 0.3, fmt: pct, apply: v => smooth(fbG.gain, v) });
    m.p('dtime', { label: 'Spiral time', min: 0.01, max: 1.5, curve: 'exp', def: 0.55, fmt: secs, apply: v => smooth(fbD.delayTime, v, 0.08) });
    m.p('tone', { label: 'Tone', min: 500, max: 16000, curve: 'exp', def: 0.6, fmt: hz, apply: v => smooth(fbLp.frequency, v) });
    m.layout = [{ custom: 'fxview' }, { k: ['shift', 'mode', 'fb', 'dtime', 'tone', 'mix'], cls: 'kgrid' }];
    return m;
  }

  // ======================= SYMPATHY: tuned sympathetic-string resonator =======================
  const CHORDS = { OCT: [0, 12], FIFTH: [0, 7, 12], MAJ: [0, 4, 7, 12], MIN: [0, 3, 7, 12], SUS4: [0, 5, 7, 12], MAJ7: [0, 4, 7, 11, 14], MIN9: [0, 3, 7, 10, 14], CLUSTER: [0, 2, 3, 7, 9, 14] };
  const PARTIALS = { STRINGS: [[1, 1], [2, 0.5], [3, 0.33]], METAL: [[1, 1], [2.756, 0.6], [5.404, 0.35]], GLASS: [[1, 1], [2.32, 0.7], [4.25, 0.45]] };
  function Sympathy(id) {
    const m = new M(id, { name: 'Sympathy', sub: 'sympathetic strings · tuned to the song', width: 360, stripe: '#e8d28a' });
    const S = shell(m, 0.4), ex = gain(1), sum = gain(1), comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.ratio.value = 8; comp.attack.value = 0.003; comp.release.value = 0.2;
    S.inp.connect(ex); sum.connect(comp); comp.connect(S.wet);
    const bands = Array.from({ length: 18 }, (_, i) => { const f = filt('bandpass', 220, 50), g = gain(0), pan = ctx.createStereoPanner(); ex.connect(f); f.connect(g); g.connect(pan); pan.connect(sum); return { f, g, pan, note: Math.floor(i / 3), part: i % 3 }; });
    m.notes = [];
    const retune = (force) => {
      let root = m.v('root');
      if (m.v('follow') === 1) {
        const seq = E.order.map(id => E.mods[id]).find(x => x?.kind === 'StepSeq');
        if (seq) { const deg = E.chordAt(E.step), sc = seq.params.scale.choice; root = seq.params.root.value + DSP.degreeToSemi(sc, deg); }
      }
      const base = 12 * (m.params.oct.choice + 1) + root, iv = CHORDS[m.params.chord.choice], notes = iv.map(i => base + i).slice(0, 6);
      if (!force && notes.join() === m.notes.join()) return;
      m.notes = notes; setBands();
    };
    const setBands = () => {
      const T = m.v('decay'), br = m.v('bright'), dm = m.v('damp'), P = PARTIALS[m.params.mode.choice], sp = m.v('spread');
      bands.forEach(b => {
        const n = m.notes[b.note]; if (n == null) { smooth(b.g.gain, 0); return; }
        const [ratio, amp] = P[b.part], f = Math.min(16000, DSP.mtof(n) * ratio), T60 = T * (1 - dm * b.part * 0.3), Q = clamp(PI * f * T60 / 6.9, 2, 2500);
        b.f.frequency.setTargetAtTime(f, now(), 0.03); b.f.Q.setTargetAtTime(Q, now(), 0.03);
        smooth(b.g.gain, 0.09 * Math.sqrt(Q / f) * amp * (b.part ? br * 1.6 : 1));
        b.pan.pan.setTargetAtTime(((b.note % 2) ? 1 : -1) * sp * (0.4 + 0.6 * (b.note / 6)), now(), 0.05);
      });
    };
    m.p('root', { label: 'Root', steps: DSP.NOTE_NAMES, def: 0, apply: () => retune(true) });
    m.p('chord', { label: 'Chord', steps: Object.keys(CHORDS), def: 3 / 7, apply: () => retune(true) });
    m.p('oct', { label: 'Octave', steps: [2, 3, 4, 5], def: 1 / 3, apply: () => retune(true) });
    m.p('follow', { label: 'Follow', steps: ['OFF', 'SONG'], def: 1, apply: () => retune(true) });
    m.p('mode', { label: 'Body', steps: Object.keys(PARTIALS), def: 0, apply: setBands });
    m.p('decay', { label: 'Decay', min: 0.2, max: 12, curve: 'exp', def: 0.55, fmt: secs, apply: setBands });
    m.p('bright', { label: 'Bright', def: 0.45, fmt: pct, apply: setBands });
    m.p('damp', { label: 'Damp', def: 0.4, fmt: pct, apply: setBands });
    m.p('spread', { label: 'Spread', def: 0.7, fmt: pct, apply: setBands });
    m.p('excite', { label: 'Excite', min: 0, max: 2, def: 0.5, fmt: pct, apply: v => smooth(ex.gain, v) });
    m.tick = () => { if (m.v('follow') === 1 && (m._tk = (m._tk || 0) + 1) % 8 === 0) retune(); };
    m.layout = [{ custom: 'fxview' }, { k: ['root', 'chord', 'oct', 'follow', 'mode', 'decay', 'bright', 'damp', 'spread', 'excite', 'mix'], cls: 'kgrid' }];
    return m;
  }

  // ======================= VOWEL: morphing formant filter =======================
  const VOWELS = { A: [[600, 0, 60], [1040, -7, 70], [2250, -9, 110], [2450, -9, 120], [2750, -20, 130]], E: [[400, 0, 40], [1620, -12, 80], [2400, -9, 100], [2800, -12, 120], [3100, -18, 120]], I: [[250, 0, 60], [1750, -30, 90], [2600, -16, 100], [3050, -22, 120], [3340, -28, 120]], O: [[400, 0, 40], [750, -11, 80], [2400, -21, 100], [2600, -20, 120], [2900, -40, 120]], U: [[350, 0, 40], [600, -20, 80], [2400, -32, 100], [2675, -28, 120], [2950, -36, 120]] };
  const VKEYS = ['A', 'E', 'I', 'O', 'U'];
  function Vowel(id) {
    const m = new M(id, { name: 'Vowel', sub: 'formant filter · talking bass · A-E-I-O-U morph', width: 330, stripe: '#ff8ad8' });
    const S = shell(m, 1), pre = gain(1), sat = shaper(curveOf(x => Math.tanh(x * 2.5) / Math.tanh(2.5))), sum = gain(2.2);
    S.inp.connect(pre); pre.connect(sat);
    const fs = Array.from({ length: 5 }, () => { const f = filt('bandpass', 500, 5), g = gain(0); sat.connect(f); f.connect(g); g.connect(sum); return { f, g }; });
    sum.connect(S.wet);
    m.formants = [];
    const set = () => {
      const x = clamp(m.params.vowel.nm) * 4, i = Math.min(3, Math.floor(x)), k = x - i, A = VOWELS[VKEYS[i]], B = VOWELS[VKEYS[i + 1]];
      const sh = Math.pow(2, m.v('shift') * 0.8), rq = m.v('res');
      m.formants = fs.map((f, j) => {
        const fr = (A[j][0] + (B[j][0] - A[j][0]) * k) * sh, db = A[j][1] + (B[j][1] - A[j][1]) * k, bw = A[j][2] + (B[j][2] - A[j][2]) * k;
        f.f.frequency.setTargetAtTime(Math.min(18000, fr), now(), 0.02); f.f.Q.setTargetAtTime(fr / bw * rq, now(), 0.02); f.g.gain.setTargetAtTime(Math.pow(10, db / 20) * (0.6 + rq * 0.3), now(), 0.02);
        return [fr, db];
      });
    };
    m.p('vowel', { label: 'Vowel', def: 0, fmt: () => { const x = clamp(m.params.vowel.nm) * 4, i = Math.round(x); return Math.abs(x - i) < 0.15 ? VKEYS[i] : VKEYS[Math.floor(x)] + '→' + VKEYS[Math.min(4, Math.floor(x) + 1)]; }, apply: set });
    m.p('shift', { label: 'Formant', min: -1, max: 1, def: 0.5, fmt: bip, apply: set });
    m.p('res', { label: 'Reso', min: 0.5, max: 4, curve: 'exp', def: 0.45, fmt: v => v.toFixed(1), apply: set });
    m.p('drive', { label: 'Drive', min: 0.3, max: 4, curve: 'exp', def: 0.35, fmt: v => v.toFixed(1) + '×', apply: v => smooth(pre.gain, v) });
    m.layout = [{ custom: 'fxview' }, { k: ['vowel', 'shift', 'res', 'drive', 'mix'], cls: 'kgrid' }];
    return m;
  }

  // ======================= PUMP: glue compressor, OTT-style multiband squash, tempo sidechain =======================
  const PUMP_RATE = ['1/2', '1/4', '1/8', '1/16'], PUMP_STEPS = [8, 4, 2, 1];
  function Pump(id) {
    const m = new M(id, { name: 'Pump', sub: 'glue · 3-band squash · sidechain pump', width: 350, stripe: '#9dff6b' });
    const S = shell(m, 1), glue = ctx.createDynamicsCompressor(), gMk = gain(1), gOut = gain(1), oOut = gain(0), duck = gain(1), mk = gain(1);
    glue.knee.value = 8; glue.attack.value = 0.01; glue.release.value = 0.15;
    S.inp.connect(glue); glue.connect(gMk); gMk.connect(gOut); gOut.connect(duck);
    // three bands, each squashed hard, then summed back
    const lr = (type, f) => { const a = filt(type, f, 0.707), b = filt(type, f, 0.707); a.connect(b); return [a, b]; };
    const bandsDef = [[['lowpass', 150]], [['highpass', 150], ['lowpass', 2500]], [['highpass', 2500]]];
    m.bands = bandsDef.map((chain, i) => {
      let node = S.inp, first = null;
      for (const [type, f] of chain) { const [a, b] = lr(type, f); node.connect(a); node = b; first = first || a; }
      const c = ctx.createDynamicsCompressor(); c.threshold.value = -34; c.ratio.value = 10; c.knee.value = 6; c.attack.value = [0.01, 0.004, 0.002][i]; c.release.value = [0.15, 0.09, 0.06][i];
      const g = gain(1); node.connect(c); c.connect(g); g.connect(oOut); return { c, g };
    });
    oOut.connect(duck); duck.connect(mk); mk.connect(S.wet);
    const setDyn = () => {
      const gl = m.v('glue'), o = m.v('ott');
      glue.threshold.setTargetAtTime(-gl * 30, now(), 0.05); glue.ratio.setTargetAtTime(1 + gl * 5, now(), 0.05); smooth(gMk.gain, 1 + gl * 0.9);
      smooth(gOut.gain, 1 - o); smooth(oOut.gain, o);
      m.bands.forEach((b, i) => smooth(b.g.gain, 1 + o * [2.2, 2.6, 3.2][i]));
    };
    m.p('glue', { label: 'Glue', def: 0.3, fmt: pct, apply: setDyn });
    m.p('ott', { label: 'Squash', def: 0, fmt: pct, apply: setDyn });
    m.p('pump', { label: 'Pump', def: 0, fmt: pct });
    m.p('rate', { label: 'Pump rate', steps: PUMP_RATE, def: 1 / 3 });
    m.p('rel', { label: 'Release', min: 0.04, max: 0.6, curve: 'exp', def: 0.5, fmt: secs });
    m.p('src', { label: 'Key', steps: ['CLOCK', 'TRIG'], def: 0 });
    m.p('gain', { label: 'Output', def: 0.55, fmt: pct, apply: v => smooth(mk.gain, v * 1.6) });
    const hit = t => {
      const d = m.v('pump'); if (d < 0.01) return;
      const g = duck.gain; g.cancelScheduledValues(t); g.setTargetAtTime(1 - d * 0.92, t, 0.003); g.setTargetAtTime(1, t + 0.025, m.v('rel') / 3.2);
      E.at(t, () => m.ui?.hit?.());
    };
    m.inEvent('TRIG', function (e) { if (this.v('src') === 1) hit(Math.max(now(), e.time)); }, 'sidechain trigger (e.g. the kick)');
    m.last = -1;
    m.tick = function (t0) {
      if (!E.running || this.v('src') !== 0) { this.last = E.step - 1; return; }
      const dur = E.sixteenth(), sp = PUMP_STEPS[this.v('rate')];
      for (let s = Math.max(this.last + 1, E.step - 8); s < E.step; s++) { const t = E.nextTime - (E.step - s) * dur; if (s % sp === 0 && t >= t0 - 0.005) hit(Math.max(t, now())); }
      this.last = E.step - 1;
    };
    m.layout = [{ custom: 'fxview' }, { k: ['glue', 'ott', 'pump', 'rate', 'rel', 'src', 'gain', 'mix'], cls: 'kgrid' }];
    return m;
  }

  // ======================= STUTTER: beat repeat, reverse, tape stop, backspin =======================
  const ST_TYPES = ['REPEAT', 'REVERSE', 'STOP', 'SPIN', 'MIX'], ST_SIZE = ['1/32', '1/16', '1/8', '1/4', '1/2'], ST_SB = [1 / 8, 1 / 4, 1 / 2, 1, 2];
  const ST_LEN = ['1/4', '1/2', '1', '2'], ST_LB = [0.25, 0.5, 1, 2];
  function Stutter(id) {
    const m = new M(id, { name: 'Stutter', sub: 'beat repeat · reverse · tape stop · backspin', width: 340, stripe: '#ff4f6d' });
    const S = shell(m, 1, { mix: false });
    S.dry.gain.value = 1; S.wet.gain.value = 1;
    const dryG = gain(1), dl = ctx.createDelay(8), wG = gain(0);
    S.inp.disconnect(); S.inp.connect(dryG); dryG.connect(S.out); S.inp.connect(dl); dl.connect(wG); wG.connect(S.out);
    dl.delayTime.value = 0;
    m.p('type', { label: 'Type', steps: ST_TYPES, def: 1 });
    m.p('chance', { label: 'Chance', def: 0.25, fmt: pct });
    m.p('size', { label: 'Slice', steps: ST_SIZE, def: 0.25 });
    m.p('len', { label: 'Length', steps: ST_LEN, def: 2 / 3 });
    m.p('gate', { label: 'Gate', min: 0.2, max: 1, def: 0.8, fmt: pct });
    m.p('decay', { label: 'Decay', min: 0, max: 0.6, def: 0.2, fmt: pct });
    m.busy = 0; m.lastEv = null;
    m.fire = function (t, type, spanBeats) {
      t = Math.max(t, now() + 0.01, this.busy); type = type || this.params.type.choice;
      if (type === 'MIX') { const r = rnd(); type = r < 0.5 ? 'REPEAT' : r < 0.7 ? 'REVERSE' : r < 0.85 ? 'STOP' : 'SPIN'; }
      const b = spb(), span = (spanBeats || ST_LB[this.v('len')]) * b, f = 0.004;
      const dg = dryG.gain, wg = wG.gain, d = dl.delayTime;
      dg.setValueAtTime(1, t - f); dg.linearRampToValueAtTime(0, t); dg.setValueAtTime(0, t + span); dg.linearRampToValueAtTime(1, t + span + f);
      wg.setValueAtTime(0, t);
      if (type === 'REPEAT') {
        const L = ST_SB[this.v('size')] * b, reps = Math.max(1, Math.floor(span / L + 1e-6)), gt = this.v('gate'), dc = this.v('decay');
        for (let k = 0; k < reps; k++) {
          const tk = t + k * L, a = Math.pow(1 - dc, k);
          d.setValueAtTime(Math.min(7.9, L * (k + 1)), tk); wg.setValueAtTime(0, tk); wg.linearRampToValueAtTime(a, tk + 0.002);
          wg.setValueAtTime(a, tk + L * gt - 0.003); wg.linearRampToValueAtTime(0, tk + L * gt);
        }
      } else {
        const n = 96, c = new Float32Array(n);
        for (let i = 0; i < n; i++) { const tau = i / (n - 1) * span; c[i] = type === 'REVERSE' ? 2 * tau : type === 'STOP' ? tau * tau / (2 * span) : 2 * tau * tau / span; }
        d.setValueAtTime(0, t); d.setValueCurveAtTime(c, t + 0.0005, span - 0.001);
        wg.linearRampToValueAtTime(1, t + 0.004);
        const fadeAt = type === 'REVERSE' ? span - 0.006 : type === 'STOP' ? span * 0.85 : span * 0.6;
        wg.setValueAtTime(1, t + fadeAt); wg.linearRampToValueAtTime(0, t + span);
      }
      d.setValueAtTime(0, t + span + 0.01);
      this.busy = t + span + 0.02; this.lastEv = { type, t, span };
      E.at(t, () => this.ui?.hit?.(type));
    };
    m.inEvent('TRIG', function (e) { this.fire(e.time); }, 'fire a glitch now');
    m.last = -1;
    m.tick = function (t0) {
      if (!E.running) { this.last = E.step - 1; return; }
      const dur = E.sixteenth();
      for (let s = Math.max(this.last + 1, E.step - 8); s < E.step; s++) {
        if (s % 16 !== 0) continue;
        const tb = E.nextTime - (E.step - s) * dur; if (tb < t0 - 0.01) continue;
        if (rnd() < this.v('chance')) { const lb = ST_LB[this.v('len')], at = tb + (4 - Math.max(lb, 1)) * dur * 4; this.fire(at, null, lb); }
      }
      this.last = E.step - 1;
    };
    m.layout = [{ custom: 'fxview' }, { k: ['type', 'chance', 'size', 'len', 'gate', 'decay'], cls: 'kgrid' }];
    return m;
  }

  // ======================= PRISM: two-voice pitch shifter with cascading feedback =======================
  const PR_IV = [-24, -19, -12, -7, -5, -3, 0, 3, 4, 5, 7, 12, 19, 24];
  function Prism(id) {
    const m = new M(id, { name: 'Prism', sub: 'harmonizer · cascading pitch-shift echoes', width: 340, stripe: '#b9a6ff' });
    const S = shell(m, 0.4), sum = gain(1), p1 = pitchShifter(0.07), p2 = pitchShifter(0.09), g1 = gain(0.7), g2 = gain(0.7), pa = ctx.createStereoPanner(), pb = ctx.createStereoPanner();
    const loop = gain(1), dly = ctx.createDelay(2), tone = filt('lowpass', 6000, 0.5), fbG = gain(0);
    S.inp.connect(sum); sum.connect(p1.inp); sum.connect(p2.inp); p1.out.connect(g1); p2.out.connect(g2); g1.connect(pa); g2.connect(pb); pa.connect(S.wet); pb.connect(S.wet);
    pa.pan.value = -0.6; pb.pan.value = 0.6;
    g1.connect(loop); g2.connect(loop); loop.connect(dly); dly.connect(tone); tone.connect(fbG); fbG.connect(sum);
    const set = () => { const dc = m.v('detune') * 40; p1.set(Math.pow(2, (m.params.i1.choice * 100 + dc) / 1200)); p2.set(Math.pow(2, (m.params.i2.choice * 100 - dc) / 1200)); };
    m.p('i1', { label: 'Voice 1', steps: PR_IV.map(v => (v > 0 ? '+' : '') + v), def: 11 / 13, apply: set });
    m.p('i2', { label: 'Voice 2', steps: PR_IV.map(v => (v > 0 ? '+' : '') + v), def: 10 / 13, apply: set });
    m.params.i1.steps = PR_IV; m.params.i2.steps = PR_IV; // choice returns the number of semitones
    m.params.i1.display = () => (m.params.i1.choice > 0 ? '+' : '') + m.params.i1.choice; m.params.i2.display = () => (m.params.i2.choice > 0 ? '+' : '') + m.params.i2.choice;
    m.p('detune', { label: 'Detune', def: 0.15, fmt: v => Math.round(v * 40) + 'c', apply: set });
    m.p('lv', { label: 'Balance', def: 0.5, fmt: v => v < 0.45 ? '1 ' + Math.round((1 - v) * 100) : v > 0.55 ? '2 ' + Math.round(v * 100) : '1 = 2', apply: v => { smooth(g1.gain, Math.cos(v * PI / 2) * 1.1); smooth(g2.gain, Math.sin(v * PI / 2) * 1.1); } });
    m.p('time', { label: 'Time', min: 0.02, max: 1.5, curve: 'exp', def: 0.6, fmt: secs, apply: v => smooth(dly.delayTime, v, 0.1) });
    m.p('fb', { label: 'Cascade', min: 0, max: 0.9, def: 0.35, fmt: pct, apply: v => smooth(fbG.gain, v) });
    m.p('tone', { label: 'Tone', min: 800, max: 16000, curve: 'exp', def: 0.55, fmt: hz, apply: v => smooth(tone.frequency, v) });
    m.layout = [{ custom: 'fxview' }, { k: ['i1', 'i2', 'detune', 'lv', 'time', 'fb', 'tone', 'mix'], cls: 'kgrid' }];
    return m;
  }

  // ======================= CASSETTE: worn tape character =======================
  function Cassette(id) {
    const m = new M(id, { name: 'Cassette', sub: 'wow · flutter · hiss · dropouts · warped tape', width: 330, stripe: '#d8b48a' });
    const S = shell(m, 1), pre = gain(1), sat = shaper(curveOf(x => Math.tanh(x * 1.6) / Math.tanh(1.6)), '2x'), hp = filt('highpass', 40, 0.7), lp = filt('lowpass', 12000, 0.6), head = filt('peaking', 90, 1.2);
    const dl = ctx.createDelay(0.1), drop = gain(1), wow = gain(0), flut = gain(0), warp = gain(0);
    dl.delayTime.value = 0.018; head.gain.value = 3;
    S.inp.connect(pre); pre.connect(sat); sat.connect(hp); hp.connect(head); head.connect(lp); lp.connect(dl); dl.connect(drop); drop.connect(S.wet);
    lfoOsc(0, constSrc(0.45)).connect(wow); lfoOsc(0, constSrc(8.7)).connect(flut);
    const nz = ctx.createBufferSource(); nz.buffer = E.noise; nz.loop = true; nz.start();
    const wlp = filt('lowpass', 1.1, 0.5); nz.connect(wlp); wlp.connect(warp);
    [wow, flut, warp].forEach(g => g.connect(dl.delayTime));
    const hz2 = filt('bandpass', 5000, 0.4), hissG = gain(0); nz.connect(hz2); hz2.connect(hissG); hissG.connect(S.wet);
    m.p('age', { label: 'Age', def: 0.4, fmt: pct, apply: v => { smooth(lp.frequency, 16000 * Math.pow(0.17, v)); smooth(hp.frequency, 30 + v * 140); smooth(pre.gain, 1 + v * 1.8); } });
    m.p('wow', { label: 'Wow', def: 0.35, fmt: pct, apply: v => smooth(wow.gain, v * 0.004) });
    m.p('flutter', { label: 'Flutter', def: 0.3, fmt: pct, apply: v => smooth(flut.gain, v * 0.00035) });
    m.p('warp', { label: 'Warp', def: 0.2, fmt: pct, apply: v => smooth(warp.gain, v * 0.08) });
    m.p('hiss', { label: 'Hiss', def: 0.15, fmt: pct, apply: v => smooth(hissG.gain, v * v * 0.05) });
    m.p('drop', { label: 'Dropouts', def: 0.15, fmt: pct });
    m.tick = function (t0) {
      if (rnd() < this.v('drop') * 0.025) { const t = t0 + 0.05, d = 0.04 + rnd() * 0.22, depth = 0.15 + rnd() * 0.5; drop.gain.setTargetAtTime(depth, t, 0.01); drop.gain.setTargetAtTime(1, t + d, 0.03); E.at(t, () => this.ui?.hit?.()); }
    };
    m.layout = [{ custom: 'fxview' }, { k: ['age', 'wow', 'flutter', 'warp', 'hiss', 'drop', 'mix'], cls: 'kgrid' }];
    return m;
  }

  // ======================= HORIZON: chaotic feedback delay network =======================
  const H4 = [[1, 1, 1, 1], [1, -1, 1, -1], [1, 1, -1, -1], [1, -1, -1, 1]];
  function Horizon(id) {
    const m = new M(id, { name: 'Horizon', sub: 'chaotic feedback network · self-oscillating drones', width: 350, stripe: '#8a7bff' });
    const S = shell(m, 0.35), inG = gain(0.5), lim = ctx.createDynamicsCompressor(), dcb = filt('highpass', 25, 0.7), mg = ctx.createChannelMerger(2);
    lim.threshold.value = -10; lim.ratio.value = 20; lim.attack.value = 0.002; lim.release.value = 0.15;
    const R = [1, 1.287, 1.553, 1.871], RATES = [0.13, 0.17, 0.23, 0.29];
    const L = R.map((r, i) => {
      const sum = gain(1), dl = ctx.createDelay(2), lp = filt('lowpass', 5000, 0.5), sh = shaper(curveOf(x => Math.tanh(x)), '2x'), g = gain(0.8), wg = gain(0), xg = gain(0);
      S.inp.connect(inG); inG.connect(sum); sum.connect(dl); dl.connect(lp); lp.connect(sh); sh.connect(g);
      lfoOsc(i * 1.3, constSrc(RATES[i])).connect(wg); wg.connect(dl.delayTime);
      sh.connect(mg, 0, i % 2);
      return { r, sum, dl, lp, sh, g, wg, xg };
    });
    // Hadamard mixing: every line feeds every line
    L.forEach((a, i) => L.forEach((b, j) => { const x = gain(H4[i][j] * 0.5); a.g.connect(x); x.connect(b.sum); }));
    // chaos: each line's sound bends the next line's delay time (audio-rate delay FM)
    L.forEach((a, i) => { a.sh.connect(a.xg); a.xg.connect(L[(i + 1) % 4].dl.delayTime); });
    mg.connect(dcb); dcb.connect(lim); lim.connect(S.wet);
    const setSize = () => { const s = m.v('size'); L.forEach(l => { l.dl.delayTime.setTargetAtTime(s * l.r, now(), 0.25); smooth(l.wg.gain, m.v('warp') * s * 0.03); }); };
    const setChaos = () => { const c = m.v('chaos'), k = 1 + c * 4; const cv = memoCurve('hz' + Math.round(c * 20), () => curveOf(x => Math.tanh(x * k) / k * 1.15)); L.forEach(l => { l.sh.curve = cv; smooth(l.xg.gain, c * c * 0.002); }); };
    const setFb = () => { const fr = m.v('freeze') === 1; L.forEach(l => smooth(l.g.gain, fr ? 1.0 : m.v('gravity'), 0.05)); smooth(inG.gain, fr ? 0 : 0.5, 0.05); };
    m.p('size', { label: 'Size', min: 0.02, max: 0.6, curve: 'exp', def: 0.5, fmt: secs, apply: setSize });
    m.p('gravity', { label: 'Gravity', min: 0, max: 1.08, def: 0.78, fmt: pct, apply: setFb });
    m.p('damp', { label: 'Damp', min: 300, max: 14000, curve: 'exp', def: 0.55, fmt: hz, apply: v => L.forEach(l => smooth(l.lp.frequency, v)) });
    m.p('chaos', { label: 'Chaos', def: 0.2, fmt: pct, apply: setChaos });
    m.p('warp', { label: 'Warp', def: 0.3, fmt: pct, apply: setSize });
    m.p('freeze', { label: 'Freeze', steps: ['OFF', 'ON'], def: 0, apply: setFb });
    m.layout = [{ custom: 'fxview' }, { k: ['size', 'gravity', 'damp', 'chaos', 'warp', 'freeze', 'mix'], cls: 'kgrid' }];
    return m;
  }

  const TYPES = {
    Halls: { label: 'Halls reverb (8 spaces, shimmer)', desc: 'algorithmic reverb: PLATE ROOM HALL CATHEDRAL SPRING BLOOM REVERSE GATED; decay, pre-delay, shimmer (octave-up feedback), width', prefix: 'halls', make: id => Halls(id) },
    Echoes: { label: 'Echoes delay (tape, ping-pong, cloud)', desc: 'TAPE DIGITAL PINGPONG MULTI CLOUD delay; tempo sync, feedback past 100% (saturated runaway), wow, ducking, freeze; TIME CV', prefix: 'echo', make: id => Echoes(id) },
    Ensemble: { label: 'Ensemble chorus / flanger', desc: 'CHORUS ENSEMBLE(string) DIMENSION FLANGER TZF(through-zero) VIBRATO', prefix: 'ens', make: id => Ensemble(id) },
    Phaser: { label: 'Phase 12 phaser', desc: '4-12 stage stereo phaser, LFO or envelope sweep, regen', prefix: 'phase', make: id => Phaser(id) },
    Heat: { label: 'Heat drive / bitcrusher', desc: 'TUBE TAPE FUZZ FOLD SINE PARABOLA RECTIFY CRUSH shapers, bias, bits, sample-rate reduction, tilt tone; DRIVE CV', prefix: 'heat', make: id => Heat(id) },
    Bode: { label: 'Bode frequency shifter', desc: 'frequency shifter (SINGLE, STEREO up/down) or ring mod, spiral feedback (barber-pole); SHIFT CV', prefix: 'bode', make: id => Bode(id) },
    Sympathy: { label: 'Sympathy string resonator', desc: 'sympathetic strings tuned to a chord that follows the song; STRINGS METAL GLASS bodies', prefix: 'symp', make: id => Sympathy(id) },
    Vowel: { label: 'Vowel formant filter', desc: 'A-E-I-O-U morphing formant filter for talking basses (modulate vowel)', prefix: 'vowel', make: id => Vowel(id) },
    Pump: { label: 'Pump dynamics (glue, OTT, sidechain)', desc: 'glue compressor, 3-band OTT-style squash, tempo sidechain pump (1/2-1/16) or TRIG-keyed ducking', prefix: 'pump', make: id => Pump(id) },
    Stutter: { label: 'Stutter glitch (repeat, reverse, stop)', desc: 'beat repeat, reverse, tape stop, backspin; fires at bar ends by chance or on TRIG', prefix: 'stut', make: id => Stutter(id) },
    Prism: { label: 'Prism harmonizer', desc: 'two pitch-shift voices (-24..+24), detune, cascading feedback echoes', prefix: 'prism', make: id => Prism(id) },
    Cassette: { label: 'Cassette lo-fi tape', desc: 'age, wow, flutter, warp, hiss, dropouts', prefix: 'tape', make: id => Cassette(id) },
    Horizon: { label: 'Horizon chaotic feedback network', desc: '4-line feedback delay network, gravity past 100% self-oscillates, chaos (delay FM), warp, freeze', prefix: 'horizon', make: id => Horizon(id) }
  };
  Object.values(TYPES).forEach(t => { t.fx = true; });
  Object.assign(Mods.TYPES, TYPES);
  return { TYPES, SYNC, syncIx, HALL_TYPES, HEAT_MODELS, makeIR, heatCurve, shiftHz, VKEYS, pitchShifter, follower, lfoOsc, phaseWave, curveOf };
})();
