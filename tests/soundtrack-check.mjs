// Exercises the supplied MP3 in Chromium, including a full real-time film run.
// Headless Chromium has no usable audio sink here, so playback is confirmed through its decoded media timeline and ended event.
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import assert from "node:assert/strict";
import { findChrome, launch } from "./cdp.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const INDEX = pathToFileURL(join(ROOT, "index.html")).href;
const SHOTS = join(ROOT, "tests", "shots");
const SCORE = join(ROOT, "assets", "audio", "eternal-score.mp3");
const EXPECTED_DURATION = 168.15;
const CHROME = findChrome();
if (!CHROME) { console.log("SKIP: no headless Chromium found (set CHROME=...)"); process.exit(0); }
assert.ok(existsSync(SCORE), `supplied local soundtrack is missing: ${SCORE}`);
mkdirSync(SHOTS, { recursive: true });

const page = await launch(CHROME);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const note = s => console.log("      " + s);
try {
  await page.resize(960, 540);

  // Control and signal checks use the real MP3 with a short configured passage.
  await page.goto(`${INDEX}?debug=1&scale=0.5&offset=1&fadein=1.5&fadeout=3&duration=20`);
  await page.waitFor("document.documentElement.dataset.ready === '1'");
  await page.waitFor("__eternal.audioController.audio.readyState >= 1 && Number.isFinite(__eternal.audioController.audio.duration)", 20000);
  const loaded = await page.eval(`JSON.stringify({
    src: __eternal.audioController.config.src,
    absolute: __eternal.audioController.audio.currentSrc,
    audioDuration: __eternal.audioController.audio.duration,
    filmDuration: __eternal.director.duration,
    passageDuration: __eternal.playbackDuration,
    paused: __eternal.audioController.audio.paused,
    context: __eternal.audioController.context
  })`).then(JSON.parse);
  assert.equal(loaded.src, "assets/audio/eternal-score.mp3");
  assert.ok(loaded.absolute.startsWith("file:"), `soundtrack must use a local file URL: ${loaded.absolute}`);
  assert.ok(Math.abs(loaded.audioDuration - EXPECTED_DURATION) < .3, `MP3 metadata duration ${loaded.audioDuration}`);
  assert.ok(Math.abs(loaded.filmDuration - EXPECTED_DURATION) < .01);
  assert.equal(loaded.passageDuration, 20);
  assert.equal(loaded.paused, true, "loading must not autoplay");
  assert.equal(loaded.context, null, "AudioContext waits for a user interaction");
  note(`MP3 loaded offline: ${loaded.audioDuration.toFixed(3)} s, stereo media element; no autoplay before the Play click.`);

  await page.click("#play-film");
  await page.waitFor("__eternal.audioController.isPlaying && __eternal.clock.time() > 2.2", 12000);
  const playing = await page.eval(`JSON.stringify({ t: __eternal.clock.time(), audio: __eternal.audioController.audio.currentTime,
    playedRanges: __eternal.audioController.audio.played.length, rate: __eternal.audioController.audio.playbackRate,
    state: __eternal.audioController.context.state, gain: __eternal.audioController.gain })`).then(JSON.parse);
  assert.equal(playing.state, "running", "the trusted Play click resumes AudioContext");
  assert.equal(playing.rate, 1, "the MP3 must play at its native speed");
  assert.ok(playing.playedRanges > 0 && playing.audio > 3, "the actual MP3 media range advances after the Play click");
  assert.ok(Math.abs(playing.audio - (1 + playing.t)) < .35, `offset alignment: audio ${playing.audio}, film ${playing.t}`);
  assert.ok(Math.abs(playing.gain - .72) < .04, `fade-in should be complete; gain ${playing.gain}`);

  await page.click("#pause-film");
  const paused = await page.eval("JSON.stringify({ t: __eternal.clock.time(), audio: __eternal.audioController.audio.currentTime, paused: __eternal.audioController.audio.paused })").then(JSON.parse);
  await sleep(350);
  const stillPaused = await page.eval("JSON.stringify({ t: __eternal.clock.time(), audio: __eternal.audioController.audio.currentTime })").then(JSON.parse);
  assert.equal(paused.paused, true);
  assert.ok(Math.abs(stillPaused.t - paused.t) < .03 && Math.abs(stillPaused.audio - paused.audio) < .06,
    "pause freezes the picture clock and soundtrack together");

  await page.click("#resume-film");
  await page.waitFor(`__eternal.clock.time() > ${paused.t + .4}`, 10000);
  assert.ok(await page.eval("__eternal.audioController.isPlaying"), "resume restarts the MP3");
  await page.eval(`(() => { const v = document.getElementById('music-volume'); v.value = '0.5'; v.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  assert.ok(Math.abs(await page.eval("__eternal.audioController.gain") - .5) < .04, "volume slider scales decoded audio");
  await page.click("#mute-music");
  assert.equal(await page.eval("__eternal.audioController.gain"), 0, "mute removes output");
  await page.click("#mute-music");
  assert.ok(Math.abs(await page.eval("__eternal.audioController.gain") - .5) < .04, "unmute restores the selected volume");

  await page.click("#silent-preview");
  const silent = await page.eval("JSON.stringify({ t: __eternal.clock.time(), paused: __eternal.audioController.audio.paused })").then(JSON.parse);
  assert.equal(silent.paused, true);
  await page.waitFor(`__eternal.clock.time() > ${silent.t + .35}`, 10000);
  await page.click("#silent-preview");
  await page.waitFor("__eternal.audioController.isPlaying", 10000);

  await page.eval(`(() => { const s = document.getElementById('film-seek'); s.value = '18.5'; s.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await page.waitFor("!__eternal.audioController.audio.seeking", 5000);
  const faded = await page.eval("JSON.stringify({ t: __eternal.clock.time(), audio: __eternal.audioController.audio.currentTime, gain: __eternal.audioController.gain })").then(JSON.parse);
  assert.ok(Math.abs(faded.t - 18.5) < .25 && Math.abs(faded.audio - (1 + faded.t)) < .15,
    `seeking honors the source offset: ${JSON.stringify(faded)}`);
  const expectedFadedGain = .5 * ((20 - faded.t) / 3);
  assert.ok(Math.abs(faded.gain - expectedFadedGain) < .04, `configured three-second fade-out at half volume: ${faded.gain}`);

  await page.click("#restart-film");
  await page.waitFor("__eternal.clock.time() < 1 && Math.abs(__eternal.audioController.audio.currentTime - 1) < .15", 5000);
  assert.equal(await page.eval("__eternal.audioController.audio.playbackRate"), 1);
  note("Actual MP3 passed Play, pause, resume, restart, offset seek, fade-in/out, volume, mute and silent preview.");

  // Run and sample the entire default film with the exact bundled score at native playback speed.
  await page.goto(`${INDEX}?debug=1&scale=0.5`);
  await page.waitFor("document.documentElement.dataset.ready === '1'");
  await page.waitFor("__eternal.audioController.audio.readyState >= 1 && Number.isFinite(__eternal.audioController.audio.duration)", 20000);
  await page.click("#play-film");
  await page.waitFor("__eternal.audioController.isPlaying && __eternal.clock.time() > 1", 12000);
  const checkpoints = [10, 25, 40, 54, 58, 70, 84.8, 88, 100, 116.8, 120.8, 140, 149, 152.4, 160, 163.15, 165.65];
  const measurements = [];
  for (const t of checkpoints) {
    await page.waitFor(`__eternal.clock.time() >= ${t}`, 30000);
    const sample = await page.eval(`(() => ({ t: __eternal.clock.time(), audio: __eternal.audioController.audio.currentTime,
      scene: __eternal.director.frameAt(__eternal.clock.time()).sceneId,
      fade: __eternal.director.frameAt(__eternal.clock.time()).post.uFade,
      gain: __eternal.audioController.gain }))()`);
    const drift = sample.audio - sample.t;
    assert.ok(Math.abs(drift) < .65, `film/audio drift at ${t}s: ${drift.toFixed(3)}s`);
    measurements.push({ target: t, ...sample, drift });
    if ([10, 54, 88, 116.8, 149, 163.15, 165.65].includes(t)) {
      const stamp = String(t).replace(".", "_");
      writeFileSync(join(SHOTS, `soundtrack_${stamp}s.png`), await page.screenshot());
    }
  }

  await page.waitFor("__eternal.clock.time() >= __eternal.playbackDuration", 30000);
  await page.waitFor("__eternal.audioController.audio.ended", 5000);
  const ended = await page.eval(`(() => {
    const e = __eternal, c = document.getElementById('c'), gl = e.renderer.gl;
    const px = new Uint8Array(c.width * c.height * 4); gl.readPixels(0, 0, c.width, c.height, gl.RGBA, gl.UNSIGNED_BYTE, px);
    let sum = 0, n = 0; for (let i = 0; i < px.length; i += 32) { sum += px[i] + px[i+1] + px[i+2]; n += 3; }
    return JSON.stringify({ filmTime: e.clock.time(), duration: e.playbackDuration,
      frameDone: e.director.frameAt(e.clock.time()).done, fade: e.director.frameAt(e.clock.time()).post.uFade,
      audioTime: e.audioController.audio.currentTime, audioDuration: e.audioController.audio.duration,
      audioEnded: e.audioController.audio.ended, outputMean: sum / n, rate: e.audioController.audio.playbackRate });
  })()`).then(JSON.parse);
  assert.ok(Math.abs(ended.filmTime - EXPECTED_DURATION) < .01);
  assert.ok(Math.abs(ended.duration - EXPECTED_DURATION) < .01);
  assert.equal(ended.frameDone, true);
  assert.equal(ended.fade, 1);
  assert.equal(ended.audioEnded, true, "the complete MP3 reaches its natural end");
  assert.equal(ended.rate, 1);
  assert.ok(ended.outputMean < 1, `the picture must resolve to black, mean ${ended.outputMean}`);
  writeFileSync(join(SHOTS, "soundtrack_168_15s.png"), await page.screenshot());
  writeFileSync(join(SHOTS, "soundtrack-full-run.json"), JSON.stringify({ loaded, measurements, ended }, null, 2) + "\n");
  const maxDrift = Math.max(...measurements.map(m => Math.abs(m.drift)));
  console.log(`ok    complete supplied MP3 playback: duration ${ended.audioDuration.toFixed(3)} s, max sampled drift ${maxDrift.toFixed(3)} s, native speed, natural audio end, visual black`);
  note("Sampled handoffs and the final five-second fade; screenshots and timing report are in tests/shots/.");
} finally {
  await page.close();
}
