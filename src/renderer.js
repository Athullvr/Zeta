


// The renderer accepts a frame description ({ t, uniforms }) and draws it. It knows nothing about scenes, poetry or time.
// Two passes: the scene program into an offscreen texture (half float when the GPU allows, so dark gradients do not band),
// then the post program to the canvas, reading that texture's mip chain for bloom. Programs are built once, at startup.
(function (root) {
  "use strict";
  const SH = typeof module === "object" && module.exports ? require("./shaders.js") : root.ETERNAL.shaders;

  class EternalError extends Error {
    constructor(kind, message, details = "") { super(message); this.name = "EternalError"; this.kind = kind; this.details = details; }
  }

  // Turn a driver's compile log into something a person can act on: the log plus the offending source lines.
  function formatShaderLog(label, source, log) {
    const lines = source.split("\n"), out = [`${label}:`, (log || "(no log from the driver)").trim()];
    const seen = new Set();
    for (const m of (log || "").matchAll(/(?:ERROR|WARNING):\s*\d+:(\d+):/g)) {
      const n = +m[1];
      if (seen.has(n) || n < 1 || n > lines.length) continue;
      seen.add(n);
      out.push(`  ${String(n).padStart(4)} | ${lines[n - 1].trim().slice(0, 160)}`);
      if (seen.size >= 6) break;
    }
    return out.join("\n");
  }

  function setUniform(gl, loc, type, v) {
    if (type === "float") gl.uniform1f(loc, v);
    else if (type === "vec2") gl.uniform2f(loc, v[0], v[1]);
    else if (type === "vec4") gl.uniform4f(loc, v[0], v[1], v[2], v[3]);
    else throw new EternalError("internal", `unsupported uniform type ${type}`);
  }

  function createRenderer(canvas, options = {}) {
    const gl = canvas.getContext("webgl2", {
      antialias: false, alpha: false, depth: false, stencil: false,
      powerPreference: "high-performance", preserveDrawingBuffer: !!options.preserveDrawingBuffer,
    });
    if (!gl) throw new EternalError("webgl2-unavailable", "This film needs WebGL2, and this browser or device does not provide it.",
      "Try a current version of Chrome, Edge, Firefox or Safari, with hardware acceleration enabled.");

    // ---------- programs: compile everything first, then check, so the driver can work in parallel ----------
    const compileStart = (typeof performance !== "undefined" ? performance.now() : 0);
    const sources = { scene: SH.SCENE_FRAG, post: SH.POST_FRAG };
    const pending = {};
    for (const name of Object.keys(sources)) {
      const vs = gl.createShader(gl.VERTEX_SHADER), fs = gl.createShader(gl.FRAGMENT_SHADER);
      gl.shaderSource(vs, SH.VERT); gl.compileShader(vs);
      gl.shaderSource(fs, sources[name]); gl.compileShader(fs);
      const prog = gl.createProgram();
      gl.attachShader(prog, vs); gl.attachShader(prog, fs); gl.linkProgram(prog);
      pending[name] = { prog, vs, fs };
    }
    const problems = [], programs = {};
    for (const [name, p] of Object.entries(pending)) {
      let bad = false;
      if (!gl.getShaderParameter(p.vs, gl.COMPILE_STATUS)) { bad = true; problems.push(formatShaderLog(`${name} vertex shader`, SH.VERT, gl.getShaderInfoLog(p.vs))); }
      if (!gl.getShaderParameter(p.fs, gl.COMPILE_STATUS)) { bad = true; problems.push(formatShaderLog(`${name} fragment shader`, sources[name], gl.getShaderInfoLog(p.fs))); }
      else if (!bad && !gl.getProgramParameter(p.prog, gl.LINK_STATUS)) { bad = true; problems.push(`${name} program failed to link:\n${gl.getProgramInfoLog(p.prog)}`); }
      if (bad) continue;
      const locs = {};
      for (const [u, type] of Object.entries(SH.PROGRAM_UNIFORMS[name])) locs[u] = { loc: gl.getUniformLocation(p.prog, u), type };
      programs[name] = { prog: p.prog, locs };
    }
    const compileMs = (typeof performance !== "undefined" ? performance.now() : 0) - compileStart;
    if (problems.length) throw new EternalError("shader-compile", "A shader failed to compile.", problems.join("\n\n"));

    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);

    // ---------- offscreen target ----------
    const floatTarget = !!gl.getExtension("EXT_color_buffer_float");
    let tex = null, fbo = null, W = 0, H = 0;
    function allocTarget(w, h) {
      if (tex) gl.deleteTexture(tex);
      if (fbo) gl.deleteFramebuffer(fbo);
      const levels = Math.floor(Math.log2(Math.max(w, h))) + 1;
      tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texStorage2D(gl.TEXTURE_2D, levels, floatTarget ? gl.RGBA16F : gl.RGBA8, w, h);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      fbo = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE)
        throw new EternalError("framebuffer", "The graphics device could not create the offscreen render target.", `${w}x${h}, ${floatTarget ? "RGBA16F" : "RGBA8"}`);
    }

    // Hardware limits on the drawing buffer. Both the offscreen texture and the canvas must fit.
    const limits = (() => {
      const vp = gl.getParameter(gl.MAX_VIEWPORT_DIMS);
      return { maxTexture: gl.getParameter(gl.MAX_TEXTURE_SIZE), maxRenderbuffer: gl.getParameter(gl.MAX_RENDERBUFFER_SIZE), maxViewport: [vp[0], vp[1]] };
    })();
    const maxSide = Math.min(limits.maxTexture, limits.maxRenderbuffer, limits.maxViewport[0], limits.maxViewport[1]);

    // Size the drawing buffer for a CSS box. The order matters:
    //   1. base = the manual ?scale (default 1) times the device pixel ratio
    //   2. the pixel budget (maxPixels) and the hardware side limit cap that, so a 4K screen is affordable
    //   3. the governor's render scale multiplies the result, so lowering it always makes the buffer smaller
    // The canvas is styled to fill its box, so none of this changes what is shown, only how sharp it is.
    let renderScale = 1, lastCss = null;
    function resize(cssW, cssH, dpr = 1) {
      lastCss = [cssW, cssH, dpr];
      const maxPixels = options.maxPixels || 2.6e6;
      let k = Math.max(.25, (options.scale || 1) * dpr);
      const px = cssW * cssH * k * k;
      if (px > maxPixels) k *= Math.sqrt(maxPixels / px);
      k = Math.min(k, maxSide / Math.max(cssW, cssH, 1));
      k *= renderScale;
      const w = Math.max(32, Math.min(maxSide, Math.round(cssW * k))), h = Math.max(32, Math.min(maxSide, Math.round(cssH * k)));
      if (w === W && h === H) return { width: W, height: H };
      W = canvas.width = w; H = canvas.height = h;
      allocTarget(w, h);
      return { width: W, height: H };
    }
    // Change only the render scale (the governor's job): buffers are reallocated, shaders are not touched.
    function setScale(s) {
      renderScale = Math.min(4, Math.max(.1, +s || 1));
      return lastCss ? resize(lastCss[0], lastCss[1], lastCss[2]) : { width: W, height: H };
    }

    let warned = new Set();
    function apply(name, values) {
      for (const [u, { loc, type }] of Object.entries(programs[name].locs)) {
        const v = values[u];
        if (v === undefined) { if (!warned.has(u)) { warned.add(u); console.warn(`uniform ${u} has no value`); } continue; }
        if (loc !== null) setUniform(gl, loc, type, v);
      }
    }

    // frame: { t, uniforms }. Shared uniforms (uRes, uTime) come from the renderer, the rest from the scene.
    function render(frame) {
      if (!W) throw new EternalError("internal", "render() called before resize()");
      const values = Object.assign({}, frame.uniforms, { uTime: frame.t });
      gl.bindVertexArray(vao);

      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.viewport(0, 0, W, H);
      gl.useProgram(programs.scene.prog);
      apply("scene", Object.assign({ uRes: [W, H] }, values));
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.generateMipmap(gl.TEXTURE_2D);

      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, W, H);
      gl.useProgram(programs.post.prog);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.uniform1i(gl.getUniformLocation(programs.post.prog, "uScene"), 0);
      apply("post", Object.assign({ uRes: [W, H] }, values));
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }

    function debugInfo() {
      const ext = gl.getExtension("WEBGL_debug_renderer_info");
      return {
        renderer: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
        vendor: ext ? gl.getParameter(ext.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR),
        unmasked: !!ext,
      };
    }
    // GL errors since the last call (the browser keeps only one pending code per type, so this is a sample, not a log)
    function drainErrors() {
      const names = { [gl.INVALID_ENUM]: "INVALID_ENUM", [gl.INVALID_VALUE]: "INVALID_VALUE", [gl.INVALID_OPERATION]: "INVALID_OPERATION", [gl.OUT_OF_MEMORY]: "OUT_OF_MEMORY", [gl.INVALID_FRAMEBUFFER_OPERATION]: "INVALID_FRAMEBUFFER_OPERATION", [gl.CONTEXT_LOST_WEBGL]: "CONTEXT_LOST" };
      const out = [];
      for (let i = 0, e; i < 8 && (e = gl.getError()) !== gl.NO_ERROR; i++) out.push(names[e] || String(e));
      return out;
    }
    const info = () => Object.assign({
      width: W, height: H, renderScale, floatTarget, programs: Object.keys(programs), compileMs: +compileMs.toFixed(1),
      shaderCompiles: Object.keys(programs).length,   // fixed at creation: resizing and rescaling never compile
      version: gl.getParameter(gl.VERSION), shadingLanguage: gl.getParameter(gl.SHADING_LANGUAGE_VERSION), limits,
      extensions: ["EXT_color_buffer_float", "OES_texture_float_linear", "KHR_parallel_shader_compile", "WEBGL_debug_renderer_info"].filter(n => gl.getSupportedExtensions().includes(n)),
    }, debugInfo());
    const sink = new Uint8Array(4);
    function finish() { gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, sink); }   // gl.finish() does not block in Chrome; a read-back does

    canvas.addEventListener("webglcontextlost", e => { e.preventDefault(); if (options.onContextLost) options.onContextLost(); });
    return { resize, setScale, render, info, finish, drainErrors, gl, get scale() { return renderScale; } };
  }

  const api = { createRenderer, formatShaderLog, EternalError };
  if (typeof module === "object" && module.exports) module.exports = api;
  else (root.ETERNAL = root.ETERNAL || {}).renderer = api;
})(typeof self !== "undefined" ? self : globalThis);
