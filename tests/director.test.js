const test = require("node:test");
const assert = require("node:assert/strict");
const { createDirector, createClock } = require("../src/director.js");
const opening = require("../src/scenes/opening.js");
const SH = require("../src/shaders.js");

const director = createDirector([opening]);
const GRID = Array.from({ length: 151 }, (_, i) => i / 10);

test("the opening runs about fifteen seconds", () => {
  assert.ok(director.duration >= 14 && director.duration <= 16, String(director.duration));
});

test("frameAt is a pure function of time: same t, identical frame", () => {
  for (const t of GRID) assert.deepEqual(director.frameAt(t), director.frameAt(t));
  const a = director.frameAt(9.3);
  director.frameAt(2); director.frameAt(14);
  assert.deepEqual(director.frameAt(9.3), a);
});

test("time is clamped to the film, and done is reported at the end", () => {
  assert.equal(director.frameAt(-3).globalT, 0);
  assert.equal(director.frameAt(99).globalT, director.duration);
  assert.equal(director.frameAt(5).done, false);
  assert.equal(director.frameAt(director.duration).done, true);
  assert.equal(director.frameAt(NaN).globalT, 0);
});

test("looping wraps time instead of ending", () => {
  const d = createDirector([opening], { loop: true });
  assert.equal(d.frameAt(d.duration + 2).globalT, 2);
  assert.equal(d.frameAt(d.duration + 2).done, false);
});

test("the scene's uniforms match the shader contract exactly, with finite values", () => {
  const spec = Object.assign({}, SH.UNIFORMS.camera, SH.UNIFORMS.scene, SH.UNIFORMS.post);
  for (const t of GRID) {
    const u = director.frameAt(t).uniforms;
    assert.deepEqual(Object.keys(u).sort(), Object.keys(spec).sort(), `uniform names at t=${t}`);
    for (const [name, type] of Object.entries(spec)) {
      const v = u[name], n = { float: 0, vec2: 2, vec4: 4 }[type];
      if (type === "float") assert.ok(Number.isFinite(v), `${name} at ${t}`);
      else { assert.equal(v.length, n, name); assert.ok(v.every(Number.isFinite), `${name} at ${t}`); }
    }
  }
});

test("the timeline follows the brief: black, moon, castle, windows, title, then a poem that dissolves", () => {
  const u = t => director.frameAt(t).uniforms;
  assert.ok(u(0).uLight < .01 && u(0).uMoon === 0 && u(0).uCastle === 0, "starts black");
  assert.ok(u(2).uLight > 0 && u(2).uLight < .35, "a little silver light first");
  assert.ok(u(1).uMoon === 0 && u(6).uMoon === 1, "moon emerges between 1.8 s and 6 s");
  assert.ok(u(3.5).uCastle === 0 && u(7.7).uCastle === 1, "castle is revealed after the moon");
  assert.ok(u(6).uWindows < u(9).uWindows && u(11.6).uWindows === 1, "windows kindle after the castle");
  assert.ok(u(0).uCam[2] === 1 && u(15).uCam[2] > 1.15, "camera pushes in");
  for (let i = 1; i < GRID.length; i++) assert.ok(u(GRID[i]).uCam[2] >= u(GRID[i - 1]).uCam[2] - 1e-9, "push-in never reverses");
  assert.ok(u(14.99).uFade > .95, "ends faded to black");

  const cue = (t, id) => director.frameAt(t).cues.find(c => c.id === id);
  const title = opening.cues.find(c => c.id === "title"), poem = opening.cues.find(c => c.id === "poem");
  assert.equal(title.text, "ETERNAL");
  assert.ok(title.in[0] > opening.duration * .4, "title is not at the very start");
  assert.ok(title.in[0] < poem.in[0], "title before poem");
  assert.ok(poem.out[1] <= opening.duration, "poem dissolves before the end");
  assert.equal(cue(title.in[0] - .1, "title").visible, false);
  assert.equal(cue(title.in[1] + .1, "title").enter, 1);
  assert.equal(cue(poem.in[1] + .1, "poem").visible, true);
  assert.equal(cue(poem.out[1] + .1, "poem").visible, false);
  assert.equal(cue(poem.out[1] + .1, "poem").exit, 1);
  assert.ok(opening.poem.length >= 2 && opening.poem.every(l => l.length > 10));
});

test("lightning is scheduled, not random, and reduced-motion quietens it", () => {
  const at = opening.strikes[0].at;
  const loud = director.frameAt(at + .02).uniforms.uFlash, quiet = director.frameAt(at + .02, { reduced: true }).uniforms.uFlash;
  assert.ok(loud > .5 && quiet < loud * .3);
  assert.equal(director.frameAt(at - .5).uniforms.uFlash, 0);
});

test("the clock follows an injected time source and can seek and pause", () => {
  let now = 1000;
  const c = createClock(() => now);
  c.start(0); now = 3500;
  assert.equal(c.time(), 2.5);
  c.pause(); now = 9000;
  assert.equal(c.time(), 2.5);
  c.seek(7); assert.equal(c.time(), 7);
  c.start(7); now = 10000;
  assert.equal(c.time(), 8);
});

test("deterministic timing: a frame depends only on t, not on how often or in what order frames were drawn", () => {
  const d1 = createDirector([opening]), d2 = createDirector([opening]);
  const marks = Array.from({ length: 91 }, (_, m) => m / 6);          // instants that both a 30 fps and a 144 fps loop would hit
  const slow = new Map(), fast = new Map();
  for (let m = 0; m < marks.length; m++) {                              // 30 fps loop, forward, drawing the in-between frames too
    for (let k = 0; k < 5; k++) d1.frameAt(marks[m] + k / 30 - 1e-9 * k);
    slow.set(m, d1.frameAt(marks[m]));
  }
  for (let m = marks.length - 1; m >= 0; m--) {                         // 144 fps loop, backwards
    for (let k = 0; k < 24; k++) d2.frameAt(marks[m] - k / 144);
    fast.set(m, d2.frameAt(marks[m]));
  }
  for (let m = 0; m < marks.length; m++) assert.deepEqual(fast.get(m), slow.get(m), `frame at t=${marks[m]}`);
});

test("the documented timeline is pinned: cue times, strikes and duration do not drift by accident", () => {
  assert.equal(opening.duration, 15);
  assert.deepEqual(opening.cues.map(c => [c.id, c.in, c.out || null]), [["title", [7.6, 10.6], null], ["poem", [10.2, 12], [13.6, 14.7]]]);
  assert.deepEqual(opening.strikes.map(s => [s.at, s.strength]), [[6.5, .85], [12.3, .45]]);
});

test("the render scale is not part of the scene: no uniform depends on resolution", () => {
  for (const name of Object.keys(director.frameAt(5).uniforms)) assert.ok(!/scale|res|dpr|pixel/i.test(name), name);
});
