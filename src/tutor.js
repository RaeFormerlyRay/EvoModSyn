// tutor.js — Tutor Mode: the AI slows down and explains every step in a speech bubble next to its hand.
// Each AI action passes through Tutor.step (one hook at the top of AI.run). The step shows the bubble, slows the
// hand down, and holds until there has been time to read the text. "Skip to next step" (button, bubble or the N key)
// puts the hand back to normal speed until the next step begins.
'use strict';
const Tutor = (() => {
  const E = Engine, $ = s => document.querySelector(s);
  const T = { on: false, slow: 2.4 };
  const PACE = { relaxed: 3, normal: 4, quick: 5.5 }; // words read per second
  let pace = 'normal', stepN = 0, active = 0, skipped = false, hovered = false, wake = null, prevTwo = null;

  // ---------------- bubble ----------------
  const bub = document.createElement('div');
  bub.id = 'tutorbubble'; bub.setAttribute('role', 'status'); bub.setAttribute('aria-live', 'polite');
  bub.innerHTML = '<div class="tb-head"><span class="tb-kind"></span><span class="tb-n"></span></div><div class="tb-title"></div><div class="tb-body"></div>'
    + '<div class="tb-foot"><div class="tb-bar"><i></i></div><button type="button" class="tb-skip" title="Speed up to the next step (N)">Skip ▶</button></div><div class="tb-tail"></div>';
  document.body.append(bub);
  const q = s => bub.querySelector(s);
  bub.addEventListener('pointerenter', () => { hovered = true; bub.classList.add('held'); });
  bub.addEventListener('pointerleave', () => { hovered = false; bub.classList.remove('held'); });
  q('.tb-skip').onclick = () => T.skip();

  // keep the bubble beside hand 1, inside the window
  let follow = 0, handIx = 0;
  function place() {
    if (!bub.classList.contains('on')) { follow = 0; return; }
    const H = UI.hands?.[handIx], wrap = $('#rackwrap').getBoundingClientRect();
    const org = (H?.el.offsetParent || $('#rack')).getBoundingClientRect();
    const W = innerWidth, Ht = innerHeight, bw = bub.offsetWidth, bh = bub.offsetHeight;
    // where the hand is (or will appear), kept inside the visible rack
    const hx = Math.max(wrap.left, Math.min(wrap.right, org.left + (H?.pos.x ?? 40))), hy = Math.max(wrap.top, Math.min(wrap.bottom, org.top + (H?.pos.y ?? 40)));
    let x = hx + 30, y = hy + 28, side = 'r', vert = 't';
    if (x + bw > W - 12) { x = hx - bw - 30; side = 'l'; }
    if (y + bh > Ht - 12) { y = hy - bh - 28; vert = 'b'; }
    x = Math.max(8, Math.min(W - bw - 8, x)); y = Math.max(8, Math.min(Ht - bh - 8, y));
    bub.style.transform = `translate(${Math.round(x)}px,${Math.round(y)}px)`; bub.dataset.side = side; bub.dataset.vert = vert;
    follow = requestAnimationFrame(place);
  }
  function show(info, n) {
    q('.tb-kind').textContent = info.kind; q('.tb-n').textContent = 'step ' + n;
    q('.tb-title').textContent = info.title; q('.tb-body').innerHTML = info.body; typeOut(q('.tb-body'));
    q('.tb-bar i').style.width = '0%';
    bub.classList.add('on'); bub.classList.remove('skipping');
    if (!follow) follow = requestAnimationFrame(place);
  }
  const hide = () => { bub.classList.remove('on'); };
  // letters appear one after another, like a game dialogue box (click the text to show it all at once)
  let typing = 0;
  function typeOut(el) {
    cancelAnimationFrame(typing);
    const nodes = [], walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    while (walk.nextNode()) { nodes.push([walk.currentNode, walk.currentNode.nodeValue]); walk.currentNode.nodeValue = ''; }
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) { nodes.forEach(([n, t]) => { n.nodeValue = t; }); return; }
    let i = 0, shown = 0; const t0 = performance.now();
    const step = () => {
      const want = (performance.now() - t0) * 0.12; // about 120 letters a second
      while (i < nodes.length && shown < want) { const [n, t] = nodes[i], k = Math.min(t.length, n.nodeValue.length + Math.ceil(want - shown)); shown += k - n.nodeValue.length; n.nodeValue = t.slice(0, k); if (k >= t.length) i++; }
      if (i < nodes.length) typing = requestAnimationFrame(step);
    };
    el.onclick = () => { cancelAnimationFrame(typing); nodes.forEach(([n, t]) => { n.nodeValue = t; }); };
    step();
  }

  // ---------------- what to say ----------------
  const esc = s => String(s ?? '').replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  const why = a => a.why ? `<p class="tb-why"><b>Why:</b> ${esc(a.why[0].toUpperCase() + a.why.slice(1))}.</p>` : '';
  const nameOf = id => E.mods[id]?.name || id;
  const DRUM = { BD: 'kick drum', SD: 'snare', CP: 'clap', CH: 'closed hi-hat', OH: 'open hi-hat', LT: 'low tom', HT: 'high tom', RS: 'rimshot', CB: 'cowbell', CY: 'cymbal' };
  // background that is worth reading once per session; later steps skip it so the bubbles stay short
  const taught = new Set();
  const once = (k, html) => taught.has(k) ? '' : (taught.add(k), html);

  // what the common knobs do, by their label
  const GLOSS = {
    cutoff: 'Cutoff sets where the filter starts removing high frequencies. Higher lets more brightness and buzz through; lower makes the sound darker and rounder.',
    reso: 'Resonance boosts the frequencies right at the cutoff. A little adds bite and "squelch"; a lot makes the filter whistle.',
    q: 'Q (resonance) narrows the filter and boosts the band at its frequency, so the sound becomes more vocal and pointed.',
    'env mod': 'Envelope amount: how far each note\'s envelope pushes the filter open. This is what makes notes "wow" or pluck.',
    env: 'Envelope amount: how far each note\'s envelope moves the filter, giving every note a moving, plucked shape.',
    decay: 'Decay is how long a note takes to fade after it starts. Short is tight and punchy; long rings out.',
    dec: 'Decay is how long a note takes to fade after it starts. Short is tight and punchy; long rings out.',
    attack: 'Attack is how long a note takes to reach full volume. Slow attacks swell in; fast ones hit immediately.',
    att: 'Attack is how long a note takes to reach full volume. Slow attacks swell in; fast ones hit immediately.',
    release: 'Release is how long a note keeps sounding after the key or gate lets go.',
    rel: 'Release is how long a note keeps sounding after the key or gate lets go.',
    sustain: 'Sustain is the level a held note settles at after its attack and decay.',
    accent: 'Accent makes the accented steps louder and snappier, which gives a line its groove.',
    glide: 'Glide (portamento) slides the pitch smoothly from one note to the next instead of jumping.',
    drive: 'Drive pushes the signal into saturation, adding harmonics, grit and loudness.',
    saturate: 'Saturation rounds off the peaks of the wave, adding warmth and harmonics.',
    detune: 'Detune spreads the oscillators slightly out of tune with each other, which makes the sound wider and thicker.',
    unison: 'Unison stacks several copies of the voice, each slightly detuned, for a huge, wide sound.',
    level: 'Level sets how loud this channel or output is in the mix.',
    volume: 'Volume sets how loud this part is.',
    gain: 'Gain sets how hard the signal is driven into this stage.',
    mix: 'Mix balances the processed (wet) sound against the original (dry) one.',
    tempo: 'Tempo is the speed of the whole rack in beats per minute; every sequencer follows it.',
    swing: 'Swing delays every other 16th note a little, turning a stiff grid into a shuffle.',
    gate: 'Gate length sets how long each step holds its note: short is staccato, long is legato.',
    prob: 'Probability is the chance each step actually plays, so the pattern changes a little each time round.',
    chance: 'Chance is how likely each event is to fire, which adds variation.',
    ratchet: 'Ratchets repeat a step several times quickly, like a drum roll on a single note.',
    density: 'Density sets how many steps fire: low is sparse, high is busy.',
    lock: 'Lock decides how much the random pattern repeats. High lock loops the same phrase; low lock keeps inventing.',
    'déjà vu': 'Déjà vu decides how often the random generator repeats itself instead of inventing something new.',
    scale: 'Scale picks which notes the sequencer is allowed to play, so random or programmed notes stay in key.',
    root: 'Root is the key\'s home note.',
    octave: 'Octave moves the whole line up or down by octaves.',
    transp: 'Transpose shifts the line up or down by scale steps.',
    folds: 'Folds sets how many times the wavefolder folds the wave back on itself; more folds mean brighter, more metallic harmonics.',
    symmetry: 'Symmetry offsets the wave before folding, which changes which harmonics come out.',
    freq: 'Frequency sets the centre of the filter.',
    mode: 'Mode switches what kind of processing this module does.',
    model: 'Model swaps the whole character of the voice for a different classic design.',
    body: 'Body picks what physical object is being modelled: a string, a bar, a membrane and so on.',
    wave: 'Wave picks the oscillator\'s waveform, the raw tone everything else shapes.',
    shape: 'Shape morphs the waveform or curve between different forms.',
    rate: 'Rate sets how fast this module moves.',
    speed: 'Speed sets how fast the modulation moves.',
    depth: 'Depth sets how strongly this modulation affects its target.',
    chaos: 'Chaos makes the motion less predictable.',
    feedback: 'Feedback sends the output back into the input; more makes echoes repeat longer or the sound self-oscillate.',
    time: 'Time sets the delay or length of the effect.',
    size: 'Size sets how big the simulated space or grain is.',
    tone: 'Tone tilts the sound brighter or darker.',
    'low cut': 'Low cut removes the deep lows so this part does not muddy the bass.',
    bits: 'Bits lowers the resolution of the sound for a crunchy, digital, lo-fi edge.',
    'sample rate': 'Sample rate reduction makes the sound grainy and aliased, like old samplers and game consoles.',
    width: 'Width sets how wide the sound sits across the stereo field.',
    spread: 'Spread pushes the voices or LFOs apart from each other.',
    pitch: 'Pitch tunes this part up or down.',
    tune: 'Tune sets the base pitch of this sound.',
    exposure: 'Exposure is how much radiation reaches the Geiger tube: more exposure, more random clicks.',
    click: 'Click sets the volume of the Geiger counter\'s clicks.',
    vowel: 'Vowel morphs the formant filter through A-E-I-O-U, which makes the sound "talk".',
    sub: 'Sub mixes in a sine an octave below for weight.',
    'wob rate': 'Wobble rate sets how fast the wobble LFO moves, usually locked to the beat for dubstep wubs.',
    'wob→cut': 'How strongly the wobble LFO opens and closes the filter: this is the "wub".',
    'table a': 'Wavetable A picks the first wavetable the oscillator scans through.',
    'table b': 'Wavetable B picks the second wavetable.',
    'pos a': 'Position scans through the wavetable, changing the timbre without changing the pitch.',
    master: 'Master sets the overall volume of everything going to the speakers.',
    plate: 'Plate sets how much of the built-in plate reverb this mixer adds.',
    duck: 'Duck lowers this sound whenever the trigger hits, so the kick can punch through.',
    pump: 'Pump makes the sound breathe in time with the beat, like sidechain compression.',
    freeze: 'Freeze holds the current sound in place and lets it hang.',
    shimmer: 'Shimmer adds an octave-up glow to the reverb tail.',
  };
  const gloss = (p, key) => GLOSS[String(p.label).toLowerCase()] || GLOSS[key]
    || (/^CH\d$/i.test(p.label) ? `This is the volume fader for mixer channel ${p.label.slice(2)}: it sets how loud that part sits against the others.` : '')
    || (/^FX\d$/i.test(p.label) ? `This is the effects send for channel ${p.label.slice(2)}: how much of that part goes into the mixer's tape delay and plate reverb.` : '');
  const atNorm = (p, n) => { const o = Object.create(p); o.n = n; o.mod = 0; return o.display(); };
  const normFor = (p, to) => {
    if (typeof to === 'string') { const n = p.normOf(to); if (n != null) return n; const v = parseFloat(to); return isNaN(v) ? null : DSP.clamp(v); }
    if (typeof to === 'number') { if (p.steps) { const n = p.normOf(String(to)); if (n != null) return n; } return DSP.clamp(to); }
    return null;
  };
  function modDesc(type, mod) {
    const t = Mods.TYPES[type] || {};
    if (mod?.kind === 'Analog' && mod.MODEL_INFO) return `${t.label || type}. Its current model is ${mod.params.model.choice}: ${mod.MODEL_INFO[mod.params.model.choice]}.`;
    const own = {
      StepSeq: 'A step sequencer: 16 steps of notes, gates, accents and slides that play in time with the clock and tell a voice what to play.',
      Entropy: 'A noise-driven sequencer: it turns random noise into melodies, with Lock deciding how much it repeats.',
      Drums: 'The drum machine: a grid of kick, snare, hats and percussion patterns driven by the clock.',
      Titan: 'A wavetable bass synth in the style of big dubstep and EDM basses, with a wobble LFO, unison and filter.',
      Chip: 'A chiptune voice: pulse, triangle and noise waves like 8-bit game consoles.',
      Bodies: 'A physical model: it simulates a struck or plucked object (string, marimba bar, membrane) instead of using oscillators.',
      Geiger: 'A Geiger counter: it turns random radioactive-style decay events into clicks and triggers.',
      Slope: 'A Serge-style slope generator: rise and fall times that make envelopes, LFOs or slew.',
      Fold: 'A Serge-style wavefolder: it folds the waveform back on itself to add bright, complex harmonics.',
      VCFQ: 'A Serge-style VCF-Q filter that can be low-pass, band-pass, high-pass or notch.',
      Mixer: 'A mixing desk: each channel has a level and an effects send, and it all sums to one output.',
    }[type];
    return own || (t.label ? `${t.label}${t.desc ? ': ' + t.desc : ''}.` : type);
  }
  const jackKind = j => ({ audio: 'an audio signal (the sound itself)', cv: 'a control voltage (a slowly moving value that steers a knob or pitch)', ev: 'gates and triggers (timing events that start notes and envelopes)' }[j?.jt] || 'a signal');
  const PATCH_HINT = { audio: 'Audio cables carry sound from one module to the next, so this is building the signal path.', cv: 'Control cables do not make sound themselves; they move something else, like pitch or a filter.', ev: 'Trigger cables decide when things happen: when notes start, when envelopes fire.' };

  function explain(a) {
    const m = E.mods[a.mod];
    switch (a.do) {
      case 'say': return { kind: 'Thinking', title: 'The AI explains its plan', body: `<p>${esc(a.text)}</p>`, };
      case 'knob': {
        const p = m?.params[a.key]; if (!p) return null;
        const n = normFor(p, a.to); if (n == null || Math.abs(n - p.n) < 0.004) return null;
        const from = p.display(), to = atNorm(p, n), up = n > p.n;
        const dir = p.steps ? `switching it from <b>${esc(from)}</b> to <b>${esc(to)}</b>` : `turning it ${up ? 'up' : 'down'} from <b>${esc(from)}</b> to <b>${esc(to)}</b>`;
        return { kind: 'Knob', title: `${nameOf(a.mod)} · ${p.label}`, body: `<p>I am reaching for the <b>${esc(p.label)}</b> knob on <b>${esc(nameOf(a.mod))}</b> and ${dir}.</p>${gloss(p, a.key) ? `<p>${esc(gloss(p, a.key))}</p>` : ''}${why(a)}` };
      }
      case 'patch': case 'unpatch': {
        if (a.do === 'unpatch') {
          const [tm, tp] = String(a.to).split('.'), c = E.findCable(tm, tp); if (!c) return null;
          return { kind: 'Cable', title: `Unplug ${nameOf(c.from.mod)} → ${nameOf(tm)}`, body: `<p>I am pulling out the cable that runs from <b>${esc(nameOf(c.from.mod))} ${esc(c.from.port)}</b> into <b>${esc(nameOf(tm))} ${esc(tp)}</b>. Without it, ${esc(nameOf(tm))} stops receiving that signal.</p>${why(a)}` };
        }
        const [fm, fp] = String(a.from).split('.'), [tm, tp] = String(a.to).split('.');
        if (!E.canConnect({ mod: fm, port: fp }, { mod: tm, port: tp })) return null;
        const ex = E.findCable(tm, tp); if (ex && ex.from.mod === fm && ex.from.port === fp) return null;
        const o = E.mods[fm].outs[fp], i = E.mods[tm].ins[tp];
        return { kind: 'Cable', title: `Patch ${nameOf(fm)} ${fp} → ${nameOf(tm)} ${tp}`, body: `<p>I am taking a cable from the <b>${esc(fp)}</b> output of <b>${esc(nameOf(fm))}</b>${o?.desc ? ` (${esc(o.desc)})` : ''} to the <b>${esc(tp)}</b> input of <b>${esc(nameOf(tm))}</b>${i?.desc ? ` (${esc(i.desc)})` : ''}.</p><p>This cable carries ${jackKind(o)}.${once('jt-' + o?.jt, ' ' + (PATCH_HINT[o?.jt] || ''))}${ex ? ' The cable already in that jack gets unplugged first.' : ''}</p>${why(a)}` };
      }
      case 'add': {
        if (a.id && E.mods[a.id]) return null; if (!Mods.TYPES[a.type]) return null;
        return { kind: 'Module', title: `Add ${Mods.TYPES[a.type].label}`, body: `<p>I am adding a new module to the rack.</p><p>${esc(modDesc(a.type))}</p>${why(a)}` };
      }
      case 'remove': if (!m || ['clock', 'mixer', 'monitor'].includes(a.mod)) return null;
        return { kind: 'Module', title: `Remove ${m.name}`, body: `<p>I am taking <b>${esc(m.name)}</b> out of the rack, along with all its cables.</p>${why(a)}` };
      case 'steps': case 'pattern': {
        if (!m?.pats) return null; const notes = (a.notes || []).filter(v => v != null).length;
        return { kind: 'Sequence', title: `Program ${m.name}${a.pat != null ? ' pattern ' + a.pat : ''}`, body: `<p>I am writing a 16-step pattern into <b>${esc(m.name)}</b>: ${notes} steps play a note and the rest are rests.${a.slides?.length ? ` ${a.slides.length} steps slide into the next note,` : ''}${a.accents?.length ? ` ${a.accents.length} are accented.` : ''}</p>${once('steps', '<p>The notes are scale degrees, so the line stays in key whatever the Root and Scale knobs say. Rests matter as much as notes: they give the line its rhythm.</p>')}${why(a)}` };
      }
      case 'drums': case 'drumbank': {
        const d = E.mods.drums; if (!d) return null;
        const bi = a.pat == null ? (d.view ?? d.cur) : 'ABCDEFGH'.indexOf(String(a.pat).toUpperCase()); if (bi < 0) return null;
        const rows = a.do === 'drumbank' ? Object.fromEntries(d.INST.map(k => [k, (a.rows || {})[k] || ''])) : { [String(a.inst).toUpperCase()]: a.pattern };
        const parts = [];
        for (const [ins, txt] of Object.entries(rows)) {
          const r = d.INST.indexOf(ins); if (r < 0) continue;
          const pat = String(txt || '').padEnd(16, '.').slice(0, 16), v = [...pat].map(c => c === 'X' ? 2 : (c === 'x' || c === 'o') ? 1 : 0);
          if (v.every((x, k) => x === d.pats[bi][r][k])) continue;
          parts.push([ins, v]);
        }
        if (!parts.length) return null;
        const desc = parts.map(([ins, v]) => {
          const hits = v.filter(Boolean).length, acc = v.filter(x => x === 2).length;
          if (!hits) return `<b>${DRUM[ins] || ins}</b>: clearing it, so it drops out`;
          const four = [0, 4, 8, 12].every(k => v[k]) && hits === 4, back = hits === 2 && v[4] && v[12], off = hits === 4 && [2, 6, 10, 14].every(k => v[k]);
          const feel = four ? 'four on the floor, one hit on every beat' : back ? 'on beats 2 and 4, the backbeat' : off ? 'on the off-beats, between the kicks' : hits >= 12 ? 'a busy, driving line' : hits <= 3 ? 'a few sparse hits' : `${hits} hits spread across the bar`;
          return `<b>${DRUM[ins] || ins}</b>: ${feel}${acc ? `, ${acc} accented` : ''}`;
        });
        return { kind: 'Drums', title: a.do === 'drumbank' ? `Write drum pattern ${'ABCDEFGH'[bi]}` : `Write the ${DRUM[String(a.inst).toUpperCase()] || a.inst} part`, body: `<p>I am clicking steps on the drum grid. ${desc.join('; ')}.</p>${once('drumgrid', '<p>Each row of the grid is one drum and each column is a 16th note, four per beat. A lit cell plays; a bright cell plays accented.</p>')}${why(a)}` };
      }
      case 'mute': {
        const d = E.mods.drums, r = d ? d.INST.indexOf(String(a.inst).toUpperCase()) : -1; if (r < 0 || d.mute[r] === !!a.on) return null;
        const nm = DRUM[String(a.inst).toUpperCase()] || a.inst;
        return { kind: 'Drums', title: `${a.on ? 'Mute' : 'Unmute'} the ${nm}`, body: `<p>I am ${a.on ? 'muting' : 'bringing back'} the <b>${esc(nm)}</b>.</p>${once('mute', '<p>Taking parts out and putting them back is how a loop turns into a performance with tension and release.</p>')}${why(a)}` };
      }
      case 'copy': return m?.pats ? { kind: 'Sequence', title: `Copy pattern ${a.from} → ${a.to}`, body: `<p>I am copying pattern <b>${esc(a.from)}</b> of ${esc(m.name)} into slot <b>${esc(a.to)}</b>, so I can make a variation without losing the original.</p>${why(a)}` } : null;
      case 'select': return m?.pats ? { kind: 'Sequence', title: `${m.name}: switch to ${a.pat}`, body: `<p>I am queuing pattern <b>${esc(a.pat)}</b> on ${esc(m.name)}. It switches at the end of the current bar so the change lands on the beat.</p>${why(a)}` } : null;
      case 'song': return m?.pats ? { kind: 'Song', title: `${m.name}: write the song`, body: `<p>I am chaining patterns into a song order, for example verse, chorus, verse, so the part changes on its own over time instead of looping one pattern forever.</p>${why(a)}` } : null;
      case 'transport': if (!!a.run === E.running) return null;
        return { kind: 'Clock', title: a.run ? 'Start the clock' : 'Stop the clock', body: `<p>I am pressing ${a.run ? 'start' : 'stop'} on the master clock. Every sequencer and drum machine in the rack follows it, so this ${a.run ? 'starts' : 'stops'} the music.</p>` };
      case 'route': return { kind: 'Mix', title: `Send ${nameOf(a.mod)} to the mixer`, body: `<p>I am finding a free mixer channel for <b>${esc(nameOf(a.mod))}</b>, then patching it in and setting its level${a.send != null ? ' and reverb send' : ''}. A module only reaches the speakers once it is in the mix.</p>${why(a)}` };
      case 'insert': return Mods.TYPES[a.type] ? { kind: 'Effect', title: `Put ${Mods.TYPES[a.type].label} on ${nameOf(a.into)}`, body: `<p>I am inserting an effect after <b>${esc(nameOf(a.into))}</b>: its output will go through the effect first, and the effect takes over the old path to the mixer.</p><p>${esc(modDesc(a.type))}</p>${why(a)}` } : null;
      case 'mod': {
        const [tm, tk] = String(a.to).split('.'), p = E.mods[tm]?.params[tk]; if (!p) return null;
        return { kind: 'Modulation', title: `Modulate ${nameOf(tm)} ${p.label}`, body: `<p>I am dropping a modulation cable from <b>${esc(a.from)}</b> onto the <b>${esc(p.label)}</b> knob of ${esc(nameOf(tm))}, then opening its depth to about ${Math.round((a.depth ?? 0.25) * 100)}%.</p>${once('mod', '<p>Now that knob moves by itself, following the modulator, so the sound keeps evolving. The coloured ring around the knob shows how far it can swing.</p>')}${why(a)}` };
      }
      case 'moddepth': { const p = m?.params[a.key]; if (!p) return null; return { kind: 'Modulation', title: `${nameOf(a.mod)} ${p.label}: depth`, body: `<p>I am changing how far the modulation swings the <b>${esc(p.label)}</b> knob, to ${Math.round(a.depth * 100)}%. Bigger depth means a more dramatic movement.</p>${why(a)}` }; }
      case 'unmod': { const p = m?.params[a.key]; if (!p) return null; return { kind: 'Modulation', title: `Stop modulating ${p.label}`, body: `<p>I am removing the modulation from ${esc(nameOf(a.mod))} <b>${esc(p.label)}</b>, so the knob stays where it is set.</p>${why(a)}` }; }
      case 'performer': return { kind: 'Modulation', title: `${nameOf(a.mod)}: ${a.preset}`, body: `<p>I am drawing a new curve into lane ${a.lane || 1} of the Performer. Its ${esc(a.preset)} shape repeats every bar and moves whatever it is patched to in time with the beat.</p>${why(a)}` };
      case 'build': return { kind: 'Build', title: `${nameOf(a.mod)}: build`, body: `<p>I am starting a riser: over the next ${esc(a.bars || 'few')} bars this ramps up the knobs it controls, building tension before the drop.</p>${why(a)}` };
      case 'fire': return { kind: 'Glitch', title: `${nameOf(a.mod)}: ${a.type || 'glitch'}`, body: `<p>I am firing a one-off ${esc(a.type || 'glitch')} effect: a quick stutter, reverse or tape stop that marks a transition.</p>${why(a)}` };
      default: return null;
    }
  }
  const COMPOSITE = new Set(['route', 'insert']); // these run other steps, so they are read before they start

  // ---------------- pacing ----------------
  const base = () => ($('#fast')?.checked ? 0.45 : 1);
  const readMs = info => { const words = (info.title + ' ' + info.body.replace(/<[^>]+>/g, ' ')).split(/\s+/).filter(Boolean).length; return 1200 + words / PACE[pace] * 1000; };
  // hold until the text has been on screen long enough (time spent hovering the bubble does not count)
  function hold(shownAt, need, id) {
    return new Promise(res => {
      let read = performance.now() - shownAt, last = performance.now();
      const tick = () => {
        const t = performance.now(); if (!hovered) read += t - last; last = t;
        if (id === stepN) q('.tb-bar i').style.width = Math.min(100, read / need * 100).toFixed(1) + '%';
        if (read >= need || skipped || !T.on || AI.abort || id !== stepN) { wake = null; return res(); }
        requestAnimationFrame(tick);
      };
      wake = res; tick();
    });
  }
  T.step = async function (a, h, exec) {
    const info = T.on && explain(a);
    if (!info) return exec();
    const id = ++stepN; skipped = false; handIx = 0; active++;
    UI.speed = base() * T.slow;
    show(info, id); const shownAt = performance.now(), need = readMs(info);
    try {
      if (COMPOSITE.has(a.do)) { await hold(shownAt, need, id); return await exec(); }
      await exec();
      if (id === stepN) await hold(shownAt, need, id); // only the latest step waits for reading
    } finally { active--; }
  };
  T.skip = function () {
    if (!T.on || !bub.classList.contains('on')) return;
    skipped = true; UI.speed = base(); bub.classList.add('skipping');
    q('.tb-bar i').style.width = '100%';
  };
  T.set = function (on) {
    T.on = !!on; document.body.classList.toggle('tutor', T.on);
    const tb = $('#tutor'); if (tb) tb.checked = T.on;
    $('#tutorskip').disabled = !T.on;
    if (T.on) {
      // one hand only, so there is one thing to follow
      prevTwo = UI.twoHands; if (UI.twoHands) { UI.setTwoHands(false); const c = $('#twohands'); if (c) c.checked = false; }
      if (UI.followMode === 'off') { UI.followMode = 'h0'; const f = $('#follow'); if (f) f.value = 'h0'; }
    } else {
      UI.speed = base(); hide(); skipped = true;
      if (prevTwo) { UI.setTwoHands(true); const c = $('#twohands'); if (c) c.checked = true; }
      prevTwo = null;
    }
    try { localStorage.setItem('patchmind.tutor', JSON.stringify({ on: T.on, pace })); } catch (e) { /* storage off */ }
  };
  T.setPace = p => { if (PACE[p]) pace = p; try { localStorage.setItem('patchmind.tutor', JSON.stringify({ on: T.on, pace })); } catch (e) { /* storage off */ } };
  T.hide = hide;
  // the bubble goes away once the AI has finished and no step is being explained
  let idleSince = 0;
  setInterval(() => {
    if (!bub.classList.contains('on') || active || AI.busy) { idleSince = 0; return; }
    if (!idleSince) idleSince = performance.now(); else if (performance.now() - idleSince > 900) hide();
  }, 300);

  // ---------------- controls ----------------
  $('#tutor').onchange = e => T.set(e.target.checked);
  $('#tutorskip').onclick = () => T.skip();
  $('#tutorpace').onchange = e => T.setPace(e.target.value);
  $('#fast').addEventListener('change', () => { if (T.on && !skipped) UI.speed = base() * T.slow; });
  $('#stop').addEventListener('click', () => { skipped = true; hide(); });
  document.addEventListener('keydown', e => {
    if (!T.on || e.metaKey || e.ctrlKey || e.altKey || /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) || e.target.isContentEditable) return;
    if (e.key === 'n' || e.key === 'N') { e.preventDefault(); T.skip(); }
  });
  try { const s = JSON.parse(localStorage.getItem('patchmind.tutor') || 'null'); if (s?.pace && PACE[s.pace]) { pace = s.pace; $('#tutorpace').value = pace; } if (s?.on) T.set(true); } catch (e) { /* storage off */ }
  T.explain = explain;
  return T;
})();
