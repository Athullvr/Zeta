// Act I: the waiting. The opening, kept exactly as it was for its first 14 seconds (it is literally the opening scene's own
// parameters), then given room: the verse is answered by a second, the title leaves, and the camera, which has only drifted so
// far, falls in towards the one lit window of the castle until its light is all there is.
(function (root) {
  "use strict";
  const isNode = typeof module === "object" && module.exports;
  const U = isNode ? require("../util.js") : root.ETERNAL.util;
  const opening = isNode ? require("./opening.js") : root.ETERNAL.scenes.opening;
  const script = isNode ? require("../script.js") : root.ETERNAL.script;
  const { seg, smooth, smoother, lerp } = U;

  const DURATION = 28;
  const HOLD = 14;                               // the opening's own timeline is played as written up to here
  // the lit window, in the exterior's world: the castle sits at (.12, -.10) with scale .335, and the great window is at about
  // y = .45 in castle units; the castle layer's depth (.8) turns that into the camera position below
  const WINDOW = { x: .15, y: .0635, zoom: 3.4 };

  function uniforms(t, opts = {}) {
    const reduced = !!opts.reduced;
    const u = opening.uniforms(Math.min(t, HOLD), opts);
    // camera: the opening's slow drift and push-in until 15 s, then a long fall towards the window
    const run = seg(t, 0, 15), push = reduced ? .10 : .20;
    const x0 = lerp(-.02, .02, run), y0 = lerp(-.03, .025, smooth(run)), z0 = 1 + push * smooth(run);
    const k = smoother(seg(t, 16, 27.5)), zEnd = reduced ? 2.2 : WINDOW.zoom;
    u.uCam = [lerp(x0, WINDOW.x, k), lerp(y0, WINDOW.y, k), z0 * Math.pow(zEnd / z0, k), .0025 * Math.sin(t * .4) * (1 - k)];
    u.uDrift = t;
    u.uGreat = lerp(1, 1.9, smooth(seg(t, 18, 27)));         // the window warms as we approach
    return u;
  }

  const act = { id: "act1", program: "scene", duration: DURATION, uniforms, cues: script.act1, transitionOut: { kind: "bloom", dur: 4 } };
  if (isNode) module.exports = act;
  else ((root.ETERNAL = root.ETERNAL || {}).acts = root.ETERNAL.acts || {}).act1 = act;
})(typeof self !== "undefined" ? self : globalThis);
