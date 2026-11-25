# Genre research notes

These notes are what PatchMind's AI knows about each genre. They live in code as `src/genres.js`, which the song
engine (`src/song.js`), the theory writers (`src/theory.js`) and the patch builder (`src/ai.js`, `L.genre`) read.
The per-genre sections below are generated from that file, so they match what the AI actually plays.

## How a genre is described

Each genre is a recipe with the same fields, so the AI can build any of them the same way:

* **Tempo and groove.** A BPM range, a swing amount and which grid swings. Jazz, blues, boom bap and lo-fi swing
  the 8th notes (the triplet feel), house and garage swing the 16ths a little, techno and trance stay straight.
  Half-time genres (dubstep, trap, drill, future bass) run at full tempo but put the snare on beat 3.
* **Drums.** A main 16-step pattern per lane, plus how intros, builds, breaks and drops change it: snare rolls
  (EDM builds), fills (live genres), the 8th-note snare run of trance and big room, and dropping to the hats in
  breakdowns. On the sampled kits the `CB` lane is a shaker, tambourine, guiro or woodblock. It is never a cowbell,
  and on the synth kits it is removed.
* **Harmony.** Scales, chord progressions per section role written as scale degrees, and harmonic rhythm (bars per
  chord). Pop uses the four-chord loop and its rotations, jazz uses ii-V-I and turnarounds, blues uses the 12-bar
  form, trap and drill use one or two dark chords, deep house and lo-fi use 7ths and 9ths.
* **Parts.** Which voices play bass, chords and lead (synths or sampled instruments), the bass style (walking,
  one drop, offbeat, rolling, 808 glide, reese, wobble and more), the comping rhythm and voicing for chords, and
  the melody style per section (sparse verses, hooks in choruses, call and response in blues, solos in jazz).
* **Extras.** Breakbeat chops, vinyl crackle, rain, risers and impacts, percussion, hat rolls, sidechain pump,
  dub echoes. Plus effect weights, brightness, and how hard the drop's bass wobbles.
* **Form.** Club (intro, build, drop, break, build, drop, outro), trance (long breakdown), verse-chorus (pop and
  rock), hip hop (hook and verses), jazz (head, solos, head), blues (12-bar choruses).

## New tools that make these genres possible

* **Sampler** (`Crate`): plays the sample library. Keys banks are multisampled across the keyboard, kits replace
  the drum machine's voices, chop banks are breakbeats sliced to the clock (tempo-fit, chopped by step or note),
  and shot banks hold risers, impacts and vocal chops. Knobs: pitch, start, attack, release, hold, reverse, tone,
  drive and dust (bit-crush with a resonant filter, for lo-fi).
* **Comper**: a chord player. It reads the song's chords and plays them with a rhythm (block, pop, stab, offbeat,
  reggae skank, Charleston, bossa, gospel, strum, arpeggio, pad, half, push, dembow), a voicing (triad, 7th, 9th,
  shell, rootless, power, sus, open, quartal, add9), voice leading, a left hand, strum and humanize.
* **Swing grid** on the Clock (16th or 8th), and the Mixolydian and Lydian scales.
* **Sample library**: 40 banks, about 5.5 MB, loaded only when used. See `samples/CREDITS.md`.

## Electronic dance music

### House

*Tempo* 120-126 BPM · *swing* 12% on the 16th grid · *scales* minor, dorian, major · *form* club · *kits* HOUSE, 909

Four-on-the-floor kick, claps on 2 and 4, open hats on every off-beat, shaker 16ths, a little swing. Piano or organ stabs with 7th and 9th chords, often a two-chord vamp (i - iv in Dorian). Off-beat bass. DJ-friendly 16- and 32-bar phrases; breakdowns drop the kick, the drop brings it back with a sidechain pump.

```
BD X...X...X...X...
CP ....X.......X...
CH x.x.x.x.x.x.x.x.
OH ..X...X...X...X.
CB x.xxx.xxx.xxx.xx
```

*Progressions (scale degrees)* verse: I-IV, I-VI-IV-V; chorus: I-IV-VI-V, VI-IV-I-V

### Deep house

*Tempo* 118-124 BPM · *swing* 16% on the 16th grid · *scales* dorian, minor · *form* club · *kits* HOUSE, BOOMBAP

Slower, warmer house: soft kick, rim shots, swung hats, Rhodes-like electric piano with 9th and rootless voicings, Dorian minor vamps, round bass, airy vocal pads. Long, patient builds.

