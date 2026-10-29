// Pure helpers for ?bench: frame-time statistics, a careful hardware/software verdict, and the text report.
// No DOM and no WebGL here, so all of it is unit-tested in node. main.js does the measuring.
(function (root) {
  "use strict";

  const pct = (sorted, p) => sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] : 0;
  const r1 = x => Math.round(x * 10) / 10;

  // dts: frame-to-frame times in ms from requestAnimationFrame timestamps.
  function frameStats(dts) {
    const n = dts.length;
    if (!n) return { frames: 0 };
    const s = dts.slice().sort((a, b) => a - b);
    const sum = dts.reduce((a, b) => a + b, 0), avg = sum / n;
    const variance = dts.reduce((a, b) => a + (b - avg) * (b - avg), 0) / n;
    const refresh = Math.min(34, Math.max(6.5, pct(s, .05)));          // the display's own interval, estimated
    const p99 = pct(s, .99);
    return {
      frames: n, seconds: r1(sum / 1000), avgMs: r1(avg), avgFps: r1(1000 / avg), medianMs: r1(pct(s, .5)), p95Ms: r1(pct(s, .95)), p99Ms: r1(p99),
      minMs: r1(s[0]), maxMs: r1(s[n - 1]), stdevMs: r1(Math.sqrt(variance)), onePercentLowFps: r1(1000 / p99),
      estimatedRefreshMs: r1(refresh), estimatedRefreshHz: Math.round(1000 / refresh),
      slowFrames: dts.filter(d => d > refresh * 1.5).length,           // frames that took over 1.5 display intervals
    };
  }

  // Is this rendering in software? Only says "software" when it is sure; otherwise "hardware-likely" or "unknown".
  // renderer: the unmasked WebGL renderer string, if the browser exposes it. caveat: true if a context created with
  // failIfMajorPerformanceCaveat was refused (the browser itself says this would be slow software rendering).
  const SOFTWARE = /swiftshader|llvmpipe|softpipe|lavapipe|software|microsoft basic render|basic render driver|mesa offscreen|\bcpu\b|angle \(.*\bsubzero\b/i;
  function classifyRenderer(renderer, caveat) {
    if (caveat === true) return { kind: "software", reason: "the browser refused a failIfMajorPerformanceCaveat context, which it does for software rendering" };
    if (renderer && SOFTWARE.test(renderer)) return { kind: "software", reason: `renderer name "${renderer}" is a known software rasterizer` };
    if (!renderer) return { kind: "unknown", reason: "the browser does not expose the GPU name (WEBGL_debug_renderer_info is unavailable)" };
    return { kind: "hardware-likely", reason: "the renderer name is not a known software rasterizer; a page cannot prove it is hardware" };
  }

  // Synchronous back-to-back rendering: a different measurement from frame pacing, and labelled as such.
  function syncSummary(samples) {          // samples: [{ t, ms }]
    const ms = samples.map(s => s.ms);
    return { perTime: samples.map(s => ({ t: s.t, ms: r1(s.ms) })), meanMs: r1(ms.reduce((a, b) => a + b, 0) / (ms.length || 1)), worstMs: r1(Math.max(0, ...ms)) };
  }

  function formatReport(r) {
    const L = [], a = r.animationLoop, y = r.synchronous, e = r.environment;
    L.push("ETERNAL benchmark", "");
    L.push(`Browser        ${e.userAgent}`);
    L.push(`Platform       ${e.platform}, ${e.hardwareConcurrency || "?"} logical cores${e.deviceMemory ? ", " + e.deviceMemory + " GB (rounded by the browser)" : ""}`);
    L.push(`GPU renderer   ${r.gl.renderer}${r.gl.vendor ? "  (" + r.gl.vendor + ")" : ""}`);
    L.push(`Rendering      ${r.verdict.kind.toUpperCase()}: ${r.verdict.reason}`);
    L.push(`WebGL          ${r.gl.version}; ${r.gl.shadingLanguage}`);
    L.push(`Capabilities   float render target: ${r.gl.floatTarget ? "yes (RGBA16F)" : "no (RGBA8, may show banding)"}; extensions: ${r.gl.extensions.join(", ") || "none of interest"}`);
    L.push(`Limits         texture ${r.gl.limits.maxTexture}, renderbuffer ${r.gl.limits.maxRenderbuffer}, viewport ${r.gl.limits.maxViewport.join("x")}`);
    L.push(`Shader setup   ${r.gl.compileMs} ms for ${r.gl.shaderCompiles} programs, once at start (the driver may finish compiling lazily at the first draw)`);
    L.push(`Viewport       ${e.viewport.join("x")} CSS px, devicePixelRatio ${e.devicePixelRatio}; frame ${e.frame.join("x")} CSS px`);
    L.push(`Drawing buffer ${r.gl.width}x${r.gl.height} px (${(r.gl.width * r.gl.height / 1e6).toFixed(2)} MP), render scale ${r.scale.toFixed(2)}, ${r.governor}`);
    L.push("");
    L.push(`1. Real animation loop (requestAnimationFrame), ${a.frames} frames over ${a.seconds} s of the film`);
    if (a.frames < 10) L.push("   Too few frames: the tab was hidden, throttled or the page was not drawing. Re-run with the tab in front.");
    else {
      L.push(`   ${a.avgFps} fps average (${a.avgMs} ms), median ${a.medianMs} ms, 95th percentile ${a.p95Ms} ms, 99th ${a.p99Ms} ms, worst ${a.maxMs} ms`);
      L.push(`   1% low ${a.onePercentLowFps} fps; display looks like ${a.estimatedRefreshHz} Hz; ${a.slowFrames} frames took over 1.5 display intervals`);
      if (a.windows) for (const w of a.windows) if (w.frames) L.push(`   film t=${String(w.at).padStart(3)} s: ${String(w.avgFps).padStart(5)} fps avg, 95th percentile ${w.p95Ms} ms, worst ${w.maxMs} ms`);
      L.push("   This is what you see. It is capped by your display's refresh rate and includes browser compositing.");
    }
    L.push("");
    L.push("2. Synchronous back-to-back rendering (not frame pacing)");
    L.push(`   ${y.meanMs} ms per frame on average, worst moment ${y.worstMs} ms: ${y.perTime.map(p => `t=${p.t}s ${p.ms}`).join(", ")}`);
    L.push("   Draws frames one after another with a pixel read-back after each batch, so it ignores vsync. It is closer to raw render cost,");
    L.push("   but it also includes JavaScript and read-back overhead, so it is not a pure GPU time.");
    L.push("");
    L.push(`GL errors: ${r.glErrors.length ? r.glErrors.join(", ") : "none"}`);
    if (r.warnings.length) L.push("Notes:", ...r.warnings.map(w => "  - " + w));
    return L.join("\n");
  }

  const api = { frameStats, classifyRenderer, syncSummary, formatReport };
  if (typeof module === "object" && module.exports) module.exports = api;
  else (root.ETERNAL = root.ETERNAL || {}).bench = api;
})(typeof self !== "undefined" ? self : globalThis);
