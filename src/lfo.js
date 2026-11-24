// lfo.js — the modulation suite: Orbit (four morphing LFOs), Performer (drawn curve sequencer), Attractor (chaotic
// LFOs), Macros (four macro knobs and a build riser) and Follower (envelope follower). Their outputs are control
// signals: patch them into CV jacks, or drop the cable straight onto any knob to modulate it.
'use strict';
const LFO = (() => {
  const E = Engine, ctx = E.ctx, { clamp } = DSP, M = E.Module, TAU = Math.PI * 2;
  const now = () => ctx.currentTime;
  const pct = v => Math.round(v * 100) + '%';
  const bip = v => (v >= 0 ? '+' : '') + Math.round(v * 100) + '%';
  const secs = v => v < 1 ? Math.round(v * 1000) + 'ms' : v.toFixed(2) + 's';
  const gain = (v = 1) => { const g = ctx.createGain(); g.gain.value = v; return g; };
  const constSrc = (v = 0) => { const c = ctx.createConstantSource(); c.offset.value = v; c.start(); return c; };
  const smooth = (param, v, tc = 0.02) => { param.cancelScheduledValues(now()); param.setTargetAtTime(v, now(), tc); };
  const hash = (k, l, s = 0) => { const x = Math.sin(k * 12.9898 + l * 78.233 + s * 37.719) * 43758.5453; return x - Math.floor(x); };
  // where the transport is, in beats (free-running at the tempo when stopped)
  const beatAt = t => E.running ? (E.step - (E.nextTime - t) / E.sixteenth()) / 4 : t * E.bpm / 60;

  // Control-rate generator: computes every output 500 times a second, a little ahead of the audio clock, and
  // schedules the points as value curves on ConstantSources. step(t, dt) returns one value per output.
  const DT = 1 / 500, N = 16;
  function generator(m, outs, step) {
    m.tEnd = 0; m.hist = []; m.hk = 0;
    return function (t0, horizon) {
      if (this.tEnd < t0) this.tEnd = t0 + 0.005;
      let guard = 0;
      while (this.tEnd + N * DT <= horizon + 0.03 && guard++ < 40) {
        const arrs = outs.map(() => new Float32Array(N));
        for (let i = 0; i < N; i++) {
          const t = this.tEnd + i * DT, v = step(t, DT);
          for (let k = 0; k < outs.length; k++) arrs[k][i] = v[k];
          if ((this.hk++ & 3) === 0) this.hist.push([t, ...v]);
        }
        // never let a chunk start inside the previous one (Web Audio refuses overlapping curves)
        const t1 = Math.max(this.tEnd, (this.lastEnd || 0) + 2e-4), dur = (N - 1) * DT;
        outs.forEach((o, k) => { try { o.offset.setValueCurveAtTime(arrs[k], t1, dur); } catch (e) { try { o.offset.cancelScheduledValues(t1); o.offset.setValueAtTime(arrs[k][N - 1], t1 + dur); } catch (e2) { /* skip this chunk */ } } });
        this.lastEnd = t1 + dur; this.tEnd = t1 + N * DT;
      }
      if (this.hist.length > 900) this.hist.splice(0, this.hist.length - 700);
    };
  }

  // ======================= ORBIT: four morphing, cross-modulating LFOs =======================
  const SHAPES = ['SINE', 'TRI', 'SAW', 'RAMP', 'SQR', 'PULSE', 'S&H', 'DRIFT', 'BOUNCE', 'STAIRS', 'PLUCK'];
  const SYNC = [['8 BAR', 32], ['4 BAR', 16], ['2 BAR', 8], ['1 BAR', 4], ['1/2.', 3], ['1/2', 2], ['1/4.', 1.5], ['1/2T', 4 / 3], ['1/4', 1], ['1/8.', 0.75], ['1/4T', 2 / 3], ['1/8', 0.5], ['1/8T', 1 / 3], ['1/16', 0.25], ['1/16T', 1 / 6], ['1/32', 0.125]];
  const shapeFn = (i, ph, cyc, lane) => {
    switch (i) {
      case 0: return Math.sin(TAU * ph);
      case 1: return 1 - 4 * Math.abs(((ph + 0.25) % 1) - 0.5);
      case 2: return 1 - 2 * ph;
      case 3: return 2 * ph - 1;
      case 4: return ph < 0.5 ? 1 : -1;
      case 5: return ph < 0.22 ? 1 : -1;
      case 6: return hash(cyc, lane) * 2 - 1;
      case 7: { const a = hash(cyc, lane), b = hash(cyc + 1, lane); return (a + (b - a) * (1 - Math.cos(Math.PI * ph)) / 2) * 2 - 1; }
      case 8: return Math.abs(Math.cos(Math.PI * 4 * Math.pow(ph, 0.7))) * (1 - ph) * 2 - 1;
      case 9: return Math.floor(ph * 4) / 3 * 2 - 1;
      default: return Math.exp(-6 * ph) * 2 - 1;
    }
  };
  const rateHz = n => 0.01 * Math.pow(4000, n);
  const syncOf = n => SYNC[Math.round(clamp(n) * (SYNC.length - 1))];
  function Orbit(id) {
    const m = new M(id, { name: 'Orbit', sub: '4 morphing LFOs · sync · cross-mod · fade-in', width: 430, stripe: '#52f2ff', family: 'mod' });
    const outs = [1, 2, 3, 4].map(() => constSrc(0)), sum = gain(0.25); outs.forEach(o => o.connect(sum));
    const defs = [[0.55, 0, 0.8], [0.4, 0.1, 0.8], [0.72, 0.6, 0.6], [0.3, 0.7, 0.7]];
    for (let i = 1; i <= 4; i++) {
      const [r, s, d] = defs[i - 1];
      m.p('r' + i, { label: 'Rate ' + i, def: r, small: true, fmt: () => m.v('sync') === 1 ? syncOf(m.params['r' + i].nm)[0] : rateHz(m.params['r' + i].nm).toFixed(2) + 'Hz' });
      m.p('s' + i, { label: 'Shape ' + i, def: s, small: true, fmt: () => { const x = clamp(m.params['s' + i].nm) * (SHAPES.length - 1), k = Math.round(x); return Math.abs(x - k) < 0.12 ? SHAPES[k] : SHAPES[Math.floor(x)] + '›' + SHAPES[Math.min(SHAPES.length - 1, Math.floor(x) + 1)]; } });
      m.p('d' + i, { label: 'Depth ' + i, min: -1, max: 1, def: (d + 1) / 2, small: true, fmt: bip });
    }
    m.p('sync', { label: 'Clock', steps: ['FREE', 'SYNC'], def: 1 });
    m.p('xmod', { label: 'X-mod', def: 0, fmt: pct });
    m.p('fade', { label: 'Fade in', min: 0, max: 4, def: 0, fmt: secs });
    m.p('phs', { label: 'Phase spr', def: 0, fmt: pct });
    m.p('pol', { label: 'Polarity', steps: ['BI', 'UNI'], def: 0 });
    const L = [0, 1, 2, 3].map(i => ({ ph: i * 0.1, cyc: 0, off: 0, trig: -1, v: 0 }));
    m.pending = [];
    m.inEvent('TRIG', function (e) { this.pending.push(e.time); }, 'restart all four (with fade-in)');
    const step = (t, dt) => {
      while (m.pending.length && m.pending[0] <= t) { const tt = m.pending.shift(); L.forEach(l => { l.ph = 0; l.off = beatAt(tt); l.trig = tt; l.cyc++; }); }
      const sync = m.v('sync') === 1, xm = m.v('xmod'), fade = m.v('fade'), uni = m.v('pol') === 1, ps = m.v('phs');
      return L.map((l, i) => {
        const prev = L[(i + 3) % 4].v, rn = m.params['r' + (i + 1)].nm;
        let ph;
        if (sync) {
          const len = syncOf(rn)[1], b = (beatAt(t) - l.off) / len + i * ps * 0.25 + xm * 0.25 * prev;
          const c = Math.floor(b); if (c !== l.lastC) { l.cyc++; l.lastC = c; } ph = b - c;
        } else {
          l.ph += rateHz(rn) * Math.pow(2, xm * 3 * prev) * dt; if (l.ph >= 1) { l.ph -= Math.floor(l.ph); l.cyc++; }
          ph = (l.ph + i * ps * 0.25) % 1;
        }
        const sx = clamp(m.params['s' + (i + 1)].nm) * (SHAPES.length - 1), k = Math.min(SHAPES.length - 2, Math.floor(sx)), f = sx - k;
        let v = shapeFn(k, ph, l.cyc, i) * (1 - f) + shapeFn(k + 1, ph, l.cyc, i) * f;
        if (fade > 0.01 && l.trig >= 0) v *= clamp((t - l.trig) / fade);
        l.v = v;
        if (uni) v = (v + 1) / 2;
        return v * m.v('d' + (i + 1));
      });
    };
    m.tick = generator(m, outs, step);
    outs.forEach((o, i) => m.outAudio('O' + (i + 1), o, 'LFO ' + (i + 1), true));
    m.outAudio('SUM', sum, 'all four mixed', true);
    m.layout = [{ custom: 'orbit' }, { k: ['r1', 's1', 'd1', 'r2', 's2', 'd2', 'r3', 's3', 'd3', 'r4', 's4', 'd4', 'sync', 'xmod', 'fade', 'phs', 'pol'], cls: 'kgrid orbitgrid' }];
    return m;
  }

  // ======================= PERFORMER: two lanes of drawn curve steps =======================
  const PSHAPES = ['HOLD', 'UP', 'DOWN', 'TRI', 'HUMP', 'EXP UP', 'EXP DN', 'DOUBLE', 'WOBBLE', 'OFF'];
  const PGLYPH = ['▬', '◢', '◣', '▲', '◠', '⌒', '⌓', 'ʌʌ', '∿', '·'];
  const pfn = (s, x) => [1, x, 1 - x, 1 - Math.abs(2 * x - 1), Math.sin(Math.PI * x), x * x * x, (1 - x) ** 3, 1 - ((x * 2) % 1), 0.5 - 0.5 * Math.cos(4 * Math.PI * x), 0][s];
  const PLEN = ['1/2 BAR', '1 BAR', '2 BAR', '4 BAR'], PLB = [2, 4, 8, 16];
  const st = (s, v = 1) => ({ s: PSHAPES.indexOf(s), v });
  const PRESETS = {
    PUMP: () => Array.from({ length: 16 }, (_, i) => i % 4 === 0 ? st('EXP UP') : st('HOLD')),
    GATE: () => 'x.xxx.x.x.xxx.xx'.split('').map(c => c === 'x' ? st('HOLD') : st('OFF')),
    RISE: () => Array.from({ length: 16 }, (_, i) => st('HOLD', (i + 1) / 16)),
    WOB8: () => Array.from({ length: 16 }, (_, i) => st(i % 2 ? 'UP' : 'DOWN')),
    WOB16: () => Array.from({ length: 16 }, () => st('TRI')),
    WOB3: () => Array.from({ length: 16 }, (_, i) => st(i % 3 === 2 ? 'UP' : 'DOWN', i % 3 === 2 ? 1 : 0.9)),
    TALK: () => Array.from({ length: 16 }, () => st(['HUMP', 'TRI', 'EXP UP', 'WOBBLE', 'DOWN'][Math.floor(Math.random() * 5)], 0.5 + Math.random() * 0.5)),
    SWEEP: () => Array.from({ length: 16 }, (_, i) => st('HOLD', 0.5 - 0.5 * Math.cos(TAU * i / 16))),
    STAIRS: () => Array.from({ length: 16 }, () => st('HOLD', Math.round(Math.random() * 6) / 6)),
    STUTTER: () => Array.from({ length: 16 }, (_, i) => i >= 12 ? st('DOUBLE') : i % 2 ? st('OFF') : st('HOLD')),
    DUB: () => [st('WOBBLE'), st('WOBBLE'), st('HUMP'), st('OFF'), st('DOWN'), st('DOWN'), st('WOBBLE', 0.8), st('UP'), st('TRI'), st('TRI'), st('HUMP', 0.7), st('OFF'), st('DOUBLE'), st('DOUBLE'), st('WOBBLE'), st('UP')]
  };
  function Performer(id) {
    const m = new M(id, { name: 'Performer', sub: '2 lanes · 16 drawn curve steps · tempo locked', width: 440, stripe: '#ffb03b', family: 'mod' });
    const outs = [constSrc(0), constSrc(0)];
    m.lanes = [PRESETS.WOB8(), PRESETS.PUMP()];
    m.preset = ['WOB8', 'PUMP'];
    m.p('len1', { label: 'Length 1', steps: PLEN, def: 1 / 3, small: true });
    m.p('len2', { label: 'Length 2', steps: PLEN, def: 1 / 3, small: true });
    m.p('d1', { label: 'Depth 1', min: -1, max: 1, def: 0.9, fmt: bip, small: true });
    m.p('d2', { label: 'Depth 2', min: -1, max: 1, def: 0.85, fmt: bip, small: true });
    m.p('smooth', { label: 'Smooth', def: 0.2, fmt: pct, small: true });
    m.p('pol', { label: 'Polarity', steps: ['UNI', 'BI'], def: 0, small: true });
    const ys = [0, 0];
    m.pos = [0, 0];
    m.tick = generator(m, outs, (t, dt) => {
      const tau = 0.0005 + m.v('smooth') * 0.06, a = 1 - Math.exp(-dt / tau), bi = m.v('pol') === 1;
      return [0, 1].map(l => {
        const lb = PLB[m.v('len' + (l + 1))], x = ((beatAt(t) / lb) % 1 + 1) % 1, f = x * 16, i = Math.floor(f), s = m.lanes[l][i];
        m.pos[l] = i;
        const y = s.v * pfn(s.s, f - i); ys[l] += a * (y - ys[l]);
        return (bi ? ys[l] * 2 - 1 : ys[l]) * m.v('d' + (l + 1));
      });
    });
    m.setPreset = function (l, name) { if (!PRESETS[name]) return false; this.lanes[l] = PRESETS[name](); this.preset[l] = name; this.ui?.render?.(); return true; };
    m.getData = () => ({ lanes: m.lanes, preset: m.preset });
    m.setData = d => { m.lanes = d.lanes; m.preset = d.preset; m.ui?.render?.(); };
    m.outAudio('P1', outs[0], 'lane 1 curve', true); m.outAudio('P2', outs[1], 'lane 2 curve', true);
    m.layout = [{ custom: 'performer' }, { k: ['len1', 'len2', 'd1', 'd2', 'smooth', 'pol'], cls: 'kgrid' }];
    return m;
  }

  // ======================= ATTRACTOR: chaotic LFOs =======================
  const MODELS = ['LORENZ', 'ROSSLER', 'THOMAS', 'LOGISTIC'];
  function Attractor(id) {
    const m = new M(id, { name: 'Attractor', sub: 'strange attractors · never-repeating modulation', width: 330, stripe: '#a46ff0', family: 'mod' });
    const outs = [constSrc(0), constSrc(0), constSrc(0)];
    let s = [0.1, 0, 20], lg = [0.4, 0.3, 0.2], lgT = 0, prevX = 0;
    const sm = [0, 0, 0];
    const START = { LORENZ: [-8, 8, 27], ROSSLER: [1, 1, 0.2], THOMAS: [1.1, 0.4, -0.6], LOGISTIC: [0, 0, 0] };
    m.p('model', { label: 'System', steps: MODELS, def: 0, apply: () => { s = START[m.params.model.choice].map(v => v + Math.random() * 0.2); } });
    m.p('speed', { label: 'Speed', min: 0.02, max: 6, curve: 'exp', def: 0.35, fmt: v => v.toFixed(2) + '×' });
    m.p('chaos', { label: 'Chaos', def: 0.5, fmt: pct });
    m.p('smooth', { label: 'Smooth', def: 0.2, fmt: pct });
    m.p('depth', { label: 'Depth', def: 0.8, fmt: pct });
    m.crossings = [];
    const deriv = (md, [x, y, z], c) => {
      if (md === 'LORENZ') { const r = 26 + c * 22; return [10 * (y - x), x * (r - z) - y, x * y - 8 / 3 * z]; }
      if (md === 'ROSSLER') { const cc = 3 + c * 5; return [-y - z, x + 0.2 * y, 0.2 + z * (x - cc)]; }
      const b = 0.32 - c * 0.14; return [Math.sin(y) - b * x, Math.sin(z) - b * y, Math.sin(x) - b * z];
    };
    const SCALE = { LORENZ: [20, 27, [0, 50]], ROSSLER: [12, 12, [0, 22]], THOMAS: [4.5, 4.5, [-4.5, 4.5]] };
    const K = { LORENZ: 0.7, ROSSLER: 6, THOMAS: 25 };
    m.tick = generator(m, outs, (t, dt) => {
      const md = m.params.model.choice, sp = m.v('speed'), c = m.v('chaos'), d = m.v('depth');
      let o;
      if (md === 'LOGISTIC') {
        if (t >= lgT) { const r = 3.5 + c * 0.5; lg = [r * lg[0] * (1 - lg[0]), lg[0], lg[1]]; if (!(lg[0] > 0 && lg[0] < 1)) lg = [0.4, 0.3, 0.2]; lgT = t + 0.25 / sp; }
        o = lg.map(v => v * 2 - 1);
      } else {
        const h = sp * dt * K[md] / 4;
        for (let k = 0; k < 4; k++) { const a = deriv(md, s, c), mid = s.map((v, j) => v + a[j] * h / 2), b = deriv(md, mid, c); s = s.map((v, j) => v + b[j] * h); }
        if (!s.every(Number.isFinite) || Math.abs(s[0]) > 1e4) s = START[md].slice();
        const [sx, sy, [z0, z1]] = SCALE[md];
        o = [clamp(s[0] / sx, -1, 1), clamp(s[1] / sy, -1, 1), clamp((s[2] - z0) / (z1 - z0) * 2 - 1, -1, 1)];
      }
      const a = 1 - Math.exp(-dt / (0.0005 + m.v('smooth') * 0.15));
      for (let j = 0; j < 3; j++) sm[j] += a * (o[j] - sm[j]);
      if ((sm[0] > 0) !== (prevX > 0)) m.crossings.push(t); prevX = sm[0];
      return sm.map(v => v * d);
    });
    const gen = m.tick;
    m.tick = function (t0, h) { gen.call(this, t0, h); while (this.crossings.length) { const t = this.crossings.shift(); if (t >= t0 - 0.02) this.emit('CROSS', { kind: 'trig', time: Math.max(t, t0) }); } };
    m.outAudio('X', outs[0], 'X axis', true); m.outAudio('Y', outs[1], 'Y axis', true); m.outAudio('Z', outs[2], 'Z axis', true);
    m.outEvent('CROSS', 'trigger when X crosses zero (chaotic rhythm)');
    m.layout = [{ custom: 'attractor' }, { k: ['model', 'speed', 'chaos', 'smooth', 'depth'], cls: 'kgrid' }];
    return m;
  }

  // ======================= MACROS: four macro knobs and a build riser =======================
  const BARS = [1, 2, 4, 8, 16];
  function Macros(id) {
    const m = new M(id, { name: 'Macros', sub: '4 macro knobs · build riser · drop trigger', width: 360, stripe: '#ff5fa2', family: 'mod' });
    const outs = [1, 2, 3, 4].map(() => constSrc(0)), rise = constSrc(0);
    for (let i = 1; i <= 4; i++) m.p('m' + i, { label: 'Macro ' + i, def: 0, fmt: pct, apply: v => smooth(outs[i - 1].offset, v, 0.03) });
    m.p('bars', { label: 'Build', steps: BARS.map(b => b + (b > 1 ? ' bars' : ' bar')), def: 0.5 });
    m.p('curve', { label: 'Curve', def: 0.6, fmt: v => v < 0.3 ? 'LIN' : v < 0.7 ? 'SOFT' : 'STEEP' });
    m.build = null;
    m.startBuild = function (bars) {
      if (!E.running) return false;
      const nb = bars || BARS[this.v('bars')], dur = E.sixteenth(), toBar = (16 - (E.step % 16)) % 16, t0 = Math.max(E.nextTime + toBar * dur, now() + 0.05), len = nb * 16 * dur;
      const n = 256, c = new Float32Array(n), k = 1 + this.v('curve') * 4; for (let i = 0; i < n; i++) c[i] = Math.pow(i / (n - 1), k);
      const o = rise.offset; o.cancelScheduledValues(now()); o.setValueAtTime(0, t0); o.setValueCurveAtTime(c, t0 + 0.001, len - 0.002); o.setValueAtTime(0, t0 + len);
      this.build = { t0, len, dropAt: t0 + len, sent: false }; return true;
    };
    m.inEvent('BUILD', function () { this.startBuild(); }, 'start a build at the next bar');
    m.tick = function (t0, horizon) { const b = this.build; if (b && !b.sent && b.dropAt < horizon) { b.sent = true; this.emit('DROP', { kind: 'trig', time: Math.max(b.dropAt, t0) }); E.at(b.dropAt, () => this.ui?.drop?.()); } };
    outs.forEach((o, i) => m.outAudio('M' + (i + 1), o, 'macro ' + (i + 1) + ' (0..1)', true));
    m.outAudio('RISE', rise, 'build riser 0→1, snaps back on the drop', true);
    m.outEvent('DROP', 'fires when the build lands');
    m.layout = [{ custom: 'macros' }, { k: ['m1', 'm2', 'm3', 'm4', 'bars', 'curve'], cls: 'kgrid' }];
    return m;
  }

  // ======================= FOLLOWER: envelope follower and transient trigger =======================
  function Follower(id) {
    const m = new M(id, { name: 'Follower', sub: 'envelope follower · transient trigger · ducking CV', width: 280, stripe: '#9ef0b7', family: 'mod' });
    const inp = gain(1), pre = gain(2), r = ctx.createWaveShaper(), lp = ctx.createBiquadFilter(), env = gain(1), inv = gain(-1), one = constSrc(1), invOut = gain(1);
    r.curve = FX.curveOf(x => Math.min(1, Math.abs(x)), 1025); lp.type = 'lowpass'; lp.Q.value = 0.5;
    inp.connect(pre); pre.connect(r); r.connect(lp); lp.connect(env); env.connect(inv); inv.connect(invOut); one.connect(invOut);
    const an = ctx.createAnalyser(); an.fftSize = 32; env.connect(an); const sink = gain(0); an.connect(sink); sink.connect(ctx.destination);
    const buf = new Float32Array(32); m.read = () => { an.getFloatTimeDomainData(buf); return buf[31]; };
    m.p('gain', { label: 'Gain', min: 0.5, max: 12, curve: 'exp', def: 0.35, fmt: v => v.toFixed(1) + '×', apply: v => smooth(pre.gain, v) });
    m.p('speed', { label: 'Speed', min: 2, max: 40, curve: 'exp', def: 0.45, fmt: v => Math.round(v) + 'Hz', apply: v => smooth(lp.frequency, v) });
    m.p('thr', { label: 'Threshold', def: 0.5, fmt: pct });
    m.armed = true; m.level = 0;
    m.tick = function (t0) { const v = this.read(); this.level = v; const th = this.v('thr'); if (this.armed && v > th) { this.armed = false; this.emit('TRIG', { kind: 'trig', time: t0 + 0.005 }); E.at(t0, () => this.ui?.hit?.()); } else if (v < th * 0.6) this.armed = true; };
    m.inAudio('IN', inp, 'audio to follow');
    m.outAudio('ENV', env, 'envelope 0..1', true); m.outAudio('INV', invOut, '1 − envelope (ducking)', true);
    m.outEvent('TRIG', 'fires on each transient');
    m.layout = [{ custom: 'follower' }, { k: ['gain', 'speed', 'thr'], cls: 'kgrid' }];
    return m;
  }

  const TYPES = {
    Orbit: { label: 'Orbit 4 morphing LFOs', desc: 'four LFOs (O1-O4, SUM) with shape morph SINE TRI SAW RAMP SQR PULSE S&H DRIFT BOUNCE STAIRS PLUCK, tempo sync (8 BAR..1/32) or free, depth ±, cross-mod, fade-in, TRIG restart', prefix: 'orbit', make: id => Orbit(id) },
    Performer: { label: 'Performer curve sequencer', desc: 'two lanes (P1, P2) of 16 drawn curve steps locked to the bar; presets PUMP GATE RISE WOB8 WOB16 WOB3 TALK SWEEP STAIRS STUTTER DUB', prefix: 'perf', make: id => Performer(id) },
    Attractor: { label: 'Attractor chaos LFO', desc: 'LORENZ ROSSLER THOMAS LOGISTIC strange attractors: X Y Z outputs that never repeat, CROSS trigger', prefix: 'chaos', make: id => Attractor(id) },
    Macros: { label: 'Macros (4 knobs + build riser)', desc: 'macro knobs M1-M4 (fan one macro out to many knobs), RISE ramp over 1-16 bars with DROP trigger', prefix: 'macro', make: id => Macros(id) },
    Follower: { label: 'Follower envelope follower', desc: 'audio IN → ENV / INV control signals and TRIG on transients (sidechain any knob to the kick)', prefix: 'follow', make: id => Follower(id) }
  };
  Object.assign(Mods.TYPES, TYPES);
  return { TYPES, SHAPES, SYNC, PRESETS, PSHAPES, PGLYPH, MODELS, beatAt };
})();
