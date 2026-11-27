// ai.js — the AI performer: reads the brief, patches the rack, listens to the output and learns which moves work.
'use strict';
const AI = (() => {
  const E = Engine, $ = s => document.querySelector(s);
  const clamp = DSP.clamp, rnd = Math.random, pick = a => a[Math.floor(rnd() * a.length)];
  const A = { busy: false, abort: false, q: {}, prof: null, sections: null, startT: 0, endT: 0, claude: null };

  // ======================= LOGGING / CONSOLE UI =======================
  const logEl = $('#log');
  const fmtT = s => { s = Math.max(0, Math.floor(s)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
  A.log = (cls, html) => {
    const el = document.createElement('div'); el.className = cls;
    const t = A.startT ? fmtT((performance.now() - A.startT) / 1000) : '--:--';
    el.innerHTML = `<span class="t">${t}</span>${html}`; logEl.append(el);
    while (logEl.children.length > 300) logEl.firstChild.remove();
    logEl.scrollTop = logEl.scrollHeight;
  };
  const esc = s => String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  A.think = (state, text) => { $('#aistate').textContent = state; if (text != null) $('#aitext').textContent = text; };
  const setBusy = b => { A.busy = b; if (!b) { UI.pinView = false; E.L = E.V; } $('#thought').classList.toggle('busy', b); $('#run').disabled = b; $('#stop').disabled = !b; if (!b) UI.handOff(); };

  // ======================= EARS =======================
  const ears = { rms: -90, peak: -90, cent: 0, sub: 0, low: 0, mid: 0, high: 0, flux: 0, energy: 0, bright: 0, clip: 0 };
  A.ears = ears;
  const target = { energy: 0.5, bright: 0.5, loud: -14 };
  let prevSpec = null;
  function listen() {
    const an = E.mods.monitor.analyser, n = an.frequencyBinCount;
    const td = new Float32Array(an.fftSize), fd = new Float32Array(n);
    an.getFloatTimeDomainData(td); an.getFloatFrequencyData(fd);
    let s = 0, pk = 0; for (let i = 0; i < td.length; i++) { s += td[i] * td[i]; pk = Math.max(pk, Math.abs(td[i])); }
    const rms = 10 * Math.log10(s / td.length + 1e-12), peak = 20 * Math.log10(pk + 1e-9);
    const ny = E.ctx.sampleRate / 2; let num = 0, den = 0; const band = [0, 0, 0, 0]; let flux = 0;
    const mag = new Float32Array(n);
    for (let i = 1; i < n; i++) {
      const m = Math.pow(10, fd[i] / 20); mag[i] = m; const f = i / n * ny;
      num += f * m * m; den += m * m;
      band[f < 90 ? 0 : f < 300 ? 1 : f < 2500 ? 2 : 3] += m * m;
      if (prevSpec) flux += Math.max(0, m - prevSpec[i]);
    }
    prevSpec = mag;
    const tot = band.reduce((a, b) => a + b, 1e-12);
    const k = 0.25;
    ears.rms += (rms - ears.rms) * k; ears.peak = Math.max(peak, ears.peak - 0.6);
    ears.cent += ((den > 0 ? num / den : 0) - ears.cent) * k;
    ears.sub += (band[0] / tot - ears.sub) * k; ears.low += (band[1] / tot - ears.low) * k; ears.mid += (band[2] / tot - ears.mid) * k; ears.high += (band[3] / tot - ears.high) * k;
    ears.flux += (Math.min(1, flux / 3) - ears.flux) * 0.15;
    ears.bright = clamp(Math.log2(Math.max(150, ears.cent) / 300) / Math.log2(7000 / 300));
    const loudN = clamp((ears.rms + 42) / 32);
    ears.energy = clamp(loudN * 0.6 + ears.flux * 0.45 + ears.high * 0.25 + ears.sub * 0.1 - 0.08);
    ears.clip = E.mods.monitor.limiter.reduction < -9 ? 1 : 0;
    drawEars();
  }
  const earRows = [
    ['LOUD', () => clamp((ears.rms + 42) / 32), () => clamp((target.loud + 42) / 32), () => ears.rms > -80 ? ears.rms.toFixed(1) + 'dB' : '—'],
    ['BRIGHT', () => ears.bright, () => target.bright, () => Math.round(ears.cent) + 'Hz'],
    ['LOW END', () => clamp((ears.sub + ears.low) * 1.2), null, () => Math.round((ears.sub + ears.low) * 100) + '%'],
    ['MOTION', () => ears.flux, null, () => Math.round(ears.flux * 100) + '%'],
    ['ENERGY', () => ears.energy, () => target.energy, () => Math.round(ears.energy * 100) + '%']
  ];
  const earEls = earRows.map(([lbl]) => {
    const l = document.createElement('span'); l.className = 'lbl'; l.textContent = lbl;
    const m = document.createElement('div'); m.className = 'meter'; m.innerHTML = '<i></i><b></b>';
    const v = document.createElement('span'); v.className = 'val';
    $('#ears').append(l, m, v); return { i: m.querySelector('i'), b: m.querySelector('b'), v };
  });
  function drawEars() {
    earRows.forEach(([, f, t, txt], k) => {
      const e = earEls[k]; e.i.style.width = (f() * 100).toFixed(1) + '%'; e.v.textContent = txt();
      if (t) { e.b.style.display = ''; e.b.style.left = `calc(${(t() * 100).toFixed(1)}% - 1px)`; } else e.b.style.display = 'none';
    });
  }
  setInterval(listen, 200);

  // ======================= LEARNED VALUES =======================
  try { A.q = JSON.parse(localStorage.getItem('patchmind.q') || '{}'); } catch (e) { A.q = {}; }
  const saveQ = () => { try { localStorage.setItem('patchmind.q', JSON.stringify(A.q)); } catch (e) { /* storage off */ } };
  function drawSkills() {
    const el = $('#skills'); el.innerHTML = '';
    const rows = Object.entries(A.q).sort((a, b) => b[1].v - a[1].v).slice(0, 12);
    if (!rows.length) { el.innerHTML = '<span style="grid-column:1/-1;color:var(--ink-faint)">Nothing learned yet. Each move the AI makes is scored by how much closer it brought the sound to the target.</span>'; return; }
    for (const [k, o] of rows) {
      const w = Math.min(50, Math.abs(o.v) * 100);
      el.insertAdjacentHTML('beforeend', `<span>${k} <span style="color:var(--ink-faint)">×${o.n}</span></span><div class="bar"><i class="${o.v < 0 ? 'neg' : ''}" style="${o.v < 0 ? `left:${50 - w}%;width:${w}%` : `left:50%;width:${w}%`}"></i></div><span>${o.v >= 0 ? '+' : ''}${o.v.toFixed(2)}</span>`);
    }
  }
  drawSkills();

  // ======================= ACTION EXECUTOR =======================
  const speedMs = ms => ms;
  const split = s => { const [mod, port] = String(s).split('.'); return { mod, port }; };
  const normFor = (p, to) => {
    if (typeof to === 'string') { const n = p.normOf(to); if (n != null) return n; const num = parseFloat(to); if (!isNaN(num)) return clamp(num); return null; }
    if (typeof to === 'number') { if (p.steps) { const n = p.normOf(String(to)); if (n != null) return n; } return clamp(to); }
    return null;
  };
  const MIXCH = { acid: 1, drums: 2, titan: 3, lead: 4, chip: 5, bodies: 6, vcfq: 7, fold: 7, geiger: 8 };

  // Rae's rule: never any bell sounds. Bell-like settings the AI may not choose, from any source.
  const BELLISH = { Bodies: { model: ['BELL', 'GLASS', 'TUBE'] }, Chip: { wave: ['METAL'] } };
  const BANNED = (m, key, to) => !!BELLISH[m?.kind]?.[key]?.includes(String(to).toUpperCase());
  A.BELLISH = BELLISH;
  async function run(a, h = 0) {
    if (typeof Tutor !== 'undefined' && Tutor.on && !a.tutored && !A.abort) return Tutor.step(a, h, () => run({ ...a, tutored: true }, h)); // Tutor Mode explains each step
    const HU = UI.hand(h);
    if (A.abort) return;
    try {
      switch (a.do) {
        case 'say': A.think(A.stateName || 'Thinking', a.text); A.log('sys', esc(a.text)); await UI.sleep(500 * UI.speed); break;
        case 'knob': {
          const m = E.mods[a.mod], p = m?.params[a.key];
          if (!p) { A.log('err', `skipped unknown knob ${esc(a.mod)}.${esc(a.key)}`); break; }
          if (BANNED(m, a.key, a.to)) { a = { ...a, to: m.kind === 'Chip' ? 'P25' : 'MARIMBA' }; A.log('sys', `no bells: ${esc(m.name)} gets ${a.to} instead`); }
          const n = normFor(p, a.to); if (n == null) { A.log('err', `skipped ${esc(a.mod)}.${esc(a.key)}: bad value`); break; }
          if (Math.abs(n - p.n) < 0.004) break;
          const before = p.display();
          remember({ kind: 'knob', mod: a.mod, key: a.key, from: p.n, h });
          await HU.aiKnob(a.mod, a.key, n, a.ms);
          A.log('act', `<b>turn</b> ${m.name} ${p.label} ${esc(before)} → ${esc(p.display())}${a.why ? ' · ' + esc(a.why) : ''}`);
          break;
        }
        case 'patch': {
          const from = split(a.from), to = split(a.to);
          if (!E.canConnect(from, to)) { A.log('err', `skipped patch ${esc(a.from)} → ${esc(a.to)} (jacks do not match)`); break; }
          { const old = E.findCable(to.mod, to.port); remember({ kind: 'patch', to, prev: old && { from: { ...old.from }, to: { ...old.to } }, h }); }
          await HU.aiPatch(from, to);
          A.log('act', `<b>patch</b> ${E.mods[from.mod].name} ${from.port} → ${E.mods[to.mod].name} ${to.port}${a.why ? ' · ' + esc(a.why) : ''}`);
          break;
        }
        case 'unpatch': {
          const to = split(a.to), c = E.findCable(to.mod, to.port);
          if (c) { await HU.aiUnpatch(c); A.log('act', `<b>unplug</b> ${E.mods[c.from.mod].name} ${c.from.port} ✕ ${E.mods[to.mod].name} ${to.port}${a.why ? ' · ' + esc(a.why) : ''}`); }
          break;
        }
        case 'steps': case 'pattern': {
          const m = E.mods[a.mod]; if (!m?.pats) { A.log('err', `skipped pattern for ${esc(a.mod)} (not a step sequencer)`); break; }
          const pi = a.pat == null ? m.cur : patIx(a.pat); if (pi < 0) break;
          const fit = (arr, d) => { const o = (arr || []).slice(0, 16); while (o.length < 16) o.push(d); return o; };
          const notes = fit(a.notes, null), probs = fit(a.probs, 1), rats = fit(a.ratchets, 1);
          const acc = new Set(a.accents || []), sl = new Set(a.slides || []);
          const L = 'ABCDEFGH'[pi];
          if (pi !== m.cur) { await HU.aiPoint(m.ui.pbs[pi], a.mod, `edit ${m.name} pattern ${L}`); m.view = pi; m.ui.renderAll(); }
          await HU.aiCells(m.ui.cells, a.mod, `program ${m.name} pattern ${L}`, i => {
            const v = notes[i], cur = m.pats[pi][i];
            m.pats[pi][i] = { n: v == null ? cur.n : clamp(Math.round(v), -7, 14), g: v == null ? 0 : 1, a: acc.has(i) ? 1 : 0, s: sl.has(i) ? 1 : 0, p: clamp(+probs[i] || (probs[i] === 0 ? 0 : 1)), r: clamp(Math.round(+rats[i] || 1), 1, 4) };
            m.ui.renderAll();
          });
          m.view = null; m.ui.renderAll();
          A.log('act', `<b>program</b> ${m.name} ${L}: ${notes.map((v, i) => v == null ? '·' : v + (rats[i] > 1 ? '×' + rats[i] : '')).join(' ')}${a.why ? ' · ' + esc(a.why) : ''}`);
          break;
        }
        case 'copy': {
          const m = E.mods[a.mod]; if (!m?.pats) break;
          const f = patIx(a.from), t = patIx(a.to); if (f < 0 || t < 0 || f === t) break;
          await HU.aiPoint(m.ui.pbs[f], a.mod, `copy pattern ${'ABCDEFGH'[f]}`); await HU.aiPoint(m.ui.pbs[t], a.mod, `paste into ${'ABCDEFGH'[t]}`);
          m.pats[t] = m.pats[f].map(s => ({ ...s })); m.ui.renderAll();
          A.log('act', `<b>copy</b> ${m.name} pattern ${'ABCDEFGH'[f]} → ${'ABCDEFGH'[t]}`);
          break;
        }
        case 'select': {
          const m = E.mods[a.mod]; if (!m?.pats) break;
          const pi = patIx(a.pat); if (pi < 0 || (pi === m.cur && m.next == null)) break;
          if (m.songOn) { await HU.aiPoint(m.ui.songBtn, a.mod, 'leave song mode'); m.setSong(null, false); }
          await HU.aiPoint(m.ui.pbs[pi], a.mod, `${m.name}: switch to ${'ABCDEFGH'[pi]}`);
          m.queue(pi);
          A.log('act', `<b>switch</b> ${m.name} to pattern ${'ABCDEFGH'[pi]}${a.why ? ' · ' + esc(a.why) : ''}`);
          break;
        }
        case 'song': {
          const m = E.mods[a.mod]; if (!m?.pats) break;
          const chain = (a.chain || []).map(c => Array.isArray(c) ? { pat: patIx(c[0]), rep: +c[1] || 1 } : { pat: patIx(c.pat), rep: +c.rep || 1 }).filter(c => c.pat >= 0);
          await HU.aiPoint(m.ui.songBtn, a.mod, `${m.name}: write the song`);
          m.setSong(chain.length ? chain : null, a.on == null ? true : a.on);
          A.log('act', `<b>song</b> ${m.name}: ${m.song.map(e => 'ABCDEFGH'[e.pat] + '×' + e.rep).join(' → ')} ${m.songOn ? '(song mode on)' : '(off)'}${a.why ? ' · ' + esc(a.why) : ''}`);
          break;
        }
        case 'add': {
          if (a.id && E.mods[a.id]) break;
          if (!Mods.TYPES[a.type]) { A.log('err', `skipped adding unknown module type "${esc(a.type)}"`); break; }
          if (E.order.length >= 32) { A.log('err', 'the rack is full (32 modules), skipped adding'); break; }
          const id = UI.createModule(a.type, { id: a.id, model: a.model, name: a.name, stripe: a.stripe });
          const el = UI.modEls[id]; U_scroll(el);
          await UI.sleep(350 * UI.speed);
          await HU.aiPoint(el.querySelector('.nm'), id, `add ${E.mods[id].name}`);
          A.log('act', `<b>add module</b> ${esc(E.mods[id].name)} (${id})${a.why ? ' · ' + esc(a.why) : ''}`);
          break;
        }
        case 'remove': {
          const m = E.mods[a.mod]; if (!m || ['clock', 'mixer', 'monitor'].includes(a.mod)) break;
          await HU.aiPoint(UI.modEls[a.mod].querySelector('.modx') || UI.modEls[a.mod], a.mod, `remove ${m.name}`);
          UI.removeModule(a.mod); A.log('act', `<b>remove module</b> ${esc(m.name)}${a.why ? ' · ' + esc(a.why) : ''}`);
          break;
        }
        case 'drums': case 'drumbank': {
          // one instrument ("drums") or a whole bank ("drumbank": rows {BD: 'x...'}; missing rows are cleared)
          const m = E.mods.drums; if (!m) break;
          const bi = a.pat == null ? (m.view ?? m.cur) : patIx(a.pat); if (bi < 0) break;
          const rows = a.do === 'drumbank' ? Object.fromEntries(m.INST.map(ins => [ins, (a.rows || {})[ins] || ''])) : { [String(a.inst).toUpperCase()]: a.pattern };
          const changed = [];
          for (const [ins, txt] of Object.entries(rows)) { const r = m.INST.indexOf(ins); if (r < 0) continue; const pat = String(txt || '').padEnd(16, '.').slice(0, 16); for (let s = 0; s < 16; s++) { const v = pat[s] === 'X' ? 2 : (pat[s] === 'x' || pat[s] === 'o') ? 1 : 0; if (v !== m.pats[bi][r][s]) changed.push([r, s, v]); } }
          if (!changed.length) break;
          const L = 'ABCDEFGH'[bi], other = bi !== m.cur;
          if (other) { await HU.aiPoint(m.ui.pbs[bi], 'drums', `edit drum pattern ${L}`); m.view = bi; m.ui.renderGrid(); }
          await HU.aiCells(changed.map(([r, s]) => m.ui.cells[r][s]), 'drums', a.do === 'drumbank' ? `write drum pattern ${L}` : `write ${a.inst} pattern`, i => { const [r, s, v] = changed[i]; m.pats[bi][r][s] = v; m.ui.renderGrid(); }, a.fast ? 25 : 70);
          if (other) { m.view = null; m.ui.renderGrid(); }
          A.log('act', a.do === 'drumbank' ? `<b>drums</b> pattern ${L}: ${esc(Object.entries(rows).filter(([, v]) => v && /[xX]/.test(v)).map(([k]) => k).join(' '))}${a.why ? ' · ' + esc(a.why) : ''}` : `<b>drums</b> ${esc(a.inst)} ${esc(rows[String(a.inst).toUpperCase()])}${a.why ? ' · ' + esc(a.why) : ''}`);
          break;
        }
        case 'mute': {
          const m = E.mods.drums, r = m.INST.indexOf(String(a.inst).toUpperCase()); if (r < 0) break;
          if (m.mute[r] === !!a.on) break;
          await HU.aiPoint(m.ui.labels[r], 'drums', `${a.on ? 'mute' : 'unmute'} ${a.inst}`);
          m.mute[r] = !!a.on; m.ui.renderGrid();
          A.log('act', `<b>${a.on ? 'mute' : 'unmute'}</b> ${esc(a.inst)}${a.why ? ' · ' + esc(a.why) : ''}`);
          break;
        }
        case 'transport': {
          if (!!a.run === E.running) break;
          const btn = UI.modEls.clock.querySelector('button');
          await HU.aiPoint(btn, 'clock', a.run ? 'start the clock' : 'stop the clock');
          a.run ? E.start() : E.stop(); A.log('act', `<b>${a.run ? 'start' : 'stop'}</b> clock`); break;
        }
        case 'route': { // send a module's output into a free mixer channel (adds a mixer if every channel is taken)
          let port = a.port || 'OUT', srcMod = a.mod;
          for (let k = 0; k < 6; k++) { const c = E.cables.find(c => c.from.mod === srcMod && c.from.port === port && isFx(c.to.mod)); if (!c) break; srcMod = c.to.mod; port = 'OUT'; }
          const ex = E.cables.find(c => c.from.mod === srcMod && c.from.port === port && E.mods[c.to.mod]?.kind === 'Mixer');
          let mix, ch;
          if (ex) { mix = ex.to.mod; ch = +ex.to.port.slice(2); }
          else if (a.ch) { mix = 'mixer'; ch = a.ch; }
          else if (MIXCH[a.mod] && !E.findCable('mixer', 'IN' + MIXCH[a.mod])) { mix = 'mixer'; ch = MIXCH[a.mod]; }
          else { const f = freeSlot(); if (f) [mix, ch] = f; else { mix = await addMixer(h); ch = 1; } }
          if (!mix) break;
          if (!ex) await run({ do: 'patch', from: `${srcMod}.${port}`, to: `${mix}.IN${ch}`, why: a.why || 'into the mix' }, h);
          if (a.level != null) await run({ do: 'knob', mod: mix, key: 'l' + ch, to: a.level }, h);
          if (a.send != null) await run({ do: 'knob', mod: mix, key: 's' + ch, to: a.send }, h);
          break;
        }
        case 'mod': { // drop a modulation cable on a knob, then open up its depth
          const from = split(a.from), [tm, tk] = String(a.to).split('.'), m = E.mods[tm], p = m?.params[tk];
          if (!p || !E.mods[from.mod]?.outs[from.port]) { A.log('err', `skipped modulation ${esc(a.from)} → ${esc(a.to)} (no such knob or output)`); break; }
          if (!p.canMod) { A.log('err', `skipped modulation: ${esc(m.name)} ${esc(p.label)} cannot be modulated`); break; }
          const to = { mod: tm, port: '@' + tk }, d = clamp(a.depth ?? 0.25, -1, 1);
          { const old = E.findCable(tm, to.port); remember({ kind: 'patch', to, prev: old && { from: { ...old.from }, to: { ...old.to } }, h }); }
          if (!E.findCable(tm, to.port)) E.setModDepth(tm, tk, 0);
          await HU.aiPatch(from, to, `modulate ${m.name} ${p.label}`);
          await modDepthTo(HU, tm, tk, d, a.ms);
          A.log('act', `<b>modulate</b> ${esc(m.name)} ${esc(p.label)} with ${esc(E.mods[from.mod].name)} ${from.port}, depth ${d >= 0 ? '+' : ''}${Math.round(d * 100)}%${a.why ? ' · ' + esc(a.why) : ''}`);
          break;
        }
        case 'moddepth': {
          const m = E.mods[a.mod], p = m?.params[a.key]; if (!p || !E.findCable(a.mod, '@' + a.key)) break;
          const d0 = p.modDepth, d = clamp(a.depth, -1, 1); if (Math.abs(d - d0) < 0.01) break;
          await modDepthTo(HU, a.mod, a.key, d, a.ms);
          A.log('act', `<b>mod depth</b> ${esc(m.name)} ${esc(p.label)} ${Math.round(d0 * 100)}% → ${Math.round(d * 100)}%${a.why ? ' · ' + esc(a.why) : ''}`);
          break;
        }
        case 'unmod': { const c = E.findCable(a.mod, '@' + a.key); if (c) { await HU.aiUnpatch(c, `stop modulating ${E.mods[a.mod].params[a.key].label}`); A.log('act', `<b>unmodulate</b> ${esc(E.mods[a.mod].name)} ${esc(E.mods[a.mod].params[a.key].label)}${a.why ? ' · ' + esc(a.why) : ''}`); } break; }
        case 'insert': { // put an effect after a module's output, before wherever that output went
          if (!Mods.TYPES[a.type] || !E.mods[a.into]) { A.log('err', `skipped insert ${esc(a.type)} after ${esc(a.into)}`); break; }
          if (E.order.length >= 32) { A.log('err', 'the rack is full (32 modules), skipped the effect'); break; }
          let cur = { mod: a.into, port: a.port || 'OUT' };
          for (let k = 0; k < 6; k++) { const c = E.cables.find(c => c.from.mod === cur.mod && c.from.port === cur.port && isFx(c.to.mod)); if (!c) break; cur = { mod: c.to.mod, port: 'OUT' }; }
          const dest = E.cables.find(c => c.from.mod === cur.mod && c.from.port === cur.port && c.to.port[0] !== '@');
          const id = a.id && !E.mods[a.id] ? a.id : E.newId(Mods.TYPES[a.type].prefix);
          await run({ do: 'add', type: a.type, id, why: a.why || `${Mods.TYPES[a.type].label} on ${E.mods[a.into].name}` }, h);
          if (!E.mods[id]) break;
          for (const [k, v] of Object.entries(a.set || {})) if (E.mods[id].params[k]) E.mods[id].params[k].setNorm(normFor(E.mods[id].params[k], v) ?? E.mods[id].params[k].n);
          if (dest) await run({ do: 'patch', from: `${id}.OUT`, to: `${dest.to.mod}.${dest.to.port}`, why: 'the effect takes over the old path' }, h);
          await run({ do: 'patch', from: `${cur.mod}.${cur.port}`, to: `${id}.IN`, why: `${E.mods[cur.mod].name} into ${E.mods[id].name}` }, h);
          if (!dest) await run({ do: 'route', mod: id, level: 0.5, send: 0.2 }, h);
          for (const k of Object.keys(a.set || {}).slice(0, 2)) await run(K(id, k, a.set[k]), h); // show the two settings that matter most
          break;
        }
        case 'performer': {
          const m = E.mods[a.mod], l = (a.lane || 1) - 1; if (!m?.setPreset || !LFO.PRESETS[a.preset]) break;
          const nx = LFO.PRESETS[a.preset]();
          if (m.ui?.cells) await HU.aiCells(m.ui.cells[l], a.mod, `${m.name} lane ${l + 1}: ${a.preset}`, i => { m.lanes[l][i] = nx[i]; m.ui.render(); }, 45);
          m.lanes[l] = nx; m.preset[l] = a.preset; m.ui?.render?.();
          A.log('act', `<b>performer</b> ${esc(m.name)} lane ${l + 1} → ${esc(a.preset)}${a.why ? ' · ' + esc(a.why) : ''}`);
          break;
        }
        case 'build': {
          const m = E.mods[a.mod]; if (!m?.startBuild) break;
          if (m.ui?.btn) await HU.aiPoint(m.ui.btn, a.mod, `${m.name}: build over ${a.bars || m.params.bars.choice}`);
          if (m.startBuild(a.bars)) A.log('act', `<b>build</b> ${esc(m.name)} rises over ${a.bars || m.params.bars.choice}${typeof (a.bars) === 'number' ? ' bars' : ''}${a.why ? ' · ' + esc(a.why) : ''}`);
          break;
        }
        case 'fire': {
          const m = E.mods[a.mod]; if (!m?.fire) break;
          await HU.aiPoint(UI.modEls[a.mod].querySelector('.nm'), a.mod, `${m.name}: ${a.type || 'glitch'}`);
          m.fire(E.ctx.currentTime + 0.05, a.type, a.beats); A.log('act', `<b>glitch</b> ${esc(m.name)} ${esc(a.type || m.params.type.choice)}${a.why ? ' · ' + esc(a.why) : ''}`);
          break;
        }
        case 'wait': await UI.sleep((a.sec || 1) * 1000); break;
        default: A.log('err', `skipped unknown action "${esc(a.do)}"`);
      }
    } catch (e) { if (A.abort) return; console.error(e); A.log('err', 'action failed: ' + esc(e.message)); } // a stopped AI's half-done move is dropped quietly
  }
  A.run = run;
  // turn a modulation depth with the hand on the knob, so the coloured ring visibly grows or shrinks
  async function modDepthTo(HU, mod, key, d, ms) {
    const el = UI.knobs[mod + '.' + key], p = E.mods[mod].params[key];
    if (el) { const c = UI.elCenter(el.querySelector('.dial')); await HU.handTo(c.x, c.y, `${E.mods[mod].name} · ${p.label} mod depth`); el.classList.add('ai'); }
    const d0 = p.modDepth, prog = UI.clock(ms ?? 500 + Math.abs(d - d0) * 900);
    await new Promise(res => { const st = () => { const k = prog(); E.setModDepth(mod, key, d0 + (d - d0) * k); k < 1 ? requestAnimationFrame(st) : res(); }; st(); });
    E.setModDepth(mod, key, d);
    if (el) setTimeout(() => el.classList.remove('ai'), 1200);
  }
  const FXK = new Set(Object.keys(FX.TYPES)), MODK = new Set(Object.keys(LFO.TYPES));
  const isFx = id => FXK.has(E.mods[id]?.kind);
  function freeChannel() { for (let i = 1; i <= 8; i++) if (!E.findCable('mixer', 'IN' + i)) return i; return 8; }
  const patIx = v => typeof v === 'number' ? (v >= 0 && v < 8 ? v | 0 : -1) : 'ABCDEFGH'.indexOf(String(v || '').toUpperCase().trim());
  const kindIs = (id, ...k) => k.includes(E.mods[id]?.kind);
  const U_scroll = el => { if (UI.follow && el) el.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' }); };
  function freeSlot() {
    for (const id of E.order) if (kindIs(id, 'Mixer')) for (let i = 1; i <= 8; i++) if (!E.findCable(id, 'IN' + i)) return [id, i];
    return null;
  }
  async function addMixer(h = 0) {
    const port = ['IN', 'IN2', 'IN3', 'IN4'].find(p => !E.findCable('monitor', p));
    if (!port) { A.log('err', 'every mixer channel and monitor input is taken'); return null; }
    const id = E.newId('mixer');
    await run({ do: 'add', type: 'Mixer', id, why: 'every channel is taken, so add another mixer' }, h);
    await run({ do: 'patch', from: `${id}.OUT`, to: `monitor.${port}`, why: 'second mixer to the speakers' }, h);
    return id;
  }
  // Two hands, each with its own queue: lists on the same hand take turns, the two hands work at the same time.
  // With two hands on, back-to-back knob turns on different knobs are shared out so both hands turn at once.
  const handLock = [Promise.resolve(), Promise.resolve()], handBusy = [0, 0];
  // ----- undo: every knob turn and patch the AI makes is remembered, grouped by the list it came from -----
  const group = [0, 0], groupName = [null, null]; let groupN = 0;
  const history = [];
  function remember(x) { history.push({ ...x, g: group[x.h] || 0, name: groupName[x.h] || null, L: E.V, t: performance.now() }); if (history.length > 400) history.shift(); }
  // the opposite of undo: reward the AI's last move so it picks moves like it more often
  A.like = function () {
    const last = [...history].reverse().find(x => x.name);
    if (!last) { A.log('sys', 'the AI has not made a move yet to like'); return; }
    const q = A.q[last.name] || { v: 0, n: 0 }; q.v += 0.35 * (1 - q.v); q.n++; A.q[last.name] = q; saveQ(); drawSkills();
    A.log('sys', `you liked the AI's move "<b>${esc(last.name)}</b>": it will reach for it more often (value ${q.v.toFixed(2)})`);
  };
  A.undo = function () {
    const last = history[history.length - 1]; if (!last) { A.log('sys', 'nothing of the AI\'s to undo yet'); return; }
    const batch = []; while (history.length && history[history.length - 1].g === last.g) batch.push(history.pop());
    let n = 0;
    for (const x of batch) E.within(x.L, () => {
      if (x.kind === 'knob') { const p = E.mods[x.mod]?.params[x.key]; if (p) { p.setNorm(x.from); n++; } }
      else if (x.kind === 'patch') { const c = E.findCable(x.to.mod, x.to.port); if (c) E.disconnect(c); if (x.prev && E.mods[x.prev.from.mod]) E.connect(x.prev.from, x.prev.to); n++; }
    });
    const name = batch.find(x => x.name)?.name;
    if (name) { const q = A.q[name] || { v: 0, n: 0 }; q.v += 0.35 * (-1 - q.v); q.n++; A.q[name] = q; saveQ(); drawSkills(); }
    A.log('sys', `you undid the AI's last move${name ? ` "<b>${esc(name)}</b>"` : ''}: ${n} change${n === 1 ? '' : 's'} put back${name ? '. It learned you did not like that move.' : ''}`);
  };
  const isKnob = a => a && a.do === 'knob';
  function runAll(list, h = 0) {
    h = UI.twoHands ? h : 0;
    const go = handLock[h].then(async () => {
      handBusy[h]++; group[h] = ++groupN; groupName[h] = A.curMove || null; A.curMove = null;
      try {
        for (let i = 0; i < list.length; i++) {
          if (A.abort) return;
          const a = list[i], b = list[i + 1], o = 1 - h;
          if (UI.twoHands && isKnob(a) && isKnob(b) && !(a.mod === b.mod && a.key === b.key) && !handBusy[o]) {
            // the free hand takes the second knob
            const other = runAll([b], o);
            await Promise.all([run(a, h), other]); i++;
          } else await run(a, h);
        }
      } finally { handBusy[h]--; setTimeout(() => { if (!handBusy[h]) UI.handOff(h); }, 1500); }
    });
    handLock[h] = go.catch(() => {});
    return go;
  }
  // Switch the layer the hands work on (and the view) once both hands have finished what they are doing.
  // Work queued after this lands on the new layer.
  A.pendingView = null;
  const viewTarget = () => A.pendingView ?? E.L; // the layer the AI is working on (or about to)
  function toLayer(L, why) {
    if (!E.hasLayer(L) || viewTarget() === L) return Promise.resolve();
    A.pendingView = L;
    const go = Promise.all([handLock[0], handLock[1]]).then(() => {
      // the view follows the AI unless you picked a layer to watch, or both are on screen
      if (UI.pinView || UI.split) { if (E.L !== L) { E.L = L; if (UI.split) UI.showLayer(L); A.log('sys', `working on <b>${E.layerName(L)}</b>${why ? ' · ' + esc(why) : ''}`); } }
      else if (E.V !== L) { UI.showLayer(L); A.log('sys', `now on <b>${E.layerName(L)}</b>${why ? ' · ' + esc(why) : ''}`); }
      if (A.pendingView === L) A.pendingView = null;
    });
    handLock[0] = handLock[1] = go.catch(() => {});
    return go;
  }
  A.toLayer = toLayer; A.viewTarget = viewTarget;
  // Give Layer B its own character: same key and tempo, different voices, kit and space (choruses live there)
  function contrastActs(p) {
    const acts = [{ do: 'say', text: 'Giving Layer B a contrasting sound: different voice models, kit and space, so the switch to it feels like a lift.' }];
    const out = id => E.cablesFrom(id, 'OUT').length > 0;
    for (const id of E.order) {
      const m = E.mods[id];
      if (m.kind === 'Analog' && out(id)) {
        if (m.params.model.choice !== 'ACID') acts.push(K(id, 'model', pick(Mods.MODELS.filter(x => x !== 'ACID' && x !== m.params.model.choice)), 'a different voice model for this layer'));
        acts.push(K(id, 'cutoff', clamp(m.params.cutoff.n + 0.08 + rnd() * 0.08), 'a little brighter'));
      }
      if (m.kind === 'Titan' && out(id)) acts.push(K(id, 'cut', clamp(m.params.cut.n + 0.1), 'open the bass up'));
      if (m.kind === 'Bodies' && out(id)) acts.push(K(id, 'model', pick(['MARIMBA', 'STRING', 'MEMBRANE'].filter(x => x !== m.params.model.choice)), 'a different body'));
      if (m.kind === 'StepSeq' && E.cablesFrom(id, 'NOTE').length && +m.params.oct.choice >= 3 && +m.params.oct.choice <= 3 && rnd() < 0.5) acts.push(K(id, 'oct', '4', 'lift the line an octave on this layer'));
    }
    const gk = (Genres.get(p.genre)?.kits || Mods.KITS.slice(0, 4)).filter(k => k !== E.mods.drums?.params.kit.choice);
    if (E.mods.drums && routed('drums') && gk.length) acts.push(K('drums', 'kit', pick(gk), 'a different kit for this layer'), K('drums', 'drive', clamp(E.mods.drums.params.drive.n + 0.1), 'a bit more punch'));
    if (E.mods.mixer) acts.push(K('mixer', 'verb', clamp(E.mods.mixer.params.verb.n + 0.08), 'a wider space'), K('mixer', 'dtime', pick(['1/8', '3/16', '1/4']), 'a different echo'));
    if (E.order.length < 24 && rnd() < 0.5) acts.push(...newLayer(p, new Set(CORE_IDS), false));
    return acts;
  }
  // duplicate the finished Layer A into Layer B, then make B its own system
  async function buildLayerB(p) {
    A.stateName = 'Building Layer B';
    const n = Layers.duplicate(0, 1);
    A.log('sys', `duplicated the whole rack (${n} modules, ${E.layers[1].cables.length} cables) into <b>Layer B</b>, a second independent modular system`);
    A.think('Building Layer B', 'Layer B is a full copy of the rack. I am giving it a contrasting sound for the choruses; the song will crossfade between the two layers.');
    await toLayer(1, 'giving Layer B its own sound');
    await runAll(contrastActs(p));
    if (A.abort) return;
    const f = [...Theory.unfart('Layer B: no farty synths'), ...Mix.ungrate('Layer B')]; if (f.length) await runAll(f);
    if (Mix.on && !A.abort) await Mix.pass({ L: 1, why: 'balance Layer B' });
    await toLayer(0, 'back to Layer A to start the song');
  }

  // ======================= READING THE BRIEF =======================
  const GENRES = {
    acid: /acid|303|squelch|rave/i, dubstep: /dubstep|wobble|brostep|riddim|growl|massive|bass music/i, dnb: /drum ?(and|&|n|'n') ?bass|dnb|jungle|breakbeat|neuro/i,
    chip: /chip|8[- ]?bit|game ?boy|nes\b|retro game|video game/i, ambient: /ambient|drone|meditat|soundscape|pad/i, noise: /noise|harsh|power electronics|geiger|radiation|industrial/i,
    house: /house|disco|garage/i, trap: /trap|hip ?hop|boom ?bap/i, experimental: /serge|west coast|buchla|experimental|generative|modular|physical model/i, techno: /techno|warehouse|berlin|minimal/i
  };
  function parseBrief(task, persona) {
    const both = task + ' ' + persona;
    const t = (re, s = both) => re.test(s);
    const tr = {
      aggression: clamp((t(/aggress|hard|heavy|brutal|violent|angry|rage|punish|banger|hit/i) ? 0.55 : 0.15) + (t(/distort|loud|filthy|dirty|nasty|metal|punk/i) ? 0.3 : 0) + (t(/very|extremely|super|insanely/i) ? 0.1 : 0)),
      chaos: clamp((t(/noise|chaos|random|glitch|unpredict|weird|wild|mad|insane/i) ? 0.55 : 0.12) + (t(/experiment|avant|abstract/i) ? 0.25 : 0)),
      calm: t(/calm|gentle|soft|meditat|chill|dreamy|sooth|relax|quiet|subtle/i) ? 0.7 : 0.1,
      melodic: t(/melod|pretty|beautiful|harmon|jazz|lyric|romantic|emotional/i) ? 0.7 : 0.25,
      dark: t(/dark|evil|sinister|gloom|doom|menac/i) ? 0.3 : t(/bright|happy|uplift|euphor|sunny|joy/i) ? -0.3 : 0
    };
    let genre = Genres.detect(task, persona);
    if (!genre) for (const [g, re] of Object.entries(GENRES)) if (re.test(task)) { genre = g; break; }
    if (!genre) for (const [g, re] of Object.entries(GENRES)) if (re.test(persona)) { genre = g; break; }
    if (!genre) genre = t(/edm|club|dance|banger/i) ? (tr.aggression > 0.5 ? 'dubstep' : 'house') : 'techno';
    let mode = 'design';
    if (/perform|play|live|set\b|jam|show|gig|concert|improvis/i.test(task)) mode = 'perform';
    else if (!/design|make|create|build|patch|program|sound|bass|lead|pad|preset|beat|groove/i.test(task) && /more|less|darker|brighter|faster|slower|harder|softer|louder|quieter|add|remove|bring|drop|tweak|change/i.test(task)) mode = 'tweak';
    let dur = 0; const dm = task.match(/(\d+(?:\.\d+)?)\s*(hours?|hrs?|h\b|minutes?|mins?|m\b|seconds?|secs?|s\b)/i);
    if (dm) { const v = parseFloat(dm[1]), u = dm[2].toLowerCase(); dur = u[0] === 'h' ? v * 3600 : u[0] === 'm' ? v * 60 : v; }
    if (mode === 'perform' && !dur) dur = 5 * 60;
    if (mode === 'design' && dur) mode = 'perform';
    const complex = (/complex|layer|rich|dense|epic|full|big|song|arrang|orchestr|massive|huge/i.test(task) ? 2 : 0) + (mode === 'perform' ? 1 : 0) + (tr.chaos > 0.6 ? 1 : 0);
    const songWanted = /song|arrang|structure|verse|chorus/i.test(task);
    const focus = { bass: /bass/i.test(task), lead: /lead|melod/i.test(task), drums: /drum|beat|groove|rhythm/i.test(task), pad: /pad|drone/i.test(task) };
    return { genre, mode, dur: Math.min(dur, 3 * 3600), tr, focus, task, persona, complex: Math.min(3, complex), songWanted };
  }

  // ======================= PATTERN WRITERS =======================
  // ======================= COMPOSER =======================
  // Each line gets a freshly chosen rhythm, a pitch idea and a way of developing it, and is
  // checked against the lines written recently so the AI does not keep writing the same thing.
  const ri = (a, b) => a + Math.floor(rnd() * (b - a + 1));
  const wpick = list => { let r = rnd() * list.reduce((s, x) => s + x[1], 0); for (const [v, w] of list) if ((r -= w) <= 0) return v; return list[0][0]; };
  const RHYTHMS = {
    euclid(d) { const k = clamp(Math.round(4 + d * 9 + ri(-1, 1)), 3, 13), rot = ri(0, 15), o = []; for (let i = 0; i < 16; i++) o.push(Math.floor((i + 1) * k / 16) > Math.floor(i * k / 16)); return { on: o.map((_, i) => o[(i + rot) % 16]), name: `euclidean ${k}-in-16 rhythm` }; },
    additive(d) { const g = []; let s = 0; while (s < 16) { const x = Math.min(16 - s, wpick([[2, 2], [3, 3], [4, 1]])); g.push(x); s += x; } const on = Array(16).fill(false); let q = 0; for (const x of g) { on[q] = true; for (let i = 1; i < x; i++) if (rnd() < d * 0.45) on[q + i] = true; q += x; } return { on, name: `${g.join('+')} grouping` }; },
    callResponse(d) { const h = Array.from({ length: 8 }, (_, i) => i === 0 || rnd() < 0.25 + d * 0.5), a = h.map(v => rnd() < 0.22 ? !v : v); return { on: [...h, ...a], name: 'call-and-response rhythm' }; },
    driving(d) { const on = Array(16).fill(true), n = ri(1, Math.max(2, Math.round(7 - d * 5))); for (let i = 0; i < n; i++) on[ri(1, 15)] = false; return { on, name: 'driving 16ths' }; },
    syncopated(d) { const on = Array.from({ length: 16 }, (_, i) => rnd() < (i % 4 === 0 ? 0.3 : i % 2 ? 0.4 + d * 0.35 : 0.3 + d * 0.2)); on[ri(0, 3)] = true; return { on, name: 'syncopated rhythm' }; },
    dotted(d) { const on = Array(16).fill(false), gap = pick([3, 3, 5, 6]), st = ri(0, 2); for (let i = st; i < 16; i += gap) on[i] = true; for (let i = 0; i < 16; i++) if (!on[i] && rnd() < d * 0.25) on[i] = true; return { on, name: `dotted rhythm (every ${gap} steps)` }; },
    sparse(d) { const on = Array(16).fill(false), n = ri(3, 4 + Math.round(d * 3)); on[pick([0, 0, 2, 3])] = true; for (let k = 1; k < n; k++) on[ri(0, 15)] = true; return { on, name: 'sparse rhythm' }; }
  };
  const TRANSFORMS = {
    transposed: m => { const t = pick([-3, -2, -1, 1, 2, 3, 4]); return m.map(v => v + t); },
    inverted: m => m.map(v => 2 * m[0] - v),
    reversed: m => m.slice().reverse(),
    repeated: m => m.slice(),
    widened: m => m.map(v => m[0] + (v - m[0]) * 2),
    'with a new ending': m => { const o = m.slice(); o[o.length - 1] += pick([-2, -1, 1, 2, 4]); return o; }
  };
  const PITCH = {
    motif(pos, R) {
      const len = ri(2, 5); let v = ri(R.lo + 1, R.mid); const m = [v];
      for (let i = 1; i < len; i++) { v += wpick([[1, 3], [-1, 3], [2, 2], [-2, 2], [3, 1], [-3, 1], [4, 0.6], [5, 0.3], [0, 1]]); m.push(v); }
      if (m.every(x => x === m[0])) m[m.length - 1] += pick([2, -2, 3, 4]);
      const out = [], plan = []; let cur = m;
      while (out.length < pos.length) { out.push(...cur); const t = pick(Object.keys(TRANSFORMS)); plan.push(t); cur = TRANSFORMS[t](rnd() < 0.6 ? m : cur); }
      return { deg: out.slice(0, pos.length), name: `a ${len}-note motif, then ${[...new Set(plan.slice(0, 2))].join(' and ')}` };
    },
    walk(pos, R) {
      let v = ri(R.lo, R.mid), dir = rnd() < 0.5 ? 1 : -1;
      const deg = pos.map(() => { if (rnd() < 0.28) dir = -dir; v += dir * wpick([[1, 4], [2, 2], [0, 1], [3, 1], [4, 0.5], [6, 0.3]]); if (v > R.hi) { v = R.hi - 1; dir = -1; } if (v < R.lo) { v = R.lo + 1; dir = 1; } return v; });
      return { deg, name: 'a wandering line with the odd leap' };
    },
    arp(pos, R) {
      const prog = pick([[0, 5, 3, 4], [0, 3], [0, -2, -3, -4], [0, 4, 5, 3], [0, 2, 5, 4], [0, -1], [0, 5, 1, 4], [0, 3, 6, 2], [0, 6, 5, 4]]).map(x => x + R.base);
      const shape = pick(['rising', 'falling', 'up-down', 'random', 'skipping']), T = [0, 2, 4, 6];
      const deg = pos.map((p, i) => { const ch = prog[Math.floor(p / 16 * prog.length)]; const k = shape === 'rising' ? i % 4 : shape === 'falling' ? 3 - i % 4 : shape === 'up-down' ? [0, 1, 2, 3, 2, 1][i % 6] : shape === 'skipping' ? [0, 2, 1, 3][i % 4] : ri(0, 3); return ch + T[k]; });
      return { deg, name: `${shape} arpeggios over a ${prog.length}-chord loop` };
    },
    contour(pos, R) {
      const shape = pick(['arch', 'valley', 'rising', 'falling', 'zigzag']);
      const f = { arch: x => Math.sin(x * Math.PI), valley: x => 1 - Math.sin(x * Math.PI), rising: x => x, falling: x => 1 - x, zigzag: x => Math.abs((x * 3) % 2 - 1) }[shape];
      return { deg: pos.map(p => Math.round(R.lo + f(p / 15) * (R.hi - R.lo)) + ri(-1, 1)), name: `${shape}-shaped line` };
    },
    pedal(pos, R) {
      const ped = R.base + (rnd() < 0.3 ? 7 : 0); let v = R.base + ri(2, 5);
      return { deg: pos.map((p, i) => { if (i % 2 === 0 || rnd() < 0.15) return ped; v = clamp(v + pick([-2, -1, 1, 2, 3]), R.lo, R.hi); return v; }), name: 'a melody bouncing off a pedal note' };
    }
  };
  const KINDS = {
    acid: { R: { lo: -3, hi: 9, mid: 3, base: 0 }, rh: [['driving', 3], ['syncopated', 2], ['euclid', 2], ['additive', 2], ['callResponse', 1]], pi: [['motif', 3], ['walk', 2], ['pedal', 3], ['arp', 1], ['contour', 1]], slide: 0.24, root: true },
    bass: { R: { lo: -3, hi: 7, mid: 2, base: 0 }, rh: [['euclid', 2], ['additive', 2], ['syncopated', 2], ['dotted', 2], ['sparse', 1], ['callResponse', 1]], pi: [['motif', 2], ['pedal', 3], ['walk', 1], ['arp', 1]], slide: 0.25, root: true },
    half: { R: { lo: -3, hi: 5, mid: 1, base: 0 }, rh: [['sparse', 3], ['dotted', 2], ['euclid', 1], ['additive', 1]], pi: [['pedal', 3], ['motif', 2], ['walk', 1]], slide: 0.3, root: true, dens: 0.25 },
    lead: { R: { lo: -2, hi: 11, mid: 5, base: 0 }, rh: [['callResponse', 2], ['syncopated', 2], ['additive', 2], ['euclid', 1], ['dotted', 1], ['sparse', 1], ['driving', 0.5]], pi: [['motif', 3], ['walk', 2], ['arp', 2], ['contour', 2], ['pedal', 1]], slide: 0.1 },
    chip: { R: { lo: -2, hi: 12, mid: 5, base: 0 }, rh: [['driving', 2], ['euclid', 2], ['additive', 1], ['callResponse', 2], ['syncopated', 1]], pi: [['arp', 3], ['motif', 2], ['contour', 1], ['walk', 1]], slide: 0.05 },
    pad: { R: { lo: -2, hi: 9, mid: 4, base: 0 }, rh: [['sparse', 3], ['dotted', 1], ['callResponse', 1]], pi: [['arp', 2], ['motif', 1], ['contour', 1], ['walk', 1]], slide: 0.3, calm: true }
  };
  const recentLines = [];
  const same = (a, b) => a.reduce((s, v, i) => s + (v === b[i] ? 1 : 0), 0) / 16;
  function compose(kind, p) {
    const K0 = KINDS[kind] || KINDS.lead, ch = p?.tr?.chaos ?? 0.2, ag = p?.tr?.aggression ?? 0.3;
    const d = clamp((K0.dens ?? 0.5) + (rnd() - 0.5) * 0.5 + ch * 0.2 - (p?.tr?.calm ?? 0) * 0.2);
    let best = null;
    for (let tries = 0; tries < 8; tries++) {
      const rName = wpick(K0.rh), pName = wpick(K0.pi), rh = RHYTHMS[rName](d);
      if (rh.on.filter(Boolean).length < 2) rh.on[0] = rh.on[8] = true;
      const pos = rh.on.map((v, i) => v ? i : -1).filter(i => i >= 0);
      const pc = PITCH[pName](pos, K0.R);
      const notes = Array(16).fill(null);
      pos.forEach((s, i) => { let v = pc.deg[i]; while (v > K0.R.hi + 2) v -= 7; while (v < K0.R.lo - 2) v += 7; notes[s] = clamp(Math.round(v), -7, 14); });
      if (K0.root) { notes[pos[0]] = K0.R.base; pos.forEach(s => { if (s % 8 === 0 && rnd() < 0.5) notes[s] = pick([0, 0, 4, 7, -3]); }); }
      const score = Math.max(0, ...recentLines.map(r => same(r, notes)));
      if (!best || score < best.score) best = { notes, pos, score, idea: `${pc.name} on a ${rh.name}` };
      if (score < 0.6) break;
    }
    const { notes, pos } = best;
    recentLines.push(notes); if (recentLines.length > 30) recentLines.shift();
    const accStyle = K0.calm ? 'none' : pick(['beats', 'random', 'offbeats', 'peaks']);
    const accents = pos.filter((s, i) => accStyle === 'beats' ? s % 4 === 0 && rnd() < 0.8 : accStyle === 'offbeats' ? s % 4 === 2 : accStyle === 'peaks' ? notes[s] >= Math.max(...pos.map(q => notes[q])) - 1 : accStyle === 'random' ? rnd() < 0.2 + ag * 0.25 : false);
    const slides = pos.filter(s => notes[s + 1] != null && rnd() < K0.slide * (0.7 + rnd() * 0.6));
    const probs = Array(16).fill(1), ratchets = Array(16).fill(1);
    pos.slice(1).forEach(s => { if (rnd() < 0.06 + ch * 0.2) probs[s] = pick([0.5, 0.65, 0.8]); if (!K0.calm && rnd() < 0.03 + ch * 0.08) ratchets[s] = pick([2, 2, 3]); });
    const len = (kind === 'lead' || kind === 'chip') && rnd() < 0.12 + ch * 0.25 ? pick([12, 14, 15, 10, 13, 7]) : 16;
    return { notes, accents, slides, probs, ratchets, len, idea: best.idea + (len < 16 ? `, ${len} steps long against the 16-step drums` : '') };
  }
  A.compose = compose;
  const acidLine = p => compose('acid', p);
  const bassLine = (p, half) => compose(half ? 'half' : 'bass', p);
  const melody = (p, kind = 'lead') => compose(kind, p);
  const SCALE_MOOD = { dark: ['MINOR', 'PHRYG', 'HARM', 'DORIAN', 'BLUES'], bright: ['MAJOR', 'DORIAN', 'PENT', 'BLUES', 'MINOR'], odd: ['WHOLE', 'HARM', 'PHRYG', 'BLUES', 'PENT'] };
  const scaleFor = (p, mood) => pick(SCALE_MOOD[mood || (p?.tr?.chaos > 0.6 && rnd() < 0.4 ? 'odd' : p?.tr?.dark > 0 ? 'dark' : rnd() < 0.5 ? 'dark' : 'bright')]);
  const rootAny = () => pick(DSP.NOTE_NAMES);
  // one key per design so every layer agrees; the first writer picks it, in the mood it asks for
  let songKey = null;
  const keyOf = (p, mood) => songKey || (songKey = { root: rootAny(), scale: scaleFor(p, mood) });
  const keyScale = (p, mood) => keyOf(p, mood).scale, keyRoot = p => keyOf(p).root;
  const DR = {
    four: { BD: 'X...x...X...x...', CP: '....x.......x...', CH: 'x.x.x.x.x.x.x.x.', OH: '..x...x...x...x.' },
    acid: { BD: 'X...x...X...x...', CP: '....x.......x...', CH: 'xxXxxxXxxxXxxxXx', OH: '..x...x...x...x.', RS: '...x......x...x.' },
    techno: { BD: 'X...x...X...x...', RS: '..x..x....x..x..', CH: '..x...x...x...x.', OH: '..x...x...x...x.', CP: '....x.......x...', LT: '.......x.......x' },
    half: { BD: 'X.........x.....', SD: '........X.......', CH: 'x.x.x.x.x.x.x.x.', OH: '..............x.' },
    dnb: { BD: 'X.........x.....', SD: '....X.......X...', CH: 'x.xxx.x.x.xxx.x.', OH: '......x.........' },
    trap: { BD: 'X......x..x.....', SD: '........X.......', CH: 'x.x.xxx.x.x.xxxx', OH: '..............x.' },
    chip: { BD: 'x...x...x...x...', SD: '....x.......x...', CH: '..x...x...x...x.' },
    noise: { BD: 'X..x..x...x.x..x', SD: '....X..x....X...', CP: '.x.....x..x.....', CY: 'x...............', CH: 'xxxxxxxxxxxxxxxx' },
    sparse: { RS: 'x.....x.....x...', CH: '........x.......' },
    house: { BD: 'x...x...x...x...', CP: '....x.......x...', CH: 'x.x.x.x.x.x.x.x.', OH: '..X...X...X...X.' }
  };
  const roughen = (pat, ch) => !pat ? pat : pat.split('').map(c => (c === '.' && rnd() < ch * 0.15) ? 'x' : c).join('');
  function drumActs(style, p) {
    const pat = DR[style], acts = [];
    for (const ins of E.mods.drums.INST) acts.push({ do: 'drums', inst: ins, pattern: roughen(pat[ins], p.tr.chaos) || '................' });
    acts.push(...E.mods.drums.INST.map(ins => ({ do: 'mute', inst: ins, on: false })));
    return acts;
  }

  // ======================= GENRE RECIPES =======================
  const K = (mod, key, to, why, ms) => ({ do: 'knob', mod, key, to, why, ms });
  const P = (from, to, why) => ({ do: 'patch', from, to, why });
  const agg = p => p.tr.aggression, cha = p => p.tr.chaos;
  const L = {
    drums(p, style, kit) {
      return [P('clock.CLK', 'drums.CLK', 'drum machine follows the master clock'), K('drums', 'kit', kit, `${kit} kit for ${p.genre}`), ...drumActs(style, p),
        K('drums', 'drive', clamp(0.05 + agg(p) * 0.7), agg(p) > 0.5 ? 'push the drums into saturation' : null), K('drums', 'decay', clamp(0.35 + rnd() * 0.25)), { do: 'route', mod: 'drums', level: 0.72, send: 0.08 }];
    },
    acid(p) {
      const line = acidLine(p);
      return [P('clock.CLK', 'seq1.CLK'), P('seq1.NOTE', 'acid.NOTE', 'sequencer plays the acid voice'),
        K('seq1', 'scale', keyScale(p, rnd() < 0.7 ? 'dark' : null)), K('seq1', 'root', keyRoot(p)), K('seq1', 'oct', 2), K('seq1', 'len', 16), K('seq1', 'gate', clamp(0.35 + rnd() * 0.3)),
        { do: 'steps', mod: 'seq1', ...line, why: 'acid line: ' + line.idea },
        K('acid', 'model', 'ACID'), K('acid', 'wave', agg(p) > 0.75 && rnd() < 0.4 ? 'SQR' : 'SAW'), K('acid', 'cutoff', 0.3, 'start fairly closed so the sweeps have room'), K('acid', 'res', clamp(0.68 + agg(p) * 0.25)),
        K('acid', 'env', 0.6), K('acid', 'decay', 0.32), K('acid', 'accent', 0.75), K('acid', 'drive', clamp(0.2 + agg(p) * 0.7)), K('acid', 'sub', 0.0),
        { do: 'route', mod: 'acid', level: 0.72, send: 0.18 }];
    },
    titan(p, half, style) {
      const bl = bassLine(p, half);
      const growl = style !== 'reese';
      return [P('clock.CLK', 'seq2.CLK'), P('seq2.NOTE', 'titan.NOTE', 'second sequencer drives the wavetable bass'),
        K('seq2', 'scale', keyScale(p, 'dark')), K('seq2', 'root', keyRoot(p)), K('seq2', 'oct', 1), K('seq2', 'gate', 0.95), K('seq2', 'len', 16),
        { do: 'steps', mod: 'seq2', ...bl, why: (half ? 'half-time bass: ' : 'bass line: ') + bl.idea },
        K('titan', 't1', growl ? pick(['GROWL', 'YOI', 'METAL']) : 'SAW→SQR'), K('titan', 't2', growl ? 'SYNC' : 'SUPER'),
        K('titan', 'uni', growl ? 0.3 : 0.8), K('titan', 'sub', 0.6), K('titan', 'cut', growl ? 0.35 : 0.3), K('titan', 'res', clamp(0.3 + agg(p) * 0.4)),
        K('titan', 'wrate', growl ? pick(['1/8', '1/8T', '1/4']) : '1/2'), K('titan', 'wcut', growl ? 0.7 : 0.3), K('titan', 'wpos', growl ? 0.6 : 0.2),
        K('titan', 'drive', clamp(0.35 + agg(p) * 0.6), 'drive it hard for that dubstep bite'), K('titan', 'level', 0.65),
        { do: 'route', mod: 'titan', level: 0.75, send: 0.05 }];
    },
    lead(p, model, seq = 'seq2') {
      const mel = melody(p);
      return [P('clock.CLK', seq + '.CLK'), P(seq + '.NOTE', 'lead.NOTE'), K(seq, 'scale', keyScale(p)), K(seq, 'root', keyRoot(p)), K(seq, 'oct', 3), K(seq, 'gate', clamp(0.45 + rnd() * 0.45)), K(seq, 'len', mel.len),
        { do: 'steps', mod: seq, ...mel, why: 'lead melody: ' + mel.idea },
        K('lead', 'model', model), K('lead', 'cutoff', 0.55), K('lead', 'res', 0.3), K('lead', 'env', 0.35), K('lead', 'decay', 0.5), K('lead', 'detune', 0.4),
        { do: 'route', mod: 'lead', level: 0.6, send: 0.35 }];
    },
    pad(p) {
      return [P('clock.CLK', 'seq2.CLK'), P('seq2.NOTE', 'lead.NOTE'), K('seq2', 'div', pick(['1/4', '1/4', '1/8'])), K('seq2', 'scale', keyScale(p, rnd() < 0.5 ? 'bright' : null)), K('seq2', 'root', keyRoot(p)), K('seq2', 'oct', 2), K('seq2', 'gate', 1),
        (m => ({ do: 'steps', mod: 'seq2', ...m, why: 'slow pad line: ' + m.idea }))(melody(p, 'pad')),
        K('lead', 'model', 'JOVE'), K('lead', 'glide', 0.4), K('lead', 'cutoff', 0.42), K('lead', 'res', 0.2), K('lead', 'env', 0.2), K('lead', 'decay', 0.9), K('lead', 'detune', 0.7),
        { do: 'route', mod: 'lead', level: 0.6, send: 0.6 }];
    },
    chip(p) {
      const mel = melody(p, 'chip');
      return [P('clock.CLK', 'seq1.CLK'), P('seq1.NOTE', 'chip.NOTE'), K('seq1', 'scale', keyScale(p, rnd() < 0.7 ? 'bright' : null)), K('seq1', 'root', keyRoot(p)), K('seq1', 'oct', 3), K('seq1', 'gate', clamp(0.4 + rnd() * 0.4)), K('seq1', 'len', mel.len),
        { do: 'steps', mod: 'seq1', ...mel, why: 'game tune: ' + mel.idea },
        K('chip', 'wave', pick(['P25', 'P12'])), K('chip', 'arp', pick(['MAJ', 'OFF', 'OCT'])), K('chip', 'vib', 0.25), K('chip', 'crush', 4), K('chip', 'oct', 0),
        { do: 'route', mod: 'chip', level: 0.6, send: 0.15 }];
    },
    bodies(p, model, div = 2) {
      return [P('clock.CLK', 'ent.CLK'), P('ent.NOTE', 'bodies.NOTE', 'noise sequencer strikes the physical model'), K('ent', 'div', div), K('ent', 'dens', clamp(0.4 + cha(p) * 0.3)), K('ent', 'lock', clamp(0.75 - cha(p) * 0.5)),
        K('ent', 'scale', keyScale(p)), K('ent', 'root', keyRoot(p)), K('bodies', 'model', model), K('bodies', 'decay', 0.55), K('bodies', 'bright', 0.6),
        { do: 'route', mod: 'bodies', level: 0.5, send: 0.5 }];
    },
    geiger(p) {
      return [K('geiger', 'src', cha(p) > 0.5 ? 'TRINITITE' : 'U-GLASS', 'pick a hotter source'), K('geiger', 'burst', clamp(0.2 + cha(p) * 0.6)),
        P('geiger.AUDIO', 'fold.IN', 'radiation clicks into the wavefolder'), K('fold', 'fold', clamp(0.35 + agg(p) * 0.5)), P('fold.OUT', 'vcfq.IN'),
        P('slope.OUT', 'vcfq.CV', 'slow slope sweeps the resonant filter'), K('slope', 'cycle', 'ON'), K('slope', 'rise', 0.55), K('slope', 'fall', 0.6),
        K('vcfq', 'mode', 'BP'), K('vcfq', 'q', 0.7), { do: 'route', mod: 'vcfq', level: 0.45, send: 0.3 }];
    },
    geigerDrums() { return [P('geiger.TRIG', 'drums.TRIG', 'random decays fire extra drum hits'), K('drums', 'trigv', pick(['RS', 'CP', 'SD', 'LT']))]; },
    slopeTo(dest) { return [K('slope', 'cycle', 'ON'), K('slope', 'rise', 0.62), K('slope', 'fall', 0.68), K('slope', 'level', 0.75), P('slope.OUT', dest, 'slow slope modulates the filter')]; },
    // ----- the wishlist modules -----
    contourEnv(voice, trig) {
      return [{ do: 'add', type: 'Contour', id: 'contour', why: 'a function generator to shape the filter' }, P(trig, 'contour.TRIG1', 'every note fires the envelope'),
        K('contour', 'r1', 0.15), K('contour', 'f1', clamp(0.5 + rnd() * 0.12)), K('contour', 'c1', 0.85, 'snappy exponential curve'), K('contour', 'l1', 0.8), P('contour.OUT1', voice + '.CUT', 'envelope opens the filter on each note')];
    },
    swarmTo(dests, sync = '2 BAR') {
      return [{ do: 'add', type: 'Swarm', id: 'swarm', why: 'eight related LFOs for slow movement' }, K('swarm', 'sync', sync), K('swarm', 'spread', 0.25), K('swarm', 'phase', 1), K('swarm', 'depth', 0.35),
        ...dests.map((d, i) => P(`swarm.O${i * 3 + 1}`, d, 'each destination drifts at its own phase'))];
    },
    // tape strings, choir or flute from the tape-replay voice: sparse long notes, chords on top
    reelLayer(p, tape) {
      const seq = E.newId('seq', new Set(CORE_IDS)), T = tape || pick(['STRINGS', 'CHOIR', 'FLUTE', 'CELLO', 'BRASS']);
      const notes = Array(16).fill(null); [0, 8].forEach((i, k) => { notes[i] = pick([0, 2, 4, -3, 5]) + (k ? pick([0, 2, -2]) : 0); }); if (rnd() < 0.5) notes[12] = pick([4, 2, 1]);
      return [{ do: 'say', text: `Adding the tape keyboard: ${T.toLowerCase()} tapes, slow and wobbly, under the lead.` },
        { do: 'add', type: 'StepSeq', id: seq, why: 'a sequencer for the tape keyboard' }, { do: 'add', type: 'Reel', id: 'reel', why: 'a Mellotron-style tape voice' },
        P('clock.CLK', `${seq}.CLK`), P(`${seq}.NOTE`, 'reel.NOTE', 'long notes play the tapes'),
        K(seq, 'scale', keyScale(p)), K(seq, 'root', keyRoot(p)), K(seq, 'oct', 3), K(seq, 'gate', 0.95), K(seq, 'len', 16),
        { do: 'pattern', mod: seq, pat: 'A', notes, accents: [], slides: [], why: 'sparse sustained notes for the tapes' },
        K('reel', 'tape', T), K('reel', 'chord', pick(p.tr.dark > 0 ? ['MIN', '5TH', 'OCT'] : ['MAJ', 'SUS', 'OCT', '5TH'])), K('reel', 'sus', clamp(0.5 + p.tr.calm * 0.3), 'notes ring until the tape runs out'),
        K('reel', 'wow', clamp(0.2 + p.tr.chaos * 0.4), 'tape wobble'), K('reel', 'age', clamp(0.25 + rnd() * 0.3)),
        { do: 'route', mod: 'reel', level: 0.42, send: 0.45 }];
    },
    // extra percussion from the rhythm generator, played on the drum machine through its TRIG input
    primeDrums(p) {
      const bank = { house: 'TIMELINE', techno: 'EUCLID', dnb: 'BREAK', trap: 'BREAK', acid: 'NUMERIC', experimental: 'NUMERIC', noise: 'NUMERIC' }[p.genre] || pick(['EUCLID', 'TIMELINE', 'NUMERIC', 'BREAK']);
      const kit = pick([['RS', 'CH', 'LT', 'CP'], ['RS', 'OH', 'HT', 'SD'], ['CH', 'RS', 'LT', 'CY'], ['SD', 'RS', 'CH', 'HT']]);
      return [{ do: 'say', text: `Adding a rhythm generator: ${bank.toLowerCase()} rhythms on four extra drum lines, reshaped by its faders.` },
        { do: 'add', type: 'Prime', id: 'prime', why: 'four channels of extra percussion' }, P('clock.CLK', 'prime.CLK', 'follows the master clock'),
        K('prime', 'bank', bank), K('prime', 'prime', rnd(), 'pick a base rhythm'), K('prime', 'len', pick(['16', '16', '12', '32'])),
        ...kit.map((d, i) => K('prime', 'i' + (i + 1), d)), K('prime', 'f1', clamp(0.3 + rnd() * 0.3)), K('prime', 'f2', rnd()), K('prime', 'f3', clamp(0.2 + rnd() * 0.3)), K('prime', 'f4', clamp(0.1 + p.tr.chaos * 0.4)),
        K('prime', 'prob', clamp(0.95 - p.tr.chaos * 0.25), 'a little chance keeps it human'),
        P('prime.ALL', 'drums.TRIG', 'all four channels play the drum machine')];
    },
    // put a voice through a low-pass gate pinged by its own sequencer: plucked, woody notes
    lpgOn(voice) {
      const nc = E.findCable(voice, 'NOTE'), srcM = nc && E.mods[nc.from.mod], trig = srcM ? (srcM.outs.GATE ? `${srcM.id}.GATE` : srcM.outs.TRIG ? `${srcM.id}.TRIG` : null) : null;
      const ex = E.cables.find(c => c.from.mod === voice && c.from.port === 'OUT' && E.mods[c.to.mod]?.kind === 'Mixer');
      const acts = [{ do: 'say', text: `Putting ${E.mods[voice].name} through a low-pass gate, so every note plucks like a struck string or a bongo.` },
        { do: 'add', type: 'LPG', id: 'lpg', why: 'a vactrol low-pass gate' }];
      if (ex) acts.push({ do: 'unpatch', to: `${ex.to.mod}.${ex.to.port}`, why: 'the gate takes over this voice' });
      acts.push(P(`${voice}.OUT`, 'lpg.IN1', 'voice into the gate'), P(trig || 'clock.BEAT', 'lpg.TRIG1', 'each note pings the gate'),
        K('lpg', 'm1', 'COMBO'), K('lpg', 'd1', clamp(0.3 + rnd() * 0.25), 'how long the pluck rings'), K('lpg', 's1', 0.85), K('lpg', 'o1', 0.05),
        ex ? P('lpg.OUT1', `${ex.to.mod}.${ex.to.port}`, 'the gated voice back into its channel') : { do: 'route', mod: 'lpg', port: 'OUT1', level: 0.5, send: 0.3 });
      return acts;
    },
    grainsOn(src, o = {}) {
      return [{ do: 'add', type: 'Grains', id: 'grains', why: 'a granular processor to turn the voice into texture' }, P(`${src}.OUT`, 'grains.IN', 'feed the voice into the grains'),
        K('grains', 'size', o.size ?? 0.6), K('grains', 'dens', o.dens ?? 0.55), K('grains', 'pitch', o.pitch ?? '0'), K('grains', 'spray', o.spray ?? 0.3), K('grains', 'fb', o.fb ?? 0.05), K('grains', 'mix', 1, 'all wet, the dry voice has its own channel'),
        { do: 'route', mod: 'grains', level: o.level ?? 0.5, send: o.send ?? 0.4 }];
    },
    workoutDrums(inst, rate, eu, prob) {
      return [{ do: 'add', type: 'Workout', id: 'work', why: 'a clock brain for polyrhythmic extra hits' }, P('clock.CLK', 'work.CLK', 'the clock brain follows the master clock'),
        K('work', 'r8', rate), K('work', 'e8', String(eu)), K('work', 'p8', prob), P('work.O8', 'drums.TRIG', `euclidean ${eu}-hit pattern on top of the grid`), K('drums', 'trigv', inst)];
    },
    marblesLayer(p, voice) {
      return [{ do: 'add', type: 'Marbles', id: 'marbles', why: 'a random generator that stays in key' }, P('clock.CLK', 'marbles.CLK'), K('marbles', 'div', pick(['1/8', '1/16', '1/4'])),
        K('marbles', 'scale', keyScale(p)), K('marbles', 'root', keyRoot(p)), K('marbles', 'steps', 'QUANT'), K('marbles', 'deja', clamp(0.8 - p.tr.chaos * 0.5), 'how often the loop repeats itself'), K('marbles', 'spread', clamp(0.3 + p.tr.chaos * 0.5)),
        P('marbles.NOTE', voice + '.NOTE', 'random notes, quantized, looping with déjà vu'), { do: 'route', mod: voice, level: 0.45, send: 0.35 }];
    },
    shTo(dest, trig) {
      return [{ do: 'add', type: 'Toolbox', id: 'tools', why: 'sample and hold for stepped random modulation' }, P(trig, 'tools.TRIG', 'sample a new random value'), K('tools', 'slew', 0.3), P('tools.HOLD', dest, 'stepped random voltage')];
    },
    // ----- a whole band from the genre knowledge base (genres.js): groove, drums, bass, chords, lead, samples -----
    genre(p, G) {
      const gp = Genres.pick, ag = agg(p), taken = new Set(), acts = [];
      songKey = { root: rootAny(), scale: gp(G.scales) };
      const bpm = Genres.bpmOf(G, p);
      acts.push({ do: 'say', text: `${G.label} at ${bpm} BPM in ${songKey.root} ${songKey.scale.toLowerCase()}. ${G.notes.split('. ').slice(0, 2).join('. ')}.` });
      // groove: swing amount and which grid swings
      acts.push(K('clock', 'sgrid', G.sgrid || '16TH', G.sgrid === '8TH' ? 'swing the 8th notes' : null), K('clock', 'swing', G.swing || 0, G.swing ? `${Math.round(G.swing * 100)}% swing: ${G.swing > 0.35 ? 'a lazy, triplet-ish feel' : 'a little push and pull'}` : 'straight, machine-tight time'));
      // drums
      const kit = gp(G.kits || ['909']);
      acts.push(P('clock.CLK', 'drums.CLK', 'drum machine follows the master clock'), K('drums', 'kit', kit, `${kit.toLowerCase()} kit for ${G.label.toLowerCase()}`));
      const main = Genres.noCowbell({ ...(G.drums?.main || {}) }, !Samples.isKit(kit));
      for (const ins of E.mods.drums.INST) acts.push({ do: 'drums', inst: ins, pattern: roughen(main[ins], p.tr.chaos * 0.5) || '................' });
      acts.push(...E.mods.drums.INST.map(ins => ({ do: 'mute', inst: ins, on: false })));
      acts.push(K('drums', 'drive', clamp(0.05 + ag * 0.5)), K('drums', 'decay', G.drums?.decay ?? clamp(0.4 + rnd() * 0.2)), K('drums', 'tune', 0.5), { do: 'route', mod: 'drums', level: G.drums?.level === 'soft' ? 0.58 : 0.72, send: G.fam === 'edm' ? 0.06 : 0.14 });
      // a voice from a spec like "Crate:EPIANO" for a role
      const voice = (spec, role) => {
        const [type, set] = spec.split(':'), a = [];
        const want = { bass: { Crate: 'crate', Analog: 'acid', Titan: 'titan', Reel: 'reel' }, chords: { Crate: 'keys', Reel: 'reel', Analog: 'lead' }, lead: { Crate: 'horn', Analog: 'lead', Chip: 'chip', Bodies: 'bodies', Reel: 'reel2' } }[role][type] || type.toLowerCase();
        let id = want; if (taken.has(id)) id = E.newId(id, new Set([...taken, ...CORE_IDS])); taken.add(id);
        if (type === 'Crate') {
          const fam = Samples.INFO[set]?.family;
          a.push({ do: 'add', type: 'Sampler', id, model: set, why: `a sampler for the ${role}` }, K(id, 'bank', set, `load the ${(Samples.INFO[set]?.label || set).toLowerCase()}`), K(id, 'hold', 'GATE'),
            K(id, 'att', fam === 'wind' || fam === 'vocal' || fam === 'strings' ? 0.12 : 0.02), K(id, 'rel', role === 'bass' ? (set === '808' ? 0.3 : 0.18) : fam === 'keys' ? 0.4 : 0.3),
            K(id, 'tone', role === 'bass' ? 0.62 : G.bright < 0.42 ? 0.7 : 0.82, role === 'bass' ? 'keep the bass round' : null));
          if (G.extras?.includes('dust') && role !== 'bass') a.push(K(id, 'dust', 0.3 + rnd() * 0.2, 'dusty, sampled-off-vinyl grit'));
          if (set === '808') a.push(K(id, 'drive', clamp(0.15 + ag * 0.4), 'a little growl on the 808'));
        } else if (type === 'Analog') {
          if (!E.mods[id]) a.push({ do: 'add', type: 'Analog', id, model: set });
          a.push(K(id, 'model', set), K(id, 'wave', role === 'bass' ? 'SAW' : gp(['SAW', 'PULSE'])), K(id, 'cutoff', role === 'bass' ? 0.36 : 0.5), K(id, 'res', role === 'bass' ? 0.3 : 0.25), K(id, 'env', 0.45), K(id, 'decay', role === 'bass' ? 0.35 : 0.5), K(id, 'drive', clamp(0.15 + ag * 0.4)));
        } else if (type === 'Titan') {
          const growl = set !== 'reese';
          a.push(K(id, 't1', growl ? pick(['GROWL', 'YOI', 'METAL']) : 'SAW→SQR'), K(id, 't2', growl ? 'SYNC' : 'SUPER'), K(id, 'uni', growl ? 0.3 : 0.8), K(id, 'sub', G.extras?.includes('sub') ? 0.75 : 0.55, 'a clean sub under the movement'),
            K(id, 'cut', growl ? 0.38 : 0.3), K(id, 'res', clamp(0.3 + ag * 0.35)), K(id, 'wrate', growl ? pick(['1/8', '1/8T', '1/4']) : '1/2'), K(id, 'wcut', growl ? 0.75 : 0.3), K(id, 'wpos', growl ? 0.65 : 0.2),
            K(id, 'drive', clamp(0.35 + ag * 0.55), growl ? 'drive it hard for the growl' : 'warm saturation on the reese'), K(id, 'level', 0.65));
        } else if (type === 'Reel') { a.push({ do: 'add', type: 'Reel', id }, K(id, 'tape', set), K(id, 'sus', 0.8, 'let the tape notes ring'), K(id, 'chord', 'OFF'), K(id, 'wow', 0.15), K(id, 'oct', role === 'bass' ? '-1' : '0')); }
        else if (type === 'Chip') a.push(K(id, 'wave', pick(['P25', 'TRI'])), K(id, 'arp', 'OFF'), K(id, 'oct', 0), K(id, 'crush', 4));
        else if (type === 'Bodies') a.push(K(id, 'model', set || bodyModel()), K(id, 'decay', 0.5), K(id, 'bright', 0.45));
        return { id, acts: a, type, set };
      };
      // bass: Sequencer B plays it, written in the genre's bass style
      const bv = voice(gp(G.bass.v), 'bass');
      const bl = Theory.bassLine('verse', G.half, G) || bassLine(p, G.half);
      acts.push({ do: 'say', text: `Bass: ${bv.set ? (Samples.INFO[bv.set]?.label || bv.set) : bv.type} playing ${bl.idea}.` }, ...bv.acts,
        P('clock.CLK', 'seq2.CLK'), P('seq2.NOTE', `${bv.id}.NOTE`, 'Sequencer B plays the bass'),
        K('seq2', 'scale', keyScale(p)), K('seq2', 'root', keyRoot(p)), K('seq2', 'oct', bv.type === 'Titan' ? 1 : G.bass.oct ?? 2), K('seq2', 'gate', bl.long ? 0.95 : 0.6), K('seq2', 'len', 16),
        { do: 'steps', mod: 'seq2', ...bl, why: 'bass: ' + bl.idea }, { do: 'route', mod: bv.id, level: 0.68, send: 0.04 });
      // chords: the Comper voices the song's chords on the genre's comping rhythm
      if (G.chords && rnd() < (G.chords.p ?? 1)) {
        const cv = voice(gp(G.chords.v), 'chords'), st = gp(G.chords.style), vc = gp(G.chords.voicing);
        acts.push({ do: 'say', text: `Chords: a Comper playing ${vc.toLowerCase()} voicings in a ${st.toLowerCase()} rhythm on ${cv.set ? (Samples.INFO[cv.set]?.label || cv.set + ' tapes').toLowerCase() : cv.type}.` },
          { do: 'add', type: 'Comper', id: 'comp', why: 'a chord player that voices the chords' }, ...cv.acts,
          P('clock.CLK', 'comp.CLK'), P('comp.NOTE', `${cv.id}.NOTE`, 'the chord player plays the chord instrument'),
          K('comp', 'style', st, `${st.toLowerCase()} rhythm for ${G.label.toLowerCase()}`), K('comp', 'voicing', vc, `${vc.toLowerCase()} voicings`), K('comp', 'root', keyRoot(p)), K('comp', 'scale', keyScale(p)),
          K('comp', 'oct', String(G.chords.oct ?? 3)), K('comp', 'bass', G.chords.bass || 'OFF'), K('comp', 'gate', st === 'PAD' ? 1 : st === 'SKANK' || st === 'OFFBEAT' ? 0.35 : 0.7), K('comp', 'human', G.fam === 'edm' ? 0.1 : 0.45),
          { do: 'route', mod: cv.id, level: 0.5, send: G.fam === 'edm' ? 0.25 : 0.3 });
        if (G.chords.fuzz) acts.push({ do: 'insert', into: cv.id, type: 'Heat', set: { model: 'FUZZ', drive: 0.55, tone: -0.1, mix: 0.9 }, why: 'distorted power chords' });
      }
      // lead: Sequencer A plays the melody in the genre's melodic style
      if (G.lead && rnd() < (G.lead.p ?? 1)) {
        const lv = voice(gp(G.lead.v), 'lead'), ml = Theory.melodyLine('verse', { G, chaos: p.tr.chaos });
        acts.push({ do: 'say', text: `Lead: ${lv.set ? (Samples.INFO[lv.set]?.label || lv.set) : lv.type}, ${ml.idea}.` }, ...lv.acts,
          P('clock.CLK', 'seq1.CLK'), P('seq1.NOTE', `${lv.id}.NOTE`, 'Sequencer A plays the lead'),
          K('seq1', 'scale', keyScale(p)), K('seq1', 'root', keyRoot(p)), K('seq1', 'oct', G.lead.oct ?? 3), K('seq1', 'gate', clamp(0.5 + rnd() * 0.35)), K('seq1', 'len', 16),
          { do: 'steps', mod: 'seq1', ...ml, why: 'lead: ' + ml.idea }, { do: 'route', mod: lv.id, level: 0.52, send: 0.3 });
      }
      // samples and extras
      const ex = G.extras || [];
      if (ex.includes('break') && rnd() < 0.85) {
        const bk = gp(G.breaks || ['BREAK_FUNK']);
        acts.push({ do: 'say', text: `Chopping a breakbeat (${Samples.INFO[bk].label}) under the drums: one slice per 16th, sped to the tempo.` }, { do: 'add', type: 'Sampler', id: 'brk', model: bk, why: 'a sampler for the breakbeat' },
          K('brk', 'bank', bk), K('brk', 'chop', 'STEP'), K('brk', 'fit', 'TEMPO'), K('brk', 'hold', 'GATE'), K('brk', 'att', 0.001), K('brk', 'rel', 0.05), K('brk', 'tone', 0.8),
          P('clock.CLK', 'brk.TRIG', 'the clock plays the break slice by slice'), { do: 'route', mod: 'brk', level: 0.42, send: 0.05 });
      }
      if (ex.includes('vinyl') || ex.includes('rain')) {
        const tx = ex.includes('rain') && rnd() < 0.5 ? 'RAIN' : 'VINYL';
        acts.push({ do: 'add', type: 'Sampler', id: 'tex', model: tx, why: tx === 'RAIN' ? 'rain behind the music' : 'vinyl crackle' }, K('tex', 'bank', tx), K('tex', 'hold', 'GATE'), K('tex', 'att', 0.2), K('tex', 'rel', 0.6), K('tex', 'tone', 0.6),
          P('clock.BAR', 'tex.TRIG', 'restart the texture every bar'), { do: 'route', mod: 'tex', level: 0.2, send: 0.02 });
      }
      if (ex.includes('fx')) acts.push({ do: 'add', type: 'Sampler', id: 'fxs', model: 'FX', why: 'risers before the drops, impacts on them' }, K('fxs', 'bank', 'FX'), K('fxs', 'hold', 'FULL'), K('fxs', 'tone', 0.7), { do: 'route', mod: 'fxs', level: 0.3, send: 0.4 });
      if (ex.includes('perc') && rnd() < 0.7) acts.push(...L.primeDrums(p));
      if (ex.includes('hatrolls')) acts.push({ do: 'say', text: 'Trap hats: rolls in 32nds on top of the 16ths.' }, ...L.workoutDrums('CH', '1/32', pick([5, 7, 9]), 0.45));
      if (ex.includes('pump')) acts.push({ do: 'insert', into: 'mixer', type: 'Pump', set: { glue: 0.3, ott: 0.15, pump: 0.45 + rnd() * 0.15, gain: 0.5 }, why: 'sidechain pump: the mix ducks under every kick' });
      if (ex.includes('dub')) { const tgt = E.mods.keys || acts.some(a => a.id === 'keys') ? 'keys' : null; if (tgt) acts.push({ do: 'insert', into: tgt, type: 'Echoes', set: { mode: 'TAPE', time: 0.5, fb: 0.55, mix: 0.32 }, why: 'dub tape echo on the skank' }); }
      return { bpm, exact: true, acts };
    },
    // ----- effects: 1-3 inserts chosen by the personality and genre, never the same few every time -----
    fxPack(p, max) {
      const ag = agg(p), ch = cha(p), calm = p.tr.calm, g = p.genre, acts = [], room = 30 - E.order.length;
      if (room < 2) return acts;
      const bass = ['titan', 'acid'].find(routed) || E.order.find(id => E.mods[id].kind === 'Titan' && routed(id));
      const leads = E.order.filter(id => routed(id) && ['Analog', 'Chip', 'Bodies', 'Reel', 'LPG', 'Sampler'].includes(E.mods[id].kind) && id !== bass && !(E.mods[id].kind === 'Sampler' && ['bass', 'breaks', 'texture', 'fx'].includes(Samples.INFO[E.mods[id].params.bank.choice]?.family)));
      const lead = leads.length ? pick(leads) : null, drums = routed('drums') ? 'drums' : null;
      const has = t => E.order.some(id => E.mods[id].kind === t && E.cables.some(c => c.from.mod === id));
      const I = (into, type, set, why, port) => ({ do: 'insert', into, port, type, set, why });
      const ideas = [];
      if (bass) {
        ideas.push([0.3 + ag * 1.3, () => I(bass, 'Heat', { model: ag > 0.6 ? pick(['FUZZ', 'FOLD', 'RECTIFY', 'TUBE', 'PARABOLA']) : pick(['TUBE', 'TAPE']), drive: 0.25 + ag * 0.4, tone: -0.2, mix: 0.55 + ag * 0.35 }, 'grit on the bass')]);
        ideas.push([g === 'dubstep' ? 1.8 : 0.25 + ch * 0.4, () => I(bass, 'Vowel', { vowel: rnd() * 0.5, res: 0.5, drive: 0.4, mix: 0.75 }, 'a talking formant on the bass')]);
        ideas.push([0.2 + ag * 0.3, () => I(bass, 'Twin', { mode: 'LP', poles: '24dB', cutoff: 0.42 + rnd() * 0.1, res: 0.15 + ag * 0.15, spread: 0.12, motion: 0.1, env: 0.45 + ag * 0.3, mix: 1 }, 'an envelope-opened filter on the bass')]);
        ideas.push([ch * 0.7, () => I(bass, 'Bode', { shift: 0.52 + rnd() * 0.04, fb: 0.15, mix: 0.3 }, 'a slight frequency shift for an inharmonic edge')]);
      }
      if (lead) {
        ideas.push([0.7 + calm * 0.3, () => I(lead, 'Echoes', { mode: pick(['TAPE', 'PINGPONG', 'MULTI', 'CLOUD']), time: pick([0.43, 0.5, 0.57]), fb: 0.35 + ch * 0.25, mix: 0.3 }, 'echoes around the lead')]);
        ideas.push([0.3 + calm * 0.9 + (g === 'ambient' ? 1 : 0), () => I(lead, 'Halls', { type: pick(['HALL', 'PLATE', 'CATHEDRAL', 'BLOOM', 'SPRING']), decay: 0.45 + calm * 0.3, shim: g === 'ambient' ? 0.35 : 0, mix: 0.35 }, 'a room of its own')]);
        ideas.push([0.5, () => I(lead, 'Ensemble', { mode: pick(['CHORUS', 'ENSEMBLE', 'DIMENSION', 'FLANGER', 'TZF']), depth: 0.6, mix: 0.5 }, 'width and movement')]);
        ideas.push([0.45 + ch * 0.25, () => I(lead, 'Twin', { mode: pick(['LP', 'BAND', 'BP']), cutoff: 0.5 + rnd() * 0.12, res: 0.2 + ch * 0.2, spread: 0.3 + rnd() * 0.3, motion: 0.2 + calm * 0.3, env: 0.3, mix: 1 }, 'a stereo filter that breathes left and right')]);
        ideas.push([0.35 + ch * 0.3, () => I(lead, 'Phaser', { stages: pick([4, 8, 12]), rate: 0.25, regen: 0.5, mix: 0.6 }, 'a sweeping phaser')]);
        ideas.push([0.25 + calm * 0.4 + ch * 0.3, () => I(lead, 'Prism', { i1: pick([12, 7, 5, -12]), i2: pick([7, 19, -5, 12]), fb: 0.3 + ch * 0.3, mix: 0.3 }, 'cascading harmonies')]);
        ideas.push([g === 'ambient' || calm > 0.5 ? 0.9 : 0.25, () => I(lead, 'Cassette', { age: 0.35 + rnd() * 0.3, wow: 0.35, mix: 0.8 }, 'a worn tape colour')]);
        ideas.push([g === 'ambient' ? 0.9 : 0.25, () => I(lead, 'Sympathy', { chord: pick(['MIN', 'SUS4', 'MIN9', 'FIFTH']), decay: 0.5, mix: 0.35 }, 'sympathetic strings ringing in key')]);
        ideas.push([ch * 1.1 + (g === 'experimental' || g === 'noise' ? 0.8 : 0), () => I(lead, 'Horizon', { gravity: 0.85 + ch * 0.18, chaos: ch * 0.6, mix: 0.3 }, 'a chaotic feedback cloud')]);
        ideas.push([ch * 0.6 + ag * 0.3, () => I(lead, 'Bode', { mode: pick(['SINGLE', 'STEREO']), shift: 0.5 + (rnd() - 0.5) * 0.12, fb: 0.5, mix: 0.35 }, 'a barber-pole frequency spiral')]);
      }
      if (drums) {
        ideas.push([0.25 + ag * 0.9, () => I(drums, 'Pump', { glue: 0.4 + ag * 0.3, ott: ag * 0.5, gain: 0.55 }, 'glue and punch on the drums')]);
        ideas.push([0.2 + ag * 0.6 + ch * 0.4, () => I(drums, 'Stutter', { type: 'MIX', chance: 0.15 + ch * 0.25 }, 'glitch fills at the ends of bars')]);
        ideas.push([g === 'noise' || g === 'chip' ? 0.8 : 0.15, () => I(drums, 'Heat', { model: 'CRUSH', bits: 0.5, rate: 0.55, mix: 0.5 }, 'crushed drums')]);
      }
      // bus effects on the whole mix
      if (E.mods.mixer && E.findCable('monitor', 'IN')?.from.mod === 'mixer') {
        ideas.push([ag > 0.55 ? 0.7 + ag * 0.6 : 0.1, () => I('mixer', 'Pump', { glue: 0.35, ott: 0.25 + ag * 0.3, pump: /edm|dubstep|house|techno|trance|big room/i.test(p.task + ' ' + g) || ag > 0.7 ? 0.45 : 0, gain: 0.5 }, 'squash and sidechain pump on the whole mix')]);
      }
      { const fw = Genres.get(g)?.fxw; if (fw) ideas.forEach(x => { try { const t = x[1]().type; x[0] *= fw[t] ?? 1; } catch (e) { /* keep */ } }); }
      const n = Math.min(max || (1 + (rnd() < 0.6) + (ag + ch > 1.2 ? 1 : 0)), Math.floor(room / 1));
      const chosen = [];
      for (let k = 0; k < n && ideas.length; k++) { const f = wpick(ideas.map((x, i) => [i, x[0]])); const a = ideas[f][1](); ideas.splice(f, 1); if (!has(a.type) || rnd() < 0.3) chosen.push(a); }
      if (!chosen.length) return acts;
      acts.push({ do: 'say', text: `Adding effects: ${chosen.map(a => Mods.TYPES[a.type].label.split(' (')[0] + ' on ' + E.mods[a.into].name).join(', ')}.` }, ...chosen);
      return acts;
    },
    // ----- modulation: an LFO module wired straight onto 2-4 knobs (synths, filters, effects) -----
    modPack(p, o = {}) {
      const tg = modTargets(); if (tg.length < 1 || E.order.length > 29) return [];
      const ch = cha(p), ag = agg(p), drama = o.drama ?? (ag + ch > 1.1 ? 1 : p.tr.calm > 0.5 ? 0 : rnd() < 0.5 ? 1 : 0);
      const kind = o.kind || wpick([['Orbit', 2], ['Performer', /dubstep|edm|house|techno|trance/i.test(p.genre + p.task) ? 1.6 : 0.6], ['Attractor', 0.3 + ch * 1.2]]);
      const id = E.newId(LFO.TYPES[kind].prefix), acts = [{ do: 'say', text: `Adding ${LFO.TYPES[kind].label.split(' (')[0]} to move ${Math.min(tg.length, 4)} knobs ${drama ? 'dramatically' : 'subtly'}.` }, { do: 'add', type: kind, id, why: drama ? 'big, obvious movement' : 'slow, subtle movement' }];
      let outs;
      if (kind === 'Orbit') {
        acts.push(K(id, 'r1', drama ? pick([0.6, 0.73, 0.8]) : pick([0.07, 0.14, 0.2])), K(id, 's1', rnd() * 0.75), K(id, 'r2', drama ? pick([0.47, 0.67]) : pick([0.14, 0.2, 0.27])), K(id, 's2', rnd()));
        if (ch > 0.5) acts.push(K(id, 'xmod', ch * 0.5, 'the LFOs push each other around'));
        outs = ['O1', 'O2', 'O3', 'O4'];
      } else if (kind === 'Performer') {
        acts.push({ do: 'performer', mod: id, lane: 1, preset: pick(drama ? ['WOB8', 'WOB3', 'DUB', 'TALK', 'STUTTER'] : ['SWEEP', 'RISE', 'STAIRS']) }, { do: 'performer', mod: id, lane: 2, preset: pick(['PUMP', 'GATE', 'SWEEP', 'TALK']) });
        outs = ['P1', 'P2', 'P1', 'P2'];
      } else { acts.push(K(id, 'model', pick(LFO.MODELS.slice(0, 3))), K(id, 'speed', drama ? 0.6 : 0.3), K(id, 'chaos', 0.4 + ch * 0.5)); outs = ['X', 'Y', 'Z', 'X']; }
      const picks = tg.sort(() => rnd() - 0.5).slice(0, drama ? 4 : 3);
      picks.forEach(([m, k, sub, dra], i) => acts.push({ do: 'mod', from: `${id}.${outs[i % outs.length]}`, to: `${m}.${k}`, depth: safeDepth(m, k, drama ? dra : sub), why: drama ? 'big movement' : 'gentle drift' }));
      return acts;
    },
    // a macro knob that sweeps several knobs together, plus a riser for the builds
    macroPack() {
      const tg = modTargets(); if (tg.length < 2 || E.order.length > 29 || E.order.some(id => E.mods[id].kind === 'Macros')) return [];
      const id = E.newId('macro'), all = tg.sort(() => rnd() - 0.5), picks = all.slice(0, 3), riseT = all[3] || null;
      return [{ do: 'say', text: 'Adding a macro: one knob that opens several things at once, and a riser for the builds.' }, { do: 'add', type: 'Macros', id, why: 'one knob for big gestures' },
        ...picks.map(([m, k, , dra]) => ({ do: 'mod', from: `${id}.M1`, to: `${m}.${k}`, depth: safeDepth(m, k, Math.abs(dra)), why: 'macro 1 opens it' })),
        ...(riseT ? [{ do: 'mod', from: `${id}.RISE`, to: `${riseT[0]}.${riseT[1]}`, depth: safeDepth(riseT[0], riseT[1], Math.abs(riseT[3])), why: 'the riser opens it during builds' }] : [])];
    }
  };

  const RECIPES = {
    acid: p => ({ bpm: 128 + Math.round(rnd() * 8), kit: '909', acts: [...L.drums(p, 'acid', '909'), ...L.acid(p), ...L.workoutDrums('RS', '1/16', 5, 0.85), ...(cha(p) > 0.45 || agg(p) > 0.6 ? L.geiger(p) : []), ...(p.mode === 'perform' ? L.slopeTo('acid.CUT') : [])] }),
    dubstep: p => ({ bpm: 140, acts: [...L.drums(p, 'half', '909'), ...L.titan(p, true), ...L.workoutDrums('CH', '1/16T', 7, 0.6), ...(cha(p) > 0.45 ? [...L.geiger(p), ...L.geigerDrums()] : [])] }),
    dnb: p => ({ bpm: 172, acts: [...L.drums(p, 'dnb', '909'), ...L.titan(p, false, 'reese'), ...(rnd() < 0.35 ? L.bodies(p, 'STRING', 4) : L.reelLayer(p, pick(['STRINGS', 'CHOIR', 'CELLO']))), ...L.swarmTo(['titan.CUT'], '1 BAR'), ...(rnd() < 0.6 ? L.primeDrums({ ...p, genre: 'dnb' }) : [])] }),
    techno: p => ({ bpm: 130, acts: [...L.drums(p, 'techno', '909'), ...L.acid(p), K('acid', 'model', 'LADDER'), K('acid', 'decay', 0.2), ...L.bodies(p, 'MEMBRANE', 1), ...L.slopeTo('acid.CUT'), ...L.workoutDrums(pick(['RS', 'LT', 'CP']), '1/16', 3, 0.9), ...L.grainsOn('bodies', { size: 0.45, dens: 0.4, level: 0.35, send: 0.5 })] }),
    house: p => ({ bpm: 124, acts: [...L.drums(p, 'house', '909'), ...(rnd() < 0.5 ? L.primeDrums(p) : []), ...L.lead(p, 'JOVE'), ...L.contourEnv('lead', 'seq2.GATE'), K('lead', 'cutoff', 0.35, 'closed down so the envelope plucks it'), ...L.acid(p), K('acid', 'model', 'LADDER'), K('acid', 'res', 0.3)] }),
    chip: p => ({ bpm: 150, acts: [...L.drums(p, 'chip', 'LOFI'), ...L.chip(p), ...L.lead(p, 'SEM'), K('seq2', 'oct', 1)] }),
    ambient: p => ({ bpm: 84, acts: [...L.drums(p, 'sparse', '808'), K('mixer', 'l2', 0.35), ...L.pad(p), ...L.bodies(p, pick(['MARIMBA', 'STRING']), 4), ...L.slopeTo('lead.CUT'), ...L.grainsOn('bodies', { size: 0.85, dens: 0.6, pitch: '+12', spray: 0.6, fb: 0.35, level: 0.55, send: 0.7 }), ...(rnd() < 0.6 ? L.reelLayer(p, pick(['CHOIR', 'STRINGS', 'FLUTE'])) : []), ...L.swarmTo(['grains.POS', 'grains.DENS'], '4 BAR'), K('mixer', 'verb', 0.75), K('mixer', 'dfb', 0.6)] }),
    noise: p => ({ bpm: 145, acts: [...L.drums(p, 'noise', 'DIRT'), ...L.geiger(p), ...L.geigerDrums(), ...L.titan(p, true), K('titan', 't1', 'METAL'), P('ent.CV', 'titan.CUT', 'random voltages tear at the bass filter'), P('clock.CLK', 'ent.CLK'), ...L.shTo('fold.FOLD', 'geiger.TRIG'), ...L.grainsOn('titan', { size: 0.3, dens: 0.8, pitch: '-12', spray: 0.8, fb: 0.5, level: 0.4, send: 0.2 })] }),
    trap: p => ({ bpm: 140, acts: [...L.drums(p, 'trap', '808'), K('drums', 'decay', 0.9), K('drums', 'tune', 0.35), ...L.lead(p, 'PROPHECY'), ...L.workoutDrums('CH', '1/32', 11, 0.55)] }),
    experimental: p => ({ bpm: 100, acts: [...L.bodies(p, 'STRING', 1), ...L.geiger(p), P('geiger.TRIG', 'slope.TRIG'), K('slope', 'cycle', 'OFF'), P('ent.CV', 'fold.FOLD', 'noise CV animates the folds'), ...L.chip(p), K('chip', 'wave', 'METAL'), K('mixer', 'l5', 0.35), ...L.marblesLayer(p, 'lead'), K('lead', 'model', 'PROPHECY'), ...L.contourEnv('lead', 'marbles.T1'), K('contour', 'cy2', 'ON'), P('contour.OUT2', 'vcfq.CV', 'cycling function sweeps the filter'), ...L.shTo('lead.FM', 'marbles.T3')] })
  };

  // ======================= SOUND-SHAPING MOVES (the learning part) =======================
  // heard: patched into a mixer, directly or through a chain of effects
  const reachesMix = (id, d = 0) => d < 7 && E.cables.some(c => c.from.mod === id && c.to.port[0] !== '@' && (E.mods[c.to.mod]?.kind === 'Mixer' || (isFx(c.to.mod) && reachesMix(c.to.mod, d + 1))));
  const routed = id => reachesMix(id);
  const CUTKEY = { Analog: 'cutoff', Titan: 'cut', VCFQ: 'freq' };
  const voiceCut = () => E.order.filter(id => CUTKEY[E.mods[id].kind] && routed(id)).map(id => [id, CUTKEY[E.mods[id].kind]]);
  const activeSeqs = () => E.order.filter(id => kindIs(id, 'StepSeq') && E.cablesFrom(id, 'NOTE').length);
  const VOICE_KINDS = ['Analog', 'Titan', 'Chip', 'Bodies', 'VCFQ', 'Reel'];
  const CORE_IDS = ['seq1', 'seq2', 'ent', 'drums', 'acid', 'lead', 'geiger', 'titan', 'chip', 'bodies', 'slope', 'fold', 'vcfq', 'contour', 'swarm', 'work', 'grains', 'marbles', 'tools', 'reel', 'lpg', 'crate', 'keys', 'comp', 'horn', 'brk', 'tex', 'tex2', 'fxs', 'reel2'];

  // ----- pattern variations and songs -----
  // B: a development of A, C: a stripped-back version, D: a fill. Each picks one of several ways to do it.
  function variation(notes, kind) {
    let n = notes.slice(); const rats = Array(16).fill(1), probs = Array(16).fill(1);
    const hits = n.map((v, i) => v == null ? -1 : i).filter(i => i >= 0), last = hits.length ? n[hits[hits.length - 1]] : 0;
    let why;
    if (kind === 'B') {
      const how = pick(['answer', 'invert', 'shift', 'octave', 'rotate', 'swap', 'echo']);
      if (how === 'answer') { let v = n.slice(0, 8).filter(x => x != null).pop() ?? 0; for (let i = 8; i < 16; i++) if (n[i] != null) { v += pick([-2, -1, 1, 2, 3, -3]); n[i] = v; } why = 'same question, new answer in the second half'; }
      else if (how === 'invert') { const piv = n[hits[0]] ?? 0; n = n.map(v => v == null ? null : 2 * piv - v); why = 'the line turned upside down'; }
      else if (how === 'shift') { const t = pick([-3, -2, 2, 3, 4]); n = n.map((v, i) => v == null || i < 8 ? v : v + t); why = `second half moved ${t > 0 ? 'up' : 'down'} ${Math.abs(t)} steps`; }
      else if (how === 'octave') { n = n.map(v => v != null && rnd() < 0.3 ? v + (v > 4 ? -7 : 7) : v); why = 'some notes jump octaves'; }
      else if (how === 'rotate') { const r = pick([1, 2, 3, 5, 6]); n = notes.map((_, i) => notes[(i + 16 - r) % 16]); why = `the whole line pushed ${r} step${r > 1 ? 's' : ''} later`; }
      else if (how === 'echo') { const k = pick([3, 4, 6]); n = n.map((v, i) => v != null ? v : (i >= k && notes[i - k] != null && rnd() < 0.5 ? notes[i - k] + pick([0, 0, 2, -2]) : null)); why = `ghostly echoes ${k} steps behind`; }
      else { for (let k = 0, c = ri(2, 4); k < c; k++) { const j = ri(0, 15); n[j] = rnd() < 0.3 ? null : (n[j] ?? last ?? 0) + pick([-2, -1, 1, 2, 3]); } why = 'a few notes swapped'; }
      if (rnd() < 0.4) rats[pick([7, 15])] = 2;
    }
    if (kind === 'C') {
      const mode = pick(['beats', 'alternate', 'skeleton', 'long']);
      n = n.map((v, i) => v == null ? null : mode === 'beats' ? (i % 4 === 0 ? v : null) : mode === 'alternate' ? (hits.indexOf(i) % 2 === 0 ? v : null) : mode === 'skeleton' ? ([hits[0], hits.find(h => h >= 8), hits[hits.length - 1]].includes(i) ? v : null) : (i < 8 ? v : null));
      if (n.filter(v => v != null).length < 2) { n = notes.map((v, i) => hits.indexOf(i) % 2 === 0 ? v : null); why = null; }
      if (!n.some(v => v != null)) n[0] = notes[hits[0]] ?? 0;
      why = why === null ? 'every other note' : { beats: 'only the notes on the beat', alternate: 'every other note', skeleton: 'just the bones of the line', long: 'first half only, then space' }[mode];
    }
    if (kind === 'D') {
      const how = pick(['run up', 'run down', 'roll', 'stutter']);
      for (let i = 12; i < 16; i++) {
        if (how === 'run up') n[i] = (last ?? 0) + (i - 11);
        else if (how === 'run down') n[i] = (last ?? 0) - (i - 11);
        else if (how === 'roll') { if (n[i] == null) n[i] = pick([0, 2, 4, 7]); rats[i] = pick([2, 3, 4]); }
        else { n[i] = n[12] ?? last ?? 0; rats[i] = i % 2 ? 3 : 1; }
      }
      for (let i = 0; i < 12; i++) if (n[i] != null && rnd() < 0.3) probs[i] = 0.6;
      why = how;
    }
    n = n.map(v => v == null ? null : clamp(Math.round(v), -7, 14));
    return { notes: n, ratchets: rats, probs, why };
  }
  // Write patterns B (variation), C (sparse) and D (fill) from A, then chain them into a song
  function songify(seq, base, songOn, why) {
    const acts = [];
    for (const k of ['B', 'C', 'D']) { const v = variation(base.notes, k); acts.push({ do: 'pattern', mod: seq, pat: k, ...v, accents: base.accents || [], slides: k === 'C' ? [] : base.slides || [], why: { B: 'variation', C: 'breakdown', D: 'fill' }[k] + ': ' + v.why }); }
    acts.push({ do: 'song', mod: seq, chain: pick([[['A', 4], ['B', 4], ['A', 4], ['C', 2], ['D', 1], ['B', 4], ['C', 2]], [['C', 2], ['A', 4], ['B', 2], ['A', 2], ['D', 1], ['B', 4]], [['A', 2], ['B', 2], ['A', 2], ['D', 1], ['C', 4], ['B', 4], ['D', 1]], [['A', 8], ['C', 4], ['B', 8], ['D', 1]], [['B', 4], ['A', 4], ['C', 2], ['A', 2], ['B', 2], ['D', 1]]]), on: songOn, why: songOn ? 'arrange the patterns into a song' : 'song written, I will switch patterns by hand during the set' });
    return acts;
  }
  const LAYERS = {
    acid: ['Analog:LADDER', 'Reel', 'Chip', 'Analog:SCREAM', 'Titan', 'Bodies'], dubstep: ['Chip', 'Analog:SCREAM', 'Reel', 'Titan', 'Analog:ODYSSEY'], dnb: ['Analog:JOVE', 'Reel', 'Chip', 'Titan', 'Bodies'],
    ambient: ['Reel', 'Analog:JOVE', 'Bodies', 'Analog:SEM', 'Reel'], chip: ['Chip', 'Analog:ODYSSEY', 'Reel'], noise: ['Analog:SCREAM', 'Titan', 'Reel', 'Bodies', 'Chip'],
    experimental: ['Bodies', 'Chip', 'Analog:PROPHECY', 'Reel', 'Titan'], default: ['Analog:PROPHECY', 'Bodies', 'Chip', 'Analog:SEM', 'Reel', 'Titan', 'Analog:ODYSSEY']
  };
  // ----- variety: remember which instruments the AI has leaned on lately and favour the ones it has not -----
  const NEWER = { Reel: 1.8, Titan: 1.3, Chip: 1.1, Bodies: 0.45 }; // Bodies is picked less on purpose (and never as a bell)
  let usage = {}; try { usage = JSON.parse(localStorage.getItem('patchmind.usage') || '{}'); } catch (e) { /* no storage */ }
  const fresh = list => wpick(list.map(k => [k, (NEWER[k.split(':')[0]] ?? 1) / (1 + (usage[k] || 0) * 0.9)]));
  const used = k => { for (const x in usage) usage[x] *= 0.93; usage[k] = (usage[k] || 0) + 1; try { localStorage.setItem('patchmind.usage', JSON.stringify(usage)); } catch (e) { /* no storage */ } };
  A.usage = () => usage;
  // physical-model bodies: Rae never wants bell sounds, so the bell-like bodies (BELL, GLASS, TUBE) are banned outright
  const bodyModel = () => wpick([['MARIMBA', 3], ['STRING', 3], ['MEMBRANE', 2]]);
  // A brand-new layer: add a sequencer and a voice module, patch them, write patterns and a song
  function newLayer(p, reserved, songOn) {
    const Gn = Genres.get(p.genre), gpal = Gn && !Gn.legacy ? [...[].concat(Gn.lead?.v || []), ...[].concat(Gn.chords?.v || [])].filter(v => !/^Titan|^Reel/.test(v)) : null;
    const spec = fresh(gpal?.length ? gpal : LAYERS[p.genre] || LAYERS.default); let [type, model] = spec.split(':'); used(spec);
    if (type === 'Crate') type = 'Sampler';
    const seq = E.newId('seq', reserved); reserved.add(seq);
    const vid = E.newId(type === 'Analog' ? 'voice' : Mods.TYPES[type].prefix, reserved); reserved.add(vid);
    const ref = E.mods.seq1, low = type === 'Titan' || (type === 'Analog' && rnd() < 0.5) || (type === 'Sampler' && Samples.INFO[model]?.family === 'bass');
    const base = type === 'Chip' ? melody(p, 'chip') : low ? bassLine(p, p.genre === 'dubstep') : melody(p);
    const acts = [{ do: 'say', text: `Adding a new layer: a sequencer driving a ${type === 'Analog' ? model + ' analog voice' : type === 'Sampler' ? 'Crate sampler with ' + (Samples.INFO[model]?.label || model).toLowerCase() : Mods.TYPES[type].label}.` },
      { do: 'add', type: 'StepSeq', id: seq, why: 'a new sequencer for the new layer' },
      { do: 'add', type, id: vid, model, why: 'a new voice for more depth' },
      P('clock.CLK', `${seq}.CLK`), P(`${seq}.NOTE`, `${vid}.NOTE`),
      K(seq, 'scale', keyScale(p)), K(seq, 'root', keyRoot(p)), K(seq, 'oct', low ? 1 : 3), K(seq, 'gate', low ? 0.8 : 0.5),
      K(seq, 'len', low ? 16 : base.len), { do: 'pattern', mod: seq, pat: 'A', ...base, why: 'new layer: ' + base.idea },
      ...(A.songForm ? [] : songify(seq, base, songOn)),
      { do: 'route', mod: vid, level: low ? 0.55 : 0.45, send: low ? 0.1 : 0.4 }];
    if (type === 'Analog') acts.push(K(vid, 'cutoff', 0.45), K(vid, 'res', 0.35 + p.tr.aggression * 0.3));
    if (type === 'Bodies') acts.push(K(vid, 'model', bodyModel()));
    if (type === 'Chip') acts.push(K(vid, 'arp', pick(['MAJ', 'MIN', 'OCT', 'OFF'])));
    if (type === 'Reel') acts.push(K(vid, 'tape', pick(['STRINGS', 'CHOIR', 'FLUTE', 'CELLO'])), K(vid, 'sus', 0.55, 'let the tape notes ring'), K(seq, 'gate', 0.95));
    if (type === 'Sampler') acts.push(K(vid, 'bank', model, 'load the ' + (Samples.INFO[model]?.label || model).toLowerCase()), K(vid, 'rel', 0.5));
    return acts;
  }
  A.newLayer = newLayer;
  const nudge = (mod, key, d, why, ms) => { const p = E.mods[mod].params[key]; return K(mod, key, clamp(p.n + d), why, ms); };
  const drumsOn = () => routed('drums');
  const canAdd = () => E.order.length <= 26 && performance.now() - (A.lastAdd || 0) > 40000;
  const freeIn = s => { const [m, port] = s.split('.'); return E.mods[m] && !E.findCable(m, port); };
  // voices whose filter has a free CUT input, with the gate that plays them
  const envTargets = () => ['acid', 'lead', 'titan'].filter(v => routed(v) && freeIn(v + '.CUT')).map(v => {
    const c = E.cables.find(c => c.to.mod === v && c.to.port === 'NOTE'), src = c && E.mods[c.from.mod];
    return [v, src?.kind === 'StepSeq' ? `${c.from.mod}.GATE` : src?.kind === 'Marbles' ? `${c.from.mod}.T2` : 'clock.BEAT'];
  });
  const freeCV = () => ['acid.CUT', 'lead.CUT', 'titan.CUT', 'vcfq.CV', 'fold.FOLD', 'grains.POS', 'grains.DENS'].filter(d => freeIn(d) && (routed(d.split('.')[0]) || d.startsWith('fold') && E.findCable('fold', 'IN') || d.startsWith('grains')));
  // trigger streams a logic gate can combine with the beat, and moving voltages a comparator can watch
  const logicSources = () => [...activeSeqs().map(id => id + '.GATE'), ...['work.O3', 'marbles.T1', 'prime.T1', 'ent.TRIG'].filter(x => E.mods[x.split('.')[0]] && E.cablesFrom(x.split('.')[0]).length)];
  const CV_OUT = { Orbit: 'O1', Attractor: 'X', Swarm: 'O1', Follower: 'ENV', Contour: 'OUT1' };
  const cvSources = () => E.order.filter(id => CV_OUT[E.mods[id].kind]).map(id => `${id}.${CV_OUT[E.mods[id].kind]}`);
  const cmpTargets = () => [...(E.mods.grains ? ['grains.TRIG'] : []), ...(drumsOn() && freeIn('drums.TRIG') ? ['drums.TRIG'] : []), ...(E.mods.slope && freeIn('slope.TRIG') ? ['slope.TRIG'] : [])];
  const grainSources = () => ['bodies', 'lead', 'acid', 'chip', 'titan'].filter(routed);
  const idleVoices = () => ['bodies', 'chip', 'lead', 'reel'].filter(v => E.mods[v] && !E.findCable(v, 'NOTE'));
  // voices played by a sequencer and heard through a mixer channel: candidates for the low-pass gate
  const lpgTargets = () => ['reel', 'bodies', 'chip', 'lead'].filter(v => E.mods[v] && E.findCable(v, 'NOTE') && E.cables.some(c => c.from.mod === v && c.from.port === 'OUT' && E.mods[c.to.mod]?.kind === 'Mixer'));
  // knobs worth modulating on parts you can hear: [module, knob, subtle depth, dramatic depth]
  const MODT = {
    Analog: [['cutoff', 0.12, 0.3], ['res', 0.1, 0.25], ['detune', 0.15, 0.4], ['drive', 0.12, 0.35]],
    Titan: [['p1', 0.18, 0.45], ['p2', 0.18, 0.45], ['cut', 0.12, 0.3], ['drive', 0.12, 0.3], ['uni', 0.15, 0.4]],
    Chip: [['vib', 0.15, 0.4]], Reel: [['tone', 0.12, 0.25], ['wow', 0.2, 0.4]], VCFQ: [['freq', 0.12, 0.3]], Grains: [['pos', 0.2, 0.5], ['size', 0.15, 0.35]],
    Heat: [['drive', 0.15, 0.4], ['bias', 0.2, 0.5], ['rate', -0.1, -0.35]], Bode: [['shift', 0.015, 0.06], ['fb', 0.15, 0.35]], Vowel: [['vowel', 0.25, 0.6], ['shift', 0.15, 0.35]],
    Echoes: [['fb', 0.12, 0.3], ['time', 0.02, 0.06], ['tone', 0.15, 0.3]], Halls: [['mix', 0.12, 0.3], ['shim', 0.15, 0.35], ['tone', 0.12, 0.25]],
    Ensemble: [['depth', 0.2, 0.4], ['rate', 0.15, 0.35]], Phaser: [['center', 0.2, 0.45], ['regen', 0.15, 0.3]], Prism: [['fb', 0.15, 0.3], ['mix', 0.15, 0.35]],
    Horizon: [['size', 0.1, 0.3], ['chaos', 0.15, 0.4]], Cassette: [['age', 0.15, 0.3], ['wow', 0.2, 0.4]], Sympathy: [['bright', 0.2, 0.4], ['mix', 0.15, 0.3]],
    Pump: [['pump', 0.2, 0.45]], Twin: [['cutoff', 0.1, 0.25], ['spread', 0.15, 0.35], ['motion', 0.15, 0.35]], Mixer: []
  };
  const heardBy = id => routed(id) || E.cables.some(c => c.from.mod === id && E.mods[c.to.mod]?.kind === 'Monitor');
  function modTargets() {
    const out = [];
    for (const id of E.order) { const m = E.mods[id], list = MODT[m.kind]; if (!list || !heardBy(id)) continue; for (const [k, a, b] of list) if (m.params[k]?.canMod && !E.findCable(id, '@' + k)) out.push([id, k, a, b]); }
    return out;
  }
  // keep a modulated brightness knob from swinging into shrill territory
  const BRIGHT = new Set(['cutoff', 'cut', 'freq', 'tone', 'center']);
  function safeDepth(m, k, d) {
    const p = E.mods[m]?.params[k]; if (!p) return d;
    if (BRIGHT.has(k) && d > 0) d = Math.min(d, Math.max(0.05, 0.8 - p.n));
    if (d > 0 && p.n + d > 1) d = Math.max(0.05, 1 - p.n); if (d < 0 && p.n + d < 0) d = -Math.max(0.05, p.n);
    return Math.round(d * 100) / 100;
  }
  // words in a request that name an effect
  function fxWords(t) {
    const map = [[/reverb|hall|room|space|cathedral/i, 'Halls'], [/delay|echo/i, 'Echoes'], [/chorus|ensemble|flang|dimension/i, 'Ensemble'], [/phaser|phasing/i, 'Phaser'], [/distort|drive|fuzz|crush|bitcrush|saturat|fold/i, 'Heat'], [/frequency shift|bode|ring mod|barber/i, 'Bode'], [/resonat|sympathetic/i, 'Sympathy'], [/vowel|formant|talk|yoi/i, 'Vowel'], [/compress|sidechain|pump|ott|squash|glue/i, 'Pump'], [/stutter|glitch|beat repeat|tape stop|reverse/i, 'Stutter'], [/harmoni|pitch shift|shimmer|octaver/i, 'Prism'], [/cassette|lo-?fi|tape wobble|vhs/i, 'Cassette'], [/feedback network|chaos verb|black hole|drone/i, 'Horizon'], [/stereo filter|filter sweep|wah|twin filter/i, 'Twin']];
    const want = map.filter(([re]) => re.test(t)).map(([, ty]) => ty); if (!want.length) return [];
    const bass = ['titan', 'acid'].find(routed), lead = E.order.find(id => routed(id) && ['Analog', 'Chip', 'Bodies', 'Reel'].includes(E.mods[id].kind) && id !== bass) || bass;
    const onDrums = { Pump: 1, Stutter: 1 }, onBass = { Heat: 1, Vowel: 1 };
    return want.map(ty => ({ do: 'insert', type: ty, into: onDrums[ty] && routed('drums') ? 'drums' : onBass[ty] && bass ? bass : lead || 'drums', why: 'you asked for it' })).filter(a => E.mods[a.into]);
  }
  A.fxWords = fxWords; A.modTargets = modTargets;
  const modCables = () => E.cables.filter(c => c.to.port[0] === '@');
  const modsIn = kind => E.order.filter(id => E.mods[id].kind === kind && E.cablesFrom(id).length);
  const modsInFx = kind => E.order.filter(id => E.mods[id].kind === kind && routed(id));
  // change something about the modulation already patched: rates, shapes, performer curves, chaos
  function modVariation(drama) {
    const o = modsIn('Orbit'), pf = modsIn('Performer'), at = modsIn('Attractor'), mc = modCables();
    const opts = [];
    if (o.length) { const id = pick(o), i = 1 + Math.floor(rnd() * 2); opts.push(() => [K(id, 'r' + i, drama ? pick([0.6, 0.67, 0.73, 0.8, 0.87]) : pick([0.07, 0.14, 0.2, 0.27]), drama ? 'LFO ' + i + ' snaps to a rhythmic rate' : 'LFO ' + i + ' slows to a long drift', 1200)], () => [K(id, 's' + i, rnd(), 'morph the LFO shape', 2500)]); if (drama) opts.push(() => [K(id, 'xmod', 0.3 + rnd() * 0.5, 'let the LFOs bend each other', 1500)]); }
    if (pf.length) { const id = pick(pf); opts.push(() => [{ do: 'performer', mod: id, lane: 1 + (rnd() < 0.4), preset: pick(drama ? ['WOB8', 'WOB16', 'WOB3', 'DUB', 'TALK', 'STUTTER', 'GATE'] : ['SWEEP', 'STAIRS', 'RISE', 'PUMP']), why: drama ? 'a new rhythm for the movement' : 'a calmer curve' }]); }
    if (at.length) { const id = pick(at); opts.push(() => [K(id, 'chaos', drama ? 0.75 + rnd() * 0.25 : 0.25 + rnd() * 0.25, drama ? 'more chaos' : 'calmer orbit', 2000)], () => [K(id, 'speed', drama ? 0.6 : 0.25, null, 1500)]); }
    if (mc.length) { const c = pick(mc), k = c.to.port.slice(1), d = E.mods[c.to.mod].params[k].modDepth; opts.push(() => [{ do: 'moddepth', mod: c.to.mod, key: k, depth: safeDepth(c.to.mod, k, drama ? Math.sign(d || 1) * Math.min(0.6, Math.abs(d) * 1.8 + 0.1) : d * 0.5), why: drama ? 'a big swing for this part' : 'just a hint of movement' }]); }
    return opts.length ? pick(opts)() : [];
  }
  A.modVariation = modVariation;
  // the song engine calls this as each section starts: builds ride the macro riser, choruses get big movement, verses small
  A.onSection = function (s) {
    const L = s.layer || 0;
    E.within(L, () => {
      if (s.role === 'build' || s.role === 'pre') for (const id of E.order) if (E.mods[id].kind === 'Macros' && E.cablesFrom(id, 'RISE').length) { E.mods[id].startBuild(s.bars); A.log('act', `<b>build</b> ${esc(E.mods[id].name)} rises over ${s.bars} bars into the next section`); }
      if (!A.busy || L !== viewTarget()) return;
      const drama = ['chorus', 'drop', 'post'].includes(s.role) ? true : ['verse', 'intro', 'outro', 'break', 'bridge'].includes(s.role) ? false : null;
      if (drama == null) return;
      const acts = modVariation(drama); if (acts.length) { A.fixQueue.push({ do: 'say', text: drama ? `${s.name}: bigger movement.` : `${s.name}: movement pulled back to a hint.` }, ...acts); A.lastModVar = performance.now(); }
    });
  };
  const MOVES = {
    'open filter': { fx: { energy: 0.5, bright: 1 }, ok: () => voiceCut().length, make: () => { const [m, k] = pick(voiceCut()); return [nudge(m, k, 0.08 + rnd() * 0.2, 'wants more brightness', 1500 + rnd() * 2500)]; } },
    'close filter': { fx: { energy: -0.4, bright: -1 }, ok: () => voiceCut().some(([m, k]) => E.mods[m].params[k].n > 0.27), make: () => { const [m, k] = pick(voiceCut().filter(([m, k]) => E.mods[m].params[k].n > 0.27)); const p = E.mods[m].params[k]; return [K(m, k, Math.max(0.24, p.n - (0.08 + rnd() * 0.2)), 'too bright, pulling it back', 1500 + rnd() * 2000)]; } },
    'more resonance': { fx: { energy: 0.3, bright: 0.3, chaos: 0.3 }, ok: () => routed('acid') || routed('titan'), make: () => routed('acid') ? [nudge('acid', 'res', 0.12, 'more squelch')] : [nudge('titan', 'res', 0.12)] },
    'less resonance': { fx: { energy: -0.2, bright: -0.2 }, ok: () => routed('acid') || routed('titan'), make: () => routed('acid') ? [nudge('acid', 'res', -0.12)] : [nudge('titan', 'res', -0.12)] },
    'more drive': { fx: { energy: 0.6, bright: 0.4, chaos: 0.2 }, ok: () => routed('acid') || routed('titan') || drumsOn(), make: () => { const o = [routed('acid') && ['acid', 'drive'], routed('titan') && ['titan', 'drive'], drumsOn() && ['drums', 'drive']].filter(Boolean); const [m, k] = pick(o); return [nudge(m, k, 0.15, 'needs more bite')]; } },
    'less drive': { fx: { energy: -0.5, bright: -0.3 }, ok: () => routed('acid') || routed('titan') || drumsOn(), make: () => { const o = [routed('acid') && ['acid', 'drive'], routed('titan') && ['titan', 'drive'], drumsOn() && ['drums', 'drive']].filter(Boolean); const [m, k] = pick(o); return [nudge(m, k, -0.15)]; } },
    'thicken drums': { fx: { energy: 0.6, motion: 1 }, ok: drumsOn, make: () => { const ins = pick(['CH', 'RS', 'CP', 'OH', 'SD', 'LT', 'HT']); const r = E.mods.drums.INST.indexOf(ins); const cur = E.mods.drums.pat[r].map(v => v === 2 ? 'X' : v ? 'x' : '.').join(''); return [{ do: 'drums', inst: ins, pattern: cur.split('').map(c => c === '.' && rnd() < 0.25 ? 'x' : c).join(''), why: 'busier groove' }]; } },
    'thin drums': { fx: { energy: -0.5, motion: -1 }, ok: drumsOn, make: () => { const ins = pick(['CH', 'RS', 'CP', 'OH', 'SD', 'LT', 'HT']); const r = E.mods.drums.INST.indexOf(ins); const cur = E.mods.drums.pat[r].map(v => v === 2 ? 'X' : v ? 'x' : '.').join(''); return [{ do: 'drums', inst: ins, pattern: cur.split('').map(c => c !== '.' && rnd() < 0.4 ? '.' : c).join(''), why: 'leave some space' }]; } },
    'drop kick': { fx: { energy: -0.9 }, ok: () => drumsOn() && !E.mods.drums.mute[0], make: () => [{ do: 'mute', inst: 'BD', on: true, why: 'pull the kick for tension' }] },
    'bring kick': { fx: { energy: 0.9 }, ok: () => drumsOn() && E.mods.drums.mute[0], make: () => [{ do: 'mute', inst: 'BD', on: false, why: 'kick back in' }] },
    'mutate sequence': { fx: { novelty: 1, chaos: 0.3 }, ok: () => activeSeqs().length, make: () => {
      const id = pick(activeSeqs()), m = E.mods[id], r = rnd();
      const acc = [], sl = []; m.steps.forEach((s, i) => { if (s.a) acc.push(i); if (s.s) sl.push(i); });
      if (r < 0.2) { // a brand-new idea in the same register
        const c = compose(m.params.oct.choice <= 2 ? (rnd() < 0.5 ? 'bass' : 'acid') : rnd() < 0.3 ? 'chip' : 'lead', A.prof);
        return [{ do: 'steps', mod: id, ...c, why: 'fresh idea: ' + c.idea }];
      }
      const cur = m.steps.map(s => s.g ? s.n : null);
      if (r < 0.55) { const v = variation(cur, 'B'); return [{ do: 'steps', mod: id, notes: v.notes, ratchets: v.ratchets, accents: acc, slides: sl, why: 'develop the line: ' + v.why }]; }
      const notes = cur.slice(), k = 1 + Math.floor(rnd() * 3);
      for (let i = 0; i < k; i++) { const j = Math.floor(rnd() * 16), nb = notes[j - 1] ?? notes[j + 1] ?? 0; notes[j] = rnd() < 0.25 ? null : nb + pick([-3, -2, -1, 1, 2, 3, 4, 5]); }
      if (rnd() < 0.5) acc.push(Math.floor(rnd() * 16)); if (rnd() < 0.4) sl.push(Math.floor(rnd() * 16));
      return [{ do: 'steps', mod: id, notes: notes.map(v => v == null ? null : clamp(v, -7, 14)), accents: acc, slides: sl, why: 'nudge a few notes' }];
    } },
    'transpose': { fx: { novelty: 0.8 }, ok: () => activeSeqs().length, make: () => { const id = pick(activeSeqs()); return [K(id, 'trans', pick([-2, 0, 0, 2, 3, -3, 4]).toString(), 'harmonic shift')]; } },
    'wobble rate': { fx: { energy: 0.4, novelty: 0.9, motion: 0.6 }, ok: () => routed('titan'), make: () => [K('titan', 'wrate', pick(['1/4', '1/8', '1/8T', '1/16', '1/16T', '1/4T']), 'switch the wobble rhythm', 300)] },
    'table morph': { fx: { novelty: 0.8, bright: 0.3 }, ok: () => routed('titan'), make: () => [K('titan', rnd() < 0.5 ? 'p1' : 'p2', rnd(), 'morph the wavetable', 1800), ...(rnd() < 0.3 ? [K('titan', 't1', pick(DSP.TABLES.map(t => t.name)))] : [])] },
    'more folds': { fx: { bright: 0.8, chaos: 0.7, energy: 0.3 }, ok: () => E.findCable('fold', 'IN') && routed('vcfq'), make: () => [nudge('fold', 'fold', 0.15, 'harsher harmonics')] },
    'fewer folds': { fx: { bright: -0.6, chaos: -0.4 }, ok: () => E.findCable('fold', 'IN') && routed('vcfq'), make: () => [nudge('fold', 'fold', -0.15)] },
    'radiation spike': { fx: { chaos: 1, motion: 0.6, energy: 0.3 }, ok: () => E.cablesFrom('geiger').length, make: () => [nudge('geiger', 'level', 0.25, 'turn the exposure up'), K('geiger', 'burst', clamp(0.4 + rnd() * 0.6))] },
    'radiation calm': { fx: { chaos: -0.8, motion: -0.4 }, ok: () => E.cablesFrom('geiger').length, make: () => [nudge('geiger', 'level', -0.25)] },
    'patch modulation': { fx: { novelty: 1, motion: 0.5 }, ok: () => voiceCut().length && !E.cablesFrom('slope').some(c => c.to.port === 'CUT' || c.to.port === 'CV'), make: () => {
      const dests = [routed('acid') && 'acid.CUT', routed('titan') && 'titan.CUT', routed('lead') && 'lead.CUT', routed('vcfq') && 'vcfq.CV'].filter(Boolean);
      return [K('slope', 'cycle', 'ON'), K('slope', 'rise', 0.4 + rnd() * 0.3), K('slope', 'fall', 0.4 + rnd() * 0.3), K('slope', 'level', 0.5 + rnd() * 0.4), P('slope.OUT', pick(dests), 'add slow movement')];
    } },
    'remove modulation': { fx: { novelty: 0.4, motion: -0.4 }, ok: () => E.cablesFrom('slope', 'OUT').length, make: () => [{ do: 'unpatch', to: (c => `${c.to.mod}.${c.to.port}`)(pick(E.cablesFrom('slope', 'OUT'))), why: 'let it settle' }] },
    'layer in': { fx: { energy: 0.6, novelty: 1 }, ok: () => ['chip', 'bodies', 'lead', 'titan', 'vcfq'].some(m => !routed(m)), make: () => {
      const options = [!routed('bodies') && rnd() < 0.4 && 'bodies', !routed('chip') && 'chip', !routed('vcfq') && 'vcfq', !routed('lead') && !E.cablesFrom('seq2').length && 'lead'].filter(Boolean);
      if (!options.length) options.push(...['chip', 'vcfq'].filter(x => !routed(x)));
      const m = pick(options); if (!m) return [];
      if (m === 'bodies') return L.bodies(A.prof, bodyModel(), pick([1, 2, 4]));
      if (m === 'chip') return [P('clock.CLK', 'ent.CLK'), P('ent.NOTE', 'chip.NOTE', 'noise sequencer plays the chip voice'), K('chip', 'arp', pick(['MAJ', 'MIN', 'OCT'])), { do: 'route', mod: 'chip', level: 0.45, send: 0.3 }];
      if (m === 'vcfq') return L.geiger(A.prof);
      return L.lead(A.prof, pick(['JOVE', 'PROPHECY', 'ODYSSEY']));
    } },
    'layer out': { fx: { energy: -0.6, novelty: 0.5 }, ok: () => E.order.filter(id => kindIs(id, ...VOICE_KINDS) && routed(id)).length > 2, make: () => { const m = pick(E.order.filter(id => kindIs(id, ...VOICE_KINDS) && routed(id) && id !== 'acid' && id !== 'titan')); if (!m) return []; const c = E.cables.find(c => c.from.mod === m && E.mods[c.to.mod]?.kind === 'Mixer'); return [{ do: 'unpatch', to: `${c.to.mod}.${c.to.port}`, why: 'thin the arrangement' }]; } },
    'switch pattern': { fx: { novelty: 0.9, energy: 0.1 }, ok: () => activeSeqs().some(id => !E.mods[id].songOn && [0, 1, 2, 3, 4, 5, 6, 7].filter(i => E.mods[id].hasNotes(i)).length > 1), make: () => {
      const id = pick(activeSeqs().filter(id => !E.mods[id].songOn && [0, 1, 2, 3, 4, 5, 6, 7].filter(i => E.mods[id].hasNotes(i)).length > 1)), m = E.mods[id];
      const opts = [0, 1, 2, 3, 4, 5, 6, 7].filter(i => i !== m.cur && m.hasNotes(i));
      return [{ do: 'select', mod: id, pat: pick(opts), why: 'move the arrangement on' }];
    } },
    'write variation': { fx: { novelty: 1.1, chaos: 0.2 }, ok: () => activeSeqs().some(id => !E.mods[id].songOn), make: () => {
      const id = pick(activeSeqs().filter(id => !E.mods[id].songOn)), m = E.mods[id];
      const slot = [0, 1, 2, 3, 4, 5, 6, 7].find(i => i !== m.cur && !m.hasNotes(i)) ?? [0, 1, 2, 3, 4, 5, 6, 7].filter(i => i !== m.cur)[Math.floor(rnd() * 7)];
      const v = variation(m.pats[m.cur].map(s => s.g ? s.n : null), pick(['B', 'B', 'D']));
      return [{ do: 'pattern', mod: id, pat: slot, ...v, accents: m.pats[m.cur].map((s, i) => s.a ? i : -1).filter(i => i >= 0), why: 'new variation: ' + v.why }, { do: 'select', mod: id, pat: slot }];
    } },
    'add layer': { fx: { energy: 0.6, novelty: 1.3 }, ok: () => E.order.length <= 26 && performance.now() - (A.lastAdd || 0) > 45000, make: () => { A.lastAdd = performance.now(); return newLayer(A.prof, new Set(CORE_IDS), rnd() < 0.5); } },
    // ----- the wishlist modules: add them when the music needs them, then play them -----
    'add envelope': { fx: { energy: 0.5, novelty: 1.2, motion: 0.5 }, ok: () => canAdd() && !E.mods.contour && envTargets().length, make: () => { A.lastAdd = performance.now(); const [v, trig] = pick(envTargets()); return [{ do: 'say', text: `Adding a function generator so every note plucks the ${E.mods[v].name} filter.` }, ...L.contourEnv(v, trig)]; } },
    'add lfo swarm': { fx: { novelty: 1.2, motion: 0.9 }, ok: () => canAdd() && !E.mods.swarm && freeCV().length, make: () => { A.lastAdd = performance.now(); const d = freeCV().sort(() => rnd() - 0.5).slice(0, 3); return [{ do: 'say', text: 'Adding eight related LFOs so several knobs drift at once.' }, ...L.swarmTo(d, pick(['1 BAR', '2 BAR', '4 BAR']))]; } },
    'add grains': { fx: { novelty: 1.3, energy: 0.2, chaos: 0.3 }, ok: () => canAdd() && !E.mods.grains && grainSources().length, make: () => { A.lastAdd = performance.now(); const v = pick(grainSources()); return [{ do: 'say', text: `Sending ${E.mods[v].name} into a granular processor for texture.` }, ...L.grainsOn(v, { pitch: pick(['0', '+12', '-12', '+7']), size: 0.4 + rnd() * 0.4, fb: A.prof.tr.chaos * 0.4 })]; } },
    'add clock brain': { fx: { energy: 0.5, motion: 1, novelty: 1.1 }, ok: () => canAdd() && !E.mods.work && drumsOn(), make: () => { A.lastAdd = performance.now(); return [{ do: 'say', text: 'Adding a clock brain for euclidean extra hits.' }, ...L.workoutDrums(pick(['RS', 'CB', 'CP', 'CH']), pick(['1/16', '1/8T', '1/16T']), pick([3, 5, 7, 9]), 0.8)]; } },
    'add random melody': { fx: { novelty: 1.3, chaos: 0.5, energy: 0.3 }, ok: () => canAdd() && !E.mods.marbles && idleVoices().length, make: () => { A.lastAdd = performance.now(); const v = pick(idleVoices()); return [{ do: 'say', text: `Letting a random generator play ${E.mods[v].name}, in key.` }, ...L.marblesLayer(A.prof, v)]; } },
    'add sample and hold': { fx: { novelty: 1, chaos: 0.8, motion: 0.6 }, ok: () => canAdd() && !E.mods.tools && freeCV().length, make: () => { A.lastAdd = performance.now(); const trig = E.mods.marbles ? 'marbles.T2' : E.mods.work ? 'work.O3' : 'clock.BEAT'; return [{ do: 'say', text: 'Adding sample and hold for stepped random movement.' }, ...L.shTo(pick(freeCV()), trig)]; } },
    'add rhythm generator': { fx: { energy: 0.5, motion: 0.8, novelty: 1.2 }, ok: () => canAdd() && !E.mods.prime && drumsOn(), make: () => { A.lastAdd = performance.now(); return L.primeDrums(A.prof); } },
    'scroll rhythm': { fx: { novelty: 0.9, motion: 0.5 }, ok: () => E.mods.prime && E.cablesFrom('prime').length, make: () => [nudge('prime', 'prime', (rnd() < 0.5 ? -1 : 1) * (0.06 + rnd() * 0.1), 'scroll to another base rhythm', 1200)] },
    'reshape rhythm': { fx: { novelty: 0.6, motion: 0.6, energy: 0.1 }, ok: () => E.mods.prime && E.cablesFrom('prime').length, make: () => { const f = 'f' + (1 + Math.floor(rnd() * 4)); return [nudge('prime', f, (rnd() - 0.5) * 0.4, 'reshape one percussion line', 1500)]; } },
    'thin the rhythm': { fx: { energy: -0.4, motion: -0.2 }, ok: () => E.mods.prime && E.cablesFrom('prime').length && E.mods.prime.params.prob.n > 0.5, make: () => [nudge('prime', 'prob', -0.2, 'fewer extra hits, more space')] },
    // ----- logic modules: combine rhythms, turn moving voltages into hits -----
    'add logic rhythm': { fx: { novelty: 1.2, motion: 0.6, energy: 0.3 }, ok: () => canAdd() && !E.mods.logic && drumsOn() && freeIn('drums.TRIG') && logicSources().length, make: () => {
      A.lastAdd = performance.now();
      const a = pick(logicSources()), fn = pick(['XOR', 'XOR', 'AND', 'ONEHOT']), inst = pick(['RS', 'LT', 'CP', 'SD', 'HT']);
      const what = { XOR: 'only where they disagree', AND: 'only where they agree', ONEHOT: 'only where exactly one is on' }[fn];
      return [{ do: 'say', text: `Building a new drum part with logic: ${a.split('.')[0]} against the beat, ${what}.` },
        { do: 'add', type: 'Logic', id: 'logic', why: 'a logic gate that makes a third rhythm out of two' },
        P(a, 'logic.A', 'first rhythm'), P('clock.BEAT', 'logic.B', 'the beat as a square wave'), K('logic', 'fn', fn, `${fn}: ${what}`),
        K('drums', 'trigv', inst), P('logic.OUT', 'drums.TRIG', 'the combined rhythm plays a drum')];
    } },
    'add threshold trigger': { fx: { novelty: 1.1, chaos: 0.6, motion: 0.7 }, ok: () => canAdd() && !E.mods.cmp && cvSources().length && cmpTargets().length, make: () => {
      A.lastAdd = performance.now();
      const src = pick(cvSources()), to = pick(cmpTargets()), lvl = 0.2 + rnd() * 0.3, acts = [];
      acts.push({ do: 'say', text: `Turning ${src.split('.')[0]}'s movement into hits: every time it rises past ${lvl.toFixed(2)}, ${to.split('.')[0]} fires on the next 16th.` },
        { do: 'add', type: 'Compare', id: 'cmp', why: 'a comparator turns a moving voltage into triggers' },
        P(src, 'cmp.A', 'the voltage to watch'), K('cmp', 'thr', (lvl + 1) / 2, 'the level it has to cross'), K('cmp', 'hyst', 0.2, 'hysteresis so it does not chatter'), K('cmp', 'snap', '1/16', 'land the hits on the grid'));
      if (to === 'drums.TRIG') acts.push(K('drums', 'trigv', pick(['LT', 'HT', 'RS', 'CP'])));
      acts.push(P('cmp.UP', to, 'each crossing fires it'));
      return acts;
    } },
    'add tape keyboard': { fx: { novelty: 1.2, energy: 0.1, bright: -0.1 }, ok: () => canAdd() && !E.mods.reel, make: () => { A.lastAdd = performance.now(); return L.reelLayer(A.prof); } },
    'add low-pass gate': { fx: { novelty: 1.1, motion: 0.5, energy: -0.1 }, ok: () => canAdd() && !E.mods.lpg && lpgTargets().length, make: () => { A.lastAdd = performance.now(); const t = lpgTargets(); return L.lpgOn(t.includes('reel') ? 'reel' : pick(t)); } },
    'change tape': { fx: { novelty: 0.9 }, ok: () => routed('reel'), make: () => [K('reel', 'tape', pick(Object.keys(Reel.TAPES).filter(t => t !== E.mods.reel.params.tape.choice)), 'swap the tape for another instrument')] },
    'tape wobble': { fx: { novelty: 0.5, chaos: 0.4, motion: 0.3 }, ok: () => routed('reel'), make: () => [nudge('reel', 'wow', rnd() < 0.5 ? 0.15 : -0.15, 'more or less tape wobble', 1500)] },
    'tape chord': { fx: { novelty: 0.6, energy: 0.2 }, ok: () => routed('reel'), make: () => [K('reel', 'chord', pick(Object.keys(Reel.CHORDS).filter(c => c !== E.mods.reel.params.chord.choice)), 'a different chord shape on the tapes')] },
    'gate pluckier': { fx: { energy: 0.3, motion: 0.3 }, ok: () => E.mods.lpg && E.cablesFrom('lpg').length && E.mods.lpg.params.d1.n > 0.2, make: () => [nudge('lpg', 'd1', -0.12, 'shorter, woodier plucks')] },
    'gate ring': { fx: { energy: -0.2, bright: 0.2 }, ok: () => E.mods.lpg && E.cablesFrom('lpg').length && E.mods.lpg.params.d1.n < 0.8, make: () => [nudge('lpg', 'd1', 0.12, 'let the plucks ring longer')] },
    'grain freeze': { fx: { novelty: 1, motion: -0.3 }, ok: () => routed('grains'), make: () => [K('grains', 'freeze', E.mods.grains.frozen ? 'OFF' : 'ON', E.mods.grains.frozen ? 'let the grains follow the music again' : 'freeze the buffer and hold the texture')] },
    'grain shimmer': { fx: { bright: 0.6, novelty: 0.8 }, ok: () => routed('grains'), make: () => [K('grains', 'pitch', pick(['+12', '+7', '+24', '0', '-12']), 'change the grain pitch'), nudge('grains', 'spray', rnd() * 0.3 - 0.1)] },
    'grain smear': { fx: { energy: -0.3, novelty: 0.6, motion: 0.3 }, ok: () => routed('grains'), make: () => [nudge('grains', 'size', 0.15, 'longer grains, smoother wash', 1500), nudge('grains', 'dens', 0.12)] },
    'grain scatter': { fx: { energy: 0.3, chaos: 0.6, motion: 0.6 }, ok: () => routed('grains'), make: () => [nudge('grains', 'size', -0.18, 'short grains, more stutter', 900), nudge('grains', 'spray', 0.2)] },
    'swarm faster': { fx: { motion: 0.8, energy: 0.2 }, ok: () => E.mods.swarm && E.cablesFrom('swarm').length && E.mods.swarm.v('sync') < 7, make: () => [nudge('swarm', 'sync', 1 / 7, 'faster movement')] },
    'swarm slower': { fx: { motion: -0.6, energy: -0.2 }, ok: () => E.mods.swarm && E.cablesFrom('swarm').length && E.mods.swarm.v('sync') > 1, make: () => [nudge('swarm', 'sync', -1 / 7, 'slower movement')] },
    'swarm deeper': { fx: { motion: 0.6, chaos: 0.3, bright: 0.2 }, ok: () => E.mods.swarm && E.cablesFrom('swarm').length, make: () => [nudge('swarm', 'depth', 0.12, 'more modulation depth')] },
    'marbles lock': { fx: { chaos: -0.8, novelty: -0.2 }, ok: () => E.mods.marbles && E.cablesFrom('marbles').length, make: () => [nudge('marbles', 'deja', 0.2, 'repeat the phrase, it found something good')] },
    'marbles loosen': { fx: { chaos: 0.8, novelty: 0.9 }, ok: () => E.mods.marbles && E.cablesFrom('marbles').length, make: () => [nudge('marbles', 'deja', -0.25, 'let the random line wander'), nudge('marbles', 'spread', rnd() * 0.2 - 0.1)] },
    'euclid shift': { fx: { novelty: 0.8, motion: 0.4 }, ok: () => E.mods.work && E.cablesFrom('work').length, make: () => [K('work', 'shift', String(Math.floor(rnd() * 16)), 'rotate the euclidean hits'), K('work', 'e8', String(pick([3, 5, 7, 9, 11])))] },
    'envelope snap': { fx: { energy: 0.4, bright: 0.3 }, ok: () => E.mods.contour && E.cablesFrom('contour').length && E.mods.contour.params.f1.n > 0.35, make: () => [nudge('contour', 'f1', -0.08, 'shorter, punchier envelope')] },
    'envelope bloom': { fx: { energy: -0.2, bright: 0.2 }, ok: () => E.mods.contour && E.cablesFrom('contour').length && E.mods.contour.params.f1.n < 0.75, make: () => [nudge('contour', 'f1', 0.08, 'longer envelope tail')] },
    'delay throw': { fx: { novelty: 0.7, motion: 0.4 }, ok: () => true, make: () => [K('mixer', 'dfb', 0.7 + rnd() * 0.15, 'dub delay throw', 700), { do: 'wait', sec: 2 }, K('mixer', 'dfb', 0.35, null, 1200)] },
    'reverb wash': { fx: { energy: -0.3, bright: -0.2, novelty: 0.4 }, ok: () => true, make: () => [nudge('mixer', 'verb', 0.2, 'open up the space', 2000)] },
    'dry up': { fx: { energy: 0.2, bright: 0.1 }, ok: () => E.mods.mixer.v('verb') > 0.25, make: () => [nudge('mixer', 'verb', -0.2, 'tighten the space')] },
    // ----- effects and modulation -----
    'add modulation': { fx: { novelty: 1.2, motion: 1.2 }, ok: () => canAdd() && modTargets().length >= 2 && modsIn('Orbit').length + modsIn('Performer').length + modsIn('Attractor').length < 3, make: () => { A.lastAdd = performance.now(); return L.modPack(A.prof); } },
    'add effect': { fx: { novelty: 1.2, energy: 0.2 }, ok: () => canAdd() && E.order.filter(isFx).length < 6, make: () => { A.lastAdd = performance.now(); return L.fxPack(A.prof, 1); } },
    'add macro': { fx: { novelty: 0.9, motion: 0.6, energy: 0.3 }, ok: () => canAdd() && !modsIn('Macros').length && modTargets().length >= 2, make: () => { A.lastAdd = performance.now(); return L.macroPack(); } },
    'mod deeper': { fx: { motion: 1, energy: 0.3, chaos: 0.3 }, ok: () => modCables().some(c => Math.abs(E.mods[c.to.mod].params[c.to.port.slice(1)].modDepth) < 0.5), make: () => { const c = pick(modCables()), k = c.to.port.slice(1), d = E.mods[c.to.mod].params[k].modDepth; return [{ do: 'moddepth', mod: c.to.mod, key: k, depth: safeDepth(c.to.mod, k, d * (1.6 + rnd() * 0.6) || 0.3), why: 'push the movement harder' }]; } },
    'mod subtler': { fx: { motion: -0.8, energy: -0.2 }, ok: () => modCables().some(c => Math.abs(E.mods[c.to.mod].params[c.to.port.slice(1)].modDepth) > 0.08), make: () => { const c = pick(modCables()), k = c.to.port.slice(1); return [{ do: 'moddepth', mod: c.to.mod, key: k, depth: E.mods[c.to.mod].params[k].modDepth * 0.45, why: 'pull the movement back to a hint' }]; } },
    'lfo variation': { fx: { novelty: 0.8, motion: 0.7 }, ok: () => modsIn('Orbit').length || modsIn('Performer').length || modsIn('Attractor').length, make: () => modVariation(rnd() < 0.5) },
    'retarget modulation': { fx: { novelty: 0.9, motion: 0.5 }, ok: () => modCables().length && modTargets().length, make: () => { const c = pick(modCables()), [m, k, a, b] = pick(modTargets()); return [{ do: 'unmod', mod: c.to.mod, key: c.to.port.slice(1), why: 'that movement has had its turn' }, { do: 'mod', from: `${c.from.mod}.${c.from.port}`, to: `${m}.${k}`, depth: safeDepth(m, k, rnd() < 0.5 ? a : b), why: 'move something else instead' }]; } },
    'macro sweep': { fx: { energy: 0.7, motion: 1, novelty: 0.6 }, ok: () => modsIn('Macros').length, make: () => { const id = pick(modsIn('Macros')); return [K(id, 'm1', 0.85, 'open everything on macro 1', 3500), { do: 'wait', sec: 3 }, K(id, 'm1', 0.05, null, 4000)]; } },
    'stutter fill': { fx: { energy: 0.5, novelty: 0.9, chaos: 0.6 }, ok: () => E.running && modsInFx('Stutter').length, make: () => [{ do: 'fire', mod: pick(modsInFx('Stutter')), type: pick(['REPEAT', 'REVERSE', 'STOP', 'SPIN']), why: 'a glitch fill' }] },
    'echo throw': { fx: { novelty: 0.7, motion: 0.5 }, ok: () => modsInFx('Echoes').length, make: () => { const id = pick(modsInFx('Echoes')), f = E.mods[id].params.fb.n; return [K(id, 'fb', 0.88, 'dub throw: let the echoes run', 800), K(id, 'mix', Math.max(E.mods[id].params.mix.n, 0.5)), { do: 'wait', sec: 2.5 }, K(id, 'fb', f, 'and reel them back in', 1500)]; } },
    'space freeze': { fx: { novelty: 0.9, energy: -0.2 }, ok: () => modsInFx('Horizon').length || modsInFx('Halls').length, make: () => { const h = modsInFx('Horizon'); if (h.length) { const id = pick(h); return [K(id, 'freeze', 'ON', 'freeze the cloud and hold it'), { do: 'wait', sec: 4 }, K(id, 'freeze', 'OFF', 'let it go')]; } const id = pick(modsInFx('Halls')); return [K(id, 'shim', 0.55, 'shimmer swell', 2500), { do: 'wait', sec: 3 }, K(id, 'shim', 0.05, null, 3000)]; } },
    'crush moment': { fx: { energy: 0.4, chaos: 0.6, novelty: 0.7 }, ok: () => modsInFx('Heat').length, make: () => { const id = pick(modsInFx('Heat')), r = E.mods[id].params.rate.n; return [K(id, 'rate', 0.35 + rnd() * 0.2, 'crush it down for a moment', 1200), { do: 'wait', sec: 2 }, K(id, 'rate', r, null, 1500)]; } },
    'spiral shift': { fx: { novelty: 1, chaos: 0.7 }, ok: () => modsInFx('Bode').length, make: () => { const id = pick(modsInFx('Bode')); return [K(id, 'fb', 0.7 + rnd() * 0.2, 'let the spiral climb', 1500), K(id, 'mix', 0.5), { do: 'wait', sec: 3 }, K(id, 'fb', 0.25, null, 2000)]; } },
    'master up': { fx: { energy: 0.4, loud: 1 }, ok: () => E.mods.mixer.v('master') < 0.95, make: () => [nudge('mixer', 'master', 0.08, 'needs to be louder')] },
    'master down': { fx: { energy: -0.4, loud: -1 }, ok: () => E.mods.mixer.v('master') > 0.4, make: () => [nudge('mixer', 'master', -0.08, 'too hot, back off')] }
  };

  function score(name, mv, want) {
    const fx = mv.fx, q = A.q[name]?.v || 0, p = A.prof;
    let s = (fx.energy || 0) * want.energy * 2.4 + (fx.bright || 0) * want.bright * 2 + (fx.loud || 0) * want.loud * 1.6;
    s += (fx.chaos || 0) * (p.tr.chaos - 0.35) * 0.9 + (fx.novelty || 0) * want.bored + (fx.motion || 0) * (p.tr.chaos * 0.3 + want.energy * 0.6);
    s += q * 0.9 + rnd() * (0.35 + p.tr.chaos * 0.4);
    if (name === A.lastMove) s -= 0.6;
    return s;
  }
  function errNow() { return Math.abs(target.energy - ears.energy) * 1.2 + Math.abs(target.bright - ears.bright) + Math.max(0, ears.rms - target.loud - 4) / 10 + (ears.rms < -55 && E.running ? 1 : 0); }

  async function shapeOnce(reason) {
    // modulation keeps the parts moving: every so often vary it, big when the energy is high, small when it is low
    const gap = (30000 - A.prof.tr.chaos * 12000 - A.prof.tr.aggression * 6000) * (0.8 + rnd() * 0.4);
    if (performance.now() - (A.lastModVar || 0) > gap) {
      A.lastModVar = performance.now();
      const drama = target.energy > 0.62 || rnd() < A.prof.tr.chaos * 0.4;
      let acts = modVariation(drama);
      if (!acts.length && modTargets().length >= 2 && E.order.length <= 28 && rnd() < 0.7) acts = L.modPack(A.prof);
      if (acts.length) { A.log('ear', `time for movement: a ${drama ? 'dramatic' : 'subtle'} modulation change`); A.curMove = drama ? 'lfo variation' : 'mod subtler'; await runAll(acts); return; }
    }
    const want = { energy: target.energy - ears.energy, bright: target.bright - ears.bright, loud: (target.loud - ears.rms) / 12, bored: Math.min(1.2, (performance.now() - (A.lastNovel || 0)) / 40000) };
    const cands = Object.entries(MOVES).filter(([name, mv]) => { if (A.blocked.has(name)) return false; try { return mv.ok(); } catch (e) { return false; } });
    if (!cands.length) return;
    cands.sort((a, b) => score(b[0], b[1], want) - score(a[0], a[1], want));
    const [name, mv] = cands[0];
    const e0 = errNow();
    A.log('ear', `hears energy ${Math.round(ears.energy * 100)}% (want ${Math.round(target.energy * 100)}), brightness ${Math.round(ears.cent)}Hz → chooses <b>${name}</b>${reason ? ' · ' + esc(reason) : ''}`);
    A.think(A.stateName || 'Performing', `Energy ${Math.round(ears.energy * 100)}% vs target ${Math.round(target.energy * 100)}%. Brightness ${Math.round(ears.bright * 100)}% vs ${Math.round(target.bright * 100)}%. Trying "${name}".`);
    A.curMove = name;
    await runAll(mv.make());
    if (mv.fx.novelty) A.lastNovel = performance.now();
    A.lastMove = name; (A.movesSince = A.movesSince || []).push(name);
    await UI.sleep(2600);
    if (A.abort) return;
    const e1 = errNow();
    const r = clamp((e0 - e1) * 2 + (mv.fx.novelty ? 0.1 * A.prof.tr.chaos : 0) - (ears.clip ? 0.3 : 0), -1, 1);
    const q = A.q[name] || { v: 0, n: 0 }; q.v += 0.25 * (r - q.v); q.n++; A.q[name] = q; saveQ(); drawSkills();
    A.log('learn', `learned: "${name}" scored ${r >= 0 ? '+' : ''}${r.toFixed(2)} → value ${q.v.toFixed(2)}`);
  }

  // ======================= SECTIONS / TIMELINE =======================
  const ARC = [['Intro', 0.08, 0.3], ['Build', 0.14, 0.55], ['Drop', 0.2, 0.9], ['Break', 0.12, 0.35], ['Build', 0.1, 0.7], ['Peak', 0.22, 1], ['Outro', 0.14, 0.25]];
  function drawTimeline() {
    const el = $('#timeline'); el.innerHTML = '';
    if (!A.sections) { el.innerHTML = '<div class="sec">No performance running</div>'; return; }
    A.sections.forEach(s => { const d = document.createElement('div'); d.className = 'sec'; d.style.flex = s.frac; d.innerHTML = `${esc(s.name)}<i style="height:${Math.round(s.energy * 100)}%"></i>`; el.append(d); });
    const hd = document.createElement('div'); hd.className = 'head'; hd.id = 'tlhead'; el.append(hd);
    $('#tlend').textContent = fmtT((A.endT - A.startT) / 1000);
  }
  setInterval(() => {
    if (!A.sections || !A.startT) return;
    const now = performance.now(), f = clamp((now - A.startT) / (A.endT - A.startT));
    const hd = $('#tlhead'); if (hd) hd.style.left = `calc(${(f * 100).toFixed(2)}% - 1px)`;
    $('#tlnow').textContent = fmtT((now - A.startT) / 1000);
    const cur = A.sections.find(s => f >= s.start && f < s.start + s.frac) || A.sections[A.sections.length - 1];
    $('#tlsec').textContent = cur.name;
    [...$('#timeline').querySelectorAll('.sec')].forEach((d, i) => d.classList.toggle('now', A.sections[i] === cur));
  }, 250);

  const secPat = (L, why) => activeSeqs().filter(id => !E.mods[id].songOn && E.mods[id].hasNotes('ABCDEFGH'.indexOf(L))).map(id => ({ do: 'select', mod: id, pat: L, why }));
  const SECTION_MOVES = {
    intro: () => [...secPat('C', 'intro pattern'), { do: 'mute', inst: 'BD', on: true, why: 'start without the kick' }, { do: 'mute', inst: 'SD', on: true }, { do: 'mute', inst: 'CP', on: true }, ...voiceCut().map(([m, k]) => K(m, k, 0.15, 'start dark', 2500))],
    build: () => [...secPat('A', 'build pattern'), { do: 'mute', inst: 'CH', on: false }, { do: 'mute', inst: 'SD', on: false }, { do: 'mute', inst: 'CP', on: false }, ...voiceCut().slice(0, 1).map(([m, k]) => nudge(m, k, 0.2, 'rising filter for the build', 6000))],
    drop: () => [...(routed('grains') ? [K('grains', 'freeze', 'OFF', 'unfreeze for the drop')] : []), ...(E.mods.swarm ? [K('swarm', 'depth', 0.55, 'more movement for the drop')] : []), ...secPat('B', 'drop pattern'), { do: 'mute', inst: 'BD', on: false, why: 'here comes the drop' }, { do: 'mute', inst: 'SD', on: false }, { do: 'mute', inst: 'CP', on: false }, ...voiceCut().map(([m, k]) => nudge(m, k, 0.25, 'open up', 900)), K('mixer', 'master', 0.85)],
    break: () => [...secPat('C', 'break pattern'), { do: 'mute', inst: 'BD', on: true, why: 'breakdown' }, nudge('mixer', 'verb', 0.25, 'wash it out', 2500), ...(routed('grains') ? [K('grains', 'freeze', 'ON', 'freeze the texture for the break')] : [])],
    peak: () => [...secPat('B', 'peak pattern'), { do: 'mute', inst: 'BD', on: false }, { do: 'mute', inst: 'SD', on: false }, { do: 'mute', inst: 'CP', on: false }, ...(routed('acid') ? [nudge('acid', 'drive', 0.2, 'peak-time grit')] : []), ...(routed('titan') ? [nudge('titan', 'drive', 0.2)] : []), K('mixer', 'verb', 0.3)],
    outro: () => [...secPat('C', 'outro pattern'), { do: 'mute', inst: 'SD', on: true }, { do: 'mute', inst: 'CP', on: true }, ...voiceCut().map(([m, k]) => nudge(m, k, -0.25, 'wind it down', 5000))]
  };

  // ======================= CLAUDE PLANNER =======================
  function catalog() {
    const out = [];
    for (const id of E.order) {
      const m = E.mods[id];
      const knobs = m.paramOrder.map(k => { const p = m.params[k]; return p.steps ? `${k}[${p.steps.join('|')}]` : `${k}(0..1, now ${p.n.toFixed(2)} = ${p.display()})`; });
      out.push(`- ${id} "${m.name}" (${m.sub}). inputs: ${Object.entries(m.ins).map(([n, d]) => `${n}:${d.jt}`).join(', ') || 'none'}. outputs: ${Object.entries(m.outs).map(([n, d]) => `${n}:${d.jt}`).join(', ')}. knobs: ${knobs.join(', ')}`);
    }
    return out.join('\n');
  }
  async function askClaude(p) {
    const sample = A.claude; if (!sample) return null;
    const cables = E.cables.map(c => `${c.from.mod}.${c.from.port} -> ${c.to.mod}.${c.to.port}`).join('; ') || 'none';
    const prompt = `You are the brain of an AI performer playing a browser modular synthesizer. Plan what to patch and turn.

PERSONALITY: ${p.persona}
TASK: ${p.task}
MODE: ${p.mode}${p.dur ? ` for ${Math.round(p.dur / 60)} minutes` : ''}

MODULES (id "name": ports with types audio|cv|ev; ev = clock/gate/note events and only connects ev->ev; audio and cv connect to each other):
${catalog()}

CURRENT CABLES: ${cables}
Mixer channel convention: acid IN1, drums IN2, titan IN3, lead IN4, chip IN5, bodies IN6, vcfq/fold chain IN7, geiger IN8. mixer.OUT must reach monitor.IN to be heard.
Sequencer notes are scale degrees (0 = root, 7 = octave in a 7-note scale), null = rest. Drum patterns are 16 chars: x hit, X accent, . rest. Instruments: BD SD CP CH OH LT HT RS CB CY.

ACTIONS (JSON objects):
{"do":"patch","from":"mod.PORT","to":"mod.PORT","why":"..."}
{"do":"unpatch","to":"mod.PORT"}
{"do":"knob","mod":"id","key":"knob","to":0.0-1.0 or a step label,"ms":optional turn time,"why":"..."}
{"do":"steps","mod":"seq1|seq2","notes":[16 items],"accents":[step indexes],"slides":[step indexes]}
{"do":"drums","inst":"BD","pattern":"x...x...x...x..."}
{"do":"mute","inst":"BD","on":true}
{"do":"route","mod":"id","level":0-1,"send":0-1}  (patches mod.OUT to its mixer channel)
{"do":"transport","run":true}
{"do":"pattern","mod":"seqId","pat":"A".."H","notes":[16],"accents":[],"slides":[],"probs":[16 values 0-1],"ratchets":[16 values 1-4]}  (each sequencer holds 8 patterns)
{"do":"copy","mod":"seqId","from":"A","to":"B"}
{"do":"select","mod":"seqId","pat":"B"}  (switches when the current pattern ends)
{"do":"song","mod":"seqId","chain":[["A",4],["B",2],["C",1]],"on":true}  (song mode chains patterns with repeat counts)
{"do":"add","type":"<module type>","id":"newId","model":"for Analog: ${Mods.MODELS.join('|')}"}  (adds a new module to the rack; choose an unused id, then patch it)
{"do":"remove","mod":"id"}
{"do":"insert","type":"Heat","into":"titan","set":{"model":"FUZZ","drive":0.5,"mix":0.8}}  (adds an effect after a module's output and before wherever it went; works on "drums" and on "mixer" for the whole mix)
{"do":"mod","from":"orbit2.O1","to":"titan.p1","depth":-1..1}  (drops a modulation cable from any CV output onto ANY continuous knob, Massive-style; depth is in knob units)
{"do":"moddepth","mod":"titan","key":"p1","depth":0.4}  {"do":"unmod","mod":"titan","key":"p1"}
{"do":"performer","mod":"perf2","lane":1,"preset":"WOB8"}  (${Object.keys(LFO.PRESETS).join(' ')})
{"do":"build","mod":"macro2","bars":8}  (Macros RISE ramps over the bars from the next bar, DROP fires when it lands)
{"do":"fire","mod":"stut2","type":"REPEAT|REVERSE|STOP|SPIN"}  (a glitch right now)
{"do":"say","text":"short first-person narration of your intent"}

ADDABLE MODULE TYPES: ${Object.entries(Mods.TYPES).map(([k, t]) => `${k} (${t.label}${t.desc ? ': ' + t.desc : ''}, ids like ${t.prefix}3)`).join('; ')}. CV outputs swing about -1..1 (Contour 0..1); a voice CUT input moves the cutoff 2 octaves per unit. Modulation modules (Contour, Swarm, Toolbox) make complex patches: patch their outputs into CUT, FOLD, CV, POS and similar inputs. Workout and Marbles outputs are events (ev) for TRIG/CLK/NOTE inputs. Logic modules: Logic combines two or three event streams (AND, OR, XOR, ONEHOT; OUT on, INV off) and is the way to merge two trigger sources into one input or to make a new rhythm out of two; Edge gives RISE/FALL/BOTH triggers from gates and notes; Compare turns a CV (an LFO, attractor or Follower ENV) into UP/DOWN triggers and 0/1 GT/LT/WIN signals. Their GATE outputs are 0/1 control signals you can drop on knobs. Effects (Halls, Echoes, Ensemble, Phaser, Heat, Bode, Sympathy, Vowel, Pump, Stutter, Prism, Cassette, Horizon, Twin) go in with "insert". Modulation sources (Orbit, Performer, Attractor, Macros, Follower, Swarm, Contour) should be used OFTEN: drop their outputs onto synth, filter and effect knobs with "mod", subtle depths (0.05-0.2) for verses, dramatic ones (0.3-0.6) for drops and choruses. Do not use the cowbell (CB) or bells more than rarely, and keep high repeating sounds low in the mix. Vary the instruments: do not default to the Bodies bell. You may add as many as the music needs (rack limit 32 modules). A new voice needs a sequencer (or ent/geiger) feeding its NOTE input and a "route" to be heard; "route" finds a free mixer channel and adds a mixer when all are taken.

Reply with JSON only:
{"summary":"one sentence","targets":{"energy":0-1,"brightness":0-1},
 "design":[30-70 actions that build the patch from the current state, starting with a say, ending with transport run true],
 "sections":${p.mode === 'perform' ? '[5-9 sections, each {"name":"...","fraction":share of the set,"energy":0-1,"actions":[3-10 actions fired when the section starts]}]' : '[]'}}
${Theory.PRIMER}
${Genres.primer(p.genre)}
${A.songForm ? 'A song engine will arrange the song form after your design (verse, build, chorus and so on), so design the sound and the main patterns; leave "sections" empty.\n' : ''}Build complex, layered patches: add extra sequencers and voices when they serve the music, give sequencers several patterns and a song. Make it musical and true to the personality. Be spontaneous with melodies: invent fresh motifs instead of stock riffs, vary rhythm (syncopation, rests, odd groupings, call and response), use leaps as well as steps, develop ideas across patterns (invert, transpose, answer, displace), and pick an unexpected key or mode when it suits. Random seed for this plan: ${Math.floor(rnd() * 1e6)}. Use the modules the task and personality call for.`;
    A.think('Asking Claude', 'Claude is composing a plan for the patch and the set. This can take up to a minute.');
    A.log('sys', 'sent the brief, module catalog and current patch to Claude');
    let chars = 0;
    try {
      const plan = await sample.json(prompt, { modelTier: 'default', onText: ({ text }) => { if (text.length - chars > 200) { chars = text.length; A.think('Claude is writing', `Plan so far: ${chars} characters…`); } } });
      if (!plan || !Array.isArray(plan.design)) throw new Error('plan had no design list');
      A.log('sys', `Claude's plan: ${esc(plan.summary || '')} (${plan.design.length} design actions, ${(plan.sections || []).length} sections)`);
      return plan;
    } catch (e) {
      A.log('err', `Claude planning unavailable (${esc(e.code || e.message)}), using the built-in brain`);
      return null;
    }
  }

  // ======================= MAIN ENTRY =======================
  A.perform = async function (task, persona, brain) {
    if (A.busy) return;
    A.abort = false; setBusy(true);
    const p = parseBrief(task, persona); A.prof = p;
    // a new design or set always starts from a blank rack: nothing left over from the last one
    if (p.mode !== 'tweak') { Song.stop(); if (A.wipe) { A.wipe(false); A.log('sys', 'cleared the rack: starting from scratch'); } } A.songForm = Song.choice(p);
    A.startT = performance.now(); A.endT = A.startT + Math.max(p.dur, 60) * 1000; A.sections = null; drawTimeline();
    A.stateName = 'Reading the brief';
    A.log('sys', `<b>${esc(task)}</b> — as: ${esc(persona)}`);
    const traits = Object.entries(p.tr).map(([k, v]) => `${k} ${Math.round(v * 100)}%`).join(', ');
    A.think('Reading the brief', `Heard: ${p.genre} · ${p.mode}${p.dur ? ' · ' + fmtT(p.dur) : ''}. Personality: ${traits}.`);
    A.log('sys', `interpreted as <b>${p.genre}</b> ${p.mode}${p.dur ? ' for ' + fmtT(p.dur) : ''}; personality ${traits}`);
    await UI.sleep(900);
    target.bright = clamp(Genres.get(p.genre)?.bright ?? 0.55) - p.tr.dark * 0.5 + p.tr.aggression * 0.1;
    target.energy = clamp(0.55 + p.tr.aggression * 0.3 - p.tr.calm * 0.35);
    target.loud = -16 + p.tr.aggression * 6 - p.tr.calm * 4;

    let plan = null;
    if (brain === 'claude' && p.mode !== 'tweak') plan = await askClaude(p);
    if (A.abort) return finish();

    A.stateName = p.mode === 'tweak' ? 'Adjusting' : 'Designing the patch';
    if (p.mode !== 'tweak') {
      if (!E.findCable('monitor', 'IN')) await run(P('mixer.OUT', 'monitor.IN', 'connect the mixer to the speakers'));
      let acts, bpm;
      if (plan) { acts = plan.design; if (plan.targets) { target.energy = clamp(+plan.targets.energy || target.energy); target.bright = clamp(+plan.targets.brightness || target.bright); } }
      else {
        songKey = null; const Gn = Genres.get(p.genre);
        const r = Gn && !Gn.legacy ? L.genre(p, Gn) : (RECIPES[p.genre] || RECIPES.techno)(p); acts = r.acts; bpm = r.exact ? r.bpm : r.bpm + Math.round(p.tr.aggression * 6 - p.tr.calm * 10);
        if (Gn) A.log('sys', `genre knowledge: <b>${esc(Gn.label)}</b> · ${esc(Gn.notes)}`);
        // every main sequencer gets B/C/D patterns and a song; song mode plays it for designs, the performer switches by hand in a set
        const songOn = p.mode !== 'perform';
        const extra = [];
        acts.filter(a => a.do === 'steps').forEach(a => { a.do = 'pattern'; a.pat = 'A'; if (!A.songForm) extra.push(...songify(a.mod, a, songOn)); });
        acts = acts.concat(extra);
        const reserved = new Set(CORE_IDS);
        const nLayers = Gn && !Gn.legacy ? (p.complex >= 3 ? 1 : 0) : p.complex; // a genre build already has its full band
        for (let i = 0; i < nLayers; i++) acts = acts.concat(newLayer(p, reserved, songOn || p.songWanted));
      }
      // Bring back any built-in module the plan needs that was removed from the rack
      const CORE = { seq1: ['StepSeq', { name: 'Sequencer A', stripe: '#f2b632' }], seq2: ['StepSeq', { name: 'Sequencer B', stripe: '#3e8ef0' }], ent: ['Entropy'], drums: ['Drums'], acid: ['Analog', { model: 'ACID', name: 'Voice 303', stripe: '#f2b632' }], lead: ['Analog', { model: 'JOVE', name: 'Voice Poly', stripe: '#3e8ef0' }], geiger: ['Geiger'], titan: ['Titan'], chip: ['Chip'], bodies: ['Bodies'], slope: ['Slope'], fold: ['Fold'], vcfq: ['VCFQ'] };
      const used = new Set(); const addIds = new Set(acts.filter(a => a.do === 'add').map(a => a.id));
      acts.forEach(a => { [a.mod, a.from, a.to].forEach(v => { if (typeof v === 'string') used.add(v.split('.')[0]); }); });
      for (const id of used) if (!E.mods[id] && CORE[id] && !addIds.has(id)) { if (A.abort) break; const [type, o = {}] = CORE[id]; await run({ do: 'add', type, id, ...o, why: 'this patch needs it back' }); }
      // Unplug what the new patch does not use (keeps the mixer → monitor connection)
      const keep = new Set(acts.filter(a => a.do === 'patch').map(a => a.to));
      acts.filter(a => a.do === 'route').forEach(a => keep.add(`mixer.IN${MIXCH[a.mod] || 0}`));
      keep.add('monitor.IN');
      const stale = E.cables.filter(c => !keep.has(`${c.to.mod}.${c.to.port}`));
      if (stale.length) { A.think(A.stateName, `Clearing ${stale.length} cable${stale.length > 1 ? 's' : ''} this patch does not need.`); for (const c of stale) { if (A.abort) break; await run({ do: 'unpatch', to: `${c.to.mod}.${c.to.port}` }); } }
      if (bpm) await run(K('clock', 'bpm', clamp((bpm - 60) / 140), `${bpm} BPM suits ${Genres.get(p.genre)?.label || p.genre}`));
      A.think(A.stateName, plan ? plan.summary || 'Following Claude\'s plan.' : `Building a ${p.genre} patch shaped by the personality.`);
      if (!plan) await run({ do: 'transport', run: true });
      await runAll(acts);
      if (!E.running) await run({ do: 'transport', run: true });
      { const f = Theory.unfart('sound design check: no farty synths'); if (f.length && !A.abort) { A.log('sys', 'checking the sound design: avoiding farty, blatty synth settings'); await runAll(f); } }
      // effects and modulation on almost every design: tidy away unused ones first, then pick fresh ones
      if (!A.abort) { const idle = E.order.filter(id => (FXK.has(E.mods[id].kind) || MODK.has(E.mods[id].kind)) && !E.cables.some(c => c.from.mod === id || c.to.mod === id)); for (const id of idle) { if (A.abort) break; await run({ do: 'remove', mod: id, why: 'not part of this patch' }); } }
      if (!plan && !A.abort && rnd() < 0.9) await runAll(L.fxPack(p));
      if (!plan && !A.abort && rnd() < 0.85) await runAll(L.modPack(p));
      if (!plan && !A.abort && p.mode === 'perform' && rnd() < 0.6) await runAll(L.macroPack());
      { const g = Mix.ungrate(); if (g.length && !A.abort) await runAll(g); }
      if (Mix.on && !A.abort) { A.stateName = 'Mixing'; await Mix.pass({ why: 'balance the new patch' }); }
    } else {
      // tweak: change targets from adjectives
      const t = task;
      if (/dark|darker|warm|muffl/i.test(t)) target.bright = clamp(ears.bright - 0.25);
      if (/bright|brighter|crisp|harsh/i.test(t)) target.bright = clamp(ears.bright + 0.25);
      if (/more energy|harder|heavier|louder|intense|aggress/i.test(t)) target.energy = clamp(ears.energy + 0.25);
      if (/calm|softer|chill|quiet|less/i.test(t)) target.energy = clamp(ears.energy - 0.25);
      const fast = t.match(/faster|slower/i); if (fast) await run(nudge('clock', 'bpm', /faster/i.test(t) ? 0.06 : -0.06, fast[0]));
      if (/geiger|radiation/i.test(t)) await runAll(L.geiger(p));
      if (/chip|8.?bit/i.test(t)) await runAll([P('clock.CLK', 'ent.CLK'), P('ent.NOTE', 'chip.NOTE'), { do: 'route', mod: 'chip', level: 0.5, send: 0.3 }]);
      if (/bell|string|marimba|physical/i.test(t)) await runAll(L.bodies(p, /string/i.test(t) ? 'STRING' : /marimba/i.test(t) ? 'MARIMBA' : bodyModel()));
      { const fxw = fxWords(t); if (fxw.length) await runAll(fxw); }
      if (/lfo|modulat|movement|wobble|evolv|massive|performer|chaos|attractor|macro/i.test(t)) await runAll(L.modPack(p, { kind: /performer|wobble/i.test(t) ? 'Performer' : /chaos|attractor/i.test(t) ? 'Attractor' : null, drama: /dramatic|extreme|wild|heavy/i.test(t) ? 1 : /subtle|gentle|slight/i.test(t) ? 0 : null }));
      if (/wobble|dubstep|bass/i.test(t) && !routed('titan')) await runAll(L.titan(p, true));
      if (/acid|303/i.test(t) && !routed('acid')) await runAll(L.acid(p));
      if (/grain|granular|texture|cloud|freeze/i.test(t) && !E.mods.grains) { const v = grainSources(); if (v.length) await runAll(L.grainsOn(pick(v))); }
      if (/swarm/i.test(t) && !E.mods.swarm && freeCV().length) await runAll(L.swarmTo(freeCV().slice(0, 3)));
      if (/random|marbles|generative/i.test(t) && !E.mods.marbles && idleVoices().length) await runAll(L.marblesLayer(p, pick(idleVoices())));
      if (/envelope|maths|contour|pluck|function gen/i.test(t) && !E.mods.contour && envTargets().length) await runAll(L.contourEnv(...pick(envTargets())));
      if (/euclid|polyrhythm|workout|clock div/i.test(t) && !E.mods.work && drumsOn()) await runAll(L.workoutDrums('RS', '1/16', 5, 0.85));
      if (/sample.?(and|&|n).?hold|s&h|toolbox|utilit/i.test(t) && !E.mods.tools && freeCV().length) await runAll(L.shTo(pick(freeCV()), 'clock.BEAT'));
      if (!E.running) await run({ do: 'transport', run: true });
    }
    if (A.abort) return finish();

    // song structure: plan the form and the first section, then the song engine runs on the bar line
    const aOnly = $('#layermode')?.value === 'a' || /(only|just)\s+(use\s+)?layer\s*a\b|layer\s*a\s+only|no\s+layer\s*b|without\s+layer\s*b/i.test(task);
    if (aOnly && E.hasLayer(1) && E.layers[1].bus.gain.value > 0.01) { Layers.crossfade(0, 2); A.log('sys', 'Layer A only: faded Layer B out'); }
    const twoLayers = A.songForm && p.mode !== 'tweak' && !aOnly;
    if (twoLayers && !A.abort) await buildLayerB(p);
    if (A.abort) return finish();
    if (A.songForm && p.mode !== 'tweak') { A.stateName = 'Arranging the song'; await toLayer(0); if (!(await Song.begin(p, { loop: p.mode !== 'perform', layers: twoLayers }))) A.songForm = null; }
    if (A.abort) return finish();

    if (p.mode === 'perform' && A.songForm) {
      A.stateName = 'Performing the song';
      await Song.performLoop(p);
      if (!A.abort) {
        A.stateName = 'Ending the set'; A.think('Ending the set', 'The song is over. Fading out and stopping the clock.');
        Song.stop();
        if (E.hasLayer(1)) { const other = 1 - E.V; if (E.layers[other].bus.gain.value > 0.01) E.fadeLayer(other, 0, 6); }
        await run(K('mixer', 'master', 0.05, 'fade out', 6000));
        await run({ do: 'transport', run: false });
        await run(K('mixer', 'master', 0.8, 'reset the master for next time', 400));
        A.log('sys', 'song finished');
      }
    } else if (p.mode === 'perform') {
      const src = plan && Array.isArray(plan.sections) && plan.sections.length ? plan.sections.map(s => [s.name || 'Section', +s.fraction || 1 / plan.sections.length, clamp(+s.energy || 0.5), s.actions || []]) : ARC.map(a => [...a, null]);
      const tot = src.reduce((a, s) => a + s[1], 0); let acc = 0;
      A.sections = src.map(([name, frac, energy, acts]) => { const o = { name, frac: frac / tot, start: acc, energy: clamp(energy * (1 - p.tr.calm * 0.35) + p.tr.aggression * 0.08), acts }; acc += o.frac; return o; });
      A.startT = performance.now(); A.endT = A.startT + p.dur * 1000; drawTimeline();
      A.log('sys', `starting a ${fmtT(p.dur)} set in ${A.sections.length} sections`);
      let curSec = null;
      while (!A.abort && performance.now() < A.endT) {
        const f = (performance.now() - A.startT) / (A.endT - A.startT);
        const s = A.sections.find(x => f >= x.start && f < x.start + x.frac) || A.sections[A.sections.length - 1];
        if (s !== curSec) {
          curSec = s; A.stateName = `Performing · ${s.name}`; target.energy = s.energy;
          A.log('sys', `— <b>${esc(s.name)}</b> (energy target ${Math.round(s.energy * 100)}%) —`);
          const key = s.name.toLowerCase().replace(/[^a-z]/g, '');
          const scripted = s.acts && s.acts.length ? s.acts : (SECTION_MOVES[Object.keys(SECTION_MOVES).find(k => key.includes(k))] || (() => []))();
          A.think(A.stateName, `Entering ${s.name}. Aiming for ${Math.round(s.energy * 100)}% energy.`);
          await runAll(scripted);
          continue;
        }
        if (A.fixQueue.length) { await runAll(A.fixQueue.splice(0)); continue; }
        if (Mix.needs(E.L)) { await Mix.pass({ L: E.L, why: 'the balance drifted' }); continue; }
        await shapeOnce();
        const pause = (2200 + rnd() * 3500) * (1 + p.tr.calm) * (1 - p.tr.chaos * 0.4);
        await UI.sleep(pause);
      }
      if (!A.abort) {
        A.stateName = 'Ending the set'; A.think('Ending the set', 'Fading out and stopping the clock.');
        await run(K('mixer', 'master', 0.05, 'fade out', 6000));
        await run({ do: 'transport', run: false });
        await run(K('mixer', 'master', 0.8, 'reset the master for next time', 400));
        A.log('sys', 'set finished');
      }
    } else {
      A.stateName = 'Listening and tuning';
      const n = p.mode === 'tweak' ? 6 : 5;
      for (let i = 0; i < n && !A.abort; i++) { if (A.fixQueue.length) await runAll(A.fixQueue.splice(0)); if (Mix.needs(E.L)) await Mix.pass({ L: E.L, why: 'the balance drifted' }); await shapeOnce(i === 0 ? 'first listen' : null); await UI.sleep(800); }
      if (!A.abort) { A.think('Patch ready', A.songForm ? `Done. The ${p.genre} song keeps playing and I keep writing each next section while it loops. Ask for changes, or run a live set.` : `Done. The ${p.genre} patch keeps playing. Ask for changes like "make it darker" or "add the geiger counter", or run a live set.`); A.log('sys', 'patch ready'); }
    }
    finish();
  };
  function finish() {
    if (A.abort) { A.think('Stopped', 'You stopped the AI. The patch keeps playing as it is.'); A.log('sys', 'stopped by you'); }
    A.sections = A.sections && !A.abort ? A.sections : A.sections; setBusy(false);
  }
  A.stop = () => { A.abort = true; Song.stop(); };
  // ----- hooks for the self-critic (critic.js) -----
  A.fixQueue = []; A.blocked = new Set();
  A.runAll = runAll; A.variation = variation; A.setBusy = setBusy; A.shapeOnce = shapeOnce; A.fmtT = fmtT;
  A.catalog = catalog; A.target = target; A.moves = MOVES; A.activeSeqs = activeSeqs; A.routed = routed; A.voiceCut = voiceCut;
  // run fixes now if the AI is idle, otherwise hand them to the performer between moves
  A.applyFixes = async function (list) {
    if (!list.length) return;
    if (A.busy) { A.fixQueue.push(...list); return; }
    A.abort = false; setBusy(true); A.stateName = 'Correcting course';
    try { await runAll(list); } finally { setBusy(false); }
  };
  // nudge the learned value of the moves made since the last critique
  A.creditMoves = function (r) {
    const names = A.movesSince || []; A.movesSince = [];
    for (const name of new Set(names)) { const q = A.q[name] || { v: 0, n: 0 }; q.v += 0.15 * (r - q.v); q.n++; A.q[name] = q; }
    if (names.length) { saveQ(); drawSkills(); }
    return names;
  };
  A.parseBrief = parseBrief;
  return A;
})();
