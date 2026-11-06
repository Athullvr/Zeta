const test = require("node:test");
const assert = require("node:assert/strict");
const N = require("../src/narration.js");

class FakeAudio {
  constructor() {
    this.listeners = new Map(); this.currentTime = 0; this.duration = 15; this.readyState = 1;
    this.paused = true; this.ended = false; this.seeking = false; this.volume = 1;
    this.playCalls = 0; this.pauseCalls = 0; this.error = null;
  }
  addEventListener(name, fn) { if (!this.listeners.has(name)) this.listeners.set(name, []); this.listeners.get(name).push(fn); }
  emit(name) { for (const fn of this.listeners.get(name) || []) fn(); }
  load() { this.loaded = true; }
  play() { this.playCalls++; this.paused = false; this.ended = false; return Promise.resolve(); }
  pause() { this.pauseCalls++; this.paused = true; }
}
const flush = () => new Promise(resolve => setImmediate(resolve));

test("the audition is local, optional, and scheduled as one 15-second passage", () => {
  const config = N.normalizeConfig();
  assert.equal(config.src, "assets/audio/narration/audition.mp3");
  assert.equal(config.filmStartSeconds, 10.2);
  assert.equal(config.durationSeconds, 15);
  assert.equal(config.sourceValid, true);
  assert.equal(N.normalizeConfig({ src: "https://example.invalid/voice.mp3" }).sourceValid, false);
  assert.equal(N.configFromQuery(new URLSearchParams("narration=assets%2Faudio%2Fnarration%2Ftake.wav")).src,
    "assets/audio/narration/take.wav");
});

test("music ducking follows speech windows with smooth ramps and rises in the spoken pause", () => {
  const config = N.normalizeConfig();
  assert.equal(N.duckEnvelope(-.35, config), 1);
  assert.ok(N.duckEnvelope(-.17, config) < 1 && N.duckEnvelope(-.17, config) > config.duckGain);
  assert.equal(N.duckEnvelope(0, config), config.duckGain);
  assert.equal(N.duckEnvelope(6.45, config), 1);
  assert.ok(N.duckEnvelope(6.85, config) < 1);
  assert.equal(N.duckEnvelope(15, config), 1);
});

test("a separate narration element joins, seeks, pauses, and resumes on the film clock", async () => {
  const audio = new FakeAudio(), duck = [];
  const controller = N.createNarrationController({ audio, onDuck: (gain, seconds) => duck.push({ gain, seconds }) });
  assert.equal(audio.loaded, undefined, "disabled narration does not load a file");
  controller.playAt(0);
  assert.equal(audio.playCalls, 0, "film playback alone keeps the optional narration off");

  controller.setEnabled(true);
  assert.equal(audio.loaded, true);
  controller.playAt(9.85);
  assert.equal(audio.playCalls, 0, "the voice waits for its scheduled film timestamp");
  controller.sync(10, { playing: true });
  assert.equal(audio.playCalls, 0, "pre-roll ducks music before the first word");
  assert.ok(duck.at(-1).gain < 1 && duck.at(-1).gain > controller.config.duckGain);

  controller.sync(10.2, { playing: true }); await flush();
  assert.equal(audio.playCalls, 1);
  assert.equal(audio.currentTime, 0, "narration's first sample aligns with film time 10.2s");
  assert.equal(controller.isPlaying, true);
  assert.equal(duck.at(-1).gain, controller.config.duckGain);

  controller.sync(11.5, { playing: true }); await flush();
  assert.ok(Math.abs(audio.currentTime - 1.3) < .001);
  controller.seek(18.2, { playing: true }); await flush();
  assert.equal(audio.currentTime, 8, "seeking uses film time minus the audition start");
  controller.pause();
  assert.equal(audio.paused, true);
  controller.playAt(18.2); await flush();
  assert.equal(controller.isPlaying, true, "resume re-enters narration at the current film timestamp");
  controller.setMuted(true);
  assert.equal(audio.volume, 0);
  controller.setMuted(false); controller.setVolume(.5);
  assert.equal(audio.volume, .5);
  controller.destroy();
});

test("silent-film mode and missing narration files never stop the film or score", async () => {
  const audio = new FakeAudio(), duck = [];
  const controller = N.createNarrationController({ audio, onDuck: gain => duck.push(gain) });
  controller.setEnabled(true);
  controller.playAt(10.2);
  controller.setSilent(true);
  assert.equal(audio.paused, true);
  assert.equal(duck.at(-1), 1);
  controller.destroy();

  const missingAudio = new FakeAudio(), missing = N.createNarrationController({ audio: missingAudio, onDuck: gain => duck.push(gain) });
  missing.setEnabled(true);
  missingAudio.error = { code: 4, message: "unsupported media" }; missingAudio.emit("error");
  assert.equal(missing.failed, true);
  assert.match(missing.status, /film and soundtrack continue normally/);
  missing.playAt(10.2);
  assert.equal(missingAudio.playCalls, 0);
  assert.equal(duck.at(-1), 1);
  missing.destroy();
});
