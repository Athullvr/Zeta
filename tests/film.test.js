const test = require("node:test");
const assert = require("node:assert/strict");
const { createDirector, TRANSITIONS } = require("../src/director.js");
const film = require("../src/scenes/film.js");
const SH = require("../src/shaders.js");
const governor = require("../src/governor.js");

const director = createDirector(film.scenes);
const HANDOFFS = [
  { from: "act1", to: "act2", start: 24, end: 28, kind: "bloom", layers: 2 },
  { from: "act2", to: "act3", start: 54, end: 58, kind: "fog", layers: 2 },
  { from: "act3", to: "act4", start: 84.8, end: 88, kind: "dark", layers: 2 },
  { from: "act4", to: "act5", start: 116.8, end: 120.8, kind: "continue", layers: 1 },
];

test("the five acts form one 150–180 second film with deliberate overlaps", () => {
  assert.deepEqual(film.scenes.map(s => s.id), ["act1", "act2", "act3", "act4", "act5"]);
  assert.deepEqual(film.scenes.map(s => s.duration), [28, 34, 34, 36, 38]);
  assert.deepEqual(director.starts, [0, 24, 54, 84.8, 116.8]);
  assert.deepEqual(director.ends, [28, 58, 88, 120.8, 154.8]);
  assert.equal(director.duration, 154.8);
  assert.equal(director.frameAt(director.duration).done, true);
});

test("every handoff has the expected scene, transition progress, and boundary behavior", () => {
  for (const h of HANDOFFS) {
    const from = film.scenes.findIndex(s => s.id === h.from);
    const to = film.scenes.findIndex(s => s.id === h.to);
    assert.equal(film.scenes[from].transitionOut.kind, h.kind);
    assert.ok(Math.abs(film.scenes[from].transitionOut.dur - (h.end - h.start)) < 1e-9);
    assert.equal(TRANSITIONS[h.kind], h.kind === "bloom" ? 2 : h.kind === "fog" ? 1 : h.kind === "dark" ? 3 : 0);

    assert.equal(director.frameAt(h.start - .001).transition, null, `${h.from} before ${h.to}`);
    for (const [t, p] of [[h.start, 0], [h.start + (h.end - h.start) / 2, .5], [h.end - .001, 1 - .001 / (h.end - h.start)]]) {
      const f = director.frameAt(t);
      assert.equal(f.sceneId, h.to, `${h.kind} incoming scene at ${t}`);
      assert.equal(f.transition.kind, h.kind);
      assert.equal(f.transition.from, from);
      assert.equal(f.transition.to, to);
      assert.ok(Math.abs(f.transition.p - p) < 1e-9, `${h.kind} raw progress at ${t}`);
      assert.ok(Math.abs(f.transition.mix - (p === 0 ? 0 : p === .5 ? .5 : require("../src/util.js").smoother(p))) < 1e-9);
      assert.equal(f.layers.length, h.layers, `${h.kind} layer count at ${t}`);
    }
    assert.equal(director.frameAt(h.end).transition, null, `${h.to} after handoff`);
    assert.equal(director.frameAt(h.end + .001).sceneId, h.to);
  }
});

test("the storm handoff preserves identical uniforms across the shared sky", () => {
  const outgoing = film.scenes[3], incoming = film.scenes[4];
  for (const local4 of [32, 32.001, 33.5, 35.999]) {
    assert.deepEqual(outgoing.uniforms(local4), incoming.uniforms(local4 - 32));
  }
  const f = director.frameAt(118.25);
  assert.equal(f.transition.kind, "continue");
  assert.equal(f.layers.length, 1);
  assert.equal(f.layers[0].sceneId, "act5");
});

