// theory.js — the music theory the AI uses to build songs: song forms, section roles, energy arcs, functional
// harmony, progressions, harmonic rhythm, cadences, melody writing (chord tones on strong beats, hooks, register),
// bass writing, drum arrangement per section, builds, push-pull and transitions.
// Notes are scale degrees. Sequencers set to "Harmony: SONG" add the current chord root, so patterns are written
// relative to the chord: 0 = chord root, 2 = third, 4 = fifth, 6 = seventh, 7 = octave; 1, 3, 5 are passing tones.
'use strict';
const Theory = (() => {
  const rnd = Math.random, pick = a => a[Math.floor(rnd() * a.length)], ri = (a, b) => a + Math.floor(rnd() * (b - a + 1));
  const clamp = DSP.clamp;
  const wpick = list => { let r = rnd() * list.reduce((s, x) => s + x[1], 0); for (const [v, w] of list) if ((r -= w) <= 0) return v; return list[0][0]; };

  // ======================= FORMS =======================
  // bars are at the "normal" length; the planner scales them to the requested duration in 4-bar phrases.
  const FORMS = {
    'verse-chorus': { label: 'Verse / chorus (default)', parts: [['intro', 4], ['verse', 8], ['build', 4], ['chorus', 8], ['verse', 8], ['build', 4], ['chorus', 8], ['bridge', 8], ['build', 4], ['chorus', 8, 'final'], ['outro', 4]] },
    'pop': { label: 'Pop: verse, pre-chorus, chorus', parts: [['intro', 4], ['verse', 8], ['pre', 4], ['chorus', 8], ['post', 4], ['verse', 8], ['pre', 4], ['chorus', 8], ['bridge', 8], ['chorus', 8, 'final'], ['outro', 4]] },
    'edm': { label: 'Club: build and drop', parts: [['intro', 8], ['build', 8], ['drop', 16], ['break', 8], ['build', 8], ['drop', 16, 'final'], ['outro', 8]] },
    'aaba': { label: 'AABA (32-bar song)', parts: [['intro', 4], ['verse', 8], ['verse', 8], ['bridge', 8], ['verse', 8, 'final'], ['outro', 4]] },
    'through': { label: 'Ambient arc: A B A′ C A', parts: [['intro', 8], ['verse', 16], ['bridge', 16], ['verse', 16], ['break', 16], ['verse', 16, 'final'], ['outro', 8]] }
  };
  function formFor(p, wanted) {
    if (wanted && FORMS[wanted]) return wanted;
    const t = (p?.task || '') + ' ' + (p?.persona || '');
    if (/aaba|32.?bar|jazz standard/i.test(t)) return 'aaba';
    if (/pre.?chorus|pop/i.test(t)) return 'pop';
    if (/verse|chorus/i.test(t)) return 'verse-chorus';
    if (/drop|build.?up|festival|rave/i.test(t) || ['dubstep', 'dnb'].includes(p?.genre)) return 'edm';
    if (['ambient'].includes(p?.genre)) return 'through';
    return 'verse-chorus';
  }

  // ======================= SECTION ROLES =======================
  // energy: target loudness/brightness/motion · dens: note density · reg: register shift in octaves · hr: bars per chord
  // drums: how the kit plays · bass/lead/arp: what each part does · slot: pattern bank used for the section
  const ROLES = {
    intro:  { energy: 0.3, dens: 0.3, reg: 0, hr: 2, drums: 'intro', bass: 'out', lead: 'hint', arp: 'sparse', slot: 0, prog: 'intro', why: 'set the mood with a few elements and a hint of the hook' },
    verse:  { energy: 0.5, dens: 0.45, reg: 0, hr: 2, drums: 'verse', bass: 'groove', lead: 'verse', arp: 'sparse', slot: 1, prog: 'verse', why: 'tell the story: lower, narrower melody, room to breathe' },
    pre:    { energy: 0.65, dens: 0.55, reg: 0, hr: 1, drums: 'build', bass: 'pedal', lead: 'rise', arp: 'rise', slot: 2, prog: 'pre', why: 'lean toward the dominant so the chorus feels like arrival' },
    build:  { energy: 0.72, dens: 0.6, reg: 0, hr: 1, drums: 'build', bass: 'pedal', lead: 'rise', arp: 'rise', slot: 2, prog: 'build', why: 'raise tension: rising filter, snare roll, denser rhythm, then pull out before the drop' },
    chorus: { energy: 0.9, dens: 0.7, reg: 1, hr: 1, drums: 'full', bass: 'drive', lead: 'hook', arp: 'full', slot: 3, prog: 'chorus', why: 'the payoff: the hook, higher register, everything in, strongest progression' },
    drop:   { energy: 0.95, dens: 0.7, reg: 0, hr: 2, drums: 'full', bass: 'drive', lead: 'hook', arp: 'full', slot: 3, prog: 'drop', why: 'release all the tension at once' },
    post:   { energy: 0.6, dens: 0.4, reg: 0, hr: 2, drums: 'verse', bass: 'groove', lead: 'hint', arp: 'sparse', slot: 4, prog: 'verse', why: 'let the chorus ring out before the next verse' },
    bridge: { energy: 0.45, dens: 0.35, reg: 0, hr: 2, drums: 'half', bass: 'long', lead: 'contrast', arp: 'held', slot: 4, prog: 'bridge', why: 'contrast: new chords away from the tonic, new rhythm, so the last chorus feels fresh' },
    break:  { energy: 0.35, dens: 0.3, reg: 0, hr: 4, drums: 'break', bass: 'out', lead: 'hint', arp: 'held', slot: 4, prog: 'break', why: 'breathe: strip back to texture and space' },
    outro:  { energy: 0.25, dens: 0.25, reg: 0, hr: 2, drums: 'intro', bass: 'long', lead: 'hint', arp: 'sparse', slot: 5, prog: 'outro', why: 'wind down and land on the tonic' }
  };
  const FINAL = { slot: 6, energy: 1, why: 'biggest chorus: everything in, extra layers, maybe a key lift' };

  // ======================= HARMONY =======================
  // Function: tonic (I, vi, iii) is rest, subdominant (IV, ii) moves away, dominant (V, vii°) wants to resolve home.
  // Degrees are 0-based: 0 = I, 1 = ii, 2 = iii, 3 = IV, 4 = V, 5 = vi, 6 = vii.
  const PROGS = {
    intro: [[0, 0, 3, 3], [0, 5, 0, 5], [0, 0, 0, 0], [0, 3, 0, 4]],
    verse: [[0, 5, 3, 4], [0, 3, 0, 4], [0, 0, 3, 4], [0, 6, 5, 6], [0, 2, 3, 0], [5, 3, 0, 4], [0, 5, 1, 4], [0, 3, 5, 4], [0, 1, 0, 1]],
    pre: [[3, 4, 3, 4], [1, 3, 4, 4], [5, 3, 1, 4], [3, 3, 4, 4], [1, 4, 1, 4]],
    build: [[3, 4, 3, 4], [5, 3, 4, 4], [3, 3, 4, 4], [0, 3, 4, 4]],
    chorus: [[0, 4, 5, 3], [5, 3, 0, 4], [0, 3, 4, 3], [3, 4, 0, 5], [0, 5, 3, 4], [3, 0, 4, 5], [0, 6, 5, 4], [0, 3, 5, 4]],
    drop: [[0, 0, 0, 0], [0, 5, 0, 5], [0, 3, 4, 0], [0, 6, 5, 6]],
    bridge: [[5, 3, 0, 4], [3, 4, 5, 5], [1, 4, 0, 5], [5, 6, 4, 4], [3, 2, 1, 4], [6, 5, 3, 4]],
    break: [[0, 3], [0, 5], [0], [5, 3]],
    outro: [[0, 3, 0, 0], [3, 4, 0, 0], [0, 5, 3, 0], [3, 0]]
  };
  // name a chord from the scale: third and fifth intervals decide major / minor / diminished
  function chordName(scale, deg) {
    const s = DSP.SCALES[scale] || DSP.SCALES.MINOR, n = s.length;
    const at = k => s[((deg + k) % n + n) % n] + 12 * Math.floor((deg + k) / n);
    const third = at(2) - at(0), fifth = at(4) - at(0);
    const R = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'][((deg % 7) + 7) % 7];
    if (n !== 7) return R;
    if (third === 3 && fifth === 6) return R.toLowerCase() + '°';
    if (third === 3) return R.toLowerCase();
    if (fifth === 8) return R + '+';
    return R;
  }
  function progressionFor(role, scale, prev) {
    let opts = PROGS[ROLES[role]?.prog || role] || PROGS.verse;
    if (prev) { const f = opts.filter(o => o.join() !== prev.join()); if (f.length) opts = f; }
    let pr = pick(opts).slice();
    // avoid diminished chords on strong positions in 7-note scales (they sound unstable outside a dominant role)
    // diminished chords sound unstable outside a passing role: swap them for the dominant of this mode
    if (DSP.SCALES[scale]?.length === 7) pr = pr.map(d => chordName(scale, d).includes('°') ? dominant(scale) : d);
    return pr;
  }
  // cadence: how the section ends. Authentic (V→I) closes, half (→V) leaves it open, plagal (IV→I) softens, deceptive (V→vi) surprises.
  // the dominant: V, or bVII / iv when V is diminished in this mode (Phrygian, Locrian-ish scales)
  const dominant = scale => [4, 6, 3].find(d => !chordName(scale, d).includes('°')) ?? 4;
  function cadence(role, prog, scale) {
    const p = prog.slice(), k = p.length - 1, V = dominant(scale);
    if (role === 'build' || role === 'pre') { p[k] = V; return { prog: p, kind: 'half cadence (ends on V, wants to resolve into the chorus)' }; }
    if (role === 'outro') { p[k] = 0; if (k > 0) p[k - 1] = rnd() < 0.5 ? V : 3; return { prog: p, kind: rnd() < 0.5 ? 'authentic cadence (V→I)' : 'plagal cadence (IV→I)' }; }
    if (role === 'verse' && rnd() < 0.3) { if (k > 0) p[k - 1] = V; p[k] = 5; return { prog: p, kind: 'deceptive cadence (V→vi)' }; }
    return { prog: p, kind: 'open loop' };
  }

  // ======================= RHYTHM HELPERS =======================
  const STRONG = [0, 8], MED = [4, 12];
  function rhythm(dens, style) {
    const on = Array(16).fill(false);
    if (style === 'hook') { // a short cell repeated: the ear latches on to repetition
      const cellLen = pick([4, 8]), cell = Array.from({ length: cellLen }, (_, i) => i === 0 || rnd() < dens * 0.8);
      for (let i = 0; i < 16; i++) on[i] = cell[i % cellLen];
      if (rnd() < 0.5) for (let i = 12; i < 16; i++) on[i] = rnd() < dens; // vary the end of the bar
    } else if (style === 'syncop') { for (let i = 0; i < 16; i++) on[i] = rnd() < (i % 4 === 0 ? 0.3 : i % 2 ? dens * 0.8 : dens * 0.5); on[pick([0, 2, 3])] = true; }
    else if (style === 'long') { on[0] = true; if (rnd() < 0.6) on[8] = true; if (rnd() < 0.3) on[ri(10, 14)] = true; }
    else if (style === 'rise') { for (let i = 0; i < 16; i++) on[i] = rnd() < dens * (0.4 + i / 16); on[0] = true; }
    else { for (let i = 0; i < 16; i++) on[i] = rnd() < (STRONG.includes(i) ? 0.85 : MED.includes(i) ? 0.6 : i % 2 ? dens * 0.6 : dens * 0.8); on[0] = true; }
    return on;
  }

  // ======================= PART WRITERS =======================
  // Melody: chord tones (0, 2, 4, 7) on strong beats, steps and passing tones between, a clear peak, ending on a stable tone.
  function melodyLine(role, opts = {}) {
    const R = ROLES[role] || ROLES.verse, dens = clamp(R.dens + (opts.chaos || 0) * 0.15 + (rnd() - 0.5) * 0.2);
    const style = role === 'chorus' || role === 'drop' ? 'hook' : role === 'build' || role === 'pre' ? 'rise' : role === 'bridge' ? pick(['syncop', 'long']) : role === 'intro' || role === 'outro' || role === 'break' ? 'long' : 'syncop';
    const on = rhythm(dens, style);
    const lo = role === 'chorus' || role === 'drop' ? 2 : -2, hi = role === 'chorus' || role === 'drop' ? 11 : 7;
    const notes = Array(16).fill(null);
    let v = opts.hook ? opts.hook[0] ?? 4 : pick([0, 2, 4]);
    const peakAt = ri(5, 12); let used = 0;
    for (let i = 0; i < 16; i++) {
      if (!on[i]) continue;
      if (opts.hook && opts.hook[i] != null && rnd() < 0.85) { notes[i] = opts.hook[i]; v = opts.hook[i]; continue; } // keep the hook recognisable
      const strong = i % 4 === 0;
      if (style === 'rise') v = Math.min(hi, v + pick([1, 1, 2]));
      else if (strong) { const ct = [0, 2, 4, 7, 9, 11].filter(x => x >= lo && x <= hi); v = ct.reduce((b, x) => Math.abs(x - v) < Math.abs(b - v) && rnd() < 0.8 ? x : b, ct[0]); if (i >= peakAt && used < 1) { v = Math.min(hi, v + pick([2, 3, 5])); used++; } }
      else v = clamp(v + wpick([[1, 3], [-1, 3], [2, 1.5], [-2, 1.5], [0, 0.6], [3, 0.4], [-3, 0.4]]), lo, hi);
      notes[i] = v;
    }
    // end on a chord tone so the phrase resolves
    const last = notes.map((x, i) => x == null ? -1 : i).filter(i => i >= 0).pop();
    if (last != null && last >= 0) notes[last] = [0, 2, 4, 7].reduce((b, x) => Math.abs(x - notes[last]) < Math.abs(b - notes[last]) ? x : b, 0);
    const accents = notes.map((x, i) => x != null && i % 4 === 0 ? i : -1).filter(i => i >= 0);
    const slides = notes.map((x, i) => x != null && notes[i + 1] != null && Math.abs(notes[i + 1] - x) <= 2 && rnd() < 0.15 ? i : -1).filter(i => i >= 0);
    const ratchets = Array(16).fill(1); if (style === 'rise') for (let i = 12; i < 16; i++) if (notes[i] != null) ratchets[i] = pick([1, 2, 2, 3]);
    return { notes, accents, slides, ratchets, idea: { hook: 'a repeated hook cell', rise: 'a line that climbs into the next section', syncop: 'a syncopated, conversational line', long: 'long held tones' }[style] };
  }
  // Bass: roots on the downbeat, fifths and octaves, approach notes into the next bar.
  function bassLine(role, genreHalf) {
    const R = ROLES[role] || ROLES.verse, mode = R.bass, notes = Array(16).fill(null), slides = [], accents = [];
    if (mode === 'out') return { notes, accents, slides, idea: 'bass out to leave room' };
    if (mode === 'long') { notes[0] = 0; if (rnd() < 0.5) notes[8] = pick([0, 4, -3]); return { notes, accents: [0], slides: [], idea: 'long root notes' }; }
    if (mode === 'pedal') { const step = rnd() < 0.5 ? 2 : 1; for (let i = 0; i < 16; i += step) notes[i] = i >= 12 && rnd() < 0.4 ? 7 : 0; return { notes, accents: [0, 8], slides: [], idea: `pedal ${step === 1 ? '16ths' : '8ths'} on the root to build pressure` }; }
    const hits = genreHalf ? [0, 3, 6, 10, 14] : mode === 'drive' ? pick([[0, 2, 4, 6, 8, 10, 12, 14], [0, 3, 6, 8, 11, 14], [0, 2, 3, 6, 8, 10, 11, 14]]) : pick([[0, 6, 8, 14], [0, 3, 8, 11], [0, 7, 8, 10], [0, 4, 8, 12], [0, 3, 6, 10]]);
    hits.forEach((s, k) => { notes[s] = k === 0 ? 0 : wpick([[0, 4], [4, 2], [7, 2], [2, 1], [-3, 0.6], [5, 0.4]]); if (rnd() < 0.25) accents.push(s); });
    if (rnd() < 0.6) { notes[15] = pick([-1, 1, 6]); slides.push(15); } // approach note leading into the next chord
    return { notes, accents, slides, idea: mode === 'drive' ? 'driving bass on roots, fifths and octaves' : 'a groove on the root with an approach note' };
  }
  // Arp / chords: chord tones in a pattern; density follows the section.
  function arpLine(role) {
    const mode = (ROLES[role] || ROLES.verse).arp, notes = Array(16).fill(null), T = [0, 2, 4, 7, 9];
    const shape = pick([[0, 1, 2, 3], [0, 2, 1, 3], [3, 2, 1, 0], [0, 1, 2, 1], [0, 2, 3, 4]]);
    const step = mode === 'full' ? 1 : mode === 'rise' ? 1 : mode === 'held' ? 8 : 2;
    let k = 0; for (let i = 0; i < 16; i += step) { if (mode === 'sparse' && rnd() < 0.3) continue; notes[i] = T[shape[k++ % shape.length]] + (mode === 'rise' && i >= 8 ? 2 : 0); }
    return { notes, accents: [0], slides: [], ratchets: Array(16).fill(1), idea: `${mode} arpeggio on chord tones` };
  }

  // ======================= DRUM ARRANGEMENT =======================
  const P = s => s.padEnd(16, '.').slice(0, 16);
  function drumsFor(role, base, variant) {
    const g = k => base[k] || '';
    const out = {}, set = (k, v) => { out[k] = P(v); };
    const mode = (ROLES[role] || ROLES.verse).drums;
    if (variant === 'roll') { set('BD', 'x...x...x...x...'); set('SD', 'x.x.x.x.xxxxxxxx'); set('CH', 'xxxxxxxxxxxxxxxx'); return out; }
    if (variant === 'pull') { set('SD', '....x...xxxxXXXX'); set('CH', 'x.x.x.x.x.x.xxxx'); return out; } // no kick: the pull before the push
    if (variant === 'fill') { Object.keys(base).forEach(k => set(k, g(k).slice(0, 12))); set('SD', g('SD').slice(0, 12) + pick(['xxXX', 'x.xX', '.xxX'])); set('LT', '............' + pick(['..xx', 'x.x.'])); set('HT', '............' + pick(['xx..', '.x.x'])); return out; }
    if (mode === 'intro') { ['CH', 'RS', 'OH', 'CB'].forEach(k => g(k) && set(k, g(k))); if (!Object.keys(out).length) set('CH', '..x...x...x...x.'); return out; }
    if (mode === 'verse') { Object.keys(base).forEach(k => k !== 'OH' && k !== 'CY' && set(k, g(k))); return out; }
    if (mode === 'build') { set('BD', 'x...x...x...x...'); set('SD', '....x.......x...'); set('CH', 'x.x.x.x.x.x.x.x.'); return out; }
    if (mode === 'half') { set('BD', 'x.........x.....'); set('SD', '........x.......'); set('CH', g('CH') || 'x...x...x...x...'); return out; }
    if (mode === 'break') { set('RS', 'x.....x.....x...'); set('CH', '........x.......'); return out; }
    Object.keys(base).forEach(k => set(k, g(k)));
    if (!out.OH) set('OH', '..x...x...x...x.');
    set('CY', 'x...............'); // crash on the downbeat of the payoff
    return out;
  }

  // ======================= THE PRIMER (for Claude, and the in-app reference) =======================
  const PRIMER = `SONG-WRITING THEORY FOR THIS RACK
Form: songs are built from contrasting sections. Default verse-chorus: intro, verse, build (pre-chorus), chorus, verse, build, chorus, bridge, build, final chorus, outro. Club form: intro, build, drop, break, build, drop, outro. Sections are 4, 8 or 16 bars (phrases of 4 bars; listeners expect changes on 4- and 8-bar boundaries).
Energy arc: intro 30%, verse 50%, build rising 60-75%, chorus 90%, bridge 45% (contrast), final chorus 100%, outro 25%. Each chorus should feel bigger than what came before it.
Contrast vs repetition: repeat the hook so it sticks; change something every 8 bars (add or remove a part, vary the drum pattern, open a filter) so it never stalls. Verse 2 should be a development of verse 1, not a copy.
Harmony (degrees in the current scale; 0 = I): tonic function I, vi, iii = rest; subdominant IV, ii = motion away; dominant V, vii° = tension that wants to resolve to I. Verses sit near the tonic; pre-chorus/builds lean on IV and V and end on V (half cadence) so the chorus arrives as a resolution; choruses use the strongest loops (I-V-vi-IV, vi-IV-I-V, IV-V-I-vi); bridges start away from the tonic (vi, IV, ii) for contrast. Cadences: authentic V-I closes, plagal IV-I softens, half cadence ending on V leaves it open, deceptive V-vi surprises.
Harmonic rhythm: verses change chords every 2 bars, choruses every bar, builds can speed up to 2 chords per bar.
Melody: chord tones (root, 3rd, 5th) on strong beats, stepwise motion and passing tones between, occasional leaps balanced by steps back in the other direction, one clear peak note per phrase, phrase endings on stable tones. Verses: lower register, narrower range, more rests. Chorus: higher register, wider range, a short rhythmic hook repeated (call and response across bars).
Bass: root on the downbeat, fifths and octaves for movement, approach notes (a step above or below) into the next chord, locked to the kick.
Drums: intro hats/percussion only; verse kick+snare+hats; build four-on-the-floor kick with snare doubling from quarters to 8ths to 16ths; chorus everything plus open hats and a crash on the first downbeat; bridge half-time or sparse; fills on the last bar of a phrase.
Builds: tension rises through density (snare roll, faster hats, 16th-note pedal bass), pitch (rising lines, filter opening), and space (more reverb and delay). Push-pull: right before the payoff, pull elements out (kick and bass drop for the last bar, a beat of near-silence), then push everything back in on the downbeat. Small push-pull waves inside sections (thin a bar, then bring it back) keep motion.
Transitions: fill on the last bar, crash on the next downbeat, a reverb or delay throw on the last note. Final chorus lift: add a layer, open the filters further, optionally raise the key by 1-2 semitones.
Sound design: avoid farty synths (buzzy square or pulse waves in the low register through a nearly closed resonant filter, short blatty envelopes, overdriven low notes; they pile up 120-450 Hz). Prefer saw or triangle for low parts, enough cutoff for a few harmonics, moderate resonance, decays long enough to sound like notes, a clean sub under a brighter layer.\nAvoid sameness: no part should loop unchanged for long. Lead lines need a change every 8 bars or so, arps every 12, bass and drums every 16 (techno and ambient can stretch this). Vary by developing the idea (answer phrase, inversion, rhythmic displacement, ghost notes, dropping or adding a part, filter movement), not by random noise.\nArrangement: give each part its own register (bass low, chords mid, lead high) and its own rhythmic space; not everything plays all the time.
Notation here: sequencer notes are scale degrees relative to the current chord when the sequencer's Harmony knob is SONG (0 root, 2 third, 4 fifth, 7 octave), so one pattern follows the chord progression.`;

  // ======================= SOUND-DESIGN GUARDRAILS =======================
  // "Farty" synths: buzzy square or pulse waves in the low register through a nearly closed, resonant filter, short
  // blatty envelopes and overdriven low notes. They pile up energy between about 120 and 450 Hz with no clean sub and
  // no bright top. Prefer saw or triangle in the low register, enough cutoff to let a few harmonics through,
  // moderate resonance, and a decay long enough to sound like a note rather than a burp.
  function unfart(why = 'avoid a farty, blatty low end') {
    const E = Engine, acts = [], K = (mod, key, to, w) => ({ do: 'knob', mod, key, to, why: w || why });
    const lowSeq = id => E.cables.some(c => c.to.mod === id && c.to.port === 'NOTE' && E.mods[c.from.mod]?.params?.oct && E.mods[c.from.mod].params.oct.choice <= 2);
    for (const id of E.order) {
      const m = E.mods[id]; if (!m || !E.cables.some(c => c.from.mod === id)) continue;
      if (m.kind === 'Analog') {
        const low = lowSeq(id) || id === 'acid';
        if (low && ['SQR', 'PULSE'].includes(m.params.wave.choice) && m.params.model.choice !== 'ACID') acts.push(K(id, 'wave', 'SAW', 'square waves buzz and fart in the low register'));
        if (m.params.cutoff.n < 0.22 && m.params.res.n > 0.6) acts.push(K(id, 'cutoff', 0.3), K(id, 'res', 0.5, 'a resonant, nearly closed filter sounds honky'));
        if (low && m.params.decay.value < 0.12 && m.params.env.n > 0.6) acts.push(K(id, 'decay', 0.4, 'a longer decay so notes sound like notes, not burps'));
        if (low && m.params.drive.n > 0.7) acts.push(K(id, 'drive', 0.45, 'overdriven low notes turn into flatulence'));
      }
      if (m.kind === 'Chip' && (lowSeq(id) || m.params.oct.choice < 0) && ['P12', 'P25', 'P50'].includes(m.params.wave.choice)) acts.push(K(id, 'oct', '0'), K(id, 'wave', 'TRI', 'low pulse waves sound like a whoopee cushion'));
      if (m.kind === 'Titan' && m.params.cut.n < 0.2 && m.params.drive.n > 0.7) acts.push(K(id, 'cut', 0.3), K(id, 'drive', 0.55));
    }
    return acts;
  }

  return { FORMS, ROLES, FINAL, PROGS, formFor, chordName, progressionFor, cadence, melodyLine, bassLine, arpLine, drumsFor, PRIMER, pick, ri, wpick, unfart };
})();
