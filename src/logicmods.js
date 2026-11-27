// logicmods.js — the logic module family, Phase 1: LOGIC (Boolean gates), COMPARE (signals into logic) and EDGE
// (edges and pulse shaping). The behaviour lives in logic.js (LogicCore); this file wires it to the rack: jacks,
// knobs, level outputs (0/1 control signals), the settle hook in the scheduler, and the panel displays.
'use strict';
const LogicMods = (() => {
  const E = Engine, ctx = E.ctx, M = E.Module, C = LogicCore;
  const STRIPE = '#e0a83a'; // one amber stripe for the whole family
  const now = () => ctx.currentTime;
  const gain = (v = 1) => { const g = ctx.createGain(); g.gain.value = v; return g; };
  const constSrc = (v = 0) => { const c = ctx.createConstantSource(); c.offset.value = v; c.start(); return c; };
  const secs = v => v < 0.0015 ? 'TRIG' : v < 1 ? Math.round(v * 1000) + 'ms' : v.toFixed(2) + 's';
  const isLogic = m => !!(m && m.logic);

  // ---------------- the settle hook ----------------
  // every logic node in both layers, settled once per scheduler pass after the ordinary modules have ticked
  const nodes = [];
  let dirty = true;
  const succ = n => {
    const m = n.mod; if (!m || m.disposed) return [];
    const Ly = E.layers[m.layer], out = [];
    for (const c of Ly.cables) if (c.from.mod === m.id) { const t = Ly.mods[c.to.mod]; if (isLogic(t) && t.logic.node) out.push(t.logic.node); }
    return out;
  };
  E.post = E.post || [];
  E.post.push((t0, horizon) => {
    for (let i = nodes.length - 1; i >= 0; i--) if (nodes[i].mod.disposed) { nodes[i].alive = false; nodes.splice(i, 1); }
    if (!nodes.length) return;
    if (dirty) { C.rankNodes(nodes, succ); dirty = false; }
    C.settle(nodes, horizon);
  });
  E.on('change', ev => {
    dirty = true;
    // a cable pulled out of a logic input: whatever was high there ends now
    if (ev.type === 'disconnect') { const m = E.mods[ev.cable.to.mod]; if (isLogic(m) && m.logic.node && m.logic.node.ports[ev.cable.to.port]) C.closePort(m.logic.node, ev.cable.to.port, now()); }
  });
  E.on('modules', () => { dirty = true; });

  // ---------------- shared wiring ----------------
  // a 0/1 level output: a ConstantSource written at exact audio times; changes are also kept for the panel
  function levelOut(m, name, desc, init = 0) {
    const src = constSrc(init); m.outAudio(name, src, desc, true);
    m.trace[name] = [[0, init]];
    return (v, t) => { src.offset.setValueAtTime(v, Math.max(t, now())); m.trace[name].push([t, v]); };
  }
  const patched = (m, port) => E.layers[m.layer ?? E.L].cables.some(c => c.to.mod === m.id && c.to.port === port);
  // the io object a LogicCore behaviour talks to
  function ioFor(m, extra) {
    return Object.assign({
      emit: (port, ev) => { E.within(m.layer ?? E.L, () => m.emit(port, ev)); (m.pulses[port] = m.pulses[port] || []).push(ev.time); },
      level: (port, v, t) => m.levels[port]?.(v, t),
      patched: port => patched(m, port)
    }, extra);
  }
  // attach a behaviour: inputs file events in the node's inbox; input levels are traced for the panel
  function attach(m, node, inputs) {
    node.mod = m; m.logic = { node };
    nodes.push(node); dirty = true;
    for (const [name, desc] of inputs) { m.inEvent(name, function (e) { C.deliver(node, name, e); }, desc); m.trace[name] = [[0, 0]]; }
    const upd = node.update;
    node.update = (t, batch, n) => {
      for (const [name] of inputs) { const tr = m.trace[name], v = n.level(name) ? 1 : 0; if (tr.at(-1)[1] !== v) tr.push([t, v]); }
      upd(t, batch, n);
    };
  }
  const base = (m) => { m.trace = {}; m.pulses = {}; m.levels = {}; };
  // trim panel history older than a few seconds
  const trim = m => { const t = now() - 4; for (const k in m.trace) { const a = m.trace[k]; while (a.length > 2 && a[1][0] < t) a.shift(); } for (const k in m.pulses) { const a = m.pulses[k]; while (a.length && a[0] < t) a.shift(); } };
  const levelAt = (tr, t) => { let v = 0; for (const [ct, cv] of tr) { if (ct <= t) v = cv; else break; } return v; };

  // ======================= LOGIC =======================
  function Logic(id) {
    const m = new M(id, { name: 'Logic', sub: 'boolean gates', width: 220, stripe: STRIPE, family: 'logic' });
    base(m);
    m.p('fn', { label: 'Function', steps: C.FUNCS, def: 0, apply: () => { if (m.logic) C.poke(m.logic.node, now()); } });
    m.p('pass', { label: 'Notes from', steps: ['A', 'LAST'], def: 0, small: true });
    const node = C.logicNode(ioFor(m, { fn: () => m.params.fn.choice, pass: () => m.params.pass.choice }));
    attach(m, node, [['A', 'gate / trigger / notes A (its notes pass through)'], ['B', 'gate / trigger B'], ['C', 'optional third input (ignored while empty)']]);
    m.outEvent('OUT', 'fires when the function turns on (carries A\'s notes)');
    m.outEvent('INV', 'fires when the function turns off: NAND, NOR, XNOR, or NOT with only A patched in OR mode');
    m.levels.GATE = levelOut(m, 'GATE', '1 while the function is on, else 0');
    m.levels.NGATE = levelOut(m, 'NGATE', '1 while the function is off', 1);
    node.initLevels(now());
    m.layout = [{ custom: 'logic' }, { k: ['fn', 'pass'], cls: 'kgrid c' }];
    return m;
  }

  // ======================= EDGE =======================
  function Edge(id) {
    const m = new M(id, { name: 'Edge', sub: 'edges · pulse width', width: 220, stripe: STRIPE, family: 'logic' });
    base(m);
    m.p('width', { label: 'Width', min: 0, max: 1, def: 0, fmt: v => secs(2 * v * v * v) });
    m.p('inv', { label: 'Invert', steps: ['OFF', 'ON'], def: 0, small: true });
    const node = C.edgeNode(ioFor(m, { width: () => { const v = m.v('width'); return v < 0.09 ? 0 : 2 * v * v * v; }, invert: () => !!m.v('inv') }));
    attach(m, node, [['IN', 'gates, triggers or notes']]);
    m.outEvent('RISE', 'a trigger (or a Width-long gate) when the input turns on');
    m.outEvent('FALL', 'when the input turns off (a note ending, a gate closing)');
    m.outEvent('BOTH', 'on every change: doubles a gate into two hits');
    m.levels.GATE = levelOut(m, 'GATE', 'the input as a 0/1 level');
    m.layout = [{ custom: 'edge' }, { k: ['width', 'inv'], cls: 'kgrid c' }];
    return m;
  }

  // ======================= COMPARE =======================
  // Levels are computed by the audio graph itself (sample-exact, no JavaScript per sample): the difference A − B is
  // amplified enormously and squashed by a step curve, so the output is 0 or 1. The UP and DOWN events come from
  // reading the difference back on the main thread, so they arrive a fixed 40 ms late (or snap to the next 16th).
  const LAT = 0.04, BIG = 1e6;
  const SNAPS = ['OFF', '1/16', '1/8'];
  // the audio graph of COMPARE, built on any context (the page's, or an OfflineAudioContext in the tests)
  function compareGraph(ac) {
    const g = (v = 1) => { const n = ac.createGain(); n.gain.value = v; return n; };
    const k = (v = 0) => { const c = ac.createConstantSource(); c.offset.value = v; c.start(); return c; };
    const sh = curve => { const s = ac.createWaveShaper(); s.curve = curve; s.oversample = 'none'; return s; };
    const aIn = g(1), bIn = g(1), neg = g(-1), diff = g(1), thr = k(C.THRESH), thrG = g(1);
    aIn.connect(diff); bIn.connect(neg); thr.connect(thrG); thrG.connect(neg); neg.connect(diff);
    // GT and LT: huge gain then a 0/1 step
    const up = g(BIG), dn = g(-BIG), gt = sh(C.stepCurve(0)), lt = sh(C.stepCurve(0));
    diff.connect(up); diff.connect(dn); up.connect(gt); dn.connect(lt);
    // WIN: |A − B| within the window, made exactly 0/1 by a second step
    const win = sh(C.windowCurve(0.05)), half = k(-0.5), wb = g(1), wbig = g(BIG), wst = sh(C.stepCurve(0));
    diff.connect(win); win.connect(wb); half.connect(wb); wb.connect(wbig); wbig.connect(wst);
    return { aIn, bIn, thr, thrG, diff, gt, lt, wst, win };
  }
  function Compare(id) {
    const m = new M(id, { name: 'Compare', sub: 'threshold · window', width: 230, stripe: STRIPE, family: 'logic' });
    base(m);
    const { aIn, bIn, thr, thrG, diff, gt, lt, wst, win } = compareGraph(ctx);
    const an = ctx.createAnalyser(); an.fftSize = 2048; diff.connect(an);
    const buf = new Float32Array(2048);
    m.p('thr', { label: 'Thresh', min: -1, max: 1, def: (C.THRESH + 1) / 2, fmt: v => (v >= 0 ? '+' : '') + v.toFixed(2), apply: v => { thr.offset.setTargetAtTime(v, now(), 0.005); } });
    const wc = new Map();
    m.p('win', { label: 'Window', min: 0, max: 0.5, def: 0.1, fmt: v => '±' + v.toFixed(2), apply: v => { const q = Math.round(v * 200) / 200; if (!wc.has(q)) wc.set(q, C.windowCurve(q)); win.curve = wc.get(q); } });
    m.p('hyst', { label: 'Hyst', min: 0, max: 0.5, def: C.HYST / 0.5, fmt: v => '±' + v.toFixed(2) });
    m.p('snap', { label: 'Snap', steps: SNAPS, def: 0, small: true });
    m.inAudio('A', aIn, 'the signal to test (CV or audio)');
    m.inAudio('B', bIn, 'compare against this (while empty, the Thresh knob is B)');
    m.outAudio('GT', gt, '1 while A is above B', true); m.outAudio('LT', lt, '1 while A is below B', true); m.outAudio('WIN', wst, '1 while A is within ±Window of B', true);
    m.outEvent('UP', 'fires when A rises above B (Schmitt, 40 ms late or snapped)'); m.outEvent('DOWN', 'fires when A falls below B');
    // the Thresh knob stands in for B only while B is empty
    const syncB = () => { if (!m.disposed) thrG.gain.setTargetAtTime(patched(m, 'B') ? 0 : 1, now(), 0.005); };
    E.on('change', ev => { if (ev.cable?.to.mod === m.id && ev.cable.to.port === 'B' && E.mods[m.id] === m) syncB(); });
    const sch = new C.Schmitt(0, C.HYST);
    let lastRead = 0;
    m.diff = 0;
    m.tick = function (t0) {
      const sr = ctx.sampleRate, t = now();
      an.getFloatTimeDomainData(buf);
      const k = lastRead ? Math.min(buf.length, Math.round((t - lastRead) * sr)) : 0; lastRead = t;
      m.diff = buf[buf.length - 1];
      sch.hy = this.v('hyst');
      const snap = this.params.snap.choice, grid = snap === 'OFF' ? 0 : E.sixteenth() * (snap === '1/8' ? 2 : 1);
      for (let i = buf.length - k; i < buf.length; i++) {
        const s = sch.feed(buf[i]); if (!s) continue;
        let when = t - (buf.length - 1 - i) / sr + LAT;
        if (grid && E.running) { const ref = E.nextTime; when = ref - Math.floor((ref - when) / grid) * grid; }
        when = Math.max(when, t0 + 0.005);
        this.emit(s > 0 ? 'UP' : 'DOWN', { kind: 'trig', time: when, vel: 0.85 });
        (m.pulses[s > 0 ? 'UP' : 'DOWN'] = m.pulses[s > 0 ? 'UP' : 'DOWN'] || []).push(when);
      }
    };
    m.layout = [{ custom: 'compare' }, { k: ['thr', 'win', 'hyst', 'snap'], cls: 'kgrid' }];
    return m;
  }

  Object.assign(Mods.TYPES, {
    Logic: { label: 'Logic gate (AND OR XOR)', desc: 'combines gate/trigger/note streams A, B (and optional C) with AND, OR, XOR or ONEHOT; OUT fires when the function turns on and carries A\'s notes, INV when it turns off (NAND, NOR, XNOR; OR with only A patched = NOT); GATE/NGATE are 0/1 control signals for knobs. Use it to merge two trigger sources into one input (OR), make a new rhythm where two rhythms disagree (XOR), or only let notes through while a gate is open (AND)', prefix: 'logic', make: id => Logic(id) },
    Compare: { label: 'Compare (signals to logic)', desc: 'compares signal A with B, or with the Thresh knob while B is empty: GT, LT, WIN are 0/1 control signals (sample-exact), UP and DOWN are triggers when A crosses (Hyst stops chatter; Snap puts them on the 16th grid). Turns an LFO, attractor or Follower envelope into gates and fills', prefix: 'cmp', make: id => Compare(id) },
    Edge: { label: 'Edge detector / pulse shaper', desc: 'finds the edges of a gate or note stream: RISE when it turns on, FALL when it turns off (note-offs), BOTH on every change; Width turns those triggers into gates of a set length; GATE is the input as a 0/1 control signal', prefix: 'edge', make: id => Edge(id) }
  });

  // ---------------- panels ----------------
  const h = UI.h, fit = UI.fitCanvas, MONO = '9px JetBrains Mono, monospace';
  // a row of HIGH/LOW lamps: filled + "H" when high, hollow + "L" when low (readable without colour)
  function lamps(names) {
    const row = h('div', 'ledrow lglamps'), el = {};
    for (const n of names) { const c = h('div', 'ledcell'), d = h('span', 'lgled'), t = h('span', 'ledlbl', n), s = h('span', 'lghl', 'L'); c.append(d, t, s); row.append(c); el[n] = { d, s, v: -1 }; }
    return { row, set(n, v) { const x = el[n]; if (!x || x.v === v) return; x.v = v; x.d.classList.toggle('on', !!v); x.s.textContent = v ? 'H' : 'L'; } };
  }
  // the gate symbol for a function, drawn as SVG (ANSI shapes; a bubble for the inverted output)
  const SHAPES = {
    AND: 'M8 6 H26 A16 16 0 0 1 26 38 H8 Z',
    OR: 'M6 6 Q22 6 40 22 Q22 38 6 38 Q14 22 6 6 Z',
    XOR: 'M10 6 Q26 6 42 22 Q26 38 10 38 Q18 22 10 6 Z',
    ONEHOT: 'M10 6 Q26 6 42 22 Q26 38 10 38 Q18 22 10 6 Z'
  };
  function gateSvg() {
    const wrap = h('div', 'lgsym');
    wrap.innerHTML = '<svg viewBox="0 0 64 44" width="64" height="44" aria-hidden="true"><path class="g" d=""/><path class="x" d="M4 6 Q12 22 4 38" fill="none"/><circle class="b" cx="52" cy="22" r="3.2"/><text class="t" x="20" y="26"></text></svg>';
    const g = wrap.querySelector('.g'), x = wrap.querySelector('.x'), t = wrap.querySelector('.t');
    return { el: wrap, set(fn) { g.setAttribute('d', SHAPES[fn]); x.style.display = fn === 'XOR' || fn === 'ONEHOT' ? '' : 'none'; t.textContent = fn === 'ONEHOT' ? '=1' : ''; } };
  }
  // the timing strip: one row per trace over the last two seconds, the newest at the right
  function strip(g, w, H, rows, m) {
    const t1 = now(), span = 2, rh = (H - 4) / rows.length;
    g.clearRect(0, 0, w, H); g.font = MONO;
    rows.forEach(([label, key, col, kind], r) => {
      const y0 = 2 + r * rh, hi = y0 + 3, lo = y0 + rh - 3, X = t => 22 + (w - 24) * (1 - (t1 - t) / span);
      g.fillStyle = '#ffffff55'; g.fillText(label, 2, y0 + rh / 2 + 3);
      g.strokeStyle = col; g.lineWidth = 1.4; g.beginPath();
      if (kind === 'pulse') { g.moveTo(22, lo); g.lineTo(w, lo); for (const pt of m.pulses[key] || []) if (pt <= t1 && pt > t1 - span) { g.moveTo(X(pt), lo); g.lineTo(X(pt), hi); } }
      else { const tr = m.trace[key] || [[0, 0]]; let v = levelAt(tr, t1 - span); g.moveTo(22, v ? hi : lo); for (const [ct, cv] of tr) { if (ct <= t1 - span || ct > t1) continue; g.lineTo(X(ct), v ? hi : lo); v = cv; g.lineTo(X(ct), v ? hi : lo); } g.lineTo(w, v ? hi : lo); }
      g.stroke();
    });
  }
  const recent = (m, k, ms = 0.07) => (m.pulses[k] || []).some(t => t <= now() && t > now() - ms);

  UI.customs.logic = (m, el) => {
    const top = h('div', 'lgtop'), sym = gateSvg(), lcd = h('div', 'lcd'), c = h('canvas', 'scr'), lp = lamps(['A', 'B', 'C', 'OUT']);
    top.append(sym.el, lcd); el.append(top, c, lp.row);
    let cx = null;
    UI.anim(() => {
      trim(m);
      const fn = m.params.fn.choice, t = now(), hasC = patched(m, 'C');
      sym.set(fn);
      lcd.textContent = `${fn === 'ONEHOT' ? 'ONE-HOT' : fn}${hasC ? ' ×3' : ''} · INV = ${{ AND: 'NAND', OR: 'NOR', XOR: 'XNOR', ONEHOT: 'NOT 1-HOT' }[fn]}`;
      for (const k of ['A', 'B', 'C']) lp.set(k, levelAt(m.trace[k], t));
      lp.set('OUT', levelAt(m.trace.GATE, t));
      if (!cx) cx = fit(c, 54);
      strip(cx.g, cx.w, cx.h, [['A', 'A', '#e9e6dc'], ['B', 'B', '#7fc2a8'], ['OUT', 'GATE', '#ffb03b']], m);
    });
  };
  UI.customs.edge = (m, el) => {
    const c = h('canvas', 'scr'), lp = lamps(['IN', 'RISE', 'FALL']), lcd = h('div', 'lcd');
    el.append(lcd, c, lp.row);
    let cx = null;
    UI.anim(() => {
      trim(m);
      const w = m.v('width');
      lcd.textContent = `${w < 0.09 ? 'triggers' : 'gates ' + m.params.width.display()}${m.v('inv') ? ' · inverted' : ''}`;
      lp.set('IN', levelAt(m.trace.IN, now())); lp.set('RISE', recent(m, 'RISE') ? 1 : 0); lp.set('FALL', recent(m, 'FALL') ? 1 : 0);
      if (!cx) cx = fit(c, 54);
      strip(cx.g, cx.w, cx.h, [['IN', 'IN', '#e9e6dc'], ['R', 'RISE', '#ffb03b', 'pulse'], ['F', 'FALL', '#7fc2a8', 'pulse']], m);
    });
  };
  UI.customs.compare = (m, el) => {
    const c = h('canvas', 'scr'), lp = lamps(['GT', 'LT', 'WIN']);
    el.append(c, lp.row);
    let cx = null; const hist = [];
    UI.anim(() => {
      trim(m);
      const d = m.diff || 0, wv = m.v('win'), hy = m.v('hyst');
      lp.set('GT', d > 0 ? 1 : 0); lp.set('LT', d < 0 ? 1 : 0); lp.set('WIN', Math.abs(d) <= wv ? 1 : 0);
      hist.push(Math.max(-1, Math.min(1, d))); if (hist.length > 160) hist.shift();
      if (!cx) cx = fit(c, 64);
      const { g, w, h: H } = cx, Y = v => H / 2 - v * (H / 2 - 3);
      g.clearRect(0, 0, w, H);
      g.fillStyle = '#e0a83a1c'; g.fillRect(0, Y(wv), w, Y(-wv) - Y(wv)); // the window
      g.strokeStyle = '#ffffff33'; g.setLineDash([3, 3]); [hy, -hy].forEach(v => { g.beginPath(); g.moveTo(0, Y(v)); g.lineTo(w, Y(v)); g.stroke(); }); g.setLineDash([]);
      g.strokeStyle = '#ffb03b'; g.beginPath(); g.moveTo(0, Y(0)); g.lineTo(w, Y(0)); g.stroke();
      g.strokeStyle = '#e9e6dc'; g.lineWidth = 1.4; g.beginPath(); hist.forEach((v, i) => { const x = i / 159 * w; i ? g.lineTo(x, Y(v)) : g.moveTo(x, Y(v)); }); g.stroke();
      g.fillStyle = '#9ef0b7'; g.font = MONO; g.fillText(`A − ${patched(m, 'B') ? 'B' : 'thresh ' + m.params.thr.display()}`, 4, 10);
      if (recent(m, 'UP', 0.12)) { g.fillStyle = '#ffb03b'; g.fillText('▲ UP', w - 34, 10); }
      if (recent(m, 'DOWN', 0.12)) { g.fillStyle = '#7fc2a8'; g.fillText('▼ DOWN', w - 44, H - 4); }
    });
  };

  return { Logic, Edge, Compare, compareGraph, nodes };
})();
