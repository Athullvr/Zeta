// The sky shared by acts IV and V. They are one continuous piece of weather seen in two acts: act V begins 4 s before act IV
// ends, on the same instant of this timeline, so nothing jumps at the join. `tg` is the storm clock: act IV's local time.
// The storm gathers (0-14 s), holds while the camera climbs to the highest tower, then is spent by about 52 s, and the
// camera falls back until the castle is small beneath a very large sky.
(function (root) {
  "use strict";
  const isNode = typeof module === "object" && module.exports;
  const U = isNode ? require("../util.js") : root.ETERNAL.util;
  const { seg, smooth, smoother, lerp, keyframes, strike, bolt } = U;

  const ACT5_OFFSET = 32;                    // act V's local 0 is storm time 32
  // The supplied score is about 168.15 s; this calm tail brings the shared storm timeline to that endpoint.
  // Act V starts at storm time 32, so the complete film ends at END + 84.8 = 168.15 s.
  const END = 83.35;

  // intensity of the storm, 0..1
  const S = tg => tg < 32 ? .45 + .55 * smooth(seg(tg, 0, 14)) : 1 - smoother(seg(tg, 33, 52));
  // cloud speed relative to calm; its integral is the wind phase, so changing speed never makes the sky jump
  const wind = U.integral(tg => 1 + 5.5 * Math.pow(S(tg), 1.3), END + 4, .05);

  // lightning is written down, not rolled: each flash lands just before a line of the oath, and the bolts are the dramatic ones
  const STRIKES = [
    { at: 2.4, s: 1.0, x: -.35, seed: 2.3, bolt: true },
    { at: 8.2, s: .35, x: .50, seed: 0, bolt: false },
    { at: 12.8, s: .95, x: .55, seed: 7.1, bolt: true },
    { at: 17.6, s: .35, x: -.40, seed: 0, bolt: false },
    { at: 22.0, s: .90, x: -.10, seed: 3.7, bolt: true },
    { at: 22.45, s: .60, x: -.15, seed: 3.7, bolt: false },
    { at: 26.2, s: .35, x: .30, seed: 0, bolt: false },
    { at: 30.4, s: 1.0, x: .30, seed: 8.6, bolt: true },
    { at: 40.5, s: .30, x: -.30, seed: 0, bolt: false },
    { at: 46.0, s: .20, x: .40, seed: 0, bolt: false },
  ];

  function uniforms(tg, opts = {}) {
    const reduced = !!opts.reduced;
    const s = S(tg), calm = 1 - s;
    let flash = 0, flashX = STRIKES[0].x, boltV = 0, boltX = STRIKES[0].x, boltSeed = STRIKES[0].seed;
    for (const k of STRIKES) {
      const f = strike(tg, k.at, k.s);
      if (f > flash) { flash = f; flashX = k.x; }
      if (k.bolt && tg >= k.at) { boltX = k.x; boltSeed = k.seed; }          // the latest bolt, until the next one
      if (k.bolt) boltV = Math.max(boltV, bolt(tg, k.at) * k.s);
    }
    if (reduced) { flash *= .25; boltV *= .4; }
    const approach = reduced ? .5 : 1;
    const z = keyframes(tg, [[0, 1.0], [30, 2.25], [37, 2.2], [52, .80], [END, .74]]);
    return {
      uCam: [keyframes(tg, [[0, .02], [30, .15], [37, .15], [52, .02], [END, .05]]), keyframes(tg, [[0, 0], [30, .33], [37, .33], [52, .11], [END, .13]]), 1 + (z - 1) * (z > 1 ? approach : 1), .004 * Math.sin(tg * .3) * s],
      uLight: .78 + .15 * s,
      uMoon: lerp(.88, .40, s),
      uCloud: lerp(.30, 1, s),
      uStars: .9 - .75 * s,
      uCastle: 1,
      uWindows: lerp(.8, 1, s),
      uMist: lerp(.85, 1, s),
      uShafts: lerp(.65, .15, s),
      uFlash: flash, uFlashX: flashX,
      uCrimson: lerp(.2, .7, s),
      uDrift: 38 + wind(tg),
      uStorm: s,
      uBolt: boltV, uBoltX: boltX, uBoltSeed: boltSeed,
      uGreat: lerp(.55, 1.3, s),
      uBloom: lerp(.5, .75, s), uGrain: .055, uVignette: lerp(.85, 1.05, s), uExposure: lerp(1, .92, s),
      // Resolve over the final five seconds, aligned with the default soundtrack fade-out.
      uFade: smooth(seg(tg, END - 5, END)),
    };
  }

  const api = { uniforms, STRIKES, ACT5_OFFSET, END, stormAt: S };
  if (isNode) module.exports = api;
  else ((root.ETERNAL = root.ETERNAL || {}).scenes = root.ETERNAL.scenes || {}).storm = api;
})(typeof self !== "undefined" ? self : globalThis);
