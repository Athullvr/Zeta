// Boot: wire the director, the renderer and the overlay to the page, own the animation loop and the layout.
// URL options (for review and screenshots):  ?t=7.5  render one frame at that time and stop
//                                            ?loop   play again at the end        ?scale=0.5  render scale
//                                            ?debug  expose window.__eternal and print a report
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

  for (const k of ["util", "director", "shaders", "renderer", "overlay", "scenes"]) {
    if (!E[k]) return fail("Missing source file", `The ${k} module did not load.`, "Check that every file listed in index.html is present next to it.");
  }

  const fixedT = Q.has("t") ? parseFloat(Q.get("t")) : null;
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const opts = { reduced };
  const director = E.director.createDirector([E.scenes.opening], { loop: Q.has("loop") });

  let renderer;
  try {
    renderer = E.renderer.createRenderer(canvas, {
      scale: parseFloat(Q.get("scale")) || 1,
      preserveDrawingBuffer: fixedT !== null,
      onContextLost: () => fail("Graphics context lost", "The browser stopped the graphics device. Reload the page to start again."),
    });
  } catch (e) {
    return fail(e.kind === "webgl2-unavailable" ? "WebGL2 is not available" : "Could not start the renderer", e.message, e.details || String(e.stack || e));
  }

  const overlay = E.overlay.createOverlay(textEl);

  // ---------- layout: a 2.39:1 frame centred between black bars ----------
  function layout() {
    const vw = innerWidth, vh = innerHeight;
    let fw = vw, fh = Math.round(vw / ASPECT);
    if (fh > vh) { fh = vh; fw = Math.round(vh * ASPECT); }
    const s = document.documentElement.style;
    s.setProperty("--fw", fw + "px"); s.setProperty("--fh", fh + "px");
    renderer.resize(fw, fh, Math.min(devicePixelRatio || 1, 2));
  }
  addEventListener("resize", () => { layout(); if (paused) draw(); });
  layout();

  // ---------- clock and loop ----------
  const clock = E.director.createClock(() => performance.now());
  let paused = fixedT !== null, rafId = 0, replayShown = false;
  const perf = { frames: 0, dts: [], last: 0 };

  function draw() {
    const frame = director.frameAt(clock.time(), opts);
    renderer.render(frame);
    overlay.update(frame, frame.uniforms.uFade);
    if (frame.done && !replayShown) { replayShown = true; hintEl.hidden = false; }
    return frame;
  }
  function tick(now) {
    if (perf.last) { perf.dts.push(now - perf.last); if (perf.dts.length > 240) perf.dts.shift(); }
    perf.last = now; perf.frames++;
    const frame = draw();
    if (!frame.done || director.loop) rafId = requestAnimationFrame(tick);
  }
  function restart() { replayShown = false; hintEl.hidden = true; perf.last = 0; clock.start(0); cancelAnimationFrame(rafId); rafId = requestAnimationFrame(tick); }

  if (fixedT !== null) { clock.seek(fixedT); draw(); document.documentElement.dataset.ready = "1"; }
  else { clock.start(0); rafId = requestAnimationFrame(tick); document.documentElement.dataset.ready = "1"; }

  addEventListener("keydown", e => { if ((e.key === "r" || e.key === "R") && fixedT === null) restart(); });
  addEventListener("pointerdown", () => { if (replayShown && fixedT === null) restart(); });

  // ---------- debugging hooks ----------
  if (Q.has("debug") || Q.has("bench")) {
    const avgFps = () => { const d = perf.dts; return d.length ? Math.round(1000 / (d.reduce((a, b) => a + b, 0) / d.length)) : 0; };
    window.__eternal = {
      info: renderer.info, director, clock, avgFps,
      seek(t) { clock.seek(t); paused = true; cancelAnimationFrame(rafId); return draw(); },
      // time n back-to-back frames across the film, synced to the GPU; returns ms per frame
      bench(n = 30) {
        const t0 = performance.now();
        for (let i = 0; i < n; i++) { renderer.render(director.frameAt(i / n * director.duration, opts)); }
        renderer.finish();
        return (performance.now() - t0) / n;
      },
    };
  }
  if (Q.has("bench")) {
    cancelAnimationFrame(rafId); paused = true;
    const ms = window.__eternal.bench(12);
    const r = document.createElement("pre");
    r.id = "report"; r.textContent = JSON.stringify({ msPerFrame: +ms.toFixed(2), info: renderer.info() });
    document.body.appendChild(r);
  }
})();
