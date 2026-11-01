const test = require("node:test");
const assert = require("node:assert/strict");
const B = require("../src/bench.js");

test("frameStats: average, percentiles, refresh estimate and slow-frame count", () => {
  const dts = [...Array(95).fill(16.7), ...Array(5).fill(50)];
  const s = B.frameStats(dts);
  assert.equal(s.frames, 100);
  assert.ok(Math.abs(s.avgMs - 18.4) < .2 && Math.abs(s.avgFps - 54.5) < .5);
  assert.equal(s.medianMs, 16.7); assert.equal(s.maxMs, 50); assert.equal(s.minMs, 16.7);
  assert.ok(s.p99Ms >= 49 && s.onePercentLowFps <= 21);
  assert.equal(s.estimatedRefreshHz, 60);
  assert.equal(s.slowFrames, 5);
  assert.deepEqual(B.frameStats([]), { frames: 0 });
});

test("classifyRenderer only says software when it is sure", () => {
  assert.equal(B.classifyRenderer("ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)").kind, "software");
  assert.equal(B.classifyRenderer("llvmpipe (LLVM 15.0.7, 256 bits)").kind, "software");
  assert.equal(B.classifyRenderer("Microsoft Basic Render Driver").kind, "software");
  assert.equal(B.classifyRenderer("ANGLE (Apple, ANGLE Metal Renderer: Apple M2, Unspecified Version)").kind, "hardware-likely");
  assert.equal(B.classifyRenderer("ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)").kind, "hardware-likely");
  assert.equal(B.classifyRenderer("").kind, "unknown");
  assert.equal(B.classifyRenderer(null).kind, "unknown");
  assert.equal(B.classifyRenderer("Apple M2", true).kind, "software", "the browser's own caveat flag wins");
  assert.ok(!/proves|guarantee/i.test(B.classifyRenderer("NVIDIA").reason.replace(/cannot prove/, "")), "does not overclaim");
});

test("the report labels the two measurements apart and warns honestly", () => {
  const stats = B.frameStats(Array(200).fill(16.7));
  const text = B.formatReport({
    environment: { userAgent: "UA", platform: "Linux", hardwareConcurrency: 8, deviceMemory: 8, devicePixelRatio: 2, viewport: [1440, 900], frame: [1440, 603] },
    gl: { renderer: "SwiftShader", vendor: "Google", version: "WebGL 2.0", shadingLanguage: "ES 3.00", floatTarget: true, extensions: ["EXT_color_buffer_float"], limits: { maxTexture: 8192, maxRenderbuffer: 8192, maxViewport: [8192, 8192] }, compileMs: 120, shaderCompiles: 2, width: 1440, height: 603 },
    verdict: B.classifyRenderer("SwiftShader"), scale: .88, effectiveRenderScale: .88,
    governor: { enabled: false, initialScale: 1, finalScale: .88, min: .35, max: 1, changes: [], note: "disabled for fixed-scale measurements" },
    animationLoop: stats, synchronous: B.syncSummary([{ t: 2, ms: 5.04 }, { t: 8, ms: 9.96 }]), glErrors: [], warnings: ["Software rendering"],
  });
  for (const must of ["Real animation loop", "requestAnimationFrame", "Synchronous back-to-back", "not frame pacing", "SOFTWARE", "1440x603", "render scale 0.88", "Governor", "Scale changes", "95th percentile", "99th", "1% low", "GL errors: none", "Software rendering", "not a pure GPU time"])
    assert.ok(text.includes(must), `report is missing "${must}"`);
  assert.ok(!/guarantee/i.test(text));
  const few = B.formatReport({ environment: { userAgent: "", platform: "", viewport: [1, 1], frame: [1, 1] }, gl: { renderer: "x", version: "", shadingLanguage: "", extensions: [], limits: { maxViewport: [1, 1] }, width: 1, height: 1 }, verdict: B.classifyRenderer("x"), scale: 1, governor: { enabled: false, note: "off", changes: [] }, animationLoop: { frames: 3 }, synchronous: B.syncSummary([{ t: 1, ms: 1 }]), glErrors: ["INVALID_OPERATION"], warnings: [] });
  assert.match(few, /Too few frames/); assert.match(few, /INVALID_OPERATION/);
});

test("syncSummary", () => {
  const s = B.syncSummary([{ t: 1, ms: 4 }, { t: 2, ms: 8 }]);
  assert.equal(s.meanMs, 6); assert.equal(s.worstMs, 8);
});
