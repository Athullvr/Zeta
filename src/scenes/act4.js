// Act IV: the oath. The storm gathers over the castle and the camera climbs towards the highest tower. Lightning is scheduled
// against the lines, and each flash shows more of the stone. See storm.js for the weather itself.
(function (root) {
  "use strict";
  const isNode = typeof module === "object" && module.exports;
  const storm = isNode ? require("./storm.js") : root.ETERNAL.scenes.storm;
  const script = isNode ? require("../script.js") : root.ETERNAL.script;

  const act = {
    id: "act4", program: "scene", duration: 36, cues: script.act4,
    uniforms: (t, opts) => storm.uniforms(t, opts),
    transitionOut: { kind: "continue", dur: 4 },   // act V picks up the same sky 4 s before this ends
  };
  if (isNode) module.exports = act;
  else ((root.ETERNAL = root.ETERNAL || {}).acts = root.ETERNAL.acts || {}).act4 = act;
})(typeof self !== "undefined" ? self : globalThis);
