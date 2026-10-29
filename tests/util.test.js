const test = require("node:test");
const assert = require("node:assert/strict");
const U = require("../src/util.js");

test("seg, smooth and ease functions stay in 0..1 and hit their endpoints", () => {
  for (const f of [U.smooth, U.smoother, U.easeOut, U.easeInOut]) {
    assert.equal(f(-5), 0); assert.equal(f(0), 0); assert.equal(f(1), 1); assert.equal(f(9), 1);
    let prev = -1;
    for (let i = 0; i <= 100; i++) { const v = f(i / 100); assert.ok(v >= prev - 1e-12 && v >= 0 && v <= 1); prev = v; }
  }
  assert.equal(U.seg(5, 2, 4), 1); assert.equal(U.seg(1, 2, 4), 0); assert.equal(U.seg(3, 2, 4), .5);
});

test("rng is deterministic per seed and differs between seeds", () => {
  const a = U.rng(7), b = U.rng(7), c = U.rng(8);
  const sa = Array.from({ length: 20 }, a), sb = Array.from({ length: 20 }, b), sc = Array.from({ length: 20 }, c);
  assert.deepEqual(sa, sb);
  assert.notDeepEqual(sa, sc);
  assert.ok(sa.every(v => v >= 0 && v < 1));
});

test("strike is silent before it starts, peaks right after, and decays", () => {
  assert.equal(U.strike(1, 2), 0);
  assert.ok(U.strike(2.01, 2) > .8);
  assert.ok(U.strike(2.2, 2) > U.strike(4, 2));
  assert.ok(U.strike(6, 2) < .01);
  assert.ok(U.strike(2.01, 2, .5) <= .5 + 1e-9);
});

test("stagger starts items in order and finishes all of them at enter = 1", () => {
  for (const n of [1, 3, 7]) {
    for (let i = 0; i < n; i++) assert.equal(U.stagger(1, i, n), 1);
    for (let i = 0; i < n; i++) assert.equal(U.stagger(0, i, n), 0);
  }
  const e = .4;
  assert.ok(U.stagger(e, 0, 5) >= U.stagger(e, 2, 5) && U.stagger(e, 2, 5) >= U.stagger(e, 4, 5));
});
