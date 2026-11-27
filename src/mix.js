// mix.js — the AI's mix engineer. Meters every mixer channel (loudness-weighted, like LUFS), works out what each
// channel is playing (drums, bass, lead, arp, texture, effects), and balances them: drums as the anchor, bass just
// under the kick, the lead up front, arps tucked behind, textures and noises buried. A watchdog also catches
// high-pitched, repeating sounds that have been left on too long and darkens, lowers or mutes them.
'use strict';
const Mix = (() => {
  const E = Engine, clamp = DSP.clamp, $ = s => document.querySelector(s);
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const M = { on: true, last: [null, null], lastPass: [0, 0], want: [0, 0], shrill: {}, strikes: {}, busy: false };
  // where each kind of part sits, in dB relative to the drums
  const TARGET = { drums: 0, bass: -1.5, lead: -3, arp: -8, texture: -11, fx: -13, other: -6 };
  const WHY = { drums: 'the drums anchor the mix', bass: 'the bass sits just under the kick', lead: 'the lead sits up front', arp: 'the arp tucks in behind the lead', texture: 'texture belongs in the back', fx: 'noises and effects stay in the background', other: 'a supporting part, behind the lead' };
  const ORDER = ['drums', 'bass', 'lead', 'arp', 'other', 'texture', 'fx'];

  // loudness weighting per FFT bin (K-weighting: high-pass near 40 Hz and a +4 dB shelf above ~2 kHz)
  const N = 1024, W = new Float32Array(N), sr = E.ctx.sampleRate;
  for (let i = 0; i < N; i++) {
    const f = Math.max(1, i / N * sr / 2), hp = Math.pow(f, 4) / (Math.pow(f, 4) + Math.pow(40, 4));
    const t = clamp((Math.log2(f) - Math.log2(1000)) / (Math.log2(3000) - Math.log2(1000)));
    W[i] = hp * Math.pow(10, 4 * t * t * (3 - 2 * t) / 10);
  }
  const HI = Math.round(3000 / (sr / 2) * N); // "high-pitched" = energy above 3 kHz

  // ---------- who plays what ----------
  function roleOf(id, depth = 0) {
    const m = E.mods[id]; if (!m || depth > 4) return 'other';
    const k = m.kind;
    if (k === 'Tape') return null;
    if (k === 'Drums') return 'drums';
    if (k === 'Geiger') return 'fx';
    if (k === 'Grains') return 'texture';
    if (k === 'Titan') return 'bass';
    if (k === 'Sampler') { const fam = Samples.INFO[m.params.bank.choice]?.family; if (fam === 'texture') return 'texture'; if (fam === 'fx') return 'fx'; if (fam === 'breaks') return 'arp'; }
    if (m.ins.NOTE) {
      const c = E.findCable(id, 'NOTE'), src = c && E.mods[c.from.mod];
      if (!src) return 'other';
      if (src.kind === 'StepSeq') {
        const part = Song.partsBy?.[E.L]?.[src.id]; if (part) return part;
        const oct = +src.params.oct.choice;
        return oct <= 2 ? 'bass' : (k === 'Chip' || k === 'Bodies') ? 'arp' : 'lead';
      }
      if (src.kind === 'Comper') return 'other'; // chords sit behind the lead
      return (k === 'Bodies' && src.kind === 'Geiger') ? 'texture' : 'arp';
    }
    // a processor (filter, folder): it plays whatever feeds it
    const up = E.cables.find(c => c.to.mod === id && m.ins[c.to.port]?.jt === 'audio');
    return up ? roleOf(up.from.mod, depth + 1) : 'other';
  }
  // the voice behind a channel (follows filters and folders upstream)
  function voiceOf(id, depth = 0) {
    const m = E.mods[id]; if (!m || depth > 4) return id;
    if (m.ins.NOTE || ['Drums', 'Geiger', 'Grains', 'Titan'].includes(m.kind)) return id;
    const up = E.cables.find(c => c.to.mod === id && m.ins[c.to.port]?.jt === 'audio');
    return up ? voiceOf(up.from.mod, depth + 1) : id;
  }
  function channels() {
    const out = [];
    for (const mid of E.order) {
      const mx = E.mods[mid]; if (mx.kind !== 'Mixer') continue;
      for (let i = 1; i <= 8; i++) {
        const c = E.findCable(mid, 'IN' + i); if (!c) continue;
        const role = roleOf(c.from.mod); if (!role) continue;
        const src = c.from.mod;
        out.push({ mix: mid, ch: i, key: 'l' + i, src, voice: voiceOf(src), name: E.mods[src].name, role, an: mx.ch[i - 1].an, level: mx.params['l' + i], send: mx.params['s' + i] });
      }
    }
    return out;
  }

  // ---------- metering ----------
  async function measure(L = E.V, ms = 2000) {
    const chs = E.within(L, channels); if (!chs.length) return null;
    const buf = new Float32Array(N);
    chs.forEach(c => { c.p = 0; c.raw = 0; c.hi = 0; c.k = 0; });
    const frames = Math.max(3, Math.round(ms / 60));
    for (let f = 0; f < frames; f++) {
      for (const c of chs) {
        c.an.getFloatFrequencyData(buf);
        let w = 0, raw = 0, hi = 0;
        for (let i = 1; i < N; i++) { const v = buf[i]; if (!(v > -160)) continue; const pw = Math.pow(10, v / 10); w += pw * W[i]; raw += pw; if (i >= HI) hi += pw; }
        c.p += w; c.raw += raw; c.hi += hi; c.k++;
      }
      await sleep(60);
    }
    for (const c of chs) { c.db = 10 * Math.log10(c.p / c.k + 1e-20); c.hiShare = c.raw > 0 ? c.hi / c.raw : 0; c.active = c.db > -80; delete c.an; }
    const act = chs.filter(c => c.active);
    const implied = c => c.db - TARGET[c.role];
    const drums = act.find(c => c.role === 'drums');
    const med = arr => { const s = arr.slice().sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : -60; };
    const ref = drums ? implied(drums) : med(act.map(implied));
    const seen = {};
    act.sort((a, b) => ORDER.indexOf(a.role) - ORDER.indexOf(b.role)).forEach(c => {
      seen[c.role] = (seen[c.role] || 0) + 1;
      c.want = ref + TARGET[c.role] - (seen[c.role] - 1) * 3; // a second part of the same kind sits a bit further back
      c.err = c.want - c.db;
    });
    const err = act.length > 1 ? act.reduce((s, c) => s + Math.abs(c.err), 0) / act.length : 0;
    return { L, t: performance.now(), chs, ref, err };
  }

  // ---------- balancing ----------
  function plan(meas, max = 5) {
    const moves = [];
    for (const c of meas.chs) {
      if (!c.active || c.err == null) continue;
      const d = clamp(c.err, -9, 6); if (Math.abs(d) < 2) continue;
      const nv = clamp(c.level.n * Math.pow(10, d / 40), 0.06, 1);
      if (Math.abs(nv - c.level.n) < 0.02) continue;
      moves.push({ c, d, nv });
    }
    moves.sort((a, b) => Math.abs(b.d) - Math.abs(a.d));
    const acts = moves.slice(0, max).map(({ c, d, nv }) => ({ do: 'knob', mod: c.mix, key: c.key, to: nv, why: `${c.name} ${d > 0 ? 'up' : 'down'} ${Math.abs(d).toFixed(0)} dB: ${WHY[c.role]}` }));
    // sends: keep the low end dry, push background parts back with space
    for (const c of meas.chs) {
      if (!c.active || !c.send) continue;
      if (c.role === 'bass' && c.send.n > 0.2) acts.push({ do: 'knob', mod: c.mix, key: 's' + c.ch, to: 0.06, why: `keep the bass dry and centred` });
      else if ((c.role === 'texture' || c.role === 'fx') && c.send.n < 0.28) acts.push({ do: 'knob', mod: c.mix, key: 's' + c.ch, to: 0.35, why: `push ${c.name} back with reverb and delay` });
    }
    return acts;
  }
  const rel = c => { const d = c.db - c.want; return Math.abs(d) < 2 ? 'sits right' : `${Math.abs(d).toFixed(0)} dB too ${d > 0 ? 'loud' : 'quiet'}`; };
  function summary(meas) {
    return meas.chs.filter(c => c.active).map(c => `${c.name} (${c.role}) ${rel(c)}`).join(' · ');
  }
  function describe() {
    return [0, 1].map(L => M.last[L] && E.hasLayer(L) ? `${E.layerName(L)} mix: ${summary(M.last[L])}` : null).filter(Boolean).join('\n') || 'no mix measurement yet';
  }
  function applyNow(acts) { for (const a of acts) { const p = E.mods[a.mod]?.params[a.key]; if (p && !p.locked) p.setNorm(typeof a.to === 'number' ? a.to : (p.normOf(a.to) ?? p.n)); } }
  // measure, then rebalance with the hand (or instantly, on a layer that is not on screen)
  async function pass({ L = E.V, h = 0, why = '' } = {}) {
    if (M.busy || !E.hasLayer(L)) return [];
    M.busy = true;
    try {
      const meas = await measure(L, 2200); if (!meas) return [];
      M.last[L] = meas; M.lastPass[L] = performance.now(); M.want[L] = 0;
      const acts = E.within(L, () => plan(meas));
      AI.log('mix', `mix check${E.hasLayer(1) ? ' on ' + E.layerName(L) : ''}${why ? ' (' + esc(why) + ')' : ''}: ${esc(summary(meas)) || 'nothing playing'}`);
      if (!acts.length) return acts;
      if (L === AI.viewTarget()) await AI.runAll([{ do: 'say', text: `Mixing: ${acts.length} level${acts.length > 1 ? 's' : ''} to fix so every part sits in its place.` }, ...acts], h);
      else E.within(L, () => applyNow(acts));
      return acts;
    } finally { M.busy = false; }
  }
  // the performer asks this between moves
  const needs = L => M.on && E.hasLayer(L) && !M.busy && ((M.want[L] && performance.now() > M.want[L]) || (M.last[L] && M.last[L].err > 2.5 && performance.now() - M.lastPass[L] > 15000 && performance.now() - M.last[L].t < 6000));
  const wantSoon = (L, ms = 3000) => { M.want[L] = performance.now() + ms; };

  // ---------- shrill guard ----------
  const K = (mod, key, to, why) => ({ do: 'knob', mod, key, to, why });
  const stepDown = p => p.steps ? String(p.steps[Math.max(0, p.value - 1)]) : null;
  function shrillFix(c) {
    const acts = [], v = c.voice, m = E.mods[v], key = `${c.mix}.${c.ch}`;
    const strikes = M.strikes[key] = (M.strikes[key] || 0) + 1;
    if (strikes >= 3) return [K(c.mix, c.key, 0.05, `${c.name} keeps sounding shrill: taking it out of the mix`)];
    if (m) {
      if (m.kind === 'Analog') { if (m.params.cutoff.n > 0.4) acts.push(K(v, 'cutoff', m.params.cutoff.n - 0.2, 'darken the shrill top')); if (m.params.res.n > 0.55) acts.push(K(v, 'res', 0.35, 'tame the whistling resonance')); }
      if (m.kind === 'VCFQ' && m.params.cut) acts.push(K(v, 'cut', Math.max(0.2, m.params.cut.n - 0.2), 'darken the shrill top'));
      if ((m.kind === 'Chip' || m.kind === 'Bodies') && m.params.oct.value > 0) acts.push(K(v, 'oct', stepDown(m.params.oct), 'an octave down: too high and piercing'));
      if (m.kind === 'Bodies' && m.params.bright.n > 0.4) acts.push(K(v, 'bright', m.params.bright.n - 0.25, 'softer, less piercing strike'));
      if (m.kind === 'Chip' && m.params.wave.choice === 'P12') acts.push(K(v, 'wave', 'TRI', 'a softer wave than the thin 12% pulse'));
      if (m.kind === 'Reel') { if (m.params.oct.value > 1) acts.push(K(v, 'oct', stepDown(m.params.oct), 'an octave down, the tape was too high')); if (m.params.tone.n > 0.5) acts.push(K(v, 'tone', m.params.tone.n - 0.2, 'a darker tape')); }
      if (m.kind === 'Helix') { if (m.params.tone.n > 0.35) acts.push(K(v, 'tone', m.params.tone.n - 0.2, 'close the tone on the folds')); if (m.params.timbre.n > 0.3) acts.push(K(v, 'timbre', m.params.timbre.n - 0.15, 'fewer folds, less fizz')); }
      if (m.kind === 'Geiger') acts.push(K(v, 'tone', Math.max(0, m.params.tone.n - 0.3), 'duller clicks'), K(v, 'vol', m.params.vol.n * 0.6, 'quieter clicks'));
      const nc = E.findCable(v, 'NOTE'), seq = nc && E.mods[nc.from.mod];
      if (seq?.kind === 'StepSeq' && +seq.params.oct.choice >= 5) acts.push(K(seq.id, 'oct', stepDown(seq.params.oct), `${seq.name} an octave down, it was too high`));
    }
    acts.push(K(c.mix, c.key, clamp(c.level.n * Math.pow(10, -5 / 40), 0.05, 1), `${c.name} down 5 dB: a high, repeating sound grates when it is left on`));
    return acts;
  }
  // high drums that repeat (cowbell, cymbal, rimshot, hats) sit low; the cowbell lowest of all
  const HI_CAP = { CB: 0.32, CY: 0.45, RS: 0.55, CH: 0.6, OH: 0.6, HT: 0.75 };
  function tameHighDrums(d, quiet) {
    if (!d?.lvl || !d.pats) return [];
    const pat = d.pats[d.cur] || [], fixed = [];
    for (const [ins, cap] of Object.entries(HI_CAP)) {
      const i = d.INST.indexOf(ins); if (i < 0) continue;
      const hits = (pat[i] || []).filter(Boolean).length, c = hits >= 6 ? cap * 0.8 : hits >= 3 ? cap : Math.min(1, cap + 0.2);
      if (hits && d.lvl[i] > c + 0.01) { d.lvl[i] = c; fixed.push(ins); }
    }
    if (fixed.length && !quiet) AI.log('mix', `high drums kept low so they do not grate: ${fixed.join(' ')}`);
    return fixed;
  }
  // static check at design time: resonance screams and parts pitched too high
  function ungrate(why = 'nothing high-pitched should be left grating') {
    const acts = [];
    if (E.mods.drums) tameHighDrums(E.mods.drums);
    for (const id of E.order) {
      const m = E.mods[id]; if (!m || !E.cables.some(c => c.from.mod === id)) continue;
      if (m.kind === 'Analog' && m.params.res.n > 0.85 && m.params.cutoff.n > 0.7) acts.push(K(id, 'res', 0.5, 'a resonant peak this high screams'));
      if (m.kind === 'StepSeq' && +m.params.oct.choice >= 6 && E.cablesFrom(id, 'NOTE').length) acts.push(K(id, 'oct', '5', `${m.name} out of the piercing top octave`));
      if ((m.kind === 'Chip' || m.kind === 'Bodies') && m.params.oct.value >= m.params.oct.steps.length - 1) acts.push(K(id, 'oct', stepDown(m.params.oct), 'too high, it would whistle'));
      if (m.kind === 'Geiger' && m.params.vol.n > 0.7) acts.push(K(id, 'vol', 0.45, 'clicks belong in the background'));
    }
    if (acts.length) acts.unshift({ do: 'say', text: `Checking for shrill sounds: ${why}.` });
    return acts;
  }
  // every few seconds while the AI is in charge: meter the audible layers, flag shrill parts and drifting balance
  async function watch() {
    if (!M.on || !E.running || !(AI.busy || Song.on) || M.busy) return;
    for (const L of [0, 1]) {
      if (!E.hasLayer(L) || E.layers[L].bus.gain.value < 0.15) continue;
      const meas = await measure(L, 900); if (!meas) continue;
      M.last[L] = meas;
      for (const c of meas.chs) {
        const key = `${L}.${c.mix}.${c.ch}`;
        const shrill = c.active && c.role !== 'drums' && c.hiShare > 0.32 && c.db > meas.ref - 16;
        M.shrill[key] = shrill ? (M.shrill[key] || 0) + 3 : 0;
        if (M.shrill[key] >= 9) { // a high, repeating sound left on for 9 seconds: fix it now
          M.shrill[key] = 0;
          const acts = E.within(L, () => shrillFix(c));
          AI.log('mix', `${esc(c.name)} has been high-pitched and repeating for a while (${Math.round(c.hiShare * 100)}% of it above 3 kHz): fixing it before it grates`);
          if (L === AI.viewTarget() && AI.busy) AI.runAll(acts, 1); else E.within(L, () => applyNow(acts));
        }
        if (c.role === 'drums' && c.active && performance.now() - (E.layers[L].mods[c.voice]?._hiTame || 0) > 20000) { const d = E.layers[L].mods[c.voice]; if (d) { d._hiTame = performance.now(); tameHighDrums(d); } }
        if (c.role === 'drums' && c.active && c.hiShare > 0.6) { // all sizzle and no thump: pull the hats back a little
          const d = E.layers[L].mods[c.voice];
          if (d?.lvl && performance.now() - (d._hatFix || 0) > 30000) { d._hatFix = performance.now(); ['CH', 'OH', 'CY', 'CB', 'RS'].forEach(ins => { const i = d.INST.indexOf(ins); if (i >= 0) d.lvl[i] = Math.max(0.35, d.lvl[i] * 0.8); }); AI.log('mix', 'the hi-hats were sizzling over everything: pulled them back'); }
        }
      }
    }
  }
  setInterval(() => { watch().catch(e => console.error(e)); }, 3000);

  const box = $('#automix'); if (box) box.onchange = () => { M.on = box.checked; };
  const btn = $('#mixnow');
  if (btn) btn.onclick = async () => {
    if (!E.running) { AI.log('sys', 'start the clock first: the mix engineer needs to hear the parts'); return; }
    if (AI.busy) { wantSoon(E.V, 0); AI.log('sys', 'the performer will rebalance the mix after its current move'); return; }
    AI.setBusy(true); try { await pass({ why: 'you asked' }); } finally { AI.setBusy(false); }
  };
  return Object.assign(M, { tameHighDrums, measure, plan, pass, needs, wantSoon, ungrate, shrillFix, describe, channels, roleOf, TARGET });
})();
