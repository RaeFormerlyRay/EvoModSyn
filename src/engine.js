// engine.js — audio context, clock scheduler, module base class, params and patch cables.
'use strict';
const Engine = (() => {
  const AC = window.AudioContext || window.webkitAudioContext;
  const ctx = new AC({ latencyHint: 'interactive' });
  const E = {
    ctx, bpm: 126, swing: 0, running: false,
    noise: null, uiq: [], listeners: { change: [] }, step: 0, nextTime: 0
  };
  // ---------- Layers ----------
  // Two independent modular systems (Layer A and Layer B), each with its own modules, cables, chords and master
  // bus. E.mods / E.order / E.cables / E.harmony always mean the layer in context (E.L). E.V is the layer on
  // screen, which is also the one the hands work on. E.within(L, fn) runs fn with layer L in context.
  E.out = ctx.createGain(); E.out.connect(ctx.destination);
  E.outAn = ctx.createAnalyser(); E.outAn.fftSize = 2048; E.outAn.smoothingTimeConstant = 0.6; E.out.connect(E.outAn);
  // Each layer has a master bus and a silent sink. Every analyser (meters, displays, CV readers) also feeds its
  // layer's sink, so a layer's whole audio graph hangs off its bus. A layer that has been faded all the way out
  // goes to sleep: its bus is unplugged from the output and the browser stops computing any of its audio.
  const mkLayer = i => { const bus = ctx.createGain(), sink = ctx.createGain(); bus.gain.value = i ? 0 : 1; sink.gain.value = 0; sink.connect(bus); if (!i) bus.connect(E.out);
    return { i, name: 'AB'[i], mods: {}, order: [], cables: [], harmony: [], bus, sink, level: i ? 0 : 1, awake: !i, sleepT: 0 }; };
  E.layers = [mkLayer(0), mkLayer(1)]; E.L = 0; E.V = 0;
  { const ca = ctx.createAnalyser.bind(ctx); ctx.createAnalyser = (...a) => { const n = ca(...a); if (E._collect) n.connect(E.layers[E.L].sink); return n; }; } // only analysers inside modules (never one on the master)
  E.wakeLayer = L => { const Ly = E.layers[L]; clearTimeout(Ly.sleepT); if (!Ly.awake) { Ly.bus.connect(E.out); Ly.awake = true; E.fire('layersleep', { L, asleep: false }); } };
  const sleepLater = (L, ms) => { const Ly = E.layers[L]; clearTimeout(Ly.sleepT);
    Ly.sleepT = setTimeout(() => { if (Ly.level < 1e-4 && Ly.awake) { Ly.bus.disconnect(); Ly.awake = false; E.fire('layersleep', { L, asleep: true }); } }, ms); };
  ['mods', 'order', 'cables', 'harmony'].forEach(k => Object.defineProperty(E, k, { get: () => E.layers[E.L][k], set: v => { E.layers[E.L][k] = v; } }));
  E.within = (L, fn) => { const o = E.L; E.L = L; try { return fn(); } finally { E.L = o; } };
  E.hasLayer = L => E.layers[L].order.length > 0;
  E.layerName = L => 'Layer ' + 'AB'[L];
  // fade a layer's master bus to `to` over `sec` seconds, starting at audio time `at` (default now)
  E.fadeLayer = (L, to, sec = 0.05, at) => {
    const g = E.layers[L].bus.gain, now = ctx.currentTime, t = Math.max(now, at ?? now);
    if (g.cancelAndHoldAtTime) g.cancelAndHoldAtTime(t); else { g.cancelScheduledValues(t); g.setValueAtTime(g.value, t); }
    if (to > 1e-4) E.wakeLayer(L);
    g.linearRampToValueAtTime(to, t + Math.max(0.01, sec));
    E.layers[L].level = to;
    if (to <= 1e-4) sleepLater(L, (t - now + Math.max(0.01, sec)) * 1000 + 1500);
    E.fire('layerfade', { L, to, sec, at: t });
  };
  // Record every source node a module starts while it is being built, so the module can be removed cleanly later
  E._collect = null;
  ['createOscillator', 'createConstantSource', 'createBufferSource'].forEach(name => {
    const orig = ctx[name].bind(ctx);
    ctx[name] = (...a) => { const n = orig(...a); if (E._collect) E._collect.push(n); return n; };
  });
  E.noise = DSP.noiseBuffer(ctx, 2);
  E.lfsr = DSP.lfsrBuffer(ctx, false);
  E.lfsrShort = DSP.lfsrBuffer(ctx, true);

  E.on = (ev, fn) => (E.listeners[ev] = E.listeners[ev] || []).push(fn);
  E.fire = (ev, d) => (E.listeners[ev] || []).forEach(f => f(d));
  // Run fn when the audio clock reaches time t (for playheads, LEDs)
  E.at = (t, fn) => E.uiq.push({ t, fn });
  E.flushUI = () => {
    const now = ctx.currentTime;
    if (!E.uiq.length) return;
    const keep = [];
    for (const q of E.uiq) { if (q.t <= now) { try { q.fn(); } catch (e) { console.error(e); } } else keep.push(q); }
    E.uiq = keep.length > 400 ? keep.slice(-400) : keep;
  };
  E.sixteenth = () => 60 / E.bpm / 4;

  // ---------- Params ----------
  class Param {
    constructor(mod, key, o) {
      Object.assign(this, { mod, key, label: o.label || key.toUpperCase(), min: o.min ?? 0, max: o.max ?? 1, curve: o.curve || 'lin',
        steps: o.steps || null, unit: o.unit || '', fmt: o.fmt || null, apply: o.apply || null, color: o.color || null, small: !!o.small });
      this.n = 0; this.listeners = [];
      // modulation (a cable dropped on the knob): an offset in knob units added on top of where the knob sits
      this.mod = 0; this.modDepth = 0.3; this.canMod = o.mod ?? (!o.nomod && !this.steps);
      let n = DSP.clamp(o.def != null ? o.def : 0.5);
      if (this.steps) n = Math.round(n * (this.steps.length - 1)) / Math.max(1, this.steps.length - 1);
      this.n = this.defN = n;
    }
    get nm() { return this.mod ? DSP.clamp(this.n + this.mod) : this.n; } // where the knob is, with modulation
    get value() {
      const n = this.nm;
      if (this.steps) return Math.round(n * (this.steps.length - 1));
      if (this.curve === 'exp') return this.min * Math.pow(this.max / this.min, n);
      return this.min + (this.max - this.min) * n;
    }
    get choice() { return this.steps ? this.steps[this.value] : null; }
    normOf(choice) {
      if (!this.steps) return null;
      const i = this.steps.findIndex(s => String(s).toUpperCase() === String(choice).toUpperCase());
      return i < 0 ? null : i / Math.max(1, this.steps.length - 1);
    }
    display() {
      if (this.steps) return String(this.choice);
      if (this.fmt) return this.fmt(this.value);
      const v = this.value;
      const s = Math.abs(v) >= 1000 ? (v / 1000).toFixed(1) + 'k' : Math.abs(v) >= 100 ? v.toFixed(0) : Math.abs(v) >= 10 ? v.toFixed(1) : v.toFixed(2);
      return s + this.unit;
    }
    setNorm(n, silent) {
      n = DSP.clamp(n);
      if (this.steps) n = Math.round(n * (this.steps.length - 1)) / Math.max(1, this.steps.length - 1);
      const changed = n !== this.n; this.n = n;
      if (this.apply && (changed || silent)) { try { this.apply(this.value, this); } catch (e) { console.error(e); } }
      if (!silent || changed) this.listeners.forEach(f => f(this));
    }
  }
  E.Param = Param;

  // ---------- Modules ----------
  class Module {
    constructor(id, o) {
      this.id = id; this.name = o.name; this.sub = o.sub || ''; this.width = o.width || 240; this.stripe = o.stripe || '#888';
      this.family = o.family || ''; this.params = {}; this.ins = {}; this.outs = {}; this.paramOrder = [];
    }
    p(key, o) { const pr = new Param(this, key, o); this.params[key] = pr; this.paramOrder.push(key); return pr; }
    v(key) { return this.params[key].value; }
    // audio input: cables connect into node
    inAudio(name, node, desc) { this.ins[name] = { kind: 'sig', jt: 'audio', node, desc }; }
    // CV input: a scaling gain feeding one or more AudioParams
    inCV(name, targets, scale, desc) {
      const g = ctx.createGain(); g.gain.value = scale;
      (Array.isArray(targets) ? targets : [targets]).forEach(t => g.connect(t));
      this.ins[name] = { kind: 'sig', jt: 'cv', node: g, desc };
      return g;
    }
    inEvent(name, handler, desc) { this.ins[name] = { kind: 'ev', jt: 'ev', handler: handler.bind(this), desc }; }
    outAudio(name, node, desc, cv) { this.outs[name] = { kind: 'sig', jt: cv ? 'cv' : 'audio', node, desc }; }
    outEvent(name, desc) { this.outs[name] = { kind: 'ev', jt: 'ev', targets: [], desc }; }
    emit(name, ev) { const o = this.outs[name]; if (o) for (const t of o.targets) t.handler(ev); }
    tick() {} // called every scheduler pass: (from, to)
  }
  E.Module = Module;

  // Build a module and remember the sources it started
  E.build = (fn) => { E._collect = []; let m; try { m = fn(); } finally { m && (m._srcs = E._collect); E._collect = null; } return m; };
  E.newId = (prefix, reserved) => { for (let i = 2; ; i++) { const id = prefix + i; if (!E.mods[id] && !(reserved && reserved.has(id))) return id; } };
  E.remove = (id) => {
    const m = E.mods[id]; if (!m) return false;
    E.cables.filter(c => c.from.mod === id || c.to.mod === id).forEach(c => E.disconnect(c));
    for (const s of m._srcs || []) { try { s.stop(); } catch (e) { /* not started */ } try { s.disconnect(); } catch (e) { /* none */ } }
    if (m.lfo) { try { m.lfo.stop(); } catch (e) { /* stopped */ } }
    for (const o of Object.values(m.outs)) if (o.node) { try { o.node.disconnect(); } catch (e) { /* none */ } }
    m.disposed = true; m.ui = null;
    delete E.mods[id]; E.order = E.order.filter(x => x !== id);
    E.fire('modules', { type: 'remove', id });
    return true;
  };
  E.add = (mod) => {
    mod.layer = E.L; E.mods[mod.id] = mod; E.order.push(mod.id);
    for (const k of mod.paramOrder) { const p = mod.params[k]; if (p.apply) { try { p.apply(p.value, p); } catch (e) { console.error(mod.id, k, e); } } }
    return mod;
  };

  // ---------- Cables ----------
  const COLORS = ['#e8453c', '#f2b632', '#3e8ef0', '#45c46a', '#ef7d2e', '#a46ff0', '#e9e6dc', '#ff5fa2', '#2fd0c0'];
  let colorIx = 0;
  // ---------- Knob modulation ----------
  // Any continuous knob can take a cable on its own (Massive-style): the cable lands on input "@key", whose gain is
  // the modulation depth. The signal is read ~40 times a second and added on top of where the knob sits.
  E.modIn = (id, key) => {
    const m = E.mods[id], p = m?.params[key]; if (!p || !p.canMod) return null;
    const name = '@' + key;
    if (!m.ins[name]) {
      const g = ctx.createGain(), an = ctx.createAnalyser(); g.gain.value = p.modDepth; an.fftSize = 32;
      g.connect(an); an.connect(E.layers[E.L].sink); // reaches the speakers through its layer's sink
      m.ins[name] = { kind: 'sig', jt: 'cv', node: g, an, buf: new Float32Array(32), key, knob: true, desc: `modulates ${p.label}` };
    }
    return m.ins[name];
  };
  E.setModDepth = (id, key, d) => {
    const m = E.mods[id], p = m?.params[key]; if (!p) return;
    p.modDepth = DSP.clamp(d, -1, 1); const i = m.ins['@' + key]; if (i) i.node.gain.setTargetAtTime(p.modDepth, ctx.currentTime, 0.03);
    E.fire('moddepth', { id, key, d: p.modDepth });
  };
  E.isModPort = port => port && port[0] === '@';
  function modPass() {
    for (const Ly of E.layers) for (const c of Ly.cables) {
      if (c.to.port[0] !== '@') continue;
      const m = Ly.mods[c.to.mod], i = m?.ins[c.to.port]; if (!i) continue;
      i.an.getFloatTimeDomainData(i.buf);
      let v = i.buf[31]; if (!(v === v)) v = 0; v = Math.max(-1.5, Math.min(1.5, v));
      const p = m.params[i.key]; p.mod = v;
      if (Math.abs(v - (p._am ?? 0)) > 0.0015 && p.apply) { p._am = v; E.within(Ly.i, () => { try { p.apply(p.value, p); } catch (e) { /* ignore */ } }); }
    }
  }
  E.findCable = (toMod, toPort) => E.cables.find(c => c.to.mod === toMod && c.to.port === toPort);
  E.canConnect = (from, to) => {
    const o = E.mods[from.mod]?.outs[from.port], i = E.mods[to.mod]?.ins[to.port] || (E.isModPort(to.port) && E.modIn(to.mod, to.port.slice(1)));
    if (!o || !i) return false;
    if (i.knob && from.mod === to.mod) return false;
    return (o.kind === 'ev') === (i.kind === 'ev');
  };
  E.connect = (from, to, opt = {}) => {
    if (!E.canConnect(from, to)) return null;
    const old = E.findCable(to.mod, to.port); if (old) E.disconnect(old);
    const o = E.mods[from.mod].outs[from.port], i = E.mods[to.mod].ins[to.port];
    if (o.kind === 'ev') o.targets.push(i); else o.node.connect(i.node);
    const c = { id: 'c' + Math.random().toString(36).slice(2, 8), from: { ...from }, to: { ...to }, color: opt.color || COLORS[colorIx++ % COLORS.length], born: performance.now() };
    E.cables.push(c);
    E.fire('change', { type: 'connect', cable: c, ai: opt.ai });
    return c;
  };
  E.disconnect = (c, opt = {}) => {
    const o = E.mods[c.from.mod].outs[c.from.port], i = E.mods[c.to.mod].ins[c.to.port];
    if (o.kind === 'ev') o.targets = o.targets.filter(t => t !== i);
    else { try { o.node.disconnect(i.node); } catch (e) { /* already gone */ } }
    if (i.knob) { const p = E.mods[c.to.mod].params[i.key]; p.mod = 0; p._am = 0; try { p.apply?.(p.value, p); } catch (e) { /* ignore */ } p.listeners.forEach(f => f(p)); }
    E.cables = E.cables.filter(x => x !== c);
    E.fire('change', { type: 'disconnect', cable: c, ai: opt.ai });
  };
  E.clearCables = () => [...E.cables].forEach(c => E.disconnect(c));
  E.cablesFrom = (mod, port) => E.cables.filter(c => c.from.mod === mod && (!port || c.from.port === port));

  // ---------- Song harmony ----------
  // Segments of chord roots (scale degrees) laid on the 16th-note grid. Sequencers set to follow the song add the
  // current chord root to every note, so one pattern moves through the progression diatonically.
  E.harmony = [];
  E.setHarmony = (start, chords, barsPer = 1) => { E.harmony = E.harmony.filter(h => h.start < start).slice(-3); E.harmony.push({ start, chords: chords.slice(), barsPer }); E.fire('harmony', E.harmony[E.harmony.length - 1]); };
  E.chordAt = step => {
    let h = null; for (const s of E.harmony) if (s.start <= step) h = s;
    if (!h || !h.chords.length) return 0;
    const i = Math.floor((step - h.start) / (16 * h.barsPer)), n = h.chords.length;
    return h.chords[((i % n) + n) % n];
  };
  // ---------- Scheduler ----------
  const LOOK = 0.14;
  function pass() {
    const now = ctx.currentTime;
    const horizon = now + LOOK;
    if (E.running) {
      if (E.nextTime < now - 0.2) E.nextTime = now + 0.02;
      while (E.nextTime < horizon) {
        const t = E.nextTime, dur = E.sixteenth();
        // swing: 16TH delays every other 16th; 8TH (jazz, hip hop shuffle) delays the off-beat 8th toward a triplet feel
        const sw = E.swingGrid === '8TH' ? [0, 0.6, 1.2, 0.6][E.step % 4] * E.swing * dur : (E.step % 2 === 1) ? E.swing * dur * 0.5 : 0;
        // both layers run on the same transport so they stay in time and can crossfade on the beat
        for (const Ly of E.layers) { const clock = Ly.mods.clock; if (clock) E.within(Ly.i, () => clock.emitTick(t + sw, E.step, dur)); }
        E.step++;
        E.nextTime += dur;
      }
    }
    for (const Ly of E.layers) {
      if (!Ly.order.length) continue;
      E.within(Ly.i, () => { for (const id of Ly.order) { const m = Ly.mods[id]; if (!m) continue; if (m.tick !== Module.prototype.tick) m.tick(now, horizon); } });
    }
  }
  // setInterval keeps running when the tab is hidden (throttled), rAF does not
  setInterval(() => { pass(); modPass(); }, 25);
  E.start = () => { if (E.running) return; E.running = true; E.step = 0; E.layers.forEach(Ly => { Ly.harmony = []; }); E.nextTime = ctx.currentTime + 0.06; E.fire('transport', true); };
  E.stop = () => { if (!E.running) return; E.running = false; E.fire('transport', false); };
  E.setBpm = (b) => { E.bpm = DSP.clamp(b, 40, 220); E.fire('bpm', E.bpm); };
  return E;
})();
