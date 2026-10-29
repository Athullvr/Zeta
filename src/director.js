// The director owns time. It turns "seconds since start" into a frame description: which act(s) are on screen, each act's
// uniform values, the state of every text cue, and, during a transition, how far it has got. It is a pure function of time
// (frameAt), so the same t always gives the same frame, whatever the frame rate, the render scale or the draw order.
// The renderer draws layers; the overlay draws cues. Neither knows about the other or about act content.
(function (root) {
  "use strict";
  const U = typeof module === "object" && module.exports ? require("./util.js") : root.ETERNAL.util;

  // Transition kinds. The numbers are what the post shader receives as uTrans.
  const TRANSITIONS = { continue: 0, fog: 1, bloom: 2, dark: 3 };

  // A cue is { id, kind, text | lines, place?, variant?, in: [t0, t1], out?: [t0, t1] } in act-local seconds.
  function cueState(cue, t) {
    const enter = U.seg(t, cue.in[0], cue.in[1]);
    const exit = cue.out ? U.seg(t, cue.out[0], cue.out[1]) : 0;
    const visible = t >= cue.in[0] && !(cue.out && t >= cue.out[1]);
    return { id: cue.id, kind: cue.kind, text: cue.text || null, lines: cue.lines || null, place: cue.place || null, variant: cue.variant || null, enter, exit, visible };
  }

  const POST_KEYS = ["uBloom", "uGrain", "uVignette", "uExposure", "uFade"];

  // A scene is { id, duration, program?, uniforms(t, opts), cues, transitionOut?: { kind, dur } }.
  // Acts overlap: an act starts when the previous one is `transitionOut.dur` seconds from its end, so during that window both
  // are drawn and the post shader blends them. Without a transitionOut, acts simply follow one another.
  function createDirector(scenes, options = {}) {
    if (!scenes.length) throw new Error("director needs at least one scene");
    const loop = !!options.loop;
    const starts = [], ends = [];
    let total = 0;
    scenes.forEach((s, i) => {
      const prev = scenes[i - 1], overlap = prev && prev.transitionOut ? prev.transitionOut.dur : 0;
      starts.push(i ? ends[i - 1] - overlap : 0);
      ends.push(starts[i] + s.duration);
      total = Math.max(total, ends[i]);
    });

    function layerOf(i, t, opts) {
      const s = scenes[i], local = t - starts[i];
      return { program: s.program || "scene", t: local, uniforms: s.uniforms(local, opts), sceneId: s.id, sceneIndex: i };
    }

    function frameAt(globalT, opts = {}) {
      let t = Number.isFinite(globalT) ? globalT : 0;
      t = loop ? ((t % total) + total) % total : U.clamp(t, 0, total);
      const active = [];
      for (let i = 0; i < scenes.length; i++) if (t >= starts[i] && (t < ends[i] || (t === total && i === scenes.length - 1))) active.push(i);
      if (!active.length) active.push(scenes.length - 1);
      const outI = active.length > 1 ? active[active.length - 2] : -1, inI = active[active.length - 1];

      const layers = [];
      let transition = null, post;
      const incoming = layerOf(inI, t, opts);
      if (outI >= 0) {
        const tr = scenes[outI].transitionOut, p = U.clamp((t - starts[inI]) / tr.dur);
        transition = { kind: tr.kind, trans: TRANSITIONS[tr.kind], p, mix: U.smoother(p), from: outI, to: inI };
        if (tr.kind === "continue") layers.push(incoming);      // the same picture carries on: nothing to blend
        else layers.push(layerOf(outI, t, opts), incoming);
      } else layers.push(incoming);

      if (layers.length === 2) {                       // post settings follow the picture: blended by the transition's mix
        post = {};
        for (const k of POST_KEYS) post[k] = U.lerp(layers[0].uniforms[k], layers[1].uniforms[k], transition.mix);
      } else post = incoming.uniforms;

      const cues = [];
      for (const i of active) { const local = t - starts[i]; for (const c of scenes[i].cues) cues.push(cueState(c, local)); }
      const local = t - starts[inI];
      return {
        globalT: t,
        t: local,                                       // incoming act's local time: what its shader sees as uTime
        sceneId: scenes[inI].id,
        sceneIndex: inI,
        duration: scenes[inI].duration,
        uniforms: incoming.uniforms,
        layers, post, transition,
        act: { id: scenes[inI].id, index: inI, local, duration: scenes[inI].duration, progress: U.clamp(local / scenes[inI].duration), start: starts[inI], end: ends[inI] },
        cues,
        done: !loop && t >= total,
      };
    }
    return { frameAt, duration: total, scenes, loop, starts, ends, actStart: i => starts[i] };
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

  const api = { createDirector, createClock, cueState, TRANSITIONS, POST_KEYS };
  if (typeof module === "object" && module.exports) module.exports = api;
  else (root.ETERNAL = root.ETERNAL || {}).director = api;
})(typeof self !== "undefined" ? self : globalThis);
