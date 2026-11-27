// Unit tests for the logic core (src/logic.js). Run with: node --test tests/
// Fixtures are written as timing diagrams: one character per 16th step, "1" = high, "." = low.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../src/logic.js');

// a tiny harness: build a node, feed events, settle, and record what comes out
function rig(make, opts = {}) {
  const r = { emits: [], levels: {}, patched: new Set(opts.patched || ['A', 'B']) };
  const io = {
    emit: (port, ev) => { r.emits.push({ port, ev }); (r.links?.[port] || []).forEach(([n, p]) => L.deliver(n, p, ev)); },
    level: (port, v, t) => { (r.levels[port] = r.levels[port] || []).push([t, v]); },
    patched: p => r.patched.has(p),
    fn: () => r.fn || 'AND', pass: () => r.pass || 'A',
    width: () => r.width || 0, invert: () => !!r.invert
  };
  r.node = make(io);
  r.node.initLevels?.(0);
  r.nodes = [r.node];
  r.feed = (port, evs) => evs.forEach(e => L.deliver(r.node, port, e));
  r.settle = (h = Infinity) => L.settle(r.nodes, h);
  r.out = port => r.emits.filter(e => e.port === port).map(e => e.ev);
  r.row = (port, steps, sd = 0.125) => L.levelsToRow(r.levels[port] || [], steps, sd);
  return r;
}

test('contract: events are sanitized', () => {
  assert.equal(L.toEdge({ time: NaN }), null);
  assert.equal(L.toEdge(null), null);
  assert.deepEqual(L.toEdge({ time: 1 }), { t: 1, dur: L.TRIG, trig: true });
  assert.deepEqual(L.toEdge({ time: 1, dur: Infinity }), { t: 1, dur: L.TRIG, trig: true });
  assert.equal(L.toEdge({ time: 1, dur: 1e9 }).dur, 60);
  assert.equal(L.toEdge({ time: 1, dur: 1e-9 }).dur, 0.001);
  assert.equal(L.payloadOf({ vel: NaN }).vel, 0.8);
  assert.equal(L.toEdge({ kind: 'tick', time: 0, dur: 0.5 }).dur, 0.25, 'a clock tick is a 50% square wave');
});

test('Boolean functions: exhaustive truth tables for 1, 2 and 3 inputs', () => {
  for (let n = 1; n <= 3; n++) for (let i = 0; i < 1 << n; i++) {
    const ins = Array.from({ length: n }, (_, k) => !!(i >> k & 1)), k = ins.filter(Boolean).length;
    assert.equal(L.evalFn('AND', ins), k === n, `AND ${ins}`);
    assert.equal(L.evalFn('OR', ins), k > 0, `OR ${ins}`);
    assert.equal(L.evalFn('XOR', ins), k % 2 === 1, `XOR ${ins}`);
    assert.equal(L.evalFn('ONEHOT', ins), k === 1, `ONEHOT ${ins}`);
  }
});

test('truth table masks: every 3-input rule reproduces its own number', () => {
  for (let mask = 0; mask < 256; mask++) {
    let back = 0;
    for (let i = 0; i < 8; i++) if (L.truth(mask, [i & 1, i & 2, i & 4])) back |= 1 << i;
    assert.equal(back, mask);
  }
});

test('LOGIC XOR: the playground fixture gives 8 high steps of 16', () => {
  const r = rig(L.logicNode); r.fn = 'XOR';
  r.feed('A', L.rowToEvents('1.1.1.1.1.1.1.1.', 0.125, 0, true));
  r.feed('B', L.rowToEvents('1..1..1..1..1..1', 0.125, 0, true));
  r.settle();
  assert.equal(r.row('GATE', 16), '..111...111...11');
  assert.equal(r.row('NGATE', 16), '11...111...111..');
});

test('LOGIC: every function on gate rows, INV is the complement', () => {
  const A = '11001100', B = '10101010';
  const want = { AND: '1...1...', OR: '111.111.', XOR: '.11..11.', ONEHOT: '.11..11.' };
  for (const [fn, row] of Object.entries(want)) {
    const r = rig(L.logicNode); r.fn = fn;
    r.feed('A', L.rowToEvents(A, 0.125, 0, true)); r.feed('B', L.rowToEvents(B, 0.125, 0, true)); r.settle();
    assert.equal(r.row('GATE', 8), row, fn);
    assert.equal(r.row('NGATE', 8), row.replace(/[1.]/g, c => (c === '1' ? '.' : '1')), fn + ' inverted');
  }
});

