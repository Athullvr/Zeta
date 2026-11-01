// Boot: wire the director, the renderer and the overlay to the page, own the animation loop, the layout and the governor.
// URL options (for review and measurement):
//   ?t=7.5      render one frame at that film time and stop   ?loop     play again at the end
//   ?act=3      start at act III (with ?t=5: the frame 5 s into act III, then stop)
//   ?scale=0.5  fix the base render scale (turns the governor off)   ?adapt=0  turn the governor off
//   ?bench      measure this machine: 4 s in each of six places across the film (?bench=2 for 2 s each)
//   ?debug      expose window.__eternal                         ?probe    pixel probes used by tests/browser-check.mjs
(function () {
  "use strict";
  const E = window.ETERNAL || {};
  const Q = new URLSearchParams(location.search);
  const $ = s => document.querySelector(s);
  const canvas = $("#c"), failEl = $("#fail"), textEl = $("#text");
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

  for (const k of ["util", "director", "script", "governor", "bench", "audio", "shaders", "renderer", "overlay", "film"]) {
    if (!E[k]) return fail("Missing source file", `The ${k} module did not load.`, "Check that every file listed in index.html is present next to it.");
  }

  const BENCH = Q.has("bench");
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const opts = { reduced };
  const director = E.director.createDirector(E.film.scenes, { loop: Q.has("loop") || BENCH });
  const audioConfig = E.audio.configFromQuery(Q);
  const playbackDuration = E.audio.resolveDuration(audioConfig, director.duration);
  // ?act=N starts at the beginning of act N; ?t= is film time, or, with ?act, time within that act. Either way the frame is
  // a pure function of that one number.
  const actStart = Q.has("act") ? director.actStart(Math.min(director.scenes.length, Math.max(1, parseInt(Q.get("act"), 10) || 1)) - 1) : 0;
  const fixedT = Q.has("t") ? actStart + (parseFloat(Q.get("t")) || 0) : null;
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

  // Normal playback owns one local audio element. Still renders, loops and benchmarks never load or start audio.
  const controls = $("#controls"), controlsEnabled = fixedT === null && !BENCH && !Q.has("loop") && !Q.has("probe");
  const audioStatus = $("#audio-status");
  let audioController = null;
  if (controlsEnabled) {
    const audioElement = new Audio();
    audioController = E.audio.createAudioController({
      audio: audioElement,
      AudioContext: window.AudioContext || window.webkitAudioContext,
      config: audioConfig,
      onStatus: status => { audioStatus.textContent = status; },
    });
    controls.hidden = false;
  }
  const seekEl = $("#film-seek"), timeEl = $("#film-time");
  seekEl.max = String(playbackDuration);
  const formatTime = seconds => {
    const s = Math.max(0, Math.floor(Number(seconds) || 0));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  };
  timeEl.textContent = `0:00 / ${formatTime(playbackDuration)}`;

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
  let paused = fixedT !== null || BENCH, rafId = 0, finished = false, seeking = false;
  const perf = { frames: 0, dts: [], last: 0 };

  function draw(t = clock.time()) {
    const visualTime = director.loop ? t : Math.min(playbackDuration, t);
    const frame = director.frameAt(visualTime, opts);
    // A configured shorter passage should still resolve to black at its own end instead of freezing mid-scene.
    if (!director.loop && playbackDuration < director.duration) {
      const fadeDuration = Math.min(5, playbackDuration);
      const fadeStart = playbackDuration - fadeDuration;
      const shortenedFade = E.util.smooth(E.util.seg(visualTime, fadeStart, playbackDuration));
      frame.post.uFade = Math.max(frame.post.uFade, shortenedFade);
    }
    renderer.render(frame);
    overlay.update(frame, frame.post.uFade);
    if (audioController) audioController.sync(visualTime, playbackDuration);
    finished = !director.loop && (frame.done || visualTime >= playbackDuration);
    if (controlsEnabled) {
      if (!seeking) seekEl.value = String(Math.min(playbackDuration, visualTime));
      timeEl.textContent = `${formatTime(visualTime)} / ${formatTime(playbackDuration)}`;
      updateControls();
    }
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
    const frame = draw(clock.time());
    if ((!frame.done && clock.time() < playbackDuration) || director.loop) rafId = requestAnimationFrame(tick);
    else {
      clock.pause(); clock.seek(playbackDuration); paused = true; finished = true;
      if (audioController) audioController.finish();
      updateControls();
    }
  }
  function startPlayback(at = 0) {
    const t = Math.max(0, Math.min(playbackDuration, Number(at) || 0));
    finished = false; paused = false; perf.last = 0; governor.reset(); clock.start(t);
    if (audioController) audioController.playAt(t, { silent: $("#silent-preview").checked, duration: playbackDuration });
    cancelAnimationFrame(rafId); draw(t); rafId = requestAnimationFrame(tick);
  }
  function restart() { startPlayback(0); }
  function pausePlayback() {
    if (!paused) clock.pause();
    paused = true; cancelAnimationFrame(rafId);
    if (audioController) audioController.pause();
    draw(clock.time()); updateControls();
  }
  function resumePlayback() {
    if (finished) return;
    startPlayback(clock.time());
  }
  function seekPlayback(t) {
    const at = Math.max(0, Math.min(playbackDuration, Number(t) || 0));
    clock.seek(at);
    if (audioController) audioController.seek(at, playbackDuration, !paused && !finished);
    draw(at);
    if (!paused && !finished && !rafId) rafId = requestAnimationFrame(tick);
  }
  function updateControls() {
    if (!controlsEnabled) return;
    $("#pause-film").disabled = paused || finished;
    $("#resume-film").disabled = !paused || finished;
  }
  document.addEventListener("visibilitychange", () => { perf.last = 0; governor.reset(); });

  if (controlsEnabled) {
    $("#play-film").addEventListener("click", () => startPlayback(0));
    $("#pause-film").addEventListener("click", pausePlayback);
    $("#resume-film").addEventListener("click", resumePlayback);
    $("#restart-film").addEventListener("click", restart);
    seekEl.addEventListener("pointerdown", () => { seeking = true; });
    seekEl.addEventListener("input", () => { seeking = true; seekPlayback(parseFloat(seekEl.value)); });
    seekEl.addEventListener("change", () => { seeking = false; });
    seekEl.addEventListener("pointerup", () => { seeking = false; });
    $("#music-volume").addEventListener("input", e => audioController.setVolume(parseFloat(e.target.value)));
    const mute = $("#mute-music");
    mute.addEventListener("click", () => {
      const next = mute.getAttribute("aria-pressed") !== "true";
      mute.setAttribute("aria-pressed", String(next));
      mute.textContent = next ? "Unmute" : "Mute";
      audioController.setMuted(next);
    });
    $("#silent-preview").addEventListener("change", e => audioController.setSilent(e.target.checked));
  }

  if (fixedT !== null) { clock.seek(fixedT); draw(); document.documentElement.dataset.ready = "1"; }
  else if (!BENCH) { clock.start(actStart); paused = false; rafId = requestAnimationFrame(tick); document.documentElement.dataset.ready = "1"; updateControls(); }

  addEventListener("keydown", e => { if ((e.key === "r" || e.key === "R") && fixedT === null && !BENCH) restart(); });
  addEventListener("pointerdown", e => { if (finished && fixedT === null && !BENCH && !controls.contains(e.target)) restart(); });

  function report(obj) {
    const r = document.createElement("pre");
    r.id = "report"; r.hidden = true; r.textContent = JSON.stringify(obj);
    document.body.appendChild(r);
    document.documentElement.dataset.reported = "1";
    console.log("ETERNAL_REPORT " + r.textContent);
  }

  // ---------- ?bench ----------
  // Stage 1 plays short windows of the film in the real requestAnimationFrame loop (governor off, scale as set), one in each
  // act and one at the storm's climax, because the acts do not cost the same. Stage 2 renders frames back to back at the same
  // moments, synchronised with a read-back, which ignores vsync. The two are reported apart.
  const BENCH_AT = [12, 40, 70, 96, 112, 140];     // film seconds: act I, II, III, the storm gathering, the climax, act V
  function runBench() {
    const per = Math.min(20, Math.max(1, parseFloat(Q.get("bench")) || 4));
    const warnings = [];
    if (document.hidden) warnings.push("The tab is hidden: the browser throttles requestAnimationFrame, so stage 1 will be wrong.");
    if (scaleOpt.manual) warnings.push(`Manual ?scale=${scaleOpt.manual} is in effect.`);
    const panel = document.createElement("pre");
    panel.id = "benchPanel"; panel.textContent = `ETERNAL benchmark: sampling the real animation loop, ${per} s at each of ${BENCH_AT.length} places in the film. Keep this tab in front.`;
    document.body.appendChild(panel);

    const windows = BENCH_AT.map(() => []), all = [];
    let w = 0, last = 0, start = 0;
    function loop(now) {
      if (!start) { start = now; last = 0; }
      const el = (now - start) / 1000;
      if (last && el > .0) { const dt = now - last; if (windows[w].length || el > .1) windows[w].push(dt); }
      last = now;
      draw(BENCH_AT[w] + el);
      if (el < per) requestAnimationFrame(loop);
      else if (++w < BENCH_AT.length) { start = 0; requestAnimationFrame(loop); }
      else finishBench();
    }
    requestAnimationFrame(loop);

    function finishBench() {
      const per3 = windows.map(a => a.slice(3));                        // the first frames of a window are warm-up
      for (const a of per3) all.push(...a);
      const animationLoop = E.bench.frameStats(all);
      animationLoop.windows = per3.map((a, i) => Object.assign({ at: BENCH_AT[i] }, E.bench.frameStats(a)));
      panel.textContent = "Measuring synchronous render cost...";
      setTimeout(() => {
        const samples = [];
        for (const t of BENCH_AT) {
          renderer.render(director.frameAt(t, opts)); renderer.finish();
          const t0 = performance.now(), n = 8;
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
      renderer, governor, director, clock, perf, layout, frameSize, audioController, playbackDuration,
      info: renderer.info,
      avgFps() { const d = perf.dts; return d.length ? Math.round(1000 / (d.reduce((a, b) => a + b, 0) / d.length)) : 0; },
      setScale(s) { const r = renderer.setScale(s); publishScale(); if (paused) draw(); return r; },
      seek(t) { clock.seek(t); paused = true; cancelAnimationFrame(rafId); if (audioController) audioController.pause(); return draw(); },
      stop() { cancelAnimationFrame(rafId); paused = true; if (audioController) audioController.pause(); },
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
