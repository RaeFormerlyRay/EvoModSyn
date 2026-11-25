// handcam.js — split screen: a second live view of the rack that follows hand 2 while the main view follows hand 1.
// The rack exists once in the page, so this view redraws it onto a canvas: panels, displays, knobs, step and drum
// cells, jacks, cables and both hands.
'use strict';
(() => {
  const E = Engine, $ = s => document.querySelector(s);
  const row = $('#rackrow'), cam = $('#handcam'), cv = $('#camcv'), rack = $('#rack');
  const imgs = {}; // panel images by url
  const panelImg = el => {
    const v = getComputedStyle(el).getPropertyValue('--panel-img'); const m = v && v.match(/url\(["']?(.*?)["']?\)/); if (!m) return null;
    let im = imgs[m[1]]; if (!im) { im = imgs[m[1]] = new Image(); im.src = m[1]; }
    return im.complete && im.naturalWidth ? im : null;
  };
  const view = { x: 0, y: 0, ready: false };
  let last = 0;
  function on() { return UI.twoHands && UI.followMode === 'split'; }
  UI.syncFollow = () => { row.classList.toggle('split', on()); };

  function draw(now) {
    requestAnimationFrame(draw);
    if (!on() || now - last < 40) return; last = now;
    const W = cam.clientWidth, H = cam.clientHeight; if (!W || !H) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
    const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const hp = UI.hands[1].pos, tx = hp.x - W / 2, ty = hp.y - H / 2;
    if (!view.ready) { view.x = tx; view.y = ty; view.ready = true; }
    view.x += (tx - view.x) * 0.18; view.y += (ty - view.y) * 0.18;
    const ox = -view.x, oy = -view.y;
    g.fillStyle = '#121418'; g.fillRect(0, 0, W, H);
    const rr = rack.getBoundingClientRect();
    const box = el => { const r = el.getBoundingClientRect(); return { x: r.left - rr.left + ox, y: r.top - rr.top + oy, w: r.width, h: r.height }; };
    const vis = b => b.x + b.w > 0 && b.y + b.h > 0 && b.x < W && b.y < H;
    // modules
    for (const [id, el] of Object.entries(UI.modEls)) {
      const b = box(el); if (!vis(b)) continue;
      const im = panelImg(el);
      if (im) g.drawImage(im, b.x, b.y, b.w, b.h); else { g.fillStyle = '#1c1f25'; g.fillRect(b.x, b.y, b.w, b.h); }
      g.strokeStyle = el.classList.contains('ai-focus2') ? '#ffb03b' : el.classList.contains('ai-focus') ? '#52f2ff' : '#0008'; g.lineWidth = el.classList.contains('ai-focus2') || el.classList.contains('ai-focus') ? 2 : 1; g.strokeRect(b.x + 0.5, b.y + 0.5, b.w - 1, b.h - 1);
      const light = el.classList.contains('light');
      g.fillStyle = light ? '#1b1b1b' : '#f1ede2'; g.font = '600 11px "Space Grotesk", system-ui, sans-serif'; g.fillText((E.mods[id]?.name || id).toUpperCase(), b.x + 10, b.y + 18);
      el.querySelectorAll('canvas.scr').forEach(c => { const cb = box(c); if (vis(cb) && c.width) { g.fillStyle = '#0b0f0d'; g.fillRect(cb.x, cb.y, cb.w, cb.h); g.drawImage(c, cb.x, cb.y, cb.w, cb.h); } });
      el.querySelectorAll('.lcd').forEach(c => { const cb = box(c); if (!vis(cb)) return; g.fillStyle = '#0b1a12'; g.fillRect(cb.x, cb.y, cb.w, cb.h); g.fillStyle = '#9ef0b7'; g.font = '9px "JetBrains Mono", monospace'; g.fillText(c.textContent.slice(0, 48), cb.x + 4, cb.y + cb.h / 2 + 3); });
      el.querySelectorAll('.step, .dc').forEach(c => { const cb = box(c); if (!vis(cb)) return; const onc = c.classList.contains('on'); g.fillStyle = c.classList.contains('cur') ? '#ffffffaa' : onc ? (c.classList.contains('acc') ? '#ff7a4a' : E.mods[id]?.stripe || '#e9e6dc') : '#00000066'; if (c.classList.contains('step') && onc) { const bar = c.querySelector('.bar'); const hgt = bar ? parseFloat(bar.style.height) / 100 : 1; g.fillRect(cb.x, cb.y + cb.h * (1 - hgt), cb.w, cb.h * hgt); } else g.fillRect(cb.x + 1, cb.y + 1, cb.w - 2, cb.h - 2); });
    }
    // knobs
    for (const [k, el] of Object.entries(UI.knobs)) {
      const dial = el.querySelector('.dial'), b = box(dial); if (!vis(b)) continue;
      const dot = k.indexOf('.'), p = E.mods[k.slice(0, dot)]?.params[k.slice(dot + 1)]; if (!p) continue;
      const cx = b.x + b.w / 2, cy = b.y + b.h / 2, r = b.w / 2;
      const a0 = -225 * Math.PI / 180, a = a0 + p.n * 270 * Math.PI / 180;
      g.fillStyle = '#16181c'; g.beginPath(); g.arc(cx, cy, r * 0.78, 0, Math.PI * 2); g.fill();
      g.strokeStyle = '#ffffff22'; g.lineWidth = 2; g.beginPath(); g.arc(cx, cy, r * 0.95, a0, a0 + 1.5 * Math.PI); g.stroke();
      g.strokeStyle = el.style.getPropertyValue('--kc') || '#e9e6dc'; g.beginPath(); g.arc(cx, cy, r * 0.95, a0, a); g.stroke();
      g.strokeStyle = '#f1ede2'; g.lineWidth = 2; g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + Math.cos(a) * r * 0.7, cy + Math.sin(a) * r * 0.7); g.stroke();
      if (el.classList.contains('ai') || el.classList.contains('ai2')) { g.strokeStyle = el.classList.contains('ai2') ? '#ffb03b' : '#52f2ff'; g.lineWidth = 2; g.beginPath(); g.arc(cx, cy, r * 1.15, 0, Math.PI * 2); g.stroke(); }
      g.fillStyle = '#d8d4c8'; g.font = '8.5px "JetBrains Mono", monospace'; g.textAlign = 'center'; g.fillText(p.label, cx, b.y + b.h + 10); g.fillStyle = '#9a968c'; g.fillText(p.display(), cx, b.y + b.h + 20); g.textAlign = 'left';
    }
    // jacks
    for (const k in UI.jpos) { const j = UI.jpos[k], x = j.x + ox, y = j.y + oy; if (x < -10 || y < -10 || x > W + 10 || y > H + 10) continue; g.fillStyle = '#0c0c0c'; g.beginPath(); g.arc(x, y, 6, 0, Math.PI * 2); g.fill(); g.strokeStyle = '#8a8a8a'; g.lineWidth = 2; g.stroke(); }
    // cables, then the cables the hands are carrying
    const curve = (a, b, color, w = 5) => {
      const dx = b.x - a.x, dist = Math.hypot(dx, b.y - a.y), sag = Math.min(240, 30 + dist * 0.3) * (0.6 + 0.4 * Math.abs(dx) / (dist + 1));
      g.strokeStyle = color; g.lineWidth = w; g.lineCap = 'round'; g.globalAlpha = 0.85; g.beginPath(); g.moveTo(a.x + ox, a.y + oy);
      g.bezierCurveTo(a.x + dx * 0.15 + ox, a.y + sag + oy, b.x - dx * 0.15 + ox, b.y + sag + oy, b.x + ox, b.y + oy); g.stroke(); g.globalAlpha = 1;
    };
    for (const c of E.cables) { const a = UI.jackXY(c.from.mod, 'out', c.from.port), b = UI.jackXY(c.to.mod, 'in', c.to.port); if (a && b) curve(a, b, c.color); }
    UI.hands.forEach(hd => { if (hd.temp) curve(hd.temp.a, hd.temp.b, hd.temp.color); });
    // hands
    UI.hands.forEach((hd, i) => {
      if (!hd.el.classList.contains('on')) return;
      const x = hd.pos.x + ox, y = hd.pos.y + oy, col = i ? '#ffb03b' : '#52f2ff';
      g.strokeStyle = col; g.lineWidth = 2; g.fillStyle = col + '44'; g.beginPath(); g.arc(x, y, 14, 0, Math.PI * 2); g.fill(); g.stroke();
      const t = hd.lbl.textContent; if (t) { g.font = '10.5px "JetBrains Mono", monospace'; const w = g.measureText(t).width + 12; g.fillStyle = '#0b1416ee'; g.fillRect(x + 20, y - 8, w, 18); g.fillStyle = '#f5ecd9'; g.fillText(t, x + 26, y + 5); }
    });
    $('#camlbl').textContent = `② Hand 2 · ${UI.hands[1].focus ? (E.mods[UI.hands[1].focus]?.name || '') : 'idle'}`;
  }
  requestAnimationFrame(draw);
  UI.syncFollow();
})();