```
BD X...X...X...X...
CP ....x.......x...
CH x.x.x.x.x.x.x.x.
OH ..x...x...x...x.
RS ...x.....x..x...
CB ..x...x...x...x.
```

*Progressions (scale degrees)* verse: I-IV, II-V; chorus: I-IV-II-V, IV-III-II-I

### Tech house

*Tempo* 124-128 BPM · *swing* 8% on the 16th grid · *scales* minor, phryg · *form* club · *kits* HOUSE, 909

Groove first: a rolling, syncopated bassline locked to the kick, busy percussion and 16th hats, vocal chops, little harmony (one chord, maybe a bVII). Tension comes from filter sweeps and percussion, not chord changes.

```
BD X...X...X...X...
CP ....X.......X...
CH xxXxxxXxxxXxxxXx
OH ..x...x...x...x.
RS ..x..x....x..x..
CB x.x.x.x.x.x.x.x.
```

*Progressions (scale degrees)* verse: I, I-I-VII-I; chorus: I-VII, I-IV

### Techno

*Tempo* 128-138 BPM · *swing* 4% on the 16th grid · *scales* minor, phryg · *form* club · *kits* 909, HOUSE, HARD

Relentless four-on-the-floor, off-beat hats, rim-shot syncopation, rumble on the low toms. Harmony is minimal (one minor or Phrygian chord, stabs in suspended or quartal voicings); development is timbral: filters, delays, adding and removing parts every 8-16 bars.

```
BD X...X...X...X...
CP ....x.......x...
CH ..x...x...x...x.
OH ..x...x...x...x.
RS ..x..x....x..x..
LT .......x.......x
```

*Progressions (scale degrees)* verse: I, I-I-VII-I; chorus: I, I-II

### Trance

*Tempo* 136-140 BPM · *swing* 0% on the 16th grid · *scales* minor, harm · *form* trance · *kits* 909, HOUSE

Four-on-the-floor at 136-140 with a rolling off-beat bass, 16th hats and claps on 2 and 4. Minor keys, epic progressions (i - VI - III - VII), gated 16th arpeggios, supersaw leads and string pads. The long breakdown drops the drums, states the melody, then a snare-roll build lifts into the anthem drop.

```
BD X...X...X...X...
CP ....X.......X...
CH xxxxxxxxxxxxxxxx
OH ..X...X...X...X.
```

*Progressions (scale degrees)* verse: I-VI-III-VII, I-IV-VI-VII; chorus: I-VI-III-VII, VI-VII-I-I; break: VI-IV-I-VII, VI-VII-III-I

### Psytrance

*Tempo* 142-147 BPM · *swing* 0% on the 16th grid · *scales* phryg, harm, minor · *form* club · *kits* 909, HARD

A kick on every beat and a bass on the three 16ths between kicks (the "galloping" psy roll). Phrygian and harmonic minor, almost no chord changes, squelchy acid lines, delays and phasers, constant small sound-design changes.

```
BD X...X...X...X...
CP ....x.......x...
CH ..x...x...x...x.
OH ..x...x...x...x.
RS .x...x...x...x..
```

*Progressions (scale degrees)* verse: I, I-II; chorus: I, I-II-I-VII

### Dubstep

*Tempo* 140-150 BPM (felt in half time) · *swing* 0% on the 16th grid · *scales* minor, phryg, harm · *form* edm · *kits* HARD, 909, TRAP

140 BPM but felt at 70: kick on 1, snare on 3 (half-time), sparse hats. The drop is the bass: a sub underneath and a mid-range wobble or growl whose LFO rate changes in time (1/4, 1/8, 1/8 triplets, 1/16), talking formants, call-and-response between bass sounds, silence for impact. Minor or Phrygian, very few chords. Intro and breakdown are atmospheric pads; builds use an 8th-note snare roll and a riser, then a beat of silence before the drop.

```
BD X.........X.....
SD ........X.......
CP ........X.......
CH x.x.x.x.x.x.x.x.
OH ..............x.
LT ..............x.
```

*Progressions (scale degrees)* verse: I-I-VI-VII, I-II; chorus: I-I-I-I, I-I-VI-VII; break: VI-IV-I-VII, I-VI-III-VII

### Riddim

