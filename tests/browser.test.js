// Browser tests: load the real page in headless Chromium (Playwright) and check signals sample by sample with
// OfflineAudioContext. Run with: node --test tests/   (skipped when Playwright is not installed)
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http'), fs = require('fs'), path = require('path');
let chromium = null;
try { ({ chromium } = require('playwright')); } catch (e) { /* not installed */ }
const ROOT = path.join(__dirname, '..');
const TYPES = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.webp': 'image/webp', '.json': 'application/json' };

test('browser', { skip: !chromium && 'playwright is not installed' }, async t => {
  const srv = http.createServer((q, r) => {
    const u = decodeURIComponent(q.url.split('?')[0]), f = path.join(ROOT, u === '/' ? 'index.html' : u);
    if (!f.startsWith(ROOT)) { r.statusCode = 403; return r.end(); }
    fs.readFile(f, (e, d) => { if (e) { r.statusCode = 404; return r.end(); } r.setHeader('content-type', TYPES[path.extname(f)] || 'application/octet-stream'); r.end(d); });
  });
  await new Promise(res => srv.listen(0, res));
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  await page.goto(`http://localhost:${srv.address().port}/`);
  await page.waitForFunction(() => typeof Engine !== 'undefined' && typeof UI !== 'undefined' && typeof LogicMods !== 'undefined' && typeof Layers !== 'undefined', null, { timeout: 20000 });
  try {
    await t.test('COMPARE levels are exactly 0/1 and switch on the right sample (44.1, 48, 96 kHz)', async () => {
      const r = await page.evaluate(async () => {
        const out = [];
        for (const sr of [44100, 48000, 96000]) {
          const n = sr / 10, ac = new OfflineAudioContext(3, n, sr), G = LogicMods.compareGraph(ac);
          // A: a ramp from -1 to +1 over the render; threshold 0.25 (B empty)
          const ramp = ac.createConstantSource(); ramp.offset.setValueAtTime(-1, 0); ramp.offset.linearRampToValueAtTime(1, n / sr); ramp.start(); ramp.connect(G.aIn);
          G.thr.offset.value = 0.25;
          const merge = ac.createChannelMerger(3); G.gt.connect(merge, 0, 0); G.lt.connect(merge, 0, 1); G.wst.connect(merge, 0, 2); merge.connect(ac.destination);
          const b = await ac.startRendering(), gt = b.getChannelData(0), lt = b.getChannelData(1), win = b.getChannelData(2);
          let nonBinary = 0, firstGT = -1, lastLT = -1, winN = 0;
          for (let i = 0; i < n; i++) { for (const v of [gt[i], lt[i], win[i]]) if (v !== 0 && v !== 1) nonBinary++; if (gt[i] === 1 && firstGT < 0) firstGT = i; if (lt[i] === 1) lastLT = i; if (win[i]) winN++; if (gt[i] && lt[i]) nonBinary += 1000; }
          // the ramp crosses 0.25 at 62.5% of the render; the window ±0.05 covers 5% of it
          out.push({ sr, nonBinary, firstGT, expect: Math.round(0.625 * n), lastLT, winShare: winN / n });
        }
        return out;
      });
      for (const x of r) {
        assert.equal(x.nonBinary, 0, `${x.sr}: only 0 or 1, never both`);
        assert.ok(Math.abs(x.firstGT - x.expect) <= 1, `${x.sr}: GT turns on at sample ${x.firstGT}, expected ${x.expect}`);
        assert.ok(x.lastLT < x.firstGT && x.firstGT - x.lastLT <= 2, `${x.sr}: LT hands over to GT`);
        assert.ok(Math.abs(x.winShare - 0.05) < 0.002, `${x.sr}: window share ${x.winShare}`);
      }
    });

    await t.test('LOGIC GATE level lands on the exact sample of each edge (44.1, 48, 96 kHz)', async () => {
      const r = await page.evaluate(async () => {
        const C = LogicCore, out = [];
        for (const sr of [44100, 48000, 96000]) {
          const ac = new OfflineAudioContext(1, sr * 2, sr), src = ac.createConstantSource(); src.offset.value = 0; src.start(); src.connect(ac.destination);
          const edges = [];
          const node = C.logicNode({ emit() {}, level: (p, v, t) => { if (p === 'GATE') { src.offset.setValueAtTime(v, t); edges.push([t, v]); } }, patched: p => p !== 'C', fn: () => 'XOR', pass: () => 'A' });
          C.rowToEvents('1.1.1.1.1.1.1.1.', 0.125, 0, true).forEach(e => C.deliver(node, 'A', e));
          C.rowToEvents('1..1..1..1..1..1', 0.125, 0, true).forEach(e => C.deliver(node, 'B', e));
          C.settle([node], Infinity);
          const d = (await ac.startRendering()).getChannelData(0);
          let bad = 0; for (const [t, v] of edges) { const i = Math.round(t * sr); if (i >= d.length) continue; if (d[i] !== v || (i > 0 && d[i - 1] === v && edges.length > 1 && t > 0)) bad++; }
          let row = ''; for (let s = 0; s < 16; s++) row += d[Math.floor((s + 0.5) * 0.125 * sr)] ? '1' : '.';
          out.push({ sr, bad, row });
        }
        return out;
      });
      for (const x of r) { assert.equal(x.bad, 0, `${x.sr}: edges on their sample`); assert.equal(x.row, '..111...111...11', `${x.sr}`); }
    });

    await t.test('regression: every module type builds, patches and removes cleanly', async () => {
      const r = await page.evaluate(() => {
        const E = Engine, made = [], failed = [];
        for (const type of Object.keys(Mods.TYPES)) {
          if (type === 'Tape') continue;
          try {
            const id = E.within(0, () => UI.createModule(type));
            const m = E.mods[id]; made.push(type);
            const evIn = Object.keys(m.ins).find(k => m.ins[k].kind === 'ev');
            if (evIn) E.connect({ mod: 'clock', port: 'CLK' }, { mod: id, port: evIn });
            UI.removeModule(id, true);
          } catch (e) { failed.push(type + ': ' + e.message); }
        }
        return { made: made.length, failed };
      });
      assert.deepEqual(r.failed, []);
      assert.ok(r.made > 40, `built ${r.made} module types`);
    });

    await t.test('regression: Toolbox AND / OR / XOR behave as before', async () => {
      const r = await page.evaluate(() => {
        const E = Engine, id = UI.createModule('Toolbox'), m = E.mods[id], got = { AND: [], OR: [], XOR: [] };
        for (const k of Object.keys(got)) m.outs[k].targets.push({ handler: e => got[k].push(+e.time.toFixed(3)) });
        const T = E.ctx.currentTime + 10;
        m.ins.A.handler({ time: T }); m.ins.B.handler({ time: T + 0.005 }); m.ins.A.handler({ time: T + 0.2 });
        m.tick(T + 0.5);
        UI.removeModule(id, true);
        return { got, T: +T.toFixed(3) };
      });
      const T = r.T, f = x => +x.toFixed(3);
      assert.deepEqual(r.got.AND, [f(T + 0.005)]);
      assert.deepEqual(r.got.OR, [f(T + 0.005), f(T + 0.2)]);
      assert.deepEqual(r.got.XOR, [f(T + 0.2)]);
    });

    await t.test('live: clock → LOGIC → EDGE and COMPARE play in time, and survive a layer copy', async () => {
      const r = await page.evaluate(async () => {
        const E = Engine; await E.ctx.resume(); E.start();
        const lg = UI.createModule('Logic'), ed = UI.createModule('Edge'), cmp = UI.createModule('Compare');
        const L = E.mods[lg]; L.params.fn.setNorm(L.params.fn.normOf('XOR'));
        E.connect({ mod: 'clock', port: 'BEAT' }, { mod: lg, port: 'A' });
        E.connect({ mod: 'clock', port: 'BAR' }, { mod: lg, port: 'B' });
        E.connect({ mod: lg, port: 'OUT' }, { mod: ed, port: 'IN' });
        E.connect({ mod: lg, port: 'GATE' }, { mod: cmp, port: 'A' });
        const got = { OUT: [], RISE: [], UP: [], late: 0 };
        L.outs.OUT.targets.push({ handler: e => { got.OUT.push(e.time); if (e.time < E.ctx.currentTime) got.late++; } });
        E.mods[ed].outs.RISE.targets.push({ handler: e => got.RISE.push(e.time) });
        E.mods[cmp].outs.UP.targets.push({ handler: e => got.UP.push(e.time) });
        await new Promise(r => setTimeout(r, 3000));
        Layers.duplicate(0, 1);
        const copied = E.within(1, () => E.mods[lg] && E.mods[lg].params.fn.choice);
        const beat = 60 / E.bpm, gaps = got.OUT.slice(1).map((t, i) => t - got.OUT[i]);
        Layers.clear(1); [lg, ed, cmp].forEach(id => UI.removeModule(id, true)); E.stop();
        return { n: got.OUT.length, rise: got.RISE.length, up: got.UP.length, late: got.late, beat, gaps, copied, sameTimes: got.OUT.every((t, i) => Math.abs(t - got.RISE[i]) < 1e-9) };
      });
      // XOR of the beat (half-beat square) with the bar (half-bar square): fires on beats in the second half of each bar
      // and on the off-beat halves in the first: never on the same time twice, always a whole half-beat apart
      assert.ok(r.n >= 4, `OUT fired ${r.n} times`);
      assert.equal(r.late, 0, 'no output was sent after its own time');
      assert.ok(r.gaps.every(g => Math.abs(g / (r.beat / 2) - Math.round(g / (r.beat / 2))) < 1e-6), 'outputs land on the half-beat grid');
      assert.ok(r.sameTimes && r.rise === r.n, 'EDGE.RISE has the same times as LOGIC.OUT (no latency)');
      assert.ok(r.up >= 1, 'COMPARE saw the gate level');
      assert.equal(r.copied, 'XOR', 'the layer copy kept the function');
    });

    await t.test('no console errors', () => { assert.deepEqual(errors, []); });
  } finally {
    await browser.close(); srv.close();
  }
});
