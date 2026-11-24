// song.js — the song engine. Lays out a form (verse / chorus by default), plans each section a section ahead
// (patterns, drums, chords) with the AI hand while the live section plays and gets tweaked, switches everything on
// the bar line, runs builds, push-pull, fills and lifts, and keeps any part from looping unchanged for too long.
'use strict';
const Song = (() => {
  const E = Engine, T = Theory, $ = s => document.querySelector(s), clamp = DSP.clamp, rnd = Math.random, pick = T.pick;
  const L8 = 'ABCDEFGH';
  const S = { on: false, form: null, sections: [], cur: -1, startBar: null, bar: -1, total: 0, loop: false, done: false, partsBy: [{}, {}], two: false, live: 0, hook: null, verse: null, progs: {}, lift: 0, base: null, planning: -1, autos: [], fresh: {}, p: null, ready: false };
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const log = (h) => AI.log('song', h);
  // each layer has its own parts (which sequencer plays bass, lead, arp); S.parts means the layer in context
  Object.defineProperty(S, 'parts', { get: () => S.partsBy[E.L], set: v => { S.partsBy[E.L] = v; }, enumerable: true });
  // with two layers, choruses (and sometimes the bridge) live on Layer B, everything else on Layer A
  const layerFor = role => !S.two ? 0 : ['chorus', 'drop', 'post'].includes(role) ? 1 : ['bridge', 'break'].includes(role) ? (rnd() < 0.5 ? 1 : 0) : 0;
  const DRUM_SLOT = { intro: 0, verse: 1, pre: 2, build: 2, chorus: 3, drop: 3, post: 4, bridge: 4, break: 4, outro: 5 }, ROLL = 6, FILL = 7, PULL = 7;
  // how many bars each kind of part may loop unchanged before it starts to grate
  const PATIENCE = { lead: 8, arp: 12, bass: 16, drums: 16, texture: 24 };

  // ======================= SETUP =======================
  function choice(p) {
    const v = $('#form')?.value || 'auto';
    if (v === 'off' || !p || p.mode === 'tweak') return null;
    return T.formFor(p, v === 'auto' ? null : v);
  }
  // who plays what: bass, lead or arp, from the voice each sequencer drives
  function assignParts() {
    const parts = {};
    for (const id of AI.activeSeqs()) {
      const m = E.mods[id], dests = E.cablesFrom(id, 'NOTE').map(c => E.mods[c.to.mod]).filter(Boolean);
      const kinds = dests.map(d => d.kind), oct = m.params.oct.choice;
      parts[id] = kinds.includes('Titan') || dests.some(d => d.id === 'acid') || oct <= 2 ? 'bass' : kinds.some(k => k === 'Chip' || k === 'Bodies' || k === 'Reel') ? 'arp' : 'lead';
    }
    // keep a single bass line; extra low parts become arps an octave up
    const bass = Object.keys(parts).filter(id => parts[id] === 'bass');
    bass.slice(1).forEach(id => { parts[id] = 'arp'; });
    return parts;
  }
  function drumBase() {
    const d = E.mods.drums; if (!d) return {};
    const out = {}; d.INST.forEach((ins, r) => { const s = d.pats[d.cur][r].map(v => v === 2 ? 'X' : v ? 'x' : '.').join(''); if (/[xX]/.test(s)) out[ins] = s; });
    if (!out.BD) out.BD = 'x...x...x...x...'; if (!out.CH) out.CH = 'x.x.x.x.x.x.x.x.';
    return out;
  }
  function layout(formName, p) {
    const F = T.FORMS[formName], bpm = E.bpm, want = p.mode === 'perform' && p.dur ? p.dur * bpm / 240 : null;
    const nominal = F.parts.reduce((s, x) => s + x[1], 0), k = want ? want / nominal : 1;
    let bar = 0; const out = [];
    F.parts.forEach(([role, bars, tag], i) => {
      const b = Math.max(4, Math.round(bars * k / 4) * 4);
      const R = T.ROLES[role], fin = tag === 'final';
      const name = role === 'pre' ? 'Pre-chorus' : role === 'post' ? 'Post-chorus' : (fin ? 'Final ' : '') + role[0].toUpperCase() + role.slice(1);
      out.push({ i, role, name, bars: b, start: bar, final: fin, layer: layerFor(role), energy: fin ? T.FINAL.energy : R.energy, slot: fin ? T.FINAL.slot : R.slot, dslot: DRUM_SLOT[role] ?? 1, why: fin ? T.FINAL.why : R.why, planned: false, written: false });
      bar += b;
    });
    // number repeated sections: Verse 2, Chorus 2
    const seen = {}; out.forEach(s => { seen[s.role] = (seen[s.role] || 0) + 1; if (seen[s.role] > 1 && !s.final && ['verse', 'chorus', 'build', 'drop', 'pre'].includes(s.role)) s.name += ' ' + seen[s.role]; });
    return { sections: out, total: bar };
  }

  // ======================= PLANNING (data) =======================
  function planData(s) { return E.within(s.layer || 0, () => planData0(s)); }
  function planData0(s) {
    const scale = E.mods.seq1?.params.scale.choice || 'MINOR', role = s.role;
    const prev = S.progs[role];
    // repeated sections keep their harmony (that is what makes them recognisable); verse 2 sometimes varies it
    let prog = prev && (role !== 'verse' || rnd() < 0.7) ? prev.slice() : T.progressionFor(role, scale, prev);
    const cad = T.cadence(role, prog, scale); prog = cad.prog; S.progs[role] = S.progs[role] || prog;
    const R = T.ROLES[role];
    s.prog = prog; s.hr = R.hr; s.cadence = cad.kind; s.chords = prog.map(d => T.chordName(scale, d)).join(' – ');
    s.parts = {};
    const half = ['dubstep'].includes(S.p?.genre);
    for (const [id, part] of Object.entries(S.parts)) {
      let line;
      if (part === 'bass') line = T.bassLine(role, half);
      else if (part === 'arp') line = T.arpLine(role);
      else if (role === 'chorus' || role === 'drop') { line = T.melodyLine(role, { hook: S.hook, chaos: S.p?.tr.chaos }); if (!S.hook) S.hook = line.notes; line.idea = S.hook === line.notes ? 'the hook' : 'the hook, varied'; }
      else if (role === 'verse' && S.verse) { line = T.melodyLine(role, { hook: AI.variation(S.verse, 'B').notes, chaos: S.p?.tr.chaos }); line.idea = 'verse melody developed from verse 1'; }
      else if ((role === 'intro' || role === 'outro') && S.hook && R.lead === 'hint') { const n = S.hook.map((v, i) => i < 8 && v != null && rnd() < 0.6 ? v : null); line = { notes: n, accents: [], slides: [], idea: 'a fragment of the hook' }; }
      else { line = T.melodyLine(role, { chaos: S.p?.tr.chaos }); if (role === 'verse') S.verse = line.notes; }
      if (s.final && part === 'arp') line = T.arpLine('chorus');
      s.parts[id] = line;
    }
    s.drums = T.drumsFor(role, S.base);
    s.planned = true;
  }
  // the actions that write a planned section into its pattern banks, done by the AI hand
  function writeActs(s, fast) {
    const acts = [{ do: 'say', text: `Planning ${s.name} (${s.bars} bars): ${s.chords}, ${s.cadence}. ${s.why}.` }];
    for (const [id, line] of Object.entries(s.parts)) acts.push({ do: 'pattern', mod: id, pat: L8[s.slot], notes: line.notes, accents: line.accents || [], slides: line.slides || [], ratchets: line.ratchets, probs: line.probs, why: `${s.name}, ${S.parts[id]}: ${line.idea}` });
    if (E.mods.drums) acts.push({ do: 'drumbank', pat: L8[s.dslot], rows: s.drums, fast, why: `${s.name} drums` });
    return acts;
  }
  // instant write (when the hand did not get there in time)
  function writeNow(s) { return E.within(s.layer || 0, () => writeNow0(s)); }
  function writeNow0(s) {
    for (const [id, line] of Object.entries(s.parts)) { const m = E.mods[id]; if (!m) continue; m.pats[s.slot] = Array.from({ length: 16 }, (_, i) => ({ n: line.notes[i] ?? 0, g: line.notes[i] == null ? 0 : 1, a: (line.accents || []).includes(i) ? 1 : 0, s: (line.slides || []).includes(i) ? 1 : 0, p: line.probs?.[i] ?? 1, r: line.ratchets?.[i] ?? 1 })); m.ui?.renderAll(); }
    const d = E.mods.drums; if (d) { d.pats[s.dslot] = d.INST.map(ins => String(s.drums[ins] || '').padEnd(16, '.').slice(0, 16).split('').map(c => c === 'X' ? 2 : c === 'x' ? 1 : 0)); d.ui?.renderGrid(); }
    s.written = true;
  }
  function bankFromRows(rows) { const d = E.mods.drums; return d.INST.map(ins => String(rows[ins] || '').padEnd(16, '.').slice(0, 16).split('').map(c => c === 'X' ? 2 : c === 'x' ? 1 : 0)); }

  // optional: Claude writes the next section while this one plays
  async function claudeSection(s) {
    if ($('#brain')?.value !== 'claude' || !AI.claude) return false;
    const L = s.layer || 0;
    const { scale, root, partsTxt, prevTxt } = E.within(L, () => ({ scale: E.mods.seq1?.params.scale.choice, root: E.mods.seq1?.params.root.choice,
      partsTxt: Object.entries(S.parts).map(([id, part]) => { const m = E.mods[id]; return `${id} (${part}, drives ${E.cablesFrom(id, 'NOTE').map(c => c.to.mod).join('+')}, octave ${m.params.oct.choice})`; }).join('; '),
      prevTxt: S.sections.filter(x => x.planned && x !== s).slice(-3).map(x => `${x.name}: chords ${x.prog?.join(',')}; ` + Object.entries(x.parts || {}).map(([id, l]) => `${id} ${l.notes.map(v => v == null ? '.' : v).join(' ')}`).join(' | ')).join('\n') }));
    const prompt = `${T.PRIMER}

You are writing the next section of a song that is playing live on a modular synth. Key: ${root} ${scale}. Genre: ${S.p?.genre}. Personality: ${S.p?.persona}.
SECTION: ${s.name} (role ${s.role}), ${s.bars} bars, energy ${Math.round(s.energy * 100)}%. Purpose: ${s.why}.
PARTS: ${partsTxt}. Drums are 16-step strings per instrument (x hit, X accent, . rest) from BD SD CP CH OH LT HT RS CB CY.
EARLIER SECTIONS:
${prevTxt || 'none yet'}
${S.hook ? `THE HOOK (chorus lead, chord-relative): ${S.hook.map(v => v == null ? '.' : v).join(' ')}` : ''}
Avoid sameness: do not copy earlier sections note for note unless it is the hook returning; vary rhythm and register.
Reply with JSON only: {"progression":[2-4 chord degrees 0-6],"barsPerChord":1|2|4,"parts":{"<seqId>":{"notes":[16 chord-relative degrees or null],"accents":[],"slides":[]}},"drums":{"BD":"x...x...x...x...",...},"idea":"one sentence"}`;
    try {
      const r = await AI.claude.json(prompt, { modelTier: 'default' });
      if (!r || !Array.isArray(r.progression) || !r.parts) return false;
      return E.within(L, () => {
      const okLine = l => Array.isArray(l?.notes) && l.notes.length >= 8;
      s.prog = r.progression.map(x => clamp(Math.round(+x) || 0, 0, 6)).slice(0, 8); s.hr = [1, 2, 4].includes(+r.barsPerChord) ? +r.barsPerChord : s.hr;
      s.chords = s.prog.map(d => T.chordName(scale, d)).join(' – '); s.cadence = 'Claude\'s choice';
      for (const id of Object.keys(S.parts)) if (okLine(r.parts[id])) s.parts[id] = { notes: r.parts[id].notes.slice(0, 16).map(v => v == null ? null : clamp(Math.round(+v), -7, 14)), accents: r.parts[id].accents || [], slides: r.parts[id].slides || [], idea: 'Claude' };
      if (r.drums && typeof r.drums === 'object') s.drums = Object.fromEntries(Object.entries(r.drums).filter(([k, v]) => E.mods.drums?.INST.includes(k) && typeof v === 'string'));
      if ((s.role === 'chorus' || s.role === 'drop') && !S.hook) { const lead = Object.keys(S.parts).find(id => S.parts[id] === 'lead'); if (lead) S.hook = s.parts[lead].notes; }
      log(`Claude wrote ${esc(s.name)}: ${esc(r.idea || '')}`);
      return true;
      });
    } catch (e) { log(`Claude could not plan ${esc(s.name)} (${esc(e.code || e.message)}), using the built-in theory`); return false; }
  }
  async function planAhead(i) {
    const s = S.sections[i]; if (!s || s.planned || S.planning === i) return;
    S.planning = i; render();
    planData(s);
    await claudeSection(s);
    // a section reusing the bank that is playing right now cannot be written ahead: it repeats the live patterns
    const live = S.sections[S.cur];
    if (live && (live.layer || 0) === (s.layer || 0) && live.slot === s.slot && live.dslot === s.dslot) { s.written = true; s.parts = live.parts; s.drums = live.drums; S.planning = -1; render(); return; }
    if (S.on) {
      // the second hand plans ahead while the first tweaks; a section on the layer that is off screen is written directly
      if ((s.layer || 0) === AI.viewTarget()) await AI.runAll(writeActs(s, true), 1);
      else { writeNow(s); log(`${esc(s.name)} written into ${E.layerName(s.layer)}, waiting silently for its crossfade`); }
    }
    if (!s.written) s.written = S.sections[i] === s;
    S.planning = -1; render();
  }

  // ======================= THE BAR CLOCK =======================
  // fired while scheduling the downbeat of bar `bar`; everything queued here lands on the next bar line
  function onBar(ev) {
    if (E.L !== 0) return; // both layers' clocks tick together: Layer A's bar drives the song
    if (!S.on || !E.running) return;
    if (S.startBar == null) return;
    const songBar = ev.bar - S.startBar; S.bar = songBar;
    const nextBar = songBar + 1, tNext = ev.time + ev.dur;
    tickAutos();
    if (nextBar >= S.total) { if (S.loop) { restart(ev.bar + 1, tNext); } else { S.done = true; S.on = false; E.at(tNext, render); } return; }
    const idx = S.sections.findIndex(s => s.start === nextBar);
    if (idx >= 0) enter(idx, tNext, (ev.bar + 1) * 16);
    else inside(nextBar, tNext);
    E.within(S.live, () => freshness(songBar));
  }
  E.on('bar', onBar);
  function enter(i, t, step) {
    const s = S.sections[i], L = s.layer || 0, prev = S.live;
    E.within(L, () => enter0(i, t, step));
    if (L !== prev) crossTo(L, prev, t, s);
  }
  // crossfade the layers' masters across the downbeat: the new layer rises over the last beat, the old one falls after
  function crossTo(L, prev, t, s) {
    const beat = 4 * E.sixteenth();
    E.fadeLayer(L, 1, beat, t - beat); E.fadeLayer(prev, 0, beat * 2, t);
    S.live = L;
    E.at(t, () => log(`crossfade: ${E.layerName(prev)} fades down, ${E.layerName(L)} fades up for ${esc(s.name)}`));
  }
  function enter0(i, t, step) {
    const s = S.sections[i];
    if (!s.planned) planData(s);
    if (!s.written) writeNow(s);
    for (const id of Object.keys(S.parts)) E.mods[id]?.queue(s.slot);
    E.mods.drums?.queue(s.dslot);
    E.setHarmony(step, s.prog, s.hr);
    const d = E.mods.drums; if (d) d.mute = d.INST.map(() => false);
    AI.target.energy = s.energy;
    scene(s, t);
    if (s.final && !S.lift && rnd() < 0.5) lift(t);
    E.at(t, () => {
      S.cur = i; render();
      if (UI.followMode !== 'off' && (s.layer || 0) !== AI.viewTarget()) AI.toLayer(s.layer || 0, `${s.name} lives on ${E.layerName(s.layer || 0)}`);
      Mix.wantSoon(s.layer || 0, 2 * 16 * E.sixteenth() * 1000); // rebalance once the new section has settled
      log(`<b>${esc(s.name)}</b> · ${esc(s.chords)} · energy ${Math.round(s.energy * 100)}%`);
      AI.think(`Song · ${s.name}`, `${s.name}: ${s.chords}. ${s.why}.`);
      Object.keys(S.fresh).forEach(k => { S.fresh[k] = 0; });
      const nxt = S.sections[i + 1] || (S.loop ? S.sections.find(x => x.role === 'verse') : null);
      if (nxt) planAhead(S.sections.indexOf(nxt));
    });
  }
  // inside a section: fills on phrase ends, the build's roll and pull, small push-pull waves
  function inside(nextBar, t) {
    const s = S.sections.find(x => nextBar >= x.start && nextBar < x.start + x.bars); if (!s) return;
    const nx = S.sections[S.sections.indexOf(s) + 1], k = nextBar - s.start, barS = 16 * E.sixteenth();
    if (nx && (nx.layer || 0) !== (s.layer || 0) && (s.role === 'build' || s.role === 'pre')) {
      // push-pull across layers: the next layer creeps in under the build, then drops out for the pull bar
      if (k === Math.floor(s.bars / 2)) { E.fadeLayer(nx.layer || 0, 0.22, (s.bars - k - 1) * barS, t); E.at(t, () => log(`${E.layerName(nx.layer || 0)} creeps in under the build`)); }
      if (s.bars - k === 1) E.fadeLayer(nx.layer || 0, 0, barS * 0.25, t);
    }
    E.within(s.layer || 0, () => inside0(s, nextBar, t));
  }
  function inside0(s, nextBar, t) {
    const k = nextBar - s.start, left = s.bars - k, d = E.mods.drums;
    const isBuild = s.role === 'build' || s.role === 'pre';
    if (isBuild && d) {
      if (left === 1) { // the pull: kick and bass drop out for the last bar, snare rolls, then everything pushes back in
        d.pats[PULL] = bankFromRows(T.drumsFor(s.role, S.base, 'pull')); d.queue(PULL);
        for (const [id, part] of Object.entries(S.parts)) { const m = E.mods[id]; if (!m) continue; if (part === 'bass') { m.pats[7] = m.pats[7].map(x => ({ ...x, g: 0 })); m.queue(7); } }
        E.at(t, () => log('pull: kick and bass out for one bar'));
      } else if (k === Math.floor(s.bars / 2)) { d.pats[ROLL] = bankFromRows(T.drumsFor(s.role, S.base, 'roll')); d.queue(ROLL); E.at(t, () => log('build: snare roll doubles up')); }
      return;
    }
    if (left === 1 && d && s.bars >= 4) { d.pats[FILL] = bankFromRows(T.drumsFor(s.role, d.INST.reduce((o, ins, r) => { const x = d.pats[s.dslot][r].map(v => v === 2 ? 'X' : v ? 'x' : '.').join(''); if (/[xX]/.test(x)) o[ins] = x; return o; }, {}), 'fill')); d.queue(FILL); E.at(t, () => log('fill into the next section')); return; }
    if (d && d.cur === FILL) d.queue(s.dslot);
    // push-pull wave: halfway through an 8-bar phrase, dip the filters for a bar, then push them back
    if (s.bars >= 8 && k % 8 === 4) { AI.voiceCut().forEach(([m, key]) => { const p = E.mods[m].params[key]; auto(p, clamp(p.n - 0.12), t, 16 * E.sixteenth() * 0.9); auto(p, p.n, t + 16 * E.sixteenth(), 16 * E.sixteenth() * 0.5); }); }
  }
  function restart(bar, t) { S.startBar = bar; S.sections.forEach(s => { if (s.role !== 'intro') s.planned = s.written = false; }); const i = Math.max(0, S.sections.findIndex(x => x.role === 'verse')); S.startBar = bar - S.sections[i].start; enter(i, t, bar * 16); }

  // ======================= SCENES, BUILDS, LIFTS (knob automation off the hand) =======================
  function auto(p, to, t0, dur) { S.autos = S.autos.filter(a => a.p !== p || a.t0 > t0); S.autos.push({ p, from: null, to: clamp(to), t0, t1: t0 + Math.max(0.05, dur) }); }
  function tickAutos() {
    const now = E.ctx.currentTime;
    S.autos = S.autos.filter(a => {
      if (now < a.t0) return true;
      if (a.from == null) a.from = a.p.n;
      const k = clamp((now - a.t0) / (a.t1 - a.t0)); a.p.setNorm(a.from + (a.to - a.from) * k);
      return k < 1;
    });
  }
  setInterval(tickAutos, 40);
  function scene(s, t) {
    const barS = 16 * E.sixteenth(), isBuild = s.role === 'build' || s.role === 'pre';
    for (const [m, key] of AI.voiceCut()) {
      const p = E.mods[m].params[key];
      if (isBuild) { auto(p, 0.18, t, barS * 0.5); auto(p, clamp(0.55 + s.energy * 0.3), t + barS * 0.5, barS * (s.bars - 0.5)); }
      else auto(p, clamp(0.16 + s.energy * 0.55 + (rnd() - 0.5) * 0.08), t, barS * (s.energy > 0.8 ? 0.25 : 1.5));
    }
    const mx = E.mods.mixer; if (!mx) return;
    const verb = s.role === 'bridge' || s.role === 'break' ? 0.55 : isBuild ? 0.3 : s.role === 'outro' ? 0.6 : 0.28;
    if (isBuild) { auto(mx.params.verb, 0.55, t, barS * s.bars); auto(mx.params.dfb, 0.6, t + barS * (s.bars - 1), barS); }
    else { auto(mx.params.verb, verb, t, barS); auto(mx.params.dfb, 0.38, t, barS * 0.5); }
  }
  function lift(t) {
    S.lift = pick([1, 2]);
    setTimeout(() => {
      for (const L of [0, 1]) E.within(L, () => { for (const id of [...Object.keys(S.parts), 'ent', 'marbles']) { const p = E.mods[id]?.params.root; if (p) p.setNorm(p.normOf(DSP.NOTE_NAMES[(p.value + S.lift) % 12])); } });
      log(`key lift: up ${S.lift} semitone${S.lift > 1 ? 's' : ''} for the final chorus`);
    }, Math.max(0, (t - E.ctx.currentTime - 0.18) * 1000));
  }

  // ======================= ANTI-SAMENESS =======================
  // count the bars each part has looped unchanged; past its patience, change it before it gets annoying
  const sig = id => { const m = E.mods[id]; if (!m) return ''; return id === 'drums' ? m.cur + JSON.stringify(m.pats[m.cur]) : m.cur + JSON.stringify(m.pats[m.cur].map(x => x.g ? x.n : '.')); };
  const lastSig = {};
  function freshness(bar) {
    if (!(S.on || (AI.busy && AI.prof?.mode === 'perform'))) return;
    const ids = [...AI.activeSeqs(), ...(AI.routed('drums') ? ['drums'] : [])];
    for (const id of ids) {
      const g = sig(id); if (lastSig[id] !== g) { lastSig[id] = g; S.fresh[id] = 0; continue; }
      S.fresh[id] = (S.fresh[id] || 0) + 1;
      const kind = id === 'drums' ? 'drums' : S.parts[id] || 'lead', pat = Math.round(PATIENCE[kind] * (S.p?.genre === 'techno' || S.p?.genre === 'ambient' ? 1.5 : 1));
      if (S.fresh[id] < pat) continue;
      // how much is left of this section: no point varying right before it changes anyway
      const s = S.sections[S.cur]; if (s && S.on && s.start + s.bars - bar <= 2) continue;
      S.fresh[id] = 0; lastSig[id] = null;
      freshen(id, kind, pat);
    }
  }
  function freshen(id, kind, bars) {
    const m = E.mods[id]; let acts;
    if (id === 'drums') {
      const ins = pick(['CH', 'OH', 'RS', 'CP', 'SD', 'CB', 'LT']), r = m.INST.indexOf(ins), cur = m.pats[m.cur][r].map(v => v === 2 ? 'X' : v ? 'x' : '.').join('');
      const how = pick(['add ghost notes', 'shift the accents', 'drop a few hits']);
      const nx = how === 'add ghost notes' ? cur.split('').map(c => c === '.' && rnd() < 0.2 ? 'x' : c).join('') : how === 'drop a few hits' ? cur.split('').map(c => c !== '.' && rnd() < 0.3 ? '.' : c).join('') : cur.slice(2) + cur.slice(0, 2);
      acts = [{ do: 'drums', inst: ins, pattern: nx, why: `the drums looped ${bars} bars unchanged: ${how} on ${ins}` }];
    } else {
      const v = AI.variation(m.pats[m.cur].map(x => x.g ? x.n : null), pick(['B', 'B', 'C']));
      acts = [{ do: 'steps', mod: id, notes: v.notes, ratchets: v.ratchets, accents: m.pats[m.cur].map((x, i) => x.a ? i : -1).filter(i => i >= 0), why: `${kind} looped ${bars} bars unchanged, getting same-y: ${v.why}` }];
    }
    if (E.L !== AI.viewTarget()) return; // that layer is off screen: let the hand do it once it is back
    if (AI.busy && !S.on) AI.fixQueue.push(...acts); else AI.runAll(acts, 1);
  }

  // ======================= RUNNING =======================
  async function begin(p, o = {}) {
    stop();
    const form = choice(p); if (!form) return false;
    S.p = p; S.form = form; S.loop = !!o.loop; S.done = false; S.cur = -1; S.hook = null; S.verse = null; S.progs = {}; S.lift = 0; S.fresh = {}; S.autos = [];
    S.partsBy = [E.within(0, assignParts), E.hasLayer(1) ? E.within(1, assignParts) : {}];
    if (!Object.keys(S.partsBy[0]).length) { log('no sequencer is playing a voice, so there is no song to arrange'); return false; }
    S.two = !!o.layers && Object.keys(S.partsBy[1]).length > 0; S.live = 0;
    S.base = E.within(0, drumBase);
    const L = layout(form, p); S.sections = L.sections; S.total = L.total;
    AI.blocked = new Set(['switch pattern', 'write variation', 'transpose', 'add layer', 'layer in', 'layer out', 'drop kick', 'bring kick']);
    // every part follows the song's chords and switches on the bar line; song chains are off (the song engine drives)
    const acts = [{ do: 'say', text: `Song form: ${T.FORMS[form].label}. ${S.sections.map(s => s.name).join(' → ')} (${S.total} bars). Parts: ${Object.entries(S.parts).map(([id, r]) => id + ' ' + r).join(', ')}.` }];
    for (const id of Object.keys(S.parts)) { const m = E.mods[id]; m.setSong(null, false); acts.push({ do: 'knob', mod: id, key: 'follow', to: 'SONG', why: 'follow the song\'s chords' }, { do: 'knob', mod: id, key: 'len', to: 16 }, { do: 'knob', mod: id, key: 'trans', to: '0' }); }
    E.mods.drums?.setSong(null, false);
    // pull pattern slot for every part (silent bass, sparse others)
    for (const id of Object.keys(S.parts)) { const m = E.mods[id]; m.pats[7] = m.pats[7].map(x => ({ ...x, g: 0 })); }
    // Layer B gets the same set-up directly (it is off screen and silent until its first crossfade)
    if (S.two) E.within(1, () => {
      for (const id of Object.keys(S.parts)) { const m = E.mods[id]; m.setSong(null, false); m.params.follow.setNorm(m.params.follow.normOf('SONG')); m.params.len.setNorm(m.params.len.normOf('16') ?? 1); m.params.trans.setNorm(m.params.trans.normOf('0') ?? m.params.trans.n); m.pats[7] = m.pats[7].map(x => ({ ...x, g: 0 })); }
      E.mods.drums?.setSong(null, false);
    });
    E.fadeLayer(0, 1, 0.3); if (E.hasLayer(1)) E.fadeLayer(1, 0, 0.3);
    if (S.two) acts.push({ do: 'say', text: `Two layers: ${S.sections.filter(s => s.layer).map(s => s.name).join(', ')} live on Layer B; the rest on Layer A. The masters crossfade on the downbeats.` });
    S.on = true; render();
    await AI.runAll(acts);
    planData(S.sections[0]); await claudeSection(S.sections[0]);
    await AI.runAll(writeActs(S.sections[0], false)); S.sections[0].written = true;
    if (!S.on) return false;
    // start on the next bar line
    S.startBar = Math.floor(E.step / 16) + 1;
    log(`the song starts at the next bar`);
    return true;
  }
  // the live loop during a set: the performer tweaks the playing section; the planner writes the next one between moves
  async function performLoop(p) {
    while (!AI.abort && S.on && !S.done) {
      if (AI.fixQueue.length) { await AI.runAll(AI.fixQueue.splice(0)); continue; }
      if (Mix.needs(AI.viewTarget())) { await AI.toLayer(S.live); await Mix.pass({ L: E.V, why: 'new section, new balance' }); continue; }
      await AI.shapeOnce();
      await UI.sleep((2600 + rnd() * 3200) * (1 + p.tr.calm) * (1 - p.tr.chaos * 0.35));
    }
  }
  function stop() { S.on = false; S.startBar = null; S.autos = []; AI.blocked = new Set(); render(); }

  // ======================= SONG MAP =======================
  function render() {
    const el = $('#timeline'); if (!el) return;
    if (!S.sections.length || (!S.on && !S.done)) { if (!S.sections.length) return; }
    el.innerHTML = '';
    S.sections.forEach((s, i) => {
      const d = document.createElement('div'); d.className = 'sec songsec' + (i === S.cur ? ' now' : '') + (S.planning === i ? ' planning' : '') + (s.written && i !== S.cur ? ' ready' : '');
      d.style.flex = s.bars; d.title = `${s.name}: ${s.bars} bars${s.chords ? ' · ' + s.chords : ''}${s.cadence ? ' · ' + s.cadence : ''}. ${s.why}`;
      d.innerHTML = `<span>${esc(s.name.replace('Final ', 'Fin. '))}${S.two ? `<b class="ly">${'AB'[s.layer || 0]}</b>` : ''}</span><i style="height:${Math.round(s.energy * 100)}%"></i>`;
      if (S.two && s.layer) d.classList.add('lyb');
      el.append(d);
    });
    const hd = document.createElement('div'); hd.className = 'head'; hd.id = 'songhead'; el.append(hd);
    $('#tlend').textContent = `${S.total} bars`;
  }
  setInterval(() => {
    if (!S.sections.length || S.startBar == null) return;
    const hd = $('#songhead'); if (!hd) return;
    const b = clamp((E.step / 16 - S.startBar) / S.total);
    hd.style.left = `calc(${(b * 100).toFixed(2)}% - 1px)`;
    const s = S.sections[S.cur];
    if (s) { const k = Math.floor(E.step / 16) - S.startBar - s.start + 1; $('#tlsec').textContent = `${s.name} · bar ${Math.max(1, Math.min(s.bars, k))}/${s.bars} · ${T.chordName(E.mods.seq1?.params.scale.choice || 'MINOR', E.chordAt(E.step))}`; }
    $('#tlnow').textContent = `bar ${Math.max(0, Math.floor(E.step / 16) - S.startBar + 1)}`;
  }, 250);

  // form chooser
  const sel = $('#form');
  if (sel) { Object.entries(T.FORMS).forEach(([k, f]) => { const o = document.createElement('option'); o.value = k; o.textContent = 'Song: ' + f.label; sel.append(o); }); }
  return Object.assign(S, { begin, performLoop, stop, choice, render, planData, layout });
})();
