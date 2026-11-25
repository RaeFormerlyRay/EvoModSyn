// prime.js — daily-run module (2026-11-25): Prime, a four-channel rhythm generator in the spirit of trigger
// "repetitors" (Noise Engineering Multi Repetitor) and Euclidean sequencers. A Prime knob scrolls through banks of
// base rhythms (Euclidean, numeric, world timelines, breakbeat ghosts); each channel has a performance fader that
// reshapes its own version of the rhythm (density, rotation, a neighbouring rhythm, the off-beats). Four trigger
// and four accent outputs, plus ALL: one cable that plays all four channels on the drum machine with instrument tags.
'use strict';
const Prime = (() => {
  const E = Engine, ctx = E.ctx, { clamp } = DSP, M = E.Module;
  const pct = v => Math.round(v * 100) + '%';
  const DRUM = ['SD', 'CP', 'CH', 'OH', 'LT', 'HT', 'RS', 'CY']; // no cowbell, no bells
  const LENS = [8, 12, 16, 24, 32];
  const BANKS = ['EUCLID', 'NUMERIC', 'TIMELINE', 'BREAK'];
  // 16-step timelines and breakbeat ghost lines (x hit, X accent)
  const TIMELINES = ['X..x..x...x.x...', 'X..x...x..x.x...', 'X..x..x...x..x..', 'X..x..x.X..x..x.', 'X.xx.xx.X.xx.xx.', 'X..x..x...x...x.', 'X...x.x...x.x...', 'X..x..x...xx....', 'X.x.x..x.x.x..x.', 'X...x..x..x.x...'];
  const BREAKS = ['....X..x.x..X...', '..x.X....x..X.x.', '....X.x...x.X..x', 'x...X..x..x.X...', '....X...x.x.X.x.', '..x.X..x...xX...', '.x..X....x..X..x', '....X.xx..x.X...'];
  function bjorklund(k, n, rot = 0) { const out = []; for (let i = 0; i < n; i++) out.push(((i * k) % n) < k ? 1 : 0); return out.map((_, i) => out[((i - rot) % n + n) % n]); }
  const fit = (str, n) => Array.from({ length: n }, (_, i) => { const c = str[i % str.length]; return c === 'X' ? 2 : c === 'x' ? 1 : 0; });
  const hash = (a, b) => { let x = Math.imul(a * 374761393 + b * 668265263, 1274126177); x ^= x >>> 13; x = Math.imul(x, 1103515245); return ((x ^ (x >>> 16)) >>> 0) / 4294967296; };
  // the base rhythm number idx of a bank, as 0 (rest), 1 (hit), 2 (accented hit)
  function base(bank, idx, n) {
    if (bank === 'EUCLID') { const ks = []; for (let k = 2; k < n; k++) ks.push(k); const k = ks[idx % ks.length]; const p = bjorklund(k, n); let first = true; return p.map(v => v ? (first ? (first = false, 2) : 1) : 0); }
    if (bank === 'NUMERIC') { const P = [3, 5, 7, 11, 13], D = [0.25, 0.4, 0.55]; const pr = P[idx % P.length], d = D[Math.floor(idx / P.length) % D.length]; return Array.from({ length: n }, (_, s) => ((s * pr) % n) < d * n ? (s % 4 === 0 ? 2 : 1) : 0); }
    if (bank === 'TIMELINE') return fit(TIMELINES[idx % TIMELINES.length], n);
    return fit(BREAKS[idx % BREAKS.length], n);
  }
  const COUNT = { EUCLID: 14, NUMERIC: 15, TIMELINE: TIMELINES.length, BREAK: BREAKS.length };
  // a channel's own version of the rhythm, shaped by its fader f (0..1)
  function density(p, f, salt) {
    return p.map((v, s) => {
      if (f < 0.5) return v === 2 || (v && hash(s, salt) < f * 2) ? v : 0; // thin out (accents stay)
      return v || (hash(s, salt + 7) < (f - 0.5) * 0.7 ? 1 : 0); // fill in ghost notes
    });
  }
  function channel(ch, bank, idx, n, f) {
    const b = base(bank, idx, n);
    if (ch === 0) return density(b, f, 11);
    if (ch === 1) { const r = Math.round(f * (n - 1)); return b.map((_, i) => b[((i - r) % n + n) % n]); }
    if (ch === 2) return density(base(bank, idx + 1 + Math.round(f * 3), n), 0.5 + f * 0.25, 23);
    return density(b.map((v, i) => v ? 0 : (i % 2 ? 1 : 0)), f, 37); // the off-beats the base rhythm leaves open
  }

  function PrimeMod(id) {
    const m = new M(id, { name: 'Prime', sub: 'rhythm generator · 4 channels · accents', width: 470, stripe: '#e05d44', family: 'mod' });
    const re = () => { m.dirty = true; };
    m.p('bank', { label: 'Bank', steps: BANKS, def: 0, apply: re });
    m.p('prime', { label: 'Prime', def: 0.35, fmt: v => '#' + (1 + Math.floor(v * 0.999 * COUNT[m.params?.bank?.choice || 'EUCLID'])), apply: re });
    m.p('len', { label: 'Length', steps: LENS, def: 0.5, apply: re });
    for (let i = 1; i <= 4; i++) m.p('f' + i, { label: 'Fader ' + i, def: [0.5, 0.25, 0.4, 0.3][i - 1], fmt: pct, apply: re, small: true });
    for (let i = 1; i <= 4; i++) m.p('i' + i, { label: 'Drum ' + i, steps: DRUM, def: DRUM.indexOf(['RS', 'CH', 'LT', 'CP'][i - 1]) / (DRUM.length - 1), small: true });
    m.p('prob', { label: 'Chance', def: 1, fmt: pct });
    m.pats = [[], [], [], []]; m.pos = -1; m.dirty = true;
    m.build = function () {
      const bank = this.params.bank.choice, n = this.params.len.choice, idx = Math.floor(this.v('prime') * 0.999 * COUNT[bank]);
      this.pats = [0, 1, 2, 3].map(c => channel(c, bank, idx, n, this.v('f' + (c + 1))));
      this.dirty = false; this.ui?.redraw?.();
    };
    m.inEvent('CLK', function (e) {
      if (this.dirty) this.build();
      const n = this.params.len.choice;
      this.pos = e.step != null ? e.step % n : (this.pos + 1) % n;
      const p = this.pos, t = e.time;
      for (let c = 0; c < 4; c++) {
        const v = this.pats[c][p]; if (!v || Math.random() > this.v('prob')) continue;
        const vel = v === 2 ? 1 : 0.62;
        this.emit('T' + (c + 1), { kind: 'trig', time: t, vel });
        if (v === 2) this.emit('A' + (c + 1), { kind: 'trig', time: t, vel: 1 });
        this.emit('ALL', { kind: 'trig', time: t, vel, inst: this.params['i' + (c + 1)].choice });
      }
      E.at(t, () => this.ui?.cursor?.(p));
    }, 'clock in (16ths)');
    m.inEvent('RST', function () { this.pos = -1; }, 'reset');
    m.inEvent('NEXT', function () { const pr = this.params.prime, k = COUNT[this.params.bank.choice]; pr.setNorm(((Math.floor(pr.n * 0.999 * k) + 1) % k + 0.5) / k); }, 'step to the next base rhythm');
    for (let i = 1; i <= 4; i++) m.outEvent('T' + i, 'channel ' + i + ' triggers');
    for (let i = 1; i <= 4; i++) m.outEvent('A' + i, 'channel ' + i + ' accents');
    m.outEvent('ALL', 'all four channels for the drum machine TRIG input (plays each channel\'s Drum)');
    m.layout = [{ custom: 'prime' }, { k: ['bank', 'prime', 'len', 'prob', 'f1', 'f2', 'f3', 'f4', 'i1', 'i2', 'i3', 'i4'], cls: 'kgrid' }];
    return m;
  }
  Mods.TYPES.Prime = { label: 'Prime rhythm generator', desc: 'four trigger channels from banks of base rhythms (EUCLID, NUMERIC, TIMELINE, BREAK); Prime scrolls the rhythm, Faders reshape each channel; T1-T4, A1-A4 accents; ALL plays all four on drums.TRIG with each channel\'s Drum', prefix: 'prime', make: id => PrimeMod(id) };

  UI.customs.prime = (m, el) => {
    const c = UI.h('canvas', 'scr'), lcd = UI.h('div', 'lcd'); el.append(c, lcd);
    let cx = null, cur = -1;
    const draw = () => {
      if (m.dirty) m.build();
      if (!cx) cx = UI.fitCanvas(c, 70);
      const { g, w, h: H } = cx; g.clearRect(0, 0, w, H);
      const n = m.params.len.choice, cw = (w - 8) / n, rh = (H - 8) / 4;
      for (let r = 0; r < 4; r++) for (let s = 0; s < n; s++) {
        const v = m.pats[r][s], x = 4 + s * cw, y = 4 + r * rh;
        g.fillStyle = s === cur ? '#ffffff' : v === 2 ? '#ff7a4a' : v ? '#e9e6dc' : (s % 4 === 0 ? '#ffffff1c' : '#ffffff0d');
        if (s === cur && !v) g.fillStyle = '#ffffff33';
        g.fillRect(x + 1, y + 1, cw - 2, rh - 3);
      }
      lcd.textContent = `${m.params.bank.choice} ${m.params.prime.display()} · ${n} steps · ${[1, 2, 3, 4].map(i => m.params['i' + i].choice).join(' ')}`;
    };
    m.ui = { cursor: p => { cur = p; }, redraw: () => {} };
    UI.anim(draw);
  };
  return { BANKS, base, channel, PrimeMod, DRUM };
})();
