// Act II: the memory. The inside of the cathedral, entered as if from the window's light. The eye walks slowly down the nave,
// the moonlight comes in through the clerestory a window at a time, dust finds the beams, and the great west window, dark at
// first, fills with colour as the memory sharpens. The act ends moving towards it.
(function (root) {
  "use strict";
  const isNode = typeof module === "object" && module.exports;
  const U = isNode ? require("../util.js") : root.ETERNAL.util;
  const script = isNode ? require("../script.js") : root.ETERNAL.script;
  const { seg, smooth, smoother, lerp } = U;

  const DURATION = 34;

  function uniforms(t, opts = {}) {
    const reduced = !!opts.reduced;
    const run = seg(t, 0, DURATION), walk = .5 * run + .5 * smooth(run);       // never quite stops, never lurches
    return {
      // x sway, eye height, how far down the nave, pitch
      uCam: [-.3 + .45 * smooth(run) + .05 * Math.sin(t * .21), 1.5 + .9 * smooth(run), -6 + (reduced ? 18 : 27) * walk, .09 + .05 * smooth(seg(t, 20, DURATION))],
      uLight: lerp(.75, 1, smooth(seg(t, 0, 5))),
      uBeams: smooth(seg(t, 2, 10)),
      uDust: smooth(seg(t, 1, 8)),
      uGlass: .35 + .65 * smooth(seg(t, 0, 22)) + .5 * smooth(seg(t, 26, DURATION)),
      uFog: .9,
      uCrimson: .7 * smooth(seg(t, 10, 30)),
      uBloom: .75, uGrain: .05, uVignette: .9, uExposure: 1, uFade: 0,
    };
  }

  const act = { id: "act2", program: "interior", duration: DURATION, uniforms, cues: script.act2, transitionOut: { kind: "fog", dur: 4 } };
  if (isNode) module.exports = act;
  else ((root.ETERNAL = root.ETERNAL || {}).acts = root.ETERNAL.acts || {}).act2 = act;
})(typeof self !== "undefined" ? self : globalThis);
