// panels.js — which worn front-panel texture each module wears (made by tools/make_panels.py).
'use strict';
const Panels = (() => {
  const BY_ID = { acid: 'acid', lead: 'lead' };
  const BY_KIND = {
    Clock: 'clock', StepSeq: 'seq', Entropy: 'ent', Drums: 'drums', Analog: 'analog', Titan: 'titan', Chip: 'chip', Bodies: 'bodies',
    Geiger: 'geiger', Slope: 'serge', Fold: 'serge', VCFQ: 'serge', Mixer: 'mixer', Monitor: 'monitor',
    Contour: 'contour', Swarm: 'swarm', Workout: 'workout', Grains: 'grains', Marbles: 'marbles', Toolbox: 'toolbox', Tape: 'tape', Reel: 'reel', LPG: 'lpg'
  };
  const LIGHT = new Set(['clock', 'seq', 'drums', 'mixer', 'grains', 'toolbox']);
  const SRC = {/*BUILD:PANELS*/};
  return {
    key: m => BY_ID[m.id] || BY_KIND[m.kind] || null,
    url: k => SRC[k] || new URL(`assets/panels/${k}.webp`, document.baseURI).href,
    light: k => LIGHT.has(k)
  };
})();