*Tempo* 140-150 BPM (felt in half time) · *swing* 0% on the 16th grid · *scales* minor, phryg · *form* edm · *kits* HARD, TRAP

Minimal, repetitive dubstep: one note, triplet wobbles, a lot of space, the same bass phrase answered with small variations.

```
BD X.....x...X.....
SD ........X.......
CP ........X.......
CH ..x...x...x...x.
```

*Progressions (scale degrees)* verse: I; chorus: I

### Drum and bass

*Tempo* 170-176 BPM · *swing* 0% on the 16th grid · *scales* minor, dorian · *form* edm · *kits* ACOUSTIC, 909, BOOMBAP

170-176 BPM two-step: kick on 1 and the "and" of 3, snares on 2 and 4, ghost notes, often a chopped breakbeat layered on top. Long reese basses (detuned saws with a moving filter) or deep subs; liquid DnB adds lush 7th and 9th chords and soulful vocals, neurofunk swaps them for aggressive mid-range basses.

```
BD X.........X.....
SD ....X.......X...
CH x.x.x.x.x.x.x.x.
OH ......x.........
RS .......x......x.
```

*Progressions (scale degrees)* verse: I-VI-III-VII, I-IV; chorus: I-VI-III-VII, VI-IV-I-V

### Jungle

*Tempo* 160-170 BPM · *swing* 0% on the 16th grid · *scales* minor, dorian · *form* edm · *kits* ACOUSTIC, BOOMBAP

Chopped and re-sequenced breakbeats at 160-170, huge sub bass moving at half the speed of the drums, reggae and dub DNA (organ skanks, echo throws), rewinds and stutters.

```
BD X.........X.....
SD ....X.......X...
```

*Progressions (scale degrees)* verse: I-VII, I-IV; chorus: I-VI-VII-I, I-VII

### UK garage / 2-step

*Tempo* 130-135 BPM · *swing* 30% on the 16th grid · *scales* minor, dorian · *form* club · *kits* HOUSE, 909

Skippy, heavily swung 2-step: the kick skips beat 3 (it lands on 1 and the "and" of 3), snares on 2 and 4, shuffled hats and rim shots. Organ and electric-piano stabs with 7th and 9th chords, chopped and pitched vocals, a sub bass that bounces with the kick.

```
BD X......x..X.....
SD ....X.......X...
CP ....x.......x...
CH ..x...x...x...x.
RS .x.....x...x...x
CB x.xx.x.xx.xx.x.x
```

*Progressions (scale degrees)* verse: I-IV-VII-III, I-VI-IV-V; chorus: I-IV-VII-III, II-V-I-VI

### Future bass

*Tempo* 140-160 BPM (felt in half time) · *swing* 0% on the 16th grid · *scales* major · *form* edm · *kits* TRAP, 909

Half-time trap drums at 140-160, but the star is the chords: big major-key 7th and 9th voicings (IV - V - iii - vi) played as rhythmic stabs and swelled with heavy sidechain, plus pitched vocal chops and bright leads. Emotional, bright, wide.

```
BD X......x..x.....
CP ........X.......
CH x.x.x.x.x.x.xxx.
```

*Progressions (scale degrees)* verse: IV-V-III-VI, VI-IV-I-V; chorus: IV-V-III-VI, IV-V-VI-VI

### Hardstyle

*Tempo* 150-158 BPM · *swing* 0% on the 16th grid · *scales* minor, harm · *form* edm · *kits* HARD

A distorted, pitched kick on every beat at 150-158 (the kick is the bass; the "reverse bass" fills the off-beats), screeching leads, epic minor melodies and huge reverbs. Long cinematic breakdowns, then the kick returns.

```
BD X...X...X...X...
CP ....X.......X...
CH ..x...x...x...x.
OH ..x...x...x...x.
```

*Progressions (scale degrees)* verse: I-VI-III-VII, VI-VII-I-I; chorus: I-VI-III-VII, VI-VII-I-V

### Big room / festival

*Tempo* 126-130 BPM · *swing* 0% on the 16th grid · *scales* minor · *form* edm · *kits* HOUSE, HARD, 909

Festival EDM: a pounding kick, long snare-roll builds with risers, a moment of silence, then a short, punchy lead riff over the kick. Simple minor progressions; the drop is mostly rhythm and sound.

```
BD X...X...X...X...
CP ....X.......X...
CH ..x...x...x...x.
OH ..x...x...x...x.
```

