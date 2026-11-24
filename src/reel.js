// reel.js — daily-run modules (2026-11-24).
// Reel: a tape-replay keyboard voice in the spirit of Mellotron/Chamberlin-style instruments and the 20CC
// Spectron (strings, flutes, choir, brass, cello, organ "tapes", wow and flutter, tape age, a chord mode, and
// notes that run out when the tape does). Every sound is synthesized; no samples.
// LPG Duo: a dual vactrol-style low-pass gate (Buchla 292 lineage): a ping opens the filter and the VCA together
// and they close with the slow, uneven tail of a vactrol, so any voice becomes a plucked, "bongo" sound.
'use strict';
const Reel = (() => {
  const E = Engine, ctx = E.ctx, { clamp, mtof } = DSP;
  const M = E.Module, now = () => ctx.currentTime;
  const pct = v => Math.round(v * 100) + '%';
  const secs = v => v < 1 ? Math.round(v * 1000) + 'ms' : v.toFixed(1) + 's';
  const gain = (v = 1) => { const g = ctx.createGain(); g.gain.value = v; return g; };
  const smooth = (param, v, tc = 0.03) => { param.cancelScheduledValues(now()); param.setTargetAtTime(v, now(), tc); };
  const wave = amps => { const re = new Float32Array(amps.length + 1), im = new Float32Array(amps.length + 1); amps.forEach((a, i) => { im[i + 1] = a; }); return ctx.createPeriodicWave(re, im); };

  // ======================= REEL: tape-replay voice =======================
  const H = n => Array.from({ length: n }, (_, i) => i + 1);
  const TAPES = {
    STRINGS: { w: wave(H(24).map(n => 1 / n * Math.exp(-n / 14))), det: [-9, 0, 8], att: 0.18, form: 0, breath: 0 },
    CELLO: { w: wave(H(20).map(n => (n % 2 ? 1.2 : 0.7) / n * Math.exp(-n / 10))), det: [-5, 5], att: 0.12, form: 0, breath: 0 },
    FLUTE: { w: wave([1, 0.22, 0.07, 0.03, 0.01]), det: [-3, 3], att: 0.09, form: 0, breath: 0.35 },
    CHOIR: { w: wave(H(18).map(n => 1 / Math.pow(n, 1.4))), det: [-11, -3, 4, 12], att: 0.3, form: 1, breath: 0.08 },
    BRASS: { w: wave(H(16).map(n => 1 / Math.pow(n, 0.85) * Math.exp(-n / 9))), det: [-4, 4], att: 0.07, form: 0.4, breath: 0 },
    ORGAN: { w: wave([1, 1, 0.5, 0.8, 0, 0.35, 0, 0.5, 0.1, 0.2]), det: [-2, 2], att: 0.02, form: 0, breath: 0 }
  };
  const CHORDS = { OFF: [0], OCT: [0, 12], '5TH': [0, 7], MAJ: [0, 4, 7], MIN: [0, 3, 7], SUS: [0, 5, 7], '7TH': [0, 3, 7, 10] };
  function ReelVoice(id) {
    const m = new M(id, { name: 'Reel', sub: 'tape-replay keyboard · strings, flutes, choir', width: 410, stripe: '#c98b4a', family: 'voice' });
    const bus = gain(1), f1 = ctx.createBiquadFilter(), f2 = ctx.createBiquadFilter(), tone = ctx.createBiquadFilter(), sat = ctx.createWaveShaper(), out = gain(0.7);
    f1.type = f2.type = 'peaking'; f1.frequency.value = 720; f2.frequency.value = 1180; f1.Q.value = f2.Q.value = 3;
    tone.type = 'lowpass'; tone.Q.value = 0.5; sat.curve = DSP.curveTanh(0.1);
    bus.connect(f1); f1.connect(f2); f2.connect(tone); tone.connect(sat); sat.connect(out);
    // wow (slow) and flutter (fast) wobble every voice's pitch, in cents
    const wow = ctx.createOscillator(), wowG = gain(0), flut = ctx.createOscillator(), flutG = gain(0), wf = gain(1);
    wow.frequency.value = 0.55; flut.frequency.value = 6.8; wow.connect(wowG); flut.connect(flutG); wowG.connect(wf); flutG.connect(wf); wow.start(); flut.start();
    const wowCV = gain(30); wowCV.connect(wf); // WOW input adds up to ±30 cents per unit
    // tape hiss rises with age
    const hiss = ctx.createBufferSource(), hissHP = ctx.createBiquadFilter(), hissG = gain(0);
    hiss.buffer = E.noise; hiss.loop = true; hissHP.type = 'highpass'; hissHP.frequency.value = 4000; hiss.connect(hissHP); hissHP.connect(hissG); hissG.connect(out); hiss.start();
    const toneCV = gain(2400); toneCV.connect(tone.detune);
    const applyTone = () => smooth(tone.frequency, 400 * Math.pow(2, m.v('tone') * 5) * (1 - m.v('age') * 0.45));
    const applyTape = () => { const T = TAPES[m.params.tape.choice]; const g = T.form * 9; smooth(f1.gain, g); smooth(f2.gain, g * 0.8); m.ui?.upd?.(); };
    m.p('tape', { label: 'Tape', steps: Object.keys(TAPES), def: 0, apply: applyTape });
    m.p('chord', { label: 'Chord', steps: Object.keys(CHORDS), def: 0, apply: () => m.ui?.upd?.() });
    m.p('att', { label: 'Attack', min: 0.3, max: 3, curve: 'exp', def: 0.4, fmt: v => '×' + v.toFixed(2) });
    m.p('rel', { label: 'Release', min: 0.05, max: 3, curve: 'exp', def: 0.45, fmt: secs });
    m.p('sus', { label: 'Sustain', min: 0.1, max: 6, curve: 'exp', def: 0.45, fmt: secs });
    m.p('len', { label: 'Tape Len', min: 2, max: 12, def: 0.6, fmt: v => v.toFixed(1) + 's' });
    m.p('wow', { label: 'Wow', def: 0.25, fmt: pct, apply: v => smooth(wowG.gain, v * v * 28) });
    m.p('flut', { label: 'Flutter', def: 0.15, fmt: pct, apply: v => smooth(flutG.gain, v * v * 9) });
    m.p('age', { label: 'Age', def: 0.3, fmt: pct, apply: v => { smooth(hissG.gain, v * v * 0.018); const c = DSP.curveTanh(v * 0.7); sat.curve = c; applyTone(); } });
    m.p('tone', { label: 'Tone', def: 0.7, fmt: v => Math.round(400 * Math.pow(2, v * 5)) + 'Hz', apply: applyTone });
    m.p('oct', { label: 'Octave', steps: [-2, -1, 0, 1], def: 2 / 3 });
    m.p('level', { label: 'Level', def: 0.65, fmt: pct, apply: v => smooth(out.gain, v * 0.9) });
    m.voices = [];
    m.inEvent('NOTE', function (e) { if (e.kind === 'note') this.note(e); else this.note({ ...e, midi: this.last || 60, dur: 0.3 }); }, 'note in');
    m.inAudio('WOW', wowCV, 'pitch wobble CV'); m.ins.WOW.jt = 'cv';
    m.inAudio('TONE', toneCV, 'tone CV'); m.ins.TONE.jt = 'cv';
    m.outAudio('OUT', out, 'tape out');
    m.note = function (e) {
      const t = Math.max(e.time, now() + 0.003); this.last = e.midi;
      const T = TAPES[this.params.tape.choice], base = e.midi + 12 * this.params.oct.choice;
      const held = Math.min(this.v('len'), Math.max(e.dur || 0.2, this.v('sus'))); // a tape runs out after Tape Len seconds
      const att = T.att * this.v('att'), rel = this.v('rel'), vel = (e.vel ?? 0.8);
      for (const iv of CHORDS[this.params.chord.choice]) {
        const midi = base + iv;
        // retriggering a note that is still sounding stops the old one, like a key going back to the start of its tape
        this.voices.filter(v => v.midi === midi).forEach(v => { try { v.g.gain.cancelScheduledValues(t); v.g.gain.setTargetAtTime(0, t, 0.02); v.srcs.forEach(s => s.stop(t + 0.15)); } catch (er) { /* gone */ } v.dead = true; });
        const g = gain(0), srcs = [], k = 0.16 * vel / Math.sqrt(T.det.length * CHORDS[this.params.chord.choice].length);
        for (const d of T.det) { const o = ctx.createOscillator(); o.setPeriodicWave(T.w); o.frequency.value = mtof(midi); o.detune.value = d + (Math.random() - 0.5) * 4; wf.connect(o.detune); o.onended = () => { try { wf.disconnect(o.detune); } catch (er) { /* gone */ } }; o.connect(g); o.start(t); srcs.push(o); }
        if (T.breath) { const n = ctx.createBufferSource(), bp = ctx.createBiquadFilter(), bg = gain(T.breath); n.buffer = E.noise; n.loop = true; n.loopStart = Math.random(); bp.type = 'bandpass'; bp.frequency.value = mtof(midi) * 2; bp.Q.value = 6; n.connect(bp); bp.connect(bg); bg.connect(g); n.start(t); srcs.push(n); }
        g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(k, t + att); g.gain.setValueAtTime(k, t + Math.max(att, held)); g.gain.setTargetAtTime(0, t + Math.max(att, held), rel / 3);
        const end = t + Math.max(att, held) + rel * 1.6 + 0.05;
        srcs.forEach(s => s.stop(end));
        g.connect(bus);
        const v = { midi, g, srcs, t, end, held };
        srcs[0].addEventListener('ended', () => { this.voices = this.voices.filter(x => x !== v); try { g.disconnect(); } catch (er) { /* gone */ } });
        this.voices.push(v);
      }
      while (this.voices.length > 14) { const v = this.voices.shift(); try { v.srcs.forEach(s => s.stop()); } catch (er) { /* gone */ } }
      E.at(t, () => this.ui?.strike?.(held));
    };
    m.layout = [{ custom: 'reel' }, { k: ['tape', 'chord', 'att', 'rel', 'sus', 'len', 'wow', 'flut', 'age', 'tone', 'oct', 'level'], cls: 'kgrid' }];
    return m;
  }

  // ======================= LPG DUO: dual low-pass gate =======================
  const MODES = ['LP', 'COMBO', 'VCA'];
  function LPG(id) {
    const m = new M(id, { name: 'LPG Duo', sub: 'dual vactrol low-pass gate · plucks and bongos', width: 300, stripe: '#9fd4a8', family: 'mod' });
    const sum = gain(1);
    m.ch = [1, 2].map(k => {
      const inp = gain(1), lp = ctx.createBiquadFilter(), vca = gain(0), out = gain(1), cvF = gain(4800), cvA = gain(0.5);
      lp.type = 'lowpass'; lp.Q.value = 0.9; lp.frequency.value = 60;
      inp.connect(lp); lp.connect(vca); vca.connect(out); out.connect(sum);
      cvF.connect(lp.detune); cvA.connect(vca.gain);
      const cvIn = gain(1); cvIn.connect(cvF); cvIn.connect(cvA);
      return { k, inp, lp, vca, out, cvIn, open: 0, ping: -9, peak: 0 };
    });
    // openness o (0..1) → cutoff and gain, by mode
    const fOf = (k, o) => { const md = m.params['m' + k].choice; return md === 'VCA' ? 18000 : 60 * Math.pow(2, o * 8.2); };
    const aOf = (k, o) => { const md = m.params['m' + k].choice; return md === 'LP' ? 0.9 : Math.pow(o, md === 'VCA' ? 1.6 : 1.25); };
    const rest = k => m.v('o' + k);
    const settle = k => { const c = m.ch[k - 1], o = rest(k); smooth(c.lp.frequency, fOf(k, o)); smooth(c.vca.gain, aOf(k, o)); };
    for (const k of [1, 2]) {
      m.p('o' + k, { label: 'Offset ' + k, def: 0, fmt: pct, apply: () => settle(k) });
      m.p('d' + k, { label: 'Decay ' + k, min: 0.06, max: 3, curve: 'exp', def: 0.4, fmt: secs });
      m.p('s' + k, { label: 'Strike ' + k, def: 0.8, fmt: pct });
      m.p('m' + k, { label: 'Mode ' + k, steps: MODES, def: 0.5, apply: () => settle(k) });
    }
    m.p('level', { label: 'Level', def: 0.8, fmt: pct, apply: v => smooth(sum.gain, v * 1.2) });
    m.ping = function (k, t, vel = 1) {
      const c = this.ch[k - 1], o0 = rest(k), peak = clamp(o0 + (1 - o0) * this.v('s' + k) * vel), dec = this.v('d' + k);
      t = Math.max(t, now() + 0.002);
      const F = c.lp.frequency, G = c.vca.gain;
      for (const [P, top, bot] of [[F, fOf(k, peak), fOf(k, o0)], [G, aOf(k, peak), aOf(k, o0)]]) {
        P.cancelScheduledValues(t); P.setTargetAtTime(top, t, 0.0025);
        // a vactrol lets go fast at first, then slowly: two time constants
        P.setTargetAtTime(bot + (top - bot) * 0.25, t + 0.012, dec * 0.18);
        P.setTargetAtTime(bot, t + 0.012 + dec * 0.35, dec * 0.45);
      }
      E.at(t, () => { c.ping = performance.now(); c.peak = peak; });
    };
    for (const k of [1, 2]) {
      const c = m.ch[k - 1];
      m.inAudio('IN' + k, c.inp, 'audio in ' + k);
      m.inEvent('TRIG' + k, function (e) { this.ping(k, e.time, e.vel ?? 1); if (k === 1 && !E.cables.some(x => x.to.mod === this.id && x.to.port === 'TRIG2')) this.ping(2, e.time, e.vel ?? 1); }, `ping gate ${k}${k === 1 ? ' (also gate 2 when TRIG2 is empty)' : ''}`);
      m.inAudio('CV' + k, c.cvIn, 'openness CV ' + k); m.ins['CV' + k].jt = 'cv';
      m.outAudio('OUT' + k, c.out, 'gate out ' + k);
    }
    m.outAudio('OUT', sum, 'both gates mixed');
    m.openNow = k => { const c = m.ch[k - 1], o = rest(k), age = (performance.now() - c.ping) / 1000, dec = m.v('d' + k); return age < 0 ? o : o + (c.peak - o) * (age < 0.03 ? 1 : 0.25 + 0.75 * Math.exp(-age / (dec * 0.18))) * Math.exp(-Math.max(0, age - dec * 0.35) / (dec * 0.45)); };
    m.layout = [{ custom: 'lpg' }, { k: ['o1', 'd1', 's1', 'm1', 'o2', 'd2', 's2', 'm2', 'level'], cls: 'kgrid' }];
    return m;
  }

  const TYPES = {
    Reel: { label: 'Reel tape-replay voice', desc: 'Mellotron-style strings, cello, flute, choir, brass and organ tapes with wow, flutter, age and a chord mode; notes sustain until the tape runs out', prefix: 'reel', make: id => ReelVoice(id) },
    LPG: { label: 'LPG Duo low-pass gates', desc: 'two vactrol low-pass gates: TRIG pings open filter+VCA together for plucky, bongo-like notes; IN1/IN2 audio, CV1/CV2 openness, OUT1/OUT2/OUT', prefix: 'lpg', make: id => LPG(id) }
  };
  Object.assign(Mods.TYPES, TYPES);

  // ---------- panel displays ----------
  const h = UI.h, fit = UI.fitCanvas;
  UI.customs.reel = (m, el) => {
    const c = h('canvas', 'scr'), lcd = h('div', 'lcd'); el.append(c, lcd);
    let cx = null, ang = 0, hits = [];
    const upd = () => { lcd.textContent = `${m.params.tape.choice} · CHORD ${m.params.chord.choice} · ${m.voices.length} on`; };
    const draw = () => {
      if (!cx) cx = fit(c, 66);
      const { g, w, h: Hh } = cx; g.clearRect(0, 0, w, Hh);
      ang += 0.02 + m.voices.length * 0.012;
      const reelAt = (x) => { g.save(); g.translate(x, 30); g.rotate(ang); g.strokeStyle = '#e8cfa0'; g.lineWidth = 1.5; g.beginPath(); g.arc(0, 0, 22, 0, Math.PI * 2); g.stroke(); for (let i = 0; i < 3; i++) { g.rotate(Math.PI * 2 / 3); g.beginPath(); g.moveTo(5, 0); g.lineTo(20, 0); g.stroke(); } g.fillStyle = '#e8cfa0'; g.beginPath(); g.arc(0, 0, 4, 0, Math.PI * 2); g.fill(); g.restore(); };
      reelAt(34); reelAt(w - 34);
      g.strokeStyle = '#6b4a2a'; g.lineWidth = 3; g.beginPath(); g.moveTo(34, 52); g.lineTo(w - 34, 52); g.stroke();
      // how far through its tape each sounding note is
      const tNow = ctx.currentTime, len = m.v('len');
      m.voices.slice(-6).forEach((v, i) => { const f = clamp((tNow - v.t) / len); g.fillStyle = '#9ef0b7'; g.fillRect(64, 8 + i * 7, (w - 128) * f, 4); g.fillStyle = '#2b3a30'; g.fillRect(64 + (w - 128) * f, 8 + i * 7, (w - 128) * (1 - f), 4); });
      hits = hits.filter(x => performance.now() - x < 300);
      if (Math.random() < 0.05) upd();
    };
    m.ui = { upd, strike: () => { hits.push(performance.now()); upd(); } }; upd();
    UI.anim(draw);
  };
  UI.customs.lpg = (m, el) => {
    const c = h('canvas', 'scr'); el.append(c); let cx = null;
    const draw = () => {
      if (!cx) cx = fit(c, 50);
      const { g, w, h: Hh } = cx; g.clearRect(0, 0, w, Hh);
      [1, 2].forEach((k, i) => {
        const o = clamp(m.openNow(k)), x = 12 + i * (w / 2), bw = w / 2 - 24;
        g.fillStyle = '#1b2a20'; g.fillRect(x, 10, bw, 14);
        g.fillStyle = `rgba(255,${150 + o * 90},${60 + o * 40},${0.25 + o * 0.75})`; g.fillRect(x, 10, bw * o, 14);
        g.shadowColor = '#ffb03b'; g.shadowBlur = o * 14; g.fillStyle = `rgba(255,190,90,${o})`; g.beginPath(); g.arc(x + bw / 2, 38, 5, 0, Math.PI * 2); g.fill(); g.shadowBlur = 0;
        g.fillStyle = '#9ef0b7'; g.font = '9px JetBrains Mono, monospace'; g.fillText(`${k} ${m.params['m' + k].choice}`, x, 8);
      });
    };
    UI.anim(draw);
  };
  return { TYPES, TAPES, CHORDS, ReelVoice, LPG };
})();
