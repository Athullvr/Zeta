// Scene 1: the opening. Everything about this scene that is not drawing code lives here: its length, the animated
// parameters (as functions of time), the title and the poetry. The renderer only ever sees the numbers this returns.
(function (root) {
  "use strict";
  const U = typeof module === "object" && module.exports ? require("../util.js") : root.ETERNAL.util;
  const { seg, smooth, smoother, lerp, strike } = U;

  const DURATION = 15;

  // Original verse. Two lines, set in the frame under the title.
  const POEM = [
    "A hundred winters I have kept your name,",
    "and the moon alone still keeps the count.",
  ];

  const CUES = [
    { id: "title", kind: "title", text: "ETERNAL", in: [7.6, 10.6] },
    { id: "poem", kind: "poem", lines: POEM, in: [10.2, 12.0], out: [13.6, 14.7] },
  ];

  // Lightning is scheduled, not random: one strike as the castle is revealed, a weak one behind the poem.
  const STRIKES = [
    { at: 6.5, strength: .85, x: -.30 },
    { at: 12.3, strength: .45, x: .55 },
  ];

  // Uniform contract (see UNIFORMS in shaders.js): camera, scene and post values for scene-local time t.
  function uniforms(t, opts = {}) {
    const reduced = !!opts.reduced;            // prefers-reduced-motion: gentler camera, quieter lightning
    const push = reduced ? .10 : .20;
    const run = seg(t, 0, DURATION);

    let flash = 0, flashX = STRIKES[0].x;
    for (const s of STRIKES) {
      const f = strike(t, s.at, s.strength);
      if (f > flash) { flash = f; flashX = s.x; }
    }
    if (reduced) flash *= .25;

    return {
      // camera: a slow push-in with a gentle tilt up towards the castle
      uCam: [lerp(-.02, .02, run), lerp(-.03, .025, smooth(run)), 1 + push * smooth(run), .0025 * Math.sin(t * .4)],

      // scene
      uLight: .3 * smooth(seg(t, .3, 3.2)) + .7 * smooth(seg(t, 3, 9)),     // a little silver first, then the night opens
      uMoon: smoother(seg(t, 1.8, 6)),                                      // the disc emerges from behind the clouds
      uCloud: lerp(1, .20, smooth(seg(t, 1.2, 9))),                          // overcast thins as the moon rises
      uStars: smooth(seg(t, 3.5, 8.5)),
      uCastle: smoother(seg(t, 3.6, 7.6)),                                  // silhouette rises out of the mist
      uWindows: smoother(seg(t, 6.2, 11.5)),                                // windows kindle one by one
      uMist: smooth(seg(t, 1.5, 6)),
      uShafts: smooth(seg(t, 4.5, 9)),
      uFlash: flash,
      uFlashX: flashX,
      uCrimson: smooth(seg(t, 8, 13)),
      uDrift: t, uStorm: 0, uBolt: 0, uBoltX: 0, uBoltSeed: 0, uGreat: 1,   // the wind carries clouds and mist at the pace of the film; no storm yet, no bolt, the great window as it was

      // post
      uBloom: .55,
      uGrain: .055,
      uVignette: .9,
      uExposure: 1,
      uFade: smooth(seg(t, 14.3, DURATION)),
    };
  }

  const opening = { id: "opening", duration: DURATION, uniforms, cues: CUES, poem: POEM, strikes: STRIKES };
  if (typeof module === "object" && module.exports) module.exports = opening;
  else ((root.ETERNAL = root.ETERNAL || {}).scenes = root.ETERNAL.scenes || {}).opening = opening;
})(typeof self !== "undefined" ? self : globalThis);
