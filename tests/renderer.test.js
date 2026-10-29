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
