// Act III: the lost beloved. A terrace at night, a ruined arcade, a garden gone to thorn. The camera drifts along the terrace so
// the arcade slides in front of the garden. Someone stands in the garden for a little while, framed by an arch, and is not
// there; as the light of her thins out, petals take over the air.
(function (root) {
  "use strict";
  const isNode = typeof module === "object" && module.exports;
  const U = isNode ? require("../util.js") : root.ETERNAL.util;
  const script = isNode ? require("../script.js") : root.ETERNAL.script;
  const { seg, smooth, smoother, lerp } = U;

  const DURATION = 34;

  function uniforms(t, opts = {}) {
    const run = seg(t, 0, DURATION);
    // the figure: nothing, then a suggestion, then almost certainty, then gone
    const fig = .8 * smoother(seg(t, 8.5, 14)) * (1 - smoother(seg(t, 22, 29.5)));
    return {
      uCam: [-.28 + .7 * smooth(run) + .012 * Math.sin(t * .3), .012 * Math.sin(t * .23), 1 + .1 * smooth(run), .003 * Math.sin(t * .2)],
      uLight: 1,
      uMoon: lerp(.15, 1, smoother(seg(t, 0, 6))),
      uCloud: .35,
      uStars: smooth(seg(t, 1, 6)),
      uMist: 1,
      uFigure: fig,
      uPetals: .12 + .85 * smooth(seg(t, 2, 24)),
      uDrift: .9 * t + .6 * (1 - Math.cos(.35 * t)),                     // wind with gusts in it, always moving forward
      uGust: .5 + .5 * Math.sin(.35 * t - 1),
      uCrimson: .35,
      uBloom: .55, uGrain: .055, uVignette: .95, uExposure: 1, uFade: 0,
    };
  }

  const act = { id: "act3", program: "terrace", duration: DURATION, uniforms, cues: script.act3, transitionOut: { kind: "dark", dur: 3.2 } };
  if (isNode) module.exports = act;
  else ((root.ETERNAL = root.ETERNAL || {}).acts = root.ETERNAL.acts || {}).act3 = act;
})(typeof self !== "undefined" ? self : globalThis);
