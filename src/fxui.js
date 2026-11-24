// fxui.js — panel displays for the effects (fx.js) and the modulation suite (lfo.js).
'use strict';
(() => {
  const E = Engine, h = UI.h, fit = UI.fitCanvas;
  const MONO = '9px JetBrains Mono, monospace';
  const ctx = E.ctx;
  const flashEl = el => { el.classList.add('flash'); setTimeout(() => el.classList.remove('flash'), 120); };

  // A small screen for every effect: its own picture on the left half, the output spectrum behind it
  const pictures = {
    Halls(m, g, w, H) { // the impulse response envelope
      const ir = m.ir; if (!ir) return;
      const d = ir.getChannelData(0), n = d.length, cols = Math.floor(w);
      g.fillStyle = '#9ec9ff55';
      for (let x = 0; x < cols; x++) { let mx = 0; const a = Math.floor(x / cols * n), b = Math.floor((x + 1) / cols * n); for (let i = a; i < b; i += 7) mx = Math.max(mx, Math.abs(d[i])); const y = Math.min(1, mx * 9) * (H - 14); g.fillRect(x, H - y, 1, y); }
      g.fillStyle = '#cfe4ff'; g.fillText(`${m.params.type.choice} ${m.params.decay.display()}`, 4, 10);
    },
    Heat(m, g, w, H) { // transfer curve
      const c = m.curve; if (!c) return;
      g.strokeStyle = '#ffffff18'; g.beginPath(); g.moveTo(0, H / 2); g.lineTo(w, H / 2); g.moveTo(w / 2, 0); g.lineTo(w / 2, H); g.stroke();
      g.strokeStyle = '#ff9a5c'; g.lineWidth = 1.6; g.beginPath();
      for (let x = 0; x < w; x++) { const v = c[Math.floor(x / w * (c.length - 1))]; const y = H / 2 - v * (H / 2 - 6); x ? g.lineTo(x, y) : g.moveTo(x, y); }
      g.stroke(); g.fillStyle = '#ffd2b8'; g.fillText(`${m.params.model.choice} ${m.params.drive.display()}${m.v('rate') < 21600 ? ' · ' + m.params.rate.display() : ''}`, 4, 10);
    },
    Vowel(m, g, w, H) {
      const f2x = f => Math.log(f / 150) / Math.log(6000 / 150) * w;
      (m.formants || []).forEach(([f, db]) => { const x = f2x(f), y = H - Math.max(4, (1 + db / 45) * (H - 12)); g.fillStyle = '#ff8ad8'; g.fillRect(x - 2, y, 4, H - y); });
      g.fillStyle = '#ffd0f0'; g.fillText(`vowel ${m.params.vowel.display()}`, 4, 10);
    },
    Bode(m, g) { g.fillStyle = '#c4f6ff'; g.fillText(`${m.params.mode.choice} ${m.params.shift.display()} · spiral ${m.params.fb.display()}`, 4, 10); },
    Echoes(m, g, w, H) {
      const fb = Math.min(1.1, m.v('fb')), sec = m.secs || 0.3, n = 14;
      for (let k = 0; k < n; k++) { const x = 6 + k * (w - 12) / n, a = Math.pow(Math.min(0.98, fb), k), y = a * (H - 16); g.fillStyle = `rgba(255,207,107,${0.25 + a * 0.7})`; g.fillRect(x, H - y, 3, y); }
      g.fillStyle = '#ffe7b4'; g.fillText(`${m.params.mode.choice} ${m.params.time.display()} · ${Math.round(sec * 1000)}ms${m.v('freeze') ? ' · FROZEN' : ''}`, 4, 10);
    },
    Sympathy(m, g, w) { g.fillStyle = '#fff0bf'; g.fillText(`${m.params.chord.choice} on ${(m.notes || []).map(n => DSP.NOTE_NAMES[n % 12]).join(' ')}`, 4, 10); void w; },
    Stutter(m, g, w, H) {
      const ev = m.lastEv, t = ctx.currentTime;
      if (ev && t >= ev.t && t < ev.t + ev.span) { const k = (t - ev.t) / ev.span; g.fillStyle = '#ff4f6d55'; g.fillRect(0, 0, w * k, H); }
      g.fillStyle = '#ffd0d8'; g.fillText(`${m.params.type.choice} · chance ${m.params.chance.display()}${ev ? ' · last ' + ev.type : ''}`, 4, 10);
    },
    Pump(m, g, w, H) { g.fillStyle = '#d8ffc4'; g.fillText(`glue ${m.params.glue.display()} · squash ${m.params.ott.display()} · pump ${m.params.pump.display()} ${m.params.rate.choice}`, 4, 10); void w; void H; },
    Prism(m, g) { g.fillStyle = '#e2d9ff'; g.fillText(`${m.params.i1.display()} / ${m.params.i2.display()} semitones · cascade ${m.params.fb.display()}`, 4, 10); },
    Horizon(m, g) { g.fillStyle = '#d9d3ff'; g.fillText(`gravity ${m.params.gravity.display()} · chaos ${m.params.chaos.display()}${m.v('freeze') ? ' · FROZEN' : ''}`, 4, 10); },
    Cassette(m, g) { g.fillStyle = '#f3e1c8'; g.fillText(`age ${m.params.age.display()} · wow ${m.params.wow.display()}`, 4, 10); },
    Ensemble(m, g) { g.fillStyle = '#cbfff5'; g.fillText(`${m.params.mode.choice} ${m.params.rate.display()}`, 4, 10); },
    Phaser(m, g) { g.fillStyle = '#efd6ff'; g.fillText(`${m.params.stages.choice} stages · ${m.params.src.choice}`, 4, 10); }
  };
  UI.customs.fxview = function (m, el) {
    const c = h('canvas', 'scr'); el.append(c);
    let cx = null; const spec = new Uint8Array(m.tap.frequencyBinCount);
    const draw = () => {
      if (!cx) cx = fit(c, 58);
      const { g, w, h: H } = cx; g.clearRect(0, 0, w, H); g.font = MONO;
      m.tap.getByteFrequencyData(spec);
      g.fillStyle = (m.stripe || '#52f2ff') + '30';
      const bins = spec.length;
      for (let x = 0; x < w; x += 2) { const f = 30 * Math.pow(16000 / 30, x / w), i = Math.min(bins - 1, Math.round(f / (ctx.sampleRate / 2) * bins)); const y = spec[i] / 255 * H; g.fillRect(x, H - y, 2, y); }
      pictures[m.kind]?.(m, g, w, H);
    };
    m.ui = Object.assign(m.ui || {}, { hit: () => flashEl(c), ir: () => {}, curve: () => {} });
    UI.anim(draw);
  };

  // live traces of the generated signals, read from the history the generator keeps
  const traces = (m, g, w, H, cols, span = 2) => {
    const t1 = ctx.currentTime, t0 = t1 - span, hs = m.hist || [];
    cols.forEach((col, k) => {
      g.strokeStyle = col; g.lineWidth = 1.4; g.beginPath(); let first = true;
      for (const p of hs) { if (p[0] < t0 || p[0] > t1) continue; const x = (p[0] - t0) / span * w, y = H / 2 - Math.max(-1, Math.min(1, p[k + 1])) * (H / 2 - 5); first ? g.moveTo(x, y) : g.lineTo(x, y); first = false; }
      g.stroke();
    });
  };
  UI.customs.orbit = function (m, el) {
    const c = h('canvas', 'scr'); el.append(c); let cx = null;
    const cols = ['#52f2ff', '#ffb03b', '#ff5fa2', '#9ef0b7'];
    UI.anim(() => {
      if (!cx) cx = fit(c, 74);
      const { g, w, h: H } = cx; g.clearRect(0, 0, w, H);
      g.strokeStyle = '#ffffff12'; g.beginPath(); g.moveTo(0, H / 2); g.lineTo(w, H / 2); g.stroke();
      traces(m, g, w, H, cols);
      g.font = MONO; [1, 2, 3, 4].forEach((i, k) => { g.fillStyle = cols[k]; g.fillText(`${i} ${m.params['r' + i].display()} ${m.params['s' + i].display()}`, 4 + k * (w / 4), 10); });
    });
  };
  UI.customs.attractor = function (m, el) {
    const c = h('canvas', 'scr'); el.append(c); let cx = null;
    UI.anim(() => {
      if (!cx) cx = fit(c, 96);
      const { g, w, h: H } = cx; g.fillStyle = '#0b1210'; g.fillRect(0, 0, w, H);
      const hs = m.hist || [], t1 = ctx.currentTime, d = Math.max(0.05, m.v('depth'));
      const pts = hs.filter(p => p[0] <= t1).slice(-500);
      pts.forEach((p, i) => { const a = i / pts.length; g.fillStyle = `rgba(164,111,240,${a * 0.9})`; g.fillRect(w / 2 + p[1] / d * (w / 2 - 6), H / 2 - p[3] / d * (H / 2 - 6), 1.6, 1.6); });
      const p = pts[pts.length - 1]; if (p) { g.fillStyle = '#fff'; g.beginPath(); g.arc(w / 2 + p[1] / d * (w / 2 - 6), H / 2 - p[3] / d * (H / 2 - 6), 2.5, 0, 7); g.fill(); }
      g.font = MONO; g.fillStyle = '#d8c6ff'; g.fillText(`${m.params.model.choice} · chaos ${m.params.chaos.display()}`, 4, 10);
    });
  };
  UI.customs.performer = function (m, el) {
    const lanes = [0, 1].map(l => {
      const row = h('div', 'perfrow'), lab = h('div', 'perflab', 'P' + (l + 1)), sel = h('select', 'perfsel');
      sel.setAttribute('aria-label', `Performer lane ${l + 1} preset`);
      ['—', ...Object.keys(LFO.PRESETS)].forEach(k => { const o = document.createElement('option'); o.value = k === '—' ? '' : k; o.textContent = k; sel.append(o); });
      sel.onchange = () => { if (sel.value) m.setPreset(l, sel.value); };
      const cells = Array.from({ length: 16 }, (_, i) => {
        const cell = h('div', 'pstep', '<i></i><b></b>'); cell.title = 'Click: next shape (shift-click: previous). Drag up or down: level.';
        let sy = 0, sv = 0, moved = false;
        cell.addEventListener('pointerdown', e => { sy = e.clientY; sv = m.lanes[l][i].v; moved = false; cell.setPointerCapture(e.pointerId); });
        cell.addEventListener('pointermove', e => { if (!cell.hasPointerCapture(e.pointerId)) return; const dv = (sy - e.clientY) / 50; if (Math.abs(dv) > 0.03) moved = true; if (moved) { m.lanes[l][i].v = Math.max(0, Math.min(1, sv + dv)); paint(); } });
        cell.addEventListener('pointerup', e => { if (!moved) { const s = m.lanes[l][i]; s.s = (s.s + (e.shiftKey ? LFO.PSHAPES.length - 1 : 1)) % LFO.PSHAPES.length; if (s.v < 0.05) s.v = 1; m.preset[l] = null; paint(); } });
        row.append(cell); return cell;
      });
      el.append(h('div', 'perfhead'), row); row.prepend(lab); row.append(sel);
      return { cells, sel };
    });
    const paint = () => lanes.forEach((L, l) => { L.sel.value = m.preset[l] || ''; L.cells.forEach((c, i) => { const s = m.lanes[l][i]; c.querySelector('i').style.height = Math.round(s.v * 100) + '%'; c.querySelector('b').textContent = LFO.PGLYPH[s.s]; c.classList.toggle('off', s.s === LFO.PSHAPES.indexOf('OFF')); }); });
    paint();
    let last = [-1, -1];
    UI.anim(() => lanes.forEach((L, l) => { const p = m.pos[l]; if (p !== last[l]) { L.cells[last[l]]?.classList.remove('now'); L.cells[p]?.classList.add('now'); last[l] = p; } }));
    m.ui = { render: paint, cells: lanes.map(L => L.cells), sels: lanes.map(L => L.sel) };
  };
  UI.customs.macros = function (m, el) {
    const c = h('canvas', 'scr'), row = h('div', 'row'), btn = h('button', 'btn sm', 'Build');
    btn.type = 'button'; btn.title = 'Ramp the RISE output over the chosen bars, starting at the next bar';
    btn.onclick = () => { if (!E.within(+el.closest('.mod').dataset.layer, () => m.startBuild())) UI.flashMsg?.('Start the clock first: a build starts on the next bar.'); };
    row.append(btn); el.append(c, row);
    let cx = null;
    UI.anim(() => {
      if (!cx) cx = fit(c, 70);
      const { g, w, h: H } = cx; g.clearRect(0, 0, w, H); g.font = MONO;
      const L = E.layers[m.layer ?? 0], cabs = L.cables;
      for (let i = 1; i <= 4; i++) {
        const y = 10 + (i - 1) * 13, v = m.params['m' + i].nm, dests = cabs.filter(cb => cb.from.mod === m.id && cb.from.port === 'M' + i).map(cb => { const tm = L.mods[cb.to.mod]; const k = cb.to.port[0] === '@' ? tm?.params[cb.to.port.slice(1)]?.label : cb.to.port; return `${tm?.name || cb.to.mod} ${k}`; });
        g.fillStyle = '#ff5fa233'; g.fillRect(28, y - 8, (w - 32) * v, 10);
        g.fillStyle = '#ffd1e6'; g.fillText(`M${i}`, 4, y); g.fillText(dests.length ? dests.join(', ').slice(0, 60) : '(drop its cable on knobs)', 32, y);
      }
      const b = m.build, t = ctx.currentTime;
      if (b && t < b.dropAt + 0.4) { const k = Math.max(0, Math.min(1, (t - b.t0) / b.len)); g.fillStyle = t >= b.dropAt ? '#ffffffaa' : '#ff5fa2'; g.fillRect(0, H - 6, w * k, 6); g.fillStyle = '#ffd1e6'; g.fillText(t < b.t0 ? 'build starts next bar' : t < b.dropAt ? `building ${Math.round(k * 100)}%` : 'DROP', 4, H - 9); }
    });
    m.ui = { drop: () => flashEl(c), btn };
  };
  UI.customs.follower = function (m, el) {
    const c = h('canvas', 'scr'); el.append(c); let cx = null; const hist = [];
    UI.anim(() => {
      if (!cx) cx = fit(c, 50);
      const { g, w, h: H } = cx; g.clearRect(0, 0, w, H);
      hist.push(Math.max(0, Math.min(1, m.level || 0))); if (hist.length > 140) hist.shift();
      g.fillStyle = '#9ef0b755'; hist.forEach((v, i) => { const x = i / 139 * w, y = v * (H - 4); g.fillRect(x, H - y, w / 139 + 1, y); });
      const th = H - m.v('thr') * (H - 4); g.strokeStyle = '#ffb03b'; g.setLineDash([4, 3]); g.beginPath(); g.moveTo(0, th); g.lineTo(w, th); g.stroke(); g.setLineDash([]);
    });
    m.ui = { hit: () => flashEl(c) };
  };
})();
