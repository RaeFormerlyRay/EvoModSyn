# What modular musicians want: module wishlist for PatchMind

First research pass, 23 November 2026. Updated daily by the research digest (see `research-regimen.md`).

## How this was researched

| Source | What it tells us | Read |
|---|---|---|
| ModularGrid "Popular modules in racks", last 12 months (top 100) | What people are actually planning to buy right now | Yes |
| ModularGrid top user-rated modules (30+ ratings) | What owners still love after living with it | Yes |
| ModularGrid forum, newest threads (2 pages) | What people ask for when their rack feels incomplete | Yes |
| Superbooth 2026 coverage (Perfect Circuit, Milk Audio, Sean Kim) | Where manufacturers think the market is going | Yes |
| Synth Anatomy and MatrixSynth new-module feeds (Oct to Nov 2026) | The newest releases, week by week | Yes |
| VCV Rack community "most used / desert island" threads and r/vcvrack | What software-modular users reach for, the closest audience to this app | Yes |
| Buyer's guides (Consordini July 2026, Slint Oct 2026) | Consensus "essential" picks | Yes |
| ModWiggler, Juno Daily | Refused automated reading | No. The daily regimen retries them through search snippets |

Caveats: ModularGrid counts are rack plans, not sales. Some forum pages were only partly readable. Counts below are approximate.

## What PatchMind already covers

Clock, two 16-step sequencers, a noise sequencer (Entropy), an 808/909 drum machine, seven analog-modeling voices (303, Moog, MS-20, Jupiter-8, Prophet-5, SEM, ARP), a wavetable dubstep bass (Titan), an 8-bit chip voice, physical modeling (Bodies), a Geiger counter, Serge-style slope, wavefolder and filter, an 8-channel mixer with delay and plate reverb, and a monitor.

That is strong on **voices**. The research shows the gap is in the things modular players buy *after* their voices: **modulation, utilities, texture effects, and smarter sequencing**. Those are also exactly what gives the AI more interesting moves, because they are what turn a synth into a patch.

## The headline findings

1. **Modulation hubs are the most-planned category of the year.** Make Noise MultiMod is the #1 module in racks (about 2,900 racks), ahead of everything else by a wide margin. PoliMATHS, Jumbler, MultiWAVE, Befaco RANDOM8, Vostok Halo and Ferry Island Undertow are all modulation sources. Pamela's Workout (clock plus modulation) is the #2 highest-rated module with 170 ratings, and its predecessor has 392. Maths (586 ratings, 4.76) and DivKid ochd (8 LFOs, 201 ratings) remain fixtures.
2. **Granular and texture effects are #2.** Intellijel Multigrain is the second most-planned module. Behringer Skies (a Clouds clone), Qu-Bit Bloom, Instruo Arbhar, Mutable Beads (now open source), Make Noise Plexiphon and the Superbooth loopers all point the same way.
3. **Drum voices are the hottest release category.** Superbooth 2026 was full of them (Knobula Drum Farm, Modulaire RXR, Polyend Drums), November brought Dreadbox Alecto, Erica Konstrukt-8 and Noise Lab Beat Designer, and the four Erica/Hexinverter Mutant drum modules all sit in the top 50 planned.
4. **Sequencers people rate highest are performance sequencers with song structure:** Metropolix, Westlicht PER|FORMER, Squarp Hermod+, Joranalogue Step 8, OhmForce bohm (three bohm modules in the top 11), Euclidean Circles, Turing Machine. Sequencer questions are also the most common specific ask on the ModularGrid forum.
5. **Utilities quietly dominate ratings.** Mixers (Bartender, Befaco Mixer), attenuators (Atte, 3x MIA), VCAs (A-135-2), logic (Joranalogue Compare 2, Select 2), mutes and mults fill the top-rated list. VCV users say the same: Bogaudio utilities, Impromptu Clocked and Stoermelder tools "appear in nearly every patch."
6. **Buchla and West Coast is the big voice-side gap.** Tiptop's Buchla 242t, 264t, 248t, 230t and 281t all appear in the top 60, and low-pass gates (Natural Gate, Three Sisters, Ferry Island Beacon, Loess Labs LPG) keep showing up. PatchMind has no complex oscillator and no low-pass gate.
7. **Live input and the outside world.** Intellijel MEMS Mic (about 400 racks) and the new Instruo Íre input module show people want to feed real sound into the rack. In a browser this is a microphone input, and it would also give the AI something new to listen to.

