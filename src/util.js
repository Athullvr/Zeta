// Small pure helpers shared by the director and the scenes. No DOM, no WebGL: runs in the browser and in node tests.
(function (root) {
  "use strict";

  const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
  const lerp = (a, b, k) => a + (b - a) * k;
  // progress of t through [a, b], clamped to 0..1
  const seg = (t, a, b) => clamp((t - a) / (b - a));
  const smooth = x => { x = clamp(x); return x * x * (3 - 2 * x); };
  const smoother = x => { x = clamp(x); return x * x * x * (x * (x * 6 - 15) + 10); };
  const easeOut = x => 1 - Math.pow(1 - clamp(x), 3);
  const easeInOut = x => { x = clamp(x); return x < .5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2; };

  // deterministic generator (mulberry32): the same seed always gives the same sequence
  function rng(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // a lightning strike at time `at`: a bright flash, a short gap, a weaker second flash, then a decaying afterglow
  function strike(t, at, strength = 1) {
    const d = t - at;
    if (d < 0) return 0;
    const f1 = Math.exp(-d * 16);
    const f2 = d > .17 ? .6 * Math.exp(-(d - .17) * 11) : 0;
    const glow = .25 * Math.exp(-d * 2.4);
    return strength * Math.min(1, f1 + f2 + glow);
  }

  // staggered reveal of item i of n: `enter` runs 0..1 over the whole line, each item starts a little after the last
  function stagger(enter, i, n, overlap = .55) {
    if (n <= 1) return clamp(enter);
    const span = overlap + (1 - overlap) / n;           // each item animates for `span` of the line
    const start = (1 - span) * (i / (n - 1));
    return clamp((enter - start) / span);
  }

  const api = { clamp, lerp, seg, smooth, smoother, easeOut, easeInOut, rng, strike, stagger };
  if (typeof module === "object" && module.exports) module.exports = api;
  else (root.ETERNAL = root.ETERNAL || {}).util = api;
})(typeof self !== "undefined" ? self : globalThis);