test('LOGIC: three inputs when C is patched, two when it is not', () => {
  const run = (patched) => {
    const r = rig(L.logicNode, { patched }); r.fn = 'AND';
    r.feed('A', L.rowToEvents('1111', 0.125, 0, true)); r.feed('B', L.rowToEvents('1111', 0.125, 0, true));
    if (patched.includes('C')) r.feed('C', L.rowToEvents('.1.1', 0.125, 0, true));
    r.settle(); return r.row('GATE', 4);
  };
  assert.equal(run(['A', 'B']), '1111');
  assert.equal(run(['A', 'B', 'C']), '.1.1');
});

test('LOGIC: simultaneous triggers count as together; AND fires once with the right length', () => {
  const r = rig(L.logicNode); r.fn = 'AND';
  r.feed('A', [{ kind: 'trig', time: 1 }]); r.feed('B', [{ kind: 'trig', time: 1 }]);
  r.settle();
  const outs = r.out('OUT');
  assert.equal(outs.length, 1);
  assert.equal(outs[0].time, 1);
  assert.ok(Math.abs(outs[0].dur - L.TRIG) < 1e-9);
});

test('LOGIC: a trigger 20 ms after another does not coincide (wider than the 12 ms trigger)', () => {
  const r = rig(L.logicNode); r.fn = 'AND';
  r.feed('A', [{ kind: 'trig', time: 1 }]); r.feed('B', [{ kind: 'trig', time: 1.02 }]);
  r.settle();
  assert.equal(r.out('OUT').length, 0);
});

test('LOGIC: notes pass through with their pitch (payload from input A)', () => {
  const r = rig(L.logicNode); r.fn = 'AND';
  r.feed('A', [{ kind: 'note', time: 0, midi: 52, dur: 0.1, vel: 0.9, acc: 1 }]);
  r.feed('B', [{ kind: 'trig', time: 0, dur: 0.5 }]);
  r.settle();
  const [o] = r.out('OUT');
  assert.equal(o.kind, 'note'); assert.equal(o.midi, 52); assert.equal(o.acc, 1); assert.equal(o.vel, 0.9);
  assert.ok(Math.abs(o.dur - 0.1) < 1e-9);
});

test('LOGIC: a chord on A is one edge but every note passes', () => {
  const r = rig(L.logicNode); r.fn = 'OR';
  r.feed('A', [48, 52, 55].map(midi => ({ kind: 'note', time: 0, midi, dur: 0.2 })));
  r.settle();
  assert.deepEqual(r.out('OUT').map(e => e.midi), [48, 52, 55]);
  assert.equal(r.levels.GATE.length, 3); // the starting level, one rise, one fall
});

test('LOGIC: OR of overlapping gates is one gate whose length covers both', () => {
  const r = rig(L.logicNode); r.fn = 'OR';
  r.feed('A', [{ time: 0, dur: 0.2 }]); r.feed('B', [{ time: 0.1, dur: 0.3 }]);
  r.settle();
  const outs = r.out('OUT');
  assert.equal(outs.length, 1);
  assert.ok(Math.abs(outs[0].dur - 0.4) < 1e-9);
  assert.deepEqual(r.levels.GATE.slice(1), [[0, 1], [0.4, 0]]);
});

test('settle: the same result whether events arrive in one pass or spread over many', () => {
  const A = L.rowToEvents('1.11.1..11.1.1.1', 0.0625), B = L.rowToEvents('11..1.1.1..11..1', 0.0625, 0, true);
  const one = rig(L.logicNode); one.fn = 'XOR'; one.feed('A', A); one.feed('B', B); one.settle();
  const many = rig(L.logicNode); many.fn = 'XOR';
  // the real scheduler: every 25 ms, events up to 140 ms ahead arrive, then the logic settles to that horizon
  const pa = [...A], pb = [...B];
  for (let now = 0; now < 1.4; now += 0.025) {
    const hz = now + 0.14;
    while (pa.length && pa[0].time < hz) many.feed('A', [pa.shift()]);
    while (pb.length && pb[0].time < hz) many.feed('B', [pb.shift()]);
    many.settle(hz);
  }
  many.settle();
  assert.deepEqual(many.levels.GATE, one.levels.GATE);
  assert.deepEqual(many.out('OUT').map(e => e.time), one.out('OUT').map(e => e.time));
});