## Prioritized wishlist

Priority mixes four things: how strongly the research shows demand, how big the gap is in PatchMind today, how much it gives the AI to do, and how hard it is to build in Web Audio.

### Tier 1: build next

| # | Module (working name) | Inspired by | What it does | Why it ranks here |
|---|---|---|---|---|
| 1 | **Function generator, "Contour"** | Make Noise Maths, PoliMATHS, Joranalogue Contour 1 | Two cycling slopes with rise, fall and curve, end-of-rise and end-of-cycle gates, attenuverting sum/OR outputs, slew mode | The single most-recommended module of the last decade, and it does envelopes, LFOs, slew, delays and logic. One module unlocks dozens of AI moves (bouncing envelopes, portamento, swells) |
| 2 | **Modulation hub, "Swarm"** | MultiMod, ochd, Halo, Undertow | 8 related LFOs from one rate: phase spread, rate spread, shape morph, plus a 4x4 mod matrix to route them | MultiMod is #1 in racks. Gives the AI slow, evolving movement across many knobs at once, which is what makes long performances feel alive |
| 3 | **Clock and gate brain, "Workout"** | Pamela's PRO Workout, Impromptu Clocked | 8 outputs, each with divide/multiply, euclidean fill, probability, swing, phase and a per-output LFO mode | #2 highest-rated module. Lets the AI make polyrhythms and fills without rewriting sequences |
| 4 | **Granular texture, "Grains"** | Multigrain, Clouds/Beads, Arbhar | Records any input into a buffer and replays it as grains: position, size, density, pitch, spray, freeze, feedback, reverb | #2 most planned. Turns any patch into ambient breaks and builds. The AI gets freeze and "smear the drop" moves |
| 5 | **Quantizer and random, "Marbles"** | Mutable Marbles, Turing Machine, RANDOM8, XAOC Skopje | Quantized random voltages with spread, bias, steps (loop lock), jittered clock, plus a 4-channel scale quantizer with chord modes | Generative patching is a top forum ask. Pairs with Entropy so random lines are always in key |
| 6 | **Utility strip** | Atte, A-135-2, Bartender, Compare 2, Select 2, Mutes | Quad VCA/attenuverter, offset, mult, sample and hold, slew limiter, comparator, logic (AND/OR/XOR), crossfader, mute bank | Utilities dominate the ratings. They are what let the AI combine modules into complex patches rather than one-cable patches |

### Tier 2: high value, after Tier 1

| # | Module | Inspired by | What it does | Why |
|---|---|---|---|---|
| 7 | **Complex oscillator** | Buchla 259 / 261, Make Noise DPO, Larix Origami Duo | Two oscillators with through-zero FM, timbre and symmetry folding, modulation oscillator | Fills the West Coast gap. Huge demand for Buchla-style modules |
| 8 | **Low-pass gate** | Buchla 292, Three Sisters, Natural Gate, Beacon | Dual vactrol-modeled LPG with plucky decay | The other half of West Coast. Makes Bodies and the complex oscillator sound "bongo" |
| 9 | **Macro oscillator** | Mutable Plaits, Modulaire D RÊVE, Nanopolis Antigone | One voice with ~16 engines: VA, FM, formant, speech, chords, wavetable, string, modal, drums, noise | Many sounds in one module is ideal for an AI that needs to try things fast |
| 10 | **Individual drum voices** | Hexinverter Mutant series, Knobula Drum Farm, Dreadbox Alecto | Separate kick, snare, hats, clap and FM-perc modules, each with CV inputs on tune, decay, tone, drive | Hottest release category. Separate modules let the AI modulate drums with LFOs and envelopes, which the all-in-one Rhythm Composer cannot |
| 11 | **Topographic drum sequencer** | Mutable Grids, Noise Lab Beat Designer, Euclidean Circles | Drum patterns from a 2D map (x/y), fill density per voice, euclidean mode | The AI can morph grooves smoothly by moving two knobs |
| 12 | **Performance sequencer** | Metropolix, PER|FORMER, Hermod+, bohm | Stage-based pitch/gate with pulse count, accumulators, multiple tracks, pattern chaining and song mode | The most-rated sequencers. (The build thread is already adding song mode; this list is input to that work.) |
| 13 | **Matrix mixer** | Acid Rain Trellis, Feedback Modules The Matrix | 4x4 audio/CV matrix with levels per crosspoint | A Superbooth trend and the classic feedback-patch tool, good for the noise personality |
| 14 | **Texture FX trio** | Plexiphon, Mesa reverb, Verbos BBD delay, Feedback Cross Delay | Shimmer/plate reverb with freeze, BBD-style delay with cross feedback, stereo multi-tap | Effects are the largest category in new releases |
| 15 | **Microphone / line input** | Intellijel MEMS Mic, Instruo Íre | Browser mic input with gain, envelope follower and gate out | Lets the user play into the AI's patch, and gives the AI a new signal to listen and react to |

