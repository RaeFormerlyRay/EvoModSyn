// modules.js — every module in the rack: clock, sequencers, drum machine, voices, Serge-style utilities, mixer, monitor.
'use strict';
const Mods = (() => {
  const E = Engine, ctx = E.ctx, { clamp, mtof } = DSP;
  const M = E.Module;
  const DIVS = ['1/1', '1/2', '1/4', '1/4T', '1/8', '1/8T', '1/16', '1/16T', '1/32'];
  const DIVMUL = [0.25, 0.5, 1, 1.5, 2, 3, 4, 6, 8]; // cycles per beat
  const pct = v => Math.round(v * 100) + '%';
  const secs = v => v < 1 ? Math.round(v * 1000) + 'ms' : v.toFixed(2) + 's';
  const hz = v => v >= 1000 ? (v / 1000).toFixed(1) + 'k' : Math.round(v) + 'Hz';
  const now = () => ctx.currentTime;
  const smooth = (param, v, tc = 0.02) => { param.cancelScheduledValues(now()); param.setTargetAtTime(v, now(), tc); };
  const constSrc = (v = 0) => { const c = ctx.createConstantSource(); c.offset.value = v; c.start(); return c; };
  const gain = (v = 1) => { const g = ctx.createGain(); g.gain.value = v; return g; };
  const filt = (type, f, q) => { const b = ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; if (q != null) b.Q.value = q; return b; };
  const shaper = (curve) => { const s = ctx.createWaveShaper(); s.curve = curve; s.oversample = '2x'; return s; };

  // ======================= CLOCK =======================
  function Clock(id) {
    const m = new M(id, { name: 'Pulse', sub: 'master clock', width: 190, stripe: '#e9e6dc', family: 'clock' });
    m.p('bpm', { label: 'Tempo', min: 60, max: 200, def: (126 - 60) / 140, nomod: true, apply: v => E.setBpm(v), fmt: v => v.toFixed(1) });
    m.p('swing', { label: 'Swing', min: 0, max: 0.6, def: 0, apply: v => { E.swing = v; }, fmt: pct });
    m.outEvent('CLK', '16th notes'); m.outEvent('BEAT', 'quarter notes'); m.outEvent('BAR', 'downbeats');
    m.emitTick = (t, step, dur) => {
      m.emit('CLK', { kind: 'tick', time: t, step, dur });
      if (step % 4 === 0) m.emit('BEAT', { kind: 'tick', time: t, step: step / 4, dur: dur * 4 });
      if (step % 16 === 0) m.emit('BAR', { kind: 'tick', time: t, step: step / 16, dur: dur * 16 });
      if (step % 16 === 0) E.fire('bar', { time: t, bar: step / 16, step, dur: dur * 16 });
      if (step % 4 === 0) E.at(t, () => m.ui?.blink(step % 16 === 0));
    };
    m.layout = [{ custom: 'clock' }, { k: ['bpm', 'swing'], c: true }];
    return m;
  }

  // ======================= STEP SEQUENCER =======================
  function StepSeq(id, name, stripe) {
    const m = new M(id, { name, sub: '8 patterns · song mode · per-step prob & ratchet', width: 392, stripe, family: 'seq' });
    const blank = () => Array.from({ length: 16 }, () => ({ n: 0, g: 0, a: 0, s: 0, p: 1, r: 1 }));
    m.pats = Array.from({ length: 8 }, blank);
    m.cur = 0; m.next = null;
    m.view = null; // a pattern shown while being edited (playback always uses m.cur)
    Object.defineProperty(m, 'steps', { get() { return this.pats[this.view ?? this.cur]; }, set(v) { this.pats[this.view ?? this.cur] = v; } });
    m.song = [{ pat: 0, rep: 4 }]; m.songOn = false; m.songIx = 0; m.loops = 0; m.inPat = 0;
    m.p('len', { label: 'Length', steps: Array.from({ length: 16 }, (_, i) => i + 1), def: 1, small: true });
    m.p('dir', { label: 'Dir', steps: ['FWD', 'REV', 'PING', 'RAND', 'DRUNK'], def: 0, small: true });
    m.p('div', { label: 'Div', steps: ['1/16', '1/8', '1/4', '1/32'], def: 0, small: true });
    m.p('root', { label: 'Root', steps: DSP.NOTE_NAMES, def: 0, small: true });
    m.p('scale', { label: 'Scale', steps: DSP.SCALE_NAMES, def: 0, small: true });
    m.p('oct', { label: 'Octave', steps: [1, 2, 3, 4, 5, 6], def: 0.2, small: true });
    m.p('trans', { label: 'Transp', steps: Array.from({ length: 15 }, (_, i) => i - 7), def: 0.5, small: true });
    m.p('gate', { label: 'Gate', min: 0.1, max: 1, def: 0.55, fmt: pct, small: true });
    m.p('prob', { label: 'Prob', min: 0, max: 1, def: 1, fmt: pct, small: true });
    m.p('follow', { label: 'Harmony', steps: ['FREE', 'SONG'], def: 0, small: true });
    m.p('ratch', { label: 'Ratchet', min: 0, max: 1, def: 0, fmt: pct, small: true });
    m.inEvent('CLK', function (e) { this.advance(e); }, 'clock in');
    m.inEvent('RST', function () { this.pos = -1; this.dirSign = 1; this.inPat = 0; this.loops = 0; this.songIx = 0; if (this.songOn) this.cur = this.song[0].pat; }, 'reset');
    m.outEvent('NOTE', 'pitch + gate'); m.outEvent('GATE', 'trigger per played step'); m.outEvent('PAT', 'trigger at each pattern start');
    const cv = constSrc(0); m.outAudio('CV', cv, 'pitch as CV', true);
    m.pos = -1; m.dirSign = 1; m.cnt = 0; m.prevSlide = false;
    m.hasNotes = i => m.pats[i].some(s => s.g);
    // queue a pattern: it starts when the current one finishes (immediately if stopped)
    m.queue = function (i) { if (!E.running) { this.cur = i; this.next = null; this.pos = -1; this.inPat = 0; } else this.next = i; this.ui?.renderAll(); };
    m.setSong = function (chain, on) {
      if (chain && chain.length) this.song = chain.map(c => ({ pat: clamp(c.pat | 0, 0, 7), rep: clamp(c.rep | 0 || 1, 1, 64) }));
      if (on != null) { this.songOn = !!on; if (this.songOn) { this.songIx = 0; this.loops = 0; this.cur = this.song[0].pat; this.pos = -1; this.inPat = 0; this.next = null; } }
      this.ui?.renderAll();
    };
    m.onLoop = function (t) {
      this.loops++;
      if (this.songOn) {
        if (this.loops >= this.song[this.songIx].rep) { this.songIx = (this.songIx + 1) % this.song.length; this.loops = 0; this.cur = this.song[this.songIx].pat; this.pos = -1; }
      } else if (this.next != null) { this.cur = this.next; this.next = null; this.loops = 0; this.pos = -1; }
      this.emit('PAT', { kind: 'trig', time: t });
      E.at(t, () => this.ui?.renderAll());
    };
    m.advance = function (e) {
      const divN = [1, 2, 4, 0.5][this.v('div')];
      // following the song: restart the pattern on the bar line so switches land on downbeats
      if (this.v('follow') && e.step != null && e.step % (16 * Math.max(1, divN)) === 0) { this.cnt = 0; if (this.inPat > 0) { this.inPat = 0; this.pos = -1; this.onLoop(e.time); } }
      if (divN >= 1) { if ((this.cnt++ % divN) !== 0) return; }
      const len = this.v('len') + 1, dir = this.params.dir.choice;
      if (this.inPat >= len) { this.inPat = 0; this.onLoop(e.time); }
      this.inPat++;
      if (dir === 'FWD') this.pos = (this.pos + 1) % len;
      else if (dir === 'REV') this.pos = this.pos <= 0 ? len - 1 : this.pos - 1;
      else if (dir === 'PING') { let p = this.pos + this.dirSign; if (p >= len || p < 0) { this.dirSign *= -1; p = this.pos + this.dirSign; } this.pos = clamp(p, 0, len - 1); }
      else if (dir === 'RAND') this.pos = Math.floor(Math.random() * len);
      else this.pos = ((this.pos + (Math.random() < 0.5 ? -1 : 1) + (Math.random() < 0.5 ? 1 : 0)) % len + len) % len;
      const st = this.pats[this.cur][this.pos], t = e.time, dur = (e.dur || E.sixteenth()) * Math.max(divN, 0.5);
      const pos = this.pos;
      E.at(t, () => this.ui?.cursor(pos));
      const play = st.g && Math.random() < this.v('prob') * (st.p ?? 1);
      if (!play) { this.prevSlide = false; return; }
      const midi = 12 * (this.params.oct.choice + 1) + this.v('root') + DSP.degreeToSemi(this.params.scale.choice, st.n + this.params.trans.choice + (this.v('follow') ? E.chordAt(e.step ?? E.step) : 0));
      const reps = (st.r > 1 ? st.r : 1) * (Math.random() < this.v('ratch') ? 2 : 1);
      const legatoNext = st.s;
      const gateDur = legatoNext ? dur * 1.08 : dur * this.v('gate');
      cv.offset.setValueAtTime((midi - 48) / 36, t);
      for (let r = 0; r < reps; r++) {
        const tt = t + r * dur / reps;
        const ev = { kind: 'note', time: tt, midi, dur: reps > 1 ? dur / reps * 0.6 : gateDur, acc: st.a, slide: this.prevSlide && r === 0, vel: st.a ? 1 : 0.75 };
        this.emit('NOTE', ev); this.emit('GATE', { kind: 'trig', time: tt, vel: ev.vel });
      }
      this.prevSlide = !!legatoNext;
    };
    m.setStep = function (i, s) { Object.assign(this.steps[i], s); this.ui?.renderSteps(); };
    m.layout = [{ custom: 'steps' }, { k: ['len', 'dir', 'div', 'root', 'scale', 'oct', 'trans', 'gate', 'prob', 'ratch', 'follow'], cls: 'kgrid' }];
    return m;
  }

  // ======================= ENTROPY (noise-based) SEQUENCER =======================
  function Entropy(id) {
    const m = new M(id, { name: 'Entropy', sub: 'noise-driven sequencer', width: 270, stripe: '#9c7bff', family: 'seq' });
    m.p('dens', { label: 'Density', def: 0.6, fmt: pct, small: true });
    m.p('lock', { label: 'Lock', def: 0.5, fmt: pct, small: true });
    m.p('len', { label: 'Loop', steps: [2, 3, 4, 5, 6, 7, 8, 10, 12, 16], def: 0.65, small: true });
    m.p('color', { label: 'Noise', steps: ['WHITE', 'PINK', 'BROWN', 'CHAOS'], def: 0.34, small: true });
    m.p('range', { label: 'Range', min: 0.1, max: 3, def: 0.4, fmt: v => v.toFixed(1) + 'oct', small: true });
    m.p('scale', { label: 'Scale', steps: DSP.SCALE_NAMES, def: 4 / 8, small: true });
    m.p('root', { label: 'Root', steps: DSP.NOTE_NAMES, def: 0, small: true });
    m.p('oct', { label: 'Octave', steps: [1, 2, 3, 4, 5, 6], def: 0.6, small: true });
    m.p('div', { label: 'Div', steps: [1, 2, 3, 4, 8], def: 0.25, small: true });
    m.p('slew', { label: 'Slew', min: 0.001, max: 1, curve: 'exp', def: 0.2, fmt: secs, small: true });
    m.inEvent('CLK', function (e) { this.advance(e); }, 'clock / trigger in');
    m.outEvent('NOTE', 'random notes'); m.outEvent('TRIG', 'random gates');
    const cv = constSrc(0); m.outAudio('CV', cv, 'stepped random CV', true);
    m.reg = Array.from({ length: 16 }, () => Math.random()); m.hist = []; m.cnt = 0; m.brown = 0.5; m.pink = [0, 0, 0]; m.logi = 0.37;
    m.rand = function () {
      const c = this.params.color.choice;
      if (c === 'WHITE') return Math.random();
      if (c === 'PINK') { const p = this.pink; p[0] = 0.99 * p[0] + Math.random() * 0.1; p[1] = 0.9 * p[1] + Math.random() * 0.1; p[2] = Math.random(); return clamp((p[0] * 0.1 + p[1] * 0.3 + p[2] * 0.6)); }
      if (c === 'BROWN') { this.brown = clamp(this.brown + (Math.random() - 0.5) * 0.25); return this.brown; }
      this.logi = 3.99 * this.logi * (1 - this.logi); return this.logi;
    };
    m.advance = function (e) {
      if ((this.cnt++ % this.params.div.choice) !== 0) return;
      const len = this.params.len.choice;
      const head = this.reg.shift();
      const nv = Math.random() < this.v('lock') ? head : this.rand();
      this.reg.push(nv);
      const v = this.reg[this.reg.length - len] ?? nv;
      const gateRand = (v * 7.31 + this.cnt * 0.0) % 1;
      const on = (Math.random() * 0.3 + gateRand * 0.7) < this.v('dens');
      const t = e.time, dur = (e.dur || E.sixteenth()) * this.params.div.choice;
      const scale = this.params.scale.choice, n = DSP.SCALES[scale].length;
      const deg = Math.round(v * this.v('range') * n);
      const midi = 12 * (this.params.oct.choice + 1) + this.v('root') + DSP.degreeToSemi(scale, deg);
      cv.offset.setTargetAtTime(v * 2 - 1, t, this.v('slew') / 3);
      this.hist.push({ v, on }); if (this.hist.length > 64) this.hist.shift();
      E.at(t, () => this.ui?.draw());
      if (on) { this.emit('NOTE', { kind: 'note', time: t, midi, dur: dur * 0.7, acc: v > 0.8 ? 1 : 0, vel: 0.5 + v * 0.5 }); this.emit('TRIG', { kind: 'trig', time: t, vel: 0.5 + v * 0.5 }); }
    };
    m.layout = [{ custom: 'entropy' }, { k: ['dens', 'lock', 'len', 'color', 'range', 'scale', 'root', 'oct', 'div', 'slew'], cls: 'kgrid' }];
    return m;
  }

  // ======================= GEIGER COUNTER =======================
  const SOURCES = ['BACKGROUND', 'BANANAS', 'GRANITE', 'RADON', 'U-GLASS', 'FIESTAWARE', 'TRINITITE', 'CORE'];
  const SRC_CPS = [0.35, 0.8, 1.6, 3.2, 6, 12, 28, 160];
  function Geiger(id) {
    const m = new M(id, { name: 'Geiger', sub: 'SBM-20 tube · radioactive trigger source', width: 250, stripe: '#d6e04a', family: 'source' });
    m.p('src', { label: 'Source', steps: SOURCES, def: 4 / 7 });
    m.p('level', { label: 'Exposure', min: 0.1, max: 4, curve: 'exp', def: 0.5, fmt: v => '×' + v.toFixed(2) });
    m.p('burst', { label: 'Burst', def: 0.25, fmt: pct });
    m.p('tone', { label: 'Tone', min: 600, max: 9000, curve: 'exp', def: 0.6, fmt: hz, apply: v => smooth(bp.frequency, v) });
    m.p('vol', { label: 'Click', def: 0.6, fmt: pct, apply: v => smooth(out.gain, v * 0.9) });
    const bp = filt('bandpass', 3000, 1.2), out = gain(0.5);
    bp.connect(out);
    const clickBuf = (() => { const len = Math.floor(ctx.sampleRate * 0.012), b = ctx.createBuffer(1, len, ctx.sampleRate), d = b.getChannelData(0); for (let i = 0; i < len; i++) d[i] = (i < 6 ? 1 : 0) + (Math.random() * 2 - 1) * Math.exp(-i / (len * 0.12)) * 0.7; return b; })();
    const cvs = constSrc(0);
    m.outAudio('AUDIO', out, 'clicks'); m.outEvent('TRIG', 'one trigger per decay'); m.outAudio('CV', cvs, 'count rate', true);
    m.next = 0; m.counts = []; m.cpm = 0;
    m.tick = function (t0, horizon) {
      if (this.next < t0) this.next = t0 + 0.01;
      const rate = SRC_CPS[this.v('src')] * this.v('level');
      let guard = 0;
      while (this.next < horizon && guard++ < 200) {
        const t = this.next;
        const s = ctx.createBufferSource(); s.buffer = clickBuf; s.playbackRate.value = 0.8 + Math.random() * 0.5; s.connect(bp); s.start(t);
        this.emit('TRIG', { kind: 'trig', time: t, vel: 0.6 + Math.random() * 0.4 });
        this.counts.push(t);
        E.at(t, () => this.ui?.flash());
        let iv = -Math.log(1 - Math.random()) / rate;
        if (Math.random() < this.v('burst') * 0.6) iv *= 0.06 + Math.random() * 0.1;
        this.next = t + iv;
      }
      while (this.counts.length && this.counts[0] < t0 - 10) this.counts.shift();
      this.cpm = this.counts.filter(c => c <= t0).length * 6;
      cvs.offset.setTargetAtTime(clamp(Math.log10(1 + this.cpm) / 4), t0, 0.3);
    };
    m.layout = [{ custom: 'geiger' }, { k: ['src', 'level', 'burst', 'tone', 'vol'], cls: 'kgrid' }];
    return m;
  }

  // ======================= SERGE-STYLE: SLOPE / FOLD / VCFQ =======================
  function Slope(id) {
    const m = new M(id, { name: 'Slope', sub: 'universal rise/fall function', width: 200, stripe: '#3fb6c9', family: 'serge' });
    const cs = constSrc(0), osc = ctx.createOscillator(), og = gain(0), lvl = gain(1);
    osc.frequency.value = 1; osc.start(); osc.connect(og); og.connect(lvl); cs.connect(lvl);
    let waveTimer = 0;
    const rebuild = () => { clearTimeout(waveTimer); waveTimer = setTimeout(() => {
      const r = m.v('rise'), f = m.v('fall');
      osc.setPeriodicWave(DSP.waveFromFn(ctx, DSP.shapes.slope(r / (r + f), m.v('shape')), 24, 256));
      smooth(osc.frequency, 1 / (r + f), 0.05);
    }, 40); };
    m.p('rise', { label: 'Rise', min: 0.003, max: 12, curve: 'exp', def: 0.45, fmt: secs, apply: rebuild });
    m.p('fall', { label: 'Fall', min: 0.003, max: 12, curve: 'exp', def: 0.55, fmt: secs, apply: rebuild });
    m.p('shape', { label: 'Shape', min: -1, max: 1, def: 0.5, fmt: v => v < -0.2 ? 'LOG' : v > 0.2 ? 'EXP' : 'LIN', apply: rebuild });
    m.p('cycle', { label: 'Cycle', steps: ['OFF', 'ON'], def: 1, apply: v => { smooth(og.gain, v ? 1 : 0, 0.01); m.cycStart = now(); } });
    m.p('level', { label: 'Level', min: -1, max: 1, def: 0.9, fmt: v => v.toFixed(2), apply: v => smooth(lvl.gain, v) });
    m.inEvent('TRIG', function (e) {
      const t = e.time, r = this.v('rise'), f = this.v('fall');
      cs.offset.cancelScheduledValues(t); cs.offset.setValueAtTime(0, t); cs.offset.linearRampToValueAtTime(1, t + r); cs.offset.linearRampToValueAtTime(0, t + r + f);
      this.emitLater = t + r + f;
    }, 'trigger a slope');
    m.outAudio('OUT', lvl, 'function out', true); m.outEvent('EOC', 'end of cycle');
    m.cycStart = 0; m.emitLater = 0;
    m.tick = function (t0, horizon) {
      if (this.emitLater && this.emitLater < horizon) { this.emit('EOC', { kind: 'trig', time: this.emitLater }); this.emitLater = 0; }
      if (this.v('cycle')) {
        const per = this.v('rise') + this.v('fall');
        if (!this.nextEoc || this.nextEoc < t0) this.nextEoc = t0 + per;
        while (this.nextEoc < horizon) { this.emit('EOC', { kind: 'trig', time: this.nextEoc }); this.nextEoc += per; }
      }
    };
    m.layout = [{ custom: 'slope' }, { k: ['rise', 'fall', 'shape', 'cycle', 'level'], cls: 'kgrid c' }];
    return m;
  }

  function Fold(id) {
    const m = new M(id, { name: 'Wavefold', sub: 'sine wave multiplier', width: 200, stripe: '#3fb6c9', family: 'serge' });
    const inp = gain(1), pre = gain(0.2), off = constSrc(0), sh = shaper(DSP.curveFold(8)), dc = filt('highpass', 18, 0.7), wet = gain(1), dry = gain(0), out = gain(0.8);
    inp.connect(pre); off.connect(pre); pre.connect(sh); sh.connect(dc); dc.connect(wet); wet.connect(out); inp.connect(dry); dry.connect(out);
    m.p('fold', { label: 'Folds', min: 0.4, max: 8, curve: 'exp', def: 0.4, fmt: v => v.toFixed(1), apply: v => smooth(pre.gain, v / 8) });
    m.p('sym', { label: 'Symmetry', min: -0.6, max: 0.6, def: 0.5, fmt: v => v.toFixed(2), apply: v => smooth(off.offset, v) });
    m.p('mix', { label: 'Mix', def: 1, fmt: pct, apply: v => { smooth(wet.gain, v); smooth(dry.gain, 1 - v); } });
    m.p('level', { label: 'Level', def: 0.7, fmt: pct, apply: v => smooth(out.gain, v * 1.1) });
    m.inAudio('IN', inp, 'audio in'); m.inCV('FOLD', pre.gain, 0.4, 'fold CV'); m.outAudio('OUT', out, 'folded out');
    m.layout = [{ custom: 'foldscope' }, { k: ['fold', 'sym', 'mix', 'level'], cls: 'kgrid c' }];
    return m;
  }

  function VCFQ(id) {
    const m = new M(id, { name: 'VCF-Q', sub: 'variable-Q resonant filter', width: 200, stripe: '#3fb6c9', family: 'serge' });
    const inp = gain(1), f = filt('bandpass', 800, 4), out = gain(1);
    inp.connect(f); f.connect(out);
    m.p('freq', { label: 'Freq', min: 30, max: 14000, curve: 'exp', def: 0.55, fmt: hz, apply: v => smooth(f.frequency, v) });
    m.p('q', { label: 'Q', min: 0.3, max: 40, curve: 'exp', def: 0.55, fmt: v => v.toFixed(1), apply: v => smooth(f.Q, v) });
    m.p('mode', { label: 'Mode', steps: ['LP', 'BP', 'HP', 'NOTCH'], def: 1 / 3, apply: v => { f.type = ['lowpass', 'bandpass', 'highpass', 'notch'][v]; } });
    m.p('level', { label: 'Level', def: 0.8, fmt: pct, apply: v => smooth(out.gain, v * 1.5) });
    m.inAudio('IN', inp, 'audio in'); m.inCV('CV', f.detune, 2400, 'frequency CV'); m.outAudio('OUT', out, 'filtered out');
    m.layout = [{ k: ['freq', 'q', 'mode', 'level'], cls: 'kgrid c' }, { custom: 'vcfqart' }];
    return m;
  }

  // ======================= DRUM MACHINE =======================
  const INST = ['BD', 'SD', 'CP', 'CH', 'OH', 'LT', 'HT', 'RS', 'CB', 'CY'];
  const KITS = ['808', '909', 'DIRT', 'LOFI'];
  function Drums(id) {
    const m = new M(id, { name: 'Rhythm Composer', sub: '808 / 909-style analog drums', width: 440, stripe: '#ff7a4a', family: 'drums' });
    const bus = gain(1), pre = gain(1), sh = shaper(DSP.curveTanh(0)), out = gain(0.8);
    bus.connect(pre); pre.connect(sh); sh.connect(out);
    m.p('kit', { label: 'Kit', steps: KITS, def: 1 / 3 });
    m.p('tune', { label: 'Tune', min: 0.6, max: 1.6, curve: 'exp', def: 0.5, fmt: v => '×' + v.toFixed(2) });
    m.p('decay', { label: 'Decay', min: 0.3, max: 2.5, curve: 'exp', def: 0.45, fmt: v => '×' + v.toFixed(2) });
    m.p('drive', { label: 'Drive', def: 0.1, fmt: pct, apply: v => { { const c = DSP.curveTanh(v * 0.6); if (sh._c !== c) { sh._c = c; sh.curve = c; } } pre.gain.value = 1 + v * 3; } });
    m.p('accent', { label: 'Accent', def: 0.6, fmt: pct });
    m.p('trigv', { label: 'Trig→', steps: INST, def: 0 });
    // individual outputs: patching one takes that drum out of the mix output, like the jacks on the real machines
    const indiv = INST.map(() => gain(0.8));
    m.p('level', { label: 'Level', def: 0.75, fmt: pct, apply: v => { smooth(out.gain, v * 1.1); indiv.forEach(g => smooth(g.gain, v * 1.1)); } });
    const destOf = ins => { const i = INST.indexOf(ins); return E.cables.some(c => c.from.mod === m.id && c.from.port === ins) ? indiv[i] : bus; };
    // 8 pattern banks (A–H) with queued switching at the bar line and a song chain, like the step sequencers
    m.pats = Array.from({ length: 8 }, () => INST.map(() => Array(16).fill(0))); m.cur = 0; m.next = null; m.view = null;
    Object.defineProperty(m, 'pat', { get() { return this.pats[this.view ?? this.cur]; }, set(v) { this.pats[this.view ?? this.cur] = v; } });
    m.song = [{ pat: 0, rep: 4 }]; m.songOn = false; m.songIx = 0; m.loops = 0;
    m.mute = INST.map(() => false); m.pos = -1; m.lvl = INST.map(() => 1);
    m.hasNotes = i => m.pats[i].some(r => r.some(v => v));
    m.queue = function (i) { if (!E.running) { this.cur = i; this.next = null; } else this.next = i; this.ui?.renderGrid(); };
    m.setSong = function (chain, on) {
      if (chain && chain.length) this.song = chain.map(c => ({ pat: clamp(c.pat | 0, 0, 7), rep: clamp(c.rep | 0 || 1, 1, 64) }));
      if (on != null) { this.songOn = !!on; if (this.songOn) { this.songIx = 0; this.loops = 0; this.cur = this.song[0].pat; this.next = null; } }
      this.ui?.renderGrid();
    };
    m.inEvent('RST', function () { this.pos = -1; this.loops = 0; this.songIx = 0; if (this.songOn) this.cur = this.song[0].pat; }, 'reset');
    m.inEvent('CLK', function (e) {
      const np = e.step != null ? e.step % 16 : (this.pos + 1) % 16;
      if (np === 0 && this.pos >= 0) { // bar line: pattern switches happen here
        this.loops++;
        if (this.songOn) { if (this.loops >= this.song[this.songIx].rep) { this.songIx = (this.songIx + 1) % this.song.length; this.loops = 0; this.cur = this.song[this.songIx].pat; } }
        else if (this.next != null) { this.cur = this.next; this.next = null; this.loops = 0; }
        E.at(e.time, () => this.ui?.renderGrid());
      }
      this.pos = np;
      const p = this.pos, t = e.time;
      E.at(t, () => this.ui?.cursor(p));
      INST.forEach((ins, i) => { const v = this.pat[i][p]; if (v && !this.mute[i]) this.hit(ins, t, v === 2 ? 1 : 0.7); });
    }, 'clock in');
    m.inEvent('TRIG', function (e) { this.hit(this.params.trigv.choice, e.time, e.vel ?? 0.8); }, 'trigger one voice');
    m.outAudio('OUT', out, 'drum mix (minus any drum patched on its own)');
    const NAMES = { BD: 'bass drum', SD: 'snare', CP: 'clap', CH: 'closed hat', OH: 'open hat', LT: 'low tom', HT: 'high tom', RS: 'rimshot', CB: 'cowbell', CY: 'cymbal' };
    INST.forEach((ins, i) => m.outAudio(ins, indiv[i], NAMES[ins] + ' only'));
    let openHat = null;
    const env = (g, t, peak, dec, att = 0.001) => { g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(peak, t + att); g.gain.exponentialRampToValueAtTime(0.0001, t + att + dec); };
    const osc = (type, f, t, stop) => { const o = ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(f, t); o.start(t); o.stop(stop); return o; };
    const noise = (t, stop) => { const s = ctx.createBufferSource(); s.buffer = E.noise; s.loop = true; s.start(t, Math.random() * 1.5); s.stop(stop); return s; };
    m.hit = function (ins, t, vel) {
      const kit = this.params.kit.choice, tu = this.v('tune'), dk = this.v('decay');
      const a = vel >= 1 ? 1 + this.v('accent') * 0.8 : 1;
      const lv = this.lvl[INST.indexOf(ins)] * vel * a;
      const is8 = kit === '808', dirt = kit === 'DIRT', lofi = kit === 'LOFI';
      const dest = destOf(ins), g = gain(0); g.connect(dest);
      if (ins === 'BD') {
        const dec = (is8 ? 0.55 : dirt ? 0.35 : 0.32) * dk, o = osc(dirt ? 'square' : 'sine', (is8 ? 110 : 160) * tu, t, t + dec + 0.1);
        o.frequency.exponentialRampToValueAtTime((is8 ? 46 : 52) * tu, t + (is8 ? 0.09 : 0.05));
        if (dirt) { const lp = filt('lowpass', 900, 3); o.connect(lp); lp.connect(g); } else o.connect(g);
        env(g, t, lv * (dirt ? 0.7 : 1.15), dec);
        if (!is8) { const n = noise(t, t + 0.02), hp = filt('highpass', 2500), cg = gain(0); n.connect(hp); hp.connect(cg); cg.connect(dest); env(cg, t, lv * 0.35, 0.012); }
      } else if (ins === 'SD') {
        const dec = (is8 ? 0.16 : 0.2) * dk;
        [is8 ? 238 : 185, is8 ? 476 : 330].forEach((f, k) => { const o = osc('triangle', f * tu, t, t + dec + 0.05); const og = gain(0); o.connect(og); og.connect(g); env(og, t, lv * (k ? 0.25 : 0.5), dec * 0.6); });
        const n = noise(t, t + dec + 0.1), f = filt(is8 ? 'highpass' : 'bandpass', is8 ? 1800 : 3200 * tu, is8 ? 0.7 : 0.8), ng = gain(0);
        n.connect(f); f.connect(ng); ng.connect(g); env(ng, t, lv * (is8 ? 0.55 : 0.8), dec);
        g.gain.value = 1;
      } else if (ins === 'CP') {
        const n = noise(t, t + 0.5), f = filt('bandpass', 1100 * tu, 1.1); n.connect(f); f.connect(g);
        g.gain.setValueAtTime(0, t);
        [0, 0.011, 0.022].forEach(d => { g.gain.setValueAtTime(lv * 1.4, t + d); g.gain.exponentialRampToValueAtTime(0.05, t + d + 0.009); });
        g.gain.setValueAtTime(lv * 1.1, t + 0.032); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.032 + 0.22 * dk);
      } else if (ins === 'CH' || ins === 'OH' || ins === 'CY') {
        const dec = (ins === 'CH' ? 0.045 : ins === 'OH' ? 0.32 : 1.1) * dk * (lofi ? 0.6 : 1);
        const hp = filt('highpass', ins === 'CY' ? 5000 : 7000), bp = filt('bandpass', 10000 * tu, 0.9);
        if (is8 || ins === 'CY') {
          [205.3, 304.4, 369.6, 522.7, 540, 800].forEach(f => { const o = osc('square', f * tu * 1.0, t, t + dec + 0.05); o.connect(bp); });
        } else { const n = noise(t, t + dec + 0.05); n.connect(bp); }
        bp.connect(hp); hp.connect(g); env(g, t, lv * (ins === 'CY' ? 0.35 : 0.42) * (is8 ? 0.6 : 1), dec);
        if (ins === 'CH' && openHat) { openHat.gain.cancelScheduledValues(t); openHat.gain.setTargetAtTime(0, t, 0.005); }
        if (ins === 'OH') openHat = g;
      } else if (ins === 'LT' || ins === 'HT') {
        const f0 = (ins === 'LT' ? 95 : 165) * tu, dec = 0.32 * dk, o = osc('sine', f0 * 1.5, t, t + dec + 0.05);
        o.frequency.exponentialRampToValueAtTime(f0, t + 0.08); o.connect(g); env(g, t, lv * 0.9, dec);
      } else if (ins === 'RS') {
        const o = osc('triangle', 1700 * tu, t, t + 0.05), n = noise(t, t + 0.04), f = filt('bandpass', 2600, 2); o.connect(g); n.connect(f); f.connect(g); env(g, t, lv * 0.5, 0.03);
      } else if (ins === 'CB') {
        const f = filt('bandpass', 2640 * tu, 1.2); [587, 845].forEach(fr => osc('square', fr * tu, t, t + 0.4).connect(f)); f.connect(g); env(g, t, lv * 0.4, 0.28 * dk);
      }
    };
    m.setRow = function (i, arr) { this.pat[i] = arr.slice(0, 16); this.ui?.renderGrid(); };
    m.layout = [{ custom: 'drumgrid' }, { k: ['kit', 'tune', 'decay', 'drive', 'accent', 'trigv', 'level'], cls: 'kgrid' }];
    m.INST = INST;
    return m;
  }

  // ======================= ANALOG-MODELING MONO VOICE =======================
  const MODELS = ['ACID', 'LADDER', 'SCREAM', 'JOVE', 'PROPHECY', 'SEM', 'ODYSSEY'];
  const MODEL_INFO = {
    ACID: 'TB-303-style squelch: 18dB diode-ish filter, accent, slide',
    LADDER: 'Moog-style 24dB ladder, 3-osc fat bass',
    SCREAM: 'MS-20-style HP+LP that screams when driven',
    JOVE: 'Jupiter-8-style 2 osc, smooth 12dB, chorus',
    PROPHECY: 'Prophet-5-style poly-mod (osc B → osc A pitch)',
    SEM: 'Oberheim SEM-style 12dB state variable',
    ODYSSEY: 'ARP Odyssey-style pulse, HP + LP'
  };
  function Analog(id, name, stripe, model) {
    const m = new M(id, { name, sub: 'analog-modeling mono voice', width: 352, stripe, family: 'voice' });
    const o1 = ctx.createOscillator(), o2 = ctx.createOscillator(), sub = ctx.createOscillator();
    const g1 = gain(0.5), g2 = gain(0), gs = gain(0), pm = gain(0);
    const pre = gain(1), drv = shaper(DSP.curveTanh(0.1)), hp = filt('highpass', 20, 0.7), lp1 = filt('lowpass', 800, 4), lp2 = filt('lowpass', 800, 1);
    const vca = gain(0), dly = ctx.createDelay(0.05), cho = gain(0), clfo = ctx.createOscillator(), clg = gain(0.003), out = gain(0.7);
    const envCS = constSrc(0), envG = gain(0);
    sub.type = 'square'; [o1, o2, sub].forEach(o => o.start());
    o1.connect(g1); o2.connect(g2); sub.connect(gs); o2.connect(pm); pm.connect(o1.frequency);
    [g1, g2, gs].forEach(g => g.connect(pre));
    pre.connect(drv); drv.connect(hp); hp.connect(lp1); lp1.connect(lp2); lp2.connect(vca); vca.connect(out); vca.connect(dly); dly.connect(cho); cho.connect(out);
    dly.delayTime.value = 0.012; clfo.frequency.value = 0.55; clfo.connect(clg); clg.connect(dly.delayTime); clfo.start();
    envCS.connect(envG); envG.connect(lp1.detune); envG.connect(lp2.detune);
    const pulseW = DSP.waveFromFn(ctx, DSP.shapes.pulse(0.2), 64, 512);
    const setWave = (w) => { const map = { SAW: 'sawtooth', SQR: 'square', TRI: 'triangle' }; [o1, o2].forEach(o => { if (w === 'PULSE') o.setPeriodicWave(pulseW); else o.type = map[w]; }); };
    const voiceShape = () => {
      const md = m.params.model.choice, res = m.v('res'), d = m.v('drive');
      const q = 0.7 + res * res * (md === 'SCREAM' ? 20 : md === 'ACID' ? 20 : md === 'LADDER' ? 16 : 12);
      lp1.Q.value = q;
      lp2.type = (md === 'ACID' || md === 'LADDER') ? 'lowpass' : 'allpass';
      lp2.Q.value = md === 'LADDER' ? 0.9 : 0.6;
      hp.frequency.value = md === 'SCREAM' ? 90 + res * 200 : md === 'ODYSSEY' ? 140 : 18;
      hp.Q.value = md === 'SCREAM' ? 1 + res * 8 : 0.7;
      { const c = md === 'SCREAM' ? DSP.curveHard(d) : DSP.curveTanh(d * (md === 'ACID' ? 0.6 : 0.4) + 0.02); if (drv._c !== c) { drv._c = c; drv.curve = c; } }
      pre.gain.value = 0.8 + d * (md === 'SCREAM' ? 3 : 1.5);
      smooth(cho.gain, md === 'JOVE' ? 0.55 : md === 'SEM' ? 0.2 : 0);
      if (md === 'SEM') lp1.Q.value = 0.7 + res * 9;
    };
    const voiceOsc = () => {
      const md = m.params.model.choice, det = m.v('detune');
      smooth(g2.gain, (md === 'ACID') ? det * 0.2 : 0.15 + det * 0.4);
      smooth(gs.gain, m.v('sub') * 0.6);
      o2.detune.value = det * 30 + (md === 'ODYSSEY' ? 700 : 0);
      m.pmAmt = md === 'PROPHECY' ? 0.6 + det * 2 : 0;
    };
    m.p('model', { label: 'Model', steps: MODELS, def: MODELS.indexOf(model) / 6, apply: () => { voiceShape(); voiceOsc(); m.ui?.modelInfo?.(); } });
    m.p('wave', { label: 'Wave', steps: ['SAW', 'SQR', 'PULSE', 'TRI'], def: 0, apply: (v, p) => setWave(p.choice) });
    m.p('detune', { label: 'Detune', def: 0.15, fmt: pct, apply: voiceOsc });
    m.p('sub', { label: 'Sub', def: 0, fmt: pct, apply: voiceOsc });
    m.p('cutoff', { label: 'Cutoff', min: 40, max: 12000, curve: 'exp', def: 0.35, fmt: hz, apply: v => { smooth(lp1.frequency, v, 0.015); smooth(lp2.frequency, v * 1.1, 0.015); } });
    m.p('res', { label: 'Reso', def: 0.6, fmt: pct, apply: voiceShape });
    m.p('env', { label: 'Env Mod', def: 0.55, fmt: pct, apply: v => smooth(envG.gain, v * 5400) });
    m.p('decay', { label: 'Decay', min: 0.03, max: 2.5, curve: 'exp', def: 0.35, fmt: secs });
    m.p('accent', { label: 'Accent', def: 0.6, fmt: pct });
    m.p('drive', { label: 'Drive', def: 0.25, fmt: pct, apply: voiceShape });
    m.p('glide', { label: 'Glide', min: 0, max: 0.5, def: 0, fmt: secs });
    m.p('level', { label: 'Level', def: 0.7, fmt: pct, apply: v => smooth(out.gain, v * 0.75) });
    m.inEvent('NOTE', function (e) { if (e.kind === 'note') this.note(e); else this.note({ ...e, midi: this.last || 45, dur: 0.12 }); }, 'note in');
    m.inCV('CUT', [lp1.detune, lp2.detune], 2400, 'cutoff CV');
    m.inCV('FM', [o1.frequency, o2.frequency], 220, 'audio-rate FM');
    m.outAudio('OUT', out, 'voice out');
    m.note = function (e) {
      const t = Math.max(e.time, now()), f = mtof(e.midi); this.last = e.midi;
      const legato = !!e.slide, gl = legato ? 0.06 : this.v('glide');
      const set = (prm, v) => { prm.cancelScheduledValues(t); if (gl > 0.002) prm.setTargetAtTime(v, t, gl / 3); else prm.setValueAtTime(v, t); };
      set(o1.frequency, f); set(o2.frequency, f); set(sub.frequency, f / 2);
      pm.gain.setValueAtTime(f * (this.pmAmt || 0), t);
      const acc = e.acc ? this.v('accent') : 0, md = this.params.model.choice;
      const peak = 0.55 * (1 + acc * 0.6) * (e.vel ?? 0.8) / 0.8;
      if (!legato) {
        envCS.offset.cancelScheduledValues(t); envCS.offset.setValueAtTime(1 + acc * 0.7, t);
        envCS.offset.setTargetAtTime(0, t + 0.004, this.v('decay') * (acc ? 0.6 : 1) / 3);
        vca.gain.cancelScheduledValues(t); vca.gain.setTargetAtTime(peak, t, 0.0015);
        const sus = md === 'ACID' ? 0.85 : md === 'JOVE' || md === 'SEM' ? 0.8 : 0.7;
        vca.gain.setTargetAtTime(peak * sus, t + 0.02, Math.max(0.04, this.v('decay')));
      } else { vca.gain.cancelScheduledValues(t); vca.gain.setTargetAtTime(peak * 0.85, t, 0.01); }
      vca.gain.setTargetAtTime(0, t + e.dur, md === 'JOVE' ? 0.12 : 0.012);
      E.at(t, () => this.ui?.gateLed());
    };
    m.layout = [{ custom: 'modelinfo' }, { k: ['model', 'wave', 'detune', 'sub', 'cutoff', 'res', 'env', 'decay', 'accent', 'drive', 'glide', 'level'], cls: 'kgrid' }];
    m.MODEL_INFO = MODEL_INFO;
    return m;
  }

  // ======================= WAVETABLE "TITAN" (dubstep voice) =======================
  let TBL = null;
  function Titan(id) {
    const m = new M(id, { name: 'Titan', sub: 'dual wavetable bass monster · wobble engine', width: 600, stripe: '#ff3f7a', family: 'voice' });
    if (!TBL) TBL = DSP.TABLES.map(t => ({ name: t.name, a: DSP.waveFromFn(ctx, t.a, 96, 1024), b: DSP.waveFromFn(ctx, t.b, 96, 1024) }));
    const lfoBus = gain(1), out = gain(0.6), vca = gain(0), mix = gain(1);
    const mkOsc = (n, bus, posSum) => {
      const inv = gain(-1); posSum.connect(inv);
      const voices = [];
      for (let i = 0; i < n; i++) {
        const a = ctx.createOscillator(), b = ctx.createOscillator(), ga = gain(1 / n), gb = gain(0);
        a.connect(ga); b.connect(gb); ga.connect(bus); gb.connect(bus); a.start(); b.start();
        // gb.gain = pos/n ; ga.gain = (1-pos)/n
        const sc = gain(1 / n), sci = gain(1 / n); posSum.connect(sc); sc.connect(gb.gain); inv.connect(sci); sci.connect(ga.gain);
        voices.push({ a, b, ga, gb });
      }
      return voices;
    };
    const bus1 = gain(0.7), bus2 = gain(0.3), pos1 = gain(1), pos2 = gain(1), pcs1 = constSrc(0), pcs2 = constSrc(0), wpos = gain(0);
    // the LFO restarts on every note; a gentle low-pass on the control path removes the click of that phase jump
    const lfoSm = filt('lowpass', 45, 0.5); lfoBus.connect(lfoSm);
    pcs1.connect(pos1); pcs2.connect(pos2); lfoSm.connect(wpos); wpos.connect(pos1); wpos.connect(pos2);
    const v1 = mkOsc(3, bus1, pos1), v2 = mkOsc(1, bus2, pos2);
    const subO = ctx.createOscillator(), subG = gain(0); subO.start(); subO.connect(subG);
    [bus1, bus2, subG].forEach(b => b.connect(mix));
    const f1 = filt('lowpass', 500, 2), f2 = filt('lowpass', 500, 0.7), pre = gain(0.5), drv = shaper(DSP.curveTanh(0.08)), post = gain(1), aa = filt('lowpass', 11000, 0.5), comp = ctx.createDynamicsCompressor();
    drv.oversample = '4x';
    comp.threshold.value = -18; comp.ratio.value = 6; comp.attack.value = 0.003; comp.release.value = 0.08;
    mix.connect(f1); f1.connect(f2); f2.connect(pre); pre.connect(drv); drv.connect(post); post.connect(aa); aa.connect(comp); comp.connect(vca); vca.connect(out);
    const envCS = constSrc(0), envG = gain(0), wcut = gain(0);
    envCS.connect(envG); envG.connect(f1.detune); envG.connect(f2.detune); lfoSm.connect(wcut); wcut.connect(f1.detune); wcut.connect(f2.detune);
    const setTbl = (voices, i) => voices.forEach(v => { v.a.setPeriodicWave(TBL[i].a); v.b.setPeriodicWave(TBL[i].b); });
    const tnames = DSP.TABLES.map(t => t.name);
    m.p('t1', { label: 'Table A', steps: tnames, def: 1 / 5, apply: v => setTbl(v1, v) });
    m.p('p1', { label: 'Pos A', def: 0.3, fmt: pct, apply: v => smooth(pcs1.offset, v) });
    m.p('t2', { label: 'Table B', steps: tnames, def: 0, apply: v => setTbl(v2, v) });
    m.p('p2', { label: 'Pos B', def: 0.2, fmt: pct, apply: v => smooth(pcs2.offset, v) });
    m.p('mix2', { label: 'Osc B', def: 0.4, fmt: pct, apply: v => smooth(bus2.gain, v * 0.7) });
    m.p('uni', { label: 'Unison', def: 0.35, fmt: v => Math.round(v * 40) + 'c', apply: v => v1.forEach((x, i) => { const d = (i - 1) * v * 40; x.a.detune.value = d; x.b.detune.value = d; }) });
    m.p('sub', { label: 'Sub', def: 0.5, fmt: pct, apply: v => smooth(subG.gain, v * 0.8) });
    m.p('flt', { label: 'Filter', steps: ['LP24', 'BP', 'HP', 'NOTCH'], def: 0, apply: v => { const t = ['lowpass', 'bandpass', 'highpass', 'notch'][v]; f1.type = t; f2.type = v === 0 ? 'lowpass' : 'allpass'; } });
    m.p('cut', { label: 'Cutoff', min: 40, max: 14000, curve: 'exp', def: 0.38, fmt: hz, apply: v => { smooth(f1.frequency, v); smooth(f2.frequency, v); } });
    m.p('res', { label: 'Reso', def: 0.35, fmt: pct, apply: v => { f1.Q.value = 0.7 + v * v * 14; } });
    m.p('env', { label: 'Env', def: 0.2, fmt: pct, apply: v => smooth(envG.gain, v * 4800) });
    m.p('dec', { label: 'Decay', min: 0.03, max: 2, curve: 'exp', def: 0.4, fmt: secs });
    m.p('wrate', { label: 'Wob Rate', steps: DIVS, def: 4 / 8, apply: () => m.retuneLfo() });
    m.p('wcut', { label: 'Wob→Cut', def: 0.55, fmt: pct, apply: v => smooth(wcut.gain, v * 3600) });
    m.p('wpos', { label: 'Wob→Pos', def: 0.35, fmt: pct, apply: v => smooth(wpos.gain, v * 0.4) });
    m.p('wshape', { label: 'Wob Shape', steps: ['SINE', 'TRI', 'SAW', 'SQR'], def: 0, apply: () => m.retuneLfo(true) });
    m.p('drive', { label: 'Drive', def: 0.45, fmt: pct, apply: v => { smooth(pre.gain, 0.45 * (1 + v * 4)); smooth(post.gain, 1 / (1 + v * 1.1)); } });
    m.p('glide', { label: 'Glide', min: 0, max: 0.4, def: 0.05, fmt: secs });
    m.p('level', { label: 'Level', def: 0.6, fmt: pct, apply: v => smooth(out.gain, v * 1.4) });
    m.lfo = null;
    m.lfoRate = () => E.bpm / 60 * DIVMUL[m.v('wrate')];
    m.retuneLfo = function (restart) {
      if (!this.lfo || restart) this.startLfo(now());
      else smooth(this.lfo.frequency, this.lfoRate(), 0.01);
    };
    m.startLfo = function (t) {
      const o = ctx.createOscillator(); o.type = ['sine', 'triangle', 'sawtooth', 'square'][this.v('wshape')];
      o.frequency.value = this.lfoRate(); o.connect(lfoBus); o.start(t);
      if (this.lfo) { try { this.lfo.stop(t); } catch (e) { /* stopped */ } }
      this.lfo = o;
    };
    E.on('bpm', () => m.lfo && smooth(m.lfo.frequency, m.lfoRate(), 0.05));
    m.inEvent('NOTE', function (e) { if (e.kind === 'note') this.note(e); else this.note({ ...e, midi: this.last || 33, dur: 0.2 }); }, 'note in');
    m.inCV('WOB', [], 1, 'external wobble'); m.ins.WOB.node.connect(lfoBus);
    m.inCV('CUT', [f1.detune, f2.detune], 2400, 'cutoff CV');
    m.outAudio('OUT', out, 'bass out');
    m.note = function (e) {
      const t = Math.max(e.time, now()), f = mtof(e.midi); this.last = e.midi;
      const gl = e.slide ? 0.08 : this.v('glide');
      const all = [...v1, ...v2];
      all.forEach(v => [v.a, v.b].forEach(o => { o.frequency.cancelScheduledValues(t); if (gl > 0.002) o.frequency.setTargetAtTime(f, t, gl / 3); else o.frequency.setValueAtTime(f, t); }));
      subO.frequency.cancelScheduledValues(t); subO.frequency.setTargetAtTime(f / 2, t, Math.max(0.001, gl / 3));
      if (!e.slide) {
        this.startLfo(t);
        envCS.offset.cancelScheduledValues(t); envCS.offset.setTargetAtTime(1, t, 0.002); envCS.offset.setTargetAtTime(0, t + 0.008, this.v('dec') / 3);
        vca.gain.cancelScheduledValues(t); vca.gain.setTargetAtTime(0.9 * (e.vel ?? 0.85), t, 0.003);
      } else vca.gain.cancelScheduledValues(t);
      vca.gain.setTargetAtTime(0, t + e.dur, 0.025);
      E.at(t, () => this.ui?.gateLed());
    };
    setTbl(v1, 1); setTbl(v2, 0);
    m.layout = [{ custom: 'titanscope' }, { k: ['t1', 'p1', 't2', 'p2', 'mix2', 'uni', 'sub', 'flt', 'cut', 'res', 'env', 'dec', 'wrate', 'wcut', 'wpos', 'wshape', 'drive', 'glide', 'level'], cls: 'kgrid' }];
    return m;
  }

  // ======================= CHIPTUNE =======================
  function Chip(id) {
    const m = new M(id, { name: 'Bitbox', sub: '8-bit sound chip voice', width: 270, stripe: '#4ad07a', family: 'voice' });
    const waves = { P12: DSP.waveFromFn(ctx, DSP.shapes.pulse(0.125), 80, 512), P25: DSP.waveFromFn(ctx, DSP.shapes.pulse(0.25), 80, 512), P50: DSP.waveFromFn(ctx, DSP.shapes.pulse(0.5), 80, 512), TRI: DSP.waveFromFn(ctx, DSP.shapes.tri4, 80, 512) };
    const o = ctx.createOscillator(), og = gain(1), ns = ctx.createBufferSource(), ng = gain(0), cr = shaper(DSP.curveCrush(6)), vca = gain(0), out = gain(0.5);
    const vib = ctx.createOscillator(), vg = gain(0); vib.frequency.value = 5.8; vib.connect(vg); vg.connect(o.detune); vib.start();
    o.setPeriodicWave(waves.P25); o.start(); ns.buffer = E.lfsr; ns.loop = true; ns.start();
    // a second, short-loop LFSR for METAL (a source's buffer can only be set once)
    const ns2 = ctx.createBufferSource(), ng2 = gain(0); ns2.buffer = E.lfsrShort; ns2.loop = true; ns2.start(); ns2.connect(ng2); ng2.connect(cr);
    o.connect(og); ns.connect(ng); og.connect(cr); ng.connect(cr); cr.connect(vca); vca.connect(out);
    const ARPS = { OFF: [0], MAJ: [0, 4, 7], MIN: [0, 3, 7], OCT: [0, 12], POW: [0, 7, 12], DIM: [0, 3, 6], '7TH': [0, 4, 7, 10] };
    m.p('wave', { label: 'Wave', steps: ['P12', 'P25', 'P50', 'TRI', 'NOISE', 'METAL'], def: 0.2, apply: (v, p) => {
      const w = p.choice; if (waves[w]) { o.setPeriodicWave(waves[w]); og.gain.value = 1; ng.gain.value = 0; ng2.gain.value = 0; } else { og.gain.value = 0; ng.gain.value = w === 'METAL' ? 0 : 0.7; ng2.gain.value = w === 'METAL' ? 0.7 : 0; }
    } });
    m.p('arp', { label: 'Arp', steps: Object.keys(ARPS), def: 0 });
    m.p('arate', { label: 'Arp Spd', steps: [1, 2, 3, 4, 6], def: 0.25, fmt: v => v + 'f' });
    m.p('vib', { label: 'Vibrato', def: 0, fmt: pct, apply: v => smooth(vg.gain, v * 60) });
    m.p('crush', { label: 'Bits', steps: [2, 3, 4, 5, 6, 8], def: 0.8, apply: (v, p) => { cr.curve = DSP.curveCrush(p.choice); } });
    m.p('decay', { label: 'Decay', min: 0.04, max: 2, curve: 'exp', def: 0.4, fmt: secs });
    m.p('oct', { label: 'Octave', steps: [-2, -1, 0, 1, 2], def: 0.75 });
    m.p('level', { label: 'Level', def: 0.55, fmt: pct, apply: v => smooth(out.gain, v * 0.6) });
    m.inEvent('NOTE', function (e) { if (e.kind === 'note') this.note(e); else this.note({ ...e, midi: this.last || 60, dur: 0.1 }); }, 'note in');
    m.outAudio('OUT', out, 'chip out');
    m.note = function (e) {
      const t = Math.max(e.time, now()); this.last = e.midi;
      const midi = e.midi + 12 * this.params.oct.choice, iv = ARPS[this.params.arp.choice], frame = this.params.arate.choice / 60;
      const dur = Math.min(e.dur, 2), dec = this.v('decay');
      o.frequency.cancelScheduledValues(t); ns.playbackRate.cancelScheduledValues(t); ns2.playbackRate.cancelScheduledValues(t);
      let k = 0;
      for (let tt = t; tt < t + dur; tt += iv.length > 1 ? frame : dur + 1) {
        const f = mtof(midi + iv[k++ % iv.length]);
        o.frequency.setValueAtTime(f, tt); ns.playbackRate.setValueAtTime(clamp(f / 300, 0.02, 8), tt); ns2.playbackRate.setValueAtTime(clamp(f / 300, 0.02, 8), tt);
      }
      vca.gain.cancelScheduledValues(t);
      for (let i = 0; i * (1 / 60) < dur; i++) vca.gain.setValueAtTime(Math.round(15 * Math.exp(-i / 60 / dec)) / 15 * 0.8 * (e.vel ?? 0.8), t + i / 60);
      vca.gain.setValueAtTime(0, t + dur);
      E.at(t, () => this.ui?.gateLed());
    };
    m.layout = [{ custom: 'chipart' }, { k: ['wave', 'arp', 'arate', 'vib', 'crush', 'decay', 'oct', 'level'], cls: 'kgrid' }];
    return m;
  }

  // ======================= PHYSICAL MODELING =======================
  function Bodies(id) {
    const m = new M(id, { name: 'Bodies', sub: 'physical modeling resonator', width: 270, stripe: '#e8b04a', family: 'voice' });
    const bus = gain(1), out = gain(0.6); bus.connect(out);
    m.p('model', { label: 'Body', steps: DSP.PM_MODELS, def: 0.2 });
    m.p('bright', { label: 'Bright', def: 0.6, fmt: pct });
    m.p('decay', { label: 'Decay', def: 0.4, fmt: pct });
    m.p('pos', { label: 'Strike Pos', def: 0.3, fmt: pct });
    m.p('struct', { label: 'Structure', def: 0.2, fmt: pct });
    m.p('damp', { label: 'Damping', def: 0.2, fmt: pct });
    m.p('oct', { label: 'Octave', steps: [-2, -1, 0, 1, 2], def: 0.5 });
    m.p('level', { label: 'Level', def: 0.65, fmt: pct, apply: v => smooth(out.gain, v * 0.9) });
    m.voices = [];
    m.inEvent('NOTE', function (e) { if (e.kind === 'note') this.note(e); else this.note({ ...e, midi: this.last || 60 }); }, 'note / trigger in');
    m.outAudio('OUT', out, 'resonator out');
    m.note = function (e) {
      const t = Math.max(e.time, now()); this.last = e.midi;
      const midi = e.midi + 12 * this.params.oct.choice;
      const buf = DSP.renderPM(ctx, this.params.model.choice, mtof(midi), { bright: this.v('bright'), decay: this.v('decay'), pos: this.v('pos'), struct: this.v('struct'), damp: this.v('damp') });
      const s = ctx.createBufferSource(), g = gain((e.vel ?? 0.8) * 0.9); s.buffer = buf; s.connect(g); g.connect(bus); s.start(t);
      this.voices.push(s); if (this.voices.length > 10) { try { this.voices.shift().stop(t); } catch (er) { /* done */ } }
      s.onended = () => { this.voices = this.voices.filter(x => x !== s); };
      E.at(t, () => this.ui?.strike(midi));
    };
    m.layout = [{ custom: 'bodyart' }, { k: ['model', 'bright', 'decay', 'pos', 'struct', 'damp', 'oct', 'level'], cls: 'kgrid' }];
    return m;
  }

  // ======================= MIXER + FX =======================
  function Mixer(id) {
    const m = new M(id, { name: 'Mix Desk', sub: '8 channels · tape delay · plate', width: 480, stripe: '#c9ccd2', family: 'mix' });
    const master = gain(0.8), fx = gain(1), dl = ctx.createDelay(2), fb = gain(0.35), dlp = filt('lowpass', 3500), dret = gain(0.4), conv = ctx.createConvolver(), vret = gain(0.3);
    conv.buffer = DSP.impulse(ctx);
    fx.connect(dl); dl.connect(dlp); dlp.connect(fb); fb.connect(dl); dlp.connect(dret); dret.connect(master);
    fx.connect(conv); conv.connect(vret); vret.connect(master);
    m.ch = [];
    for (let i = 1; i <= 8; i++) {
      const inp = gain(1), lv = gain(0.7), sd = gain(0), an = ctx.createAnalyser();
      an.fftSize = 2048; an.smoothingTimeConstant = 0; // per-channel meter for the auto-mix
      inp.connect(lv); lv.connect(master); lv.connect(sd); sd.connect(fx); lv.connect(an);
      m.p('l' + i, { label: 'Ch' + i, def: 0.7, fmt: pct, small: true, apply: v => smooth(lv.gain, v * v * 1.4) });
      m.p('s' + i, { label: 'Fx' + i, def: 0.1, fmt: pct, small: true, apply: v => smooth(sd.gain, v * 0.9) });
      m.inAudio('IN' + i, inp, 'channel ' + i);
      m.ch.push({ inp, lv, sd, an });
    }
    const DT = ['1/16', '1/8', '3/16', '1/4', '3/8', '1/2'], DTB = [0.25, 0.5, 0.75, 1, 1.5, 2];
    const setDT = () => smooth(dl.delayTime, Math.min(1.9, 60 / E.bpm * DTB[m.v('dtime')]), 0.08);
    m.p('dtime', { label: 'Delay', steps: DT, def: 0.4, apply: setDT });
    m.p('dfb', { label: 'Feedback', min: 0, max: 0.92, def: 0.4, fmt: pct, apply: v => smooth(fb.gain, v) });
    m.p('dly', { label: 'Dly Ret', def: 0.45, fmt: pct, apply: v => smooth(dret.gain, v) });
    m.p('verb', { label: 'Plate', def: 0.35, fmt: pct, apply: v => smooth(vret.gain, v * 0.9) });
    m.p('master', { label: 'Master', def: 0.8, fmt: pct, apply: v => smooth(master.gain, v) });
    E.on('bpm', setDT);
    m.outAudio('OUT', master, 'stereo mix');
    const keys = []; for (let i = 1; i <= 8; i++) keys.push('l' + i); for (let i = 1; i <= 8; i++) keys.push('s' + i);
    m.layout = [{ k: keys, cls: 'kgrid mixgrid' }, { k: ['dtime', 'dfb', 'dly', 'verb', 'master'], cls: 'kgrid' }];
    return m;
  }

  function Monitor(id) {
    const m = new M(id, { name: 'Monitor', sub: 'limiter · speakers · AI ears', width: 320, stripe: '#52f2ff', family: 'mix' });
    const inp = gain(1), lim = ctx.createDynamicsCompressor(), vol = gain(0.8), an = ctx.createAnalyser();
    lim.threshold.value = -6; lim.knee.value = 4; lim.ratio.value = 14; lim.attack.value = 0.002; lim.release.value = 0.12;
    an.fftSize = 2048; an.smoothingTimeConstant = 0.6;
    inp.connect(lim); lim.connect(vol); vol.connect(an); an.connect(E.layers[E.L].bus); // each layer's monitor feeds that layer's master bus
    m.p('vol', { label: 'Volume', def: 0.8, fmt: pct, apply: v => smooth(vol.gain, v) });
    m.inAudio('IN', inp, 'to speakers');
    for (let i = 2; i <= 4; i++) { const g = gain(1); g.connect(inp); m.inAudio('IN' + i, g, 'extra mixer in'); }
    m.analyser = an; m.limiter = lim;
    m.layout = [{ custom: 'monitor' }, { k: ['vol'], cls: 'kgrid c' }];
    return m;
  }

  // Module types that can be added to the rack at will (by you or by the AI)
  const TYPES = {
    StepSeq: { label: 'Step sequencer', prefix: 'seq', make: (id, o) => StepSeq(id, o.name || 'Sequencer ' + String.fromCharCode(65 + Math.max(0, (parseInt(id.replace(/\D/g, '')) || 1) - 1)), o.stripe || ['#f2b632', '#3e8ef0', '#45c46a', '#ef7d2e', '#a46ff0', '#ff5fa2'][(parseInt(id.replace(/\D/g, '')) || 1) % 6]) },
    Entropy: { label: 'Entropy noise sequencer', prefix: 'ent', make: id => Entropy(id) },
    Drums: { label: 'Rhythm Composer drums', prefix: 'drums', make: id => Drums(id) },
    Analog: { label: 'Analog voice (7 models)', prefix: 'voice', make: (id, o) => Analog(id, o.name || 'Voice ' + (o.model || 'LADDER'), o.stripe || '#e9e6dc', o.model || 'LADDER') },
    Titan: { label: 'Titan wavetable bass', prefix: 'titan', make: id => Titan(id) },
    Chip: { label: 'Bitbox chip voice', prefix: 'chip', make: id => Chip(id) },
    Bodies: { label: 'Bodies physical model', prefix: 'bodies', make: id => Bodies(id) },
    Geiger: { label: 'Geiger counter', prefix: 'geiger', make: id => Geiger(id) },
    Slope: { label: 'Slope function generator', prefix: 'slope', make: id => Slope(id) },
    Fold: { label: 'Wavefolder', prefix: 'fold', make: id => Fold(id) },
    VCFQ: { label: 'VCF-Q filter', prefix: 'vcfq', make: id => VCFQ(id) },
    Mixer: { label: 'Mix Desk (8 more channels)', prefix: 'mixer', make: id => Mixer(id) }
  };
  const ALL = { Clock, StepSeq, Entropy, Geiger, Slope, Fold, VCFQ, Drums, Analog, Titan, Chip, Bodies, Mixer, Monitor };
  // make(type, id, opts): build a module, tag its kind, and number its name when it is an extra copy
  function make(type, id, o = {}) {
    const m = E.build(() => TYPES[type] ? TYPES[type].make(id, o) : ALL[type](id, ...(o.args || [])));
    m.kind = type;
    if (TYPES[type] && type !== 'StepSeq' && /\d+$/.test(id)) m.name += ' ' + id.match(/\d+$/)[0];
    return m;
  }
  return { TYPES, make, Clock, StepSeq, Entropy, Geiger, Slope, Fold, VCFQ, Drums, Analog, Titan, Chip, Bodies, Mixer, Monitor, INST, KITS, MODELS, DIVS, SOURCES };
})();
