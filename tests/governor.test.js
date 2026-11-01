const test = require("node:test");
const assert = require("node:assert/strict");
const { createGovernor, parseScaleOptions, DEFAULTS } = require("../src/governor.js");

// Drive the governor like the animation loop would: a 60 Hz display, and a frame costs workMs(scale) of GPU time.
function simulate(gov, workMs, seconds, { vsync = 1000 / 60, startAt = 0, hitch = null } = {}) {
  let now = startAt; const changes = [];
  for (let i = 0; now - startAt < seconds * 1000; i++) {
    let dt = Math.max(vsync, workMs(gov.scale, now));
    if (hitch && i % hitch.every === 0) dt = hitch.ms;
    now += dt;
    const s = gov.sample(dt, now);
    if (s !== null) changes.push({ at: now, scale: s });
  }
  return { changes, now };
}

test("defaults react quickly and scale stays in 0.35..1", () => {
  assert.equal(DEFAULTS.min, .35); assert.equal(DEFAULTS.max, 1);
  assert.ok(DEFAULTS.downMs >= 20 && DEFAULTS.upMs < DEFAULTS.downMs, "a hysteresis band exists");
  assert.ok(DEFAULTS.upStep <= 1.1 && DEFAULTS.downStep >= .8);
});

test("a machine that holds 60 fps is left alone", () => {
  const g = createGovernor();
  const { changes } = simulate(g, () => 9, 120);
  assert.deepEqual(changes, []);
  assert.equal(g.scale, 1);
});

test("sustained slow frames reduce the scale, never below the minimum, and then it stops", () => {
  const g = createGovernor();
  const { changes } = simulate(g, () => 80, 120);
  assert.ok(changes.length >= 3);
  for (const c of changes) assert.ok(c.scale >= .35 && c.scale <= 1);
  assert.equal(g.scale, .35);
  const later = simulate(g, () => 80, 60, { startAt: 200000 });
  assert.deepEqual(later.changes, [], "no further changes at the floor");
});

test("scale limits are configurable and respected, including the initial value", () => {
  const g = createGovernor({ min: .7, max: .9, initial: 5 });
  assert.equal(g.scale, .9);
  simulate(g, () => 80, 60);
  assert.equal(g.scale, .7);
  assert.equal(createGovernor({ min: .7, max: .9, initial: .1 }).scale, .7);
});

test("warm-up is ignored; foreground stalls count, hidden-tab intervals do not", () => {
  const g = createGovernor();
  for (let i = 0; i < DEFAULTS.warmup; i++) assert.equal(g.sample(200, i * 200), null);
  const g2 = createGovernor();
  for (let i = 0; i < 400; i++) g2.sample(2000, i * 2000, { hidden: true });
  assert.equal(g2.scale, 1);
  const g3 = createGovernor();
  for (let i = 0; i < 45; i++) g3.sample(300, i * 300);
  assert.ok(g3.scale < 1, "repeated long foreground frames are evidence of overload");
});

test("one foreground stall is filtered, two consecutive stalls trigger a fast reduction", () => {
  const g = createGovernor();
  assert.equal(g.sample(300, 300), null);
  assert.equal(g.scale, 1, "one long frame may be an isolated hitch");
  g.sample(16.7, 317);
  assert.equal(g.sample(300, 617), null);
  const next = g.sample(300, 917);
  assert.equal(next, .55);
  assert.equal(g.log.at(-1).reason, "severe stall");
});

test("occasional hitches (under 10% of frames) do not trigger a reduction", () => {
  const g = createGovernor();
  const { changes } = simulate(g, () => 10, 60, { hitch: { every: 25, ms: 120 } });
  assert.deepEqual(changes, []);
});

test("minimum dwell: consecutive reductions are at least 2 s apart", () => {
  const g = createGovernor();
  const { changes } = simulate(g, () => 90, 60);
  for (let i = 1; i < changes.length; i++) assert.ok(changes[i].at - changes[i - 1].at >= DEFAULTS.downDwell - 1);
});

