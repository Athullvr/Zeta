// Drives the real page in headless Chromium over the DevTools protocol (software WebGL2 via SwiftShader) and checks what
// node cannot: shader compilation, determinism, region-by-region animation, the governor in the REAL animation loop,
// resize and scale changes through the live pipeline, ?bench, and the no-WebGL2 message. Writes tests/shots/.
// Everything measured here is SOFTWARE rendering: it proves the pipeline works, not how fast your GPU is.
// Usage: node tests/browser-check.mjs        (CHROME=/path/to/chrome-headless-shell to override)
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import assert from "node:assert/strict";
import { findChrome, launch } from "./cdp.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const INDEX = pathToFileURL(join(ROOT, "index.html")).href;
const SHOTS = join(ROOT, "tests", "shots");
const CHROME = findChrome();
if (!CHROME) { console.log("SKIP: no headless Chromium found (set CHROME=...)"); process.exit(0); }
mkdirSync(SHOTS, { recursive: true });

let failures = 0;
const check = async (name, fn) => { try { await fn(); console.log("ok   ", name); } catch (e) { failures++; console.log("FAIL ", name, "\n     ", String(e.message).split("\n")[0]); } };
const note = s => console.log("      " + s);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const J = v => JSON.stringify(v);

// counts shader compiles and links made by the page, so we can prove rescaling never recompiles
const COUNTERS = `(() => { window.__gl = { compile: 0, link: 0 }; const P = WebGL2RenderingContext.prototype;
  const c = P.compileShader, l = P.linkProgram; P.compileShader = function (s) { window.__gl.compile++; return c.call(this, s); }; P.linkProgram = function (p) { window.__gl.link++; return l.call(this, p); }; })();`;

const page = await launch(CHROME);
await page.addInitScript(COUNTERS);

// ---------------------------------------------------------------- 1. start, determinism, animation, black-to-picture
await page.resize(960, 540);
await page.goto(`${INDEX}?probe=1`);
await page.waitFor("document.documentElement.dataset.reported === '1'", 120000);
const P = JSON.parse(await page.eval("document.getElementById('report').textContent"));
await check("page starts: no failure panel; two programs compiled once (4 shaders, 2 links)", async () => {
  assert.equal(await page.eval("document.getElementById('fail').hidden"), true);
  assert.deepEqual(await page.eval("window.__gl"), { compile: 4, link: 2 });
  note(`renderer: ${P.renderer} | float target: ${P.floatTarget} | drawing buffer ${P.size.join("x")}`);
});
await check("rendering is deterministic: same time, identical pixels", () => { for (const m of Object.values(P.moments)) assert.equal(m.identicalRerender, true); });
await check("black at t=0, silver light grows, nothing blank or blown out, fades out", () => {
  const tl = Object.fromEntries(P.timeline);
  assert.ok(tl[0] < 1, `t=0 mean ${tl[0]}`);
  assert.ok(tl[2] > tl[0] && tl[3] > tl[2]);
  for (const t of [5, 7, 9, 11, 13]) assert.ok(tl[t] > 5 && tl[t] < 120, `t=${t} mean ${tl[t]}`);
  assert.ok(tl[14.5] < tl[13]);
  note("mean brightness (0-255) by second: " + P.timeline.map(([t, v]) => `${t}s=${v}`).join(" "));
});
await check("moon, clouds, mist and castle animate (camera pinned, grain off), measured over 2 s", () => {
  for (const t of [8, 11]) for (const k of ["moon", "clouds", "mist", "castle"]) assert.ok(P.moments[t].change2s[k] > .3, `${k} at ${t}s changed only ${P.moments[t].change2s[k]}`);
  for (const t of [8, 11]) note(`mean level change over 2 s from t=${t}: ${J(P.moments[t].change2s)}`);
});

// ---------------------------------------------------------------- 2. the governor, in the real animation loop
await page.goto(`${INDEX}?debug=1`);
await page.waitFor("document.documentElement.dataset.ready === '1'");
const before = await page.eval(`JSON.stringify({ css: document.getElementById('c').getBoundingClientRect().toJSON(), gl: window.__gl, scale: document.documentElement.dataset.renderScale,
  buf: [document.getElementById('c').width, document.getElementById('c').height], frame: [innerWidth, innerHeight] })`).then(JSON.parse);