test('settle: inputs are processed in time order even when they arrive out of order', () => {
  const r = rig(L.logicNode); r.fn = 'XOR';
  r.feed('B', [{ time: 0.5, dur: 0.1 }]); r.feed('A', [{ time: 0.1, dur: 0.1 }]);
  r.settle();
  assert.deepEqual(r.levels.GATE.slice(1).map(x => x[0]), [0.1, 0.2, 0.5, 0.6]);
});

test('a late event is applied at once at its own time', () => {
  const r = rig(L.logicNode); r.fn = 'OR';
  r.feed('A', [{ time: 1, dur: 0.1 }]); r.settle(2);
  r.feed('B', [{ time: 0.5, dur: 0.1 }]); r.settle(2);
  assert.deepEqual(r.out('OUT').map(e => e.time), [1, 0.5]);
});

test('chains add no latency: LOGIC → LOGIC keeps the input time', () => {
  const a = rig(L.logicNode); a.fn = 'OR';
  const b = rig(L.logicNode); b.fn = 'AND';
  a.links = { OUT: [[b.node, 'A']] };
  a.nodes = b.nodes = [b.node, a.node]; // listed downstream first on purpose
  L.rankNodes(a.nodes, n => (n === a.node ? [b.node] : []));
  a.feed('A', [{ time: 0.25, dur: 0.1 }]);
  b.feed('B', [{ time: 0, dur: 1 }]);
  a.settle();
  assert.deepEqual(b.out('OUT').map(e => e.time), [0.25]);
  assert.deepEqual(b.levels.GATE.slice(1), [[0.25, 1], [0.35, 0]]);
});

test('between logic modules, a gate follows the real level even when it ends earlier than predicted', () => {
  // XOR's output is predicted to last until A falls, but B cuts it short; the downstream AND must see the cut
  const a = rig(L.logicNode); a.fn = 'XOR';
  const b = rig(L.logicNode); b.fn = 'AND';
  a.links = { OUT: [[b.node, 'A']] }; a.nodes = [a.node, b.node];
  L.rankNodes(a.nodes, n => (n === a.node ? [b.node] : []));
  a.feed('A', [{ time: 0, dur: 1 }]);
  b.feed('B', [{ time: 0, dur: 2 }]);
  a.settle(0.3);
  a.feed('B', [{ time: 0.4, dur: 0.1 }]); // arrives later, cuts XOR at 0.4
  a.settle();
  assert.deepEqual(b.levels.GATE.slice(1), [[0, 1], [0.4, 0], [0.5, 1], [1, 0]]);
});

test('feedback: NOT patched into itself oscillates with a 1 ms gate delay and stays under the cap', () => {
  const r = rig(L.logicNode, { patched: ['A', 'B'] }); r.fn = 'OR';
  r.links = { INV: [[null, 'A']] };
  r.links.INV[0][0] = r.node; // INV → A of the same module
  L.rankNodes(r.nodes, n => [n]);
  r.feed('B', [{ time: 0, dur: 0.01 }]); // a kick to start it
  r.settle(0.05);
  const rises = r.levels.GATE.filter(([, v]) => v === 1).map(([t]) => t);
  // after the kick ends at 10 ms the output toggles every 1 ms: high 1 ms, low 1 ms → 500 Hz
  const later = rises.filter(t => t > 0.0105);
  assert.ok(later.length >= 15, 'it oscillates');
  for (let i = 1; i < later.length; i++) assert.ok(Math.abs(later[i] - later[i - 1] - 0.002) < 1e-9, 'period is 2 ms');
  r.settle(10); // a long run is cut by the per-pass cap instead of freezing
  assert.ok(r.emits.length < 3 * L.MAX_EVENTS);
});

test('ranking: upstream first, feedback edges ignored', () => {
  const n = ['a', 'b', 'c'].map(name => L.makeNode({}, () => {}, { name }));
  const succ = { a: [n[1]], b: [n[2]], c: [n[0]] };
  const back = L.rankNodes(n, x => succ[x.name]);
  assert.equal(back, 1);
  assert.deepEqual(n.map(x => x.rank), [0, 1, 2]);
});

