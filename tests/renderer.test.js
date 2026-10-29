const test = require("node:test");
const assert = require("node:assert/strict");
const { createRenderer, formatShaderLog, EternalError } = require("../src/renderer.js");

const fakeCanvas = gl => ({ getContext: () => gl, addEventListener() {} });

test("missing WebGL2 gives a readable error, not a crash", () => {
  assert.throws(() => createRenderer(fakeCanvas(null)), e => {
    assert.ok(e instanceof EternalError);
    assert.equal(e.kind, "webgl2-unavailable");
    assert.match(e.message, /WebGL2/);
    assert.ok(e.details.length > 20, "says what to try");
    return true;
  });
});

test("formatShaderLog quotes the offending source lines", () => {
  const src = "#version 300 es\nvoid main() {\n  float x = nope;\n}\n";
  const out = formatShaderLog("scene fragment shader", src, "ERROR: 0:3: 'nope' : undeclared identifier\n");
  assert.match(out, /^scene fragment shader:/);
  assert.match(out, /undeclared identifier/);
  assert.match(out, /3 \| float x = nope;/);
});

test("formatShaderLog survives an empty log and out-of-range line numbers", () => {
  assert.match(formatShaderLog("x", "a\nb", ""), /no log/);
  assert.doesNotThrow(() => formatShaderLog("x", "a\nb", "ERROR: 0:99: boom"));
});

test("a shader that fails to compile surfaces the driver log and the source line", () => {
  const shaders = [];
  const gl = new Proxy({}, {
    get(_, name) {
      if (name === "VERTEX_SHADER") return 1; if (name === "FRAGMENT_SHADER") return 2;
      if (name === "COMPILE_STATUS") return "cs"; if (name === "LINK_STATUS") return "ls";
      if (name === "createShader") return type => { const s = { type, src: "" }; shaders.push(s); return s; };
      if (name === "shaderSource") return (s, src) => { s.src = src; };
      if (name === "getShaderParameter") return (s, p) => !(s.type === 2 && s.src.includes("uRes") && p === "cs");
      if (name === "getShaderInfoLog") return () => "ERROR: 0:7: 'foo' : syntax error";
      if (name === "getProgramParameter") return () => true;
      return () => ({});
    },
  });
  assert.throws(() => createRenderer(fakeCanvas(gl)), e => {
    assert.equal(e.kind, "shader-compile");
    assert.match(e.details, /fragment shader/);
    assert.match(e.details, /syntax error/);
    assert.match(e.details, /\b7 \| /);
    return true;
  });
});

// ---- render scale, drawing-buffer limits and "never recompile" with a stubbed WebGL2 ----
function stubGL({ maxTexture = 8192, maxViewport = [16384, 16384] } = {}) {
  const calls = { compileShader: 0, linkProgram: 0, texStorage: [] };
  const params = { MAX_TEXTURE_SIZE: maxTexture, MAX_RENDERBUFFER_SIZE: maxTexture, MAX_VIEWPORT_DIMS: maxViewport, VERSION: "WebGL 2.0 (stub)", SHADING_LANGUAGE_VERSION: "stub", RENDERER: "stub", VENDOR: "stub" };
  const gl = new Proxy({}, {
    get(_, name) {
      if (name === "calls") return calls;
      if (typeof name !== "string") return undefined;
      if (/^[A-Z0-9_]+$/.test(name)) return name;                        // GL constants evaluate to their own names
      if (name === "compileShader") return () => { calls.compileShader++; };
      if (name === "linkProgram") return () => { calls.linkProgram++; };
      if (name === "texStorage2D") return (...a) => { calls.texStorage.push([a[3], a[4]]); };
      if (name === "getParameter") return p => params[p];
      if (name === "getShaderParameter" || name === "getProgramParameter") return () => true;
      if (name === "checkFramebufferStatus") return () => "FRAMEBUFFER_COMPLETE";
      if (name === "getExtension") return n => (n === "WEBGL_debug_renderer_info" ? null : {});
      if (name === "getSupportedExtensions") return () => ["EXT_color_buffer_float"];
      if (name === "getUniformLocation") return () => ({});
      return () => ({});
    },
  });
  return gl;
}
const stubCanvas = gl => ({ width: 0, height: 0, getContext: () => gl, addEventListener() {} });

test("setScale multiplies the buffer, resizes only buffers, and never compiles shaders", () => {
  const gl = stubGL(), canvas = stubCanvas(gl), r = createRenderer(canvas);
  assert.equal(gl.calls.compileShader, 8); assert.equal(gl.calls.linkProgram, 4);   // four programs, compiled once: scene, interior, terrace, post
  assert.deepEqual(r.resize(1000, 418, 1), { width: 1000, height: 418 });
  assert.deepEqual(r.setScale(.5), { width: 500, height: 209 });
  assert.deepEqual(r.setScale(1), { width: 1000, height: 418 });
  assert.equal(r.scale, 1);
  assert.equal(gl.calls.compileShader, 8, "no shader recompiled by scale changes");
  assert.equal(gl.calls.linkProgram, 4);
  r.resize(1200, 502, 1); r.setScale(.7); r.resize(800, 335, 2);
  assert.equal(gl.calls.compileShader, 8, "no shader recompiled by resizes");
});

test("the pixel budget caps the base, then the render scale applies on top of the cap", () => {
  const gl = stubGL(), r = createRenderer(stubCanvas(gl), { maxPixels: 1e6 });
  const full = r.resize(2000, 837, 2);                 // 4000x1674 requested, far over budget
  assert.ok(full.width * full.height <= 1e6 * 1.01, `${full.width}x${full.height}`);
  const half = r.setScale(.5);
  assert.ok(Math.abs(half.width - full.width / 2) <= 1 && half.height < full.height, "lowering the scale still bites when the cap was binding");
});

test("manual scale option and device pixel ratio combine safely", () => {
  const gl = stubGL(), r = createRenderer(stubCanvas(gl), { scale: .5 });
  assert.deepEqual(r.resize(1000, 418, 2), { width: 1000, height: 418 });   // 0.5 x dpr 2 = 1
  assert.deepEqual(createRenderer(stubCanvas(stubGL()), { scale: .25 }).resize(1000, 418, 1), { width: 250, height: 105 });
});

test("hardware limits clamp the buffer, and tiny sizes keep a floor", () => {
  const gl = stubGL({ maxTexture: 1024 }), r = createRenderer(stubCanvas(gl), { maxPixels: 1e9 });
  const d = r.resize(4000, 1674, 2);
  assert.ok(d.width <= 1024 && d.height <= 1024, `${d.width}x${d.height}`);
  assert.ok(Math.abs(d.width / d.height - 4000 / 1674) < .05, "aspect preserved when clamped");
  const tiny = r.resize(10, 4, 1);
  assert.ok(tiny.width >= 32 && tiny.height >= 32);
  const bad = r.setScale(NaN); assert.ok(bad.width >= 32);
  assert.equal(r.scale, 1, "garbage scale falls back to 1");
  r.setScale(100); assert.equal(r.scale, 4, "scale is bounded");
});

test("info reports what a benchmark needs", () => {
  const r = createRenderer(stubCanvas(stubGL())); r.resize(960, 402, 1);
  const i = r.info();
  assert.equal(i.width, 960); assert.equal(i.renderScale, 1); assert.equal(i.shaderCompiles, 4);
  assert.ok(i.limits.maxTexture > 0 && Array.isArray(i.limits.maxViewport) && i.version && "floatTarget" in i && "compileMs" in i);
});
