// modx.js — the six modules from the research wishlist: Contour (Maths-style function generator), Swarm (8 related LFOs),
// Workout (Pamela's-style clock brain), Grains (granular processor), Marbles (quantized random) and Toolbox (utilities).
'use strict';
const ModX = (() => {
  const E = Engine, ctx = E.ctx, { clamp } = DSP;
  const M = E.Module;
  const pct = v => Math.round(v * 100) + '%';
  const secs = v => v < 1 ? Math.round(v * 1000) + 'ms' : v.toFixed(2) + 's';
  const hz = v => v < 1 ? v.toFixed(2) + 'Hz' : v < 10 ? v.toFixed(1) + 'Hz' : Math.round(v) + 'Hz';
  const bip = v => (v >= 0 ? '+' : '') + v.toFixed(2);
  const now = () => ctx.currentTime;
  const rnd = Math.random;
  const smooth = (param, v, tc = 0.02) => { param.cancelScheduledValues(now()); param.setTargetAtTime(v, now(), tc); };
  const constSrc = (v = 0) => { const c = ctx.createConstantSource(); c.offset.value = v; c.start(); return c; };
  const gain = (v = 1) => { const g = ctx.createGain(); g.gain.value = v; return g; };
  // A silent path to the speakers keeps analysers and script processors running in every browser
  const sink = gain(0); sink.connect(ctx.destination);
  // Read the current value of a signal (lets CV inputs steer things that are scheduled in JavaScript)
  function reader(node) {
    const an = ctx.createAnalyser(); an.fftSize = 32; node.connect(an); an.connect(sink);
    const buf = new Float32Array(32);
    return () => { an.getFloatTimeDomainData(buf); return buf[31]; };
  }

  // ======================= CONTOUR: dual function generator =======================
  // Each channel rises then falls when triggered, or loops when cycling. Curves go from log through linear to exponential.
  function Contour(id) {
    const m = new M(id, { name: 'Contour', sub: 'dual function generator · envelopes, LFOs, slew', width: 330, stripe: '#e9e6dc', family: 'mod' });
    const sum = gain(1), inv = gain(-1); sum.connect(inv);
    const shape = (p, c) => c >= 0 ? Math.pow(p, 1 + c * 3) : 1 - Math.pow(1 - p, 1 - c * 3);
    const curveOf = (v0, v1, c, rising) => { const a = new Float32Array(48); for (let i = 0; i < 48; i++) { const p = i / 47; const s = rising ? shape(p, c) : 1 - shape(1 - p, c); a[i] = v0 + (v1 - v0) * s; } return a; };
    m.ch = [1, 2].map(k => {
      const src = constSrc(0), lvl = gain(0.8), inp = gain(1);
      src.connect(lvl); inp.connect(lvl); lvl.connect(sum);
      return { k, src, lvl, inp, segs: [], riseEnd: 0, end: 0 };
    });
    for (const k of [1, 2]) {
      m.p('r' + k, { label: 'Rise ' + k, min: 0.002, max: 10, curve: 'exp', def: k === 1 ? 0.25 : 0.5, fmt: secs, small: true });
      m.p('f' + k, { label: 'Fall ' + k, min: 0.002, max: 10, curve: 'exp', def: k === 1 ? 0.45 : 0.5, fmt: secs, small: true });
      m.p('c' + k, { label: 'Curve ' + k, min: -1, max: 1, def: 0.5, fmt: v => v < -0.2 ? 'LOG' : v > 0.2 ? 'EXP' : 'LIN', small: true });
      m.p('cy' + k, { label: 'Cycle ' + k, steps: ['OFF', 'ON'], def: k === 2 ? 1 : 0, small: true });
      m.p('l' + k, { label: 'Level ' + k, min: -1, max: 1, def: 0.9, fmt: bip, small: true, apply: v => smooth(m.ch[k - 1].lvl.gain, v) });
    }
    // value of a channel at time t, from the segments it has scheduled
    const valueAt = (ch, t) => {
      for (let i = ch.segs.length - 1; i >= 0; i--) { const s = ch.segs[i]; if (t >= s.t0) { if (t >= s.t1) return s.v1; const p = (t - s.t0) / (s.t1 - s.t0); return s.v0 + (s.v1 - s.v0) * (s.rise ? shape(p, s.c) : 1 - shape(1 - p, s.c)); } }
      return 0;
    };
    m.fire = function (k, t, force) {
      const ch = this.ch[k - 1];
      if (!force && t < ch.riseEnd) return; // like Maths: ignores triggers while rising
      const r = this.v('r' + k), f = this.v('f' + k), c = this.v('c' + k), v0 = clamp(valueAt(ch, t));
      const rT = Math.max(0.002, r * (1 - v0)), o = ch.src.offset;
      try {
        o.cancelScheduledValues(t); o.setValueAtTime(v0, t);
        o.setValueCurveAtTime(curveOf(v0, 1, c, true), t, rT);
        o.setValueCurveAtTime(curveOf(1, 0, c, false), t + rT + 0.0005, f);
      } catch (e) { // a curve still running at t: hold and ramp instead
        o.cancelScheduledValues(now()); o.setValueAtTime(v0, t); o.linearRampToValueAtTime(1, t + rT); o.linearRampToValueAtTime(0, t + rT + f);
      }
      ch.segs = ch.segs.filter(s => s.t1 > now() - 0.5 && s.t0 < t);
      ch.segs.push({ t0: t, t1: t + rT, v0, v1: 1, c, rise: true }, { t0: t + rT, t1: t + rT + f, v0: 1, v1: 0, c, rise: false });
      ch.riseEnd = t + rT; ch.end = t + rT + f + 0.0006;
      if (k === 1) this.emit('EOR', { kind: 'trig', time: t + rT });
      else this.emit('EOC', { kind: 'trig', time: ch.end });
      E.at(t, () => this.ui?.hit?.(k));
    };
    m.inEvent('TRIG1', function (e) { this.fire(1, e.time); }, 'trigger channel 1');
    m.inEvent('TRIG2', function (e) { this.fire(2, e.time); }, 'trigger channel 2');
    m.inAudio('IN1', m.ch[0].inp, 'signal through level 1'); m.inAudio('IN2', m.ch[1].inp, 'signal through level 2');
    m.outAudio('OUT1', m.ch[0].lvl, 'channel 1', true); m.outAudio('OUT2', m.ch[1].lvl, 'channel 2', true);
    m.outAudio('SUM', sum, 'channel 1 + 2', true); m.outAudio('INV', inv, 'inverted sum', true);
    m.outEvent('EOR', 'end of rise (ch 1)'); m.outEvent('EOC', 'end of cycle (ch 2)');
    m.tick = function (t0, horizon) {
      for (const k of [1, 2]) {
        if (!this.v('cy' + k)) continue;
        const ch = this.ch[k - 1]; let guard = 0;
        if (ch.end < t0) this.fire(k, t0 + 0.005, true);
        while (ch.end < horizon && guard++ < 64) this.fire(k, ch.end, true);
      }
    };
    m.readers = m.ch.map(ch => reader(ch.lvl));
    m.layout = [{ custom: 'contour' }, { k: ['r1', 'f1', 'c1', 'cy1', 'l1', 'r2', 'f2', 'c2', 'cy2', 'l2'], cls: 'kgrid five' }];
    return m;
  }

  // ======================= SWARM: eight related LFOs =======================
  const SW_SHAPES = ['SINE', 'TRI', 'SAW', 'RAMP', 'SQR', 'STEP'];
  const SW_SYNC = ['FREE', '4 BAR', '2 BAR', '1 BAR', '1/2', '1/4', '1/8', '1/16'];
  const SW_BEATS = [0, 16, 8, 4, 2, 1, 0.5, 0.25];
  function Swarm(id) {
    const m = new M(id, { name: 'Swarm', sub: '8 related LFOs · phase and rate spread', width: 420, stripe: '#5fd39a', family: 'mod' });
    const sum = gain(1 / 4), off = constSrc(0);
    m.lfos = Array.from({ length: 8 }, () => { const o = ctx.createOscillator(), g = gain(0.5), out = gain(1); o.frequency.value = 0.5; o.connect(g); g.connect(out); off.connect(out); out.connect(sum); return { o, g, out }; });
    const t0 = now() + 0.05; m.lfos.forEach(l => l.o.start(t0));
    const fnFor = (name, ph) => { const f = { SINE: p => Math.sin(DSP.TAU * p), TRI: DSP.shapes.tri, SAW: DSP.shapes.saw, RAMP: p => 2 * p - 1, SQR: DSP.shapes.square, STEP: p => Math.round(Math.sin(DSP.TAU * p) * 3) / 3 }[name]; return p => f((p + ph) % 1); };
    let tmr = 0;
    const rebuild = () => { clearTimeout(tmr); tmr = setTimeout(() => {
      const sh = m.params.shape.choice, ph = m.v('phase');
      m.lfos.forEach((l, i) => l.o.setPeriodicWave(DSP.waveFromFn(ctx, fnFor(sh, (i / 8) * ph), sh === 'SINE' ? 2 : 32, 256)));
    }, 30); };
    const retune = () => {
      const beats = SW_BEATS[m.v('sync')], base = beats ? E.bpm / 60 / beats : m.v('rate'), sp = m.v('spread');
      m.lfos.forEach((l, i) => smooth(l.o.frequency, base * (1 + sp * i * 0.37), 0.05));
    };
    const depth = () => { const d = m.v('depth'), uni = m.v('pol') === 1; m.lfos.forEach(l => smooth(l.g.gain, uni ? d / 2 : d)); smooth(off.offset, uni ? m.v('depth') / 2 : 0); };
    m.p('rate', { label: 'Rate', min: 0.02, max: 20, curve: 'exp', def: 0.35, fmt: hz, apply: retune });
    m.p('sync', { label: 'Sync', steps: SW_SYNC, def: 0, apply: retune });
    m.p('spread', { label: 'Rate spr', def: 0.3, fmt: pct, apply: retune });
    m.p('phase', { label: 'Phase spr', def: 1, fmt: pct, apply: rebuild });
    m.p('shape', { label: 'Shape', steps: SW_SHAPES, def: 0, apply: rebuild });
    m.p('depth', { label: 'Depth', def: 0.6, fmt: pct, apply: depth });
    m.p('pol', { label: 'Polarity', steps: ['BI', 'UNI'], def: 0, apply: depth });
    E.on('bpm', () => { if (!m.disposed) retune(); });
    m.inCV('RATE', m.lfos.map(l => l.o.detune), 2400, 'rate CV (2 octaves per unit)');
    m.lfos.forEach((l, i) => m.outAudio('O' + (i + 1), l.out, 'LFO ' + (i + 1), true));
    m.outAudio('SUM', sum, 'all eight mixed', true);
    m.readers = m.lfos.map(l => reader(l.out));
    m.lfo = null;
    m.layout = [{ custom: 'swarm' }, { k: ['rate', 'sync', 'spread', 'phase', 'shape', 'depth', 'pol'], cls: 'kgrid' }];
    return m;
  }

  // ======================= WORKOUT: eight-output clock brain =======================
  const WO_RATES = ['4BAR', '2BAR', 'BAR', '1/2', '1/4', '1/8', '1/8T', '1/16', '1/16T', '1/32'];
  const WO_PPB = [1 / 16, 1 / 8, 1 / 4, 1 / 2, 1, 2, 3, 4, 6, 8]; // pulses per beat
  const WO_DEF = ['BAR', '1/4', '1/8', '1/16', '1/8T', '1/2', '2BAR', '1/16'];
  function Workout(id) {
    const m = new M(id, { name: 'Workout', sub: '8 outputs · divide, multiply, euclid, chance', width: 440, stripe: '#ffb03b', family: 'clock' });
    for (let i = 1; i <= 8; i++) m.p('r' + i, { label: 'Rate ' + i, steps: WO_RATES, def: WO_RATES.indexOf(WO_DEF[i - 1]) / (WO_RATES.length - 1), small: true });
    for (let i = 1; i <= 8; i++) m.p('e' + i, { label: 'Euc ' + i, steps: ['OFF', ...Array.from({ length: 15 }, (_, k) => k + 1)], def: i === 8 ? 5 / 15 : 0, small: true });
    for (let i = 1; i <= 8; i++) m.p('p' + i, { label: 'Prob ' + i, def: 1, fmt: pct, small: true });
    m.p('shift', { label: 'Shift', steps: Array.from({ length: 16 }, (_, k) => k), def: 0, small: true });
    m.c = 0;
    m.inEvent('CLK', function (e) { this.clock(e); }, '16th-note clock in');
    m.inEvent('RST', function () { this.c = 0; }, 'reset to the downbeat');
    for (let i = 1; i <= 8; i++) m.outEvent('O' + i, 'clock output ' + i);
    m.clock = function (e) {
      const d = e.dur || E.sixteenth(), b0 = this.c / 4, b1 = (this.c + 1) / 4, sh = this.v('shift');
      this.c++;
      for (let i = 1; i <= 8; i++) {
        const r = WO_PPB[this.v('r' + i)], k = this.v('e' + i), pr = this.v('p' + i);
        for (let n = Math.ceil(b0 * r - 1e-6); n / r < b1 - 1e-6; n++) {
          if (k) { const s = ((n + sh) % 16 + 16) % 16; if ((s * k) % 16 >= k) continue; }
          if (pr < 1 && rnd() > pr) continue;
          const t = e.time + (n / r - b0) * 4 * d;
          this.emit('O' + i, { kind: 'trig', time: t, vel: 0.85, dur: Math.min(0.25, 2 * d / Math.max(1, r)) });
          E.at(t, () => this.ui?.led(i));
        }
      }
    };
    const keys = []; for (const p of ['r', 'e', 'p']) for (let i = 1; i <= 8; i++) keys.push(p + i);
    m.layout = [{ custom: 'workout' }, { k: keys, cls: 'kgrid grid8' }, { k: ['shift'], cls: 'kgrid c' }];
    return m;
  }

  // ======================= GRAINS: granular processor =======================
  const GR_PITCH = ['-24', '-12', '-7', '-5', '0', '+5', '+7', '+12', '+24'];
  function Grains(id) {
    const m = new M(id, { name: 'Grains', sub: 'granular texture · freeze · spray · feedback', width: 380, stripe: '#d9c48f', family: 'fx' });
    const SEC = 6, sr = ctx.sampleRate, N = SEC * sr;
    const ring = new Float32Array(N); let w = 0;
    const PEAKS = 240, peaks = new Float32Array(PEAKS);
    const inp = gain(1), rec = gain(1), dry = gain(0), wet = gain(1), out = gain(0.9), fb = gain(0), wetBus = gain(1);
    const sat = ctx.createWaveShaper(); sat.curve = DSP.curveTanh(0.2);
    inp.connect(rec); inp.connect(dry); dry.connect(out);
    wetBus.connect(sat); sat.connect(wet); wet.connect(out); sat.connect(fb); fb.connect(rec);
    const sp = ctx.createScriptProcessor(2048, 1, 1);
    rec.connect(sp); sp.connect(sink);
    m.frozen = false;
    sp.onaudioprocess = ev => {
      if (m.disposed) { sp.onaudioprocess = null; try { sp.disconnect(); rec.disconnect(); } catch (e) { /* gone */ } return; }
      if (m.frozen) return;
      const d = ev.inputBuffer.getChannelData(0);
      for (let i = 0; i < d.length; i++) { ring[w] = d[i]; const b = Math.floor(w / N * PEAKS); if (w % Math.floor(N / PEAKS) === 0) peaks[b] = 0; peaks[b] = Math.max(peaks[b], Math.abs(d[i])); w = (w + 1) % N; }
      m.wTime = ctx.currentTime; m.w = w;
    };
    m.w = 0; m.wTime = 0; m.peaks = peaks; m.N = N; m.recent = [];
    m.p('pos', { label: 'Position', def: 0.15, fmt: v => (v * (SEC - 0.6)).toFixed(1) + 's ago' });
    m.p('size', { label: 'Size', min: 0.02, max: 0.6, curve: 'exp', def: 0.55, fmt: secs });
    m.p('dens', { label: 'Density', min: 1, max: 60, curve: 'exp', def: 0.55, fmt: v => v.toFixed(1) + '/s' });
    m.p('pitch', { label: 'Pitch', steps: GR_PITCH, def: 0.5 });
    m.p('spray', { label: 'Spray', def: 0.25, fmt: pct });
    m.p('rev', { label: 'Reverse', def: 0.1, fmt: pct });
    m.p('freeze', { label: 'Freeze', steps: ['OFF', 'ON'], def: 0, apply: v => { m.frozen = !!v; m.ui?.frz?.(!!v); } });
    m.p('fb', { label: 'Feedback', min: 0, max: 0.65, def: 0, fmt: pct, apply: v => smooth(fb.gain, v) });
    m.p('mix', { label: 'Mix', def: 0.7, fmt: pct, apply: v => { smooth(wet.gain, Math.sqrt(v) * 1.2); smooth(dry.gain, Math.sqrt(1 - v)); } });
    m.p('level', { label: 'Level', def: 0.8, fmt: pct, apply: v => smooth(out.gain, v * 1.1) });
    const posCV = gain(1), densCV = gain(1);
    const readPos = reader(posCV), readDens = reader(densCV);
    m.inAudio('IN', inp, 'audio to granulate');
    m.ins.POS = { kind: 'sig', jt: 'cv', node: posCV, desc: 'position CV' };
    m.ins.DENS = { kind: 'sig', jt: 'cv', node: densCV, desc: 'density CV' };
    m.inEvent('FRZ', function () { this.params.freeze.setNorm(this.frozen ? 0 : 1); }, 'toggle freeze');
    m.inEvent('TRIG', function (e) { for (let i = 0; i < 4; i++) this.grain(e.time + i * 0.012); }, 'burst of grains');
    m.outAudio('OUT', out, 'grains out');
    const win = (() => { const a = new Float32Array(32); for (let i = 0; i < 32; i++) a[i] = Math.sin(Math.PI * i / 31) ** 2; return a; })();
    let live = 0;
    m.grain = function (t) {
      if (live > 40) return;
      const size = this.v('size'), ratio = Math.pow(2, parseInt(this.params.pitch.choice, 10) / 12);
      const need = Math.ceil(size * ratio * sr) + 2;
      const posN = clamp(this.v('pos') + readPos() * 0.5);
      let back = (0.05 + posN * (SEC - 0.7)) * sr + rnd() * this.v('spray') * 1.2 * sr;
      const ahead = Math.max(0, (t - this.wTime)) * sr; // the write head moves on before this grain plays
      back = Math.min(N - need - 1, Math.max(back, need + ahead + 0.03 * sr));
      let start = Math.floor(this.w - back); start = ((start % N) + N) % N;
      const buf = ctx.createBuffer(1, need, sr), d = buf.getChannelData(0);
      const first = Math.min(need, N - start); d.set(ring.subarray(start, start + first)); if (first < need) d.set(ring.subarray(0, need - first), first);
      if (rnd() < this.v('rev')) d.reverse();
      const s = ctx.createBufferSource(); s.buffer = buf; s.playbackRate.value = ratio;
      const g = gain(0), pan = ctx.createStereoPanner(); pan.pan.value = (rnd() * 2 - 1) * 0.7;
      s.connect(g); g.connect(pan); pan.connect(wetBus);
      const tt = Math.max(t, now() + 0.005);
      g.gain.setValueCurveAtTime(win, tt, size);
      s.start(tt); s.stop(tt + size + 0.02); live++;
      s.onended = () => { live--; try { pan.disconnect(); } catch (e) { /* gone */ } };
      this.recent.push({ t: tt, at: start / N, len: need / N });
      if (this.recent.length > 40) this.recent.shift();
    };
    m.next = 0;
    m.tick = function (t0, horizon) {
      if (this.next < t0) this.next = t0 + 0.01;
      const dens = clamp(this.v('dens') * Math.pow(2, readDens() * 2), 0.5, 90);
      let guard = 0;
      while (this.next < horizon && guard++ < 40) { this.grain(this.next); this.next += (1 / dens) * (0.6 + rnd() * 0.8); }
    };
    m.layout = [{ custom: 'grains' }, { k: ['pos', 'size', 'dens', 'pitch', 'spray', 'rev', 'freeze', 'fb', 'mix', 'level'], cls: 'kgrid five' }];
    return m;
  }

  // ======================= MARBLES: quantized random =======================
  const MB_DIV = ['1/16', '1/8', '1/4', '1/2'], MB_TICKS = [1, 2, 4, 8];
  function Marbles(id) {
    const m = new M(id, { name: 'Marbles', sub: 'random gates and voltages · déjà vu loop · quantizer', width: 360, stripe: '#4fd0d8', family: 'seq' });
    m.p('div', { label: 'Rate', steps: MB_DIV, def: 1 / 3, small: true });
    m.p('jitter', { label: 'Jitter', def: 0.1, fmt: pct, small: true });
    m.p('tbias', { label: 'T bias', def: 0.5, fmt: pct, small: true });
    m.p('deja', { label: 'Déjà vu', def: 0.5, fmt: pct, small: true });
    m.p('len', { label: 'Loop', steps: Array.from({ length: 16 }, (_, i) => i + 1), def: 7 / 15, small: true });
    m.p('spread', { label: 'Spread', def: 0.5, fmt: pct, small: true });
    m.p('xbias', { label: 'X bias', def: 0.5, fmt: pct, small: true });
    m.p('steps', { label: 'Steps', steps: ['SMOOTH', 'STEPPED', 'QUANT'], def: 1, small: true });
    m.p('scale', { label: 'Scale', steps: DSP.SCALE_NAMES, def: 4 / 8, small: true, apply: () => m.buildQ() });
    m.p('root', { label: 'Root', steps: DSP.NOTE_NAMES, def: 9 / 11, small: true, apply: () => m.buildQ() });
    m.p('oct', { label: 'Octave', steps: [1, 2, 3, 4, 5, 6], def: 0.4, small: true });
    m.p('range', { label: 'Range', min: 0.25, max: 4, def: 0.4, fmt: v => v.toFixed(1) + 'oct', small: true });
    const xs = [constSrc(0), constSrc(0), constSrc(0)];
    const qsh = ctx.createWaveShaper(), qin = gain(1); qin.connect(qsh);
    m.buildQ = () => {
      const sc = DSP.SCALES[m.params.scale.choice] || DSP.SCALES.MINOR, root = m.v('root');
      const n = 4097, c = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        const midi = 48 + 36 * (i / (n - 1) * 2 - 1); let best = midi, bd = 1e9;
        for (let o = -1; o <= 9; o++) for (const s of sc) { const q = 12 * o + root + s; const dd = Math.abs(q - midi); if (dd < bd) { bd = dd; best = q; } }
        c[i] = (best - 48) / 36;
      }
      qsh.curve = c;
    };
    m.inEvent('CLK', function (e) { this.clock(e); }, 'clock in (16ths)');
    m.inEvent('RST', function () { this.cnt = 0; this.pulse = 0; }, 'reset the loop');
    m.inAudio('QIN', qin, 'pitch CV to quantize');
    m.outEvent('T1', 'random gates (coin heads)'); m.outEvent('T2', 'steady jittered clock'); m.outEvent('T3', 'random gates (coin tails)');
    m.outEvent('NOTE', 'quantized notes on each T2');
    xs.forEach((x, i) => m.outAudio('X' + (i + 1), x, 'random voltage ' + (i + 1), true));
    m.outAudio('QOUT', qsh, 'quantized pitch CV', true);
    m.cnt = 0; m.pulse = 0; m.mem = { t: [], x: [[], [], []] }; m.hist = [];
    const draw = () => { // spread: narrow bell curve when low, flat and wide when high
      const sp = m.v('spread'), b = m.v('xbias');
      const g = (rnd() + rnd() + rnd() + rnd() - 2) / 2; // about -1..1, bell shaped
      const u = rnd() * 2 - 1;
      return clamp(b + (sp < 0.5 ? g * sp * 0.9 : (g * (1 - sp) * 2 + u * (sp - 0.5) * 2) * 0.5));
    };
    m.clock = function (e) {
      const div = MB_TICKS[this.v('div')];
      if ((this.cnt++ % div) !== 0) return;
      const d = (e.dur || E.sixteenth()) * div, len = this.v('len') + 1, slot = this.pulse++ % len, dv = this.v('deja');
      const t = Math.max(now() + 0.004, e.time + (rnd() - 0.5) * this.v('jitter') * d * 0.9);
      let coin = this.mem.t[slot];
      if (coin == null || rnd() > dv) { coin = rnd() < this.v('tbias'); this.mem.t[slot] = coin; }
      this.emit('T2', { kind: 'trig', time: t, vel: 0.8 });
      this.emit(coin ? 'T1' : 'T3', { kind: 'trig', time: t, vel: 0.8 });
      const mode = this.params.steps.choice, sc = this.params.scale.choice, oct = this.params.oct.choice, root = this.v('root'), range = this.v('range');
      const nDeg = (DSP.SCALES[sc] || DSP.SCALES.MINOR).length;
      let midi0 = 0;
      for (let k = 0; k < 3; k++) {
        let v = this.mem.x[k][slot];
        if (v == null || rnd() > dv) { v = draw(); this.mem.x[k][slot] = v; }
        const deg = Math.round(v * range * nDeg);
        const qm = 12 * (oct + 1) + root + DSP.degreeToSemi(sc, deg), fm = 12 * (oct + 1) + root + v * range * 12;
        const cv = ((mode === 'QUANT' ? qm : fm) - 48) / 36, o = xs[k].offset;
        if (mode === 'SMOOTH') { o.cancelScheduledValues(t); o.setTargetAtTime(cv, t, d * 0.35); } else o.setValueAtTime(cv, t);
        if (k === 0) { midi0 = qm; this.hist.push({ v, coin }); if (this.hist.length > 48) this.hist.shift(); }
      }
      this.emit('NOTE', { kind: 'note', time: t, midi: midi0, dur: d * 0.6, vel: coin ? 0.95 : 0.7, acc: coin ? 1 : 0 });
      E.at(t, () => this.ui?.draw?.());
    };
    m.layout = [{ custom: 'marbles' }, { k: ['div', 'jitter', 'tbias', 'deja', 'len', 'spread', 'xbias', 'steps', 'scale', 'root', 'oct', 'range'], cls: 'kgrid six' }];
    return m;
  }

  // ======================= TOOLBOX: VCAs, offset, sample & hold, logic, crossfade =======================
  function Toolbox(id) {
    const m = new M(id, { name: 'Toolbox', sub: '4 VCAs · offset · S&H · slew · logic · crossfade', width: 470, stripe: '#c9ccd2', family: 'util' });
    const mix = gain(1), off = constSrc(0); off.connect(mix);
    m.vca = [1, 2, 3, 4].map(i => { const g = gain(0.8); g.connect(mix); m.inAudio('IN' + i, g, 'VCA ' + i + ' in'); return g; });
    [1, 2, 3, 4].forEach(i => m.p('a' + i, { label: 'VCA ' + i, min: -1, max: 1, def: 0.9, fmt: bip, small: true, apply: v => smooth(m.vca[i - 1].gain, v) }));
    m.p('off', { label: 'Offset', min: -1, max: 1, def: 0.5, fmt: bip, small: true, apply: v => smooth(off.offset, v) });
    const shOut = constSrc(0), shIn = gain(1), readSH = reader(shIn);
    m.p('slew', { label: 'Slew', min: 0.001, max: 2, curve: 'exp', def: 0.1, fmt: secs, small: true });
    const xa = gain(1), xb = gain(1), xga = gain(1), xgb = gain(0), xout = gain(1), xsrc = constSrc(0.5), xinv = gain(-1), xcv = gain(1);
    xa.connect(xga); xb.connect(xgb); xga.connect(xout); xgb.connect(xout);
    xsrc.connect(xgb.gain); xsrc.connect(xinv); xcv.connect(xgb.gain); xcv.connect(xinv); xinv.connect(xga.gain);
    m.p('xf', { label: 'X-fade', def: 0.5, fmt: v => v < 0.05 ? 'A' : v > 0.95 ? 'B' : pct(v), small: true, apply: v => { smooth(xsrc.offset, v); xga.gain.value = 1; xgb.gain.value = 0; } });
    [1, 2, 3, 4].forEach(i => m.inCV('CV' + i, m.vca[i - 1].gain, 1, 'VCA ' + i + ' gain CV'));
    m.ins.SH = { kind: 'sig', jt: 'cv', node: shIn, desc: 'signal to sample (noise if empty)' };
    m.inEvent('TRIG', function (e) { this.sample(e.time); }, 'sample & hold trigger');
    m.inEvent('A', function (e) { this.logic('A', e.time); }, 'logic A');
    m.inEvent('B', function (e) { this.logic('B', e.time); }, 'logic B');
    m.inAudio('XA', xa, 'crossfade A'); m.inAudio('XB', xb, 'crossfade B'); m.ins.XCV = { kind: 'sig', jt: 'cv', node: xcv, desc: 'crossfade CV' };
    ['O1', 'O2', 'O3', 'O4'].forEach((n, i) => m.outAudio(n, m.vca[i], 'VCA ' + (i + 1) + ' out', true));
    m.outAudio('MIX', mix, 'VCAs + offset', true); m.outAudio('HOLD', shOut, 'held value', true);
    m.outEvent('AND', 'A and B together'); m.outEvent('OR', 'A or B'); m.outEvent('XOR', 'A or B, not both');
    m.outAudio('XOUT', xout, 'crossfaded out');
    m.held = 0; m.pend = []; m.lg = { A: 0, B: 0, AND: 0, OR: 0, XOR: 0 };
    m.sample = function (t) {
      const patched = E.cables.some(c => c.to.mod === this.id && c.to.port === 'SH');
      const v = patched ? readSH() : rnd() * 2 - 1;
      this.held = v; const o = shOut.offset; o.cancelScheduledValues(t); o.setTargetAtTime(v, t, this.v('slew') / 3);
      E.at(t, () => this.ui?.sh?.(v));
    };
    const flash = (k, t) => { m.lg[k] = 1; E.at(t, () => m.ui?.led?.(k)); };
    m.logic = function (side, t) {
      flash(side, t);
      const other = side === 'A' ? 'B' : 'A', j = this.pend.findIndex(p => p.side === other && Math.abs(p.t - t) < 0.012);
      if (j >= 0) { this.pend.splice(j, 1); this.emit('AND', { kind: 'trig', time: t }); this.emit('OR', { kind: 'trig', time: t }); flash('AND', t); flash('OR', t); }
      else this.pend.push({ side, t });
    };
    m.tick = function (t0) {
      const keep = [];
      for (const p of this.pend) {
        if (p.t < t0 + 0.08) { this.emit('OR', { kind: 'trig', time: p.t }); this.emit('XOR', { kind: 'trig', time: p.t }); flash('OR', p.t); flash('XOR', p.t); }
        else keep.push(p);
      }
      this.pend = keep;
    };
    m.layout = [{ custom: 'toolbox' }, { k: ['a1', 'a2', 'a3', 'a4', 'off', 'slew', 'xf'], cls: 'kgrid' }];
    return m;
  }

  const TYPES = {
    Contour: { label: 'Contour function generator', desc: 'two rise/fall functions: envelopes, LFOs, slew; EOR/EOC triggers', prefix: 'contour', make: id => Contour(id) },
    Swarm: { label: 'Swarm 8-LFO modulation hub', desc: 'eight related LFOs with rate and phase spread, tempo sync', prefix: 'swarm', make: id => Swarm(id) },
    Workout: { label: 'Workout clock brain', desc: 'eight clock outputs: divide, multiply, euclidean, chance', prefix: 'work', make: id => Workout(id) },
    Grains: { label: 'Grains granular processor', desc: 'records audio and replays it as clouds of grains; freeze, pitch, spray, feedback', prefix: 'grains', make: id => Grains(id) },
    Marbles: { label: 'Marbles random generator', desc: 'random gates (T1-T3) and voltages (X1-X3), déjà vu looping, quantized NOTE out, CV quantizer', prefix: 'marbles', make: id => Marbles(id) },
    Toolbox: { label: 'Toolbox utilities', desc: '4 VCAs/attenuverters with CV, offset, sample & hold with slew, AND/OR/XOR logic, crossfader', prefix: 'tools', make: id => Toolbox(id) }
  };
  Object.assign(Mods.TYPES, TYPES);
  return { TYPES, Contour, Swarm, Workout, Grains, Marbles, Toolbox, WO_RATES, GR_PITCH };
})();