*Progressions (scale degrees)* verse: I-VI-III-VII; chorus: I-I-I-I, I-VI-III-VII

### Synthwave

*Tempo* 84-112 BPM · *swing* 0% on the 16th grid · *scales* minor, dorian · *form* verse-chorus · *kits* ACOUSTIC, 909, 808

1980s film-score pop on synthesizers: driving 8th-note bass, big gated snares on 2 and 4, lush chorus-drenched pads, i - VI - III - VII progressions, and analog brass and arpeggios.

```
BD X.......X.x.....
SD ....X.......X...
CH x.x.x.x.x.x.x.x.
```

*Progressions (scale degrees)* verse: I-VI-III-VII, I-VI-IV-V; chorus: VI-IV-I-V, I-VI-III-VII

### Electro

*Tempo* 118-130 BPM · *swing* 6% on the 16th grid · *scales* minor, phryg · *form* club · *kits* 808

Robotic 808 funk: syncopated 808 kicks, snare and clap on 2 and 4, machine-gun 16th hats, a funky syncopated synth bass, vocoder-like voices and sci-fi stabs.

```
BD X......X..X.....
SD ....X.......X...
CP ....x.......x...
CH xxxxxxxxxxxxxxxx
RS ...x......x.....
```

*Progressions (scale degrees)* verse: I, I-VII; chorus: I-VII-VI-VII

### Breakbeat / big beat

*Tempo* 125-140 BPM · *swing* 6% on the 16th grid · *scales* minor, dorian · *form* club · *kits* ACOUSTIC, BOOMBAP

Sampled funk breakbeats (not four-on-the-floor) at 125-140, fat distorted basslines, stabs and acid lines, big builds.

```
BD X.x.......X.....
SD ....X.......X...
CH x.x.x.x.x.x.x.x.
```

*Progressions (scale degrees)* verse: I-VII, I-IV; chorus: I-VII-VI-VII

### Footwork / juke

*Tempo* 158-162 BPM (felt in half time) · *swing* 0% on the 16th grid · *scales* minor, dorian · *form* club · *kits* 808, TRAP

160 BPM, triplet-feel 808 kick patterns and toms, very sparse snares, stuttered repeating vocal chops, soul and jazz chords underneath.

```
BD X..x..x...x..x..
CP ........x.......
CH x.x.x.x.x.x.x.x.
LT ...x......x...x.
```

*Progressions (scale degrees)* verse: I-IV, I; chorus: I-VI-IV-V

### Moombahton

*Tempo* 106-112 BPM · *swing* 4% on the 16th grid · *scales* minor · *form* edm · *kits* HOUSE, TRAP

House sounds slowed to 108-112 over a reggaeton dembow beat: four kicks, snares on the dembow off-beats, a big distorted bass and festival stabs.

```
BD X...X...X...X...
SD ...x..x....x..x.
CH x.x.x.x.x.x.x.x.
RS ...x..x....x..x.
```

*Progressions (scale degrees)* verse: I-VI-III-VII; chorus: I-IV-VI-V

### Downtempo / trip hop

*Tempo* 76-96 BPM · *swing* 22% on the 16th grid · *scales* minor, dorian, harm · *form* verse-chorus · *kits* BOOMBAP, ACOUSTIC

Slow, heavy, swung hip-hop drums under cinematic minor harmony: strings, Rhodes, dub bass, vinyl crackle, spacious reverbs and delays, haunting vocals.

```
BD X......x..X.....
SD ....X.......X...
CH x.x.x.x.x.x.x.x.
```

*Progressions (scale degrees)* verse: I-IV, I-VI-IV-V; chorus: VI-IV-I-V, I-IV-VII-III

## Beyond EDM

### Hip hop (boom bap)

*Tempo* 84-96 BPM · *swing* 50% on the 16th grid · *scales* minor, dorian · *form* hiphop · *kits* BOOMBAP, ACOUSTIC

Sample-based 1990s hip hop: hard kick ("boom") and snare ("bap") on 2 and 4, MPC-style swing on the 16ths (56-62%), a chopped jazz or soul loop (7th and 9th chords on Rhodes or piano), a walking or riffing bass, vinyl crackle and 12-bit grit. Form: 16-bar verses and 8-bar hooks.

```
BD X......x..X.....
SD ....X.......X...
CH x.x.x.x.x.x.x.x.
RS ..........x....x
```

