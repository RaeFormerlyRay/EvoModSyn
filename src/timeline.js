// timeline.js — a DAW-style timeline. Record captures every knob turn, cable, module and pattern change (yours and the AI's),
// plays it back visibly, and lets you edit it: drag automation points and events, add actions, and drop in audio clips.
'use strict';
const TL = (() => {
  const E = Engine, ctx = E.ctx, clamp = DSP.clamp, $ = s => document.querySelector(s);
  const h = UI.h;
  const T = {
    events: [], clips: [], bufs: new Map(), snapshot: null,
    pos: 0, playing: false, recording: false, loop: false, loopA: 0, loopB: 0, snap: true, follow: true,
    pps: 36, scrollX: 0, sel: new Set(), fold: new Set(), seen: new Set(), applying: false, tracks: 4
  };
  const C = { marker: '#ffb03b', ai: '#52f2ff', you: '#ffb03b', grid: '#ffffff10', bar: '#ffffff26', ink: '#e6e3da', dim: '#9a9a94', faint: '#62656b' };
  const LANE_H = { marker: 22, global: 24, events: 26, param: 36, audio: 58 };
  const HEAD_W = 176;
  const uid = () => Math.random().toString(36).slice(2, 9);
  const fmtT = s => { s = Math.max(0, s); const m = Math.floor(s / 60); return m + ':' + (s % 60).toFixed(1).padStart(4, '0'); };
  const beatLen = () => 60 / E.bpm;
  const fmtBar = s => { const b = Math.max(0, s) / beatLen(); return `${Math.floor(b / 4) + 1}.${Math.floor(b % 4) + 1}.${Math.floor((b * 4) % 4) + 1}`; };
  const snapT = t => T.snap ? Math.round(t / (beatLen() / 4)) * (beatLen() / 4) : t;
  const srcNow = () => (AI.busy && performance.now() - (T.userTouch || 0) > 400) ? 'ai' : 'you';
  const sortEv = () => T.events.sort((a, b) => a.t - b.t);
  const modName = id => E.mods[id]?.name || id;

  // ======================= TAPE: the rack module the audio clips play through =======================
  function Tape(id) {
    const m = new E.Module(id, { name: 'Tape', sub: 'timeline audio clips · 4 tracks', width: 230, stripe: '#e8453c', family: 'mix' });
    const mix = ctx.createGain(); mix.gain.value = 0.9;
    m.tracks = [1, 2, 3, 4].map(i => { const g = ctx.createGain(); g.connect(mix); m.outAudio('T' + i, g, 'track ' + i); m.p('l' + i, { label: 'Trk ' + i, def: 0.8, small: true, fmt: v => Math.round(v * 100) + '%', apply: v => { g.gain.setTargetAtTime(v * 1.1, ctx.currentTime, 0.02); } }); return g; });
    m.p('level', { label: 'Level', def: 0.85, small: true, fmt: v => Math.round(v * 100) + '%', apply: v => { mix.gain.setTargetAtTime(v, ctx.currentTime, 0.02); } });
    m.outAudio('OUT', mix, 'all tracks');
    m.layout = [{ custom: 'tape' }, { k: ['l1', 'l2', 'l3', 'l4', 'level'], cls: 'kgrid' }];
    return m;
  }
  Mods.TYPES.Tape = { label: 'Tape (timeline audio clips)', desc: 'plays the timeline audio clips; T1-T4 per track, OUT mix', prefix: 'tape', make: id => Tape(id) };
  UI.customs.tape = (m, el) => {
    const lcd = h('div', 'lcd'), reels = h('div', 'reels', '<i></i><i></i>');
    el.append(reels, lcd);
    const upd = () => { lcd.textContent = `${T.clips.length} clip${T.clips.length === 1 ? '' : 's'} · ${T.playing ? (T.recording ? 'REC ' : 'PLAY ') : 'STOP '}${fmtT(T.pos)}`; reels.classList.toggle('spin', T.playing); };
    UI.anim(upd);
  };
  function ensureTape() {
    if (E.mods.tape) return 'tape';
    const id = UI.createModule('Tape', { id: 'tape' });
    // plug it into a free mixer channel, or straight into the monitor
    let done = false;
    for (const mid of E.order) { if (E.mods[mid].kind !== 'Mixer') continue; for (let i = 8; i >= 1 && !done; i--) if (!E.findCable(mid, 'IN' + i)) { E.connect({ mod: id, port: 'OUT' }, { mod: mid, port: 'IN' + i }); done = true; } if (done) break; }
    if (!done) for (const p of ['IN2', 'IN3', 'IN4']) if (!E.findCable('monitor', p)) { E.connect({ mod: id, port: 'OUT' }, { mod: 'monitor', port: p }); break; }
    return id;
  }

  // ======================= CAPTURE =======================
  const P = E.Param.prototype, origSet = P.setNorm;
  P.setNorm = function (n, silent) { const b = this.n; origSet.call(this, n, silent); if (this.n !== b) E.fire('param', this); };
  const lastPt = {};
  E.on('param', p => {
    if (!T.recording || T.applying || !p.mod || !E.mods[p.mod.id]) return;
    const t = T.pos, k = p.mod.id + '.' + p.key, src = srcNow(), last = lastPt[k];
    if (last && T.events.includes(last) && t - last.t < 0.04 && last.t <= t) { last.n = p.n; return; }
    const ev = { id: uid(), t, kind: 'param', mod: p.mod.id, key: p.key, n: p.n, ramp: false, src };
    T.events.push(ev); lastPt[k] = ev; dirty();
  });
  E.on('change', ev => {
    if (!T.recording || T.applying) return;
    const c = ev.cable;
    T.events.push({ id: uid(), t: T.pos, kind: 'cable', op: ev.type, mod: c.to.mod, from: { ...c.from }, to: { ...c.to }, src: ev.ai ? 'ai' : srcNow() });
    dirty();
  });
  const optsOf = m => ({ name: m.name.replace(/ \d+$/, ''), stripe: m.stripe, model: m.params.model?.choice });
  E.on('modules', ev => {
    if (!T.recording || T.applying) return;
    if (ev.type === 'add') { const m = E.mods[ev.id]; T.events.push({ id: uid(), t: T.pos, kind: 'module', op: 'add', mod: ev.id, type: m.kind, opts: optsOf(m), src: srcNow() }); }
    else T.events.push({ id: uid(), t: T.pos, kind: 'module', op: 'remove', mod: ev.id, src: srcNow() });
    dirty();
  });
  E.on('transport', r => { if (T.recording && !T.applying) { T.events.push({ id: uid(), t: T.pos, kind: 'transport', run: r, src: srcNow() }); dirty(); } });
  // patterns, drum grids and song chains: compare snapshots a few times a second
  const dataOf = m => m.kind === 'StepSeq' ? { pats: m.pats, cur: m.cur, song: m.song, songOn: m.songOn } : m.kind === 'Drums' ? { pats: m.pats, cur: m.cur, song: m.song, songOn: m.songOn, mute: m.mute } : null;
  const lastData = {}, lastDataEv = {};
  setInterval(() => {
    if (!T.recording) return;
    for (const id of E.order) {
      const d = dataOf(E.mods[id]); if (!d) continue;
      const s = JSON.stringify(d);
      if (lastData[id] !== s) { const first = lastData[id] == null; lastData[id] = s; if (!first && !T.applying) { const prev = lastDataEv[id]; if (prev && T.events.includes(prev) && T.pos - prev.t < 1.2) prev.data = JSON.parse(s); else { lastDataEv[id] = { id: uid(), t: T.pos, kind: 'data', mod: id, data: JSON.parse(s), src: srcNow() }; T.events.push(lastDataEv[id]); } dirty(); } }
    }
  }, 180);
  const origLog = AI.log;
  AI.log = (cls, html) => {
    origLog(cls, html);
    if (T.recording && cls === 'sys') { const txt = String(html).replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim(); if (txt) { T.events.push({ id: uid(), t: T.pos, kind: 'marker', text: txt.slice(0, 80), src: 'ai' }); dirty(); } }
  };

  // ======================= SNAPSHOT / RESTORE =======================
  const FIXED = new Set(['clock', 'mixer', 'monitor']);
  function snapshot() {
    return {
      modules: E.order.map(id => ({ id, type: E.mods[id].kind, opts: optsOf(E.mods[id]) })),
      params: Object.fromEntries(E.order.map(id => [id, Object.fromEntries(E.mods[id].paramOrder.map(k => [k, E.mods[id].params[k].n]))])),
      cables: E.cables.map(c => ({ from: { ...c.from }, to: { ...c.to }, color: c.color })),
      data: Object.fromEntries(E.order.map(id => [id, dataOf(E.mods[id])]).filter(x => x[1]).map(([k, v]) => [k, JSON.parse(JSON.stringify(v))])),
      running: E.running
    };
  }
  function setData(id, d) {
    const m = E.mods[id]; if (!m || !d) return;
    const c = JSON.parse(JSON.stringify(d));
    if (m.kind === 'StepSeq') { m.pats = c.pats; m.cur = c.cur; m.song = c.song; m.songOn = c.songOn; m.next = null; m.ui?.renderAll(); }
    if (m.kind === 'Drums') { if (c.pats) { m.pats = c.pats; m.cur = c.cur ?? 0; m.song = c.song || m.song; m.songOn = !!c.songOn; } else if (c.pat) m.pat = c.pat; m.mute = c.mute; m.ui?.renderGrid(); }
    lastData[id] = JSON.stringify(dataOf(m));
  }
  function addMod(id, type, opts = {}) { if (E.mods[id] || !Mods.TYPES[type]) return; UI.createModule(type, { id, ...opts }); }
  function restore(s) {
    T.applying = true;
    try {
      const want = new Set(s.modules.map(m => m.id));
      for (const id of [...E.order]) if (!want.has(id) && !FIXED.has(id) && id !== 'tape') UI.removeModule(id);
      for (const m of s.modules) if (!E.mods[m.id]) addMod(m.id, m.type, m.opts);
      for (const [id, ps] of Object.entries(s.params)) { const m = E.mods[id]; if (!m) continue; for (const [k, n] of Object.entries(ps)) m.params[k]?.setNorm(n); }
      const tapeCables = E.cables.filter(c => c.from.mod === 'tape');
      E.clearCables();
      for (const c of s.cables) E.connect(c.from, c.to, { color: c.color });
      for (const c of tapeCables) if (!E.findCable(c.to.mod, c.to.port)) E.connect(c.from, c.to, { color: c.color });
      for (const [id, d] of Object.entries(s.data)) setData(id, d);
      if (s.running) { E.stop(); E.start(); } else E.stop();
    } finally { T.applying = false; }
  }

  // ======================= PLAYBACK =======================
  const glowKnob = (id, key) => { const el = UI.knobs[id + '.' + key]; if (!el) return; el.classList.add('ai'); clearTimeout(el._tlg); el._tlg = setTimeout(() => el.classList.remove('ai'), 600); };
  function applyEvent(ev) {
    T.applying = true;
    try {
      if (ev.kind === 'param') { const p = E.mods[ev.mod]?.params[ev.key]; if (p) { p.setNorm(ev.n); glowKnob(ev.mod, ev.key); } }
      else if (ev.kind === 'cable') {
        if (ev.op === 'connect') { if (E.mods[ev.from.mod] && E.mods[ev.to.mod]) E.connect(ev.from, ev.to, { ai: true }); }
        else { const c = E.findCable(ev.to.mod, ev.to.port); if (c) E.disconnect(c, { ai: true }); }
      } else if (ev.kind === 'module') { if (ev.op === 'add') addMod(ev.mod, ev.type, ev.opts); else if (!FIXED.has(ev.mod)) UI.removeModule(ev.mod); }
      else if (ev.kind === 'data') setData(ev.mod, ev.data);
      else if (ev.kind === 'transport') { ev.run ? E.start() : E.stop(); }
      else if (ev.kind === 'marker') { AI.think('Timeline', ev.text); }
    } catch (e) { console.error(e); } finally { T.applying = false; }
  }
  // automation lanes: value at time t (points hold, or ramp into a point marked ramp)
  function lanePoints(mod, key) { return T.events.filter(e => e.kind === 'param' && e.mod === mod && e.key === key); }
  function valueAt(pts, t) {
    let i = -1; for (let k = 0; k < pts.length; k++) { if (pts[k].t <= t) i = k; else break; }
    if (i < 0) return null;
    const a = pts[i], b = pts[i + 1];
    if (b && b.ramp) return a.n + (b.n - a.n) * clamp((t - a.t) / Math.max(1e-6, b.t - a.t));
    return a.n;
  }
  let lastTick = 0, playSrcs = [];
  function scheduleClips() {
    playSrcs.forEach(s => { try { s.stop(); } catch (e) { /* done */ } }); playSrcs = [];
    if (!T.playing || !T.clips.length) return;
    const tape = E.mods.tape; if (!tape) return;
    const now = ctx.currentTime + 0.03;
    for (const c of T.clips) {
      const buf = T.bufs.get(c.buf)?.buffer; if (!buf || c.track >= 4) continue;
      const end = c.start + c.dur; if (end <= T.pos) continue;
      const skip = Math.max(0, T.pos - c.start), when = now + Math.max(0, c.start - T.pos), len = c.dur - skip;
      const s = ctx.createBufferSource(), g = ctx.createGain(); s.buffer = buf;
      s.connect(g); g.connect(tape.tracks[c.track]);
      // gain with fades, laid out on the audio clock
      const g0 = c.gain, fi = c.fin, fo = c.fout, at = x => when + (x - skip);
      g.gain.setValueAtTime(skip < fi ? g0 * skip / fi : g0, when);
      if (skip < fi) g.gain.linearRampToValueAtTime(g0, at(fi));
      if (fo > 0) { const fs = Math.max(skip, c.dur - fo); g.gain.setValueAtTime(skip > c.dur - fo ? g0 * (c.dur - skip) / fo : g0, at(fs)); g.gain.linearRampToValueAtTime(0, at(c.dur)); }
      s.start(when, c.offset + skip, len);
      playSrcs.push(s);
    }
  }
  function lanesInUse() { const m = new Map(); for (const e of T.events) if (e.kind === 'param') m.set(e.mod + '.' + e.key, [e.mod, e.key]); return [...m.values()]; }
  function seek(t, applyState) {
    T.pos = Math.max(0, t);
    if (applyState) {
      if (T.snapshot) restore(T.snapshot);
      sortEv();
      for (const ev of T.events) { if (ev.t > T.pos) break; if (ev.kind !== 'param' && ev.kind !== 'marker') applyEvent(ev); }
      setParamsAt(T.pos, false);
    }
    T.startPos = T.pos; T.startCtx = ctx.currentTime;
    if (T.playing) scheduleClips();
    draw();
  }
  function setParamsAt(t, glow) {
    T.applying = true;
    try {
      for (const [mod, key] of lanesInUse()) {
        const p = E.mods[mod]?.params[key]; if (!p) continue;
        const v = valueAt(lanePoints(mod, key), t); if (v == null || Math.abs(v - p.n) < 0.0015) continue;
        p.setNorm(v); if (glow) glowKnob(mod, key);
      }
    } finally { T.applying = false; }
  }
  function tick() {
    if (!T.playing) return;
    const prev = T.pos;
    T.pos = T.startPos + (ctx.currentTime - T.startCtx);
    if (T.loop && !T.recording && T.loopB > T.loopA && T.pos >= T.loopB) { seek(T.loopA, true); return; }
    sortEv();
    if (!T.recording || T.overdubPlay) {
      for (const ev of T.events) {
        if (ev.t <= prev) continue; if (ev.t > T.pos) break;
        if (ev.kind !== 'param') applyEvent(ev);
      }
      // while recording, leave the knobs to you and the AI; otherwise follow the automation
      if (!T.recording) setParamsAt(T.pos, true);
    }
    T.len = Math.max(T.len || 0, T.pos);
    if (T.follow) { const x = (T.pos - T.scrollX) * T.pps, w = view.clientWidth; if (x > w * 0.85 || x < 0) T.scrollX = Math.max(0, T.pos - (w * 0.15) / T.pps); }
  }
  setInterval(tick, 20);

  function play() {
    if (T.playing) return;
    if (ctx.state !== 'running') ctx.resume();
    T.playing = true;
    seek(T.pos, true);
    if (!E.running) E.start();
    renderBar();
  }
  function stop() {
    if (!T.playing) { seek(0, false); return; }
    T.playing = false; T.recording = false; scheduleClips(); renderBar(); draw();
  }
  function record() {
    if (T.recording) { T.recording = false; renderBar(); return; }
    if (ctx.state !== 'running') ctx.resume();
    if (!T.events.length && !T.snapshot) { T.snapshot = snapshot(); T.pos = 0; }
    for (const id of E.order) { const d = dataOf(E.mods[id]); if (d) lastData[id] = JSON.stringify(d); }
    T.recording = true; T.overdubPlay = true;
    if (!T.playing) { T.playing = true; T.startPos = T.pos; T.startCtx = ctx.currentTime; scheduleClips(); }
    if (!E.running) E.start();
    renderBar();
  }

  // ======================= LANES =======================
  function lanes() {
    const out = [{ type: 'marker', label: 'Markers', color: C.marker }];
    if (T.events.some(e => e.kind === 'transport')) out.push({ type: 'global', label: 'Transport', color: '#e9e6dc' });
    const ids = []; for (const e of T.events) if (e.mod && !ids.includes(e.mod)) ids.push(e.mod);
    ids.sort((a, b) => (E.order.indexOf(a) + 1 || 999) - (E.order.indexOf(b) + 1 || 999));
    for (const id of ids) {
      const color = E.mods[id]?.stripe || '#888';
      const keys = []; for (const e of T.events) if (e.kind === 'param' && e.mod === id && !keys.includes(e.key)) keys.push(e.key);
      if (!T.seen.has(id) && keys.length > 3) { T.seen.add(id); T.fold.add(id); } // busy modules start folded
      const folded = T.fold.has(id);
      out.push({ type: 'events', mod: id, label: `${folded ? '▸' : '▾'} ${modName(id)}${folded && keys.length ? ` (${keys.length} lanes)` : ''}`, color, head: true });
      if (!folded) for (const k of keys) out.push({ type: 'param', mod: id, key: k, label: `${modName(id)} · ${E.mods[id]?.params[k]?.label || k}`, color });
    }
    for (let i = 0; i < T.tracks; i++) out.push({ type: 'audio', track: i, label: `Audio ${i + 1}`, color: '#e8453c' });
    let y = 0; for (const l of out) { l.y = y; l.h = LANE_H[l.type]; y += l.h; }
    return out;
  }
  const evLabel = e => e.kind === 'cable' ? `${e.op === 'connect' ? '⌁' : '✕'} ${e.from.mod}.${e.from.port}→${e.to.port}` : e.kind === 'module' ? (e.op === 'add' ? '＋ add ' + (e.type || '') : '－ remove') : e.kind === 'data' ? '▦ pattern' : e.kind === 'transport' ? (e.run ? '▶ run' : '■ stop') : e.text || '';
  const laneOf = (e, L) => L.find(l => e.kind === 'param' ? (l.type === 'param' && l.mod === e.mod && l.key === e.key) : e.kind === 'marker' ? l.type === 'marker' : e.kind === 'transport' ? l.type === 'global' : (l.type === 'events' && l.mod === e.mod));

  // ======================= DOM =======================
  const root = $('#tl');
  root.innerHTML = `
    <div class="tl-bar">
      <button class="tbtn rec" id="tl-rec" title="Record everything you and the AI do (R)">●</button>
      <button class="tbtn" id="tl-play" title="Play (Space)">▶</button>
      <button class="tbtn" id="tl-stop" title="Stop; press again to return to the start">■</button>
      <span class="tl-time" id="tl-time">1.1.1 · 0:00.0</span>
      <button class="tbtn tog" id="tl-loop" title="Loop the region set by shift-dragging in the ruler">⟲ Loop</button>
      <button class="tbtn tog on" id="tl-snap" title="Snap to 16th notes">Snap</button>
      <button class="tbtn tog on" id="tl-follow" title="Scroll with the playhead">Follow</button>
      <button class="tbtn" id="tl-zout" title="Zoom out (Ctrl+wheel)">−</button><button class="tbtn" id="tl-zin" title="Zoom in">＋</button>
      <span class="sp"></span>
      <span class="tl-insp" id="tl-insp"></span>
      <button class="tbtn" id="tl-addact" title="Add an action at the playhead">＋ Action</button>
      <label class="tbtn" title="Import audio clips onto the selected audio track">♫ Audio<input type="file" id="tl-file" accept="audio/*" multiple hidden></label>
      <button class="tbtn" id="tl-clear" title="Delete the recording and all clips">Clear</button>
      <button class="tbtn" id="tl-fold" title="Show or hide the timeline">▾</button>
    </div>
    <div class="tl-ruler-row"><div class="tl-corner">Tracks</div><canvas id="tl-ruler"></canvas></div>
    <div class="tl-body" id="tl-body"><div class="tl-heads" id="tl-heads"></div><div class="tl-view" id="tl-view"><canvas id="tl-cv"></canvas></div></div>
    <div class="tl-pop" id="tl-pop" hidden></div>
    <div class="tl-drop" id="tl-drop">Drop audio to add clips</div>`;
  const view = $('#tl-view'), cv = $('#tl-cv'), ruler = $('#tl-ruler'), heads = $('#tl-heads'), body = $('#tl-body'), insp = $('#tl-insp'), pop = $('#tl-pop');
  let L = lanes();
  const dpr = () => Math.min(2, window.devicePixelRatio || 1);
  const xOf = t => (t - T.scrollX) * T.pps, tOf = x => x / T.pps + T.scrollX;
  let needs = true; function dirty() { needs = true; }

  function renderBar() {
    $('#tl-rec').classList.toggle('on', T.recording); $('#tl-play').classList.toggle('on', T.playing && !T.recording);
    $('#tl-loop').classList.toggle('on', T.loop); $('#tl-snap').classList.toggle('on', T.snap); $('#tl-follow').classList.toggle('on', T.follow);
    root.classList.toggle('recording', T.recording);
  }
  function renderHeads() {
    heads.innerHTML = '';
    for (const l of L) {
      const d = h('div', 'tl-head ' + l.type); d.style.height = l.h + 'px'; d.style.setProperty('--lc', l.color);
      d.innerHTML = `<span class="nm"></span>`; d.querySelector('.nm').textContent = l.label;
      if (l.head) { d.classList.add('mhead'); d.title = 'Click to show or hide this module\'s automation lanes'; d.onclick = e => { if (e.target.closest('.x')) return; T.fold.has(l.mod) ? T.fold.delete(l.mod) : T.fold.add(l.mod); dirty(); }; }
      if (l.type !== 'audio') {
        const x = h('button', 'x', '✕'); x.type = 'button'; x.title = 'Delete everything on this lane';
        x.onclick = () => { T.events = T.events.filter(e => l.head ? e.mod !== l.mod : laneOf(e, L) !== l); T.sel.clear(); dirty(); };
        if (l.head) x.title = 'Delete everything recorded for this module';
        d.append(x);
      } else { d.title = 'Drop audio files here'; if (T.selTrack === l.track) d.classList.add('sel'); d.onclick = () => { T.selTrack = l.track; renderHeads(); }; }
      heads.append(d);
    }
  }
  function draw() {
    const nl = lanes(); const sig = nl.map(l => l.label + l.h).join('|');
    if (sig !== L.map(l => l.label + l.h).join('|')) { L = nl; renderHeads(); } else L = nl;
    const W = view.clientWidth, Hh = L.reduce((a, l) => a + l.h, 0);
    // ruler
    const rw = ruler.clientWidth;
    ruler.width = rw * dpr(); ruler.height = 22 * dpr(); const r = ruler.getContext('2d'); r.setTransform(dpr(), 0, 0, dpr(), 0, 0);
    r.clearRect(0, 0, rw, 22); r.fillStyle = '#121418'; r.fillRect(0, 0, rw, 22);
    if (T.loopB > T.loopA) { r.fillStyle = T.loop ? '#ffb03b44' : '#ffffff14'; r.fillRect(xOf(T.loopA), 0, (T.loopB - T.loopA) * T.pps, 22); }
    const bar = beatLen() * 4, bpx = bar * T.pps, every = bpx < 30 ? Math.ceil(30 / bpx) : 1;
    r.font = '10px JetBrains Mono, monospace'; r.fillStyle = C.dim;
    for (let b = Math.floor(T.scrollX / bar); b * bar < tOf(W); b++) {
      const x = xOf(b * bar); r.fillStyle = '#ffffff40'; r.fillRect(x, 10, 1, 12);
      if (b % every === 0) { r.fillStyle = C.dim; r.fillText(String(b + 1), x + 3, 10); }
      if (bpx > 60) for (let q = 1; q < 4; q++) { r.fillStyle = '#ffffff1c'; r.fillRect(x + q * bpx / 4, 16, 1, 6); }
    }
    r.fillStyle = '#ff5a36'; r.fillRect(xOf(T.pos) - 1, 0, 2, 22);
    // lanes
    cv.width = W * dpr(); cv.height = Math.max(1, Hh) * dpr(); cv.style.height = Hh + 'px'; const g = cv.getContext('2d'); g.setTransform(dpr(), 0, 0, dpr(), 0, 0);
    g.clearRect(0, 0, W, Hh);
    for (let b = Math.floor(T.scrollX / bar); b * bar < tOf(W); b++) { const x = xOf(b * bar); g.fillStyle = C.bar; g.fillRect(x, 0, 1, Hh); if (bpx > 60) for (let q = 1; q < 4; q++) { g.fillStyle = C.grid; g.fillRect(x + q * bpx / 4, 0, 1, Hh); } }
    if (T.loop && T.loopB > T.loopA) { g.fillStyle = '#ffb03b0d'; g.fillRect(xOf(T.loopA), 0, (T.loopB - T.loopA) * T.pps, Hh); }
    sortEv();
    for (const l of L) {
      g.fillStyle = l.type === 'audio' ? '#0f1013' : '#ffffff05'; g.fillRect(0, l.y, W, l.h - 1);
      g.fillStyle = '#00000080'; g.fillRect(0, l.y + l.h - 1, W, 1);
      if (l.type === 'param') drawParam(g, l, W);
      else if (l.type === 'audio') drawAudio(g, l, W);
      else drawEvents(g, l, W);
    }
    if (T.box) { g.strokeStyle = C.ai; g.setLineDash([4, 3]); g.strokeRect(T.box.x0, T.box.y0, T.box.x1 - T.box.x0, T.box.y1 - T.box.y0); g.setLineDash([]); }
    g.fillStyle = T.recording ? '#ff3b2f' : '#ff5a36'; g.fillRect(xOf(T.pos) - 1, 0, 2, Hh);
    $('#tl-time').textContent = `${fmtBar(T.pos)} · ${fmtT(T.pos)}`;
    renderInsp();
  }
  function drawParam(g, l, W) {
    const pts = T.events.filter(e => e.kind === 'param' && e.mod === l.mod && e.key === l.key);
    const yOf = n => l.y + l.h - 4 - n * (l.h - 8);
    g.strokeStyle = l.color; g.lineWidth = 1.6; g.beginPath();
    pts.forEach((p, i) => {
      const x = xOf(p.t), y = yOf(p.n);
      if (i === 0) g.moveTo(x, y); else if (p.ramp) g.lineTo(x, y); else { g.lineTo(x, yOf(pts[i - 1].n)); g.lineTo(x, y); }
    });
    if (pts.length) g.lineTo(W + 10, yOf(pts[pts.length - 1].n));
    g.stroke();
    g.globalAlpha = 0.12; g.lineTo(W + 10, l.y + l.h); if (pts.length) g.lineTo(xOf(pts[0].t), l.y + l.h); g.closePath(); g.fillStyle = l.color; g.fill(); g.globalAlpha = 1;
    let lastX = -99;
    for (const p of pts) {
      const x = xOf(p.t); if (x < -6 || x > W + 6) continue;
      const sel = T.sel.has(p.id); if (!sel && x - lastX < 5) continue; lastX = x;
      g.fillStyle = sel ? '#fff' : (p.src === 'ai' ? C.ai : C.you); g.beginPath(); g.arc(x, yOf(p.n), sel ? 4.5 : 3, 0, Math.PI * 2); g.fill();
    }
  }
  function drawEvents(g, l, W) {
    const evs = T.events.filter(e => laneOf(e, L) === l);
    g.font = '10px IBM Plex Sans Condensed, sans-serif'; g.textBaseline = 'middle';
    let nextFree = -1e9;
    for (const e of evs) {
      const x = xOf(e.t); if (x < -200 || x > W + 4) continue;
      const txt = evLabel(e), tw = Math.min(l.type === 'marker' ? 260 : 150, g.measureText(txt).width + 10), sel = T.sel.has(e.id);
      const col = e.kind === 'marker' ? C.marker : e.src === 'ai' ? C.ai : C.you;
      g.fillStyle = col; g.fillRect(x, l.y + 2, 2, l.h - 5);
      if (x > nextFree || sel) {
        g.fillStyle = sel ? '#ffffff30' : '#00000099'; g.fillRect(x + 2, l.y + 3, tw, l.h - 7);
        g.fillStyle = sel ? '#fff' : col; g.save(); g.beginPath(); g.rect(x + 2, l.y, tw, l.h); g.clip(); g.fillText(txt, x + 6, l.y + l.h / 2 - 0.5); g.restore();
        nextFree = x + tw + 2;
      }
      e._x = x; e._w = Math.max(6, tw);
    }
  }
  function drawAudio(g, l, W) {
    g.font = '10px IBM Plex Sans Condensed, sans-serif'; g.textBaseline = 'top';
    for (const c of T.clips.filter(c => c.track === l.track)) {
      const x0 = xOf(c.start), x1 = xOf(c.start + c.dur); if (x1 < 0 || x0 > W) continue;
      const sel = T.sel.has(c.id), y = l.y + 2, hh = l.h - 5;
      g.fillStyle = sel ? '#e8453c55' : '#e8453c33'; g.fillRect(x0, y, x1 - x0, hh);
      g.strokeStyle = sel ? '#fff' : '#e8453c'; g.lineWidth = 1; g.strokeRect(x0 + 0.5, y + 0.5, x1 - x0 - 1, hh - 1);
      const b = T.bufs.get(c.buf);
      if (b) { // waveform
        g.fillStyle = '#ffb3ad'; const pk = b.peaks, n = pk.length, mid = y + hh / 2 + 5, amp = (hh - 16) / 2 * Math.min(2, c.gain);
        for (let x = Math.max(0, Math.floor(x0)); x < Math.min(W, x1); x++) {
          const st = c.offset + (x - x0) / T.pps, i = Math.floor(st / b.buffer.duration * n); if (i < 0 || i >= n) continue;
          let f = 1; const lt = st - c.offset; if (lt < c.fin) f = lt / c.fin; if (c.dur - lt < c.fout) f = Math.min(f, (c.dur - lt) / c.fout);
          const a = pk[i] * amp * f; g.fillRect(x, mid - a, 1, a * 2 + 1);
        }
      }
      // fades
      g.strokeStyle = '#fff9'; g.beginPath(); g.moveTo(x0, y + hh); g.lineTo(x0 + c.fin * T.pps, y + 10); g.lineTo(x1 - c.fout * T.pps, y + 10); g.lineTo(x1, y + hh); g.stroke();
      g.fillStyle = '#fff'; g.fillRect(x0 + c.fin * T.pps - 3, y + 7, 6, 6); g.fillRect(x1 - c.fout * T.pps - 3, y + 7, 6, 6);
      g.save(); g.beginPath(); g.rect(x0, y, x1 - x0, hh); g.clip(); g.fillStyle = '#fff'; g.fillText(`${c.name}${c.gain !== 1 ? ' · ' + Math.round(20 * Math.log10(c.gain)) + 'dB' : ''}`, x0 + 10, y + 1); g.restore();
    }
  }

  // ======================= INSPECTOR (edit the selected item) =======================
  let inspSig = '';
  function selected() { if (T.sel.size !== 1) return null; const id = [...T.sel][0]; return T.events.find(e => e.id === id) || T.clips.find(c => c.id === id); }
  function renderInsp() {
    const s = selected(), sig = s ? s.id + ':' + T.sel.size : 'n' + T.sel.size;
    if (sig === inspSig && !T.inspDirty) { if (s) { const tf = insp.querySelector('.it'); if (tf && document.activeElement !== tf) tf.value = (s.t ?? s.start).toFixed(2); const vv = insp.querySelector('.iv b'); if (vv && s.kind === 'param') vv.textContent = E.mods[s.mod]?.params[s.key] ? fmtParam(s) : ''; } return; }
    inspSig = sig; T.inspDirty = false; insp.innerHTML = '';
    if (!s) { insp.textContent = T.sel.size ? `${T.sel.size} selected · Delete removes · drag to move` : 'Click an item to edit it · double-click a lane to add a point'; return; }
    const time = h('input', 'it'); time.type = 'number'; time.step = '0.01'; time.min = '0'; time.title = 'Time in seconds'; time.value = (s.t ?? s.start).toFixed(2);
    time.onchange = () => { const v = Math.max(0, +time.value || 0); if (s.kind) s.t = v; else s.start = v; dirty(); if (T.playing) scheduleClips(); };
    const lab = h('span', 'il');
    if (s.kind === 'param') {
      lab.textContent = `${modName(s.mod)} ${E.mods[s.mod]?.params[s.key]?.label || s.key}`;
      const r = h('input'); r.type = 'range'; r.min = 0; r.max = 1; r.step = 0.001; r.value = s.n; r.oninput = () => { s.n = +r.value; dirty(); vv.querySelector('b').textContent = fmtParam(s); };
      const vv = h('span', 'iv', `<b>${fmtParam(s)}</b>`);
      const rp = h('label', 'ic', `<input type="checkbox" ${s.ramp ? 'checked' : ''}> ramp in`); rp.querySelector('input').onchange = e => { s.ramp = e.target.checked; dirty(); };
      insp.append(lab, time, r, vv, rp);
    } else if (s.kind) {
      lab.textContent = s.kind === 'marker' ? 'Marker' : `${modName(s.mod)} · ${evLabel(s)}`;
      insp.append(lab, time);
      if (s.kind === 'marker') { const tx = h('input', 'itx'); tx.value = s.text; tx.oninput = () => { s.text = tx.value; dirty(); }; insp.append(tx); }
    } else {
      lab.textContent = s.name;
      const gn = h('input'); gn.type = 'range'; gn.min = 0; gn.max = 2; gn.step = 0.01; gn.value = s.gain; gn.title = 'Clip gain'; gn.oninput = () => { s.gain = +gn.value; dirty(); if (T.playing) scheduleClips(); };
      insp.append(lab, time, h('span', 'iv', 'gain'), gn);
    }
  }
  const fmtParam = s => { const p = E.mods[s.mod]?.params[s.key]; if (!p) return ''; const o = p.n; p.n = s.n; const d = p.display(); p.n = o; return d; };

  // ======================= POINTER EDITING =======================
  function hit(x, y) {
    const l = L.find(l => y >= l.y && y < l.y + l.h); if (!l) return null;
    if (l.type === 'param') {
      const yOf = n => l.y + l.h - 4 - n * (l.h - 8);
      let best = null, bd = 8;
      for (const e of T.events) if (e.kind === 'param' && e.mod === l.mod && e.key === l.key) { const d = Math.hypot(xOf(e.t) - x, yOf(e.n) - y); if (d < bd) { bd = d; best = e; } }
      return { l, item: best, part: 'point' };
    }
    if (l.type === 'audio') {
      for (const c of T.clips.filter(c => c.track === l.track).reverse()) {
        const x0 = xOf(c.start), x1 = xOf(c.start + c.dur); if (x < x0 - 3 || x > x1 + 3) continue;
        const yy = y - l.y;
        if (yy < 16 && Math.abs(x - (x0 + c.fin * T.pps)) < 7) return { l, item: c, part: 'fin' };
        if (yy < 16 && Math.abs(x - (x1 - c.fout * T.pps)) < 7) return { l, item: c, part: 'fout' };
        if (x - x0 < 6) return { l, item: c, part: 'left' };
        if (x1 - x < 6) return { l, item: c, part: 'right' };
        return { l, item: c, part: 'body' };
      }
      return { l };
    }
    const evs = T.events.filter(e => laneOf(e, L) === l && e._x != null);
    for (let i = evs.length - 1; i >= 0; i--) { const e = evs[i]; if (x >= e._x - 3 && x <= e._x + Math.min(e._w, 40)) return { l, item: e, part: 'event' }; }
    return { l };
  }
  let drag = null;
  cv.addEventListener('pointerdown', e => {
    const r = cv.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top, hh = hit(x, y);
    cv.setPointerCapture(e.pointerId); T.userTouch = performance.now();
    if (hh?.item) {
      const it = hh.item;
      if (e.altKey) { delItems([it.id]); return; }
      if (e.shiftKey) { T.sel.has(it.id) ? T.sel.delete(it.id) : T.sel.add(it.id); dirty(); return; }
      if (!T.sel.has(it.id)) { T.sel.clear(); T.sel.add(it.id); }
      if (hh.l.type === 'audio') T.selTrack = hh.l.track;
      const items = [...T.sel].map(id => T.events.find(v => v.id === id) || T.clips.find(c => c.id === id)).filter(Boolean);
      drag = { kind: hh.part, x0: x, y0: y, l: hh.l, it, orig: items.map(i => ({ i, t: i.t ?? i.start, n: i.n, start: i.start, dur: i.dur, offset: i.offset, fin: i.fin, fout: i.fout, track: i.track })) };
    } else {
      T.sel.clear();
      drag = { kind: 'box', x0: x, y0: y, l: hh?.l };
      T.box = { x0: x, y0: y, x1: x, y1: y };
    }
    dirty();
  });
  cv.addEventListener('pointermove', e => {
    const r = cv.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
    if (!drag) { const hh = hit(x, y); cv.style.cursor = !hh?.item ? 'crosshair' : hh.part === 'left' || hh.part === 'right' ? 'ew-resize' : hh.part === 'body' || hh.part === 'event' ? 'grab' : 'pointer'; return; }
    const dt = (x - drag.x0) / T.pps;
    if (drag.kind === 'box') { T.box.x1 = x; T.box.y1 = y; dirty(); return; }
    drag.moved = drag.moved || Math.abs(x - drag.x0) + Math.abs(y - drag.y0) > 3;
    if (!drag.moved) return;
    for (const o of drag.orig) {
      const i = o.i;
      if (drag.kind === 'point' && i.kind === 'param') { i.t = Math.max(0, snapT(o.t + dt)); if (i === drag.it || drag.orig.length === 1) i.n = clamp(o.n - (y - drag.y0) / (drag.l.h - 8)); else i.n = clamp(o.n - (y - drag.y0) / (drag.l.h - 8)); }
      else if (drag.kind === 'event' && i.kind) i.t = Math.max(0, snapT(o.t + dt));
      else if (!i.kind) { // audio clip
        if (drag.kind === 'body') { i.start = Math.max(0, snapT(o.start + dt)); const tl = L.find(l => l.type === 'audio' && y >= l.y && y < l.y + l.h); if (tl && i === drag.it) i.track = tl.track; }
        else if (drag.kind === 'left') { const d = clamp(snapT(o.start + dt) - o.start, -o.offset, o.dur - 0.05); i.start = o.start + d; i.offset = o.offset + d; i.dur = o.dur - d; }
        else if (drag.kind === 'right') { const max = T.bufs.get(i.buf).buffer.duration - o.offset; i.dur = clamp(snapT(o.start + o.dur + dt) - o.start, 0.05, max); }
        else if (drag.kind === 'fin') i.fin = clamp(o.fin + dt, 0, i.dur - i.fout);
        else if (drag.kind === 'fout') i.fout = clamp(o.fout - dt, 0, i.dur - i.fin);
      } else if (i.kind === 'param') i.t = Math.max(0, snapT(o.t + dt));
    }
    T.inspDirty = true; dirty();
  });
  const endDrag = () => {
    if (!drag) return;
    if (drag.kind === 'box') {
      const b = T.box, xa = Math.min(b.x0, b.x1), xb = Math.max(b.x0, b.x1), ya = Math.min(b.y0, b.y1), yb = Math.max(b.y0, b.y1);
      if (xb - xa < 3 && yb - ya < 3) { seek(snapT(tOf(b.x0)), !T.playing ? false : true); if (T.playing) seek(T.pos, true); }
      else {
        for (const e of T.events) { const l = laneOf(e, L); if (!l || l.y + l.h < ya || l.y > yb) continue; const x = xOf(e.t); if (x >= xa && x <= xb) T.sel.add(e.id); }
        for (const c of T.clips) { const l = L.find(l => l.type === 'audio' && l.track === c.track); if (!l || l.y + l.h < ya || l.y > yb) continue; if (xOf(c.start + c.dur) >= xa && xOf(c.start) <= xb) T.sel.add(c.id); }
      }
      T.box = null;
    }
    if (drag.moved && T.playing) scheduleClips();
    drag = null; T.inspDirty = true; dirty();
  };
  cv.addEventListener('pointerup', endDrag); cv.addEventListener('pointercancel', endDrag);
  cv.addEventListener('dblclick', e => {
    const r = cv.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top, hh = hit(x, y);
    if (!hh || hh.item) return;
    if (hh.l.type === 'param') { const n = clamp((hh.l.y + hh.l.h - 4 - y) / (hh.l.h - 8)); const ev = { id: uid(), t: snapT(tOf(x)), kind: 'param', mod: hh.l.mod, key: hh.l.key, n, ramp: true, src: 'you' }; T.events.push(ev); T.sel.clear(); T.sel.add(ev.id); }
    else if (hh.l.type === 'marker') { const ev = { id: uid(), t: snapT(tOf(x)), kind: 'marker', text: 'Marker', src: 'you' }; T.events.push(ev); T.sel.clear(); T.sel.add(ev.id); }
    else if (hh.l.type === 'audio') { T.selTrack = hh.l.track; $('#tl-file').click(); }
    T.inspDirty = true; dirty();
  });
  view.addEventListener('wheel', e => {
    if (e.ctrlKey || e.metaKey) { e.preventDefault(); const r = cv.getBoundingClientRect(), x = e.clientX - r.left, t = tOf(x); T.pps = clamp(T.pps * (e.deltaY < 0 ? 1.15 : 1 / 1.15), 4, 600); T.scrollX = Math.max(0, t - x / T.pps); dirty(); return; }
    const dx = e.shiftKey ? e.deltaY : e.deltaX;
    if (Math.abs(dx) > 0) { e.preventDefault(); T.scrollX = Math.max(0, T.scrollX + dx / T.pps); T.follow = false; renderBar(); dirty(); }
  }, { passive: false });
  // ruler: click to move the playhead, drag to scrub, shift-drag to set the loop
  let rdrag = null;
  ruler.addEventListener('pointerdown', e => { const x = e.offsetX; ruler.setPointerCapture(e.pointerId); rdrag = { loop: e.shiftKey, t0: snapT(tOf(x)) }; if (!rdrag.loop) seek(rdrag.t0, T.playing); else { T.loopA = T.loopB = rdrag.t0; } dirty(); });
  ruler.addEventListener('pointermove', e => { if (!rdrag) return; const t = snapT(tOf(e.offsetX)); if (rdrag.loop) { T.loopA = Math.min(rdrag.t0, t); T.loopB = Math.max(rdrag.t0, t); T.loop = T.loopB - T.loopA > 0.05; renderBar(); } else seek(t, T.playing); dirty(); });
  ruler.addEventListener('pointerup', () => { rdrag = null; });

  function delItems(ids) { const s = new Set(ids); T.events = T.events.filter(e => !s.has(e.id)); T.clips = T.clips.filter(c => !s.has(c.id)); T.sel.clear(); T.inspDirty = true; if (T.playing) scheduleClips(); dirty(); }
  function splitClip(c, t) {
    if (t <= c.start + 0.02 || t >= c.start + c.dur - 0.02) return;
    const d = t - c.start, b = { ...c, id: uid(), start: t, offset: c.offset + d, dur: c.dur - d, fin: 0 };
    c.dur = d; c.fout = 0; T.clips.push(b); dirty();
  }
  window.addEventListener('keydown', e => {
    if (/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName)) return;
    if (!root.matches(':hover') && e.key !== ' ') return;
    if (e.key === ' ') { e.preventDefault(); T.playing ? stop() : play(); }
    else if (e.key === 'Delete' || e.key === 'Backspace') { if (T.sel.size) { e.preventDefault(); delItems([...T.sel]); } }
    else if (e.key === 's' || e.key === 'S') { for (const c of T.clips.filter(c => T.sel.has(c.id))) splitClip(c, T.pos); }
    else if ((e.key === 'd' || e.key === 'D') && (e.ctrlKey || e.metaKey)) { e.preventDefault(); const add = []; for (const c of T.clips.filter(c => T.sel.has(c.id))) add.push({ ...c, id: uid(), start: c.start + c.dur }); T.clips.push(...add); T.sel = new Set(add.map(c => c.id)); dirty(); }
    else if (e.key === 'r' || e.key === 'R') record();
  });

  // ======================= AUDIO CLIPS =======================
  function peaksOf(buf) { const d = buf.getChannelData(0), n = Math.max(200, Math.floor(buf.duration * 200)), out = new Float32Array(n), step = d.length / n; for (let i = 0; i < n; i++) { let m = 0; for (let k = Math.floor(i * step); k < Math.floor((i + 1) * step); k += 4) m = Math.max(m, Math.abs(d[k])); out[i] = m; } return out; }
  async function addFiles(files, t, track) {
    ensureTape();
    let at = t;
    for (const f of files) {
      try {
        const buffer = await ctx.decodeAudioData(await f.arrayBuffer());
        const id = uid(); T.bufs.set(id, { buffer, peaks: peaksOf(buffer) });
        const c = { id: uid(), buf: id, name: f.name.replace(/\.[a-z0-9]+$/i, ''), track: clamp(track | 0, 0, 3), start: snapT(at), offset: 0, dur: buffer.duration, gain: 1, fin: 0.01, fout: 0.05 };
        T.clips.push(c); T.sel.clear(); T.sel.add(c.id); at = c.start + c.dur;
        AI.log('sys', `added audio clip "${c.name}" on track ${c.track + 1}`);
      } catch (e) { AI.log('err', `could not read ${f.name}: ${e.message}`); }
    }
    if (T.playing) scheduleClips();
    T.inspDirty = true; dirty();
  }
  $('#tl-file').onchange = e => { addFiles([...e.target.files], T.pos, T.selTrack ?? 0); e.target.value = ''; };
  let dragDepth = 0;
  root.addEventListener('dragenter', e => { if ([...(e.dataTransfer?.types || [])].includes('Files')) { dragDepth++; root.classList.add('dropping'); } });
  root.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; root.classList.remove('dropping'); } });
  root.addEventListener('dragover', e => { e.preventDefault(); });
  root.addEventListener('drop', e => {
    e.preventDefault(); dragDepth = 0; root.classList.remove('dropping');
    const files = [...(e.dataTransfer?.files || [])].filter(f => /^audio\//.test(f.type) || /\.(wav|mp3|ogg|flac|m4a|aiff?)$/i.test(f.name)); if (!files.length) return;
    const r = cv.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
    const l = L.find(l => l.type === 'audio' && y >= l.y && y < l.y + l.h);
    addFiles(files, x >= 0 ? tOf(x) : T.pos, l ? l.track : (T.selTrack ?? 0));
  });

  // ======================= ADD ACTION POPOVER =======================
  function openAdd() {
    pop.hidden = false; pop.innerHTML = '';
    const row = (lbl, el) => { const r = h('label', 'pr'); r.append(h('span', null, lbl), el); pop.append(r); return el; };
    const sel = (opts, v) => { const s = h('select'); opts.forEach(([val, txt]) => { const o = h('option'); o.value = val; o.textContent = txt; s.append(o); }); if (v != null) s.value = v; return s; };
    pop.append(h('div', 'ph', `Add an action at ${fmtBar(T.pos)} (${fmtT(T.pos)})`));
    const type = row('Action', sel([['knob', 'Turn a knob'], ['patch', 'Patch a cable'], ['unpatch', 'Unplug a cable'], ['add', 'Add a module'], ['remove', 'Remove a module'], ['run', 'Start the clock'], ['stop', 'Stop the clock'], ['marker', 'Marker / note']]));
    const box = h('div', 'pbox'); pop.append(box);
    const mods = () => E.order.map(id => [id, E.mods[id].name]);
    const fill = () => {
      box.innerHTML = ''; const r2 = (l, el) => { const r = h('label', 'pr'); r.append(h('span', null, l), el); box.append(r); return el; };
      const ty = type.value;
      if (ty === 'knob') {
        const m = r2('Module', sel(mods())), k = r2('Knob', sel([])), v = h('input'); v.type = 'range'; v.min = 0; v.max = 1; v.step = 0.001; const vr = r2('Value', v), out = h('span', 'iv'); box.append(out);
        const ramp = r2('Ramp in', h('input')); ramp.type = 'checkbox'; ramp.checked = true;
        const fk = () => { k.innerHTML = ''; E.mods[m.value].paramOrder.forEach(key => { const o = h('option'); o.value = key; o.textContent = E.mods[m.value].params[key].label; k.append(o); }); fv(); };
        const fv = () => { const p = E.mods[m.value].params[k.value]; if (p) { if (document.activeElement !== v) v.value = p.n; out.textContent = fmtParam({ mod: m.value, key: k.value, n: +v.value }); } };
        m.onchange = fk; k.onchange = fv; vr.oninput = () => { out.textContent = fmtParam({ mod: m.value, key: k.value, n: +v.value }); }; fk();
        box.get = () => ({ kind: 'param', mod: m.value, key: k.value, n: +v.value, ramp: ramp.checked });
      } else if (ty === 'patch' || ty === 'unpatch') {
        const fm = r2('From', sel(mods())), fp = r2('Output', sel([])), tm = r2('To', sel(mods())), tp = r2('Input', sel([]));
        const ports = (s, id, dir) => { s.innerHTML = ''; Object.entries(dir === 'out' ? E.mods[id].outs : E.mods[id].ins).forEach(([n, d]) => { const o = h('option'); o.value = n; o.textContent = `${n} (${d.jt})`; s.append(o); }); };
        fm.onchange = () => ports(fp, fm.value, 'out'); tm.onchange = () => ports(tp, tm.value, 'in'); ports(fp, fm.value, 'out'); ports(tp, tm.value, 'in');
        if (ty === 'unpatch') { fm.parentNode.remove(); fp.parentNode.remove(); }
        box.get = () => ({ kind: 'cable', op: ty === 'patch' ? 'connect' : 'disconnect', mod: tm.value, from: { mod: fm.value, port: fp.value }, to: { mod: tm.value, port: tp.value } });
      } else if (ty === 'add') {
        const t = r2('Type', sel(Object.entries(Mods.TYPES).map(([k, v]) => [k, v.label])));
        box.get = () => { const id = E.newId(Mods.TYPES[t.value].prefix, new Set(T.events.filter(e => e.kind === 'module').map(e => e.mod))); return { kind: 'module', op: 'add', mod: id, type: t.value, opts: {} }; };
      } else if (ty === 'remove') { const m = r2('Module', sel(mods().filter(([id]) => !FIXED.has(id)))); box.get = () => ({ kind: 'module', op: 'remove', mod: m.value }); }
      else if (ty === 'run' || ty === 'stop') box.get = () => ({ kind: 'transport', run: ty === 'run' });
      else { const tx = r2('Text', h('input')); tx.value = 'Drop here'; box.get = () => ({ kind: 'marker', text: tx.value }); }
    };
    type.onchange = fill; fill();
    const btns = h('div', 'row'), ok = h('button', 'btn primary grow', 'Add'), cancel = h('button', 'btn', 'Cancel');
    ok.onclick = () => { const ev = { id: uid(), t: T.pos, src: 'you', ...box.get() }; T.events.push(ev); T.sel.clear(); T.sel.add(ev.id); pop.hidden = true; T.inspDirty = true; dirty(); };
    cancel.onclick = () => { pop.hidden = true; };
    btns.append(ok, cancel); pop.append(btns);
  }

  // ======================= BUTTONS =======================
  $('#tl-rec').onclick = record; $('#tl-play').onclick = () => T.playing && !T.recording ? stop() : play(); $('#tl-stop').onclick = stop;
  $('#tl-loop').onclick = () => { T.loop = !T.loop; if (T.loop && T.loopB <= T.loopA) { T.loopA = 0; T.loopB = beatLen() * 16; } renderBar(); dirty(); };
  $('#tl-snap').onclick = () => { T.snap = !T.snap; renderBar(); };
  $('#tl-follow').onclick = () => { T.follow = !T.follow; renderBar(); };
  $('#tl-zin').onclick = () => { T.pps = Math.min(600, T.pps * 1.4); dirty(); };
  $('#tl-zout').onclick = () => { T.pps = Math.max(4, T.pps / 1.4); dirty(); };
  $('#tl-addact').onclick = () => pop.hidden ? openAdd() : (pop.hidden = true);
  $('#tl-clear').onclick = () => { if (!T.events.length && !T.clips.length) return; if (T._armClear && performance.now() - T._armClear < 2500) { T.events = []; T.clips = []; T.snapshot = null; T.sel.clear(); stop(); stop(); T._armClear = 0; $('#tl-clear').textContent = 'Clear'; dirty(); } else { T._armClear = performance.now(); $('#tl-clear').textContent = 'Sure? Click again'; setTimeout(() => { $('#tl-clear').textContent = 'Clear'; }, 2500); } };
  $('#tl-fold').onclick = () => { root.classList.toggle('folded'); $('#tl-fold').textContent = root.classList.contains('folded') ? '▴' : '▾'; setTimeout(() => UI.layout(), 50); };
  // a knob you touch while recording is yours, even while the AI is busy
  document.addEventListener('pointerdown', e => { if (e.target.closest('.dial,.jack,.step,.dc,.pb,.sc')) T.userTouch = performance.now(); }, true);

  // ======================= FRAME =======================
  let lastPos = -1;
  (function frame() { if (needs || T.playing || T.pos !== lastPos) { needs = false; lastPos = T.pos; draw(); } requestAnimationFrame(frame); })();
  new ResizeObserver(() => dirty()).observe(view);
  renderHeads(); renderBar();

  Object.assign(T, { play, stop, record, seek, takeSnapshot: snapshot, restore, addFiles, ensureTape, draw, lanes: () => L });
  return T;
})();
