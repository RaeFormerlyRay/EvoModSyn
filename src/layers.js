// layers.js — Layer A and Layer B: two complete, independent modular systems in one rack view. Duplicate one into
// the other, switch which one is on screen, and crossfade their masters (by hand, or by the song engine).
'use strict';
const Layers = (() => {
  const E = Engine, $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
  const dataOf = m => m.kind === 'StepSeq' ? { pats: m.pats, cur: m.cur, song: m.song, songOn: m.songOn }
    : m.kind === 'Drums' ? { pats: m.pats, cur: m.cur, song: m.song, songOn: m.songOn, mute: m.mute, lvl: m.lvl } : null;
  const SKIP = new Set(['Tape']); // the timeline's tape belongs to the timeline, not to a layer

  // everything needed to rebuild a layer: modules, knob positions, patterns and cables
  function snapshot(L) {
    return E.within(L, () => ({
      mods: E.order.map(id => E.mods[id]).filter(m => !SKIP.has(m.kind)).map(m => ({
        id: m.id, kind: m.kind, name: m.name, stripe: m.stripe, model: m.params.model?.choice,
        params: Object.fromEntries(m.paramOrder.map(k => [k, m.params[k].n])), data: dataOf(m) && JSON.parse(JSON.stringify(dataOf(m)))
      })),
      cables: E.cables.filter(c => !SKIP.has(E.mods[c.from.mod]?.kind) && !SKIP.has(E.mods[c.to.mod]?.kind)).map(c => ({ from: { ...c.from }, to: { ...c.to }, color: c.color }))
    }));
  }
  function clear(L) {
    E.within(L, () => { E.clearCables(); for (const id of [...E.order]) UI.removeModule(id, true); });
  }
  function load(L, snap) {
    E.within(L, () => {
      for (const s of snap.mods) {
        let m;
        try { m = Mods.make(s.kind, s.id, { name: s.name, stripe: s.stripe, model: s.model }); } catch (e) { console.error('layer copy', s.kind, e); continue; }
        m.name = s.name; E.add(m); UI.renderModule(m);
      }
      for (const s of snap.mods) {
        const m = E.mods[s.id]; if (!m) continue;
        for (const [k, n] of Object.entries(s.params)) m.params[k]?.setNorm(n, true);
        const d = s.data && JSON.parse(JSON.stringify(s.data));
        if (d && m.kind === 'StepSeq') { m.pats = d.pats; m.cur = d.cur; m.song = d.song; m.songOn = d.songOn; m.next = null; m.ui?.renderAll(); }
        if (d && m.kind === 'Drums') { m.pats = d.pats; m.cur = d.cur; m.song = d.song; m.songOn = d.songOn; m.mute = d.mute; if (d.lvl) m.lvl = d.lvl; m.next = null; m.ui?.renderGrid(); }
      }
      for (const c of snap.cables) E.connect(c.from, c.to, { color: c.color });
    });
    if (L === E.V) { UI.syncCables(); UI.layout(); }
    UI.status(); paint();
  }
  // copy the whole system in layer `from` into layer `to` (replacing what was there)
  function duplicate(from = 0, to = 1) {
    const snap = snapshot(from);
    clear(to); load(to, snap);
    E.fire('layercopy', { from, to });
    return snap.mods.length;
  }
  // a layer's audible level as a 0..1 crossfader position
  const xpos = () => { const a = E.layers[0].bus.gain.value, b = E.layers[1].bus.gain.value; return a + b < 1e-4 ? 0 : Math.atan2(b, a) / (Math.PI / 2); };
  // equal-power crossfade: 0 = only A, 1 = only B
  function crossfade(x, sec = 0.05, at) {
    x = DSP.clamp(x);
    E.fadeLayer(0, Math.cos(x * Math.PI / 2), sec, at); E.fadeLayer(1, Math.sin(x * Math.PI / 2), sec, at);
  }

  // ---------- the layer bar ----------
  function show(L) {
    if (L === 1 && !E.hasLayer(1)) { const n = duplicate(0, 1); AI.log('sys', `Layer B created: duplicated all ${n} modules of Layer A into a second, independent system`); }
    if (AI.busy) { AI.toLayer(L, 'you switched the view'); return; }
    UI.showLayer(L);
  }
  function paint() {
    $$('.ltab').forEach(b => { const on = +b.dataset.l === E.V; b.classList.toggle('on', on); b.setAttribute('aria-selected', on); });
    const n = E.layers[1].order.length;
    $('#lnote').textContent = n ? `Showing ${E.layerName(E.V)}` : 'Layer B is empty: open it to duplicate Layer A';
    $('.ltab[data-l="1"]').classList.toggle('empty', !n);
  }
  $$('.ltab').forEach(b => { b.onclick = () => show(+b.dataset.l); });
  $('#dupab').onclick = () => {
    const n = duplicate(0, 1);
    AI.log('sys', `you copied Layer A into Layer B (${n} modules). Layer B is ${E.layers[1].level > 0.05 ? 'audible' : 'silent until you crossfade to it'}.`);
  };
  const xf = $('#xfade'); let dragging = false;
  xf.addEventListener('input', () => {
    dragging = true;
    if (+xf.value > 0 && !E.hasLayer(1)) { duplicate(0, 1); AI.log('sys', 'Layer B created as a copy of Layer A'); }
    crossfade(+xf.value / 1000, 0.06);
  });
  xf.addEventListener('change', () => { dragging = false; });
  // meters and the crossfader follow fades the AI makes
  const ma = $('#lma'), mb = $('#lmb');
  setInterval(() => {
    const a = E.layers[0].bus.gain.value, b = E.layers[1].bus.gain.value;
    ma.style.width = Math.round(a * 100) + '%'; mb.style.width = Math.round(b * 100) + '%';
    if (!dragging) xf.value = Math.round(xpos() * 1000);
  }, 120);
  E.on('view', paint);
  paint();
  return { snapshot, load, clear, duplicate, crossfade, xpos, show, paint };
})();