*Progressions (scale degrees)* verse: I-IV, I-I-VI-VI; chorus: VI-IV-I-V, I-IV-VII-III

### Trap

*Tempo* 130-150 BPM (felt in half time) · *swing* 0% on the 16th grid · *scales* minor, harm, phryg · *form* hiphop · *kits* TRAP, 808

Half-time at 130-150 (felt at 65-75): sparse 808 kicks, a snare or clap on beat 3, 16th hats with 32nd and triplet rolls. The 808 is the bass: long, tuned, gliding between notes. Dark minor, harmonic minor or Phrygian melodies on bells-free plucks, flutes, pianos, choirs and strings, often a one- or two-chord loop.

```
BD X......x..x.....
CP ........X.......
CH x.x.x.x.x.xxx.x.
RS .......x......x.
```

*Progressions (scale degrees)* verse: I-VI, I-II; chorus: I-VI-VII-V, VI-IV-I-V

### Drill

*Tempo* 138-145 BPM (felt in half time) · *swing* 8% on the 16th grid · *scales* harm, minor, phryg · *form* hiphop · *kits* TRAP

Dark, sliding 808s that glide between notes, a snare on beat 3 plus a late off-beat snare, triplet and syncopated hats, harmonic-minor piano and choir melodies.

```
BD X.........x.....
CP ........X.....x.
CH x..x..x.x.x..x.x
```

*Progressions (scale degrees)* verse: I-VI, I-II; chorus: I-VI-VII-V

### Lo-fi hip hop

*Tempo* 70-88 BPM · *swing* 55% on the 16th grid · *scales* major, dorian · *form* hiphop · *kits* BOOMBAP, JAZZ

Laid-back, swung (drunk) boom-bap at 70-88, jazzy ii - V - I and IV - iii - ii - I progressions with major 7th and 9th chords on electric piano or guitar, warm upright bass, tape wobble, vinyl crackle and rain, a soft, filtered top end.

```
BD X......x..x.....
SD ....X.......X...
CH x.x.x.x.x.x.x.x.
RS ......x.......x.
```

*Progressions (scale degrees)* verse: II-V-I-VI, IV-III-II-I; chorus: IV-III-II-I, II-V-I-VI

### Jazz (swing)

*Tempo* 120-180 BPM · *swing* 50% on the 8th grid · *scales* major, dorian · *form* jazz · *kits* JAZZ

Swung 8ths (close to a triplet feel), ride cymbal "ding, ding-a-ding" with the hi-hat foot on 2 and 4, a walking bass in quarter notes (chord tones on the beat, approach notes into the next chord), piano comping in rootless and shell voicings on Charleston and anticipated rhythms. Harmony moves in ii - V - I cadences and turnarounds (I - vi - ii - V). Form: head (AABA), solos over the form, head again.

```
BD x...x...x...x...
SD ......x.......x.
CH ....x.......x...
OH X...x.x.X...x.x.
```

*Progressions (scale degrees)* verse: II-V-I-VI, III-VI-II-V; bridge: IV-IV-III-VI, V-V-II-V; chorus: II-V-I-VI

### Bossa nova

*Tempo* 120-145 BPM · *swing* 6% on the 16th grid · *scales* major, dorian · *form* aaba · *kits* LATIN, JAZZ

Brazilian samba slowed and softened: a bass on 1 and the dotted "and" of 2, a cross-stick clave-like pattern, a nylon guitar playing syncopated 7th and 9th chords, gentle flute or voice, ii - V movement.

```
BD X..xX..xX..xX..x
CH x.x.x.x.x.x.x.x.
RS x..x..x...x..x..
```

*Progressions (scale degrees)* verse: I-II-V-I, II-V-I-VI; chorus: IV-III-II-V, II-V-I-I

### Funk

*Tempo* 98-116 BPM · *swing* 12% on the 16th grid · *scales* dorian, minor · *form* verse-chorus · *kits* ACOUSTIC, BOOMBAP

Everything on "the one": syncopated 16th grooves, ghost notes on the snare, a slap-style bass with octave jumps, clavinet or guitar chopping 9th chords, horn stabs. Harmony is often a single Dorian vamp (i7 - IV7).

```
BD X.x....x..X.....
SD ....X..x.x..X..x
CH xxXxxxXxxxXxxxXx
OH ..............x.
```

*Progressions (scale degrees)* verse: I, I-IV; chorus: IV-V, I-IV-I-V

