// helix.js — daily-run module (2026-11-27): Helix, a West Coast-style complex oscillator voice inspired by the news
// of Patching Panda's Holograms (two analog voices, Modulator and Carrier, each with its own 16-step sequence) and
// the Buchla 259 lineage on the wishlist. A modulator oscillator frequency-modulates a sine carrier, which then
// runs through a wavefolder (Timbre, Symmetry). A 16-step timbre sequence moves the fold and the FM index on every
// note, so a plain melody comes out with a different colour per step. A Tone low-pass keeps the folds from turning
// shrill, and the voice has its own pluck / gate / drone envelope so it plays like a low-pass-gated West Coast voice.
'use strict';
const Helix = (() => {
  const E = Engine, ctx = E.ctx, { clamp, mtof } = DSP, M = E.Module;
  const now = () => ctx.currentTime, PI = Math.PI;
  const pct = v => Math.round(v * 100) + '%';
  const secs = v => v < 1 ? Math.round(v * 1000) + 'ms' : v.toFixed(2) + 's';
  const hz = v => v < 1000 ? Math.round(v) + 'Hz' : (v / 1000).toFixed(1) + 'k';
  const gain = (v = 1) => { const g = ctx.createGain(); g.gain.value = v; return g; };
  const smooth = (p, v, tc = 0.02) => { p.cancelScheduledValues(now()); p.setTargetAtTime(v, now(), tc); };
  const RATIOS = ['1/2', '1', '3/2', '2', '5/2', '3', '7/2', '4', 'FREE'];
  const RVAL = { '1/2': 0.5, 1: 1, '3/2': 1.5, 2: 2, '5/2': 2.5, 3: 3, '7/2': 3.5, 4: 4 };
  const MWAVES = ['SINE', 'TRI', 'SAW'];
  const ENVS = ['PLUCK', 'GATE', 'DRONE'];
  const FOLDS = 5; // the folder curve holds five folds; Timbre sets how many of them the carrier reaches
  const FOLD = (() => { const n = 4096, c = new Float32Array(n); for (let i = 0; i < n; i++) { const x = i / (n - 1) * 2 - 1; c[i] = Math.sin(x * PI / 2 * (2 * FOLDS - 1)); } return c; })();

  function HelixVoice(id) {
    const m = new M(id, { name: 'Helix', sub: 'complex oscillator · FM · wavefolder · timbre sequence', width: 430, stripe: '#7a9cff', family: 'voice' });
    // modulator → (index) → carrier frequency; carrier → pre-gain + symmetry bias → folder → tone LPF → VCA → out
    const mod = ctx.createOscillator(), modOut = gain(0.5), index = gain(0), fmIn = gain(0);
    const car = ctx.createOscillator(), pre = gain(0.2), bias = ctx.createConstantSource(), biasG = gain(0), fold = ctx.createWaveShaper();
    const tone = ctx.createBiquadFilter(), dcb = ctx.createBiquadFilter(), vca = gain(0), out = gain(0.6), tap = ctx.createAnalyser();
    car.type = 'sine'; fold.curve = FOLD; fold.oversample = '4x'; tone.type = 'lowpass'; tone.Q.value = 0.4; tap.fftSize = 1024;
    mod.connect(index); index.connect(car.frequency); fmIn.connect(car.frequency); mod.connect(modOut);
    car.connect(pre); bias.connect(biasG); biasG.connect(fold); pre.connect(fold); fold.connect(dcb); dcb.type = 'highpass'; dcb.frequency.value = 25; dcb.connect(tone); tone.connect(vca); vca.connect(out); out.connect(tap);
    const timbreCV = gain(0.25); timbreCV.connect(pre.gain); // TIMBRE input opens the folder
    mod.start(); car.start(); bias.start();
    m.tap = tap; m.f0 = 110; m.step = -1;
    // the 16-step timbre sequence: each step holds a fold offset and an FM offset, both -1..1
    const fresh = () => Array.from({ length: 16 }, (_, i) => ({ t: Math.round((Math.random() * 2 - 1) * 8) / 8 * (i % 4 === 0 ? 0.5 : 1), f: Math.round((Math.random() * 2 - 1) * 8) / 8 }));
    m.seq = fresh();
    m.getData = () => ({ seq: m.seq });
    m.setData = d => { if (Array.isArray(d?.seq) && d.seq.length === 16) m.seq = d.seq.map(s => ({ t: clamp(+s.t || 0, -1, 1), f: clamp(+s.f || 0, -1, 1) })); };
    m.newSeq = () => { m.seq = fresh(); };
    const ratio = () => { const r = m.params.ratio.choice; return r === 'FREE' ? null : RVAL[r]; };
    // the knob positions plus this step's offsets → the folder drive, symmetry and FM index at time t
    const shape = (t, st) => {
      if (!m.params.seqamt || !m.params.timbre || !m.params.fm) return;
      const amt = m.v('seqamt'), s = st || { t: 0, f: 0 };
      const tim = clamp(m.v('timbre') + s.t * amt * 0.45), idx = clamp(m.v('fm') + s.f * amt * 0.35);
      pre.gain.setTargetAtTime(1 / (2 * FOLDS - 1) + tim * (1 - 1 / (2 * FOLDS - 1)) * 0.75, t, 0.008);
      index.gain.setTargetAtTime(idx * idx * 4 * m.f0, t, 0.008); // index scales with pitch, so the timbre holds across the keyboard
      m.cur = { tim, idx };
    };
    const tuneMod = t => { if (!m.params.ratio || !m.params.fine || !m.params.free) return; const r = ratio(); if (r) mod.frequency.setTargetAtTime(m.f0 * r * Math.pow(2, m.v('fine') / 12), t, 0.004); else mod.frequency.setTargetAtTime(m.v('free'), t, 0.02); };
    const setTone = () => { if (m.params.tone) smooth(tone.frequency, m.v('tone')); };
    m.p('ratio', { label: 'Ratio', steps: RATIOS, def: 3 / 8, apply: () => tuneMod(now()) });
    m.p('fine', { label: 'Fine', min: -1, max: 1, def: 0.5, fmt: v => (v >= 0 ? '+' : '') + Math.round(v * 100) + 'c', apply: () => tuneMod(now()) });
    m.p('free', { label: 'Free', min: 0.2, max: 600, curve: 'exp', def: 0.35, fmt: hz, apply: () => tuneMod(now()) });
    m.p('mwave', { label: 'Mod Wave', steps: MWAVES, def: 0, apply: v => { mod.type = ['sine', 'triangle', 'sawtooth'][v]; } });
    m.p('fm', { label: 'FM Index', def: 0.25, fmt: pct, apply: () => shape(now(), m.seq[m.step]) });
    m.p('timbre', { label: 'Timbre', def: 0.25, fmt: pct, apply: () => shape(now(), m.seq[m.step]) });
    m.p('sym', { label: 'Symmetry', min: -1, max: 1, def: 0.5, fmt: v => (v >= 0 ? '+' : '') + Math.round(v * 100) + '%', apply: v => smooth(biasG.gain, v * 0.3) });
    m.p('seqamt', { label: 'Seq Depth', def: 0.45, fmt: pct, apply: () => shape(now(), m.seq[m.step]) });
    m.p('seqlen', { label: 'Seq Len', steps: [4, 8, 12, 16], def: 1 });
    m.p('tone', { label: 'Tone', min: 300, max: 7000, curve: 'exp', def: 0.55, fmt: hz, apply: setTone });
    m.p('env', { label: 'Envelope', steps: ENVS, def: 0, apply: v => { if (ENVS[v] === 'DRONE') smooth(vca.gain, 0.5, 0.2); } });
    m.p('decay', { label: 'Decay', min: 0.05, max: 2.5, curve: 'exp', def: 0.35, fmt: secs });
    m.p('glide', { label: 'Glide', min: 0, max: 0.4, def: 0, fmt: secs });
    m.p('oct', { label: 'Octave', steps: [-2, -1, 0, 1], def: 2 / 3 });
    m.p('level', { label: 'Level', def: 0.65, fmt: pct, apply: v => smooth(out.gain, v * 0.9) });
    m.note = function (e) {
      const t = Math.max(e.time, now() + 0.003); this.last = e.midi;
      const f = mtof(e.midi + 12 * this.params.oct.choice), gl = this.v('glide');
      this.f0 = f;
      gl > 0.005 ? car.frequency.setTargetAtTime(f, t, gl / 3) : car.frequency.setValueAtTime(f, t);
      tuneMod(t);
      const len = this.params.seqlen.choice; this.step = (this.step + 1) % len;
      const st = this.seq[this.step]; shape(t, st);
      // a struck note opens the vactrol-like envelope and a little more fold, which closes as it decays
      const env = this.params.env.choice, vel = e.vel ?? 0.8, pk = 0.55 * (0.55 + vel * 0.45), d = this.v('decay');
      if (env !== 'DRONE') {
        vca.gain.cancelScheduledValues(t); vca.gain.setTargetAtTime(pk, t, 0.003);
        if (env === 'PLUCK') vca.gain.setTargetAtTime(0, t + 0.012, d / 3);
        else { vca.gain.setTargetAtTime(pk * 0.8, t + 0.02, 0.05); vca.gain.setTargetAtTime(0, t + Math.max(0.03, e.dur || 0.2), d / 4); }
        tone.frequency.cancelScheduledValues(t); tone.frequency.setTargetAtTime(Math.min(7000, this.v('tone') * 1.6), t, 0.004); tone.frequency.setTargetAtTime(this.v('tone'), t + 0.01, d / 2.5);
      }
      const s = this.step; E.at(t, () => this.ui?.step?.(s));
    };
    m.inEvent('NOTE', function (e) { if (e.kind === 'note') this.note(e); else this.note({ ...e, midi: this.last || 57, dur: 0.2 }); }, 'note in (each note also steps the timbre sequence)');
    m.inEvent('NEW', function () { this.newSeq(); }, 'write a new timbre sequence');
    m.inAudio('FM', fmIn, 'extra FM into the carrier (audio or CV)');
    m.inAudio('TIMBRE', timbreCV, 'timbre CV: opens the folder'); m.ins.TIMBRE.jt = 'cv';
    m.outAudio('OUT', out, 'folded carrier');
    m.outAudio('MOD', modOut, 'modulator oscillator (use it as an audio-rate LFO)');
    m.layout = [{ custom: 'helix' }, { k: ['ratio', 'fine', 'free', 'mwave', 'fm', 'timbre', 'sym', 'seqamt', 'seqlen', 'tone', 'env', 'decay', 'glide', 'oct', 'level'], cls: 'kgrid' }];
    shape(now()); tuneMod(now()); setTone();
    return m;
  }
  Mods.TYPES.Helix = { label: 'Helix complex oscillator', desc: 'West Coast complex oscillator voice: a modulator (RATIO 1/2..4 or FREE) FMs a sine carrier that runs through a wavefolder (TIMBRE, SYMMETRY); a 16-step timbre sequence changes fold and FM on every note (Seq Depth, Seq Len); TONE low-pass; PLUCK/GATE/DRONE envelope; NOTE in, FM and TIMBRE CV in, OUT and MOD out', prefix: 'helix', make: id => HelixVoice(id) };

  // panel: the live waveform on top, the 16-step timbre sequence (fold up, FM down) below with the current step lit
  UI.customs.helix = (m, el) => {
    const c = UI.h('canvas', 'scr'); el.append(c);
    let cx = null, cur = -1; const buf = new Float32Array(m.tap.fftSize);
    m.ui = Object.assign(m.ui || {}, { step: s => { cur = s; } });
    UI.anim(() => {
      if (!cx) cx = UI.fitCanvas(c, 78);
      const { g, w, h: H } = cx; g.clearRect(0, 0, w, H);
      const wh = H * 0.5;
      m.tap.getFloatTimeDomainData(buf);
      let z = 0; for (let i = 1; i < buf.length / 2; i++) if (buf[i - 1] < 0 && buf[i] >= 0) { z = i; break; }
      g.strokeStyle = '#9db4ff'; g.lineWidth = 1.4; g.beginPath();
      for (let x = 0; x < w; x++) { const v = buf[z + Math.floor(x / w * 400)] || 0, y = wh / 2 - v * (wh / 2 - 3) * 1.6; x ? g.lineTo(x, y) : g.moveTo(x, y); }
      g.stroke();
      const len = m.params.seqlen.choice, cw = (w - 8) / 16, mid = wh + (H - wh) / 2;
      g.fillStyle = '#ffffff14'; g.fillRect(4, mid, w - 8, 1);
      m.seq.forEach((s, i) => {
        const x = 4 + i * cw, on = i < len, lit = i === cur;
        g.fillStyle = !on ? '#ffffff10' : lit ? '#ffffff' : '#9db4ff'; const th = s.t * (H - wh) / 2 * 0.85; g.fillRect(x + 1, th > 0 ? mid - th : mid, cw - 2, Math.abs(th) || 1);
        g.fillStyle = !on ? '#ffffff10' : lit ? '#ffe0a0' : '#ffb85c'; const fh = s.f * (H - wh) / 2 * 0.85; g.fillRect(x + cw * 0.3, mid + 1, cw * 0.4, Math.abs(fh) || 1);
      });
      g.fillStyle = '#dfe6ff'; g.font = '10px "JetBrains Mono", monospace';
      g.fillText(`${m.params.ratio.choice === 'FREE' ? m.params.free.display() : '×' + m.params.ratio.choice} · fold ${pct(m.cur?.tim ?? 0)} · fm ${pct(m.cur?.idx ?? 0)}`, 4, 10);
    });
  };
  return { HelixVoice, RATIOS };
})();
