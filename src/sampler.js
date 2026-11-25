// sampler.js — the sample library, the Crate sampler, the Comper chord player and the sampled drum kits.
// Samples live in samples/<bank>.json (built by tools/make_samples.py from CC0 / CC-BY sources and synthesis; see
// samples/CREDITS.md). A bank loads the first time something asks for it, so the page stays light.
//  * Crate: a polyphonic sampler. KEYS banks are multisampled instruments played by NOTE; CHOP banks are loops cut
//    into slices (the slice follows the sequencer step, or the note); SHOTS banks are one-shots picked by note.
//  * Comper: plays the song's chords on a rhythm (block chords, stabs, skanks, Charleston comping, bossa, strums,
//    arps, pads) with real voicings (7ths, 9ths, shell, rootless, quartal) and voice leading. Its NOTE output plays
//    any voice, best of all the Crate with piano, electric piano, organ or strings.
//  * The drum machine gets sampled kits (acoustic, jazz, boom bap, latin, hand drums, club, hard, trap).
'use strict';
const Samples = (() => {
  const E = Engine, ctx = E.ctx;
  // name, label, kind, family (kept in step with tools/make_samples.py)
  const BANKS = [
    ['PIANO', 'Grand piano', 'keys', 'keys'], ['EPIANO', 'FM electric piano', 'keys', 'keys'], ['CLAV', 'Clavi', 'keys', 'keys'], ['ORGAN', 'Tonewheel organ', 'keys', 'keys'],
    ['PIPES', 'Chamber organ', 'keys', 'keys'], ['SAX', 'Tenor sax', 'keys', 'wind'], ['HARMONICA', 'Harmonica', 'keys', 'wind'], ['FLUTE', 'Alto recorder', 'keys', 'wind'],
    ['HARP', 'Concert harp', 'keys', 'plucked'], ['GUITAR', 'Nylon strumstick', 'keys', 'plucked'], ['MARIMBA', 'Marimba', 'keys', 'plucked'], ['PSALTERY', 'Plucked psaltery', 'keys', 'plucked'],
    ['DANTRANH', 'Dan tranh zither', 'keys', 'plucked'], ['UKULELE', 'Ukulele', 'keys', 'plucked'], ['BASS', 'Fretless bass', 'keys', 'bass'], ['UPRIGHT', 'Upright bass', 'keys', 'bass'],
    ['808', '808 sub bass', 'keys', 'bass'], ['CELLO', 'Bowed cello', 'keys', 'strings'], ['BRASS', 'Brass stab', 'keys', 'synth'], ['PLUCK', 'Synth pluck', 'keys', 'synth'],
    ['VOX', 'Vocal oohs and aahs', 'keys', 'vocal'], ['CHOIR', 'Choir pad', 'keys', 'vocal'], ['VOXCHOP', 'Vocal chops', 'shots', 'vocal'],
    ['BREAK_FUNK', 'Funk break 95', 'chop', 'breaks'], ['BREAK_BOOMBAP', 'Boom bap break 88', 'chop', 'breaks'], ['BREAK_JUNGLE', 'Jungle break 170', 'chop', 'breaks'],
    ['BREAK_SHUFFLE', '2-step shuffle 132', 'chop', 'breaks'], ['BREAK_LATIN', 'Latin groove 105', 'chop', 'breaks'], ['BREAK_HALF', 'Half-time break 140', 'chop', 'breaks'],
    ['VINYL', 'Vinyl crackle', 'chop', 'texture'], ['RAIN', 'Rain', 'chop', 'texture'], ['FX', 'Risers, impacts, sweeps', 'shots', 'fx']
  ];
  const KITS = [['ACOUSTIC', 'Acoustic kit'], ['JAZZ', 'Jazz kit'], ['BOOMBAP', 'Boom bap kit'], ['LATIN', 'Latin percussion'], ['HAND', 'Hand drums'], ['HOUSE', 'Club kit'], ['HARD', 'Hard kit'], ['TRAP', 'Trap kit']];
  const INFO = Object.fromEntries([...BANKS.map(([n, l, k, f]) => [n, { name: n, label: l, kind: k, family: f }]), ...KITS.map(([n, l]) => [n, { name: n, label: l, kind: 'kit', family: 'drums' }])]);
  const base = new URL('samples/', document.baseURI).href;
  const cache = {}, pending = {};
  const b64 = s => { const bin = atob(s), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u.buffer; };
  // MP3 decoders add a little silence at the start: cut it so drum hits land on the grid
  function lead(buf, keep) {
    if (keep) return buf;
    const d = buf.getChannelData(0); let i = 0; const lim = Math.min(d.length, 6000);
    while (i < lim && Math.abs(d[i]) < 0.0015) i++;
    if (i < 24) return buf;
    i = Math.max(0, i - 16);
    const out = ctx.createBuffer(1, d.length - i, buf.sampleRate); out.getChannelData(0).set(d.subarray(i)); return out;
  }
  const decode = (s, keep) => new Promise((res, rej) => ctx.decodeAudioData(b64(s), b => res(lead(b, keep)), rej));
  async function load(name) {
    if (cache[name]) return cache[name];
    if (pending[name]) return pending[name];
    pending[name] = (async () => {
      const r = await fetch(base + name.toLowerCase() + '.json'); if (!r.ok) throw new Error('no bank ' + name);
      const j = await r.json(), b = { ...INFO[name], src: j.src, bpm: j.bpm, slices: j.slices };
      if (j.kind === 'kit') { b.lanes = {}; for (const [lane, zs] of Object.entries(j.lanes)) b.lanes[lane] = await Promise.all(zs.map(z => decode(z.d))); }
      else { b.zones = await Promise.all(j.zones.map(async z => ({ root: z.root, nm: z.nm, buf: await decode(z.d, j.kind === 'chop') }))); }
      if (b.kind === 'chop') { // a slice runs until the next one starts
        const len = b.zones[0].buf.duration; b.ends = b.slices.map((s, i) => b.slices[i + 1] ?? len);
      }
      cache[name] = b; delete pending[name]; E.fire('samples', { name }); return b;
    })().catch(e => { delete pending[name]; console.warn('sample bank', name, e); E.fire('samples', { name, error: true }); return null; });
    return pending[name];
  }
  const get = name => cache[name] || null;
  // a reversed copy, made once per buffer
  const revs = new WeakMap();
  const reversed = buf => { if (revs.has(buf)) return revs.get(buf); const o = ctx.createBuffer(1, buf.length, buf.sampleRate), a = buf.getChannelData(0), b = o.getChannelData(0); for (let i = 0; i < a.length; i++) b[i] = a[a.length - 1 - i]; revs.set(buf, o); return o; };
  const isKit = k => KITS.some(x => x[0] === k);
  return { BANKS, KITS, INFO, load, get, reversed, isKit, names: (kind, fam) => BANKS.filter(b => (!kind || b[2] === kind) && (!fam || b[3] === fam)).map(b => b[0]) };
})();

