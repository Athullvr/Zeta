const test = require("node:test");
const assert = require("node:assert/strict");
const A = require("../src/audio.js");

class FakeAudio {
  static instances = [];
  constructor() {
    this.listeners = new Map(); this.currentTime = 0; this.duration = 168.15; this.readyState = 1;
    this.networkState = 1; this.paused = true; this.ended = false; this.seeking = false;
    this.playbackRate = 1; this.volume = 1; this.muted = false; this.playCalls = 0; this.pauseCalls = 0;
    this.error = null; this.playError = null; FakeAudio.instances.push(this);
  }
  addEventListener(name, fn) { if (!this.listeners.has(name)) this.listeners.set(name, []); this.listeners.get(name).push(fn); }
  emit(name) { for (const fn of this.listeners.get(name) || []) fn(); }
  load() { this.loaded = true; }
  play() { this.playCalls++; if (this.playError) return Promise.reject(this.playError); this.paused = false; this.ended = false; return Promise.resolve(); }
  pause() { this.pauseCalls++; this.paused = true; }
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

test("one native media element follows the film clock and does not create a Web Audio graph", async () => {
  const audio = new FakeAudio(), states = [];
  const controller = A.createAudioController({ audio, AudioCtor: FakeAudio, config: { offsetSeconds: 3, fadeInSeconds: 2, volume: .6 }, onStatus: s => states.push(s) });
  assert.equal(audio.loaded, true);
  assert.equal(audio.src, "assets/audio/eternal-score.mp3");
  assert.equal(audio.playCalls, 0, "loading a local file must not autoplay");
  assert.equal(controller.context, null, "native output needs no AudioContext or media source node");
  assert.match(controller.diagnostics().graph, /native media output/);

  controller.playAt(0, { duration: 10 });
  await flush();
  assert.equal(audio.playCalls, 1);
  assert.equal(audio.currentTime, 3);
  assert.equal(audio.volume, 0, "fade starts at silence");
  assert.equal(audio.muted, false);

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
  assert.equal(audio.playCalls, 2);
  assert.ok(states.includes("Soundtrack playing with the film."));
});

test("a rejected native play is reported and a later explicit interaction can retry", async () => {
  const audio = new FakeAudio(), controller = A.createAudioController({ audio, AudioCtor: FakeAudio });
  audio.playError = Object.assign(new Error("user gesture required"), { name: "NotAllowedError" });
  controller.playAt(0, { duration: 20 }); await flush();
  assert.equal(audio.paused, true);
  assert.match(controller.status, /blocked soundtrack playback/i);
  assert.match(controller.diagnostics().mediaError, /NotAllowedError/);
  audio.playError = null;
  controller.playAt(0, { duration: 20 }); await flush();
  assert.equal(controller.isPlaying, true, "Play is an explicit retry gesture");
});

test("native media output needs no AudioContext resume and pause/resume/restart remain synchronized", async () => {
  const audio = new FakeAudio();
  const controller = A.createAudioController({ audio, AudioCtor: FakeAudio, config: { fadeOutSeconds: 1 } });
  controller.playAt(0, { duration: 10 }); await flush();
  assert.equal(controller.context, null);
  controller.sync(2, 10); await flush();
  assert.equal(audio.currentTime, 2);
  controller.pause(); assert.equal(audio.paused, true);
  controller.playAt(4, { duration: 10 }); await flush();
  assert.equal(audio.currentTime, 4);
  controller.sync(10, 10); controller.finish();
  assert.equal(audio.volume, 0, "fade-out ends at silence");
});

test("short passages stop at the configured visual ending", async () => {
  const audio = new FakeAudio(); audio.duration = 70;
  const controller = A.createAudioController({ audio, AudioCtor: FakeAudio });
  controller.playAt(0, { duration: 60 }); await flush();
  controller.finish();
  assert.equal(audio.paused, true);
  assert.match(controller.status, /Film finished/);
});

test("silent preview, volume and mute controls do not duplicate soundtrack playback", async () => {
  const audio = new FakeAudio();
  const controller = A.createAudioController({ audio, AudioCtor: FakeAudio, config: { offsetSeconds: 1, fadeInSeconds: 0 } });
  controller.playAt(2, { silent: true, duration: 20 });
  assert.equal(audio.playCalls, 0);
  assert.equal(audio.paused, true);
  controller.setSilent(false); await flush();
  assert.equal(audio.playCalls, 1);
  controller.setVolume(.25);
  assert.equal(controller.gain, .25);
  controller.setMuted(true);
  assert.equal(audio.muted, true);
  controller.setMuted(false);
  assert.equal(audio.muted, false);
  controller.pause();
  assert.equal(audio.paused, true);
});

test("the diagnostic tone is created only on request, reuses one media element and restores the score", async () => {
  FakeAudio.instances = [];
  const audio = new FakeAudio();
  const controller = A.createAudioController({ audio, AudioCtor: FakeAudio });
  controller.playAt(2, { duration: 20 }); await flush();
  assert.equal(FakeAudio.instances.length, 1, "the tone is not created automatically");
  assert.equal(await controller.playTestTone(), true);
  assert.equal(FakeAudio.instances.length, 2);
  assert.equal(audio.muted, true, "score is ducked while the diagnostic tone plays");
  assert.equal(controller.diagnostics().testTonePlayback, "playing");
  assert.equal(await controller.playTestTone(), true);
  assert.equal(FakeAudio.instances.length, 2, "repeat tests reuse a single tone element");
  FakeAudio.instances[1].ended = true; FakeAudio.instances[1].paused = true; FakeAudio.instances[1].emit("ended");
  assert.equal(audio.muted, false, "score output state is restored afterward");
  assert.match(controller.diagnostics().testTone, /played/);
});

test("missing local files fail softly and invalid remote sources are not loaded", () => {
  const missing = new FakeAudio(), messages = [];
  const controller = A.createAudioController({ audio: missing, AudioCtor: FakeAudio, config: { src: "assets/audio/missing.wav" }, onStatus: s => messages.push(s) });
  missing.error = { code: 4, message: "unsupported media" }; missing.emit("error");
  assert.equal(controller.failed, true);
  controller.playAt(0, { duration: 10 });
  assert.equal(missing.playCalls, 0);
  assert.match(controller.status, /film is playing silently/);
  assert.match(controller.diagnostics().mediaError, /unsupported media/);

  const remote = new FakeAudio();
  const blocked = A.createAudioController({ audio: remote, AudioCtor: FakeAudio, config: { src: "https://example.invalid/score.mp3" } });
  assert.equal(remote.loaded, undefined);
  assert.equal(blocked.failed, true);
  assert.ok(messages.some(m => /missing or unreadable/.test(m)));
});
