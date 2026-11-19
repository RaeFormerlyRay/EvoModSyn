# PatchMind Modular

A modular synthesizer that runs in the browser, with patch cables you can see, and an AI performer that designs patches and plays live sets. Everything runs on the Web Audio API with no build step and no dependencies.

## Run it

Open `index.html` through any static server, for example:

```
python3 -m http.server 8000
# then open http://localhost:8000
```

Press **Power on** (browsers only allow sound after a click), type an action such as "Design an acid bass patch" or "Play a full 15 minute acid live performance", set the performer's personality, and press **Perform**.

`python3 build.py` inlines everything into `dist/patchmind.html`, a single page that can be published as a Claude artifact.

## Modules

| Module | What it is |
|---|---|
| Pulse | Master clock with tempo and swing (CLK, BEAT, BAR outs) |
| Sequencer A / B | 16-step sequencers: pitch, gate, accent, slide, length, direction (fwd/rev/ping/random/drunk), clock divide, root, scale, octave, transpose, gate length, probability, ratchets |
| Entropy | Noise-driven sequencer: white/pink/brown/chaos noise, a lockable shift register loop, density, range, slewed random CV |
| Rhythm Composer | 808 / 909-style drum synth with 10 voices (BD SD CP CH OH LT HT RS CB CY), 808, 909, Dirt and LoFi kits, a 16-step grid and a trigger input |
| Voice 303 / Voice Poly | Analog-modeling mono voices with 7 models: Acid (303-style), Ladder (Moog-style), Scream (MS-20-style), Jove (Jupiter-8-style), Prophecy (Prophet-5-style poly-mod), SEM (Oberheim-style), Odyssey (ARP-style) |
| Titan | Dual wavetable bass synth for dubstep: 6 morphing tables, unison, sub, 4 filter types, tempo-synced wobble LFO to cutoff and table position, drive and compression |
| Bitbox | 8-bit sound chip voice: pulse 12.5/25/50%, 4-bit triangle, LFSR noise, arpeggios, vibrato, bit crushing, stepped volume envelopes |
| Bodies | Physical modeling: Karplus-Strong string and tube, modal bell, marimba, membrane and glass |
| Geiger | Geiger counter with real decay statistics (Poisson process), sources from background radiation to a reactor core, burst clustering, click audio, trigger and count-rate CV outs |
| Slope, Wavefold, VCF-Q | Serge-inspired rise/fall function generator, sine wavefolder and variable-Q filter |
| Mix Desk | 8 channels with sends to a tempo-synced tape delay and a plate reverb |
| Monitor | Limiter, scope, spectrum, and the analyser the AI listens through |

Jack colours: silver is audio, orange is CV, green is clock/gate/note events (green only connects to green). Drag from a jack to another jack to patch, drag a plugged input away to unplug, double-click a jack to clear it. Drag knobs up and down (Shift for fine), double-click to reset.

## The AI performer

* **Reads the brief.** The action text sets the genre (acid, dubstep, drum and bass, techno, house, chiptune, ambient, noise, trap, experimental), the mode (design a patch, perform a set of a given length, or tweak what is playing) and the duration. The personality text sets traits such as aggression, chaos, calm, melodic and dark.
* **Patches visibly.** A glowing cursor travels to each jack and knob. Cables are carried across the rack and plugged in, knobs turn smoothly, sequencer steps and drum cells light up as they are written, and the log explains every move.
* **Listens.** Every 200 ms it measures loudness, spectral brightness, low end, rhythmic motion and an overall energy score from the master output, and compares them with its targets.
* **Learns.** It chooses among about 25 moves (filter sweeps, drive, drum mutes and fills, sequence mutations, wobble rate changes, modulation patches, layering voices in and out, delay throws and more), scores each one by how much closer it moved the sound to the target, and keeps a running value per move. Those values are saved in the browser and shown in the console, so it gets better at your rack over time.
* **Performs.** For a set it builds an energy arc (intro, build, drop, break, build, peak, outro) across the requested length and keeps shaping the sound until the end, then fades out.
* **Claude brain (optional).** When the page is opened as a Claude artifact, "Claude plans" sends the brief, the module catalogue and the current patch to Claude, which returns the patch design and the set's sections as actions. The built-in performer then executes them and keeps listening and adjusting.
