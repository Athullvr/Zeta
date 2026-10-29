// Act V: until eternity. The same sky as act IV, a few seconds on and still going: the storm spends itself, the moonlight
// softens, the mist settles, the camera falls back until the castle is small. Then the last verse, the title once more,
// and the dark.
(function (root) {
  "use strict";
  const isNode = typeof module === "object" && module.exports;
  const storm = isNode ? require("./storm.js") : root.ETERNAL.scenes.storm;
  const script = isNode ? require("../script.js") : root.ETERNAL.script;

  const act = {
    id: "act5", program: "scene", duration: storm.END - storm.ACT5_OFFSET, cues: script.act5,
    uniforms: (t, opts) => storm.uniforms(t + storm.ACT5_OFFSET, opts),
  };
  if (isNode) module.exports = act;
  else ((root.ETERNAL = root.ETERNAL || {}).acts = root.ETERNAL.acts || {}).act5 = act;
})(typeof self !== "undefined" ? self : globalThis);