test("hysteresis: frame times inside the dead band (18.5..24 ms) never change the scale", () => {
  const g = createGovernor({ initial: .8 });        // room to move in both directions
  const { changes } = simulate(g, () => 21, 300, { vsync: 8 });
  assert.deepEqual(changes, []);
  assert.equal(g.scale, .8);
});

test("recovery is gradual: small steps, spaced by the up-dwell", () => {
  const g = createGovernor({ initial: .5 });
  const { changes } = simulate(g, () => 8, 120);
  assert.ok(changes.length >= 4, "it does climb back");
  let prev = .5;
  for (let i = 0; i < changes.length; i++) {
    assert.ok(changes[i].scale / prev <= DEFAULTS.upStep + .02, "step is small");
    if (i) assert.ok(changes[i].at - changes[i - 1].at >= DEFAULTS.upDwell - 1, "spaced by up-dwell");
    prev = changes[i].scale;
  }
  assert.ok(g.scale <= 1);
});

test("it does not oscillate when the machine can hold 60 fps only up to a point", () => {
  // fine at scale <= 0.7, too slow above it. A naive governor would flip up and down forever.
  const g = createGovernor({ initial: .5 });
  const work = s => (s <= .7 ? 10 : 40);
  const { changes } = simulate(g, work, 600);
  const firstDown = changes.findIndex((c, i) => c.scale < (i ? changes[i - 1].scale : .5));
  assert.ok(firstDown > 0, "it climbs until it finds the limit");
  const after = changes.slice(firstDown + 1);
  const probesAfter = after.filter((c, i) => c.scale > (i ? after[i - 1].scale : changes[firstDown].scale)).length;
  assert.ok(probesAfter <= 5, `${probesAfter} upward probes in the 9+ minutes after finding the limit`);
  assert.ok(changes[firstDown].scale <= .75, "settles at or just above the limit");
  for (const c of after) assert.ok(c.scale <= .75 && c.scale >= .65, "never strays far from the limit");
  assert.ok(g.state.upDwell > DEFAULTS.upDwell, "failed probes lengthen the up-dwell");
  assert.ok(g.scale <= .8);
});

test("a disabled governor never changes the scale", () => {
  const g = createGovernor({ enabled: false, initial: .8 });
  const { changes } = simulate(g, () => 90, 60);
  assert.deepEqual(changes, []); assert.equal(g.scale, .8);
});

test("manual ?scale overrides the governor; ?adapt=0 also disables it", () => {
  const q = s => new URLSearchParams(s);
  assert.deepEqual(parseScaleOptions(q("")), { manual: null, adapt: true });
  assert.deepEqual(parseScaleOptions(q("scale=0.5")), { manual: .5, adapt: false });
  assert.deepEqual(parseScaleOptions(q("scale=1.5&adapt=1")), { manual: 1.5, adapt: false });
  assert.deepEqual(parseScaleOptions(q("adapt=0")), { manual: null, adapt: false });
  assert.equal(parseScaleOptions(q("scale=abc")).adapt, true, "garbage is ignored");
  assert.equal(parseScaleOptions(q("scale=0")).manual, null);
  assert.equal(parseScaleOptions(q("scale=99")).manual, 4, "clamped");
  assert.deepEqual(parseScaleOptions(null), { manual: null, adapt: true });
});

test("reset forgets the window and re-enters warm-up", () => {
  const g = createGovernor();
  for (let i = 0; i < 80; i++) g.sample(50, i * 50);
  g.reset();
  for (let i = 0; i < DEFAULTS.warmup; i++) assert.equal(g.sample(50, 1e5 + i * 50), null);
  assert.equal(g.state.window, 0);
});

test("the governor is deterministic: same frame times, same decisions", () => {
  const run = () => simulate(createGovernor(), s => 12 + 40 * s, 120).changes;
  assert.deepEqual(run(), run());
});
