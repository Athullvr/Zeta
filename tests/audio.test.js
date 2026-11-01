const test = require("node:test");
const assert = require("node:assert/strict");
const A = require("../src/audio.js");

class FakeAudio {
  constructor() { this.listeners = new Map(); this.currentTime = 0; this.duration = 30; this.readyState = 1; this.paused = true; this.playbackRate = 1; this.volume = 1; this.playCalls = 0; this.pauseCalls = 0; }
  addEventListener(name, fn) { if (!this.listeners.has(name)) this.listeners.set(name, []); this.listeners.get(name).push(fn); }
  emit(name) { for (const fn of this.listeners.get(name) || []) fn(); }
  load() { this.loaded = true; }
  play() { this.playCalls++; this.paused = false; return Promise.resolve(); }
  pause() { this.pauseCalls++; this.paused = true; }
}

class FakeContext {
  constructor() { this.state = "suspended"; this.resumes = 0; this.destination = {}; this.nodes = 0; }
  createMediaElementSource() { this.nodes++; return { connect() {} }; }
  createGain() { return { gain: { value: 1 }, connect() {} }; }
  resume() { this.resumes++; this.state = "running"; return Promise.resolve(); }
}

const flush = () => new Promise(resolve => setImmediate(resolve));

test("local score config defaults to the supplied path and resolves an editable passage", () => {
  const config = A.normalizeConfig();
  assert.equal(config.src, "assets/audio/eternal-score.mp3");
  assert.equal(config.sourceValid, true);
  assert.equal(A.resolveDuration(config, 168.15), 168.15);
  assert.equal(A.resolveDuration(A.normalizeConfig({ durationSeconds: 181 }), 168.15), 168.15);
  assert.equal(A.resolveDuration(A.normalizeConfig({ durationSeconds: 120 }), 168.15), 120);
  assert.equal(A.soundtrackTime(12.5, A.normalizeConfig({ offsetSeconds: 17 })), 29.5);
  assert.equal(A.normalizeConfig({ src: "https://example.invalid/score.mp3" }).sourceValid, false);
});

test("fade envelope is deterministic at the beginning, middle and end of the passage", () => {
  const c = A.normalizeConfig({ fadeInSeconds: 4, fadeOutSeconds: 8 });
  assert.equal(A.fadeGain(0, 100, c), 0);
  assert.equal(A.fadeGain(2, 100, c), .5);
  assert.equal(A.fadeGain(50, 100, c), 1);
  assert.equal(A.fadeGain(96, 100, c), .5);
  assert.equal(A.fadeGain(100, 100, c), 0);
  assert.equal(A.fadeGain(50, 100, A.normalizeConfig({ fadeInSeconds: 0, fadeOutSeconds: 0 })), 1);
});

test("one explicit play creates one audio graph, starts at offset, and follows seeks without changing speed", async () => {
  const audio = new FakeAudio(), states = [];
  const controller = A.createAudioController({ audio, AudioContext: FakeContext, config: { offsetSeconds: 3, fadeInSeconds: 2, volume: .6 }, onStatus: s => states.push(s) });
  assert.equal(audio.loaded, true);
  assert.equal(audio.playCalls, 0, "loading a local file must not autoplay");
  assert.equal(controller.context, null, "the audio context is created only after explicit playback");

  controller.playAt(0, { duration: 10 });
  await flush();
  assert.equal(audio.playCalls, 1);
  assert.equal(audio.currentTime, 3);
  assert.equal(controller.context.state, "running");
  assert.equal(controller.context.nodes, 1, "only one media source is constructed");
  assert.equal(controller.gain, 0, "fade starts at silence");

  controller.sync(1, 10);
  await flush();
  assert.ok(Math.abs(audio.currentTime - 4) < .001);
  assert.ok(Math.abs(controller.gain - .3) < .001);
  audio.currentTime = 3.4;
  controller.sync(1, 10);
  assert.equal(audio.currentTime, 4, "seek correction follows the director time when drift exceeds tolerance");
  assert.equal(audio.playbackRate, 1, "the soundtrack is never sped up or slowed down");

  controller.seek(4, 10, false);
  assert.equal(audio.currentTime, 7);
  controller.pause();
  assert.equal(audio.paused, true);
  controller.playAt(0, { duration: 10 });
  await flush();
  assert.equal(audio.currentTime, 3, "restart returns to the configured soundtrack offset");
  assert.equal(controller.context.nodes, 1);
  assert.ok(states.includes("Soundtrack playing with the film."));
});

test("a suspended AudioContext is resumed, and a matching soundtrack may end naturally", async () => {
  const audio = new FakeAudio(); audio.duration = 10;
  const controller = A.createAudioController({ audio, AudioContext: FakeContext, config: { fadeOutSeconds: 1 } });
  controller.playAt(0, { duration: 10 });
  await flush();
  controller.context.state = "suspended";
  controller.sync(9.5, 10);
  await flush();
  assert.equal(controller.context.state, "running");
  audio.currentTime = 9.9;
  controller.sync(10, 10);
  controller.finish();
  assert.equal(audio.paused, false, "the matching track is allowed to reach its native end");
  audio.emit("ended");
  assert.match(controller.status, /passage has ended/);
});

test("a shorter configured film passage stops a longer soundtrack at the resolved visual ending", async () => {
  const audio = new FakeAudio(); audio.duration = 70;
  const controller = A.createAudioController({ audio, AudioContext: FakeContext });
  controller.playAt(0, { duration: 60 });
  await flush();
  controller.finish();
  assert.equal(audio.paused, true);
  assert.match(controller.status, /Film finished/);
});

test("silent preview, volume and mute do not create duplicate playback", async () => {
  const audio = new FakeAudio();
  const controller = A.createAudioController({ audio, AudioContext: FakeContext, config: { offsetSeconds: 1, fadeInSeconds: 0 } });
  controller.playAt(2, { silent: true, duration: 20 });
  assert.equal(audio.playCalls, 0);
  assert.equal(audio.paused, true);
  controller.setSilent(false);
  await flush();
  assert.equal(audio.playCalls, 1);
  controller.setVolume(.25);
  assert.equal(controller.gain, .25);
  controller.setMuted(true);
  assert.equal(controller.gain, 0);
  controller.setMuted(false);
  assert.equal(controller.gain, .25);
  controller.pause();
  assert.equal(audio.paused, true);
});

test("missing local files fail softly and invalid remote sources are not loaded", () => {
  const missing = new FakeAudio(), messages = [];
  const controller = A.createAudioController({ audio: missing, config: { src: "assets/audio/missing.wav" }, onStatus: s => messages.push(s) });
  missing.emit("error");
  assert.equal(controller.failed, true);
  controller.playAt(0, { duration: 10 });
  assert.equal(missing.playCalls, 0);
  assert.match(controller.status, /film is playing silently/);

  const remote = new FakeAudio();
  const blocked = A.createAudioController({ audio: remote, config: { src: "https://example.invalid/score.mp3" } });
  assert.equal(remote.loaded, undefined);
  assert.equal(blocked.failed, true);
  assert.ok(messages.some(m => /missing or unreadable/.test(m)));
});