const wall0 = Date.now();
await page.waitFor("__eternal.clock.time() > 9", 60000);
const mid = await page.eval(`JSON.stringify({ t: __eternal.clock.time(), fps: __eternal.avgFps(), scale: document.documentElement.dataset.renderScale, log: __eternal.governor.log,
  css: document.getElementById('c').getBoundingClientRect().toJSON(), gl: window.__gl, buf: [document.getElementById('c').width, document.getElementById('c').height], frames: __eternal.perf.frames })`).then(JSON.parse);
const wallElapsed = (Date.now() - wall0) / 1000;
await check("real loop: a slow renderer (software GL) is stepped down within seconds, never below 0.5", () => {
  assert.ok(mid.fps > 0 && mid.frames > 20, `loop ran ${mid.frames} frames`);
  if (mid.fps < 40) { assert.ok(mid.log.length >= 1, `avg ${mid.fps} fps but no scale change`); assert.ok(+mid.scale < 1 && +mid.scale >= .5); }
  note(`avg ${mid.fps} fps (software), scale ${before.scale} -> ${mid.scale}, buffer ${before.buf.join("x")} -> ${mid.buf.join("x")}, changes: ${mid.log.map(l => `${l.from}->${l.to} @${(l.at / 1000).toFixed(1)}s (${l.meanMs} ms)`).join("; ") || "none"}`);
});
await check("scale changes keep the composition: canvas CSS box identical, no shader recompiles", () => {
  assert.deepEqual(mid.css, before.css);
  assert.deepEqual(mid.gl, before.gl);
  assert.deepEqual(mid.gl, { compile: 4, link: 2 });
});
await check("the timeline follows the clock, not the frame rate (film time tracks wall time)", () => {
  assert.ok(Math.abs(mid.t - wallElapsed) < 1.2, `film t=${mid.t.toFixed(2)} vs wall ${wallElapsed.toFixed(2)}`);
});
await page.waitFor("__eternal.clock.time() > 12.6", 30000);
writeFileSync(join(SHOTS, "live_t12_960x540.png"), await page.screenshot());
note("screenshot of the live, animated page (governed scale): tests/shots/live_t12_960x540.png");

// ---------------------------------------------------------------- 3. resize and scale changes through the live pipeline
await check("resizing and rescaling keep rendering valid (no GL errors, right sizes, picture present, no recompiles)", async () => {
  await page.goto(`${INDEX}?debug=1&t=9.5`);
  await page.waitFor("document.documentElement.dataset.ready === '1'");
  const compiles = await page.eval("J = JSON.stringify; J(window.__gl)");
  const steps = [[1920, 1080, 1, 1], [1280, 720, 1, .5], [800, 450, 2, 1], [520, 800, 1, .75], [1920, 1080, 1, .5], [960, 540, 3, 1], [1920, 1080, 1, 1]];
  const rows = [];
  for (const [w, h, dpr, scale] of steps) {
    await page.resize(w, h, dpr);
    await sleep(150);
    const r = await page.eval(`(() => { const e = __eternal; e.setScale(${scale}); const c = document.getElementById('c'), gl = e.renderer.gl;
      const W = c.width, H = c.height, px = new Uint8Array(W * H * 4); gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, px);
      let s = 0, n = 0; for (let i = 0; i < px.length; i += 64) { s += px[i] + px[i + 1] + px[i + 2]; n += 3; }
      const box = c.getBoundingClientRect(), info = e.info();
      return JSON.stringify({ W, H, mean: s / n, errors: e.renderer.drainErrors(), box: [box.width, box.height], aspect: box.width / box.height, scale: info.renderScale, cssW: innerWidth, compile: window.__gl }); })()`).then(JSON.parse);
    rows.push(`${w}x${h}@${dpr}x scale ${scale} -> ${r.W}x${r.H}`);
    assert.deepEqual(r.errors, [], `GL errors at ${w}x${h}`);
    assert.ok(r.mean > 8, `blank picture at ${w}x${h}: mean ${r.mean}`);
    assert.ok(Math.abs(r.aspect - 2.39) < .02, `aspect ${r.aspect}`);
    assert.ok(r.W >= 32 && r.H >= 32 && r.W * r.H <= 2.6e6 + 1, `buffer ${r.W}x${r.H}`);
    assert.ok(Math.abs(r.W / r.H - r.aspect) < .05, "buffer aspect matches the frame");
    assert.equal(r.scale, scale);
    assert.equal(J(r.compile), compiles, "shaders were recompiled");
  }
  note(rows.join(" | "));
  const text = await page.eval("[...document.querySelectorAll('.cue')].map(e => e.getBoundingClientRect().width > 0).join()");
  assert.ok(text.includes("true"), "typography is still laid out");
});
await check("a manual ?scale is honoured and turns the governor off", async () => {
  await page.resize(960, 540, 1);
  await page.goto(`${INDEX}?debug=1&scale=0.5`);
  await page.waitFor("document.documentElement.dataset.ready === '1'");
  assert.equal(await page.eval("__eternal.governor.enabled"), false);
  const w = await page.eval("document.getElementById('c').width");
  assert.ok(Math.abs(w - 480) <= 1, `buffer width ${w}`);
  await sleep(3500);
  assert.equal(await page.eval("__eternal.governor.log.length"), 0);
  assert.equal(await page.eval("document.getElementById('c').width"), w);
});

