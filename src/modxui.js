// modxui.js — panel displays for the wishlist modules (Contour, Swarm, Workout, Grains, Marbles, Toolbox).
'use strict';
(() => {
  const E = Engine, h = UI.h, fit = UI.fitCanvas;
  const MONO = '9px JetBrains Mono, monospace';
  const ledRow = (labels, cls = '') => {
    const row = h('div', 'ledrow ' + cls), leds = {};
    labels.forEach(l => { const c = h('div', 'ledcell'), d = h('span', 'led'), t = h('span', 'ledlbl', l); c.append(d, t); row.append(c); leds[l] = { d, t }; });
    return { row, leds, flash: (l, ms = 70) => { const x = leds[l]; if (!x) return; x.d.classList.add('flash'); setTimeout(() => x.d.classList.remove('flash'), ms); } };
  };

  Object.assign(UI.customs, {
    // live trace of both channels
    contour(m, el) {
      const c = h('canvas', 'scr'), lr = ledRow(['CH1', 'CH2', 'EOR', 'EOC']);
      el.append(c, lr.row);
      let cx = null; const hist = [[], []];
      const draw = () => {
        if (!cx) cx = fit(c, 64);
        const { g, w, h: H } = cx; g.clearRect(0, 0, w, H);
        m.readers.forEach((rd, k) => { hist[k].push(rd()); if (hist[k].length > 160) hist[k].shift(); });
        g.strokeStyle = '#ffffff14'; g.beginPath(); g.moveTo(0, H / 2); g.lineTo(w, H / 2); g.stroke();
        [['#e9e6dc', 1.8], ['#ffb03b', 1.4]].forEach(([col, lw], k) => {
          g.strokeStyle = col; g.lineWidth = lw; g.beginPath();
          hist[k].forEach((v, i) => { const x = i / 159 * w, y = H / 2 - Math.max(-1, Math.min(1, v)) * (H / 2 - 4); i ? g.lineTo(x, y) : g.moveTo(x, y); });
          g.stroke();
        });
        g.fillStyle = '#9ef0b7'; g.font = MONO;
        g.fillText(`1 ${m.params.r1.display()}/${m.params.f1.display()}${m.v('cy1') ? ' ⟳' : ''}   2 ${m.params.r2.display()}/${m.params.f2.display()}${m.v('cy2') ? ' ⟳' : ''}`, 4, 10);
      };
      m.ui = { hit: k => { lr.flash('CH' + k); lr.flash(k === 1 ? 'EOR' : 'EOC', 40); } };
      UI.anim(draw);
    },
    // eight bars dancing with the LFOs
    swarm(m, el) {
      const c = h('canvas', 'scr'); el.append(c);
      let cx = null; const trails = Array.from({ length: 8 }, () => []);
      const draw = () => {
        if (!cx) cx = fit(c, 92);
        const { g, w, h: H } = cx; g.clearRect(0, 0, w, H);
        const bw = w / 8;
        m.readers.forEach((rd, i) => {
          const v = Math.max(-1, Math.min(1, rd())), tr = trails[i]; tr.push(v); if (tr.length > 26) tr.shift();
          const x0 = i * bw;
          g.strokeStyle = `hsla(${150 - i * 9},70%,60%,.55)`; g.lineWidth = 1; g.beginPath();
          tr.forEach((t, k) => { const x = x0 + 4 + k / 25 * (bw - 8), y = H / 2 - t * (H / 2 - 12); k ? g.lineTo(x, y) : g.moveTo(x, y); });
          g.stroke();
          const y = H / 2 - v * (H / 2 - 12);
          g.fillStyle = `hsl(${150 - i * 9},80%,62%)`; g.beginPath(); g.arc(x0 + bw - 6, y, 3.5, 0, Math.PI * 2); g.fill();
          g.fillStyle = '#9ef0b788'; g.font = MONO; g.fillText(i + 1, x0 + 3, H - 3);
        });
        g.fillStyle = '#9ef0b7'; g.font = MONO;
        g.fillText(`${m.params.shape.choice} · ${m.params.sync.choice === 'FREE' ? m.params.rate.display() : m.params.sync.choice}`, 4, 10);
      };
      UI.anim(draw);
    },
    workout(m, el) {
      const lr = ledRow(['1', '2', '3', '4', '5', '6', '7', '8'], 'eight');
      const upd = () => { for (let i = 1; i <= 8; i++) { const e = m.v('e' + i); lr.leds[String(i)].t.textContent = m.params['r' + i].choice + (e ? ` E${e}` : '') + (m.v('p' + i) < 1 ? ' ?' : ''); } };
      for (let i = 1; i <= 8; i++) ['r', 'e', 'p'].forEach(p => m.params[p + i].listeners.push(upd));
      el.append(lr.row); upd();
      m.ui = { led: i => lr.flash(String(i), 60) };
    },
    // recorded buffer with grain positions
    grains(m, el) {
      const c = h('canvas', 'scr'), row = h('div', 'row'), lcd = h('div', 'lcd grow'), frz = h('span', 'tag', 'FROZEN');
      row.append(lcd, frz); el.append(c, row);
      frz.style.visibility = 'hidden';
      let cx = null;
      const draw = () => {
        if (!cx) cx = fit(c, 74);
        const { g, w, h: H } = cx; g.clearRect(0, 0, w, H);
        const P = m.peaks, n = P.length, wPos = m.w / m.N;
        for (let i = 0; i < n; i++) {
          const a = Math.min(1, P[i] * 1.6), x = i / n * w;
          g.fillStyle = m.frozen ? '#7fc9ff' : '#d9c48f'; g.globalAlpha = 0.35 + a * 0.5;
          g.fillRect(x, H / 2 - a * (H / 2 - 4), Math.max(1, w / n - 0.5), a * (H - 8) + 1);
        }
        g.globalAlpha = 1;
        g.fillStyle = '#ff5a36'; g.fillRect(wPos * w, 0, 1.5, H);
        const t = E.ctx.currentTime;
        for (const gr of m.recent) {
          const age = t - gr.t; if (age < 0 || age > 0.7) continue;
          g.strokeStyle = `rgba(82,242,255,${(1 - age / 0.7).toFixed(2)})`; g.lineWidth = 2;
          g.strokeRect(gr.at * w, 6, Math.max(2, gr.len * w), H - 12);
        }
        lcd.textContent = `${m.params.size.display()} · ${m.params.dens.display()} · ${m.params.pitch.choice} st`;
      };
      m.ui = { frz: on => { frz.style.visibility = on ? 'visible' : 'hidden'; } };
      UI.anim(draw);
    },
    // random voltage history and coin flips
    marbles(m, el) {
      const c = h('canvas', 'scr'), lr = ledRow(['T1', 'T2', 'T3']);
      el.append(c, lr.row);
      let cx = null;
      const draw = () => {
        if (!cx) cx = fit(c, 60);
        const { g, w, h: H } = cx; g.clearRect(0, 0, w, H);
        const n = m.hist.length;
        m.hist.forEach((s, i) => {
          const x = (i + 48 - n) / 47 * w, y = H - 6 - s.v * (H - 14);
          g.fillStyle = s.coin ? '#4fd0d8' : '#ffb03b'; g.beginPath(); g.arc(x, y, i === n - 1 ? 4 : 2.4, 0, Math.PI * 2); g.fill();
        });
        g.fillStyle = '#9ef0b7'; g.font = MONO;
        g.fillText(`${m.params.steps.choice} · ${m.params.root.choice} ${m.params.scale.choice} · loop ${m.params.len.choice} · déjà ${Math.round(m.v('deja') * 100)}%`, 4, 10);
        const last = m.hist[n - 1];
        if (last) { lr.flash('T2', 60); lr.flash(last.coin ? 'T1' : 'T3', 60); }
      };
      m.ui = { draw };
      requestAnimationFrame(draw);
    },
    toolbox(m, el) {
      const row = h('div', 'row'), lcd = h('div', 'lcd grow', 'S&H +0.00'), lr = ledRow(['A', 'B', 'AND', 'OR', 'XOR']);
      row.append(lcd); el.append(row, lr.row);
      m.ui = { sh: v => { lcd.textContent = `S&H ${v >= 0 ? '+' : ''}${v.toFixed(2)} · slew ${m.params.slew.display()}`; }, led: k => lr.flash(k, 60) };
    }
  });
})();
