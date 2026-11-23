// critic.js — the AI listens back: records a short clip of the master, measures it (key, clashes, roughness,
// mud, harshness, clipping, motion), draws a spectrogram, asks "what works, what doesn't?" (Claude when it is
// available, a built-in critic otherwise) and corrects course.
'use strict';
const Critic = (() => {
  const E = Engine, $ = s => document.querySelector(s), clamp = DSP.clamp;
  const C = { on: true, every: 60, busy: false, last: 0, history: [], clip: null };
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // ======================= RECORD =======================
  function record(sec = 6) {
    const ctx = E.ctx, an = E.outAn, n = Math.floor(ctx.sampleRate * sec);
    const buf = new Float32Array(n); let w = 0;
    const sp = ctx.createScriptProcessor(4096, 1, 1), mute = ctx.createGain(); mute.gain.value = 0;
    an.connect(sp); sp.connect(mute); mute.connect(ctx.destination);
    return new Promise(res => {
      const stop = () => { try { an.disconnect(sp); } catch (e) { /* gone */ } sp.disconnect(); mute.disconnect(); res(buf.subarray(0, w)); };
      sp.onaudioprocess = e => { const d = e.inputBuffer.getChannelData(0), k = Math.min(d.length, n - w); buf.set(d.subarray(0, k), w); w += k; if (w >= n) stop(); };
      setTimeout(stop, sec * 1000 + 1500); // safety if the context stalls
    });
  }
  function wav(pcm, sr) {
    const b = new ArrayBuffer(44 + pcm.length * 2), v = new DataView(b), str = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
    str(0, 'RIFF'); v.setUint32(4, 36 + pcm.length * 2, true); str(8, 'WAVEfmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, sr, true); v.setUint32(28, sr * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); str(36, 'data'); v.setUint32(40, pcm.length * 2, true);
    for (let i = 0; i < pcm.length; i++) v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, pcm[i])) * 32767, true);
    return new Blob([b], { type: 'audio/wav' });
  }

  // ======================= MEASURE =======================
  function fft(re, im) {
    const n = re.length;
    for (let i = 1, j = 0; i < n; i++) { let bit = n >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit; if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; } }
    for (let len = 2; len <= n; len <<= 1) {
      const a = -2 * Math.PI / len, wr = Math.cos(a), wi = Math.sin(a);
      for (let i = 0; i < n; i += len) { let cr = 1, ci = 0; for (let k = 0; k < len / 2; k++) { const p = i + k, q = p + len / 2, tr = re[q] * cr - im[q] * ci, ti = re[q] * ci + im[q] * cr; re[q] = re[p] - tr; im[q] = im[p] - ti; re[p] += tr; im[p] += ti; const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t; } }
    }
  }
  const MAJ = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88], MIN = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];
  const corr = (a, b) => { const ma = a.reduce((s, x) => s + x, 0) / 12, mb = b.reduce((s, x) => s + x, 0) / 12; let n = 0, da = 0, db = 0; for (let i = 0; i < 12; i++) { n += (a[i] - ma) * (b[i] - mb); da += (a[i] - ma) ** 2; db += (b[i] - mb) ** 2; } return n / Math.sqrt(da * db + 1e-12); };
  // Plomp-Levelt roughness between two partials (Sethares' fit)
  const pl = (f1, f2) => { const s = 0.24 / (0.0207 * Math.min(f1, f2) + 18.96), d = Math.abs(f2 - f1); return Math.exp(-3.51 * s * d) - Math.exp(-5.75 * s * d); };

  function measure(pcm, sr) {
    const N = 4096, hop = 2048, frames = [], win = new Float32Array(N).map((_, i) => 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (N - 1)));
    let sq = 0, pk = 0, clip = 0; for (const x of pcm) { sq += x * x; const a = Math.abs(x); if (a > pk) pk = a; if (a > 0.985) clip++; }
    const chroma = new Float64Array(12), band = [0, 0, 0, 0]; let lowmid = 0; let rough = 0, roughW = 0, flat = 0, cent = 0, flux = 0, prev = null, silent = 0, onsets = 0, fluxes = [];
    for (let o = 0; o + N <= pcm.length; o += hop) {
      const re = new Float64Array(N), im = new Float64Array(N); let fe = 0;
      for (let i = 0; i < N; i++) { re[i] = pcm[o + i] * win[i]; fe += pcm[o + i] ** 2; }
      if (fe / N < 1e-7) { silent++; continue; }
      fft(re, im);
      const mag = new Float32Array(N / 2); let num = 0, den = 0, lsum = 0, asum = 0, fx = 0;
      for (let k = 1; k < N / 2; k++) {
        const m = Math.hypot(re[k], im[k]); mag[k] = m; const f = k * sr / N, p = m * m;
        num += f * p; den += p; band[f < 90 ? 0 : f < 300 ? 1 : f < 2500 ? 2 : 3] += p; if (f >= 120 && f < 450) lowmid += p;
        if (k > 2) { lsum += Math.log(m + 1e-9); asum += m; }
        if (prev) fx += Math.max(0, m - prev[k]);
      }
      flat += Math.exp(lsum / (N / 2 - 3)) / (asum / (N / 2 - 3) + 1e-12); cent += num / (den + 1e-12);
      fluxes.push(fx); prev = mag;
      // spectral peaks for roughness
      let peaks = []; for (let k = 3; k < N / 2 - 1; k++) { const f = k * sr / N; if (f > 40 && f < 6000 && mag[k] > mag[k - 1] && mag[k] >= mag[k + 1]) peaks.push([f, mag[k]]); }
      for (const [f, m] of peaks) { if (f < 110 || f > 4000) continue; const k = Math.round(f * N / sr); let loc = 0; for (let j = k - 12; j <= k + 12; j++) if (j !== k) loc += mag[j] || 0; if (m > 5 * loc / 24) { const pc = ((Math.round(12 * Math.log2(f / 440)) % 12) + 12 + 9) % 12; chroma[pc] += m * m; } }
      peaks.sort((a, b) => b[1] - a[1]); peaks = peaks.slice(0, 14);
      const top = peaks[0]?.[1] || 1; peaks = peaks.filter(q => q[1] > top * 0.06);
      let r = 0, w = 0; for (let i = 0; i < peaks.length; i++) { w += peaks[i][1] ** 2; for (let j = i + 1; j < peaks.length; j++) r += peaks[i][1] * peaks[j][1] * pl(peaks[i][0], peaks[j][0]); }
      if (w > 0) { rough += r / w; roughW++; }
      frames.push(mag);
    }
    const nf = Math.max(1, frames.length), tot = band.reduce((a, b) => a + b, 1e-12);
    if (fluxes.length > 2) { const mean = fluxes.reduce((a, b) => a + b, 0) / fluxes.length; for (let i = 1; i < fluxes.length - 1; i++) if (fluxes[i] > mean * 1.5 && fluxes[i] > fluxes[i - 1] && fluxes[i] >= fluxes[i + 1]) onsets++; flux = Math.min(1, fluxes.reduce((a, b) => a + Math.abs(b - mean), 0) / fluxes.length / (mean + 1e-9)); }
    const cs = chroma.reduce((a, b) => a + b, 1e-12), chromaN = [...chroma].map(v => v / cs);
    let key = null, best = -2; for (let r = 0; r < 12; r++) for (const [prof, q] of [[MAJ, 'major'], [MIN, 'minor']]) { const c = corr(chromaN, prof.map((_, i) => prof[(i - r + 12) % 12])); if (c > best) { best = c; key = `${DSP.NOTE_NAMES[r]} ${q}`; } }
    return {
      sec: +(pcm.length / sr).toFixed(1), rmsDb: +(10 * Math.log10(sq / Math.max(1, pcm.length) + 1e-12)).toFixed(1), peakDb: +(20 * Math.log10(pk + 1e-9)).toFixed(1), clipPct: +(clip / Math.max(1, pcm.length) * 100).toFixed(2),
      lowMid: +(lowmid / tot).toFixed(2), sub: +(band[0] / tot).toFixed(2), low: +(band[1] / tot).toFixed(2), mid: +(band[2] / tot).toFixed(2), high: +(band[3] / tot).toFixed(2),
      centroidHz: Math.round(cent / nf), noisiness: +(flat / nf).toFixed(2), roughness: +(roughW ? rough / roughW : 0).toFixed(3), motion: +flux.toFixed(2), onsetsPerSec: +(onsets / (pcm.length / sr)).toFixed(1), silentPct: Math.round(silent / (nf + silent) * 100),
      heardKey: key, keyConfidence: +best.toFixed(2), chroma: chromaN.map(v => +v.toFixed(3)), frames, sr, N
    };
  }

  // what the patch says it is playing
  function patchKeys() {
    const seqs = A_().activeSeqs().map(id => { const m = E.mods[id]; return { id, root: m.params.root.choice, scale: m.params.scale.choice, trans: m.params.trans.choice, to: E.cablesFrom(id, 'NOTE').map(c => c.to.mod).join('+') }; });
    const pcs = new Set(); seqs.forEach(s => { const r = DSP.NOTE_NAMES.indexOf(s.root); DSP.SCALES[s.scale].forEach(d => pcs.add((r + d + (s.trans | 0) + 120) % 12)); });
    return { seqs, pcs };
  }
  const A_ = () => AI;

  // ======================= PICTURE =======================
  function spectrogram(M) {
    const W = 720, H = 330, cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const g = cv.getContext('2d'); g.fillStyle = '#0b0f12'; g.fillRect(0, 0, W, H);
    const top = 16, sh = 220, fl = 30, fh = 16000, fr = M.frames, nf = fr.length || 1, colW = (W - 40) / nf;
    let mx = 1e-9; fr.forEach(f => { for (let k = 1; k < f.length; k++) if (f[k] > mx) mx = f[k]; });
    fr.forEach((f, i) => {
      for (let y = 0; y < sh; y++) {
        const fq = fl * Math.pow(fh / fl, 1 - y / sh), k = Math.min(f.length - 1, Math.round(fq * M.N / M.sr));
        const db = 20 * Math.log10(f[k] / mx + 1e-9), v = clamp((db + 80) / 80);
        g.fillStyle = `hsl(${250 - v * 220},90%,${v * 58}%)`; g.fillRect(40 + i * colW, top + y, Math.ceil(colW), 1);
      }
    });
    g.fillStyle = '#9ab'; g.font = '10px monospace';
    [50, 100, 250, 500, 1000, 2500, 5000, 10000].forEach(fq => { const y = top + (1 - Math.log(fq / fl) / Math.log(fh / fl)) * sh; g.fillText(fq >= 1000 ? fq / 1000 + 'k' : fq, 2, y + 3); g.fillStyle = '#ffffff18'; g.fillRect(40, y, W - 40, 1); g.fillStyle = '#9ab'; });
    g.fillText(`spectrogram, ${M.sec}s of the master (time →, frequency ↑ log scale, Hz)`, 40, 11);
    const cy = top + sh + 26, bw = (W - 40) / 12, cmax = Math.max(...M.chroma, 1e-6);
    g.fillText('pitch-class energy (chroma)', 40, cy - 6);
    DSP.NOTE_NAMES.forEach((nm, i) => { const v = M.chroma[i] / cmax; g.fillStyle = `hsl(40,90%,${15 + v * 50}%)`; g.fillRect(40 + i * bw + 2, cy + (1 - v) * 50, bw - 4, v * 50 + 1); g.fillStyle = '#cde'; g.fillText(nm, 40 + i * bw + bw / 2 - 6, cy + 64); });
    return cv;
  }

  // ======================= JUDGE: built-in =======================
  const K = (mod, key, to, why) => ({ do: 'knob', mod, key, to, why });
  const nudge = (mod, key, d, why) => { const p = E.mods[mod]?.params[key]; return p ? K(mod, key, clamp(p.n + d), why) : null; };
  function localJudge(M, P) {
    const AI = A_(), working = [], notWorking = [], discordant = [], fixes = [];
    // 1. sequencers in different keys
    const main = P.seqs[0];
    const off = P.seqs.filter(s => main && (s.root !== main.root || s.scale !== main.scale));
    if (off.length) { discordant.push(`${off.map(s => s.id).join(', ')} ${off.length > 1 ? 'play' : 'plays'} in ${off.map(s => s.root + ' ' + s.scale).join(' / ')} while ${main.id} is in ${main.root} ${main.scale}`); off.forEach(s => fixes.push(K(s.id, 'root', main.root, 'match the key of the main line'), K(s.id, 'scale', main.scale, 'same scale so the lines agree'))); }
    else if (P.seqs.length > 1) working.push(`all ${P.seqs.length} melodic lines share ${main.root} ${main.scale}`);
    // 2. pitch energy outside the patch's scales (only meaningful when the music is tonal)
    const outKey = P.pcs.size ? M.chroma.reduce((s, v, i) => s + (P.pcs.has(i) ? 0 : v), 0) : 0;
    M.outOfKey = +outKey.toFixed(2);
    if (M.noisiness < 0.4 && outKey > 0.45) {
      discordant.push(`${Math.round(outKey * 100)}% of the pitched energy sits outside the scale`);
      AI.routed('fold') || E.findCable('fold', 'IN') ? fixes.push(nudge('fold', 'fold', -0.15, 'folds are adding off-key partials')) : null;
      E.order.filter(id => E.mods[id].kind === 'Analog' && AI.routed(id) && E.mods[id].v('detune') > 0.35).forEach(id => fixes.push(nudge(id, 'detune', -0.2, 'detune is smearing the pitch')));
    } else if (P.pcs.size && M.noisiness < 0.4) working.push(`the pitches sit in key (${Math.round((1 - outKey) * 100)}% in scale)`);
    // 3. roughness
    if (M.roughness > 0.22) {
      discordant.push(`rough, beating partials (roughness ${M.roughness})`);
      const v = E.order.filter(id => ['Analog', 'Titan'].includes(E.mods[id].kind) && AI.routed(id));
      if (v.length) { const id = v[Math.floor(Math.random() * v.length)]; fixes.push(nudge(id, 'drive', -0.15, 'too much grind'), nudge(id, E.mods[id].kind === 'Titan' ? 'uni' : 'detune', -0.15, 'fewer beating voices')); }
    } else if (M.roughness < 0.12 && M.noisiness < 0.35) working.push('the harmony is smooth');
    // 4. level and clipping
    if (M.clipPct > 0.05 || M.peakDb > -0.3) { notWorking.push(`clipping (${M.clipPct}% of samples at full scale)`); fixes.push(nudge('mixer', 'master', -0.1, 'it is clipping')); }
    else if (M.rmsDb < -36) { notWorking.push(`very quiet (${M.rmsDb} dB)`); fixes.push(nudge('mixer', 'master', 0.08, 'too quiet')); }
    else working.push(`healthy level (${M.rmsDb} dB RMS, peak ${M.peakDb} dB)`);
    // 5. balance
    const lowEnd = M.sub + M.low;
    if (lowEnd > 0.86) { notWorking.push(`muddy: ${Math.round(lowEnd * 100)}% of the energy is below 300 Hz`); const b = ['titan', 'acid'].find(id => AI.routed(id)); const c = b && E.cables.find(x => x.from.mod === b && E.mods[x.to.mod]?.kind === 'Mixer'); if (c) fixes.push(nudge(c.to.mod, 'l' + c.to.port.slice(2), -0.1, 'thin out the low end')); }
    else if (lowEnd < 0.08 && AI.routed('drums')) { notWorking.push('no weight in the low end'); fixes.push(nudge('drums', 'tune', -0.08, 'deeper kick')); }
    else working.push('balanced low end');
    if (M.high > 0.32 && M.centroidHz > 4200) { notWorking.push(`harsh top end (centre of mass ${M.centroidHz} Hz)`); const vc = AI.voiceCut(); if (vc.length) { const [m, k] = vc[0]; fixes.push(nudge(m, k, -0.12, 'too harsh')); } }
    // 5b. farty: a buzzy pile-up between 120 and 450 Hz with nothing bright on top
    const fart = Theory.unfart();
    if (M.lowMid > 0.5 && M.centroidHz < 900) { notWorking.push(`farty low-mid buzz: ${Math.round(M.lowMid * 100)}% of the energy sits between 120 and 450 Hz`); fixes.push(...fart); if (!fart.length) { const vc = AI.voiceCut(); if (vc.length) { const [m, k] = vc[0]; fixes.push(nudge(m, k, 0.1, 'let some harmonics through so the low end is not a blur')); } } }
    else if (fart.length) { notWorking.push('a voice is set up to sound farty (low square wave, closed resonant filter or overdriven low notes)'); fixes.push(...fart); }
    // 6. movement
    const prev = C.history[C.history.length - 1]?.metrics;
    if (M.motion < 0.18 && prev && prev.motion < 0.18) { notWorking.push('static for a while: nothing is moving'); const mv = AI.moves['mutate sequence']; if (mv?.ok()) fixes.push(...mv.make()); }
    else if (M.onsetsPerSec > 1.5) working.push(`a clear pulse (${M.onsetsPerSec} hits per second)`);
    const bad = notWorking.length + discordant.length * 1.3;
    return { score: clamp(8.5 - bad * 1.6 + working.length * 0.3, 0, 10), summary: bad ? `Heard ${discordant.length ? 'clashes' : 'problems'}: ${[...discordant, ...notWorking][0]}.` : 'Sounds good. Keeping it as it is.', working, notWorking, discordant, fixes: fixes.filter(Boolean).slice(0, 6), by: 'built-in critic' };
  }

  // ======================= JUDGE: Claude =======================
  async function askClaude(M, P, png) {
    const AI = A_(), sample = AI.claude; if (!sample) return null;
    const lim = await sample.limits?.().catch(() => null);
    const recent = [...document.querySelectorAll('#log .act')].slice(-14).map(e => e.textContent.replace(/^\d+:\d+/, '').trim()).join('\n');
    const seqLines = P.seqs.map(s => { const m = E.mods[s.id]; return `${s.id} → ${s.to}: ${s.root} ${s.scale} transpose ${s.trans}, pattern ${'ABCDEFGH'[m.cur]}: ${m.pats[m.cur].map(x => x.g ? x.n : '.').join(' ')}`; }).join('\n') || 'none';
    const cables = E.cables.map(c => `${c.from.mod}.${c.from.port} -> ${c.to.mod}.${c.to.port}`).join('; ');
    const { frames, sr, N, ...nums } = M;
    const prompt = `You are the ears and taste of an AI performer playing a browser modular synth. You cannot hear audio directly, so below are measurements of the last ${M.sec} seconds of the master output${png ? ', and the attached image is its spectrogram plus a pitch-class (chroma) bar chart' : ''}. Judge it like a demanding producer: what is working, what is not, what is too discordant, what just doesn't sound good. Be especially harsh on farty synths (buzzy low square waves, closed resonant filters, blatty short envelopes) and on parts that have looped unchanged for too long. Then fix the worst problems.

TASK: ${AI.prof?.task || 'free play'}
PERSONALITY: ${AI.prof?.persona || '-'}
GENRE: ${AI.prof?.genre || '-'}; target energy ${Math.round(AI.target.energy * 100)}%, brightness ${Math.round(AI.target.bright * 100)}%

MEASUREMENTS (JSON): ${JSON.stringify(nums)}
Notes: lowMid is the share of energy between 120 and 450 Hz; above 0.5 with a low centroid usually means a farty, honky low end. roughness is Plomp-Levelt sensory dissonance of the strongest partials (under 0.12 smooth, over 0.22 rough). noisiness is spectral flatness (0 tonal, 1 noise). chroma starts at C. outOfKey is the share of pitched energy outside the scales the sequencers use. Drums and noise sources raise noisiness and blur chroma.

SEQUENCERS (notes are scale degrees, . = rest):
${seqLines}
CABLES: ${cables}
PER-CHANNEL BALANCE (loudness-weighted, against where each kind of part should sit: drums anchor, bass just under, lead up front, arps behind, textures buried):
${typeof Mix !== 'undefined' ? Mix.describe() : 'n/a'}
Also judge the mix (parts too loud or too quiet: fix with mixer lN knobs) and any high-pitched, repeating sound left on too long (darken it, lower its octave or take it out).
RECENT AI ACTIONS:
${recent || 'none'}

MODULES:
${AI.catalog()}

Reply with JSON only:
{"score":0-10 how good it sounds now,"summary":"one sentence","working":["..."],"notWorking":["..."],"discordant":["..."],
 "fixes":[0-6 actions, only when something needs fixing. Allowed: {"do":"knob","mod":"id","key":"knob","to":0-1 or a step label,"why":"..."}, {"do":"steps","mod":"seqId","notes":[16],"accents":[],"slides":[],"why":"..."}, {"do":"patch","from":"mod.PORT","to":"mod.PORT","why":"..."}, {"do":"unpatch","to":"mod.PORT","why":"..."}, {"do":"drums","inst":"BD","pattern":"x...x...x...x...","why":"..."}, {"do":"mute","inst":"BD","on":true,"why":"..."}, {"do":"select","mod":"seqId","pat":"B","why":"..."}]}
Keep what works. Be specific (name the module and why). Use only module ids and knob names listed above.`;
    try {
      const r = await sample.json(prompt, { modelTier: 'default', images: png && lim?.images ? [png] : undefined });
      if (!r || typeof r !== 'object') return null;
      return { score: clamp(+r.score || 5, 0, 10), summary: String(r.summary || ''), working: [].concat(r.working || []).map(String), notWorking: [].concat(r.notWorking || []).map(String), discordant: [].concat(r.discordant || []).map(String), fixes: Array.isArray(r.fixes) ? r.fixes.filter(a => a && ['knob', 'steps', 'patch', 'unpatch', 'drums', 'mute', 'select'].includes(a.do)).slice(0, 6) : [], by: 'Claude' };
    } catch (e) { AI.log('err', `Claude critique unavailable (${esc(e.code || e.message)}), using the built-in critic`); return null; }
  }

  // ======================= LOOP =======================
  async function critique(manual) {
    const AI = A_();
    if (C.busy || E.ctx.state !== 'running' || !E.running) { if (manual) AI.log('sys', 'start the music first, then I can listen back'); return null; }
    C.busy = true; C.last = performance.now(); setStatus('Recording 6 seconds of the master…');
    try {
      const pcm = await record(6), sr = E.ctx.sampleRate;
      C.clip = URL.createObjectURL(wav(pcm, sr)); $('#critclip').src = C.clip; $('#critclip').hidden = false;
      setStatus('Measuring the clip…');
      const M = measure(pcm, sr), P = patchKeys();
      const cv = spectrogram(M); const img = $('#critimg'); img.src = cv.toDataURL('image/png'); img.hidden = false;
      const local = localJudge(M, P); // also fills M.outOfKey
      let J = null;
      if ($('#brain').value === 'claude' && AI.claude) { setStatus('Asking Claude what works and what doesn\'t…'); const png = await new Promise(r => cv.toBlob(r, 'image/png')); J = await askClaude(M, P, png); }
      J = J || local;
      const { frames, ...keep } = M;
      C.history.push({ t: Date.now(), metrics: keep, verdict: J }); if (C.history.length > 30) C.history.shift();
      const moves = AI.creditMoves((J.score - 5) / 5);
      AI.log('critic', `<b>listened back</b> (${esc(J.by)}): ${J.score.toFixed(1)}/10 · ${esc(J.summary)}${moves.length ? ` · credited moves: ${esc([...new Set(moves)].join(', '))}` : ''}`);
      [...J.discordant.map(t => ['clash', t]), ...J.notWorking.map(t => ['not working', t])].slice(0, 4).forEach(([k, t]) => AI.log('critic', `${k}: ${esc(t)}`));
      render(J, M);
      if (J.fixes.length) { AI.log('critic', `correcting course with ${J.fixes.length} change${J.fixes.length > 1 ? 's' : ''}`); await AI.applyFixes(J.fixes); }
      setStatus(`Last listen ${new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} · ${J.by}`);
      return J;
    } catch (e) { console.error(e); setStatus('Listening failed: ' + e.message); return null; }
    finally { C.busy = false; }
  }
  const setStatus = t => { $('#critstat').textContent = t; };
  function render(J, M) {
    const li = (cls, arr) => arr.map(t => `<li class="${cls}">${esc(t)}</li>`).join('');
    $('#critout').innerHTML = `<div class="critscore"><b>${J.score.toFixed(1)}</b>/10 <span>${esc(J.summary)}</span></div>
      <ul>${li('ok', J.working.slice(0, 4))}${li('bad', J.notWorking.slice(0, 4))}${li('clash', J.discordant.slice(0, 4))}</ul>
      <div class="critnums">heard ${esc(M.heardKey)} (${M.keyConfidence}) · out of key ${Math.round((M.outOfKey || 0) * 100)}% · roughness ${M.roughness} · ${M.rmsDb} dB · ${M.centroidHz} Hz</div>`;
  }
  setInterval(() => { if (C.on && !C.busy && E.running && E.ctx.state === 'running' && performance.now() - C.last > C.every * 1000) critique(false); }, 2000);

  $('#critnow').onclick = () => critique(true);
  $('#criton').onchange = e => { C.on = e.target.checked; C.last = performance.now(); };
  $('#critevery').onchange = e => { C.every = +e.target.value; };
  C.critique = critique; C.measure = measure; C.localJudge = localJudge; C.patchKeys = patchKeys;
  return C;
})();
