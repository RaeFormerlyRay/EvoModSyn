// ui.js — renders the rack, knobs, jacks and cables; handles hand-patching; animates the AI "hand".
'use strict';
const UI = (() => {
  const E = Engine;
  const $ = (s, el = document) => el.querySelector(s);
  const h = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
  const rack = $('#rack'), wrap = $('#rackwrap'), svg = $('#cables'), hand = $('#aihand'), handLbl = $('#aihandlbl'), readout = $('#readout');
  const SVGNS = 'http://www.w3.org/2000/svg';
  const U = { modEls: {}, knobs: {}, jacks: {}, jpos: {}, temp: null, speed: 1 };
  const ease = t => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  U.sleep = sleep;
  const dpr = () => Math.min(2, window.devicePixelRatio || 1);
  function fitCanvas(c, hgt) { const w = c.clientWidth || 200; c.width = w * dpr(); c.height = hgt * dpr(); c.style.height = hgt + 'px'; const g = c.getContext('2d'); g.setTransform(dpr(), 0, 0, dpr(), 0, 0); return { g, w, h: hgt }; }

  // ---------- knobs ----------
  const arc = (a0, a1, r = 44) => {
    const p = a => [50 + r * Math.sin(a * Math.PI / 180), 50 - r * Math.cos(a * Math.PI / 180)];
    const [x0, y0] = p(a0), [x1, y1] = p(a1); const large = (a1 - a0) > 180 ? 1 : 0;
    return `M${x0.toFixed(2)} ${y0.toFixed(2)} A${r} ${r} 0 ${large} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
  };
  function makeKnob(mod, key) {
    const p = mod.params[key];
    const el = h('div', 'knob' + (p.small ? ' sm' : ''));
    el.innerHTML = `<div class="dial" tabindex="0" role="slider" aria-label="${mod.name} ${p.label}"><svg class="ring" viewBox="0 0 100 100"><path class="bg" d="${arc(-135, 135)}"/><path class="fg"/></svg><div class="ptr"></div></div><div class="lab">${p.label}</div><div class="val"></div>`;
    el.style.setProperty('--kc', mod.stripe);
    const dial = $('.dial', el), ptr = $('.ptr', el), fg = $('.fg', el), val = $('.val', el);
    const draw = () => {
      const a = -135 + p.n * 270; ptr.style.transform = `rotate(${a}deg)`;
      fg.setAttribute('d', p.n > 0.003 ? arc(-135, a) : ''); val.textContent = p.display();
      dial.setAttribute('aria-valuetext', p.display());
    };
    p.listeners.push(draw); draw();
    let sy = 0, sn = 0, drag = false;
    dial.addEventListener('pointerdown', e => { drag = true; sy = e.clientY; sn = p.n; dial.setPointerCapture(e.pointerId); showReadout(e, p); e.preventDefault(); });
    dial.addEventListener('pointermove', e => { if (!drag) return; const k = e.shiftKey ? 0.15 : 1; p.setNorm(sn + (sy - e.clientY) / 170 * k * (p.steps ? Math.max(1, 8 / p.steps.length) : 1)); showReadout(e, p); });
    const up = () => { drag = false; readout.style.display = 'none'; };
    dial.addEventListener('pointerup', up); dial.addEventListener('pointercancel', up);
    dial.addEventListener('dblclick', () => p.setNorm(p.defN));
    dial.addEventListener('wheel', e => { e.preventDefault(); const st = p.steps ? 1 / (p.steps.length - 1) : 0.02; p.setNorm(p.n + (e.deltaY < 0 ? st : -st)); }, { passive: false });
    dial.addEventListener('keydown', e => { const st = p.steps ? 1 / (p.steps.length - 1) : 0.02; if (e.key === 'ArrowUp' || e.key === 'ArrowRight') { p.setNorm(p.n + st); e.preventDefault(); } if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') { p.setNorm(p.n - st); e.preventDefault(); } });
    U.knobs[mod.id + '.' + key] = el;
    return el;
  }
  function showReadout(e, p) { readout.style.display = 'block'; readout.textContent = `${p.mod.name} ${p.label}: ${p.display()}`; readout.style.left = (e.clientX + 14) + 'px'; readout.style.top = (e.clientY - 26) + 'px'; }

  // ---------- jacks ----------
  function makeJack(mod, name, dir) {
    const d = dir === 'in' ? mod.ins[name] : mod.outs[name];
    const el = h('div', 'jack ' + (d.jt === 'ev' ? 'ev' : d.jt === 'cv' ? 'cv' : ''), `<div class="hole"></div><div class="jl">${name}</div>`);
    el.title = `${mod.name} ${dir === 'in' ? 'input' : 'output'} ${name}: ${d.desc || ''} (${d.jt === 'ev' ? 'gate/clock' : d.jt === 'cv' ? 'control voltage' : 'audio'})`;
    el.dataset.mod = mod.id; el.dataset.port = name; el.dataset.dir = dir;
    U.jacks[`${mod.id}.${dir}.${name}`] = el;
    el.addEventListener('pointerdown', startDrag);
    el.addEventListener('dblclick', () => { E.cables.filter(c => (dir === 'in' ? c.to : c.from).mod === mod.id && (dir === 'in' ? c.to : c.from).port === name).forEach(c => E.disconnect(c)); });
    return el;
  }

  // ---------- custom displays ----------
  const customs = {
    clock(m, el) {
      const lcd = h('div', 'lcd big', '126.0'), row = h('div', 'row'), led = h('span', 'led'), btn = h('button', 'btn', 'Run');
      btn.style.flex = '1';
      row.append(led, btn); el.append(lcd, row);
      btn.onclick = () => { E.running ? E.stop() : E.start(); };
      E.on('transport', r => { btn.textContent = r ? 'Stop' : 'Run'; });
      m.params.bpm.listeners.push(p => { lcd.textContent = p.value.toFixed(1); });
      lcd.textContent = m.v('bpm').toFixed(1);
      m.ui = { blink: (bar) => { led.classList.add('flash'); led.style.background = bar ? '' : '#ffb03b'; setTimeout(() => { led.classList.remove('flash'); led.style.background = ''; }, 90); } };
    },
    steps(m, el) {
      el.style.setProperty('--stripe', m.stripe);
      const top = h('div', 'patrow'), pbs = [];
      for (let i = 0; i < 8; i++) { const b = h('button', 'pb', 'ABCDEFGH'[i]); b.type = 'button'; b.title = 'Pattern ' + 'ABCDEFGH'[i] + ' (switches at the end of the current pattern while playing)'; b.onclick = () => m.queue(i); top.append(b); pbs.push(b); }
      const songBtn = h('button', 'pb song', 'SONG'); songBtn.type = 'button'; songBtn.title = 'Song mode: play the chain below'; songBtn.onclick = () => m.setSong(null, !m.songOn); top.append(songBtn);
      const LANES = ['PITCH', 'PROB', 'RATCH']; let lane = 0;
      const laneBtn = h('button', 'pb lane', LANES[0]); laneBtn.type = 'button'; laneBtn.title = 'What dragging a step edits'; laneBtn.onclick = () => { lane = (lane + 1) % 3; laneBtn.textContent = LANES[lane]; render(); }; top.append(laneBtn);
      const grid = h('div', 'steps');
      grid.title = 'Click: gate on/off · drag up/down: edit the lane (pitch, probability or ratchets) · Alt-click: accent · Shift-click: slide';
      const cells = Array.from({ length: 16 }, () => { const c = h('div', 'step', '<div class="bar"></div><div class="acc"></div><div class="sl"></div><span class="rt"></span>'); grid.append(c); return c; });
      const songRow = h('div', 'songrow');
      const render = () => {
        cells.forEach((c, i) => {
          const s = m.steps[i]; c.classList.toggle('on', !!s.g); c.classList.toggle('a', !!s.a); c.classList.toggle('s', !!s.s);
          const v = lane === 0 ? (12 + (s.n + 7) / 21 * 80) : lane === 1 ? 8 + (s.p ?? 1) * 88 : 8 + ((s.r || 1) - 1) / 3 * 88;
          c.querySelector('.bar').style.height = v + '%';
          c.querySelector('.rt').textContent = (s.r > 1 ? '×' + s.r : '') + ((s.p ?? 1) < 1 ? ' ' + Math.round(s.p * 100) : '');
          c.style.opacity = i <= m.v('len') ? 1 : 0.3;
        });
      };
      const renderAll = () => {
        render();
        pbs.forEach((b, i) => { b.classList.toggle('cur', i === m.cur); b.classList.toggle('has', m.hasNotes(i)); b.classList.toggle('q', i === m.next); });
        songBtn.classList.toggle('cur', m.songOn);
        songRow.innerHTML = '';
        m.song.forEach((e, k) => {
          const c = h('button', 'sc' + (m.songOn && k === m.songIx ? ' now' : ''), `${'ABCDEFGH'[e.pat]}×${e.rep}`); c.type = 'button';
          c.title = 'Click: more repeats · Shift-click: change pattern · Alt-click: remove';
          c.onclick = ev => { if (ev.altKey) { if (m.song.length > 1) m.song.splice(k, 1); } else if (ev.shiftKey) e.pat = (e.pat + 1) % 8; else e.rep = e.rep >= 16 ? 1 : e.rep * 2; renderAll(); };
          songRow.append(c);
        });
        const add = h('button', 'sc add', '+'); add.type = 'button'; add.title = 'Add the selected pattern to the song'; add.onclick = () => { if (m.song.length < 16) m.song.push({ pat: m.cur, rep: 2 }); renderAll(); };
        songRow.append(add);
      };
      let dragI = -1;
      cells.forEach((c, i) => {
        c.addEventListener('pointerdown', e => {
          if (e.altKey || e.button === 2) { m.steps[i].a ^= 1; render(); return; }
          if (e.shiftKey) { m.steps[i].s ^= 1; render(); return; }
          dragI = i; c.setPointerCapture(e.pointerId); c._sy = e.clientY; c._moved = false; const s = m.steps[i]; c._v = lane === 0 ? s.n : lane === 1 ? (s.p ?? 1) : (s.r || 1);
        });
        c.addEventListener('pointermove', e => {
          if (dragI !== i) return; const dy = c._sy - e.clientY; if (Math.abs(dy) <= 4) return; c._moved = true; const s = m.steps[i];
          if (lane === 0) { s.n = Math.round(Math.max(-7, Math.min(14, c._v + dy / 6))); s.g = 1; }
          else if (lane === 1) s.p = Math.round(Math.max(0, Math.min(1, c._v + dy / 60)) * 20) / 20;
          else s.r = Math.max(1, Math.min(4, Math.round(c._v + dy / 15)));
          renderAll();
        });
        c.addEventListener('pointerup', () => { if (dragI === i && !c._moved) { m.steps[i].g ^= 1; renderAll(); } dragI = -1; });
        c.addEventListener('contextmenu', e => e.preventDefault());
      });
      m.params.len.listeners.push(render);
      el.append(top, grid, songRow);
      renderAll();
      let cur = -1;
      m.ui = { renderSteps: renderAll, renderAll, cursor: p => { if (cur >= 0) cells[cur]?.classList.remove('cur'); cells[p]?.classList.add('cur'); cur = p; }, cells, pbs, songBtn };
    },
    entropy(m, el) {
      const c = h('canvas', 'scr'); el.append(c);
      let ctx2 = null;
      const draw = () => {
        if (!ctx2) ctx2 = fitCanvas(c, 64);
        const { g, w, h: H } = ctx2; g.clearRect(0, 0, w, H);
        g.strokeStyle = '#9c7bff'; g.lineWidth = 1.5; g.beginPath();
        m.hist.forEach((s, i) => { const x = i / 63 * w, y = H - 6 - s.v * (H - 12); i ? g.lineTo(x, y) : g.moveTo(x, y); });
        g.stroke();
        m.hist.forEach((s, i) => { if (s.on) { g.fillStyle = '#e9e6dc'; g.fillRect(i / 63 * w - 1, H - 4, 3, 3); } });
      };
      m.ui = { draw }; requestAnimationFrame(draw);
    },
    geiger(m, el) {
      const c = h('canvas', 'scr'), row = h('div', 'row'), lcd = h('div', 'lcd grow', '0 CPM'), led = h('span', 'led');
      row.append(lcd, led); el.append(c, row);
      let cx = null, needle = 0;
      const draw = () => {
        if (!cx) cx = fitCanvas(c, 70);
        const { g, w, h: H } = cx; g.clearRect(0, 0, w, H);
        const cxp = w / 2, cy = H + 18, r = H + 6;
        g.strokeStyle = '#3a4a3f'; g.lineWidth = 1; g.beginPath(); g.arc(cxp, cy, r, Math.PI * 1.18, Math.PI * 1.82); g.stroke();
        g.fillStyle = '#9ef0b7'; g.font = '9px JetBrains Mono, monospace'; g.textAlign = 'center';
        [1, 10, 100, 1000, 10000].forEach((v, i) => { const a = Math.PI * (1.2 + i / 4 * 0.6); g.fillText(v >= 1000 ? v / 1000 + 'k' : v, cxp + Math.cos(a) * (r - 12), cy + Math.sin(a) * (r - 12)); });
        const target = Math.min(1, Math.log10(1 + m.cpm) / 4); needle += (target - needle) * 0.15;
        const a = Math.PI * (1.2 + needle * 0.6);
        g.strokeStyle = '#ff5a36'; g.lineWidth = 2; g.beginPath(); g.moveTo(cxp, cy); g.lineTo(cxp + Math.cos(a) * r, cy + Math.sin(a) * r); g.stroke();
        lcd.textContent = `${m.cpm} CPM · ${(m.cpm * 0.0057).toFixed(2)} µSv/h`;
      };
      m.ui = { flash: () => { led.classList.add('flash'); setTimeout(() => led.classList.remove('flash'), 40); }, draw };
      U.anim(draw);
    },
    slope(m, el) {
      const c = h('canvas', 'scr'); el.append(c); let cx = null;
      const draw = () => {
        if (!cx) cx = fitCanvas(c, 60);
        const { g, w, h: H } = cx; g.clearRect(0, 0, w, H);
        const r = m.v('rise'), f = m.v('fall'), fn = DSP.shapes.slope(r / (r + f), m.v('shape'));
        g.strokeStyle = '#3fb6c9'; g.lineWidth = 1.8; g.beginPath();
        for (let i = 0; i <= 80; i++) { const p = (i / 80 * 2) % 1, y = H - 6 - (fn(p) + 1) / 2 * (H - 12); i ? g.lineTo(i / 80 * w, y) : g.moveTo(0, y); }
        g.stroke();
      };
      ['rise', 'fall', 'shape'].forEach(k => m.params[k].listeners.push(draw)); requestAnimationFrame(draw);
    },
    foldscope(m, el) {
      const c = h('canvas', 'scr'); el.append(c); let cx = null;
      const draw = () => {
        if (!cx) cx = fitCanvas(c, 60);
        const { g, w, h: H } = cx; g.clearRect(0, 0, w, H);
        const fo = m.v('fold'), sy = m.v('sym');
        g.strokeStyle = '#3fb6c9'; g.lineWidth = 1.6; g.beginPath();
        for (let i = 0; i <= 120; i++) { const x = Math.sin(i / 120 * Math.PI * 4); const y = Math.sin(Math.max(-1, Math.min(1, (x * fo / 8 + sy))) * 8 * Math.PI / 2); const py = H / 2 - y * (H / 2 - 5); i ? g.lineTo(i / 120 * w, py) : g.moveTo(0, py); }
        g.stroke();
      };
      ['fold', 'sym'].forEach(k => m.params[k].listeners.push(draw)); requestAnimationFrame(draw);
    },
    vcfqart(m, el) {
      const lcd = h('div', 'lcd'); el.append(lcd);
      const upd = () => { lcd.textContent = `${m.params.mode.choice} · ${m.params.freq.display()} · Q ${m.v('q').toFixed(1)}`; };
      ['mode', 'freq', 'q'].forEach(k => m.params[k].listeners.push(upd)); upd();
    },
    drumgrid(m, el) {
      const g = h('div', 'dgrid'); const cells = [], labels = [];
      m.INST.forEach((ins, r) => {
        const l = h('div', 'rl', ins); l.title = 'Click to mute ' + ins; l.onclick = () => { m.mute[r] = !m.mute[r]; render(); }; g.append(l); labels.push(l);
        cells[r] = [];
        for (let s = 0; s < 16; s++) { const c = h('div', 'dc'); c.onclick = () => { m.pat[r][s] = (m.pat[r][s] + 1) % 3; render(); }; g.append(c); cells[r][s] = c; }
      });
      const render = () => m.INST.forEach((_, r) => { labels[r].classList.toggle('mute', m.mute[r]); for (let s = 0; s < 16; s++) { const v = m.pat[r][s]; cells[r][s].classList.toggle('on', v > 0); cells[r][s].classList.toggle('acc', v === 2); } });
      el.append(g); render();
      let cur = -1;
      m.ui = { renderGrid: render, cells, labels, cursor: p => { if (cur >= 0) cells.forEach(row => row[cur].classList.remove('cur')); cells.forEach(row => row[p].classList.add('cur')); cur = p; } };
    },
    modelinfo(m, el) {
      const row = h('div', 'row'), lcd = h('div', 'lcd grow'), led = h('span', 'led'); row.append(lcd, led); el.append(row);
      const upd = () => { lcd.textContent = m.MODEL_INFO[m.params.model.choice]; };
      m.ui = { modelInfo: upd, gateLed: () => { led.classList.add('flash'); setTimeout(() => led.classList.remove('flash'), 70); } };
      upd();
    },
    titanscope(m, el) {
      const row = h('div', 'row'), c = h('canvas', 'scr grow'), led = h('span', 'led'); row.append(c, led); el.append(row);
      let cx = null;
      const draw = () => {
        if (!cx) cx = fitCanvas(c, 46);
        const { g, w, h: H } = cx; g.clearRect(0, 0, w, H);
        [['t1', 'p1', '#ff3f7a'], ['t2', 'p2', '#ffb0c8']].forEach(([t, p, col], k) => {
          const T = DSP.TABLES[m.v(t)], pos = m.v(p);
          g.strokeStyle = col; g.lineWidth = k ? 1 : 1.8; g.beginPath();
          for (let i = 0; i <= 100; i++) { const ph = (i / 100 * 2) % 1, y = (1 - pos) * T.a(ph) + pos * T.b(ph); const py = H / 2 - y * (H / 2 - 4) * 0.8; i ? g.lineTo(i / 100 * w, py) : g.moveTo(0, py); }
          g.stroke();
        });
        g.fillStyle = '#9ef0b7'; g.font = '9px JetBrains Mono, monospace'; g.fillText(`${m.params.t1.choice} ▸ ${m.params.wrate.choice} ${m.params.wshape.choice}`, 4, 10);
      };
      ['t1', 'p1', 't2', 'p2', 'wrate', 'wshape'].forEach(k => m.params[k].listeners.push(draw)); requestAnimationFrame(draw);
      m.ui = { gateLed: () => { led.classList.add('flash'); setTimeout(() => led.classList.remove('flash'), 70); } };
    },
    chipart(m, el) {
      const row = h('div', 'row'), lcd = h('div', 'lcd grow'), led = h('span', 'led'); row.append(lcd, led); el.append(row);
      const upd = () => { lcd.textContent = `${m.params.wave.choice} · ARP ${m.params.arp.choice} · ${m.params.crush.choice}-BIT`; };
      ['wave', 'arp', 'crush'].forEach(k => m.params[k].listeners.push(upd)); upd();
      m.ui = { gateLed: () => { led.classList.add('flash'); setTimeout(() => led.classList.remove('flash'), 70); } };
    },
    bodyart(m, el) {
      const c = h('canvas', 'scr'); el.append(c); let cx = null, energy = 0, lastMidi = 60;
      const draw = () => {
        if (!cx) cx = fitCanvas(c, 54);
        const { g, w, h: H } = cx; g.clearRect(0, 0, w, H);
        energy *= 0.95; const t = performance.now() / 1000;
        g.strokeStyle = '#e8b04a'; g.lineWidth = 1.5; g.beginPath();
        const md = m.params.model.choice, modes = md === 'STRING' || md === 'TUBE' ? [1, 2, 3] : [1, 2.4, 3.9];
        for (let i = 0; i <= 120; i++) { const x = i / 120; let y = 0; modes.forEach((k, j) => { y += Math.sin(Math.PI * x * Math.round(k + j)) * Math.sin(t * (20 + lastMidi / 4) * k) / (j + 1); }); const py = H / 2 - y * energy * (H / 2 - 4) * 0.6; i ? g.lineTo(x * w, py) : g.moveTo(0, py); }
        g.stroke();
        g.fillStyle = '#9ef0b7'; g.font = '9px JetBrains Mono, monospace'; g.fillText(md, 4, 10);
      };
      m.ui = { strike: (midi) => { energy = 1; lastMidi = midi; } };
      U.anim(draw);
    },
    monitor(m, el) {
      const c1 = h('canvas', 'scr'), c2 = h('canvas', 'scr'); el.append(c1, c2);
      const td = new Uint8Array(m.analyser.fftSize), fd = new Uint8Array(m.analyser.frequencyBinCount);
      let a = null, b = null;
      const draw = () => {
        if (!a) { a = fitCanvas(c1, 70); b = fitCanvas(c2, 80); }
        m.analyser.getByteTimeDomainData(td); m.analyser.getByteFrequencyData(fd);
        let g = a.g; g.clearRect(0, 0, a.w, a.h); g.strokeStyle = '#52f2ff'; g.lineWidth = 1.4; g.beginPath();
        for (let i = 0; i < 512; i++) { const y = a.h / 2 + (td[i] - 128) / 128 * a.h / 2 * 0.95; i ? g.lineTo(i / 511 * a.w, y) : g.moveTo(0, y); }
        g.stroke();
        g = b.g; g.clearRect(0, 0, b.w, b.h);
        const N = 64, ny = E.ctx.sampleRate / 2;
        for (let i = 0; i < N; i++) {
          const f0 = 30 * Math.pow(18000 / 30, i / N), f1 = 30 * Math.pow(18000 / 30, (i + 1) / N);
          const i0 = Math.floor(f0 / ny * fd.length), i1 = Math.max(i0 + 1, Math.floor(f1 / ny * fd.length));
          let mx = 0; for (let k = i0; k < i1; k++) mx = Math.max(mx, fd[k]);
          const hh = mx / 255 * (b.h - 4);
          g.fillStyle = `hsl(${190 - i * 2.2},85%,${45 + mx / 255 * 25}%)`; g.fillRect(i / N * b.w + 1, b.h - hh, b.w / N - 2, hh);
        }
      };
      U.anim(draw);
    }
  };
  U.animated = [];
  U.customs = customs; U.fitCanvas = fitCanvas; U.h = h; // other files register panel displays here
  let buildingId = null;
  U.anim = f => { f._mod = buildingId; U.animated.push(f); };
  const FIXED = new Set(['clock', 'mixer', 'monitor']);

  // ---------- build rack ----------
  function renderModule(m, isNew) {
    const id = m.id; buildingId = id;
    const el = h('div', 'mod' + (isNew ? ' mod-new' : '')); el.style.width = m.width + 'px'; el.style.setProperty('--stripe', m.stripe); el.dataset.mod = id;
    const pk = Panels.key(m); if (pk) { el.style.setProperty('--panel-img', `url("${Panels.url(pk)}")`); el.classList.add('worn'); if (Panels.light(pk)) el.classList.add('light'); }
    el.innerHTML = `<div class="mod-h"><span class="nm">${m.name}</span><span class="sub">${m.sub}</span></div>`;
    if (!FIXED.has(id)) { const x = h('button', 'modx', '×'); x.type = 'button'; x.title = `Remove ${m.name} from the rack`; x.onclick = () => U.removeModule(id); el.querySelector('.mod-h').append(x); }
    const body = h('div', 'mod-b'); el.append(body);
    for (const sec of m.layout) {
      if (sec.custom) { const box = h('div', 'cust'); box.style.display = 'flex'; box.style.flexDirection = 'column'; box.style.gap = '5px'; body.append(box); customs[sec.custom](m, box); }
      else { const g = h('div', sec.cls || 'kgrid'); if (sec.c) g.classList.add('c'); sec.k.forEach(k => g.append(makeKnob(m, k))); body.append(g); }
    }
    const jr = h('div', 'jacks'), gi = h('div', 'grp in'), go = h('div', 'grp out');
    Object.keys(m.ins).forEach(n => gi.append(makeJack(m, n, 'in')));
    Object.keys(m.outs).forEach(n => go.append(makeJack(m, n, 'out')));
    if (gi.children.length) jr.append(gi); jr.append(go); el.append(jr);
    const mg = el.querySelector('.mixgrid');
    if (mg) { mg.style.display = 'grid'; mg.style.gridTemplateColumns = 'repeat(8,1fr)'; mg.style.justifyItems = 'center'; }
    rack.insertBefore(el, svg);
    U.modEls[id] = el;
    buildingId = null;
    if (isNew) setTimeout(() => el.classList.remove('mod-new'), 2200);
    return el;
  }
  U.build = function () {
    for (const id of E.order) renderModule(E.mods[id]);
    new ResizeObserver(() => U.layout()).observe(rack);
    window.addEventListener('resize', () => U.layout());
    U.layout();
    E.on('change', ev => { if (ev.type === 'connect' && ev.ai) ev.cable.ai = performance.now(); U.syncCables(); U.status(); });
    requestAnimationFrame(frame);
  };
  // Add a new module of a registered type to the end of the rack; returns its id
  U.createModule = function (type, o = {}) {
    const T = Mods.TYPES[type]; if (!T) return null;
    const id = o.id && !E.mods[o.id] ? o.id : E.newId(T.prefix);
    const m = Mods.make(type, id, o);
    E.add(m); renderModule(m, true); U.layout(); U.status();
    E.fire('modules', { type: 'add', id });
    return id;
  };
  U.removeModule = function (id) {
    if (FIXED.has(id) || !E.mods[id]) return false;
    E.remove(id);
    U.modEls[id]?.remove(); delete U.modEls[id];
    for (const k of Object.keys(U.jacks)) if (k.startsWith(id + '.')) { delete U.jacks[k]; delete U.jpos[k]; }
    for (const k of Object.keys(U.knobs)) if (k.startsWith(id + '.')) delete U.knobs[k];
    U.animated = U.animated.filter(f => f._mod !== id);
    U.syncCables(); U.layout(); U.status();
    return true;
  };

  U.layout = function () {
    const rr = rack.getBoundingClientRect();
    for (const k in U.jacks) { const r = U.jacks[k].querySelector('.hole').getBoundingClientRect(); U.jpos[k] = { x: r.left - rr.left + r.width / 2, y: r.top - rr.top + r.height / 2 }; }
    svg.setAttribute('width', rack.scrollWidth); svg.setAttribute('height', rack.scrollHeight);
    svg.style.width = rack.scrollWidth + 'px'; svg.style.height = rack.scrollHeight + 'px';
  };
  U.jackXY = (mod, dir, port) => U.jpos[`${mod}.${dir}.${port}`];
  U.status = () => { $('#cpu').textContent = `${E.order.length} modules · ${E.cables.length} cables`; };

  // ---------- cables ----------
  const cabEls = new Map();
  function mkCableEl(color) {
    const g = document.createElementNS(SVGNS, 'g'); g.setAttribute('class', 'cab');
    g.innerHTML = `<path class="shadow"/><path class="main" stroke="${color}"/><path class="shine"/><path class="pulse"/><circle class="plug" r="7" fill="${color}"/><circle class="plug" r="7" fill="${color}"/>`;
    svg.append(g); return g;
  }
  U.syncCables = function () {
    const ids = new Set(E.cables.map(c => c.id));
    for (const [id, g] of cabEls) if (!ids.has(id)) { g.remove(); cabEls.delete(id); }
    for (const c of E.cables) if (!cabEls.has(c.id)) cabEls.set(c.id, mkCableEl(c.color));
  };
  function cablePath(a, b, born) {
    const dx = b.x - a.x, dy = b.y - a.y, dist = Math.hypot(dx, dy);
    let sag = Math.min(240, 30 + dist * 0.3) * (0.6 + 0.4 * Math.abs(dx) / (dist + 1));
    if (born) { const t = (performance.now() - born) / 1000; if (t < 2) sag *= 1 + 0.32 * Math.sin(t * 13) * Math.exp(-t * 3.2); }
    return `M${a.x.toFixed(1)} ${a.y.toFixed(1)} C${(a.x + dx * 0.15).toFixed(1)} ${(a.y + sag).toFixed(1)} ${(b.x - dx * 0.15).toFixed(1)} ${(b.y + sag).toFixed(1)} ${b.x.toFixed(1)} ${b.y.toFixed(1)}`;
  }
  function drawCable(g, a, b, born, ai) {
    const d = cablePath(a, b, born);
    const ps = g.querySelectorAll('path'); ps.forEach(p => p.setAttribute('d', d));
    const cs = g.querySelectorAll('circle'); cs[0].setAttribute('cx', a.x); cs[0].setAttribute('cy', a.y); cs[1].setAttribute('cx', b.x); cs[1].setAttribute('cy', b.y);
    g.classList.toggle('ai', !!ai);
  }
  let tempEl = null;
  function drawAllCables() {
    const t = performance.now();
    for (const c of E.cables) {
      const g = cabEls.get(c.id); if (!g) continue;
      const a = U.jackXY(c.from.mod, 'out', c.from.port), b = U.jackXY(c.to.mod, 'in', c.to.port); if (!a || !b) continue;
      const glowing = (c.ai && t - c.ai < 1800) || c.glowUntil > t;
      drawCable(g, a, b, c.born, glowing);
    }
    if (U.temp) {
      if (!tempEl) tempEl = mkCableEl(U.temp.color);
      drawCable(tempEl, U.temp.a, U.temp.b, null, U.temp.ai);
    } else if (tempEl) { tempEl.remove(); tempEl = null; }
  }

  // ---------- user patching ----------
  let drag = null;
  function startDrag(e) {
    e.preventDefault();
    const el = e.currentTarget, mod = el.dataset.mod, port = el.dataset.port, dir = el.dataset.dir;
    let anchor = { mod, port, dir };
    if (dir === 'in') { const c = E.findCable(mod, port); if (c) { E.disconnect(c); anchor = { mod: c.from.mod, port: c.from.port, dir: 'out' }; } }
    const a = U.jackXY(anchor.mod, anchor.dir, anchor.port);
    drag = { anchor };
    U.temp = { a, b: { ...a }, color: '#e9e6dc' };
    window.addEventListener('pointermove', onDrag); window.addEventListener('pointerup', endDrag, { once: true });
  }
  let hoverEl = null;
  function onDrag(e) {
    if (!drag) return;
    const rr = rack.getBoundingClientRect(); U.temp.b = { x: e.clientX - rr.left, y: e.clientY - rr.top };
    const t = document.elementFromPoint(e.clientX, e.clientY)?.closest('.jack');
    if (hoverEl && hoverEl !== t) hoverEl.classList.remove('hover');
    hoverEl = t && t.dataset.dir !== drag.anchor.dir ? t : null; hoverEl?.classList.add('hover');
  }
  function endDrag(e) {
    window.removeEventListener('pointermove', onDrag);
    const t = document.elementFromPoint(e.clientX, e.clientY)?.closest('.jack');
    hoverEl?.classList.remove('hover'); hoverEl = null;
    if (t && drag && t.dataset.dir !== drag.anchor.dir) {
      const A = drag.anchor, B = { mod: t.dataset.mod, port: t.dataset.port, dir: t.dataset.dir };
      const from = A.dir === 'out' ? A : B, to = A.dir === 'out' ? B : A;
      const ok = E.connect({ mod: from.mod, port: from.port }, { mod: to.mod, port: to.port });
      if (!ok) U.flashMsg?.('Those two jacks do not fit: clock/gate jacks (green) only connect to green jacks.');
    }
    drag = null; U.temp = null;
  }

  // ---------- AI hand ----------
  const handPos = { x: 40, y: 40 };
  U.follow = true;
  function ensureVisible(x, y) {
    if (!U.follow) return 0;
    const vw = wrap.clientWidth, vh = wrap.clientHeight, sx = wrap.scrollLeft, sy = wrap.scrollTop, m = 80;
    let nx = sx, ny = sy;
    if (x < sx + m) nx = x - m * 2; else if (x > sx + vw - m) nx = x - vw + m * 2;
    if (y < sy + m) ny = y - m * 2; else if (y > sy + vh - m) ny = y - vh + m * 2;
    if (nx !== sx || ny !== sy) { wrap.scrollTo({ left: Math.max(0, nx), top: Math.max(0, ny), behavior: 'smooth' }); return 380; }
    return 0;
  }
  U.handTo = async function (x, y, label, ms) {
    hand.classList.add('on'); if (label != null) handLbl.textContent = label;
    const w = ensureVisible(x, y); if (w) await sleep(w * U.speed);
    const sx = handPos.x, sy = handPos.y, dist = Math.hypot(x - sx, y - sy);
    const dur = (ms ?? Math.min(900, 220 + dist * 0.6)) * U.speed;
    const t0 = performance.now();
    await new Promise(res => {
      const step = () => {
        const k = Math.min(1, (performance.now() - t0) / dur), e = ease(k);
        handPos.x = sx + (x - sx) * e; handPos.y = sy + (y - sy) * e - Math.sin(k * Math.PI) * Math.min(60, dist * 0.12);
        hand.style.transform = `translate(${handPos.x}px,${handPos.y}px)`;
        if (U.temp && U.temp.followHand) U.temp.b = { x: handPos.x, y: handPos.y };
        k < 1 ? requestAnimationFrame(step) : res();
      };
      step();
    });
  };
  U.handOff = () => { hand.classList.remove('on'); Object.values(U.modEls).forEach(e => e.classList.remove('ai-focus')); };
  U.focus = id => { Object.entries(U.modEls).forEach(([k, e]) => e.classList.toggle('ai-focus', k === id)); };
  const knobCenter = (id, key) => { const el = U.knobs[id + '.' + key]; if (!el) return null; const rr = rack.getBoundingClientRect(), r = el.querySelector('.dial').getBoundingClientRect(); return { x: r.left - rr.left + r.width / 2, y: r.top - rr.top + r.height / 2 }; };
  const elCenter = el => { const rr = rack.getBoundingClientRect(), r = el.getBoundingClientRect(); return { x: r.left - rr.left + r.width / 2, y: r.top - rr.top + r.height / 2 }; };
  U.elCenter = elCenter;

  // Turn a knob to normalised value n, visibly.
  U.aiKnob = async function (id, key, n, ms, label) {
    const m = E.mods[id], p = m?.params[key]; if (!p) return false;
    const c = knobCenter(id, key); const el = U.knobs[id + '.' + key];
    U.focus(id);
    await U.handTo(c.x, c.y, label || `${m.name} · ${p.label}`);
    el.classList.add('ai');
    const n0 = p.n, dur = (ms ?? 500 + Math.abs(n - n0) * 900) * U.speed, t0 = performance.now();
    await new Promise(res => { const st = () => { const k = Math.min(1, (performance.now() - t0) / dur); p.setNorm(n0 + (n - n0) * ease(k)); k < 1 ? requestAnimationFrame(st) : res(); }; st(); });
    p.setNorm(n);
    setTimeout(() => el.classList.remove('ai'), 1400);
    return true;
  };

  U.aiPatch = async function (from, to, label) {
    const a = U.jackXY(from.mod, 'out', from.port), b = U.jackXY(to.mod, 'in', to.port);
    if (!a || !b || !E.canConnect(from, to)) return false;
    const ja = U.jacks[`${from.mod}.out.${from.port}`], jb = U.jacks[`${to.mod}.in.${to.port}`];
    const existing = E.findCable(to.mod, to.port);
    if (existing && existing.from.mod === from.mod && existing.from.port === from.port) return true;
    if (existing) await U.aiUnpatch(existing);
    U.focus(from.mod);
    await U.handTo(a.x, a.y, label || `patch ${E.mods[from.mod].name} ${from.port} → ${E.mods[to.mod].name} ${to.port}`);
    ja.classList.add('ai'); await sleep(140 * U.speed);
    U.temp = { a, b: { ...a }, color: '#52f2ff', ai: true, followHand: true };
    U.focus(to.mod);
    await U.handTo(b.x, b.y, null, Math.min(1300, 450 + Math.hypot(b.x - a.x, b.y - a.y) * 0.7));
    jb.classList.add('ai');
    U.temp = null;
    E.connect(from, to, { ai: true });
    setTimeout(() => { ja.classList.remove('ai'); jb.classList.remove('ai'); }, 1200);
    await sleep(180 * U.speed);
    return true;
  };

  U.aiUnpatch = async function (c, label) {
    const a = U.jackXY(c.from.mod, 'out', c.from.port), b = U.jackXY(c.to.mod, 'in', c.to.port);
    U.focus(c.to.mod);
    c.glowUntil = performance.now() + 5000;
    await U.handTo(b.x, b.y, label || `unplug ${E.mods[c.to.mod].name} ${c.to.port}`);
    E.disconnect(c, { ai: true });
    U.temp = { a, b: { ...b }, color: c.color, ai: true, followHand: true };
    const mid = { x: (a.x + b.x) / 2, y: Math.max(a.y, b.y) + 40 };
    await U.handTo(mid.x, mid.y, null, 380);
    U.temp = null;
    return true;
  };

  U.aiCells = async function (els, mod, label, fn) {
    if (!els.length) return;
    U.focus(mod);
    const first = elCenter(els[0]);
    await U.handTo(first.x, first.y, label);
    for (let i = 0; i < els.length; i++) {
      const c = elCenter(els[i]);
      await U.handTo(c.x, c.y, null, 70);
      fn(i); els[i].classList.add('ai');
      const el = els[i]; setTimeout(() => el.classList.remove('ai'), 900);
    }
  };
  U.aiPoint = async function (el, mod, label) { U.focus(mod); const c = elCenter(el); await U.handTo(c.x, c.y, label); el.classList.add('ai'); setTimeout(() => el.classList.remove('ai'), 900); };

  // ---------- frame loop ----------
  function frame() {
    E.flushUI();
    drawAllCables();
    for (const f of U.animated) f();
    requestAnimationFrame(frame);
  }

  // cable visibility
  const views = ['', 'cab-dim', 'cab-faint'], labels = ['Cables 100%', 'Cables 45%', 'Cables 15%']; let vi = 0;
  $('#cabview').onclick = () => { rack.classList.remove(views[vi]); vi = (vi + 1) % 3; if (views[vi]) rack.classList.add(views[vi]); $('#cabview').textContent = labels[vi]; };
  return U;
})();
