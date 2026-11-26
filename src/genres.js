// genres.js — what the AI knows about each genre: tempo and groove (swing, which grid swings), drum patterns per
// section, scales and chord progressions, harmonic rhythm, chord voicings and comping rhythm, how the bass and the
// lead are written, which instruments and sample banks to reach for, the form, the effects, and what the genre
// does in its drops. The song engine (song.js) and the theory writers (theory.js) read it, and the AI (ai.js)
// builds a patch from it. Research notes: docs/research/genres.md.
//
// Notation: drum rows are 16 steps (X accent, x hit, . rest) for BD SD CP CH OH LT HT RS CB CY. On the sampled
// kits CB is a shaker, tambourine, guiro or woodblock, never a cowbell. Chords are scale degrees, 0-based
// (0 = I or i). Voices are "Module:setting": Crate:BANK (sampler), Analog:MODEL, Titan:growl|reese, Reel:TAPE, Chip.
'use strict';
const Genres = (() => {
  const rnd = Math.random, pick = a => Array.isArray(a) ? a[Math.floor(rnd() * a.length)] : a;
  const D = (BD, SD, CP, CH, OH, more = {}) => ({ BD, SD, CP, CH, OH, ...more });

  const G = {
    // =============================== ELECTRONIC DANCE MUSIC ===============================
    house: { label: 'House', fam: 'edm', re: /\bhouse\b(?!.*(deep|tech))|chicago|garage house|piano house/i, bpm: [120, 126], swing: 0.12, sgrid: '16TH', scales: ['MINOR', 'DORIAN', 'MAJOR'], form: 'club',
      kits: ['HOUSE', '909'], drums: { main: D('X...X...X...X...', '', '....X.......X...', 'x.x.x.x.x.x.x.x.', '..X...X...X...X.', { CB: 'x.xxx.xxx.xxx.xx' }), ohFull: true, build: 'roll' },
      progs: { verse: [[0, 3], [0, 5, 3, 4], [0, 6, 5, 6], [1, 4, 0, 0]], chorus: [[0, 3, 5, 4], [5, 3, 0, 4], [0, 6, 5, 3]] }, hr: { verse: 2, chorus: 1 },
      bass: { v: ['Analog:LADDER', 'Crate:BASS', 'Analog:SEM'], style: 'offbeat', oct: 2 }, chords: { v: ['Crate:PIANO', 'Crate:ORGAN', 'Crate:EPIANO'], style: ['STAB', 'OFFBEAT', 'PUSH'], voicing: ['7TH', '9TH'], oct: 3 },
      lead: { v: ['Crate:VOXCHOP', 'Crate:VOX', 'Analog:JOVE'], mel: { verse: 'sparse', chorus: 'hook' }, oct: 3 }, extras: ['pump', 'fx'], fxw: { Halls: 1.4, Echoes: 1.3, Pump: 1.5 }, bright: 0.55,
      notes: 'Four-on-the-floor kick, claps on 2 and 4, open hats on every off-beat, shaker 16ths, a little swing. Piano or organ stabs with 7th and 9th chords, often a two-chord vamp (i - iv in Dorian). Off-beat bass. DJ-friendly 16- and 32-bar phrases; breakdowns drop the kick, the drop brings it back with a sidechain pump.' },
    deephouse: { label: 'Deep house', fam: 'edm', re: /deep house|lo-?fi house/i, bpm: [118, 124], swing: 0.16, sgrid: '16TH', scales: ['DORIAN', 'MINOR'], form: 'club',
      kits: ['HOUSE', 'BOOMBAP'], drums: { main: D('X...X...X...X...', '', '....x.......x...', 'x.x.x.x.x.x.x.x.', '..x...x...x...x.', { RS: '...x.....x..x...', CB: '..x...x...x...x.' }), ohFull: true, build: 'roll' },
      progs: { verse: [[0, 3], [1, 4], [0, 2, 3, 4]], chorus: [[0, 3, 1, 4], [3, 2, 1, 0]] }, hr: { verse: 2, chorus: 2 },
      bass: { v: ['Crate:BASS', 'Analog:SEM'], style: 'offbeat', oct: 2 }, chords: { v: ['Crate:EPIANO', 'Crate:ORGAN'], style: ['STAB', 'PUSH'], voicing: ['9TH', 'ROOTLESS'], oct: 3 },
      lead: { v: ['Crate:VOX', 'Crate:FLUTE'], mel: { verse: 'sparse', chorus: 'callresp' }, oct: 3 }, extras: ['pump', 'vinyl'], fxw: { Halls: 1.5, Echoes: 1.5, Ensemble: 1.3 }, bright: 0.42,
      notes: 'Slower, warmer house: soft kick, rim shots, swung hats, Rhodes-like electric piano with 9th and rootless voicings, Dorian minor vamps, round bass, airy vocal pads. Long, patient builds.' },
    techhouse: { label: 'Tech house', fam: 'edm', re: /tech.?house/i, bpm: [124, 128], swing: 0.08, sgrid: '16TH', scales: ['MINOR', 'PHRYG'], form: 'club',
      kits: ['HOUSE', '909'], drums: { main: D('X...X...X...X...', '', '....X.......X...', 'xxXxxxXxxxXxxxXx', '..x...x...x...x.', { RS: '..x..x....x..x..', CB: 'x.x.x.x.x.x.x.x.' }), ohFull: true, build: 'roll' },
      progs: { verse: [[0], [0, 0, 6, 0]], chorus: [[0, 6], [0, 3]] }, hr: { verse: 4, chorus: 2 },
      bass: { v: ['Analog:LADDER', 'Analog:ODYSSEY', 'Crate:808'], style: 'techbass', oct: 2 }, chords: null,
      lead: { v: ['Crate:VOXCHOP', 'Analog:PROPHECY'], mel: { verse: 'sparse', chorus: 'riff' }, oct: 3 }, extras: ['pump', 'fx', 'perc'], fxw: { Pump: 1.6, Stutter: 1.3, Echoes: 1.2 }, bright: 0.5,
      notes: 'Groove first: a rolling, syncopated bassline locked to the kick, busy percussion and 16th hats, vocal chops, little harmony (one chord, maybe a bVII). Tension comes from filter sweeps and percussion, not chord changes.' },
    techno: { label: 'Techno', fam: 'edm', re: /techno|warehouse|berlin|minimal|industrial techno/i, bpm: [128, 138], swing: 0.04, sgrid: '16TH', scales: ['MINOR', 'PHRYG'], form: 'club',
      kits: ['909', 'HOUSE', 'HARD'], drums: { main: D('X...X...X...X...', '', '....x.......x...', '..x...x...x...x.', '..x...x...x...x.', { RS: '..x..x....x..x..', LT: '.......x.......x' }), ohFull: true, build: 'roll' },
      progs: { verse: [[0], [0, 0, 6, 0]], chorus: [[0], [0, 1]] }, hr: { verse: 4, chorus: 4 },
      bass: { v: ['Analog:LADDER', 'Analog:ACID', 'Titan:reese'], style: 'techbass', oct: 2 }, chords: { v: ['Crate:PLUCK', 'Crate:BRASS'], style: ['STAB', 'PUSH'], voicing: ['SUS4', 'QUARTAL', 'POWER'], oct: 3, p: 0.5 },
      lead: { v: ['Bodies:MEMBRANE', 'Analog:PROPHECY', 'Crate:PLUCK'], mel: { verse: 'riff', chorus: 'riff' }, oct: 3 }, extras: ['perc', 'fx'], fxw: { Echoes: 1.4, Halls: 1.2, Heat: 1.2 }, bright: 0.45,
      notes: 'Relentless four-on-the-floor, off-beat hats, rim-shot syncopation, rumble on the low toms. Harmony is minimal (one minor or Phrygian chord, stabs in suspended or quartal voicings); development is timbral: filters, delays, adding and removing parts every 8-16 bars.' },
    trance: { label: 'Trance', fam: 'edm', re: /trance|uplifting|euphoric|supersaw/i, bpm: [136, 140], swing: 0, sgrid: '16TH', scales: ['MINOR', 'HARM'], form: 'trance',
      kits: ['909', 'HOUSE'], drums: { main: D('X...X...X...X...', '', '....X.......X...', 'xxxxxxxxxxxxxxxx', '..X...X...X...X.'), ohFull: true, build: 'roll' },
      progs: { verse: [[0, 5, 2, 6], [0, 3, 5, 6]], chorus: [[0, 5, 2, 6], [5, 6, 0, 0], [0, 3, 5, 4]], break: [[5, 3, 0, 6], [5, 6, 2, 0]] }, hr: { verse: 2, chorus: 1 },
      bass: { v: ['Analog:LADDER', 'Analog:SEM'], style: 'rolling', oct: 2 }, chords: { v: ['Reel:STRINGS', 'Crate:CHOIR', 'Crate:PLUCK'], style: ['PAD', 'OFFBEAT'], voicing: ['TRIAD', 'ADD9', 'SUS2'], oct: 3 },
      lead: { v: ['Analog:ODYSSEY', 'Analog:JOVE', 'Crate:PLUCK'], mel: { verse: 'arp16', chorus: 'hook', break: 'long' }, oct: 3 }, extras: ['pump', 'fx'], fxw: { Halls: 1.6, Echoes: 1.5, Ensemble: 1.4 }, bright: 0.6,
      notes: 'Four-on-the-floor at 136-140 with a rolling off-beat bass, 16th hats and claps on 2 and 4. Minor keys, epic progressions (i - VI - III - VII), gated 16th arpeggios, supersaw leads and string pads. The long breakdown drops the drums, states the melody, then a snare-roll build lifts into the anthem drop.' },
    psytrance: { label: 'Psytrance', fam: 'edm', re: /psy|goa|full.?on/i, bpm: [142, 147], swing: 0, sgrid: '16TH', scales: ['PHRYG', 'HARM', 'MINOR'], form: 'club',
      kits: ['909', 'HARD'], drums: { main: D('X...X...X...X...', '', '....x.......x...', '..x...x...x...x.', '..x...x...x...x.', { RS: '.x...x...x...x..' }), ohFull: true, build: 'roll' },
      progs: { verse: [[0], [0, 1]], chorus: [[0], [0, 1, 0, 6]] }, hr: { verse: 4, chorus: 2 },
      bass: { v: ['Analog:ACID', 'Analog:LADDER'], style: 'psy', oct: 2 }, chords: null,
      lead: { v: ['Analog:SCREAM', 'Chip', 'Analog:ODYSSEY'], mel: { verse: 'arp16', chorus: 'arp16' }, oct: 3 }, extras: ['fx', 'acidlead'], fxw: { Echoes: 1.6, Phaser: 1.5, Bode: 1.3 }, bright: 0.55,
      notes: 'A kick on every beat and a bass on the three 16ths between kicks (the "galloping" psy roll). Phrygian and harmonic minor, almost no chord changes, squelchy acid lines, delays and phasers, constant small sound-design changes.' },
    dubstep: { label: 'Dubstep', fam: 'edm', re: /dubstep|brostep|wobble|growl|filthy|massive bass|bass music/i, bpm: [140, 150], swing: 0, sgrid: '16TH', scales: ['MINOR', 'PHRYG', 'HARM'], form: 'edm', half: true,
      kits: ['HARD', '909', 'TRAP'], drums: { main: D('X.........X.....', '........X.......', '........X.......', 'x.x.x.x.x.x.x.x.', '..............x.', { LT: '..............x.' }), intro: D('', '', '', 'x...x...x...x...', ''), build: 'snare8', half: true },
      progs: { verse: [[0, 0, 5, 6], [0, 1], [0, 5, 3, 4]], chorus: [[0, 0, 0, 0], [0, 0, 5, 6], [0, 1, 0, 6]], break: [[5, 3, 0, 6], [0, 5, 2, 6]] }, hr: { verse: 2, chorus: 2 },
      bass: { v: ['Titan:growl'], style: 'wobble', oct: 1 }, chords: { v: ['Reel:STRINGS', 'Crate:CHOIR'], style: ['PAD'], voicing: ['TRIAD', 'SUS2'], oct: 3, p: 0.6, calm: true },
      lead: { v: ['Crate:VOXCHOP', 'Analog:SCREAM', 'Chip'], mel: { verse: 'sparse', chorus: 'callresp' }, oct: 3, p: 0.6 }, extras: ['wobble', 'fx', 'sub'], fxw: { Vowel: 2, Heat: 1.6, Pump: 1.2 }, bright: 0.45,
      wobble: [['1/4', '1/8', '1/8T', '1/16'], ['1/8', '1/8', '1/16', '1/8T'], ['1/8T', '1/4', '1/8', '1/16T'], ['1/2', '1/8', '1/4', '1/16']],
      notes: '140 BPM but felt at 70: kick on 1, snare on 3 (half-time), sparse hats. The drop is the bass: a sub underneath and a mid-range wobble or growl whose LFO rate changes in time (1/4, 1/8, 1/8 triplets, 1/16), talking formants, call-and-response between bass sounds, silence for impact. Minor or Phrygian, very few chords. Intro and breakdown are atmospheric pads; builds use an 8th-note snare roll and a riser, then a beat of silence before the drop.' },
    riddim: { label: 'Riddim', fam: 'edm', re: /riddim/i, bpm: [140, 150], swing: 0, sgrid: '16TH', scales: ['MINOR', 'PHRYG'], form: 'edm', half: true,
      kits: ['HARD', 'TRAP'], drums: { main: D('X.....x...X.....', '........X.......', '........X.......', '..x...x...x...x.', ''), build: 'snare8', half: true },
      progs: { verse: [[0]], chorus: [[0]] }, hr: { verse: 4, chorus: 4 },
      bass: { v: ['Titan:growl'], style: 'riddim', oct: 1 }, chords: null, lead: { v: ['Crate:VOXCHOP'], mel: { verse: 'sparse', chorus: 'sparse' }, oct: 3, p: 0.5 }, extras: ['wobble', 'fx', 'sub'], fxw: { Vowel: 2, Heat: 1.8 }, bright: 0.4,
      wobble: [['1/8T', '1/8T', '1/8T', '1/4'], ['1/8T', '1/16T', '1/8T', '1/8T']],
      notes: 'Minimal, repetitive dubstep: one note, triplet wobbles, a lot of space, the same bass phrase answered with small variations.' },
    dnb: { label: 'Drum and bass', fam: 'edm', re: /drum ?(and|&|n|'n') ?bass|\bdnb\b|\bd&b\b|liquid|neurofunk|neuro\b/i, bpm: [170, 176], swing: 0, sgrid: '16TH', scales: ['MINOR', 'DORIAN'], form: 'edm',
      kits: ['ACOUSTIC', '909', 'BOOMBAP'], drums: { main: D('X.........X.....', '....X.......X...', '', 'x.x.x.x.x.x.x.x.', '......x.........', { RS: '.......x......x.' }), build: 'roll' },
      progs: { verse: [[0, 5, 2, 6], [0, 3], [1, 4, 0, 5]], chorus: [[0, 5, 2, 6], [5, 3, 0, 4]] }, hr: { verse: 2, chorus: 2 },
      bass: { v: ['Titan:reese', 'Crate:808'], style: 'reese', oct: 1 }, chords: { v: ['Reel:STRINGS', 'Crate:EPIANO', 'Crate:CHOIR'], style: ['PAD', 'HALF'], voicing: ['9TH', '7TH'], oct: 3 },
      lead: { v: ['Crate:VOX', 'Crate:FLUTE', 'Analog:JOVE'], mel: { verse: 'sparse', chorus: 'hook' }, oct: 3, p: 0.7 }, extras: ['break', 'fx'], breaks: ['BREAK_JUNGLE', 'BREAK_FUNK'], fxw: { Halls: 1.3, Echoes: 1.2, Heat: 1.2 }, bright: 0.5,
      notes: '170-176 BPM two-step: kick on 1 and the "and" of 3, snares on 2 and 4, ghost notes, often a chopped breakbeat layered on top. Long reese basses (detuned saws with a moving filter) or deep subs; liquid DnB adds lush 7th and 9th chords and soulful vocals, neurofunk swaps them for aggressive mid-range basses.' },
    jungle: { label: 'Jungle', fam: 'edm', re: /jungle|ragga jungle|amen/i, bpm: [160, 170], swing: 0, sgrid: '16TH', scales: ['MINOR', 'DORIAN'], form: 'edm',
      kits: ['ACOUSTIC', 'BOOMBAP'], drums: { main: D('X.........X.....', '....X.......X...', '', '', ''), build: 'fill' },
      progs: { verse: [[0, 6], [0, 3]], chorus: [[0, 5, 6, 0], [0, 6]] }, hr: { verse: 2, chorus: 2 },
      bass: { v: ['Crate:808', 'Titan:reese', 'Analog:SEM'], style: 'jungle', oct: 1 }, chords: { v: ['Crate:ORGAN', 'Reel:STRINGS'], style: ['SKANK', 'PAD'], voicing: ['TRIAD', '7TH'], oct: 3 },
      lead: { v: ['Crate:VOX', 'Crate:BRASS'], mel: { verse: 'sparse', chorus: 'callresp' }, oct: 3, p: 0.5 }, extras: ['break', 'fx'], breaks: ['BREAK_JUNGLE', 'BREAK_FUNK'], fxw: { Echoes: 1.6, Halls: 1.3, Stutter: 1.4 }, bright: 0.48,
      notes: 'Chopped and re-sequenced breakbeats at 160-170, huge sub bass moving at half the speed of the drums, reggae and dub DNA (organ skanks, echo throws), rewinds and stutters.' },
    ukgarage: { label: 'UK garage / 2-step', fam: 'edm', re: /uk ?garage|2.?step|speed garage|ukg/i, bpm: [130, 135], swing: 0.3, sgrid: '16TH', scales: ['MINOR', 'DORIAN'], form: 'club',
      kits: ['HOUSE', '909'], drums: { main: D('X......x..X.....', '....X.......X...', '....x.......x...', '..x...x...x...x.', '', { RS: '.x.....x...x...x', CB: 'x.xx.x.xx.xx.x.x' }), build: 'roll' },
      progs: { verse: [[0, 3, 6, 2], [0, 5, 3, 4]], chorus: [[0, 3, 6, 2], [1, 4, 0, 5]] }, hr: { verse: 1, chorus: 1 },
      bass: { v: ['Crate:808', 'Analog:LADDER'], style: 'garage', oct: 1 }, chords: { v: ['Crate:ORGAN', 'Crate:EPIANO'], style: ['STAB', 'PUSH'], voicing: ['9TH', '7TH'], oct: 3 },
      lead: { v: ['Crate:VOXCHOP', 'Crate:VOX'], mel: { verse: 'syncop', chorus: 'hook' }, oct: 3 }, extras: ['fx'], fxw: { Echoes: 1.3, Ensemble: 1.2 }, bright: 0.52,
      notes: 'Skippy, heavily swung 2-step: the kick skips beat 3 (it lands on 1 and the "and" of 3), snares on 2 and 4, shuffled hats and rim shots. Organ and electric-piano stabs with 7th and 9th chords, chopped and pitched vocals, a sub bass that bounces with the kick.' },
    futurebass: { label: 'Future bass', fam: 'edm', re: /future bass|kawaii|melodic bass/i, bpm: [140, 160], swing: 0, sgrid: '16TH', scales: ['MAJOR'], form: 'edm', half: true,
      kits: ['TRAP', '909'], drums: { main: D('X......x..x.....', '', '........X.......', 'x.x.x.x.x.x.xxx.', '', {}), build: 'snare8', half: true },
      progs: { verse: [[3, 4, 2, 5], [5, 3, 0, 4]], chorus: [[3, 4, 2, 5], [3, 4, 5, 5], [5, 3, 0, 4]] }, hr: { verse: 1, chorus: 1 },
      bass: { v: ['Crate:808'], style: 'trap808', oct: 1 }, chords: { v: ['Crate:PLUCK', 'Crate:BRASS', 'Crate:CHOIR'], style: ['STAB', 'PUSH', 'DEMBOW'], voicing: ['9TH', 'ADD9', '7TH'], oct: 3 },
      lead: { v: ['Crate:VOXCHOP', 'Chip', 'Crate:VOX'], mel: { verse: 'sparse', chorus: 'hook' }, oct: 4 }, extras: ['pump', 'fx'], fxw: { Pump: 2, Ensemble: 1.5, Halls: 1.3 }, bright: 0.6,
      notes: 'Half-time trap drums at 140-160, but the star is the chords: big major-key 7th and 9th voicings (IV - V - iii - vi) played as rhythmic stabs and swelled with heavy sidechain, plus pitched vocal chops and bright leads. Emotional, bright, wide.' },
    hardstyle: { label: 'Hardstyle', fam: 'edm', re: /hardstyle|rawstyle|gabber|hardcore|hard dance/i, bpm: [150, 158], swing: 0, sgrid: '16TH', scales: ['MINOR', 'HARM'], form: 'edm',
      kits: ['HARD'], drums: { main: D('X...X...X...X...', '', '....X.......X...', '..x...x...x...x.', '..x...x...x...x.'), ohFull: true, build: 'roll' },
      progs: { verse: [[0, 5, 2, 6], [5, 6, 0, 0]], chorus: [[0, 5, 2, 6], [5, 6, 0, 4]] }, hr: { verse: 2, chorus: 1 },
      bass: { v: ['Analog:SCREAM', 'Titan:reese'], style: 'offbeat', oct: 2 }, chords: { v: ['Reel:STRINGS', 'Crate:CHOIR'], style: ['PAD'], voicing: ['TRIAD'], oct: 3 },
      lead: { v: ['Analog:ODYSSEY', 'Analog:SCREAM'], mel: { verse: 'long', chorus: 'hook' }, oct: 3 }, extras: ['fx', 'pump'], fxw: { Heat: 1.8, Halls: 1.4 }, bright: 0.55,
      notes: 'A distorted, pitched kick on every beat at 150-158 (the kick is the bass; the "reverse bass" fills the off-beats), screeching leads, epic minor melodies and huge reverbs. Long cinematic breakdowns, then the kick returns.' },
    bigroom: { label: 'Big room / festival', fam: 'edm', re: /big ?room|festival|electro house|edm anthem/i, bpm: [126, 130], swing: 0, sgrid: '16TH', scales: ['MINOR'], form: 'edm',
      kits: ['HOUSE', 'HARD', '909'], drums: { main: D('X...X...X...X...', '', '....X.......X...', '..x...x...x...x.', '..x...x...x...x.'), ohFull: true, build: 'roll' },
      progs: { verse: [[0, 5, 2, 6]], chorus: [[0, 0, 0, 0], [0, 5, 2, 6]] }, hr: { verse: 2, chorus: 2 },
      bass: { v: ['Analog:LADDER'], style: 'offbeat', oct: 2 }, chords: { v: ['Crate:PIANO', 'Reel:STRINGS'], style: ['PAD', 'BLOCK'], voicing: ['TRIAD'], oct: 3 },
      lead: { v: ['Crate:BRASS', 'Analog:SCREAM'], mel: { verse: 'sparse', chorus: 'riff' }, oct: 3 }, extras: ['pump', 'fx'], fxw: { Pump: 2, Halls: 1.4 }, bright: 0.6,
      notes: 'Festival EDM: a pounding kick, long snare-roll builds with risers, a moment of silence, then a short, punchy lead riff over the kick. Simple minor progressions; the drop is mostly rhythm and sound.' },
    synthwave: { label: 'Synthwave', fam: 'edm', re: /synthwave|retrowave|outrun|80s|eighties|darksynth/i, bpm: [84, 112], swing: 0, sgrid: '16TH', scales: ['MINOR', 'DORIAN'], form: 'verse-chorus',
      kits: ['ACOUSTIC', '909', '808'], drums: { main: D('X.......X.x.....', '....X.......X...', '', 'x.x.x.x.x.x.x.x.', '', {}), build: 'fill' },
      progs: { verse: [[0, 5, 2, 6], [0, 5, 3, 4]], chorus: [[5, 3, 0, 4], [0, 5, 2, 6]] }, hr: { verse: 1, chorus: 1 },
      bass: { v: ['Analog:JOVE', 'Analog:SEM'], style: 'drive8', oct: 2 }, chords: { v: ['Reel:STRINGS', 'Crate:BRASS', 'Crate:CHOIR'], style: ['PAD', 'HALF'], voicing: ['TRIAD', 'ADD9'], oct: 3 },
      lead: { v: ['Analog:PROPHECY', 'Analog:ODYSSEY'], mel: { verse: 'syncop', chorus: 'hook' }, oct: 3 }, extras: ['fx'], fxw: { Ensemble: 1.8, Halls: 1.6, Echoes: 1.3 }, bright: 0.5,
      notes: '1980s film-score pop on synthesizers: driving 8th-note bass, big gated snares on 2 and 4, lush chorus-drenched pads, i - VI - III - VII progressions, and analog brass and arpeggios.' },
    electro: { label: 'Electro', fam: 'edm', re: /\belectro\b(?! house)|electro.?funk|miami bass/i, bpm: [118, 130], swing: 0.06, sgrid: '16TH', scales: ['MINOR', 'PHRYG'], form: 'club',
      kits: ['808'], drums: { main: D('X......X..X.....', '....X.......X...', '....x.......x...', 'xxxxxxxxxxxxxxxx', '', { RS: '...x......x.....' }), build: 'roll' },
      progs: { verse: [[0], [0, 6]], chorus: [[0, 6, 5, 6]] }, hr: { verse: 4, chorus: 2 },
      bass: { v: ['Analog:LADDER', 'Crate:808'], style: 'electro', oct: 1 }, chords: { v: ['Crate:BRASS', 'Crate:PLUCK'], style: ['STAB'], voicing: ['POWER', 'SUS4'], oct: 3, p: 0.5 },
      lead: { v: ['Analog:PROPHECY', 'Chip', 'Crate:VOXCHOP'], mel: { verse: 'riff', chorus: 'riff' }, oct: 3 }, extras: ['fx'], fxw: { Echoes: 1.3, Vowel: 1.3 }, bright: 0.5,
      notes: 'Robotic 808 funk: syncopated 808 kicks, snare and clap on 2 and 4, machine-gun 16th hats, a funky syncopated synth bass, vocoder-like voices and sci-fi stabs.' },
    breakbeat: { label: 'Breakbeat / big beat', fam: 'edm', re: /breakbeat|big beat|nu.?skool|breaks\b/i, bpm: [125, 140], swing: 0.06, sgrid: '16TH', scales: ['MINOR', 'DORIAN'], form: 'club',
      kits: ['ACOUSTIC', 'BOOMBAP'], drums: { main: D('X.x.......X.....', '....X.......X...', '', 'x.x.x.x.x.x.x.x.', ''), build: 'fill' },
      progs: { verse: [[0, 6], [0, 3]], chorus: [[0, 6, 5, 6]] }, hr: { verse: 2, chorus: 2 },
      bass: { v: ['Analog:LADDER', 'Titan:reese'], style: 'funk', oct: 2 }, chords: { v: ['Crate:CLAV', 'Crate:BRASS'], style: ['STAB'], voicing: ['7TH'], oct: 3, p: 0.6 },
      lead: { v: ['Analog:SCREAM', 'Crate:VOXCHOP'], mel: { verse: 'riff', chorus: 'riff' }, oct: 3 }, extras: ['break', 'fx'], breaks: ['BREAK_FUNK', 'BREAK_SHUFFLE'], fxw: { Heat: 1.5, Stutter: 1.5 }, bright: 0.52,
      notes: 'Sampled funk breakbeats (not four-on-the-floor) at 125-140, fat distorted basslines, stabs and acid lines, big builds.' },
    footwork: { label: 'Footwork / juke', fam: 'edm', re: /footwork|juke/i, bpm: [158, 162], swing: 0, sgrid: '16TH', scales: ['MINOR', 'DORIAN'], form: 'club', half: true,
      kits: ['808', 'TRAP'], drums: { main: D('X..x..x...x..x..', '', '........x.......', 'x.x.x.x.x.x.x.x.', '', { LT: '...x......x...x.' }), build: 'roll' },
      progs: { verse: [[0, 3], [0]], chorus: [[0, 5, 3, 4]] }, hr: { verse: 2, chorus: 1 },
      bass: { v: ['Crate:808'], style: 'trap808', oct: 1 }, chords: { v: ['Crate:EPIANO', 'Reel:STRINGS'], style: ['PAD'], voicing: ['9TH'], oct: 3, p: 0.6 },
      lead: { v: ['Crate:VOXCHOP'], mel: { verse: 'riff', chorus: 'riff' }, oct: 3 }, extras: ['fx'], fxw: { Stutter: 1.4 }, bright: 0.5,
      notes: '160 BPM, triplet-feel 808 kick patterns and toms, very sparse snares, stuttered repeating vocal chops, soul and jazz chords underneath.' },
    moombahton: { label: 'Moombahton', fam: 'edm', re: /moombah/i, bpm: [106, 112], swing: 0.04, sgrid: '16TH', scales: ['MINOR'], form: 'edm',
      kits: ['HOUSE', 'TRAP'], drums: { main: D('X...X...X...X...', '...x..x....x..x.', '', 'x.x.x.x.x.x.x.x.', '', { RS: '...x..x....x..x.' }), build: 'roll' },
      progs: { verse: [[0, 5, 2, 6]], chorus: [[0, 3, 5, 4]] }, hr: { verse: 1, chorus: 1 },
      bass: { v: ['Analog:SCREAM', 'Crate:808'], style: 'dembow', oct: 1 }, chords: { v: ['Crate:PLUCK', 'Crate:BRASS'], style: ['DEMBOW', 'STAB'], voicing: ['TRIAD'], oct: 3 },
      lead: { v: ['Crate:VOXCHOP', 'Crate:BRASS'], mel: { verse: 'sparse', chorus: 'riff' }, oct: 3 }, extras: ['fx', 'pump'], fxw: { Heat: 1.3, Pump: 1.4 }, bright: 0.52,
      notes: 'House sounds slowed to 108-112 over a reggaeton dembow beat: four kicks, snares on the dembow off-beats, a big distorted bass and festival stabs.' },
    downtempo: { label: 'Downtempo / trip hop', fam: 'edm', re: /downtempo|trip.?hop|chillout|chill.?out|bristol/i, bpm: [76, 96], swing: 0.22, sgrid: '16TH', scales: ['MINOR', 'DORIAN', 'HARM'], form: 'verse-chorus',
      kits: ['BOOMBAP', 'ACOUSTIC'], drums: { main: D('X......x..X.....', '....X.......X...', '', 'x.x.x.x.x.x.x.x.', ''), build: 'fill' },
      progs: { verse: [[0, 3], [0, 5, 3, 4], [0, 6, 5, 4]], chorus: [[5, 3, 0, 4], [0, 3, 6, 2]] }, hr: { verse: 2, chorus: 2 },
      bass: { v: ['Crate:BASS', 'Analog:SEM'], style: 'boombap', oct: 2 }, chords: { v: ['Crate:EPIANO', 'Reel:STRINGS', 'Crate:CELLO'], style: ['PAD', 'HALF', 'BLOCK'], voicing: ['9TH', '7TH'], oct: 3 },
      lead: { v: ['Crate:VOX', 'Crate:FLUTE', 'Crate:HARP'], mel: { verse: 'sparse', chorus: 'callresp' }, oct: 3 }, extras: ['vinyl', 'break'], breaks: ['BREAK_BOOMBAP', 'BREAK_HALF'], fxw: { Halls: 1.6, Echoes: 1.5, Cassette: 1.6 }, bright: 0.38,
      notes: 'Slow, heavy, swung hip-hop drums under cinematic minor harmony: strings, Rhodes, dub bass, vinyl crackle, spacious reverbs and delays, haunting vocals.' },
    // the original AI recipes (kept, now with genre facts too)
    acid: { label: 'Acid', fam: 'edm', legacy: true, re: /acid|303|squelch/i, bpm: [126, 136], swing: 0.06, scales: ['MINOR', 'PHRYG'], form: 'club', kits: ['909', 'HOUSE'], drums: { build: 'roll', ohFull: true }, bright: 0.55,
      notes: 'A TB-303 line (accents, slides, a resonant filter swept by hand) over a 909 four-on-the-floor; one chord, the filter is the melody.' },
    ambient: { label: 'Ambient', fam: 'edm', legacy: true, re: /ambient|drone|meditat|soundscape/i, bpm: [70, 90], swing: 0, scales: ['MAJOR', 'DORIAN', 'PENT'], form: 'through', kits: ['808', 'HAND'], drums: { build: 'fill' }, bright: 0.35,
      notes: 'Slow-changing textures and long reverbs, few or no drums, consonant modal harmony, change measured in minutes.' },
    chip: { label: 'Chiptune', fam: 'edm', legacy: true, re: /chip|8[- ]?bit|game ?boy|\bnes\b|retro game|video game/i, bpm: [130, 160], swing: 0, scales: ['MAJOR', 'MINOR'], form: 'verse-chorus', kits: ['LOFI'], drums: { build: 'fill' }, bright: 0.6,
      notes: 'Pulse and triangle waves, fast arpeggios standing in for chords, noise drums, bright major-key game melodies.' },
    noise: { label: 'Noise', fam: 'edm', legacy: true, re: /\bnoise\b|harsh|power electronics|geiger|radiation/i, bpm: [130, 160], swing: 0, scales: ['PHRYG', 'MINOR'], form: 'edm', kits: ['DIRT', 'HARD'], drums: { build: 'roll' }, bright: 0.75, notes: 'Texture, distortion and density over melody.' },
    experimental: { label: 'Experimental', fam: 'edm', legacy: true, re: /serge|west coast|buchla|experimental|generative|physical model|idm|glitch/i, bpm: [90, 120], swing: 0, scales: ['WHOLE', 'HARM', 'PENT'], form: 'through', kits: ['808', 'HAND'], drums: { build: 'fill' }, bright: 0.55, notes: 'Patch-first music: random voltages, physical models, odd meters.' },

    // =============================== HIP HOP, JAZZ, POP AND MORE ===============================
    hiphop: { label: 'Hip hop (boom bap)', fam: 'other', re: /hip.?hop|boom.?bap|rap\b|golden.?age|\bmpc\b/i, bpm: [84, 96], swing: 0.5, sgrid: '16TH', scales: ['MINOR', 'DORIAN'], form: 'hiphop',
      kits: ['BOOMBAP', 'ACOUSTIC'], drums: { main: D('X......x..X.....', '....X.......X...', '', 'x.x.x.x.x.x.x.x.', '', { RS: '..........x....x' }), build: 'fill', decay: 0.4 },
      progs: { verse: [[0, 3], [0, 0, 5, 5], [0, 6, 5, 6], [1, 4]], chorus: [[5, 3, 0, 4], [0, 3, 6, 2]] }, hr: { verse: 2, chorus: 2 },
      bass: { v: ['Crate:BASS', 'Crate:UPRIGHT', 'Analog:SEM'], style: 'boombap', oct: 2 }, chords: { v: ['Crate:EPIANO', 'Crate:PIANO', 'Crate:HARP'], style: ['CHARLESTON', 'PUSH', 'BLOCK'], voicing: ['9TH', '7TH', 'ROOTLESS'], oct: 3 },
      lead: { v: ['Crate:FLUTE', 'Crate:SAX', 'Crate:VOX'], mel: { verse: 'sparse', chorus: 'hook' }, oct: 3, p: 0.7 }, extras: ['vinyl', 'break', 'dust'], breaks: ['BREAK_BOOMBAP', 'BREAK_FUNK'], fxw: { Cassette: 1.6, Echoes: 1.2, Halls: 0.6 }, bright: 0.4,
      notes: 'Sample-based 1990s hip hop: hard kick ("boom") and snare ("bap") on 2 and 4, MPC-style swing on the 16ths (56-62%), a chopped jazz or soul loop (7th and 9th chords on Rhodes or piano), a walking or riffing bass, vinyl crackle and 12-bit grit. Form: 16-bar verses and 8-bar hooks.' },
    trap: { label: 'Trap', fam: 'other', re: /\btrap\b|808s?\b|atlanta|mumble|plugg/i, bpm: [130, 150], swing: 0, sgrid: '16TH', scales: ['MINOR', 'HARM', 'PHRYG'], form: 'hiphop', half: true,
      kits: ['TRAP', '808'], drums: { main: D('X......x..x.....', '', '........X.......', 'x.x.x.x.x.xxx.x.', '', { RS: '.......x......x.' }), build: 'snare8', half: true },
      progs: { verse: [[0, 5], [0, 1], [0, 5, 3, 4]], chorus: [[0, 5, 6, 4], [5, 3, 0, 4]] }, hr: { verse: 2, chorus: 2 },
      bass: { v: ['Crate:808'], style: 'trap808', oct: 1 }, chords: { v: ['Crate:PIANO', 'Crate:CHOIR', 'Crate:HARP', 'Crate:CELLO'], style: ['HALF', 'PAD', 'ARP'], voicing: ['TRIAD', 'SUS2'], oct: 3 },
      lead: { v: ['Crate:FLUTE', 'Crate:PLUCK', 'Crate:VOX'], mel: { verse: 'riff', chorus: 'hook' }, oct: 4 }, extras: ['hatrolls', 'fx'], fxw: { Halls: 1.2, Echoes: 1.2 }, bright: 0.45,
      notes: 'Half-time at 130-150 (felt at 65-75): sparse 808 kicks, a snare or clap on beat 3, 16th hats with 32nd and triplet rolls. The 808 is the bass: long, tuned, gliding between notes. Dark minor, harmonic minor or Phrygian melodies on bells-free plucks, flutes, pianos, choirs and strings, often a one- or two-chord loop.' },
    drill: { label: 'Drill', fam: 'other', re: /\bdrill\b/i, bpm: [138, 145], swing: 0.08, sgrid: '16TH', scales: ['HARM', 'MINOR', 'PHRYG'], form: 'hiphop', half: true,
      kits: ['TRAP'], drums: { main: D('X.........x.....', '', '........X.....x.', 'x..x..x.x.x..x.x', '', {}), build: 'snare8', half: true },
      progs: { verse: [[0, 5], [0, 1]], chorus: [[0, 5, 6, 4]] }, hr: { verse: 2, chorus: 2 },
      bass: { v: ['Crate:808'], style: 'drill808', oct: 1 }, chords: { v: ['Crate:CHOIR', 'Crate:PIANO', 'Crate:CELLO'], style: ['PAD', 'HALF'], voicing: ['TRIAD'], oct: 3 },
      lead: { v: ['Crate:PIANO', 'Crate:FLUTE'], mel: { verse: 'sparse', chorus: 'riff' }, oct: 4 }, extras: ['fx'], fxw: { Halls: 1.3 }, bright: 0.4,
      notes: 'Dark, sliding 808s that glide between notes, a snare on beat 3 plus a late off-beat snare, triplet and syncopated hats, harmonic-minor piano and choir melodies.' },
    lofi: { label: 'Lo-fi hip hop', fam: 'other', re: /lo-?fi|chillhop|study beats|jazzhop/i, bpm: [70, 88], swing: 0.55, sgrid: '16TH', scales: ['MAJOR', 'DORIAN'], form: 'hiphop',
      kits: ['BOOMBAP', 'JAZZ'], drums: { main: D('X......x..x.....', '....X.......X...', '', 'x.x.x.x.x.x.x.x.', '', { RS: '......x.......x.' }), build: 'fill', decay: 0.35 },
      progs: { verse: [[1, 4, 0, 5], [3, 2, 1, 0], [0, 5, 1, 4]], chorus: [[3, 2, 1, 0], [1, 4, 0, 5]] }, hr: { verse: 1, chorus: 1 },
      bass: { v: ['Crate:UPRIGHT', 'Crate:BASS'], style: 'boombap', oct: 2 }, chords: { v: ['Crate:EPIANO', 'Crate:PIANO', 'Crate:GUITAR'], style: ['BLOCK', 'CHARLESTON', 'PUSH'], voicing: ['9TH', '7TH', 'ROOTLESS'], oct: 3 },
      lead: { v: ['Crate:FLUTE', 'Crate:SAX', 'Crate:HARP'], mel: { verse: 'sparse', chorus: 'callresp' }, oct: 3, p: 0.6 }, extras: ['vinyl', 'rain', 'dust'], fxw: { Cassette: 2.2, Halls: 1.2, Echoes: 1.2 }, bright: 0.32,
      notes: 'Laid-back, swung (drunk) boom-bap at 70-88, jazzy ii - V - I and IV - iii - ii - I progressions with major 7th and 9th chords on electric piano or guitar, warm upright bass, tape wobble, vinyl crackle and rain, a soft, filtered top end.' },
    jazz: { label: 'Jazz (swing)', fam: 'other', re: /\bjazz\b|swing\b|bebop|be-bop|big band|standard/i, bpm: [120, 180], swing: 0.5, sgrid: '8TH', scales: ['MAJOR', 'DORIAN'], form: 'jazz',
      kits: ['JAZZ'], drums: { main: D('x...x...x...x...', '......x.......x.', '', '....x.......x...', 'X...x.x.X...x.x.'), build: 'fill', decay: 0.8, level: 'soft' },
      progs: { verse: [[1, 4, 0, 5], [2, 5, 1, 4], [0, 5, 1, 4], [1, 4, 0, 0]], bridge: [[3, 3, 2, 5], [4, 4, 1, 4], [5, 1, 4, 0]], chorus: [[1, 4, 0, 5]] }, hr: { verse: 1, chorus: 1 },
      bass: { v: ['Crate:UPRIGHT', 'Crate:BASS'], style: 'walking', oct: 2 }, chords: { v: ['Crate:PIANO', 'Crate:EPIANO', 'Crate:GUITAR'], style: ['CHARLESTON', 'PUSH', 'BOSSA'], voicing: ['ROOTLESS', 'SHELL', '7TH'], oct: 3 },
      lead: { v: ['Crate:SAX', 'Crate:FLUTE', 'Crate:HARMONICA'], mel: { verse: 'swing8', chorus: 'swing8', solo: 'swing8' }, oct: 3 }, extras: [], fxw: { Halls: 1.4, Echoes: 0.4, Heat: 0.2, Pump: 0.1 }, bright: 0.42,
      notes: 'Swung 8ths (close to a triplet feel), ride cymbal "ding, ding-a-ding" with the hi-hat foot on 2 and 4, a walking bass in quarter notes (chord tones on the beat, approach notes into the next chord), piano comping in rootless and shell voicings on Charleston and anticipated rhythms. Harmony moves in ii - V - I cadences and turnarounds (I - vi - ii - V). Form: head (AABA), solos over the form, head again.' },
    bossa: { label: 'Bossa nova', fam: 'other', re: /bossa|samba|brazil|jobim/i, bpm: [120, 145], swing: 0.06, sgrid: '16TH', scales: ['MAJOR', 'DORIAN'], form: 'aaba',
      kits: ['LATIN', 'JAZZ'], drums: { main: D('X..xX..xX..xX..x', '', '', 'x.x.x.x.x.x.x.x.', '', { RS: 'x..x..x...x..x..' }), build: 'fill', decay: 0.7 },
      progs: { verse: [[0, 1, 4, 0], [1, 4, 0, 5], [0, 3, 1, 4]], chorus: [[3, 2, 1, 4], [1, 4, 0, 0]] }, hr: { verse: 2, chorus: 1 },
      bass: { v: ['Crate:UPRIGHT', 'Crate:BASS'], style: 'bossa', oct: 2 }, chords: { v: ['Crate:GUITAR', 'Crate:PIANO'], style: ['BOSSA'], voicing: ['7TH', '9TH'], oct: 3 },
      lead: { v: ['Crate:FLUTE', 'Crate:SAX', 'Crate:VOX'], mel: { verse: 'syncop', chorus: 'hook' }, oct: 3 }, extras: [], fxw: { Halls: 1.3, Ensemble: 1.1, Heat: 0.2 }, bright: 0.42,
      notes: 'Brazilian samba slowed and softened: a bass on 1 and the dotted "and" of 2, a cross-stick clave-like pattern, a nylon guitar playing syncopated 7th and 9th chords, gentle flute or voice, ii - V movement.' },
    funk: { label: 'Funk', fam: 'other', re: /\bfunk\b|funky|james brown|p-?funk/i, bpm: [98, 116], swing: 0.12, sgrid: '16TH', scales: ['DORIAN', 'MINOR'], form: 'verse-chorus',
      kits: ['ACOUSTIC', 'BOOMBAP'], drums: { main: D('X.x....x..X.....', '....X..x.x..X..x', '', 'xxXxxxXxxxXxxxXx', '..............x.'), build: 'fill' },
      progs: { verse: [[0], [0, 3]], chorus: [[3, 4], [0, 3, 0, 4]] }, hr: { verse: 4, chorus: 2 },
      bass: { v: ['Crate:BASS', 'Analog:SEM'], style: 'funk', oct: 2 }, chords: { v: ['Crate:CLAV', 'Crate:GUITAR', 'Crate:EPIANO'], style: ['STAB', 'STRUM'], voicing: ['9TH', '7TH'], oct: 3 },
      lead: { v: ['Crate:BRASS', 'Crate:SAX'], mel: { verse: 'riff', chorus: 'riff' }, oct: 3 }, extras: [], fxw: { Phaser: 1.4, Vowel: 1.2, Ensemble: 1.1 }, bright: 0.5,
      notes: 'Everything on "the one": syncopated 16th grooves, ghost notes on the snare, a slap-style bass with octave jumps, clavinet or guitar chopping 9th chords, horn stabs. Harmony is often a single Dorian vamp (i7 - IV7).' },
    disco: { label: 'Disco / nu-disco', fam: 'other', re: /disco|nu.?disco|boogie/i, bpm: [112, 124], swing: 0.04, sgrid: '16TH', scales: ['MINOR', 'DORIAN', 'MAJOR'], form: 'pop',
      kits: ['ACOUSTIC', 'HOUSE'], drums: { main: D('X...X...X...X...', '....X.......X...', '', 'x.x.x.x.x.x.x.x.', '..X...X...X...X.', { CB: 'xxxxxxxxxxxxxxxx' }), ohFull: true, build: 'fill' },
      progs: { verse: [[0, 3], [5, 1, 4, 0], [0, 6, 5, 4]], chorus: [[0, 3, 6, 2], [3, 4, 2, 5]] }, hr: { verse: 2, chorus: 1 },
      bass: { v: ['Crate:BASS', 'Analog:SEM'], style: 'disco', oct: 2 }, chords: { v: ['Crate:PIANO', 'Crate:GUITAR', 'Crate:EPIANO'], style: ['OFFBEAT', 'STRUM', 'POP'], voicing: ['7TH', '9TH'], oct: 3 },
      lead: { v: ['Reel:STRINGS', 'Crate:BRASS', 'Crate:VOX'], mel: { verse: 'syncop', chorus: 'hook' }, oct: 3 }, extras: ['pump'], fxw: { Ensemble: 1.5, Phaser: 1.3, Halls: 1.2 }, bright: 0.55,
      notes: 'Four-on-the-floor with open hats on the off-beats, octave-jumping bass, chicken-scratch guitar and piano on the off-beats, sweeping strings, 7th chords.' },
    soul: { label: 'Soul / R&B', fam: 'other', re: /\bsoul\b|r&b|rnb|r ?and ?b|neo.?soul|motown/i, bpm: [68, 96], swing: 0.3, sgrid: '16TH', scales: ['MAJOR', 'DORIAN'], form: 'pop',
      kits: ['ACOUSTIC', 'BOOMBAP'], drums: { main: D('X......x.x......', '....X.......X...', '', 'x.x.x.x.x.x.x.x.', '', { RS: '..x.......x.....' }), build: 'fill' },
      progs: { verse: [[3, 2, 1, 0], [1, 4, 0, 5], [0, 5, 3, 4]], chorus: [[3, 4, 2, 5], [1, 4, 0, 5]], bridge: [[3, 3, 2, 5]] }, hr: { verse: 1, chorus: 1 },
      bass: { v: ['Crate:BASS'], style: 'soul', oct: 2 }, chords: { v: ['Crate:EPIANO', 'Crate:ORGAN', 'Crate:PIANO'], style: ['GOSPEL', 'PUSH', 'BLOCK'], voicing: ['9TH', 'ROOTLESS', '7TH'], oct: 3, bass: 'OFF' },
      lead: { v: ['Crate:VOX', 'Crate:SAX'], mel: { verse: 'syncop', chorus: 'hook' }, oct: 3 }, extras: [], fxw: { Halls: 1.3, Ensemble: 1.3 }, bright: 0.45,
      notes: 'Laid-back, swung grooves; extended chords (major 7ths, 9ths, 11ths), IV - iii - ii - I walk-downs and ii - V movement, Rhodes and organ, a melodic bass, a soulful lead voice.' },
    pop: { label: 'Pop', fam: 'other', re: /\bpop\b|top ?40|radio|catchy|synth.?pop|k-?pop/i, bpm: [100, 124], swing: 0, sgrid: '16TH', scales: ['MAJOR', 'MINOR'], form: 'pop',
      kits: ['ACOUSTIC', 'HOUSE', '909'], drums: { main: D('X.......X.x.....', '', '....X.......X...', 'x.x.x.x.x.x.x.x.', '', {}), ohFull: true, build: 'snare8' },
      progs: { verse: [[0, 4, 5, 3], [5, 3, 0, 4], [0, 5, 3, 4]], pre: [[3, 4, 3, 4], [1, 3, 4, 4]], chorus: [[0, 4, 5, 3], [5, 3, 0, 4], [3, 4, 5, 5]] }, hr: { verse: 1, chorus: 1 },
      bass: { v: ['Analog:JOVE', 'Crate:BASS', 'Crate:808'], style: 'pop8', oct: 2 }, chords: { v: ['Crate:PIANO', 'Crate:GUITAR', 'Crate:PLUCK'], style: ['POP', 'BLOCK', 'STRUM'], voicing: ['TRIAD', 'ADD9', 'SUS2'], oct: 3 },
      lead: { v: ['Crate:VOX', 'Crate:PLUCK', 'Analog:PROPHECY'], mel: { verse: 'syncop', chorus: 'hook' }, oct: 3 }, extras: ['fx', 'pump'], fxw: { Halls: 1.3, Echoes: 1.2, Ensemble: 1.2 }, bright: 0.55,
      notes: 'Verse, pre-chorus, chorus: the four-chord loop (I - V - vi - IV and its rotations), a singable hook repeated in the chorus in a higher register, claps on 2 and 4, eighth-note bass and piano, a pre-chorus that climbs to V, a final chorus lifted by a key change or extra layers.' },
    reggae: { label: 'Reggae', fam: 'other', re: /reggae|ska\b|rocksteady|one.?drop|roots/i, bpm: [70, 90], swing: 0.2, sgrid: '16TH', scales: ['MAJOR', 'MINOR', 'DORIAN'], form: 'verse-chorus',
      kits: ['ACOUSTIC', 'JAZZ'], drums: { main: D('........X.......', '', '', 'x.x.x.x.x.x.x.x.', '', { RS: '........X.......' }), build: 'fill' },
      progs: { verse: [[0, 3], [0, 4, 3, 4], [0, 5, 3, 4]], chorus: [[3, 4, 0, 0], [0, 3, 4, 3]] }, hr: { verse: 2, chorus: 1 },
      bass: { v: ['Crate:BASS', 'Analog:SEM'], style: 'reggae', oct: 2 }, chords: { v: ['Crate:ORGAN', 'Crate:GUITAR', 'Crate:PIANO'], style: ['SKANK'], voicing: ['TRIAD'], oct: 3 },
      lead: { v: ['Crate:HARMONICA', 'Crate:SAX', 'Crate:VOX'], mel: { verse: 'sparse', chorus: 'hook' }, oct: 3, p: 0.7 }, extras: ['dub'], fxw: { Echoes: 2, Halls: 1.4 }, bright: 0.42,
      notes: 'The one drop: kick and cross-stick together on beat 3 only, swung hats. The guitar or organ skank plays short chords on the off-beats (2 and 4), the bass is the melody, deep and round with space. Simple I - IV - V harmony; dub mixes drop parts out and throw echoes and reverbs.' },
    dub: { label: 'Dub', fam: 'other', re: /\bdub\b(?!step)|dub ?techno/i, bpm: [70, 85], swing: 0.18, sgrid: '16TH', scales: ['MINOR', 'DORIAN'], form: 'through',
      kits: ['ACOUSTIC', 'HAND'], drums: { main: D('........X.......', '', '', 'x.x.x.x.x.x.x.x.', '', { RS: '........X.......' }), build: 'fill' },
      progs: { verse: [[0, 3], [0]], chorus: [[0, 6]] }, hr: { verse: 2, chorus: 2 },
      bass: { v: ['Crate:BASS', 'Crate:808'], style: 'reggae', oct: 1 }, chords: { v: ['Crate:ORGAN', 'Crate:PIANO'], style: ['SKANK'], voicing: ['TRIAD', '7TH'], oct: 3 },
      lead: { v: ['Crate:BRASS', 'Crate:HARMONICA'], mel: { verse: 'sparse', chorus: 'sparse' }, oct: 3, p: 0.5 }, extras: ['dub'], fxw: { Echoes: 2.5, Halls: 1.8, Cassette: 1.2 }, bright: 0.38,
      notes: 'Reggae turned inside out at the mixing desk: heavy bass and drums, parts dropped in and out, tape echoes thrown on single chords and snares, spring reverb.' },
    reggaeton: { label: 'Reggaeton / dembow', fam: 'other', re: /reggaeton|dembow|perreo|latin trap|urbano/i, bpm: [88, 100], swing: 0, sgrid: '16TH', scales: ['MINOR', 'HARM'], form: 'pop',
      kits: ['TRAP', 'HOUSE', 'LATIN'], drums: { main: D('X...X...X...X...', '...x..x....x..x.', '', 'x.x.x.x.x.x.x.x.', '', { RS: '...x..x....x..x.', CB: '..x...x...x...x.' }), build: 'fill' },
      progs: { verse: [[0, 5, 2, 6], [0, 3, 5, 4]], chorus: [[0, 5, 2, 6], [5, 6, 0, 0]] }, hr: { verse: 1, chorus: 1 },
      bass: { v: ['Crate:808', 'Analog:JOVE'], style: 'dembow', oct: 1 }, chords: { v: ['Crate:PLUCK', 'Crate:PIANO', 'Crate:GUITAR'], style: ['DEMBOW', 'STAB'], voicing: ['TRIAD', 'SUS2'], oct: 3 },
      lead: { v: ['Crate:VOX', 'Crate:PLUCK', 'Crate:FLUTE'], mel: { verse: 'syncop', chorus: 'hook' }, oct: 3 }, extras: ['fx'], fxw: { Halls: 1.2, Echoes: 1.2 }, bright: 0.5,
      notes: 'The dembow: kick on every beat, snare (or rim) on the 3-3-2 off-beats ("boom-ch-boom-chick"), minor-key four-chord loops (i - VI - III - VII), an 808 or synth bass on the kick, plucked chords and catchy vocal hooks.' },
    afrobeats: { label: 'Afrobeats / amapiano', fam: 'other', re: /afro.?beat|afrobeats|amapiano|afro.?house|highlife|naija/i, bpm: [100, 115], swing: 0.12, sgrid: '16TH', scales: ['MAJOR', 'DORIAN', 'MINOR'], form: 'pop',
      kits: ['HAND', 'LATIN', 'ACOUSTIC'], drums: { main: D('X..x......X.....', '', '....x.......x...', 'xxxxxxxxxxxxxxxx', '', { RS: '..x..x.x..x...x.', CB: 'x.xxx.xxx.xxx.xx' }), build: 'fill' },
      progs: { verse: [[0, 3, 5, 4], [0, 3], [1, 4, 0, 0]], chorus: [[3, 4, 2, 5], [0, 3, 5, 4]] }, hr: { verse: 1, chorus: 1 },
      bass: { v: ['Crate:808', 'Crate:MARIMBA', 'Crate:BASS'], style: 'afro', oct: 1 }, chords: { v: ['Crate:GUITAR', 'Crate:PIANO', 'Crate:EPIANO'], style: ['PUSH', 'OFFBEAT', 'STAB'], voicing: ['7TH', '9TH', 'TRIAD'], oct: 3 },
      lead: { v: ['Crate:FLUTE', 'Crate:VOX', 'Crate:PLUCK'], mel: { verse: 'syncop', chorus: 'hook' }, oct: 3 }, extras: ['perc'], fxw: { Halls: 1.2, Echoes: 1.3 }, bright: 0.5,
      notes: 'A swung, rolling groove at 100-115 built from interlocking percussion (shakers in 16ths, syncopated rims and claps), a kick that skips around beat 3, melodic log-drum or 808 bass, palm-muted guitar or piano chords on syncopated off-beats, warm major or Dorian harmony.' },
    gospel: { label: 'Gospel', fam: 'other', re: /gospel|church|choir music|spiritual/i, bpm: [68, 100], swing: 0.4, sgrid: '8TH', scales: ['MAJOR'], form: 'pop',
      kits: ['ACOUSTIC', 'JAZZ'], drums: { main: D('X.....x.X.......', '....X.......X...', '', 'x.x.x.x.x.x.x.x.', '', {}), build: 'fill' },
      progs: { verse: [[0, 3, 0, 4], [3, 2, 1, 0], [0, 5, 1, 4]], chorus: [[3, 4, 2, 5], [3, 3, 0, 0], [1, 4, 0, 0]] }, hr: { verse: 1, chorus: 1 },
      bass: { v: ['Crate:BASS', 'Crate:ORGAN'], style: 'soul', oct: 2 }, chords: { v: ['Crate:ORGAN', 'Crate:PIANO'], style: ['GOSPEL', 'BLOCK'], voicing: ['9TH', '7TH', 'ADD9'], oct: 3, bass: 'ROOT' },
      lead: { v: ['Crate:CHOIR', 'Crate:VOX'], mel: { verse: 'long', chorus: 'hook' }, oct: 3 }, extras: [], fxw: { Halls: 1.6 }, bright: 0.45,
      notes: 'Organ and piano harmony full of passing chords, IV - I (plagal, "amen") cadences, walk-ups, 9th chords, call-and-response between lead and choir, swung shuffles or slow 12/8 feels, building to a big final chorus.' },
    blues: { label: 'Blues', fam: 'other', re: /blues|shuffle|delta|boogie.?woogie/i, bpm: [76, 120], swing: 0.5, sgrid: '8TH', scales: ['MIXO'], form: 'blues',
      kits: ['ACOUSTIC', 'JAZZ'], drums: { main: D('X.......X.......', '....X.......X...', '', 'x.x.x.x.x.x.x.x.', '', {}), build: 'fill' },
      progs: { verse: [[0, 0, 0, 0, 3, 3, 0, 0, 4, 3, 0, 4]], chorus: [[0, 3, 0, 0, 3, 3, 0, 0, 4, 3, 0, 4]] }, hr: { verse: 1, chorus: 1 },
      bass: { v: ['Crate:UPRIGHT', 'Crate:BASS'], style: 'boogie', oct: 2 }, chords: { v: ['Crate:PIANO', 'Crate:ORGAN', 'Crate:GUITAR'], style: ['CHARLESTON', 'BLOCK', 'PUSH'], voicing: ['7TH'], oct: 3 },
      lead: { v: ['Crate:HARMONICA', 'Crate:SAX', 'Crate:GUITAR'], mel: { verse: 'callresp', chorus: 'callresp' }, oct: 3 }, extras: [], fxw: { Halls: 1.2, Heat: 1.2 }, bright: 0.45,
      notes: 'The 12-bar form (I - I - I - I - IV - IV - I - I - V - IV - I - V) with dominant 7th chords (Mixolydian), a shuffle (swung 8ths), a boogie bass walking up and down the chord, call-and-response phrases on harmonica, sax or guitar using the blues scale.' },
    rock: { label: 'Rock', fam: 'other', re: /\brock\b|punk|grunge|indie|metal|garage rock/i, bpm: [110, 150], swing: 0, sgrid: '16TH', scales: ['MINOR', 'MAJOR', 'MIXO'], form: 'verse-chorus',
      kits: ['ACOUSTIC'], drums: { main: D('X.....x.X.x.....', '....X.......X...', '', 'x.x.x.x.x.x.x.x.', '', {}), ohFull: true, build: 'fill', decay: 0.7 },
      progs: { verse: [[0, 6, 5, 6], [0, 3, 4, 3], [0, 5, 3, 4]], chorus: [[0, 6, 3, 0], [5, 3, 0, 4], [0, 4, 5, 3]] }, hr: { verse: 1, chorus: 1 },
      bass: { v: ['Crate:BASS', 'Analog:JOVE'], style: 'pop8', oct: 2 }, chords: { v: ['Crate:GUITAR'], style: ['STRUM', 'POP'], voicing: ['POWER'], oct: 3, fuzz: true },
      lead: { v: ['Analog:SCREAM', 'Crate:GUITAR'], mel: { verse: 'riff', chorus: 'hook' }, oct: 3 }, extras: [], fxw: { Heat: 2, Halls: 1.1 }, bright: 0.55,
      notes: 'A backbeat (snare on 2 and 4) with driving 8th-note hats, distorted power chords (root and fifth) strummed in 8ths, a root-note 8th bass, bVII and bVI borrowed chords (i - bVII - bVI), riffs, verse-chorus form with a big final chorus.' },
    cinematic: { label: 'Cinematic / orchestral', fam: 'other', re: /cinematic|orchestral|film score|soundtrack|epic|trailer|classical|symphon/i, bpm: [70, 100], swing: 0, sgrid: '16TH', scales: ['MINOR', 'HARM', 'DORIAN'], form: 'through',
      kits: ['HAND', 'ACOUSTIC'], drums: { main: D('X.......X..x....', '', '', '', '', { LT: 'X.....x.X.......', HT: '..........x.x...' }), build: 'fill', decay: 1 },
      progs: { verse: [[0, 5, 2, 6], [0, 3, 5, 4], [5, 3, 0, 4]], chorus: [[5, 6, 0, 0], [0, 5, 3, 4]] }, hr: { verse: 2, chorus: 1 },
      bass: { v: ['Crate:CELLO', 'Reel:CELLO'], style: 'long', oct: 2 }, chords: { v: ['Reel:STRINGS', 'Crate:CHOIR', 'Crate:CELLO'], style: ['PAD', 'HALF'], voicing: ['TRIAD', 'OPEN'], oct: 3 },
      lead: { v: ['Crate:BRASS', 'Crate:HARP', 'Crate:FLUTE', 'Crate:PIANO'], mel: { verse: 'long', chorus: 'hook' }, oct: 3 }, extras: ['fx'], fxw: { Halls: 2.2, Echoes: 0.6, Heat: 0.2 }, bright: 0.4,
      notes: 'Strings, choir and brass in open voicings, ostinatos in the cellos, taiko-like low toms, minor-key progressions with modal mixture (i - VI - III - VII, VI - VII - i), slow builds, impacts and risers, huge halls.' }
  };
  const LIST = Object.keys(G);
  LIST.forEach(k => { G[k].id = k; });

  // which genre a brief asks for: the task first, then the personality; more specific genres are checked first
  const ORDER = ['deephouse', 'techhouse', 'futurebass', 'riddim', 'drill', 'lofi', 'ukgarage', 'moombahton', 'reggaeton', 'dub', 'psytrance', 'hardstyle', 'bigroom', 'synthwave', 'footwork', 'downtempo', 'jungle', 'dnb', 'dubstep',
    'trance', 'electro', 'breakbeat', 'acid', 'techno', 'house', 'trap', 'hiphop', 'jazz', 'bossa', 'funk', 'disco', 'soul', 'gospel', 'blues', 'reggae', 'afrobeats', 'rock', 'cinematic', 'pop', 'chip', 'ambient', 'noise', 'experimental'];
  function detect(task = '', persona = '') {
    for (const s of [task, persona]) for (const k of ORDER) if (G[k].re.test(s)) return k;
    return null;
  }
  const get = k => G[k] || null;
  const bpmOf = (g, p) => { const [a, b] = g.bpm; const t = (p?.tr?.aggression ?? 0.3) * 0.6 - (p?.tr?.calm ?? 0) * 0.6 + rnd() * 0.5; return Math.round(a + (b - a) * Math.max(0, Math.min(1, t))); };

  // ======================= BASS STYLES =======================
  // notes are chord-relative scale degrees (0 root, 4 fifth, 7 octave; -1 / 1 approach the next root)
  const BASS = {
    offbeat: () => ({ hits: [[2, 0], [6, 0], [10, 0], [14, pick([0, 7])]], idea: 'off-beat bass between the kicks' }),
    rolling: () => ({ hits: [[2, 0], [3, 0], [6, 0], [7, 0], [10, 0], [11, 0], [14, 0], [15, pick([0, 7, 4])]], idea: 'rolling off-beat 16ths (trance roll)' }),
    psy: () => ({ hits: [1, 2, 3, 5, 6, 7, 9, 10, 11, 13, 14, 15].map(s => [s, s === 15 && rnd() < 0.5 ? 7 : 0]), idea: 'the psy gallop: three 16ths between every kick' }),
    techbass: () => ({ hits: pick([[[0, 0], [3, 0], [6, 7], [10, 0], [13, 0]], [[2, 0], [5, 0], [7, 0], [10, 0], [14, 7]], [[0, 0], [3, 0], [8, 0], [11, 0], [14, 0]]]), idea: 'a rolling, syncopated groove locked to the kick' }),
    wobble: () => ({ hits: pick([[[0, 0, 8]], [[0, 0, 6], [6, 0, 2], [8, 7, 6], [14, 5, 2]], [[0, 0, 4], [4, 0, 4], [8, -2, 4], [12, -1, 4]], [[0, 0, 10], [10, 7, 3], [13, 0, 3]]]), long: true, idea: 'long, held bass notes for the wobble to chew on' }),
    riddim: () => ({ hits: [[0, 0, 3], [3, 0, 3], [6, 0, 2], [8, 0, 3], [11, 0, 3], [14, 0, 2]], long: true, idea: 'the same note, retriggered in a triplet-ish riddim pattern' }),
    reese: () => ({ hits: pick([[[0, 0, 8], [8, pick([0, -2, 5]), 8]], [[0, 0, 12], [12, -1, 4]], [[0, 0, 6], [6, 0, 4], [10, 2, 6]]]), long: true, idea: 'long reese notes sliding between roots' }),
    jungle: () => ({ hits: [[0, 0, 6], [10, pick([0, 4, -3]), 6]], long: true, idea: 'sub bass at half the speed of the breaks' }),
    garage: () => ({ hits: pick([[[0, 0], [7, 0], [10, 7], [13, 0]], [[0, 0], [3, 0], [10, 0], [14, 4]]]), idea: '2-step bass bouncing with the skippy kick' }),
    trap808: () => ({ hits: pick([[[0, 0, 7], [7, 0, 3], [10, pick([7, 4, -2]), 6]], [[0, 0, 10], [10, 0, 2], [12, pick([7, 5]), 4]], [[0, 0, 6], [6, 0, 2], [10, -1, 4], [14, 0, 2]]]), long: true, slide: 0.35, idea: 'long 808 notes on the kicks, gliding into octaves' }),
    drill808: () => ({ hits: [[0, 0, 6], [6, pick([1, -1, 2]), 4], [10, 0, 3], [13, pick([-2, 4]), 3]], long: true, slide: 0.6, idea: 'sliding drill 808 that glides between notes' }),
    electro: () => ({ hits: [[0, 0], [3, 0], [6, 7], [10, 0], [11, 0], [14, 4]], idea: 'syncopated electro bass' }),
    funk: () => ({ hits: [[0, 0], [3, 7], [6, 0], [7, 7], [10, 0], [12, 4], [14, 6], [15, 7]], ghost: [2, 9, 13], idea: 'syncopated funk bass, octave pops and ghost notes' }),
    disco: () => ({ hits: [0, 2, 4, 6, 8, 10, 12, 14].map((s, i) => [s, i % 2 ? 7 : 0]), idea: 'octave-jumping disco 8ths' }),
    pop8: () => ({ hits: [0, 2, 4, 6, 8, 10, 12, 14].map(s => [s, s === 14 ? pick([0, 4, -1]) : 0]), idea: 'eighth-note root bass' }),
    drive8: () => ({ hits: [0, 2, 4, 6, 8, 10, 12, 14].map(s => [s, s % 8 === 6 ? 7 : 0]), idea: 'driving 8th-note synth bass' }),
    boombap: () => ({ hits: pick([[[0, 0], [7, 0], [10, 4], [14, -1]], [[0, 0], [3, 0], [10, 0], [13, 4]], [[0, 0], [8, 2], [10, 4], [12, 5], [14, 4]]]), idea: 'a bass riff that locks to the kick' }),
    walking: () => { const a = pick([[0, 2, 4, 5], [0, 4, 2, 1], [0, 2, 3, 4], [0, 1, 2, 6], [0, 4, 5, -1], [0, 7, 4, 1]]); return { hits: a.map((n, i) => [i * 4, n, 3]), idea: 'walking quarter notes: chord tones on the beat, an approach note into the next chord' }; },
    bossa: () => ({ hits: [[0, 0, 5], [6, 4, 2], [8, 0, 5], [14, 4, 2]], idea: 'bossa bass: root and fifth, the dotted push' }),
    soul: () => ({ hits: pick([[[0, 0, 4], [6, 2, 2], [8, 4, 3], [11, 5, 2], [14, -1, 2]], [[0, 0, 6], [7, 4, 2], [10, 7, 2], [14, 6, 2]]]), idea: 'a melodic, singing bass line' }),
    reggae: () => ({ hits: pick([[[2, 0, 2], [4, 0, 2], [6, 4, 2], [10, 7, 2], [11, 5, 2], [12, 4, 3]], [[0, 0, 3], [6, 0, 2], [8, 2, 3], [11, 4, 2], [14, 2, 2]]]), idea: 'deep, melodic reggae bass that leaves space' }),
    dembow: () => ({ hits: [[0, 0, 3], [4, 0, 3], [8, 0, 3], [12, pick([0, 7, 4]), 3]], idea: 'bass on the dembow kicks' }),
    afro: () => ({ hits: [[0, 0, 3], [3, 0, 2], [6, 4, 2], [10, 0, 3], [13, 2, 2]], slide: 0.3, idea: 'a melodic log-drum style bass' }),
    boogie: () => ({ hits: [0, 2, 4, 6, 8, 10, 12, 14].map((s, i) => [s, [0, 2, 4, 5, 6, 5, 4, 2][i]]), idea: 'boogie-woogie bass walking up and down the chord' }),
    long: () => ({ hits: [[0, 0, 16]], long: true, idea: 'long, held bass notes' })
  };
  function bassLine(g, role, mode) {
    const f = BASS[g?.bass?.style]; if (!f) return null;
    if (mode === 'out' || mode === 'long' || mode === 'pedal') return null; // the song engine's own sparse modes
    const b = f(), notes = Array(16).fill(null), accents = [], slides = [];
    for (const [s, n] of b.hits) { notes[s] = n; if (s % 4 === 0) accents.push(s); }
    if (b.slide) b.hits.forEach(([s], i) => { if (i < b.hits.length - 1 && rnd() < b.slide) slides.push(s); });
    if (b.long) b.hits.forEach(([s]) => { if (notes[s + 1] == null && !slides.includes(s)) slides.push(s); }); // legato: held to the next note
    return { notes, accents, slides, idea: b.idea, long: !!b.long };
  }

  // ======================= DRUMS PER SECTION =======================
  // On the sampled kits the CB lane is a shaker, tambourine or woodblock. On the synth kits it is a real cowbell, which
  // Rae does not want to hear, so the lane is dropped there.
  const synthKit = () => { const k = (typeof Engine !== 'undefined') && Engine.mods?.drums?.params?.kit?.choice; return !!k && typeof Samples !== 'undefined' && !Samples.isKit(k); };
  const noCowbell = (pat, force) => { if (pat && (force ?? synthKit())) delete pat.CB; return pat; };
  function drums(g, role, base, mode, variant) { return noCowbell(drums0(g, role, base, mode, variant)); }
  function drums0(g, role, base, mode, variant) {
    const D0 = g?.drums; if (!D0) return null;
    const P = s => String(s || '').padEnd(16, '.').slice(0, 16), out = {};
    const set = (k, v) => { if (v && /[xX]/.test(v)) out[k] = P(v); };
    const main = D0.main ? { ...D0.main } : base;
    if (variant === 'roll' && D0.build === 'snare8') { set('SD', '....x...x.x.xxxx'); set('CP', '........x...x...'); set('CH', 'x.x.x.x.x.x.x.x.'); if (!D0.half) set('BD', 'x...x...x...x...'); else set('BD', 'x.........x.....'); return out; }
    if (variant === 'roll' && D0.build === 'fill') { Object.keys(main).forEach(k => k !== 'OH' && k !== 'CY' && set(k, main[k])); set('SD', P(main.SD || '....x.......x...').slice(0, 8) + 'x.x.xxxx'); set('LT', '..........x..x..'); return out; }
    if (variant) return null; // pull and fill: the engine's own
    if (mode === 'intro' && D0.intro) { Object.entries(D0.intro).forEach(([k, v]) => set(k, v)); return out; }
    if (mode === 'intro') { ['CH', 'RS', 'CB', 'OH'].forEach(k => set(k, main[k])); if (!Object.keys(out).length) set('CH', '..x...x...x...x.'); return out; }
    if (mode === 'build' && D0.build === 'snare8') { Object.keys(main).forEach(k => k !== 'OH' && set(k, main[k])); set('SD', '....x.......x.x.'); return out; }
    if (mode === 'build' && D0.build === 'fill') { Object.keys(main).forEach(k => set(k, main[k])); set('CY', ''); return out; }
    if (mode === 'verse') { Object.keys(main).forEach(k => k !== 'CY' && (k !== 'OH' || !D0.ohFull) && set(k, main[k])); return out; }
    if (mode === 'half' && !D0.half) return null;
    if (mode === 'half') { set('BD', main.BD?.slice(0, 8) + '........'); set('SD', main.SD); set('CP', main.CP); set('CH', 'x...x...x...x...'); return out; }
    if (mode === 'break') { ['CH', 'RS', 'CB', 'LT'].forEach(k => set(k, main[k])); if (!Object.keys(out).length) set('CH', '........x.......'); return out; }
    // full: everything, a crash on the downbeat; open hats only in genres that use them
    Object.keys(main).forEach(k => set(k, main[k]));
    if (D0.ohFull && !out.OH) set('OH', '..x...x...x...x.');
    set('CY', 'x...............');
    return out;
  }

  // ======================= THE PRIMER (for Claude and the log) =======================
  function primer(k) {
    const g = G[k]; if (!g) return '';
    return `GENRE: ${g.label}. Tempo ${g.bpm[0]}-${g.bpm[1]} BPM${g.swing ? `, swing ${Math.round(g.swing * 100)}% on the ${g.sgrid === '8TH' ? '8ths' : '16ths'}` : ''}${g.half ? ', half-time feel' : ''}. Scales: ${g.scales.join(', ')}. ${g.notes}` +
      (g.progs ? ` Typical progressions (0-based degrees): ${Object.entries(g.progs).map(([r, ps]) => `${r} ${ps.map(p => p.join('-')).join(' / ')}`).join('; ')}.` : '') +
      (g.drums?.main ? ` Drum skeleton: ${Object.entries(g.drums.main).filter(([, v]) => v).map(([i, v]) => `${i} ${v}`).join(', ')}.` : '');
  }
  return { G, LIST, ORDER, detect, get, bpmOf, bassLine, drums, noCowbell, primer, BASS, pick };
})();
