const test = require("node:test");
const assert = require("node:assert/strict");
const SH = require("../src/shaders.js");

function declared(src) {
  const out = {};
  for (const m of src.matchAll(/^\s*uniform\s+(\w+)\s+([^;]+);/gm))
    for (const name of m[2].split(",").map(s => s.trim())) out[name] = m[1];
  return out;
}

for (const [prog, src] of [["scene", SH.SCENE_FRAG], ["post", SH.POST_FRAG]]) {
  test(`${prog}: declared uniforms and the contract agree`, () => {
    const d = declared(src); delete d.uScene;       // the sampler is bound by the renderer, not by a scene
    assert.deepEqual(d, SH.PROGRAM_UNIFORMS[prog]);
  });
  test(`${prog}: is GLSL ES 3.00 and well-formed`, () => {
    assert.ok(src.startsWith("#version 300 es\n"), "#version must be the first line");
    assert.ok(/precision highp float;/.test(src));
    assert.ok(/out vec4 fragColor;/.test(src));
    assert.equal((src.match(/\{/g) || []).length, (src.match(/\}/g) || []).length, "braces balance");
    assert.equal((src.match(/\(/g) || []).length, (src.match(/\)/g) || []).length, "parentheses balance");
    assert.ok(!/\bsin\s*\(\s*dot\s*\(/.test(src), "no sin(dot()) hashes: they differ between GPUs");
    assert.ok(!/\brand\s*\(|\bMath\.random/.test(src), "no per-frame randomness");
  });
}

test("the vertex shader is a fullscreen triangle with no attributes", () => {
  assert.ok(SH.VERT.startsWith("#version 300 es\n"));
  assert.ok(/gl_VertexID/.test(SH.VERT) && !/\bin\s+vec/.test(SH.VERT));
});

test("exactly two programs, as the brief asks for a small number", () => {
  assert.deepEqual(Object.keys(SH.PROGRAM_UNIFORMS).sort(), ["post", "scene"]);
});

test("every shared uniform is set by the renderer, so scenes never need to provide them", () => {
  assert.deepEqual(Object.keys(SH.UNIFORMS.shared).sort(), ["uRes", "uTime"]);
});
