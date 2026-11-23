// engine.js — audio context, clock scheduler, module base class, params and patch cables.
'use strict';
const Engine = (() => {
  const AC = window.AudioContext || window.webkitAudioContext;
  const ctx = new AC({ latencyHint: 'interactive' });
  const E = {
    ctx, bpm: 126, swing: 0, running: false, mods: {}, order: [], cables: [],
    noise: null, uiq: [], listeners: { change: [] }, step: 0, nextTime: 0
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
      let n = DSP.clamp(o.def != null ? o.def : 0.5);
      if (this.steps) n = Math.round(n * (this.steps.length - 1)) / Math.max(1, this.steps.length - 1);
      this.n = this.defN = n;
    }
    get value() {
      if (this.steps) return Math.round(this.n * (this.steps.length - 1));
      if (this.curve === 'exp') return this.min * Math.pow(this.max / this.min, this.n);
      return this.min + (this.max - this.min) * this.n;
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
    E.mods[mod.id] = mod; E.order.push(mod.id);
    for (const k of mod.paramOrder) { const p = mod.params[k]; if (p.apply) { try { p.apply(p.value, p); } catch (e) { console.error(mod.id, k, e); } } }
    return mod;
  };

  // ---------- Cables ----------
  const COLORS = ['#e8453c', '#f2b632', '#3e8ef0', '#45c46a', '#ef7d2e', '#a46ff0', '#e9e6dc', '#ff5fa2', '#2fd0c0'];
  let colorIx = 0;
  E.findCable = (toMod, toPort) => E.cables.find(c => c.to.mod === toMod && c.to.port === toPort);
  E.canConnect = (from, to) => {
    const o = E.mods[from.mod]?.outs[from.port], i = E.mods[to.mod]?.ins[to.port];
    if (!o || !i) return false;
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
        const sw = (E.step % 2 === 1) ? E.swing * dur * 0.5 : 0;
        const clock = E.mods.clock;
        if (clock) clock.emitTick(t + sw, E.step, dur);
        E.step++;
        E.nextTime += dur;
      }
    }
    for (const id of E.order) { const m = E.mods[id]; if (!m) continue; if (m.tick !== Module.prototype.tick) m.tick(now, horizon); }
  }
  // setInterval keeps running when the tab is hidden (throttled), rAF does not
  setInterval(pass, 25);
  E.start = () => { if (E.running) return; E.running = true; E.step = 0; E.harmony = []; E.nextTime = ctx.currentTime + 0.06; E.fire('transport', true); };
  E.stop = () => { if (!E.running) return; E.running = false; E.fire('transport', false); };
  E.setBpm = (b) => { E.bpm = DSP.clamp(b, 40, 220); E.fire('bpm', E.bpm); };
  return E;
})();