test('LOGIC: turning the function knob re-evaluates without any new input', () => {
  const r = rig(L.logicNode); r.fn = 'AND';
  r.feed('A', [{ time: 0, dur: 1 }]); r.settle(0.5);
  assert.deepEqual(r.levels.GATE, [[0, 0]]);
  r.fn = 'OR'; L.poke(r.node, 0.5); r.settle();
  assert.deepEqual(r.levels.GATE, [[0, 0], [0.5, 1], [1, 0]]);
});

test('closePort: pulling a cable ends what was still high', () => {
  const r = rig(L.logicNode); r.fn = 'OR';
  r.feed('A', [{ time: 0, dur: 5 }]); r.settle(1);
  L.closePort(r.node, 'A', 1.5); r.settle();
  assert.deepEqual(r.levels.GATE.slice(1), [[0, 1], [1.5, 0]]);
});

test('EDGE: rise, fall and both, with width and invert', () => {
  const r = rig(L.edgeNode);
  r.feed('IN', L.rowToEvents('11..1.111..', 0.1, 0, true)); r.settle();
  const t = p => r.out(p).map(e => +e.time.toFixed(6));
  assert.deepEqual(t('RISE'), [0, 0.4, 0.6]);
  assert.deepEqual(t('FALL'), [0.2, 0.5, 0.9]);
  assert.deepEqual(t('BOTH'), [0, 0.2, 0.4, 0.5, 0.6, 0.9]);
  assert.equal(r.out('RISE')[0].dur, undefined, 'width 0 gives triggers');
  const w = rig(L.edgeNode); w.width = 0.05; w.invert = true;
  w.feed('IN', [{ time: 0, dur: 0.2 }]); w.settle();
  assert.deepEqual(w.out('RISE').map(e => e.time), [0.2]);
  assert.deepEqual(w.out('FALL').map(e => e.time), [0]);
  assert.equal(w.out('RISE')[0].dur, 0.05);
});

test('EDGE: overlapping gates merge, so FALL fires once', () => {
  const r = rig(L.edgeNode);
  r.feed('IN', [{ time: 0, dur: 0.3 }, { time: 0.1, dur: 0.4 }, { time: 0.5, dur: 0.1 }]); r.settle();
  assert.deepEqual(r.out('FALL').map(e => e.time), [0.6]);
  assert.equal(r.out('RISE').length, 1);
});

test('Schmitt: exact boundaries at threshold ± hysteresis', () => {
  const s = new L.Schmitt(0.1, 0.05);
  assert.equal(s.feed(0.15), 0); assert.equal(s.feed(0.1501), 1);
  assert.equal(s.feed(0.0501), 0); assert.equal(s.feed(0.05), 0); assert.equal(s.feed(0.0499), -1);
  assert.equal(s.feed(NaN), 0);
});

test('seeded randomness repeats', () => {
  const a = L.rng(42), b = L.rng(42);
  for (let i = 0; i < 100; i++) assert.equal(a(), b());
});

test('comparator curves are exactly 0/1', () => {
  const c = L.stepCurve(0.1);
  assert.ok(c.every(v => v === 0 || v === 1));
  assert.equal(c[Math.round((0.0995 + 1) / 2 * 4096)], 0);
  assert.equal(c[Math.round((0.1006 + 1) / 2 * 4096)], 1);
  const w = L.windowCurve(0.05);
  assert.equal(w[2048], 1); assert.equal(w[0], 0);
});

test('long run: history does not grow', () => {
  const r = rig(L.logicNode); r.fn = 'XOR';
  for (let bar = 0; bar < 2000; bar++) {
    const t0 = bar * 2;
    r.feed('A', L.rowToEvents('1.1.1.1.1.1.1.1.', 0.125, t0)); r.feed('B', L.rowToEvents('1..1..1..1..1..1', 0.125, t0, true));
    r.settle(t0 + 2);
    r.emits.length = 0; r.levels = {};
  }
  assert.ok(r.node.inbox.length < 10);
  assert.ok(r.node.active.A.length <= 1 && r.node.active.B.length <= 1);
});