### Disco / nu-disco

*Tempo* 112-124 BPM · *swing* 4% on the 16th grid · *scales* minor, dorian, major · *form* pop · *kits* ACOUSTIC, HOUSE

Four-on-the-floor with open hats on the off-beats, octave-jumping bass, chicken-scratch guitar and piano on the off-beats, sweeping strings, 7th chords.

```
BD X...X...X...X...
SD ....X.......X...
CH x.x.x.x.x.x.x.x.
OH ..X...X...X...X.
CB xxxxxxxxxxxxxxxx
```

*Progressions (scale degrees)* verse: I-IV, VI-II-V-I; chorus: I-IV-VII-III, IV-V-III-VI

### Soul / R&B

*Tempo* 68-96 BPM · *swing* 30% on the 16th grid · *scales* major, dorian · *form* pop · *kits* ACOUSTIC, BOOMBAP

Laid-back, swung grooves; extended chords (major 7ths, 9ths, 11ths), IV - iii - ii - I walk-downs and ii - V movement, Rhodes and organ, a melodic bass, a soulful lead voice.

```
BD X......x.x......
SD ....X.......X...
CH x.x.x.x.x.x.x.x.
RS ..x.......x.....
```

*Progressions (scale degrees)* verse: IV-III-II-I, II-V-I-VI; chorus: IV-V-III-VI, II-V-I-VI; bridge: IV-IV-III-VI

### Pop

*Tempo* 100-124 BPM · *swing* 0% on the 16th grid · *scales* major, minor · *form* pop · *kits* ACOUSTIC, HOUSE, 909

Verse, pre-chorus, chorus: the four-chord loop (I - V - vi - IV and its rotations), a singable hook repeated in the chorus in a higher register, claps on 2 and 4, eighth-note bass and piano, a pre-chorus that climbs to V, a final chorus lifted by a key change or extra layers.

```
BD X.......X.x.....
CP ....X.......X...
CH x.x.x.x.x.x.x.x.
```

*Progressions (scale degrees)* verse: I-V-VI-IV, VI-IV-I-V; pre: IV-V-IV-V, II-IV-V-V; chorus: I-V-VI-IV, VI-IV-I-V

### Reggae

*Tempo* 70-90 BPM · *swing* 20% on the 16th grid · *scales* major, minor, dorian · *form* verse-chorus · *kits* ACOUSTIC, JAZZ

The one drop: kick and cross-stick together on beat 3 only, swung hats. The guitar or organ skank plays short chords on the off-beats (2 and 4), the bass is the melody, deep and round with space. Simple I - IV - V harmony; dub mixes drop parts out and throw echoes and reverbs.

```
BD ........X.......
CH x.x.x.x.x.x.x.x.
RS ........X.......
```

*Progressions (scale degrees)* verse: I-IV, I-V-IV-V; chorus: IV-V-I-I, I-IV-V-IV

### Dub

*Tempo* 70-85 BPM · *swing* 18% on the 16th grid · *scales* minor, dorian · *form* through · *kits* ACOUSTIC, HAND

Reggae turned inside out at the mixing desk: heavy bass and drums, parts dropped in and out, tape echoes thrown on single chords and snares, spring reverb.

```
BD ........X.......
CH x.x.x.x.x.x.x.x.
RS ........X.......
```

*Progressions (scale degrees)* verse: I-IV, I; chorus: I-VII

### Reggaeton / dembow

*Tempo* 88-100 BPM · *swing* 0% on the 16th grid · *scales* minor, harm · *form* pop · *kits* TRAP, HOUSE, LATIN

The dembow: kick on every beat, snare (or rim) on the 3-3-2 off-beats ("boom-ch-boom-chick"), minor-key four-chord loops (i - VI - III - VII), an 808 or synth bass on the kick, plucked chords and catchy vocal hooks.

```
BD X...X...X...X...
SD ...x..x....x..x.
CH x.x.x.x.x.x.x.x.
RS ...x..x....x..x.
CB ..x...x...x...x.
```

*Progressions (scale degrees)* verse: I-VI-III-VII, I-IV-VI-V; chorus: I-VI-III-VII, VI-VII-I-I

### Afrobeats / amapiano

*Tempo* 100-115 BPM · *swing* 12% on the 16th grid · *scales* major, dorian, minor · *form* pop · *kits* HAND, LATIN, ACOUSTIC