const Crate = (() => {
  // Dust = bit-crush blended with tanh drive; both tables resampled to one length, cached by (bits, drive)
  const dustCache = new Map();
  function dustCurve(bits, drive) {
    const k = bits + ':' + drive; if (dustCache.has(k)) return dustCache.get(k);
    const c = DSP.curveCrush(bits), t = DSP.curveTanh(drive * 0.8), r = (t.length - 1) / (c.length - 1), o = new Float32Array(c.length);
    for (let i = 0; i < c.length; i++) o[i] = c[i] * 0.5 + t[Math.round(i * r)] * 0.5;
    dustCache.set(k, o); return o;
  }
  const E = Engine, ctx = E.ctx, { clamp, mtof } = DSP, M = E.Module, now = () => ctx.currentTime;
  const pct = v => Math.round(v * 100) + '%';
  const secs = v => v < 1 ? Math.round(v * 1000) + 'ms' : v.toFixed(2) + 's';
  const hz = v => v >= 1000 ? (v / 1000).toFixed(1) + 'k' : Math.round(v) + 'Hz';
  const gain = (v = 1) => { const g = ctx.createGain(); g.gain.value = v; return g; };
  const smooth = (param, v, tc = 0.02) => { param.cancelScheduledValues(now()); param.setTargetAtTime(v, now(), tc); };
  const BANK_NAMES = Samples.BANKS.map(b => b[0]);

  // ======================= CRATE: sampler =======================
  function Sampler(id, o = {}) {
    const m = new M(id, { name: 'Crate', sub: 'sampler · instruments, breaks, chops, FX', width: 420, stripe: '#d8a24a', family: 'voice' });
    const bus = gain(1), filt = ctx.createBiquadFilter(), sh = ctx.createWaveShaper(), crushG = gain(1), out = gain(0.8);
    filt.type = 'lowpass'; filt.Q.value = 0.5; sh.oversample = '2x'; sh.curve = DSP.curveTanh(0);
    bus.connect(filt); filt.connect(sh); sh.connect(crushG); crushG.connect(out);
    const toneCV = gain(2400); toneCV.connect(filt.detune);
    m.bank = null; m.voices = []; m.lastSlice = -1; m.flash = 0;
    const setBank = () => {
      const name = m.params.bank.choice; m.bank = Samples.get(name); m.ui?.upd?.();
      if (!m.bank) Samples.load(name).then(b => { if (m.params.bank.choice === name) { m.bank = b; m.ui?.upd?.(); } });
    };
    m.p('bank', { label: 'Bank', steps: BANK_NAMES, def: Math.max(0, BANK_NAMES.indexOf(o.bank || o.model || 'PIANO')) / (BANK_NAMES.length - 1), apply: setBank });
    m.p('pitch', { label: 'Pitch', min: -12, max: 12, def: 0.5, fmt: v => (v > 0 ? '+' : '') + v.toFixed(1) + 'st' });
    m.p('start', { label: 'Start', min: 0, max: 0.6, def: 0, fmt: pct });
    m.p('att', { label: 'Attack', min: 0.001, max: 1.5, curve: 'exp', def: 0.05, fmt: secs });
    m.p('rel', { label: 'Release', min: 0.02, max: 4, curve: 'exp', def: 0.45, fmt: secs });
    m.p('hold', { label: 'Hold', steps: ['GATE', 'FULL'], def: 0 });
    m.p('chop', { label: 'Chop by', steps: ['STEP', 'NOTE'], def: 0 });
    m.p('fit', { label: 'Fit', steps: ['TEMPO', 'OFF'], def: 0 });
    m.p('rev', { label: 'Reverse', steps: ['OFF', 'ON'], def: 0 });
    m.p('tone', { label: 'Tone', min: 150, max: 18000, curve: 'exp', def: 0.86, fmt: hz, apply: v => smooth(filt.frequency, v) });
    const shape = () => { const dr = m.v('drive') || 0, du = m.v('dust') || 0; sh.curve = du > 0.02 ? dustCurve(Math.round(16 - du * 10), Math.round(dr * 20) / 20) : DSP.curveTanh(dr * 0.8); };
    m.p('drive', { label: 'Drive', def: 0, fmt: pct, apply: () => shape() });
    m.p('dust', { label: 'Dust', def: 0, fmt: pct, apply: v => { shape(); smooth(filt.Q, 0.5 + v * 2); } });
    m.p('level', { label: 'Level', def: 0.7, fmt: pct, apply: v => smooth(out.gain, v) });
    m.inEvent('NOTE', function (e) { if (e.kind === 'note') this.play(e); else this.play({ ...e, midi: 60, deg: 0, dur: 0.25 }); }, 'notes (KEYS: pitch · CHOP: the slice · SHOTS: which one)');
    m.inEvent('TRIG', function (e) { this.play({ time: e.time, midi: 60, deg: 0, pos: e.step != null ? e.step % 16 : undefined, vel: e.vel ?? 0.85, dur: e.dur ?? 0.3 }); }, 'trigger (a clock here plays a break in order)');
    m.inAudio('TONE', toneCV, 'tone CV'); m.ins.TONE.jt = 'cv';
    m.outAudio('OUT', out, 'sampler out');
    function voice(buf, t, rate, offset, dur, vel, choke) {
      if (m.v('rev')) { buf = Samples.reversed(buf); offset = Math.max(0, buf.duration - offset - (dur || buf.duration)); }
      const s = ctx.createBufferSource(), g = gain(0); s.buffer = buf; s.playbackRate.value = rate; s.connect(g); g.connect(bus);
      const att = Math.min(m.v('att'), 0.5 * (dur || 1)), rel = m.v('rel'), pk = 0.9 * (vel ?? 0.8);
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(pk, t + Math.max(0.002, att));
      const len = (buf.duration - offset) / rate;
      const end = dur != null ? Math.min(len, dur) : len;
      if (dur != null && end < len) g.gain.setTargetAtTime(0, t + end, Math.max(0.005, rel / 4));
      s.start(t, offset); s.stop(t + Math.min(len, end + rel * 1.5) + 0.05);
      if (choke) for (const v of m.voices) if (v.choke) { v.g.gain.cancelScheduledValues(t); v.g.gain.setTargetAtTime(0, t, 0.004); try { v.s.stop(t + 0.03); } catch (er) { /* gone */ } }
      const v = { s, g, choke, t }; m.voices.push(v); s.onended = () => { m.voices = m.voices.filter(x => x !== v); try { g.disconnect(); } catch (er) { /* gone */ } };
      while (m.voices.length > 24) { const x = m.voices.shift(); try { x.s.stop(); } catch (er) { /* gone */ } }
    }
    m.play = function (e) {
      const b = this.bank; if (!b) return;
      const t = Math.max(e.time ?? now(), now() + 0.002), pitch = this.v('pitch'), vel = e.vel ?? 0.8, gate = this.params.hold.choice === 'GATE';
      if (b.kind === 'keys') {
        const z = b.zones.reduce((best, z) => Math.abs(z.root - e.midi) < Math.abs(best.root - e.midi) ? z : best, b.zones[0]);
        const rate = Math.pow(2, (e.midi - z.root + pitch) / 12);
        voice(z.buf, t, rate, this.v('start') * z.buf.duration * 0.5, gate ? Math.max(0.05, e.dur ?? 0.3) : null, vel, false);
      } else if (b.kind === 'chop') {
        const n = b.slices.length, i = n === 1 ? 0 : this.params.chop.choice === 'NOTE' ? (((e.deg ?? 0) % n) + n) % n : (e.pos ?? ((Math.round(E.step) % 16) % n));
        const fit = this.params.fit.choice === 'TEMPO' && b.bpm ? E.bpm / b.bpm : 1;
        const rate = fit * Math.pow(2, pitch / 12), z = b.zones[0], off = b.slices[i] + this.v('start') * (b.ends[i] - b.slices[i]);
        const sliceLen = n === 1 ? null : (b.ends[i] - off) / rate * 1.6; // let the slice tail ring a little past the next step
        voice(z.buf, t, rate, off, gate && n > 1 ? sliceLen : n === 1 ? (gate ? Math.max(0.1, e.dur ?? 1) : null) : null, vel, n > 1);
        this.lastSlice = i;
      } else { // shots
        const n = b.zones.length, i = (((e.deg ?? 0) % n) + n) % n, z = b.zones[i];
        voice(z.buf, t, Math.pow(2, pitch / 12), this.v('start') * z.buf.duration * 0.5, null, vel, false); this.lastSlice = i;
      }
      E.at(t, () => { this.flash = performance.now(); });
    };
    // fire a named one-shot (risers, impacts) so that it ends at `endAt` (audio time); used by the song engine
    m.shot = function (name, endAt, vel = 0.7, startAt) {
      const b = this.bank; if (!b || b.kind !== 'shots') return 0;
      const z = b.zones.find(z => z.nm === name) || b.zones[0], dur = z.buf.duration;
      const t = Math.max(now() + 0.01, startAt != null ? startAt : endAt != null ? endAt - dur : now() + 0.01);
      voice(z.buf, t, 1, 0, null, vel, false); E.at(t, () => { this.flash = performance.now(); }); return dur;
    };
    m.layout = [{ custom: 'crate' }, { k: ['bank', 'pitch', 'start', 'att', 'rel', 'hold', 'chop', 'fit', 'rev', 'tone', 'drive', 'dust', 'level'], cls: 'kgrid' }];
    return m;
  }

  // ======================= COMPER: chord player =======================
  const STYLES = {
    BLOCK: 'X.......x.......', POP: 'X.x.x.x.X.x.x.x.', STAB: '..X..x....X..x..', OFFBEAT: '..x...x...x...x.', SKANK: '....x.......x...',
    CHARLESTON: 'X.....x.........', BOSSA: 'X..x..x...x..x..', GOSPEL: 'X..x..x...x.x...', STRUM: 'X.x.x.xxX.x.x.xx', ARP: 'xxxxxxxxxxxxxxxx',
    PAD: 'X...............', HALF: 'X.......X.......', PUSH: 'X.....x...x..x..', DEMBOW: 'X..x..x.X..x..x.'
  };
  const VOICINGS = { TRIAD: [0, 2, 4], '7TH': [0, 2, 4, 6], '9TH': [0, 2, 6, 8], SHELL: [0, 2, 6], ROOTLESS: [2, 4, 6, 8], POWER: [0, 4, 7], SUS2: [0, 1, 4], SUS4: [0, 3, 4], OPEN: [0, 4, 9], QUARTAL: [0, 3, 6, 9], ADD9: [0, 2, 4, 8] };
  const parse = s => String(s).padEnd(16, '.').slice(0, 16).split('').map(c => c === 'X' ? 2 : c === 'x' ? 1 : 0);
  function Comper(id) {
    const m = new M(id, { name: 'Comper', sub: 'chord player · voicings · rhythms · voice leading', width: 420, stripe: '#7fc2a8', family: 'seq' });
    m.rhythm = parse(STYLES.BLOCK); m.prog = [0]; m.prev = null; m.pos = -1; m.chordName = ''; m.arpIx = 0; m.lastHit = -1;
    m.p('style', { label: 'Style', steps: Object.keys(STYLES), def: 0, apply: (v, p) => { m.rhythm = parse(STYLES[p.choice]); m.ui?.upd?.(); } });
    m.p('voicing', { label: 'Voicing', steps: Object.keys(VOICINGS), def: 1 / (Object.keys(VOICINGS).length - 1) });
    m.p('root', { label: 'Root', steps: DSP.NOTE_NAMES, def: 0, small: true });
    m.p('scale', { label: 'Scale', steps: DSP.SCALE_NAMES, def: 0, small: true });
    m.p('oct', { label: 'Octave', steps: [2, 3, 4, 5], def: 1 / 3, small: true });
    m.p('bass', { label: 'Left hand', steps: ['OFF', 'ROOT', 'ROOT+5'], def: 0, small: true });
    m.p('lead', { label: 'Voice lead', steps: ['ON', 'OFF'], def: 0, small: true });
    m.p('gate', { label: 'Gate', min: 0.1, max: 1, def: 0.7, fmt: pct, small: true });
    m.p('strum', { label: 'Strum', min: 0, max: 0.06, def: 0.1, fmt: v => Math.round(v * 1000) + 'ms', small: true });
    m.p('human', { label: 'Human', def: 0.3, fmt: pct, small: true });
    m.p('dens', { label: 'Density', def: 0.5, fmt: pct, small: true });
    m.p('follow', { label: 'Harmony', steps: ['SONG', 'OWN'], def: 0, small: true });
    m.inEvent('CLK', function (e) { this.advance(e); }, 'clock in (16ths)');
    m.outEvent('NOTE', 'chord notes (several per hit)'); m.outEvent('GATE', 'a trigger on each chord');
    m.setRhythm = function (s) { this.rhythm = Array.isArray(s) ? s.slice(0, 16) : parse(s); this.ui?.upd?.(); };
    m.degreeAt = function (step) {
      if (this.v('follow') === 0 && E.harmony.length) return E.chordAt(step);
      const bar = Math.floor(step / 16); return this.prog[((bar % this.prog.length) + this.prog.length) % this.prog.length] || 0;
    };
    // the notes of chord `deg` in this key and voicing, voice-led toward the last chord
    m.chord = function (deg) {
      const sc = this.params.scale.choice, base = 12 * (this.params.oct.choice + 1) + this.v('root');
      const iv = VOICINGS[this.params.voicing.choice] || VOICINGS.TRIAD;
      let notes = iv.map(k => base + DSP.degreeToSemi(sc, deg + k));
      if (this.params.lead.choice === 'ON' && this.prev) {
        const center = this.prev.reduce((a, b) => a + b, 0) / this.prev.length; let best = notes, bd = 1e9;
        for (let inv = 0; inv < notes.length; inv++) for (const sh of [-12, 0, 12]) {
          const c = notes.map((n, i) => n + (i < inv ? 12 : 0) + sh).sort((a, b) => a - b);
          const mid = c.reduce((a, b) => a + b, 0) / c.length, lo = c[0], hi = c[c.length - 1];
          const d = Math.abs(mid - center) + (lo < base - 7 ? 6 : 0) + (hi > base + 22 ? 6 : 0);
          if (d < bd) { bd = d; best = c; }
        }
        notes = best;
      }
      return notes;
    };
    m.advance = function (e) {
      const step = e.step ?? (this.pos + 1); this.pos = ((step % 16) + 16) % 16;
      const p = this.pos, v = this.rhythm[p], t = e.time, sd = e.dur || E.sixteenth();
      E.at(t, () => this.ui?.cursor?.(p));
      if (!v) return;
      const dens = this.v('dens');
      if (v === 1 && dens < 0.5 && Math.random() > dens * 2) return; // thin out the weak hits
      const deg = this.degreeAt(step), notes = this.chord(deg); this.prev = notes;
      // the chord lasts until the next hit (or the end of the bar), times the gate
      let nx = 1; while (p + nx < 16 && !this.rhythm[p + nx]) nx++;
      const style = this.params.style.choice, dur = Math.max(0.05, sd * nx * this.v('gate') * (style === 'PAD' ? 1.02 : 1));
      const hu = this.v('human'), vel = (v === 2 ? 0.95 : 0.72) * (1 - hu * 0.25 * Math.random());
      const name = DSP.NOTE_NAMES[(notes[0] % 12 + 12) % 12];
      this.chordName = `${Theory.chordName(this.params.scale.choice, deg)} · ${this.params.voicing.choice.toLowerCase()}`;
      if (style === 'ARP') {
        const n = notes[this.arpIx++ % notes.length];
        this.emit('NOTE', { kind: 'note', time: t, midi: n, dur: sd * this.v('gate') * 1.5, vel, acc: v === 2 });
      } else {
        const strum = this.v('strum') + (style === 'STRUM' ? 0.012 : 0), down = (p % 4 === 0) || style !== 'STRUM';
        const ord = down ? notes : notes.slice().reverse();
        ord.forEach((n, i) => this.emit('NOTE', { kind: 'note', time: t + i * strum + (Math.random() - 0.5) * hu * 0.012, midi: n, dur, vel: vel * (1 - i * 0.04), acc: v === 2 }));
        if (this.params.bass.choice !== 'OFF' && (v === 2 || p % 8 === 0)) {
          const r = 12 * (this.params.oct.choice) + this.v('root') + DSP.degreeToSemi(this.params.scale.choice, deg);
          this.emit('NOTE', { kind: 'note', time: t, midi: r, dur: Math.max(dur, sd * 6), vel: vel * 0.9 });
          if (this.params.bass.choice === 'ROOT+5') this.emit('NOTE', { kind: 'note', time: t + sd * 4, midi: r + 7, dur: sd * 3, vel: vel * 0.7 });
        }
      }
      this.emit('GATE', { kind: 'trig', time: t, vel });
      this.lastHit = p; void name;
    };
    m.getData = function () { return { rhythm: this.rhythm, prog: this.prog }; };
    m.setData = function (d) { if (d?.rhythm) this.rhythm = d.rhythm.slice(0, 16); if (d?.prog) this.prog = d.prog.slice(); this.ui?.upd?.(); };
    m.layout = [{ custom: 'comper' }, { k: ['style', 'voicing', 'root', 'scale', 'oct', 'bass', 'lead', 'gate', 'strum', 'human', 'dens', 'follow'], cls: 'kgrid' }];
    return m;
  }

  Mods.TYPES.Sampler = { label: 'Crate sampler', desc: 'polyphonic sampler: bank (PIANO, EPIANO, ORGAN, SAX, GUITAR, BASS, 808, VOX, BREAK_*, FX, VINYL ...); KEYS banks play pitched by NOTE, BREAK banks play one slice per step (TRIG from the clock plays the loop in order), FX plays risers and impacts', prefix: 'crate', make: (id, o) => Sampler(id, o) };
  Mods.TYPES.Comper = { label: 'Comper chord player', desc: 'plays the song\'s chords on a rhythm: style (BLOCK, POP, STAB, OFFBEAT, SKANK, CHARLESTON, BOSSA, GOSPEL, STRUM, ARP, PAD, HALF, PUSH, DEMBOW), voicing (TRIAD, 7TH, 9TH, SHELL, ROOTLESS, POWER, SUS2, SUS4, OPEN, QUARTAL, ADD9); NOTE out to a Crate, Reel or any voice', prefix: 'comp', make: id => Comper(id) };

  // ---------- panel displays ----------
  const { h, fitCanvas } = { h: UI.h, fitCanvas: UI.fitCanvas };
  const peaks = new WeakMap();
  const peakOf = (buf, n) => { if (peaks.has(buf)) return peaks.get(buf); const d = buf.getChannelData(0), out = new Float32Array(n), k = Math.max(1, Math.floor(d.length / n)); for (let i = 0; i < n; i++) { let mx = 0; for (let j = i * k; j < Math.min(d.length, (i + 1) * k); j += 4) mx = Math.max(mx, Math.abs(d[j])); out[i] = mx; } peaks.set(buf, out); return out; };
  UI.customs.crate = (m, el) => {
    const c = h('canvas', 'scr'), lcd = h('div', 'lcd'); el.append(c, lcd); let cx = null;
    const upd = () => { const b = m.bank, nm = m.params.bank.choice; lcd.textContent = b ? `${b.label} · ${b.kind}${b.kind === 'keys' ? ` · ${b.zones.length} zones` : b.kind === 'chop' ? ` · ${b.slices.length} slices${b.bpm ? ' @' + b.bpm : ''}` : ` · ${b.zones.length} sounds`} · ${b.src || ''}` : `${Samples.INFO[nm]?.label || nm} · loading…`; };
    const draw = () => {
      if (!cx) cx = fitCanvas(c, 56);
      const { g, w, h: H } = cx; g.clearRect(0, 0, w, H);
      const b = m.bank; if (!b) return;
      const z = b.kind === 'shots' ? b.zones[Math.max(0, m.lastSlice)] : b.kind === 'keys' ? b.zones[Math.floor(b.zones.length / 2)] : b.zones[0];
      const pk = peakOf(z.buf, 160), age = (performance.now() - m.flash) / 400;
      g.fillStyle = `rgba(255,${190 + 40 * Math.max(0, 1 - age)},120,${0.45 + 0.5 * Math.max(0, 1 - age)})`;
      for (let i = 0; i < pk.length; i++) { const a = pk[i] * (H / 2 - 3); g.fillRect(i / pk.length * w, H / 2 - a, w / pk.length + 0.5, a * 2); }
      if (b.kind === 'chop' && b.slices.length > 1) {
        const L = z.buf.duration; b.slices.forEach((s, i) => { g.fillStyle = i === m.lastSlice && age < 1 ? '#ffffff' : '#ffffff40'; g.fillRect(s / L * w, 0, i === m.lastSlice ? 2 : 1, H); });
      }
      if (m.voices.length) { g.fillStyle = '#9ef0b7'; g.fillRect(w - 8, H - 8, 5, 5); }
    };
    m.ui = { upd }; upd(); UI.anim(draw);
  };
  UI.customs.comper = (m, el) => {
    const g8 = h('div', 'dgrid comp'), cells = [], lcd = h('div', 'lcd');
    for (let s = 0; s < 16; s++) { const c = h('div', 'dc'); c.onclick = () => { m.rhythm[s] = (m.rhythm[s] + 1) % 3; upd(); }; g8.append(c); cells.push(c); }
    g8.style.gridTemplateColumns = 'repeat(16, 1fr)';
    el.append(g8, lcd);
    let cur = -1;
    const upd = () => { cells.forEach((c, s) => { c.classList.toggle('on', m.rhythm[s] > 0); c.classList.toggle('acc', m.rhythm[s] === 2); }); };
    const draw = () => { lcd.textContent = `${m.params.style.choice} · ${m.chordName || 'waiting for the clock'}`; };
    m.ui = { upd, cursor: p => { if (cur >= 0) cells[cur].classList.remove('cur'); cells[p]?.classList.add('cur'); cur = p; } };
    upd(); UI.anim(draw);
  };
  return { Sampler, Comper, STYLES, VOICINGS };
})();