test("all five acts return finite values matching their shader uniform contracts", () => {
  const rendererOwned = new Set([...Object.keys(SH.UNIFORMS.shared), ...Object.keys(SH.UNIFORMS.transition)]);
  for (let i = 0; i < film.scenes.length; i++) {
    const act = film.scenes[i], program = act.program || "scene";
    const expected = [...new Set([
      ...Object.keys(SH.PROGRAM_UNIFORMS[program]).filter(k => !rendererOwned.has(k)),
      ...Object.keys(SH.UNIFORMS.post),
    ])].sort();
    const beforeOutgoingTransition = act.duration - (act.transitionOut?.dur || 0) - .001;
    for (const local of [0, act.duration * .37, act.duration * .75, beforeOutgoingTransition]) {
      const frame = director.frameAt(director.starts[i] + local);
      const layer = frame.layers.find(l => l.sceneId === act.id);
      assert.ok(layer, `${act.id} has a drawable layer at local ${local}`);
      assert.deepEqual(Object.keys(layer.uniforms).sort(), expected, `${act.id} uniform keys at ${local}`);
      for (const [name, value] of Object.entries(layer.uniforms)) {
        if (Array.isArray(value)) assert.ok(value.every(Number.isFinite), `${act.id}.${name} at ${local}`);
        else assert.ok(Number.isFinite(value), `${act.id}.${name} at ${local}`);
      }
    }
  }
});

test("poetry cues are unique, in bounds, and visible at their scripted times", () => {
  const ids = new Set();
  for (let i = 0; i < film.scenes.length; i++) {
    const act = film.scenes[i];
    for (const cue of act.cues) {
      assert.ok(!ids.has(cue.id), `duplicate cue id: ${cue.id}`); ids.add(cue.id);
      assert.ok(cue.in[0] >= 0 && cue.in[1] > cue.in[0] && cue.in[1] <= act.duration, `${cue.id} entry is in bounds`);
      if (cue.out) assert.ok(cue.out[0] >= cue.in[1] && cue.out[1] > cue.out[0] && cue.out[1] <= act.duration, `${cue.id} exit is in bounds`);
      assert.ok(cue.text || (cue.lines && cue.lines.length), `${cue.id} has words`);

      const at = director.starts[i] + cue.in[0];
      const get = t => director.frameAt(t).cues.find(c => c.id === cue.id);
      const entered = get(at + 1e-6); // avoid subtraction rounding when global time becomes act-local time
      assert.equal(entered.visible, true, `${cue.id} appears at its start`);
      assert.ok(entered.enter < 1e-5, `${cue.id} starts at zero opacity`);
      assert.ok(Math.abs(get(director.starts[i] + cue.in[1]).enter - 1) < 1e-9, `${cue.id} completes its entrance`);
      if (cue.out) {
        const gone = get(director.starts[i] + cue.out[1] + 1e-6);
        assert.equal(gone.visible, false, `${cue.id} is gone after its end`);
        assert.ok(Math.abs(gone.exit - 1) < 1e-9, `${cue.id} completes its exit`);
      }
    }
  }
  assert.equal(film.scenes[0].cues.find(c => c.id === "a1.verse").lines.join(" "),
    "A hundred winters I have kept your name, and the moon alone still keeps the count.");
});

test("every act is deterministic across timestamp order and independent of render scale", () => {
  const marks = new Set([0, director.duration]);
  for (const t of director.starts) marks.add(t);
  for (const t of director.ends) marks.add(t);
  for (const h of HANDOFFS) for (const p of [.1, .25, .5, .75, .9]) marks.add(h.start + (h.end - h.start) * p);
  for (let i = 0; i < film.scenes.length; i++) marks.add(director.starts[i] + film.scenes[i].duration * .63);
  const times = [...marks].sort((a, b) => a - b), saved = new Map();
  for (const t of times) saved.set(t, director.frameAt(t));
  for (const t of [...times].reverse()) assert.deepEqual(director.frameAt(t), saved.get(t), `frame at ${t}`);
  for (const t of times) {
    assert.deepEqual(director.frameAt(t, { renderScale: .5 }), saved.get(t), `half-scale frame at ${t}`);
    assert.deepEqual(director.frameAt(t, { renderScale: 2 }), saved.get(t), `double-scale frame at ${t}`);
  }
});

test("manual and adaptive governor modes remain available to every scene", () => {
  assert.deepEqual(governor.parseScaleOptions(new URLSearchParams("scale=0.5")), { manual: .5, adapt: false });
  assert.deepEqual(governor.parseScaleOptions(new URLSearchParams("adapt=0")), { manual: null, adapt: false });
  assert.deepEqual(governor.parseScaleOptions(new URLSearchParams("")), { manual: null, adapt: true });
});
