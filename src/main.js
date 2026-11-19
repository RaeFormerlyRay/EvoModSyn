// main.js — assemble the rack, load the starter patch and wire up the console.
'use strict';
(() => {
  const E = Engine, $ = s => document.querySelector(s);
  // Rack order (flex-wraps into rows)
  [
    Mods.Clock('clock'), Mods.StepSeq('seq1', 'Sequencer A', '#f2b632'), Mods.StepSeq('seq2', 'Sequencer B', '#3e8ef0'), Mods.Entropy('ent'),
    Mods.Drums('drums'), Mods.Analog('acid', 'Voice 303', '#f2b632', 'ACID'), Mods.Analog('lead', 'Voice Poly', '#3e8ef0', 'JOVE'), Mods.Geiger('geiger'),
    Mods.Titan('titan'), Mods.Chip('chip'), Mods.Bodies('bodies'), Mods.Slope('slope'), Mods.Fold('fold'), Mods.VCFQ('vcfq'),
    Mods.Mixer('mixer'), Mods.Monitor('monitor')
  ].forEach(E.add);
  UI.build();

  function starter() {
    E.clearCables();
    const s1 = E.mods.seq1;
    const line = [0, 0, 7, 0, 3, 0, 0, 10, 0, 5, 0, 3, 7, 0, 12, 0];
    line.forEach((n, i) => s1.steps[i] = { n: n > 6 ? n - 7 + 7 : n, g: [1, 0, 1, 1, 1, 0, 1, 1, 1, 1, 0, 1, 1, 0, 1, 1][i], a: [0, 3, 8, 12].includes(i) ? 1 : 0, s: [2, 7, 13].includes(i) ? 1 : 0, p: 1, r: 1 });
    s1.params.scale.setNorm(s1.params.scale.normOf('PHRYG')); s1.params.oct.setNorm(s1.params.oct.normOf('2')); s1.params.root.setNorm(s1.params.root.normOf('A'));
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
  $('#resetpatch').onclick = starter;
  $('#clearpatch').onclick = () => E.clearCables();

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
  $('#follow').onchange = e => { UI.follow = e.target.checked; };
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
