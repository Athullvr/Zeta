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

// Authorized self-created 440 Hz test tone; generated only in ignored browser-test output.
function makeTestTone(seconds = 70, sampleRate = 12000) {
  const samples = seconds * sampleRate, dataBytes = samples * 2, wav = Buffer.alloc(44 + dataBytes);
  wav.write("RIFF", 0); wav.writeUInt32LE(36 + dataBytes, 4); wav.write("WAVE", 8);
  wav.write("fmt ", 12); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(sampleRate, 24); wav.writeUInt32LE(sampleRate * 2, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
  wav.write("data", 36); wav.writeUInt32LE(dataBytes, 40);
  for (let i = 0; i < samples; i++) wav.writeInt16LE(Math.round(Math.sin(2 * Math.PI * 440 * i / sampleRate) * 5000), 44 + i * 2);
  return wav;
}
const TONE_PATH = join(SHOTS, "eternal-test-tone.wav");
writeFileSync(TONE_PATH, makeTestTone());

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
await check("page starts: no failure panel; four programs compiled once (8 shaders, 4 links)", async () => {
  assert.equal(await page.eval("document.getElementById('fail').hidden"), true);
  assert.deepEqual(await page.eval("window.__gl"), { compile: 8, link: 4 });
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
  assert.deepEqual(mid.gl, { compile: 8, link: 4 });
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

// ---------------------------------------------------------------- 4b. the entire film: every act, every transition, deterministic stills
await check("all five acts and four transitions render at fixed film timestamps", async () => {
  const moments = [
    [0, "act1", null, "film_00_opening_dark"],
    [12, "act1", null, "film_12_waiting"],
    [23.999, "act1", null, "film_23_999_before_bloom"],
    [24, "act2", "bloom", "film_24_bloom_start"],
    [26, "act2", "bloom", "film_26_bloom_midpoint"],
    [27.999, "act2", "bloom", "film_27_999_before_bloom_end"],
    [28, "act2", null, "film_28_after_bloom"],
    [28.001, "act2", null, "film_28_001_after_bloom"],
    [40, "act2", null, "film_40_cathedral"],
    [53.999, "act2", null, "film_53_999_before_fog"],
    [54, "act3", "fog", "film_54_fog_start"],
    [56, "act3", "fog", "film_56_fog_midpoint"],
    [57.999, "act3", "fog", "film_57_999_before_fog_end"],
    [58, "act3", null, "film_58_after_fog"],
    [58.001, "act3", null, "film_58_001_after_fog"],
    [70, "act3", null, "film_70_terrace"],
    [84.799, "act3", null, "film_84_799_before_dark"],
    [84.8, "act4", "dark", "film_84_8_dark_start"],
    [86.4, "act4", "dark", "film_86_4_dark_midpoint"],
    [87.999, "act4", "dark", "film_87_999_before_dark_end"],
    [88, "act4", null, "film_88_after_dark"],
    [88.001, "act4", null, "film_88_001_after_dark"],
    [96, "act4", null, "film_96_storm_rising"],
    [112, "act4", null, "film_112_oath_climax"],
    [116.799, "act4", null, "film_116_799_before_continue"],
    [116.8, "act5", "continue", "film_116_8_shared_storm"],
    [118.8, "act5", "continue", "film_118_8_shared_storm_midpoint"],
    [120.799, "act5", "continue", "film_120_799_before_continue_end"],
    [120.8, "act5", null, "film_120_8_after_continue"],
    [120.801, "act5", null, "film_120_801_after_continue"],
    [140, "act5", null, "film_140_quiet"],
    [149, "act5", null, "film_149_final_verse"],
    [152.4, "act5", null, "film_152_4_final_title"],
    [163.15, "act5", null, "film_163_15_fade_start"],
    [165.65, "act5", null, "film_165_65_fade_midpoint"],
    [168.15, "act5", null, "film_168_15_final_black"],
  ];
  await page.resize(960, 540, 1);
  await page.goto(`${INDEX}?debug=1&t=0&scale=0.5`);
  await page.waitFor("document.documentElement.dataset.ready === '1'");
  const seen = new Map();
  for (const [t, scene, transition, name] of moments) {
    const r = await page.eval(`(() => {
      const e = window.__eternal, f = e.seek(${t}), c = document.getElementById('c'), gl = e.renderer.gl;
      const px = new Uint8Array(c.width * c.height * 4); gl.readPixels(0, 0, c.width, c.height, gl.RGBA, gl.UNSIGNED_BYTE, px);
      let hash = 2166136261, sum = 0, count = 0;
      for (let i = 0; i < px.length; i += 4) {
        for (let k = 0; k < 4; k++) hash = Math.imul(hash ^ px[i + k], 16777619);
        sum += px[i] + px[i + 1] + px[i + 2]; count += 3;
      }
      return JSON.stringify({ scene: f.sceneId, transition: f.transition?.kind || null, progress: f.transition?.p ?? null,
        hash: hash >>> 0, mean: sum / count, done: f.done, errors: e.renderer.drainErrors() });
    })()`).then(JSON.parse);
    assert.equal(r.scene, scene, `scene at t=${t}`);
    assert.equal(r.transition, transition, `transition at t=${t}`);
    assert.deepEqual(r.errors, [], `WebGL errors at t=${t}`);
    if ([40, 70, 96, 112, 140, 149].includes(t)) assert.ok(r.mean > 1, `blank act at t=${t}: mean ${r.mean}`);
    if (t === 168.15) assert.equal(r.done, true, "the last still is the completed ending fade");
    seen.set(t, r);
    writeFileSync(join(SHOTS, `${name}_960x540.png`), await page.screenshot());
  }
  assert.ok(seen.get(149).mean > seen.get(163.15).mean, "the quiet ending is visible before its final fade");
  assert.ok(seen.get(163.15).mean > seen.get(165.65).mean && seen.get(165.65).mean > seen.get(168.15).mean,
    "the final five-second visual fade resolves smoothly to black");
  assert.ok(seen.get(26).mean < 90, `Act I→II bloom midpoint remains too pale: mean ${seen.get(26).mean}`);
  note(`Act I→II bloom midpoint mean brightness: ${seen.get(26).mean.toFixed(1)} / 255`);

  // A different sequence of seeks must not alter the picture at any sampled instant.
  for (const t of [26, 40, 56, 70, 86.4, 96, 112, 116.8, 140, 149, 152.4, 163.15, 165.65, 168.15]) {
    const a = seen.get(t).hash;
    const b = await page.eval(`(() => { const e = __eternal, f = e.seek(${t}), c = document.getElementById('c'), gl = e.renderer.gl;
      const px = new Uint8Array(c.width * c.height * 4); gl.readPixels(0, 0, c.width, c.height, gl.RGBA, gl.UNSIGNED_BYTE, px);
      let h = 2166136261; for (const v of px) h = Math.imul(h ^ v, 16777619); return h >>> 0; })()`);
    assert.equal(b, a, `same timestamp gives identical pixels at t=${t}`);
  }
  note(`${moments.length} stills saved in tests/shots/, including before, inside, and after every handoff.`);

  await page.goto(`${INDEX}?debug=1&t=0`);
  await page.waitFor("document.documentElement.dataset.ready === '1'");
  const layouts = [[1280, 720, 1, 12, "act1"], [800, 450, .5, 40, "act2"], [520, 800, .75, 70, "act3"],
    [1280, 720, .5, 112, "act4"], [800, 450, .75, 140, "act5"]];
  for (const [w, h, scale, t, scene] of layouts) {
    await page.resize(w, h, 1);
    await sleep(150);
    const r = await page.eval(`(() => {
      const e = window.__eternal; e.setScale(${scale}); const f = e.seek(${t}), c = document.getElementById('c'), gl = e.renderer.gl;
      const px = new Uint8Array(c.width * c.height * 4); gl.readPixels(0, 0, c.width, c.height, gl.RGBA, gl.UNSIGNED_BYTE, px);
      let sum = 0, count = 0; for (let i = 0; i < px.length; i += 64) { sum += px[i] + px[i + 1] + px[i + 2]; count += 3; }
      const box = c.getBoundingClientRect(); return JSON.stringify({ scene: f.sceneId, mean: sum / count, scale: e.renderer.scale,
        box: [box.width, box.height], ratio: box.width / box.height, errors: e.renderer.drainErrors() });
    })()`).then(JSON.parse);
    assert.equal(r.scene, scene, `scene at t=${t} in ${w}x${h}`);
    assert.equal(r.scale, scale, `render scale in ${w}x${h}`);
    assert.ok(r.mean > 1, `blank scene at t=${t}: mean ${r.mean}`);
    assert.ok(Math.abs(r.ratio - 2.39) < .02, `frame aspect at ${w}x${h}: ${r.ratio}`);
    assert.deepEqual(r.errors, [], `WebGL errors at t=${t}, ${w}x${h}`);
  }
  note("All five act shaders rendered across landscape/portrait viewports and manual render scales.");
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
  assert.ok(r.synchronous.meanMs > 0 && r.synchronous.perTime.length === 6);
  assert.deepEqual(r.glErrors, []);
  assert.equal(r.scale, 1);
  assert.equal(await page.eval("window.__eternal.audioController === null"), true, "bench must not initialize a soundtrack");
  assert.ok(/Real animation loop/.test(text) && /Synchronous back-to-back/.test(text) && /not frame pacing/.test(text) && /SOFTWARE/.test(text));
  writeFileSync(join(SHOTS, "bench-software-sandbox.txt"), text + "\n");
  note(`real loop ${r.animationLoop.avgFps} fps (${r.animationLoop.frames} frames); synchronous ${r.synchronous.meanMs} ms/frame; verdict ${r.verdict.kind}`);
});

// ---------------------------------------------------------------- 5b. optional local audio and synchronization controls
await check("a missing local soundtrack reports a soft silent fallback and never blocks the film", async () => {
  await page.resize(960, 540, 1);
  await page.goto(`${INDEX}?debug=1&audio=assets/audio/not-supplied.mp3`);
  await page.waitFor("document.documentElement.dataset.ready === '1'");
  await page.waitFor("__eternal.audioController.failed === true", 15000);
  assert.equal(await page.eval("document.getElementById('fail').hidden"), true);
  assert.equal(await page.eval("document.querySelector('#controls').hidden"), false);
  const initial = await page.eval("JSON.stringify({ paused: __eternal.audioController.audio.paused, context: __eternal.audioController.context, status: document.getElementById('audio-status').textContent })").then(JSON.parse);
  assert.equal(initial.paused, true);
  assert.equal(initial.context, null, "audio context waits for a user action");
  assert.match(initial.status, /missing|unreadable/i);
  const at = await page.eval("__eternal.clock.time()");
  await page.click("#play-film");
  await page.waitFor(`__eternal.clock.time() > ${at + .3}`, 10000);
  assert.equal(await page.eval("document.getElementById('fail').hidden"), true);
  assert.equal(await page.eval("__eternal.audioController.audio.paused"), true);
  assert.match(await page.eval("document.getElementById('audio-status').textContent"), /silently/);
  note("missing path handled without a WebGL failure screen; visual playback advanced silently.");
});

await check("a configured shorter duration resolves the picture to black at its own endpoint", async () => {
  await page.goto(`${INDEX}?debug=1&duration=20&t=20`);
  await page.waitFor("document.documentElement.dataset.ready === '1'");
  const r = await page.eval(`(() => {
    const f = __eternal.seek(20), c = document.getElementById('c'), gl = __eternal.renderer.gl;
    const px = new Uint8Array(c.width * c.height * 4); gl.readPixels(0, 0, c.width, c.height, gl.RGBA, gl.UNSIGNED_BYTE, px);
    let sum = 0, n = 0; for (let i = 0; i < px.length; i += 32) { sum += px[i] + px[i+1] + px[i+2]; n += 3; }
    return JSON.stringify({ duration: __eternal.playbackDuration, fade: f.post.uFade, mean: sum / n });
  })()`).then(JSON.parse);
  assert.equal(r.duration, 20);
  assert.equal(r.fade, 1);
  assert.ok(r.mean < 1, `shortened film should resolve fully to black, mean ${r.mean}`);
  note("custom ?duration=20 resolves the visual endpoint without freezing on an Act II frame.");
});

await check("a generated WAV follows the film clock through play, pause, resume, restart, seek, fades, mute and silent preview", async () => {
  const toneUrl = `tests/shots/${TONE_PATH.split(/[\\/]/).pop()}`;
  await page.goto(`${INDEX}?debug=1&audio=${encodeURIComponent(toneUrl)}&offset=0.4&fadein=4&fadeout=50&duration=60`);
  await page.waitFor("document.documentElement.dataset.ready === '1'");
  await page.waitFor("__eternal.audioController.audio.readyState >= 1", 15000);
  const before = await page.eval("JSON.stringify({ paused: __eternal.audioController.audio.paused, context: __eternal.audioController.context, duration: __eternal.playbackDuration, path: __eternal.audioController.config.src })").then(JSON.parse);
  assert.equal(before.paused, true, "the file may load, but audio must not autoplay");
  assert.equal(before.context, null);
  assert.equal(before.duration, 60);
  assert.ok(before.path.endsWith("eternal-test-tone.wav"), `audio path ${before.path}`);
  assert.ok(await page.eval("document.querySelector('#play-film').tabIndex >= 0 && document.querySelector('label[for=film-seek]') !== null"), "controls are keyboard reachable and labelled");

  await page.click("#play-film");
  note("WAV control check: explicit play");
  await page.waitFor("__eternal.audioController.isPlaying", 10000);
  await page.waitFor("__eternal.audioController.audio.currentTime > 0.5", 10000);
  const running = await page.eval("JSON.stringify({ t: __eternal.clock.time(), audio: __eternal.audioController.audio.currentTime, rate: __eternal.audioController.audio.playbackRate, state: __eternal.audioController.context.state, gain: __eternal.audioController.gain })").then(JSON.parse);
  assert.equal(running.state, "running", "suspended AudioContext resumes after the trusted Play click");
  assert.equal(running.rate, 1);
  assert.ok(Math.abs(running.audio - (.4 + running.t)) < .35, `audio ${running.audio} vs film ${running.t}`);
  assert.ok(running.gain >= 0 && running.gain <= .72, `fade-in gain ${running.gain}`);

  await page.click("#pause-film");
  const frozen = await page.eval("JSON.stringify({ t: __eternal.clock.time(), audio: __eternal.audioController.audio.currentTime, paused: __eternal.audioController.audio.paused })").then(JSON.parse);
  await sleep(350);
  const afterPause = await page.eval("JSON.stringify({ t: __eternal.clock.time(), audio: __eternal.audioController.audio.currentTime })").then(JSON.parse);
  assert.equal(frozen.paused, true);
  assert.ok(Math.abs(afterPause.t - frozen.t) < .03, "film clock freezes on pause");
  assert.ok(Math.abs(afterPause.audio - frozen.audio) < .06, "soundtrack freezes with the film");

  await page.click("#resume-film");
  note("WAV control check: resume");
  await page.waitFor(`__eternal.clock.time() > ${frozen.t + .35}`, 10000);
  const resumed = await page.eval("JSON.stringify({ t: __eternal.clock.time(), audio: __eternal.audioController.audio.currentTime })").then(JSON.parse);
  assert.ok(Math.abs(resumed.audio - (.4 + resumed.t)) < .35, "resume stays aligned to the same clock");

  await page.eval("__eternal.audioController.context.suspend()");
  await page.waitFor("__eternal.audioController.context.state === 'running'", 10000);
  const recovered = await page.eval("JSON.stringify({ t: __eternal.clock.time(), audio: __eternal.audioController.audio.currentTime, state: __eternal.audioController.context.state })").then(JSON.parse);
  assert.equal(recovered.state, "running", "the live controller resumes a browser-suspended AudioContext");
  assert.ok(Math.abs(recovered.audio - (.4 + recovered.t)) < .35, "audio remains aligned after context suspension");

  await page.eval("(() => { const s = document.getElementById('film-seek'); s.value = '2.5'; s.dispatchEvent(new Event('input', { bubbles: true })); })()");
  const sought = await page.eval("JSON.stringify({ t: __eternal.clock.time(), audio: __eternal.audioController.audio.currentTime })").then(JSON.parse);
  assert.ok(Math.abs(sought.t - 2.5) < .02);
  assert.ok(Math.abs(sought.audio - 2.9) < .1, `seek audio to offset + film time: ${sought.audio}`);
  const fadeInGain = await page.eval("__eternal.audioController.gain");
  assert.ok(Math.abs(fadeInGain - .45) < .04, `mid fade-in gain should reflect .625 envelope: ${fadeInGain}`);

  await page.eval("(() => { const v = document.getElementById('music-volume'); v.value = '0.5'; v.dispatchEvent(new Event('input', { bubbles: true })); })()");
  await page.eval("(() => { const s = document.getElementById('film-seek'); s.value = '20'; s.dispatchEvent(new Event('input', { bubbles: true })); })()");
  await sleep(60);
  const faded = await page.eval("__eternal.audioController.gain");
  assert.ok(Math.abs(faded - .4) < .06, `fade-out and volume multiply to about .4, got ${faded}`);
  await page.click("#mute-music");
  assert.equal(await page.eval("__eternal.audioController.gain"), 0);
  await page.click("#mute-music");

  await page.click("#silent-preview");
  note("WAV control check: silent preview on");
  const silentAt = await page.eval("JSON.stringify({ t: __eternal.clock.time(), paused: __eternal.audioController.audio.paused })").then(JSON.parse);
  assert.equal(silentAt.paused, true);
  await page.waitFor(`__eternal.clock.time() > ${silentAt.t + .25}`, 10000);
  await page.click("#silent-preview");
  note("WAV control check: silent preview off");
  await page.waitFor("__eternal.audioController.isPlaying", 10000);
  assert.ok(Math.abs(await page.eval("__eternal.audioController.audio.currentTime - (0.4 + __eternal.clock.time())")) < .35);

  await page.click("#restart-film");
  note("WAV control check: restart");
  await page.waitFor("__eternal.audioController.isPlaying", 10000);
  await page.waitFor("!__eternal.audioController.audio.seeking && Math.abs(__eternal.audioController.audio.currentTime - (0.4 + __eternal.clock.time())) < 0.15", 5000);
  const restarted = await page.eval("JSON.stringify({ t: __eternal.clock.time(), audio: __eternal.audioController.audio.currentTime, rate: __eternal.audioController.audio.playbackRate })").then(JSON.parse);
  assert.ok(restarted.t < 1.5, `restart returns the film to its beginning: ${restarted.t}`);
  assert.ok(Math.abs(restarted.audio - (.4 + restarted.t)) < .15, `restart returns soundtrack to the configured offset: ${restarted.audio}`);
  assert.equal(restarted.rate, 1, "playback speed remains unchanged");
  note(`WAV verified: start offset .4s, film/audio drift <.35s; fade/mute/silent controls passed; duration ${before.duration}s.`);
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
