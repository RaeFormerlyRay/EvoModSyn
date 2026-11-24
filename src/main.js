// main.js — assemble the rack, load the starter patch and wire up the console.
'use strict';
(() => {
  const E = Engine, $ = s => document.querySelector(s);
  // Rack order (flex-wraps into rows)
  const mk = Mods.make;
  [
    mk('Clock', 'clock'), mk('StepSeq', 'seq1', { name: 'Sequencer A', stripe: '#f2b632' }), mk('StepSeq', 'seq2', { name: 'Sequencer B', stripe: '#3e8ef0' }), mk('Entropy', 'ent'),
    mk('Drums', 'drums'), mk('Analog', 'acid', { name: 'Voice 303', stripe: '#f2b632', model: 'ACID' }), mk('Analog', 'lead', { name: 'Voice Poly', stripe: '#3e8ef0', model: 'JOVE' }), mk('Geiger', 'geiger'),
    mk('Titan', 'titan'), mk('Chip', 'chip'), mk('Bodies', 'bodies'), mk('Slope', 'slope'), mk('Fold', 'fold'), mk('VCFQ', 'vcfq'),
    mk('Mixer', 'mixer'), mk('Monitor', 'monitor')
  ].forEach(E.add);
  UI.build();

  function starter() {
    E.clearCables();
    const s1 = E.mods.seq1;
    const line = [0, 0, 7, 0, 3, 0, 0, 10, 0, 5, 0, 3, 7, 0, 12, 0];
    line.forEach((n, i) => s1.steps[i] = { n: n > 6 ? n - 7 + 7 : n, g: [1, 0, 1, 1, 1, 0, 1, 1, 1, 1, 0, 1, 1, 0, 1, 1][i], a: [0, 3, 8, 12].includes(i) ? 1 : 0, s: [2, 7, 13].includes(i) ? 1 : 0, p: 1, r: 1 });
    s1.params.scale.setNorm(s1.params.scale.normOf('PHRYG')); s1.params.oct.setNorm(s1.params.oct.normOf('2')); s1.params.root.setNorm(s1.params.root.normOf('A'));
    s1.pats[1] = s1.pats[0].map((st, i) => ({ ...st, n: i % 4 === 2 ? st.n + 2 : st.n, r: i === 14 || i === 15 ? 2 : 1 }));
    s1.cur = 0; s1.next = null; s1.setSong([{ pat: 0, rep: 4 }, { pat: 1, rep: 2 }], false);
    s1.ui.renderSteps();
    const d = E.mods.drums, pats = { BD: 'X...x...X...x...', CP: '....x.......x...', CH: 'x.x.x.x.x.x.x.x.', OH: '..x...x...x...x.' };
    d.INST.forEach((ins, r) => d.pat[r] = (pats[ins] || '................').split('').map(c => c === 'X' ? 2 : c === 'x' ? 1 : 0));
    d.mute = d.INST.map(() => false); d.ui.renderGrid();
    E.mods.seq2.steps.forEach((s, i) => Object.assign(s, { n: [0, 0, 3, 0, 5, 0, 3, 7][i % 8] % 7, g: i % 4 === 0 ? 1 : 0, a: 0, s: 0 })); E.mods.seq2.ui.renderSteps();
    [['clock', 'CLK', 'seq1', 'CLK'], ['clock', 'CLK', 'drums', 'CLK'], ['seq1', 'NOTE', 'acid', 'NOTE'], ['acid', 'OUT', 'mixer', 'IN1'], ['drums', 'OUT', 'mixer', 'IN2'], ['mixer', 'OUT', 'monitor', 'IN']]
      .forEach(([a, b, c, d2]) => E.connect({ mod: a, port: b }, { mod: c, port: d2 }));
  }
  starter();
  UI.status();

  // ----- transport + power -----
  const power = async () => {
    if (E.ctx.state !== 'running') {
      await E.ctx.resume(); $('#power').textContent = 'Power off'; $('#power').classList.add('on'); $('#powerhint').hidden = true;
      if (!E.running) E.start();
    } else { E.stop(); await E.ctx.suspend(); $('#power').textContent = 'Power on'; $('#power').classList.remove('on'); }
  };
  $('#power').onclick = power; $('#power2').onclick = power;
  E.on('transport', r => $('#runled').classList.toggle('on', r));
  E.on('bpm', b => { $('#bpmread').textContent = b.toFixed(1) + ' BPM'; });
  $('#bpmread').textContent = E.bpm.toFixed(1) + ' BPM';
  // remember which layers the AI may use
  try { const v = localStorage.getItem('patchmind.layermode'); if (v) $('#layermode').value = v; } catch (e) { /* no storage */ }
  $('#layermode').addEventListener('change', () => { try { localStorage.setItem('patchmind.layermode', $('#layermode').value); } catch (e) { /* no storage */ } });
  $('#resetpatch').onclick = starter;
  const addSel = $('#addmod');
  Object.entries(Mods.TYPES).forEach(([k, t]) => { const o = document.createElement('option'); o.value = k; o.textContent = t.label; addSel.append(o); });
  addSel.onchange = () => { const t = addSel.value; addSel.value = ''; if (!t) return; E.within(E.V, () => { const id = UI.createModule(t); const el = UI.modEls[id]; el?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); AI.log('sys', `you added ${E.mods[id].name} to ${E.layerName(E.V)}`); }); };
  $('#clearpatch').onclick = () => E.clearCables();
  // every knob on every module back to its default (patterns and cables stay)
  $('#resetknobs').onclick = () => {
    let n = 0; for (const id of E.order) { const m = E.mods[id]; for (const k of m.paramOrder) { const p = m.params[k]; if (Math.abs(p.n - p.defN) > 1e-4) { p.setNorm(p.defN); n++; } } }
    AI.log('sys', `you reset ${n} knob${n === 1 ? '' : 's'} on ${E.order.length} modules to their defaults`);
  };

  // ----- console -----
  const TASKS = ['Design an acid bass patch', 'Play a full 15 minute acid live performance', 'Design a dubstep wobble bass', 'Play a 5 minute noise set with the geiger counter', 'Make a chiptune groove', 'Design an ambient bell soundscape', 'Make it darker', 'Add the geiger counter'];
  const PERSONAS = ['You are a noise musician who loves aggressive, hard hitting EDM', 'You are a patient minimal techno producer', 'You are a gentle ambient composer who loves bells', 'You are a chaotic Serge-system experimentalist', 'You are a retro game composer who loves happy melodies'];
  const chipRow = (el, list, target) => list.forEach(t => { const b = document.createElement('button'); b.className = 'chip'; b.type = 'button'; b.textContent = t; b.onclick = () => { $(target).value = t; }; $(el).append(b); });
  chipRow('#taskchips', TASKS, '#task'); chipRow('#personachips', PERSONAS, '#persona');
  try { const s = localStorage.getItem('patchmind.persona'); if (s) $('#persona').value = s; } catch (e) { /* no storage */ }
  $('#persona').addEventListener('change', () => { try { localStorage.setItem('patchmind.persona', $('#persona').value); } catch (e) { /* no storage */ } });

  $('#run').onclick = async () => {
    if (E.ctx.state !== 'running') await power();
    AI.perform($('#task').value.trim() || 'Design an acid bass patch', $('#persona').value.trim() || 'You are a versatile electronic musician', $('#brain').value);
  };
  $('#stop').onclick = () => AI.stop();
  $('#undoai').onclick = () => AI.undo();
  $('#follow').onchange = e => { UI.followMode = e.target.value; UI.syncFollow?.(); };
  $('#twohands').onchange = e => UI.setTwoHands(e.target.checked);
  $('#fast').onchange = e => { UI.speed = e.target.checked ? 0.45 : 1; };
  $('#task').addEventListener('keydown', e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) $('#run').click(); });

  // ----- optional Claude brain (only inside a Claude artifact viewer) -----
  const claudeOpt = $('#brain').querySelector('option[value="claude"]');
  claudeOpt.disabled = true; claudeOpt.textContent += ' (checking…)';
  (async () => {
    let sample = null;
    try { sample = window.claude?.use ? await window.claude.use('sample') : null; } catch (e) { sample = null; }
    AI.claude = sample;
    claudeOpt.textContent = 'Brain: Claude plans, built-in performer listens' + (sample ? '' : ' (open in Claude to use)');
    claudeOpt.disabled = !sample;
  })();
  AI.log('sys', 'Rack loaded with a starter patch: Sequencer A → Voice 303, drums, mixer → monitor. Press Power on to hear it.');
})();
