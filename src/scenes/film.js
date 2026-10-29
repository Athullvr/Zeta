// The film: five acts in order. Durations and transitions live here; words in script.js; each act's pictures in its own file.
// An act starts when the previous one is `transitionOut.dur` seconds from its end, so every act overlaps its neighbour:
//   I  -> II   bloom      the great window's light swells until it is the whole screen, and the nave is lit by it
//   II -> III  fog        the memory dissolves like breath on glass into the night terrace
//   III-> IV   dark       a fade through black: love lost, and then the storm
//   IV -> V    continue   no seam: it is the same storm, the same sky, an act later
(function (root) {
  "use strict";
  const isNode = typeof module === "object" && module.exports;
  const A = isNode
    ? { act1: require("./act1.js"), act2: require("./act2.js"), act3: require("./act3.js"), act4: require("./act4.js"), act5: require("./act5.js") }
    : root.ETERNAL.acts;
  const film = { scenes: [A.act1, A.act2, A.act3, A.act4, A.act5] };
  if (isNode) module.exports = film;
  else (root.ETERNAL = root.ETERNAL || {}).film = film;
})(typeof self !== "undefined" ? self : globalThis);