A swung, rolling groove at 100-115 built from interlocking percussion (shakers in 16ths, syncopated rims and claps), a kick that skips around beat 3, melodic log-drum or 808 bass, palm-muted guitar or piano chords on syncopated off-beats, warm major or Dorian harmony.

```
BD X..x......X.....
CP ....x.......x...
CH xxxxxxxxxxxxxxxx
RS ..x..x.x..x...x.
CB x.xxx.xxx.xxx.xx
```

*Progressions (scale degrees)* verse: I-IV-VI-V, I-IV; chorus: IV-V-III-VI, I-IV-VI-V

### Gospel

*Tempo* 68-100 BPM · *swing* 40% on the 8th grid · *scales* major · *form* pop · *kits* ACOUSTIC, JAZZ

Organ and piano harmony full of passing chords, IV - I (plagal, "amen") cadences, walk-ups, 9th chords, call-and-response between lead and choir, swung shuffles or slow 12/8 feels, building to a big final chorus.

```
BD X.....x.X.......
SD ....X.......X...
CH x.x.x.x.x.x.x.x.
```

*Progressions (scale degrees)* verse: I-IV-I-V, IV-III-II-I; chorus: IV-V-III-VI, IV-IV-I-I

### Blues

*Tempo* 76-120 BPM · *swing* 50% on the 8th grid · *scales* mixo · *form* blues · *kits* ACOUSTIC, JAZZ

The 12-bar form (I - I - I - I - IV - IV - I - I - V - IV - I - V) with dominant 7th chords (Mixolydian), a shuffle (swung 8ths), a boogie bass walking up and down the chord, call-and-response phrases on harmonica, sax or guitar using the blues scale.

```
BD X.......X.......
SD ....X.......X...
CH x.x.x.x.x.x.x.x.
```

*Progressions (scale degrees)* verse: I-I-I-I-IV-IV-I-I-V-IV-I-V; chorus: I-IV-I-I-IV-IV-I-I-V-IV-I-V

### Rock

*Tempo* 110-150 BPM · *swing* 0% on the 16th grid · *scales* minor, major, mixo · *form* verse-chorus · *kits* ACOUSTIC

A backbeat (snare on 2 and 4) with driving 8th-note hats, distorted power chords (root and fifth) strummed in 8ths, a root-note 8th bass, bVII and bVI borrowed chords (i - bVII - bVI), riffs, verse-chorus form with a big final chorus.

```
BD X.....x.X.x.....
SD ....X.......X...
CH x.x.x.x.x.x.x.x.
```

*Progressions (scale degrees)* verse: I-VII-VI-VII, I-IV-V-IV; chorus: I-VII-IV-I, VI-IV-I-V

### Cinematic / orchestral

*Tempo* 70-100 BPM · *swing* 0% on the 16th grid · *scales* minor, harm, dorian · *form* through · *kits* HAND, ACOUSTIC

Strings, choir and brass in open voicings, ostinatos in the cellos, taiko-like low toms, minor-key progressions with modal mixture (i - VI - III - VII, VI - VII - i), slow builds, impacts and risers, huge halls.

```
BD X.......X..x....
LT X.....x.X.......
HT ..........x.x...
```

*Progressions (scale degrees)* verse: I-VI-III-VII, I-IV-VI-V; chorus: VI-VII-I-I, I-VI-IV-V

## Sources

General and EDM:
* Wikipedia, "Dubstep" and "Brostep": half time at 140, wobble bass, sub weight, drops.
* Native Instruments blog: "How to make dubstep", "Hip hop drums 101", "What is boom bap", "How to make future
  bass", "How to make hardstyle".
* Berklee Online: guide to EDM genres and the dembow rhythm.
* Wikipedia, "UK garage" / "2-step garage" (skippy kicks, shuffled 16ths) and "Dembow".
* MusicRadar: boom bap production and the rolling trance bassline.
* EDMProd: hardstyle kicks, reverse bass and screeches.

Beyond EDM:
* Soundbrenner: what swing is in jazz, and the reggae rhythms (one drop, rockers, steppers).
* LearnJazzStandards: jazz comping rhythms (Charleston and others), shell and rootless voicings, walking bass.
* Standard theory references for the 12-bar blues, the pop four-chord loop, ii-V-I and bossa nova rhythms.

These were read for the rules (tempos, patterns, forms, voicings). No text or audio was copied from them.
