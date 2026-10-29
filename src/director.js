// The director owns time. It turns "seconds since start" into a frame description: which scene, the scene's uniform
// values and the state of every text cue. It is a pure function of time (frameAt), so the same t always gives the same frame.
// The renderer draws the uniforms; the overlay draws the cues. Neither knows about the other or about scene content.
(function (root) {
  "use strict";
  const U = typeof module === "object" && module.exports ? require("./util.js") : root.ETERNAL.util;

  // A cue is { id, kind, text | lines, in: [t0, t1], out?: [t0, t1] } in scene-local seconds.
  function cueState(cue, t) {
    const enter = U.seg(t, cue.in[0], cue.in[1]);
    const exit = cue.out ? U.seg(t, cue.out[0], cue.out[1]) : 0;
    const visible = t >= cue.in[0] && !(cue.out && t >= cue.out[1]);
    return { id: cue.id, kind: cue.kind, text: cue.text || null, lines: cue.lines || null, enter, exit, visible };
  }

  // A scene is { id, duration, uniforms(t, opts) -> {name: number | number[]}, cues: [...] }.
  function createDirector(scenes, options = {}) {
    if (!scenes.length) throw new Error("director needs at least one scene");
    const loop = !!options.loop;
    const starts = [];
    let total = 0;
    for (const s of scenes) { starts.push(total); total += s.duration; }

    function frameAt(globalT, opts = {}) {
      let t = Number.isFinite(globalT) ? globalT : 0;
      t = loop ? ((t % total) + total) % total : U.clamp(t, 0, total);
      let i = starts.length - 1;
      while (i > 0 && starts[i] > t) i--;
      const scene = scenes[i], local = t - starts[i];
      return {
        globalT: t,
        t: local,                              // scene-local time: what shaders see as uTime
        sceneId: scene.id,
        sceneIndex: i,
        duration: scene.duration,
        uniforms: scene.uniforms(local, opts),
        cues: scene.cues.map(c => cueState(c, local)),
        done: !loop && t >= total,
      };
    }
    return { frameAt, duration: total, scenes, loop };
  }

  // Playback clock. `now` is injectable so tests (and screenshots) never depend on the wall clock.
  function createClock(now) {
    let origin = 0, offset = 0, paused = true, frozenAt = 0;
    const time = () => (paused ? frozenAt : offset + (now() - origin) / 1000);
    return {
      start(at = 0) { offset = at; origin = now(); paused = false; },
      pause() { frozenAt = time(); paused = true; },
      seek(t) { offset = t; origin = now(); frozenAt = t; },
      time,
      get paused() { return paused; },
    };
  }

  const api = { createDirector, createClock, cueState };
  if (typeof module === "object" && module.exports) module.exports = api;
  else (root.ETERNAL = root.ETERNAL || {}).director = api;
})(typeof self !== "undefined" ? self : globalThis);