### Tier 3: worth doing, lower urgency

| # | Module | Inspired by | Notes |
|---|---|---|---|
| 16 | Sampler / slicer | Squarp Rample, Make Noise Morphagene, Music Thing Radio Music | Load or record a sample, slice to steps. Useful once the mic input exists |
| 17 | Vocoder | Behringer VC16 (about 400 racks) | Robot vocals over acid and EDM sets. Web Audio filter banks make this straightforward |
| 18 | 4-operator FM voice | Bogaudio FM-OP, DX7-style | The one classic synthesis family PatchMind lacks |
| 19 | Chord / harmony sequencer | ACL Sinfonion, Hampshire Apollo | Feeds chords to poly voices. Needs a poly voice first |
| 20 | Bus compressor and EQ | 4MS LEQA, Bartender | Mix-glue for long performances; the AI can push "loudness" without the limiter doing all the work |
| 21 | Resonator | Mutable Rings | Partly covered by Bodies; add a sympathetic-string mode to Bodies instead of a new module |
| 22 | Joystick / gesture recorder | Tesseract Compass, Bela Trails, Manifold Cloud Chamber | Lets the user record a gesture the AI can then play back and vary |
| 23 | Chaos generator | Lorenz/Rössler attractors, Hyrlo | Fits the noise-musician personality; small to build |

## What this means for the AI

- Every new module should register its knobs, jacks and "moves" in the AI catalogue (`src/ai.js`, `catalog()`), so the AI can add the module, patch it and learn which moves score well.
- Tier 1 modules mostly produce **modulation**, not sound. The AI today mostly patches audio paths. The biggest jump in patch complexity will come from teaching it to patch modulation sources into many destinations (cutoff, wavefold, grain position, drum decay).
- Personality hooks: "noise musician" should favour the matrix mixer, chaos, Geiger, wavefold and feedback; "ambient" should favour granular, LPG and slow Swarm modulation; "techno" should favour Workout, the drum voices and the topographic sequencer.

## Sources

- ModularGrid, popular modules in racks, last year: https://modulargrid.net/e/modules/modules_mostly_used/lastyear/100
- ModularGrid, top user-rated modules: https://modulargrid.net/e/modules/evaluationlists
- ModularGrid forum: https://modulargrid.net/e/forum/threads/index
- Perfect Circuit, Superbooth 2026 coverage: https://www.perfectcircuit.com/signal/superbooth-2026-coverage
- Milk Audio, best of Superbooth 2026: https://www.milkaudiostore.com/us/articles/promotions/the-10-best-synths-and-modules-from-superbooth-2026/
- Knobula Drum Farm at Superbooth 2026: https://blog.imseankim.com/knobula-drum-farm-eurorack-superbooth-2026/
- Synth Anatomy Eurorack news: https://synthanatomy.com/category/music-tech-news/hardware/eurorack
- MatrixSynth new modules: https://www.matrixsynth.com/search/label/New%20Modules?m=0
- VCV community, most used modules: https://community.vcvrack.com/t/share-your-most-used-modules/15808
- VCV community, top ten: https://community.vcvrack.com/t/your-top-ten-modules/9320?page=2
- VCV community, desert island plugin: https://community.vcvrack.com/t/your-desert-island-plugin/41
- r/vcvrack favourites thread (mirror): https://redlib.astrial.org/r/vcvrack/comments/1iybbvq/must_try_vcv_modules_any_personal_favourites
- Consordini, best Eurorack modules: https://consordini.com/best-eurorack-modules/
- Slint, best sequencer modules: https://slintmusic.com/best-eurorack-sequencer-module/
