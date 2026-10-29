// Boot: wire the director, the renderer and the overlay to the page, own the animation loop, the layout and the governor.
// URL options (for review and measurement):
//   ?t=7.5      render one frame at that time and stop        ?loop     play again at the end
//   ?scale=0.5  fix the base render scale (turns the governor off)   ?adapt=0  turn the governor off
//   ?bench      measure this machine (add =20 for a 20 s sample, default is the length of the film)
//   ?debug      expose window.__eternal                         ?probe    pixel probes used by tests/browser-check.mjs
(function () {
  "use strict";
  const E = window.ETERNAL || {};
  const Q = new URLSearchParams(location.search);
  const $ = s => document.querySelector(s);
  const frameEl = $("#frame"), canvas = $("#c"), failEl = $("#fail"), textEl = $("#text"), hintEl = $("#hint");
  const ASPECT = 2.39;

  function fail(title, message, details) {
    failEl.hidden = false;
    failEl.querySelector("h1").textContent = title;
    failEl.querySelector("p").textContent = message;
    failEl.querySelector("pre").textContent = details || "";
    document.documentElement.classList.add("failed");
    document.title = "ETERNAL: could not start";
    if (details) console.error(title + "\n" + details);
  }

  for (const k of ["util", "director", "governor", "bench", "shaders", "renderer", "overlay", "scenes"]) {
    if (!E[k]) return fail("Missing source file", `The ${k} module did not load.`, "Check that every file listed in index.html is present next to it.");
  }

  const fixedT = Q.has("t") ? parseFloat(Q.get("t")) : null;
  const BENCH = Q.has("bench");
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const opts = { reduced };
  const director = E.director.createDirector([E.scenes.opening], { loop: Q.has("loop") || BENCH });
  const scaleOpt = E.governor.parseScaleOptions(Q);

  let renderer;
  try {
    renderer = E.renderer.createRenderer(canvas, {
      scale: scaleOpt.manual || 1,
      preserveDrawingBuffer: fixedT !== null,
      onContextLost: () => fail("Graphics context lost", "The browser stopped the graphics device. Reload the page to start again."),
    });
  } catch (e) {
    return fail(e.kind === "webgl2-unavailable" ? "WebGL2 is not available" : "Could not start the renderer", e.message, e.details || String(e.stack || e));
  }

  const overlay = E.overlay.createOverlay(textEl);

  // The governor only runs in the live loop, never for stills, benchmarks or when the scale is set by hand.
  const governor = E.governor.createGovernor({ enabled: scaleOpt.adapt && fixedT === null && !BENCH, min: .5, max: 1 });
  const publishScale = () => { document.documentElement.dataset.renderScale = renderer.scale.toFixed(2); };

  // ---------- layout: a 2.39:1 frame centred between black bars ----------
  const frameSize = [0, 0];
  function layout() {
    const vw = innerWidth, vh = innerHeight;
    let fw = vw, fh = Math.round(vw / ASPECT);
    if (fh > vh) { fh = vh; fw = Math.round(vh * ASPECT); }
    const s = document.documentElement.style;
    s.setProperty("--fw", fw + "px"); s.setProperty("--fh", fh + "px");
    frameSize[0] = fw; frameSize[1] = fh;
    renderer.resize(fw, fh, Math.min(devicePixelRatio || 1, 2));
    publishScale();
  }
  addEventListener("resize", () => { layout(); governor.reset(); if (paused) draw(); });
  layout();

  // ---------- clock and loop ----------
  const clock = E.director.createClock(() => performance.now());
  let paused = fixedT !== null || BENCH, rafId = 0, replayShown = false;
  const perf = { frames: 0, dts: [], last: 0 };

  function draw() {
    const frame = director.frameAt(clock.time(), opts);
    renderer.render(frame);
    overlay.update(frame, frame.uniforms.uFade);
    if (frame.done && !replayShown) { replayShown = true; hintEl.hidden = false; }
    return frame;
  }
  function tick(now) {
    if (perf.last) {
      const dt = now - perf.last;
      perf.dts.push(dt); if (perf.dts.length > 240) perf.dts.shift();
      const s = governor.sample(dt, now);
      if (s !== null) { renderer.setScale(s); publishScale(); }
    }
    perf.last = now; perf.frames++;
    const frame = draw();
    if (!frame.done || director.loop) rafId = requestAnimationFrame(tick);
  }
  function restart() { replayShown = false; hintEl.hidden = true; perf.last = 0; governor.reset(); clock.start(0); cancelAnimationFrame(rafId); rafId = requestAnimationFrame(tick); }
  document.addEventListener("visibilitychange", () => { perf.last = 0; governor.reset(); });

  if (fixedT !== null) { clock.seek(fixedT); draw(); document.documentElement.dataset.ready = "1"; }
  else if (!BENCH) { clock.start(0); rafId = requestAnimationFrame(tick); document.documentElement.dataset.ready = "1"; }

  addEventListener("keydown", e => { if ((e.key === "r" || e.key === "R") && fixedT === null && !BENCH) restart(); });
  addEventListener("pointerdown", () => { if (replayShown && fixedT === null && !BENCH) restart(); });

  function report(obj) {
    const r = document.createElement("pre");
    r.id = "report"; r.hidden = true; r.textContent = JSON.stringify(obj);
    document.body.appendChild(r);
    document.documentElement.dataset.reported = "1";
    console.log("ETERNAL_REPORT " + r.textContent);
  }

  // ---------- ?bench ----------
  // Stage 1 plays the film in the real requestAnimationFrame loop (governor off, scale as set) and records frame times.
  // Stage 2 renders frames back to back, synchronised with a read-back, which ignores vsync. The two are reported apart.
  function runBench() {
    const seconds = Math.min(120, Math.max(3, parseFloat(Q.get("bench")) || director.duration));
    const warnings = [];
    if (document.hidden) warnings.push("The tab is hidden: the browser throttles requestAnimationFrame, so stage 1 will be wrong.");
    if (scaleOpt.manual) warnings.push(`Manual ?scale=${scaleOpt.manual} is in effect.`);
    const panel = document.createElement("pre");
    panel.id = "benchPanel"; panel.textContent = `ETERNAL benchmark: sampling the real animation loop for ${seconds} s. Keep this tab in front.`;
    document.body.appendChild(panel);

    const dts = []; let last = 0, start = 0;
    clock.start(0);
    function loop(now) {
      if (!start) start = now;
      if (last) dts.push(now - last);
      last = now;
      draw();
      if (now - start < seconds * 1000) requestAnimationFrame(loop); else finishBench();
    }
    requestAnimationFrame(loop);

    function finishBench() {
      const animationLoop = E.bench.frameStats(dts.slice(10));      // the first frames are warm-up
      panel.textContent = "Measuring synchronous render cost...";
      setTimeout(() => {
        const samples = [];
        for (const t of [2, 5, 8, 11, 13]) {
          renderer.render(director.frameAt(t, opts)); renderer.finish();
          const t0 = performance.now(), n = 12;
          for (let i = 0; i < n; i++) renderer.render(director.frameAt(t, opts));
          renderer.finish();
          samples.push({ t, ms: (performance.now() - t0) / n });
        }
        const gl = renderer.info();
        let caveat = null;
        try { caveat = !document.createElement("canvas").getContext("webgl2", { failIfMajorPerformanceCaveat: true }); } catch (e) { caveat = null; }
        const verdict = E.bench.classifyRenderer(gl.renderer, caveat);
        if (verdict.kind === "software") warnings.push("Software rendering: these numbers describe a CPU rasterizer, not your GPU.");
        if (!gl.floatTarget) warnings.push("No float render target: dark gradients may show banding.");
        const result = {
          environment: {
            userAgent: navigator.userAgent, platform: navigator.platform, hardwareConcurrency: navigator.hardwareConcurrency, deviceMemory: navigator.deviceMemory || null,
            devicePixelRatio: devicePixelRatio, viewport: [innerWidth, innerHeight], frame: frameSize.slice(),
          },
          gl, verdict, scale: renderer.scale, governor: "governor off during the benchmark",
          animationLoop, synchronous: E.bench.syncSummary(samples), glErrors: renderer.drainErrors(), warnings,
        };
        panel.textContent = E.bench.formatReport(result);
        report(result);
      }, 50);
    }
  }
  if (BENCH) runBench();

  // ---------- debugging hooks ----------
  if (Q.has("debug") || BENCH || Q.has("probe")) {
    window.__eternal = {
      renderer, governor, director, clock, perf, layout, frameSize,
      info: renderer.info,
      avgFps() { const d = perf.dts; return d.length ? Math.round(1000 / (d.reduce((a, b) => a + b, 0) / d.length)) : 0; },
      setScale(s) { const r = renderer.setScale(s); publishScale(); if (paused) draw(); return r; },
      seek(t) { clock.seek(t); paused = true; cancelAnimationFrame(rafId); return draw(); },
      stop() { cancelAnimationFrame(rafId); paused = true; },
    };
  }

  // ?probe: render with the camera pinned at two moments and measure how much each region of the picture changes,
  // so animation of the moon, clouds, mist and castle is measured separately from the camera push-in.
  if (Q.has("probe")) {
    cancelAnimationFrame(rafId); paused = true;
    const gl = renderer.gl, W = canvas.width, H = canvas.height;
    const REGIONS = { moon: [.60, .30, .70, .45], clouds: [.08, .12, .30, .30], mist: [.20, .78, .50, .86], castle: [.45, .38, .62, .62], sky: [.80, .10, .95, .25] };
    const grab = (t, over) => {
      const f = director.frameAt(t, opts);
      Object.assign(f.uniforms, { uCam: [0, 0, 1.1, 0], uGrain: 0 }, over || {});
      renderer.render(f);
      const px = new Uint8Array(W * H * 4);
      gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, px);
      return px;
    };
    const region = ([x0, y0, x1, y1]) => { const out = []; for (let y = Math.floor((1 - y1) * H); y < Math.floor((1 - y0) * H); y += 2) for (let x = Math.floor(x0 * W); x < Math.floor(x1 * W); x += 2) out.push((y * W + x) * 4); return out; };
    const diff = (a, b, idx) => { let d = 0; for (const i of idx) d += Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]); return +(d / idx.length / 3).toFixed(3); };
    const mean = (a, idx) => { let d = 0; for (const i of idx) d += (a[i] + a[i + 1] + a[i + 2]) / 3; return +(d / idx.length).toFixed(2); };
    const out = { size: [W, H], renderer: renderer.info().renderer, floatTarget: renderer.info().floatTarget, moments: {} };
    for (const t0 of [5, 8, 11]) {
      const a = grab(t0), a2 = grab(t0), b = grab(t0 + .6), c3 = grab(t0 + 2);
      const m = { identicalRerender: a.every((v, i) => v === a2[i]), change: {}, change2s: {}, brightness: {} };
      for (const [k, r] of Object.entries(REGIONS)) { const idx = region(r); m.change[k] = diff(a, b, idx); m.change2s[k] = diff(a, c3, idx); m.brightness[k] = mean(a, idx); }
      out.moments[t0] = m;
    }
    out.timeline = [0, 1, 2, 3, 5, 7, 9, 11, 13, 14.5].map(t => { const p = grab(t, {}); return [t, mean(p, region([0, 0, 1, 1]))]; });
    report(out);
  }
})();
