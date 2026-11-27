// logic.js — the shared core of the logic modules (LOGIC, COMPARE, EDGE and later ones). Pure JavaScript: no DOM
// and no Web Audio, so the same file runs in the page and under `node --test` (tests/).
//
// The signal contract lives here, once:
//  - Edges travel as events (green jacks); levels travel as 0/1 signals on CV jacks.
//  - An event input is HIGH from ev.time for ev.dur. An event with no dur is a trigger: HIGH for TRIG seconds.
//  - Signal inputs are HIGH above THRESH, with ±HYST hysteresis where the module keeps state.
//  - Same-time inputs are applied RESET first, then data, then clock (port priority 0, 1, 2).
//  - Outputs keep their input's timestamp, so chains of logic add no latency.
//
// The settle loop: logic modules never react inside their input handlers. A handler files the event in that
// module's inbox; once per scheduler pass, after every ordinary module has ticked, settle() repeatedly processes
// the logic node holding the earliest input (ties go to the node earlier in the patch graph). So fan-in sees its
// inputs in true time order, and a feedback loop takes a fixed FB_DELAY instead of looping forever.
'use strict';
const LogicCore = (() => {
  const TRIG = 0.012;      // trigger width (s): the same coincidence window Toolbox's logic uses
  const EPS = 1e-6;        // events closer than this are the same instant
  const FB_DELAY = 0.001;  // propagation delay of an output fed back into its own chain (s)
  const MAX_EVENTS = 512;  // per node per pass: keeps a runaway feedback patch from freezing the page
  const THRESH = 0.1, HYST = 0.05;
  const MIN_DUR = 0.001, MAX_DUR = 60, UNKNOWN_DUR = 2;

  const fin = x => typeof x === 'number' && Number.isFinite(x);
  // sanitize an incoming event per the contract; null = drop it
  function toEdge(ev) {
    if (!ev || !fin(ev.time)) return null;
    const trig = !(fin(ev.dur) && ev.dur > 0);
    // a clock tick's dur is its period, so a clock reads as a square wave: high for the first half of each period
    const d = ev.kind === 'tick' ? ev.dur / 2 : ev.dur;
    const dur = trig ? TRIG : Math.min(MAX_DUR, Math.max(MIN_DUR, d));
    return { t: ev.time, dur, trig };
  }
  // the payload an output forwards: the musical fields of the event that caused it
  function payloadOf(ev) {
    if (!ev) return {};
    const p = {};
    for (const k of ['midi', 'deg', 'acc', 'slide', 'inst', 'pos']) if (ev[k] !== undefined) p[k] = ev[k];
    p.vel = fin(ev.vel) ? ev.vel : 0.8;
    if (ev.kind === 'note') p.kind = 'note';
    return p;
  }
  // build an output event at time t; dur undefined = a trigger
  function outEvent(payload, t, dur) {
    const ev = { ...payload, kind: payload.kind === 'note' ? 'note' : 'trig', time: t };
    if (dur !== undefined) ev.dur = dur; else if (ev.kind === 'note') ev.dur = 0.12;
    return ev;
  }

  // ---------------- nodes and the inbox ----------------
  // ports: { A: { type: 'level', pri: 1 }, CLK: { type: 'edge', pri: 2 }, RST: { type: 'edge', pri: 0 } }
  // A 'level' port turns each event into a rise at t and a fall at t + dur, counted so overlapping gates merge.
  // An 'edge' port delivers the event itself and nothing else.
  function makeNode(ports, update, opt = {}) {
    const n = { ports, update, inbox: [], lastT: -Infinity, rank: 0, cnt: {}, active: {}, alive: true, name: opt.name || '' };
    for (const k in ports) { n.cnt[k] = 0; n.active[k] = []; }
    n.level = k => n.cnt[k] > 0;
    return n;
  }
  let seq = 0;
  function insert(n, e) {
    e.s = seq++;
    const a = n.inbox; let lo = 0, hi = a.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (before(a[mid], e)) lo = mid + 1; else hi = mid; }
    a.splice(lo, 0, e);
  }
  // order inside an inbox: time, then falls before rises (so back-to-back gates merge), then port priority
  const before = (x, y) => x.t < y.t - EPS || (Math.abs(x.t - y.t) <= EPS && (x.o < y.o || (x.o === y.o && (x.pri < y.pri || (x.pri === y.pri && x.s < y.s)))));

  let processing = null; // the node being processed right now (so a delivery can tell it is feedback)
  // Gates sent from one logic node to another follow the sender's real level: the receiver files the rise with an
  // open end, and the sender closes it (endGate) when its output actually falls. Other modules get the best-known dur.
  const opens = new WeakMap(); // output event → [{ n, entry, d }]
  const markOpen = ev => { Object.defineProperty(ev, '_open', { value: true, enumerable: false }); return ev; };
  function endGate(ev, t) {
    const list = opens.get(ev); if (!list) return;
    opens.delete(ev);
    for (const { n, entry, d } of list) { const i = n.inbox.indexOf(entry); if (i < 0) continue; n.inbox.splice(i, 1); entry.t = t + d; insert(n, entry); }
  }
  // file an event in a node's inbox
  function deliver(n, port, ev) {
    const P = n.ports[port]; if (!P || !n.alive) return false;
    const e = toEdge(ev); if (!e) return false;
    let t = e.t;
    // feedback: an output of this pass arriving at a node that already processed that instant (or is upstream of
    // the sender) is delayed by one gate delay, as in a real circuit
    if (processing && n.rank <= processing.rank && t <= n.lastT + EPS) t = n.lastT + FB_DELAY;
    if (P.type === 'level') {
      insert(n, { t, o: 1, pri: P.pri, port, kind: 'rise', ev, trig: e.trig });
      const fall = { t: ev._open ? Infinity : t + e.dur, o: 0, pri: P.pri, port, kind: 'fall', ev };
      insert(n, fall);
      if (ev._open) { if (!opens.has(ev)) opens.set(ev, []); opens.get(ev).push({ n, entry: fall, d: t - e.t }); }
    } else insert(n, { t, o: 1, pri: P.pri, port, kind: 'edge', ev, trig: e.trig });
    return true;
  }
  // re-evaluate a node at time t without an input (a knob changed its function)
  function poke(n, t) { insert(n, { t: Math.max(t, n.lastT), o: 2, pri: 9, port: null, kind: 'poke' }); }
  // a cable was pulled out of a level input: everything still high there ends at t
  function closePort(n, port, t) {
    const moved = n.inbox.filter(e => e.port === port && e.kind === 'fall' && e.t > t);
    for (const e of moved) { n.inbox.splice(n.inbox.indexOf(e), 1); e.t = Math.max(t, n.lastT); insert(n, e); }
  }

  // process every entry of node n at its earliest instant (one batch)
  function step(n) {
    const t0 = n.inbox[0].t, batch = [];
    while (n.inbox.length && n.inbox[0].t <= t0 + EPS) batch.push(n.inbox.shift());
    for (const e of batch) {
      if (e.kind === 'rise') { n.cnt[e.port]++; n.active[e.port].push(e.ev); }
      else if (e.kind === 'fall') { n.cnt[e.port] = Math.max(0, n.cnt[e.port] - 1); const a = n.active[e.port], i = a.indexOf(e.ev); if (i >= 0) a.splice(i, 1); }
    }
    n.lastT = Math.max(n.lastT, t0);
    processing = n;
    try { n.update(t0, batch, n); } finally { processing = null; }
  }
  // Walk the levels forward through what is already known (queued rises and falls) and return the first time at
  // which pred(levels) is false. Used for the best-known duration of an output gate.
  function until(n, pred, from) {
    const cnt = { ...n.cnt }, lv = k => cnt[k] > 0;
    let i = 0; const a = n.inbox;
    while (i < a.length) {
      const t = a[i].t;
      for (; i < a.length && a[i].t <= t + EPS; i++) { const e = a[i]; if (e.kind === 'rise') cnt[e.port]++; else if (e.kind === 'fall') cnt[e.port] = Math.max(0, cnt[e.port] - 1); }
      if (t > from + EPS && !pred(lv)) return t;
    }
    return Infinity;
  }
  const durUntil = (n, pred, t) => { const end = until(n, pred, t); return end === Infinity ? UNKNOWN_DUR : Math.max(MIN_DUR, end - t); };

  // rank nodes so that, at the same instant, upstream nodes run first. succ(n) lists the nodes n feeds.
  // Edges that close a loop are ignored for ranking (they are the feedback edges).
  function rankNodes(nodes, succ) {
    const color = new Map(), back = new Map(), order = [], inSet = new Set(nodes);
    const isBack = (a, b) => back.get(a)?.has(b);
    const visit = n => {
      color.set(n, 1);
      for (const m of succ(n)) { if (!inSet.has(m)) continue; const c = color.get(m); if (c === 1) { if (!back.has(n)) back.set(n, new Set()); back.get(n).add(m); } else if (!c) visit(m); }
      color.set(n, 2); order.push(n);
    };
    for (const n of nodes) if (!color.get(n)) visit(n);
    order.reverse(); // topological order of the graph without back edges
    for (const n of nodes) n.rank = 0;
    for (const n of order) for (const m of succ(n)) if (inSet.has(m) && !isBack(n, m)) m.rank = Math.max(m.rank, n.rank + 1);
    let k = 0; for (const s of back.values()) k += s.size; return k;
  }

  // process all logic nodes up to `horizon`, earliest input first
  function settle(nodes, horizon) {
    const counts = new Map();
    for (;;) {
      let best = null;
      for (const n of nodes) {
        if (!n.alive || !n.inbox.length) continue;
        const t = n.inbox[0].t; if (t > horizon) continue;
        if ((counts.get(n) || 0) >= MAX_EVENTS) continue;
        if (!best || t < best.inbox[0].t - EPS || (Math.abs(t - best.inbox[0].t) <= EPS && n.rank < best.rank)) best = n;
      }
      if (!best) break;
      counts.set(best, (counts.get(best) || 0) + 1);
      step(best);
    }
    // a node that hit the cap drops what it could not process this pass, so it cannot fall further behind
    for (const [n, c] of counts) if (c >= MAX_EVENTS) n.inbox = n.inbox.filter(e => e.t > horizon);
  }

  // ---------------- small primitives ----------------
  // Boolean functions over a list of input levels
  const FUNCS = ['AND', 'OR', 'XOR', 'ONEHOT'];
  function evalFn(fn, ins) {
    let k = 0; for (const v of ins) if (v) k++;
    if (fn === 'AND') return ins.length > 0 && k === ins.length;
    if (fn === 'OR') return k > 0;
    if (fn === 'XOR') return (k & 1) === 1;
    if (fn === 'ONEHOT') return k === 1;
    return false;
  }
  // an n-input truth table as a bitmask: bit i is the output for inputs whose binary value is i (A = bit 0)
  const truth = (mask, ins) => { let i = 0; ins.forEach((v, k) => { if (v) i |= 1 << k; }); return ((mask >>> i) & 1) === 1; };
  // threshold with hysteresis: rises above th + hy, falls below th - hy
  class Schmitt {
    constructor(th = THRESH, hy = HYST) { this.th = th; this.hy = hy; this.state = false; }
    feed(x) {
      if (!fin(x)) x = 0;
      if (!this.state && x > this.th + this.hy) { this.state = true; return 1; }
      if (this.state && x < this.th - this.hy) { this.state = false; return -1; }
      return 0;
    }
  }
  // small seeded generator (mulberry32) for repeatable randomness
  function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  // a step curve for a WaveShaper: input x (-1..1) → 1 when x > th, else 0 (the audio-rate comparator)
  function stepCurve(th, n = 4097, lo = 0, hi = 1) { const c = new Float32Array(n); for (let i = 0; i < n; i++) { const x = i / (n - 1) * 2 - 1; c[i] = x > th ? hi : lo; } return c; }
  // window curve: 1 when |x| <= w (x is A - B), else 0
  function windowCurve(w, n = 4097) { const c = new Float32Array(n); for (let i = 0; i < n; i++) { const x = i / (n - 1) * 2 - 1; c[i] = Math.abs(x) <= w + 1e-9 ? 1 : 0; } return c; }

  // ---------------- behaviours (the module logic, separate from panels and audio) ----------------
  // LOGIC: up to three gate inputs, one Boolean function, OUT / INV events and GATE / NGATE levels.
  // io = { emit(port, ev), level(port, v, t), fn() → 'AND'|'OR'|'XOR'|'ONEHOT', pass() → 'A'|'LAST', patched(port) }
  function logicNode(io) {
    let out = null, openOut = [];
    const ins = lv => { const a = [lv('A'), lv('B')]; if (io.patched('C')) a.push(lv('C')); return a; };
    const f = lv => evalFn(io.fn(), ins(lv));
    const n = makeNode({ A: { type: 'level', pri: 1 }, B: { type: 'level', pri: 1 }, C: { type: 'level', pri: 1 } }, (t, batch, n) => {
      const v = f(n.level);
      if (out === null) out = f(() => false);
      if (v === out) return;
      out = v;
      for (const ev of openOut) endGate(ev, t);
      openOut = [];
      io.level('GATE', v ? 1 : 0, t); io.level('NGATE', v ? 0 : 1, t);
      const dur = durUntil(n, lv => f(lv) === v, t);
      const port = v ? 'OUT' : 'INV';
      // payload: what rose on the pass input right now, else what is still sounding there, else the latest rise
      const passPort = io.pass() === 'A' ? 'A' : null;
      let srcs = batch.filter(e => e.kind === 'rise' && (!passPort || e.port === passPort)).map(e => e.ev);
      if (!srcs.length && passPort) srcs = n.active[passPort].slice(-1);
      if (!srcs.length) { const any = batch.filter(e => e.kind === 'rise').map(e => e.ev); srcs = any.length ? any.slice(-1) : [n.active.A.at(-1) || n.active.B.at(-1) || n.active.C.at(-1)].filter(Boolean); }
      if (!srcs.length) srcs = [null];
      for (const ev of srcs) { const o = markOpen(outEvent(payloadOf(ev), t, dur)); openOut.push(o); io.emit(port, o); }
    }, { name: 'logic' });
    n.out = () => out;
    // write the starting levels (all inputs low): NGATE is high for AND, OR and XOR
    n.initLevels = t => { out = f(() => false); io.level('GATE', out ? 1 : 0, t); io.level('NGATE', out ? 0 : 1, t); };
    return n;
  }
  // EDGE: rising, falling and both edges of a gate stream; Width turns them into gates; Invert swaps rise and fall.
  // io = { emit, level, width() → seconds (0 = trigger), invert() → bool }
  function edgeNode(io) {
    let high = false, lastEv = null;
    const n = makeNode({ IN: { type: 'level', pri: 1 } }, (t, batch, n) => {
      const v = n.level('IN');
      const rose = batch.filter(e => e.kind === 'rise').map(e => e.ev);
      if (rose.length) lastEv = rose.at(-1);
      if (v === high) return;
      high = v; io.level('GATE', v ? 1 : 0, t);
      const w = io.width(), dur = w > 0 ? w : undefined;
      const isRise = v !== !!io.invert();
      const srcs = v && rose.length ? rose : [lastEv];
      for (const ev of srcs) {
        const o = outEvent(payloadOf(ev), t, dur);
        io.emit(isRise ? 'RISE' : 'FALL', o); io.emit('BOTH', { ...o });
      }
    }, { name: 'edge' });
    return n;
  }

  // ---------------- timing-diagram fixtures (tests and docs) ----------------
  // "1.1.1..." → events at step times; a run of 1s is one gate spanning those steps
  function rowToEvents(row, stepDur = 0.125, t0 = 0, gates = false) {
    const evs = []; const s = row.replace(/\s/g, '');
    for (let i = 0; i < s.length; i++) {
      if (s[i] !== '1') continue;
      if (gates) { let j = i; while (j + 1 < s.length && s[j + 1] === '1') j++; evs.push({ kind: 'trig', time: t0 + i * stepDur, dur: (j - i + 1) * stepDur }); i = j; }
      else evs.push({ kind: 'trig', time: t0 + i * stepDur });
    }
    return evs;
  }
  // sample a list of [t, v] level changes at the middle of each step → "1"/"." row
  function levelsToRow(changes, steps, stepDur = 0.125, t0 = 0) {
    let s = '';
    for (let i = 0; i < steps; i++) { const t = t0 + (i + 0.5) * stepDur; let v = 0; for (const [ct, cv] of changes) if (ct <= t + EPS) v = cv; s += v ? '1' : '.'; }
    return s;
  }

  return { TRIG, EPS, FB_DELAY, MAX_EVENTS, THRESH, HYST, UNKNOWN_DUR, FUNCS, toEdge, payloadOf, outEvent, makeNode, deliver, endGate, closePort, poke, step, until, durUntil, rankNodes, settle, evalFn, truth, Schmitt, rng, stepCurve, windowCurve, logicNode, edgeNode, rowToEvents, levelsToRow };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = LogicCore;
