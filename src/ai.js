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
  const setBusy = b => { A.busy = b; $('#thought').classList.toggle('busy', b); $('#run').disabled = b; $('#stop').disabled = !b; if (!b) UI.handOff(); };

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

  async function run(a) {
    if (A.abort) return;
    try {
      switch (a.do) {
        case 'say': A.think(A.stateName || 'Thinking', a.text); A.log('sys', esc(a.text)); await UI.sleep(500 * UI.speed); break;
        case 'knob': {
          const m = E.mods[a.mod], p = m?.params[a.key];
          if (!p) { A.log('err', `skipped unknown knob ${esc(a.mod)}.${esc(a.key)}`); break; }
          const n = normFor(p, a.to); if (n == null) { A.log('err', `skipped ${esc(a.mod)}.${esc(a.key)}: bad value`); break; }
          if (Math.abs(n - p.n) < 0.004) break;
          const before = p.display();
          await UI.aiKnob(a.mod, a.key, n, a.ms);
          A.log('act', `<b>turn</b> ${m.name} ${p.label} ${esc(before)} → ${esc(p.display())}${a.why ? ' · ' + esc(a.why) : ''}`);
          break;
        }
        case 'patch': {
          const from = split(a.from), to = split(a.to);
          if (!E.canConnect(from, to)) { A.log('err', `skipped patch ${esc(a.from)} → ${esc(a.to)} (jacks do not match)`); break; }
          await UI.aiPatch(from, to);
          A.log('act', `<b>patch</b> ${E.mods[from.mod].name} ${from.port} → ${E.mods[to.mod].name} ${to.port}${a.why ? ' · ' + esc(a.why) : ''}`);
          break;
        }
        case 'unpatch': {
          const to = split(a.to), c = E.findCable(to.mod, to.port);
          if (c) { await UI.aiUnpatch(c); A.log('act', `<b>unplug</b> ${E.mods[c.from.mod].name} ${c.from.port} ✕ ${E.mods[to.mod].name} ${to.port}${a.why ? ' · ' + esc(a.why) : ''}`); }
          break;
        }
        case 'steps': case 'pattern': {
          const m = E.mods[a.mod]; if (!m?.pats) { A.log('err', `skipped pattern for ${esc(a.mod)} (not a step sequencer)`); break; }
          const pi = a.pat == null ? m.cur : patIx(a.pat); if (pi < 0) break;
          const fit = (arr, d) => { const o = (arr || []).slice(0, 16); while (o.length < 16) o.push(d); return o; };
          const notes = fit(a.notes, null), probs = fit(a.probs, 1), rats = fit(a.ratchets, 1);
          const acc = new Set(a.accents || []), sl = new Set(a.slides || []);
          const L = 'ABCDEFGH'[pi];
          if (pi !== m.cur) { await UI.aiPoint(m.ui.pbs[pi], a.mod, `edit ${m.name} pattern ${L}`); m.view = pi; m.ui.renderAll(); }
          await UI.aiCells(m.ui.cells, a.mod, `program ${m.name} pattern ${L}`, i => {
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
          await UI.aiPoint(m.ui.pbs[f], a.mod, `copy pattern ${'ABCDEFGH'[f]}`); await UI.aiPoint(m.ui.pbs[t], a.mod, `paste into ${'ABCDEFGH'[t]}`);
          m.pats[t] = m.pats[f].map(s => ({ ...s })); m.ui.renderAll();
          A.log('act', `<b>copy</b> ${m.name} pattern ${'ABCDEFGH'[f]} → ${'ABCDEFGH'[t]}`);
          break;
        }
        case 'select': {
          const m = E.mods[a.mod]; if (!m?.pats) break;
          const pi = patIx(a.pat); if (pi < 0 || (pi === m.cur && m.next == null)) break;
          if (m.songOn) { await UI.aiPoint(m.ui.songBtn, a.mod, 'leave song mode'); m.setSong(null, false); }
          await UI.aiPoint(m.ui.pbs[pi], a.mod, `${m.name}: switch to ${'ABCDEFGH'[pi]}`);
          m.queue(pi);
          A.log('act', `<b>switch</b> ${m.name} to pattern ${'ABCDEFGH'[pi]}${a.why ? ' · ' + esc(a.why) : ''}`);
          break;
        }
        case 'song': {
          const m = E.mods[a.mod]; if (!m?.pats) break;
          const chain = (a.chain || []).map(c => Array.isArray(c) ? { pat: patIx(c[0]), rep: +c[1] || 1 } : { pat: patIx(c.pat), rep: +c.rep || 1 }).filter(c => c.pat >= 0);
          await UI.aiPoint(m.ui.songBtn, a.mod, `${m.name}: write the song`);
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
          await UI.aiPoint(el.querySelector('.nm'), id, `add ${E.mods[id].name}`);
          A.log('act', `<b>add module</b> ${esc(E.mods[id].name)} (${id})${a.why ? ' · ' + esc(a.why) : ''}`);
          break;
        }
        case 'remove': {
          const m = E.mods[a.mod]; if (!m || ['clock', 'mixer', 'monitor'].includes(a.mod)) break;
          await UI.aiPoint(UI.modEls[a.mod].querySelector('.modx') || UI.modEls[a.mod], a.mod, `remove ${m.name}`);
          UI.removeModule(a.mod); A.log('act', `<b>remove module</b> ${esc(m.name)}${a.why ? ' · ' + esc(a.why) : ''}`);
          break;
        }
        case 'drums': {
          const m = E.mods.drums, r = m.INST.indexOf(String(a.inst).toUpperCase()); if (r < 0) break;
          const pat = String(a.pattern || '').padEnd(16, '.').slice(0, 16);
          const changed = []; for (let s = 0; s < 16; s++) { const v = pat[s] === 'X' ? 2 : (pat[s] === 'x' || pat[s] === 'o') ? 1 : 0; if (v !== m.pat[r][s]) changed.push([s, v]); }
          if (!changed.length) break;
          await UI.aiCells(changed.map(([s]) => m.ui.cells[r][s]), 'drums', `write ${a.inst} pattern`, i => { const [s, v] = changed[i]; m.pat[r][s] = v; m.ui.renderGrid(); });
          A.log('act', `<b>drums</b> ${esc(a.inst)} ${esc(pat)}${a.why ? ' · ' + esc(a.why) : ''}`);
          break;
        }
        case 'mute': {
          const m = E.mods.drums, r = m.INST.indexOf(String(a.inst).toUpperCase()); if (r < 0) break;
          if (m.mute[r] === !!a.on) break;
          await UI.aiPoint(m.ui.labels[r], 'drums', `${a.on ? 'mute' : 'unmute'} ${a.inst}`);
          m.mute[r] = !!a.on; m.ui.renderGrid();
          A.log('act', `<b>${a.on ? 'mute' : 'unmute'}</b> ${esc(a.inst)}${a.why ? ' · ' + esc(a.why) : ''}`);
          break;
        }
        case 'transport': {
          if (!!a.run === E.running) break;
          const btn = UI.modEls.clock.querySelector('button');
          await UI.aiPoint(btn, 'clock', a.run ? 'start the clock' : 'stop the clock');
          a.run ? E.start() : E.stop(); A.log('act', `<b>${a.run ? 'start' : 'stop'}</b> clock`); break;
        }
        case 'route': { // send a module's output into a free mixer channel (adds a mixer if every channel is taken)
          const port = a.port || 'OUT';
          const ex = E.cables.find(c => c.from.mod === a.mod && c.from.port === port && E.mods[c.to.mod]?.kind === 'Mixer');
          let mix, ch;
          if (ex) { mix = ex.to.mod; ch = +ex.to.port.slice(2); }
          else if (a.ch) { mix = 'mixer'; ch = a.ch; }
          else if (MIXCH[a.mod] && !E.findCable('mixer', 'IN' + MIXCH[a.mod])) { mix = 'mixer'; ch = MIXCH[a.mod]; }
          else { const f = freeSlot(); if (f) [mix, ch] = f; else { mix = await addMixer(); ch = 1; } }
          if (!mix) break;
          if (!ex) await run({ do: 'patch', from: `${a.mod}.${port}`, to: `${mix}.IN${ch}`, why: a.why || 'into the mix' });
          if (a.level != null) await run({ do: 'knob', mod: mix, key: 'l' + ch, to: a.level });
          if (a.send != null) await run({ do: 'knob', mod: mix, key: 's' + ch, to: a.send });
          break;
        }
        case 'wait': await UI.sleep((a.sec || 1) * 1000); break;
        default: A.log('err', `skipped unknown action "${esc(a.do)}"`);
      }
    } catch (e) { console.error(e); A.log('err', 'action failed: ' + esc(e.message)); }
  }
  A.run = run;
  function freeChannel() { for (let i = 1; i <= 8; i++) if (!E.findCable('mixer', 'IN' + i)) return i; return 8; }
  const patIx = v => typeof v === 'number' ? (v >= 0 && v < 8 ? v | 0 : -1) : 'ABCDEFGH'.indexOf(String(v || '').toUpperCase().trim());
  const kindIs = (id, ...k) => k.includes(E.mods[id]?.kind);
  const U_scroll = el => { if (UI.follow && el) el.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' }); };
  function freeSlot() {
    for (const id of E.order) if (kindIs(id, 'Mixer')) for (let i = 1; i <= 8; i++) if (!E.findCable(id, 'IN' + i)) return [id, i];
    return null;
  }
  async function addMixer() {
    const port = ['IN', 'IN2', 'IN3', 'IN4'].find(p => !E.findCable('monitor', p));
    if (!port) { A.log('err', 'every mixer channel and monitor input is taken'); return null; }
    const id = E.newId('mixer');
    await run({ do: 'add', type: 'Mixer', id, why: 'every channel is taken, so add another mixer' });
    await run({ do: 'patch', from: `${id}.OUT`, to: `monitor.${port}`, why: 'second mixer to the speakers' });
    return id;
  }
  async function runAll(list) { for (const a of list) { if (A.abort) return; await run(a); } }

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
    let genre = null;
    for (const [g, re] of Object.entries(GENRES)) if (re.test(task)) { genre = g; break; }
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
  function acidLine(p) {
    const pool = [0, 0, 0, 0, 7, 7, 2, 4, 6, 1, -3, 3];
    const notes = [], acc = [], sl = [];
    for (let i = 0; i < 16; i++) {
      const on = i === 0 || rnd() < 0.62 + p.tr.chaos * 0.2;
      notes.push(on ? pick(pool) : null);
      if (on && rnd() < 0.3 + p.tr.aggression * 0.2) acc.push(i);
      if (on && rnd() < 0.22) sl.push(i);
    }
    return { notes, accents: acc, slides: sl };
  }
  function bassLine(p, half) {
    const notes = Array(16).fill(null), sl = [], acc = [];
    const hits = half ? [0, 3, 6, 8, 10, 13] : [0, 2, 4, 7, 8, 10, 12, 14];
    hits.forEach((s, k) => { if (k === 0 || rnd() < 0.8) notes[s] = pick(k === 0 ? [0] : [0, 0, -2, 3, 5, -4, 7]); if (rnd() < 0.3) sl.push(s); if (rnd() < 0.3) acc.push(s); });
    return { notes, accents: acc, slides: sl };
  }
  function melody(p) {
    const notes = []; let d = pick([0, 2, 4]);
    for (let i = 0; i < 16; i++) { if (i % 2 === 1 && rnd() < 0.45) { notes.push(null); continue; } d = clamp(d + pick([-2, -1, 1, 2, 0, 3, -3]), -2, 11); notes.push(d); }
    return { notes, accents: [0, 8], slides: [] };
  }
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
    house: { BD: 'x...x...x...x...', CP: '....x.......x...', CH: 'x.x.x.x.x.x.x.x.', OH: '..X...X...X...X.', CB: '.......x......x.' }
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
        K('seq1', 'scale', pick(['PHRYG', 'MINOR', 'DORIAN'])), K('seq1', 'root', pick(['A', 'F', 'G', 'C', 'D#'])), K('seq1', 'oct', 2), K('seq1', 'len', 16), K('seq1', 'gate', 0.5),
        { do: 'steps', mod: 'seq1', ...line, why: 'squelchy 16th line with accents and slides' },
        K('acid', 'model', 'ACID'), K('acid', 'wave', agg(p) > 0.5 ? 'SQR' : 'SAW'), K('acid', 'cutoff', 0.3, 'start fairly closed so the sweeps have room'), K('acid', 'res', clamp(0.68 + agg(p) * 0.25)),
        K('acid', 'env', 0.6), K('acid', 'decay', 0.32), K('acid', 'accent', 0.75), K('acid', 'drive', clamp(0.2 + agg(p) * 0.7)), K('acid', 'sub', 0.0),
        { do: 'route', mod: 'acid', level: 0.72, send: 0.18 }];
    },
    titan(p, half, style) {
      const bl = bassLine(p, half);
      const growl = style !== 'reese';
      return [P('clock.CLK', 'seq2.CLK'), P('seq2.NOTE', 'titan.NOTE', 'second sequencer drives the wavetable bass'),
        K('seq2', 'scale', 'MINOR'), K('seq2', 'root', pick(['F', 'E', 'G', 'D'])), K('seq2', 'oct', 1), K('seq2', 'gate', 0.95), K('seq2', 'len', 16),
        { do: 'steps', mod: 'seq2', ...bl, why: half ? 'half-time bass hits with room for the wobble' : 'rolling bass line' },
        K('titan', 't1', growl ? pick(['GROWL', 'YOI', 'METAL']) : 'SAW→SQR'), K('titan', 't2', growl ? 'SYNC' : 'SUPER'),
        K('titan', 'uni', growl ? 0.3 : 0.8), K('titan', 'sub', 0.6), K('titan', 'cut', growl ? 0.35 : 0.3), K('titan', 'res', clamp(0.3 + agg(p) * 0.4)),
        K('titan', 'wrate', growl ? pick(['1/8', '1/8T', '1/4']) : '1/2'), K('titan', 'wcut', growl ? 0.7 : 0.3), K('titan', 'wpos', growl ? 0.6 : 0.2),
        K('titan', 'drive', clamp(0.35 + agg(p) * 0.6), 'drive it hard for that dubstep bite'), K('titan', 'level', 0.65),
        { do: 'route', mod: 'titan', level: 0.75, send: 0.05 }];
    },
    lead(p, model, seq = 'seq2') {
      const mel = melody(p);
      return [P('clock.CLK', seq + '.CLK'), P(seq + '.NOTE', 'lead.NOTE'), K(seq, 'scale', p.tr.dark > 0 ? 'MINOR' : pick(['MAJOR', 'DORIAN', 'PENT'])), K(seq, 'oct', 3), K(seq, 'gate', 0.7),
        { do: 'steps', mod: seq, ...mel, why: 'a melodic line for the lead voice' },
        K('lead', 'model', model), K('lead', 'cutoff', 0.55), K('lead', 'res', 0.3), K('lead', 'env', 0.35), K('lead', 'decay', 0.5), K('lead', 'detune', 0.4),
        { do: 'route', mod: 'lead', level: 0.6, send: 0.35 }];
    },
    pad(p) {
      return [P('clock.CLK', 'seq2.CLK'), P('seq2.NOTE', 'lead.NOTE'), K('seq2', 'div', '1/4'), K('seq2', 'scale', 'DORIAN'), K('seq2', 'oct', 2), K('seq2', 'gate', 1),
        { do: 'steps', mod: 'seq2', notes: [0, 2, 4, null, 3, null, 5, 4, 0, null, 2, 6, 4, null, 1, null], accents: [], slides: [2, 6, 10] },
        K('lead', 'model', 'JOVE'), K('lead', 'glide', 0.4), K('lead', 'cutoff', 0.42), K('lead', 'res', 0.2), K('lead', 'env', 0.2), K('lead', 'decay', 0.9), K('lead', 'detune', 0.7),
        { do: 'route', mod: 'lead', level: 0.6, send: 0.6 }];
    },
    chip(p) {
      const mel = melody(p);
      return [P('clock.CLK', 'seq1.CLK'), P('seq1.NOTE', 'chip.NOTE'), K('seq1', 'scale', 'MAJOR'), K('seq1', 'oct', 3), K('seq1', 'gate', 0.6),
        { do: 'steps', mod: 'seq1', ...mel, why: 'a game-tune melody' },
        K('chip', 'wave', pick(['P25', 'P12'])), K('chip', 'arp', pick(['MAJ', 'OFF', 'OCT'])), K('chip', 'vib', 0.25), K('chip', 'crush', 4), K('chip', 'oct', 0),
        { do: 'route', mod: 'chip', level: 0.6, send: 0.15 }];
    },
    bodies(p, model, div = 2) {
      return [P('clock.CLK', 'ent.CLK'), P('ent.NOTE', 'bodies.NOTE', 'noise sequencer strikes the physical model'), K('ent', 'div', div), K('ent', 'dens', clamp(0.4 + cha(p) * 0.3)), K('ent', 'lock', clamp(0.75 - cha(p) * 0.5)),
        K('ent', 'scale', 'PENT'), K('bodies', 'model', model), K('bodies', 'decay', 0.55), K('bodies', 'bright', 0.6),
        { do: 'route', mod: 'bodies', level: 0.5, send: 0.5 }];
    },
    geiger(p) {
      return [K('geiger', 'src', cha(p) > 0.5 ? 'TRINITITE' : 'U-GLASS', 'pick a hotter source'), K('geiger', 'burst', clamp(0.2 + cha(p) * 0.6)),
        P('geiger.AUDIO', 'fold.IN', 'radiation clicks into the wavefolder'), K('fold', 'fold', clamp(0.35 + agg(p) * 0.5)), P('fold.OUT', 'vcfq.IN'),
        P('slope.OUT', 'vcfq.CV', 'slow slope sweeps the resonant filter'), K('slope', 'cycle', 'ON'), K('slope', 'rise', 0.55), K('slope', 'fall', 0.6),
        K('vcfq', 'mode', 'BP'), K('vcfq', 'q', 0.7), { do: 'route', mod: 'vcfq', level: 0.45, send: 0.3 }];
    },
    geigerDrums() { return [P('geiger.TRIG', 'drums.TRIG', 'random decays fire extra drum hits'), K('drums', 'trigv', pick(['RS', 'CP', 'CB', 'SD']))]; },
    slopeTo(dest) { return [K('slope', 'cycle', 'ON'), K('slope', 'rise', 0.62), K('slope', 'fall', 0.68), K('slope', 'level', 0.75), P('slope.OUT', dest, 'slow slope modulates the filter')]; }
  };

  const RECIPES = {
    acid: p => ({ bpm: 128 + Math.round(rnd() * 8), kit: '909', acts: [...L.drums(p, 'acid', '909'), ...L.acid(p), ...(cha(p) > 0.45 || agg(p) > 0.6 ? L.geiger(p) : []), ...(p.mode === 'perform' ? L.slopeTo('acid.CUT') : [])] }),
    dubstep: p => ({ bpm: 140, acts: [...L.drums(p, 'half', '909'), ...L.titan(p, true), ...(cha(p) > 0.45 ? [...L.geiger(p), ...L.geigerDrums()] : [])] }),
    dnb: p => ({ bpm: 172, acts: [...L.drums(p, 'dnb', '909'), ...L.titan(p, false, 'reese'), ...L.bodies(p, 'GLASS', 4)] }),
    techno: p => ({ bpm: 130, acts: [...L.drums(p, 'techno', '909'), ...L.acid(p), K('acid', 'model', 'LADDER'), K('acid', 'decay', 0.2), ...L.bodies(p, 'MEMBRANE', 1), ...L.slopeTo('acid.CUT')] }),
    house: p => ({ bpm: 124, acts: [...L.drums(p, 'house', '909'), ...L.lead(p, 'JOVE'), ...L.acid(p), K('acid', 'model', 'LADDER'), K('acid', 'res', 0.3)] }),
    chip: p => ({ bpm: 150, acts: [...L.drums(p, 'chip', 'LOFI'), ...L.chip(p), ...L.lead(p, 'SEM'), K('seq2', 'oct', 1)] }),
    ambient: p => ({ bpm: 84, acts: [...L.drums(p, 'sparse', '808'), K('mixer', 'l2', 0.35), ...L.pad(p), ...L.bodies(p, 'BELL', 4), ...L.slopeTo('lead.CUT'), K('mixer', 'verb', 0.75), K('mixer', 'dfb', 0.6)] }),
    noise: p => ({ bpm: 145, acts: [...L.drums(p, 'noise', 'DIRT'), ...L.geiger(p), ...L.geigerDrums(), ...L.titan(p, true), K('titan', 't1', 'METAL'), P('ent.CV', 'titan.CUT', 'random voltages tear at the bass filter'), P('clock.CLK', 'ent.CLK')] }),
    trap: p => ({ bpm: 140, acts: [...L.drums(p, 'trap', '808'), K('drums', 'decay', 0.9), K('drums', 'tune', 0.35), ...L.lead(p, 'PROPHECY')] }),
    experimental: p => ({ bpm: 100, acts: [...L.bodies(p, 'STRING', 1), ...L.geiger(p), P('geiger.TRIG', 'slope.TRIG'), K('slope', 'cycle', 'OFF'), P('ent.CV', 'fold.FOLD', 'noise CV animates the folds'), ...L.chip(p), K('chip', 'wave', 'METAL'), K('mixer', 'l5', 0.35)] })
  };

  // ======================= SOUND-SHAPING MOVES (the learning part) =======================
  const routed = id => E.cables.some(c => c.from.mod === id && E.mods[c.to.mod]?.kind === 'Mixer');
  const CUTKEY = { Analog: 'cutoff', Titan: 'cut', VCFQ: 'freq' };
  const voiceCut = () => E.order.filter(id => CUTKEY[E.mods[id].kind] && routed(id)).map(id => [id, CUTKEY[E.mods[id].kind]]);
  const activeSeqs = () => E.order.filter(id => kindIs(id, 'StepSeq') && E.cablesFrom(id, 'NOTE').length);
  const VOICE_KINDS = ['Analog', 'Titan', 'Chip', 'Bodies', 'VCFQ'];
  const CORE_IDS = ['seq1', 'seq2', 'ent', 'drums', 'acid', 'lead', 'geiger', 'titan', 'chip', 'bodies', 'slope', 'fold', 'vcfq'];

  // ----- pattern variations and songs -----
  function variation(notes, kind) {
    const n = notes.slice(), rats = Array(16).fill(1), probs = Array(16).fill(1);
    if (kind === 'B') { for (let k = 0; k < 3; k++) { const j = Math.floor(rnd() * 16); n[j] = rnd() < 0.2 ? null : pick([0, 2, 3, 4, 5, 7, -2]); } if (rnd() < 0.5) rats[15] = 2; }
    if (kind === 'C') for (let i = 0; i < 16; i++) if (i % 4 !== 0) n[i] = null;
    if (kind === 'D') { for (let i = 12; i < 16; i++) { if (n[i] == null) n[i] = pick([0, 3, 7]); rats[i] = pick([2, 3, 4]); } for (let i = 0; i < 12; i++) if (n[i] != null && rnd() < 0.3) probs[i] = 0.6; }
    return { notes: n, ratchets: rats, probs };
  }
  // Write patterns B (variation), C (sparse) and D (fill) from A, then chain them into a song
  function songify(seq, base, songOn, why) {
    const acts = [];
    for (const k of ['B', 'C', 'D']) acts.push({ do: 'pattern', mod: seq, pat: k, ...variation(base.notes, k), accents: base.accents || [], slides: k === 'C' ? [] : base.slides || [], why: { B: 'variation', C: 'stripped-back version for breaks', D: 'fill with ratchets' }[k] });
    acts.push({ do: 'song', mod: seq, chain: [['A', 4], ['B', 4], ['A', 4], ['C', 2], ['D', 1], ['B', 4], ['C', 2]], on: songOn, why: songOn ? 'arrange the patterns into a song' : 'song written, I will switch patterns by hand during the set' });
    return acts;
  }
  const LAYERS = {
    acid: ['Analog:LADDER', 'Bodies', 'Chip', 'Analog:SCREAM'], dubstep: ['Chip', 'Analog:SCREAM', 'Bodies'], dnb: ['Analog:JOVE', 'Bodies', 'Chip'],
    ambient: ['Bodies', 'Analog:JOVE', 'Bodies'], chip: ['Chip', 'Analog:ODYSSEY', 'Chip'], noise: ['Analog:SCREAM', 'Bodies', 'Titan'],
    experimental: ['Bodies', 'Chip', 'Analog:PROPHECY'], default: ['Analog:PROPHECY', 'Bodies', 'Chip', 'Analog:SEM']
  };
  // A brand-new layer: add a sequencer and a voice module, patch them, write patterns and a song
  function newLayer(p, reserved, songOn) {
    const spec = pick(LAYERS[p.genre] || LAYERS.default), [type, model] = spec.split(':');
    const seq = E.newId('seq', reserved); reserved.add(seq);
    const vid = E.newId(type === 'Analog' ? 'voice' : Mods.TYPES[type].prefix, reserved); reserved.add(vid);
    const ref = E.mods.seq1, low = type === 'Titan' || (type === 'Analog' && rnd() < 0.5);
    const base = type === 'Bodies' || type === 'Chip' ? melody(p) : low ? bassLine(p, p.genre === 'dubstep') : melody(p);
    const acts = [{ do: 'say', text: `Adding a new layer: a sequencer driving a ${type === 'Analog' ? model + ' analog voice' : Mods.TYPES[type].label}.` },
      { do: 'add', type: 'StepSeq', id: seq, why: 'a new sequencer for the new layer' },
      { do: 'add', type, id: vid, model, why: 'a new voice for more depth' },
      P('clock.CLK', `${seq}.CLK`), P(`${seq}.NOTE`, `${vid}.NOTE`),
      K(seq, 'scale', ref.params.scale.choice), K(seq, 'root', ref.params.root.choice), K(seq, 'oct', low ? 1 : 3), K(seq, 'gate', low ? 0.8 : 0.5),
      { do: 'pattern', mod: seq, pat: 'A', ...base, why: 'main pattern for the new layer' },
      ...songify(seq, base, songOn),
      { do: 'route', mod: vid, level: low ? 0.55 : 0.45, send: low ? 0.1 : 0.4 }];
    if (type === 'Analog') acts.push(K(vid, 'cutoff', 0.45), K(vid, 'res', 0.35 + p.tr.aggression * 0.3));
    if (type === 'Bodies') acts.push(K(vid, 'model', pick(['BELL', 'MARIMBA', 'GLASS', 'STRING'])));
    if (type === 'Chip') acts.push(K(vid, 'arp', pick(['MAJ', 'MIN', 'OCT', 'OFF'])));
    return acts;
  }
  A.newLayer = newLayer;
  const nudge = (mod, key, d, why, ms) => { const p = E.mods[mod].params[key]; return K(mod, key, clamp(p.n + d), why, ms); };
  const drumsOn = () => routed('drums');
  const MOVES = {
    'open filter': { fx: { energy: 0.5, bright: 1 }, ok: () => voiceCut().length, make: () => { const [m, k] = pick(voiceCut()); return [nudge(m, k, 0.08 + rnd() * 0.2, 'wants more brightness', 1500 + rnd() * 2500)]; } },
    'close filter': { fx: { energy: -0.4, bright: -1 }, ok: () => voiceCut().some(([m, k]) => E.mods[m].params[k].n > 0.27), make: () => { const [m, k] = pick(voiceCut().filter(([m, k]) => E.mods[m].params[k].n > 0.27)); const p = E.mods[m].params[k]; return [K(m, k, Math.max(0.24, p.n - (0.08 + rnd() * 0.2)), 'too bright, pulling it back', 1500 + rnd() * 2000)]; } },
    'more resonance': { fx: { energy: 0.3, bright: 0.3, chaos: 0.3 }, ok: () => routed('acid') || routed('titan'), make: () => routed('acid') ? [nudge('acid', 'res', 0.12, 'more squelch')] : [nudge('titan', 'res', 0.12)] },
    'less resonance': { fx: { energy: -0.2, bright: -0.2 }, ok: () => routed('acid') || routed('titan'), make: () => routed('acid') ? [nudge('acid', 'res', -0.12)] : [nudge('titan', 'res', -0.12)] },
    'more drive': { fx: { energy: 0.6, bright: 0.4, chaos: 0.2 }, ok: () => routed('acid') || routed('titan') || drumsOn(), make: () => { const o = [routed('acid') && ['acid', 'drive'], routed('titan') && ['titan', 'drive'], drumsOn() && ['drums', 'drive']].filter(Boolean); const [m, k] = pick(o); return [nudge(m, k, 0.15, 'needs more bite')]; } },
    'less drive': { fx: { energy: -0.5, bright: -0.3 }, ok: () => routed('acid') || routed('titan') || drumsOn(), make: () => { const o = [routed('acid') && ['acid', 'drive'], routed('titan') && ['titan', 'drive'], drumsOn() && ['drums', 'drive']].filter(Boolean); const [m, k] = pick(o); return [nudge(m, k, -0.15)]; } },
    'thicken drums': { fx: { energy: 0.6, motion: 1 }, ok: drumsOn, make: () => { const ins = pick(['CH', 'RS', 'CP', 'OH', 'SD', 'LT', 'CB']); const r = E.mods.drums.INST.indexOf(ins); const cur = E.mods.drums.pat[r].map(v => v === 2 ? 'X' : v ? 'x' : '.').join(''); return [{ do: 'drums', inst: ins, pattern: cur.split('').map(c => c === '.' && rnd() < 0.25 ? 'x' : c).join(''), why: 'busier groove' }]; } },
    'thin drums': { fx: { energy: -0.5, motion: -1 }, ok: drumsOn, make: () => { const ins = pick(['CH', 'RS', 'CP', 'OH', 'SD', 'LT', 'CB']); const r = E.mods.drums.INST.indexOf(ins); const cur = E.mods.drums.pat[r].map(v => v === 2 ? 'X' : v ? 'x' : '.').join(''); return [{ do: 'drums', inst: ins, pattern: cur.split('').map(c => c !== '.' && rnd() < 0.4 ? '.' : c).join(''), why: 'leave some space' }]; } },
    'drop kick': { fx: { energy: -0.9 }, ok: () => drumsOn() && !E.mods.drums.mute[0], make: () => [{ do: 'mute', inst: 'BD', on: true, why: 'pull the kick for tension' }] },
    'bring kick': { fx: { energy: 0.9 }, ok: () => drumsOn() && E.mods.drums.mute[0], make: () => [{ do: 'mute', inst: 'BD', on: false, why: 'kick back in' }] },
    'mutate sequence': { fx: { novelty: 1, chaos: 0.3 }, ok: () => activeSeqs().length, make: () => {
      const id = pick(activeSeqs()), m = E.mods[id];
      const notes = m.steps.map(s => s.g ? s.n : null), k = 1 + Math.floor(rnd() * 3), acc = [], sl = [];
      for (let i = 0; i < k; i++) { const j = Math.floor(rnd() * 16); notes[j] = rnd() < 0.25 ? null : pick([0, 0, 2, 3, 4, 7, -3, 5]); }
      m.steps.forEach((s, i) => { if (s.a) acc.push(i); if (s.s) sl.push(i); });
      if (rnd() < 0.5) acc.push(Math.floor(rnd() * 16)); if (rnd() < 0.4) sl.push(Math.floor(rnd() * 16));
      return [{ do: 'steps', mod: id, notes, accents: acc, slides: sl, why: 'evolve the line' }];
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
      const options = [!routed('bodies') && 'bodies', !routed('chip') && 'chip', !routed('vcfq') && 'vcfq', !routed('lead') && !E.cablesFrom('seq2').length && 'lead'].filter(Boolean);
      const m = pick(options); if (!m) return [];
      if (m === 'bodies') return L.bodies(A.prof, pick(['BELL', 'MARIMBA', 'GLASS', 'STRING']), pick([1, 2, 4]));
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
      return [{ do: 'pattern', mod: id, pat: slot, ...v, accents: m.pats[m.cur].map((s, i) => s.a ? i : -1).filter(i => i >= 0), why: 'write a new variation' }, { do: 'select', mod: id, pat: slot }];
    } },
    'add layer': { fx: { energy: 0.6, novelty: 1.3 }, ok: () => E.order.length <= 26 && performance.now() - (A.lastAdd || 0) > 45000, make: () => { A.lastAdd = performance.now(); return newLayer(A.prof, new Set(CORE_IDS), rnd() < 0.5); } },
    'delay throw': { fx: { novelty: 0.7, motion: 0.4 }, ok: () => true, make: () => [K('mixer', 'dfb', 0.7 + rnd() * 0.15, 'dub delay throw', 700), { do: 'wait', sec: 2 }, K('mixer', 'dfb', 0.35, null, 1200)] },
    'reverb wash': { fx: { energy: -0.3, bright: -0.2, novelty: 0.4 }, ok: () => true, make: () => [nudge('mixer', 'verb', 0.2, 'open up the space', 2000)] },
    'dry up': { fx: { energy: 0.2, bright: 0.1 }, ok: () => E.mods.mixer.v('verb') > 0.25, make: () => [nudge('mixer', 'verb', -0.2, 'tighten the space')] },
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
    const want = { energy: target.energy - ears.energy, bright: target.bright - ears.bright, loud: (target.loud - ears.rms) / 12, bored: Math.min(1.2, (performance.now() - (A.lastNovel || 0)) / 40000) };
    const cands = Object.entries(MOVES).filter(([, mv]) => { try { return mv.ok(); } catch (e) { return false; } });
    if (!cands.length) return;
    cands.sort((a, b) => score(b[0], b[1], want) - score(a[0], a[1], want));
    const [name, mv] = cands[0];
    const e0 = errNow();
    A.log('ear', `hears energy ${Math.round(ears.energy * 100)}% (want ${Math.round(target.energy * 100)}), brightness ${Math.round(ears.cent)}Hz → chooses <b>${name}</b>${reason ? ' · ' + esc(reason) : ''}`);
    A.think(A.stateName || 'Performing', `Energy ${Math.round(ears.energy * 100)}% vs target ${Math.round(target.energy * 100)}%. Brightness ${Math.round(ears.bright * 100)}% vs ${Math.round(target.bright * 100)}%. Trying "${name}".`);
    await runAll(mv.make());
    if (mv.fx.novelty) A.lastNovel = performance.now();
    A.lastMove = name;
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
    drop: () => [...secPat('B', 'drop pattern'), { do: 'mute', inst: 'BD', on: false, why: 'here comes the drop' }, { do: 'mute', inst: 'SD', on: false }, { do: 'mute', inst: 'CP', on: false }, ...voiceCut().map(([m, k]) => nudge(m, k, 0.25, 'open up', 900)), K('mixer', 'master', 0.85)],
    break: () => [...secPat('C', 'break pattern'), { do: 'mute', inst: 'BD', on: true, why: 'breakdown' }, nudge('mixer', 'verb', 0.25, 'wash it out', 2500)],
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
{"do":"say","text":"short first-person narration of your intent"}

ADDABLE MODULE TYPES: ${Object.entries(Mods.TYPES).map(([k, t]) => `${k} (${t.label}, ids like ${t.prefix}3)`).join('; ')}. You may add as many as the music needs (rack limit 32 modules). A new voice needs a sequencer (or ent/geiger) feeding its NOTE input and a "route" to be heard; "route" finds a free mixer channel and adds a mixer when all are taken.

Reply with JSON only:
{"summary":"one sentence","targets":{"energy":0-1,"brightness":0-1},
 "design":[30-70 actions that build the patch from the current state, starting with a say, ending with transport run true],
 "sections":${p.mode === 'perform' ? '[5-9 sections, each {"name":"...","fraction":share of the set,"energy":0-1,"actions":[3-10 actions fired when the section starts]}]' : '[]'}}
Build complex, layered patches: add extra sequencers and voices when they serve the music, give sequencers several patterns and a song. Make it musical and true to the personality. Use the modules the task and personality call for.`;
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
    A.startT = performance.now(); A.endT = A.startT + Math.max(p.dur, 60) * 1000; A.sections = null; drawTimeline();
    A.stateName = 'Reading the brief';
    A.log('sys', `<b>${esc(task)}</b> — as: ${esc(persona)}`);
    const traits = Object.entries(p.tr).map(([k, v]) => `${k} ${Math.round(v * 100)}%`).join(', ');
    A.think('Reading the brief', `Heard: ${p.genre} · ${p.mode}${p.dur ? ' · ' + fmtT(p.dur) : ''}. Personality: ${traits}.`);
    A.log('sys', `interpreted as <b>${p.genre}</b> ${p.mode}${p.dur ? ' for ' + fmtT(p.dur) : ''}; personality ${traits}`);
    await UI.sleep(900);
    target.bright = clamp({ ambient: 0.35, dubstep: 0.45, noise: 0.75, chip: 0.7, acid: 0.55 }[p.genre] ?? 0.55) - p.tr.dark * 0.5 + p.tr.aggression * 0.1;
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
        const r = (RECIPES[p.genre] || RECIPES.techno)(p); acts = r.acts; bpm = r.bpm + Math.round(p.tr.aggression * 6 - p.tr.calm * 10);
        // every main sequencer gets B/C/D patterns and a song; song mode plays it for designs, the performer switches by hand in a set
        const songOn = p.mode !== 'perform';
        const extra = [];
        acts.filter(a => a.do === 'steps').forEach(a => { a.do = 'pattern'; a.pat = 'A'; extra.push(...songify(a.mod, a, songOn)); });
        acts = acts.concat(extra);
        const reserved = new Set(CORE_IDS);
        for (let i = 0; i < p.complex; i++) acts = acts.concat(newLayer(p, reserved, songOn || p.songWanted));
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
      if (bpm) await run(K('clock', 'bpm', clamp((bpm - 60) / 140), `${bpm} BPM suits ${p.genre}`));
      A.think(A.stateName, plan ? plan.summary || 'Following Claude\'s plan.' : `Building a ${p.genre} patch shaped by the personality.`);
      if (!plan) await run({ do: 'transport', run: true });
      await runAll(acts);
      if (!E.running) await run({ do: 'transport', run: true });
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
      if (/bell|string|marimba|physical/i.test(t)) await runAll(L.bodies(p, /string/i.test(t) ? 'STRING' : /marimba/i.test(t) ? 'MARIMBA' : 'BELL'));
      if (/wobble|dubstep|bass/i.test(t) && !routed('titan')) await runAll(L.titan(p, true));
      if (/acid|303/i.test(t) && !routed('acid')) await runAll(L.acid(p));
      if (!E.running) await run({ do: 'transport', run: true });
    }
    if (A.abort) return finish();

    if (p.mode === 'perform') {
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
      for (let i = 0; i < n && !A.abort; i++) { await shapeOnce(i === 0 ? 'first listen' : null); await UI.sleep(800); }
      if (!A.abort) { A.think('Patch ready', `Done. The ${p.genre} patch keeps playing. Ask for changes like "make it darker" or "add the geiger counter", or run a live set.`); A.log('sys', 'patch ready'); }
    }
    finish();
  };
  function finish() {
    if (A.abort) { A.think('Stopped', 'You stopped the AI. The patch keeps playing as it is.'); A.log('sys', 'stopped by you'); }
    A.sections = A.sections && !A.abort ? A.sections : A.sections; setBusy(false);
  }
  A.stop = () => { A.abort = true; };
  A.parseBrief = parseBrief;
  return A;
})();