// ---------------------------------------------------------------- 4. screenshots at desktop, small and portrait sizes
await check("screenshots written (animation stills at desktop, small and portrait sizes)", async () => {
  const SIZES = [[1920, 1080, [0, 2.5, 5, 6.55, 7.2, 9.5, 12.5]], [1280, 720, [12.5]], [800, 450, [9.5]], [520, 800, [12.5]]];
  let n = 0;
  for (const [w, h, times] of SIZES) {
    await page.resize(w, h, 1);
    for (const t of times) {
      await page.goto(`${INDEX}?t=${t}`);
      await page.waitFor("document.documentElement.dataset.ready === '1'");
      writeFileSync(join(SHOTS, `t${String(t).replace(".", "_")}_${w}x${h}.png`), await page.screenshot()); n++;
    }
  }
  note(`${n} screenshots in tests/shots/`);
});

// ---------------------------------------------------------------- 5. ?bench
await check("?bench reports environment, GL info, real-loop stats and synchronous timing separately", async () => {
  await page.resize(960, 540, 1);
  await page.goto(`${INDEX}?bench=3`);
  await page.waitFor("document.documentElement.dataset.reported === '1'", 120000);
  const r = JSON.parse(await page.eval("document.getElementById('report').textContent"));
  const text = await page.eval("document.getElementById('benchPanel').textContent");
  assert.ok(r.environment.userAgent && r.environment.viewport.length === 2);
  assert.ok(r.gl.renderer && r.gl.version && r.gl.limits.maxTexture > 0 && r.gl.width > 0 && typeof r.gl.floatTarget === "boolean");
  assert.equal(r.verdict.kind, "software", "SwiftShader must be recognised as software");
  assert.ok(r.animationLoop.frames >= 10 && r.animationLoop.avgFps > 0 && r.animationLoop.p95Ms > 0);
  assert.ok(r.synchronous.meanMs > 0 && r.synchronous.perTime.length === 5);
  assert.deepEqual(r.glErrors, []);
  assert.equal(r.scale, 1);
  assert.ok(/Real animation loop/.test(text) && /Synchronous back-to-back/.test(text) && /not frame pacing/.test(text) && /SOFTWARE/.test(text));
  writeFileSync(join(SHOTS, "bench-software-sandbox.txt"), text + "\n");
  note(`real loop ${r.animationLoop.avgFps} fps (${r.animationLoop.frames} frames); synchronous ${r.synchronous.meanMs} ms/frame; verdict ${r.verdict.kind}`);
});
await page.close();

// ---------------------------------------------------------------- 6. no WebGL2
await check("without WebGL2 the page explains itself", async () => {
  const bare = await launch(CHROME, ["--disable-gpu", "--disable-webgl", "--disable-3d-apis", "--disable-software-rasterizer"]);
  try {
    await bare.resize(960, 540);
    await bare.goto(INDEX);
    const html = await bare.eval("document.getElementById('fail').hidden + '|' + document.querySelector('#fail h1').textContent");
    assert.equal(html, "false|WebGL2 is not available");
  } finally { await bare.close(); }
});

console.log(failures ? `\n${failures} check(s) failed` : "\nall browser checks passed");
process.exit(failures ? 1 : 0);
