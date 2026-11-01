// Local soundtrack support. Native HTMLAudioElement output avoids a Web Audio graph that can silently
// produce silence for locally opened files; the film clock remains authoritative and playbackRate stays 1.
(function (root) {
  "use strict";

  const DEFAULT_CONFIG = Object.freeze({
    src: "assets/audio/eternal-score.mp3",
    offsetSeconds: 0,
    fadeInSeconds: 2.5,
    fadeOutSeconds: 5,
    durationSeconds: null,
    volume: .72,
  });
  const READY = ["nothing loaded", "metadata loaded", "current data", "enough data to begin", "enough data to finish"];
  const NETWORK = ["no source", "idle", "loading", "no source available"];
  const MEDIA_ERRORS = ["", "aborted", "network error", "decode error", "unsupported media"];

  function localSource(src) {
    if (typeof src !== "string" || !src.trim().length) return false;
    const value = src.trim();
    return !value.startsWith("//") && (!/^[a-z][a-z\d+.-]*:/i.test(value) || /^file:/i.test(value));
  }
  function finiteNonNegative(value, fallback) {
    const n = Number(value);
    return Number.isFinite(n) && n >= 0 ? n : fallback;
  }
  function normalizeConfig(value = {}) {
    const src = value.src == null ? DEFAULT_CONFIG.src : String(value.src).trim();
    const duration = value.durationSeconds == null || value.durationSeconds === "" ? null : Number(value.durationSeconds);
    return {
      src: localSource(src) ? src : DEFAULT_CONFIG.src,
      sourceValid: localSource(src),
      offsetSeconds: finiteNonNegative(value.offsetSeconds, DEFAULT_CONFIG.offsetSeconds),
      fadeInSeconds: finiteNonNegative(value.fadeInSeconds, DEFAULT_CONFIG.fadeInSeconds),
      fadeOutSeconds: finiteNonNegative(value.fadeOutSeconds, DEFAULT_CONFIG.fadeOutSeconds),
      durationSeconds: duration !== null && Number.isFinite(duration) && duration > 0 ? duration : null,
      volume: Number.isFinite(Number(value.volume)) ? Math.min(1, Math.max(0, Number(value.volume))) : DEFAULT_CONFIG.volume,
    };
  }
  function configFromQuery(params, defaults = DEFAULT_CONFIG) {
    const number = (key, fallback) => params.has(key) ? Number(params.get(key)) : fallback;
    return normalizeConfig({
      ...defaults,
      src: params.has("audio") ? params.get("audio") : defaults.src,
      offsetSeconds: number("offset", defaults.offsetSeconds),
      fadeInSeconds: number("fadein", defaults.fadeInSeconds),
      fadeOutSeconds: number("fadeout", defaults.fadeOutSeconds),
      durationSeconds: number("duration", defaults.durationSeconds),
    });
  }
  function resolveDuration(config, directorDuration) {
    const requested = config.durationSeconds == null ? directorDuration : config.durationSeconds;
    return Math.max(0, Math.min(directorDuration, requested));
  }
  function soundtrackTime(filmTime, config) { return Math.max(0, config.offsetSeconds + filmTime); }
  function fadeGain(filmTime, filmDuration, config) {
    const fadeIn = config.fadeInSeconds <= 0 ? 1 : Math.min(1, Math.max(0, filmTime / config.fadeInSeconds));
    const remain = filmDuration - filmTime;
    const fadeOut = config.fadeOutSeconds <= 0 ? 1 : Math.min(1, Math.max(0, remain / config.fadeOutSeconds));
    return Math.min(fadeIn, fadeOut);
  }

  // A short WAV generated on demand. It uses the same native media-element output route as the soundtrack,
  // and is never created or played until the user presses the diagnostic button.
  function makeTestToneUrl() {
    const rate = 22050, seconds = .8, count = Math.floor(rate * seconds), bytes = count * 2;
    const wav = new ArrayBuffer(44 + bytes), view = new DataView(wav);
    const ascii = (at, value) => { for (let i = 0; i < value.length; i++) view.setUint8(at + i, value.charCodeAt(i)); };
    ascii(0, "RIFF"); view.setUint32(4, 36 + bytes, true); ascii(8, "WAVE"); ascii(12, "fmt ");
    view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
    view.setUint32(24, rate, true); view.setUint32(28, rate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
    ascii(36, "data"); view.setUint32(40, bytes, true);
    for (let i = 0; i < count; i++) {
      const edge = Math.min(1, i / (rate * .02), (count - i) / (rate * .08));
      view.setInt16(44 + i * 2, Math.round(Math.sin(2 * Math.PI * 523.25 * i / rate) * 5200 * edge), true);
    }
    return URL.createObjectURL(new Blob([wav], { type: "audio/wav" }));
  }

  function createAudioController({ audio, AudioCtor = null, config = DEFAULT_CONFIG, onStatus = () => {}, onDiagnostics = () => {} }) {
    if (!audio) throw new Error("audio element required");
    const cfg = normalizeConfig(config);
    let intent = false, silent = false, muted = false, blocked = false, failed = !cfg.sourceValid;
    let starting = false, ended = false, filmTime = 0, filmDuration = 0, volume = cfg.volume;
    let diagnosticActive = false, testAudio = null, testToneUrl = null, testToneStatus = "not played";
    let status = "Checking for the local soundtrack…", mediaError = "";

    const publish = value => { status = value; onStatus(value); onDiagnostics(diagnostics()); };
    const publishDiagnostics = () => onDiagnostics(diagnostics());
    const audioError = () => {
      failed = true; starting = false; intent = false;
      mediaError = mediaErrorText(audio);
      try { audio.pause(); } catch {}
      applyGain();
      publish(`Local soundtrack missing or unreadable (${cfg.src}); the film remains available silently.`);
    };
    const on = (name, fn) => audio.addEventListener(name, fn);
    on("error", audioError);
    on("loadedmetadata", () => { if (!failed && status.startsWith("Checking")) publish("Local soundtrack loaded. Select Play film to start it with the picture."); else publishDiagnostics(); });
    on("canplay", () => { if (!failed) publishDiagnostics(); });
    on("playing", () => { if (intent && !silent) publish("Soundtrack playing with the film."); else publishDiagnostics(); });
    on("pause", publishDiagnostics);
    on("ended", () => {
      if (intent && audio.duration > 0 && soundtrackTime(filmTime, cfg) >= audio.duration - .03) {
        ended = true; intent = false;
        publish("The selected soundtrack passage has ended; the film continues silently.");
      } else publishDiagnostics();
    });

    audio.preload = "auto";
    if (cfg.sourceValid) {
      audio.src = cfg.src;
      if (typeof audio.load === "function") audio.load();
    } else audioError();

    function mediaErrorText(element) {
      if (!element.error) return "none";
      const code = element.error.code || 0;
      return `${MEDIA_ERRORS[code] || `media error ${code}`}${element.error.message ? `: ${element.error.message}` : ""}`;
    }
    function diagnostics() {
      const err = audio.error ? mediaErrorText(audio) : mediaError || "none";
      return {
        source: cfg.src,
        currentSrc: audio.currentSrc || "(not selected yet)",
        load: failed ? "error" : READY[audio.readyState] || `readyState ${audio.readyState}`,
        network: NETWORK[audio.networkState] || `networkState ${audio.networkState}`,
        playback: failed ? "failed" : silent ? (intent ? "silent preview" : "silent preview paused") : audio.ended ? "ended" : audio.paused ? (blocked ? "blocked" : "paused") : "playing",
        paused: !!audio.paused, ended: !!audio.ended,
        currentTime: Number.isFinite(audio.currentTime) ? +audio.currentTime.toFixed(2) : null,
        duration: Number.isFinite(audio.duration) ? +audio.duration.toFixed(2) : null,
        volume: Number(audio.volume), muted: !!audio.muted, playbackRate: Number(audio.playbackRate),
        audioContext: "not used (native HTMLAudioElement output)",
        graph: "native media output; no Web Audio nodes to disconnect",
        mediaError: err,
        testTone: testToneStatus,
        testTonePlayback: testAudio ? (testAudio.ended ? "ended" : testAudio.paused ? "paused" : "playing") : "not created",
      };
    }
    function applyGain() {
      const gain = failed || silent ? 0 : volume * fadeGain(filmTime, filmDuration, cfg);
      try { audio.volume = diagnosticActive ? 0 : gain; } catch {}
      try { audio.muted = muted || failed || silent || diagnosticActive; } catch {}
      return diagnosticActive ? 0 : gain;
    }
    function seekElement(t) {
      if (failed || !Number.isFinite(t)) return;
      const target = soundtrackTime(t, cfg);
      if (Number.isFinite(audio.duration) && audio.duration > 0 && target >= audio.duration) {
        ended = true; intent = false;
        try { audio.pause(); } catch {}
        publish("The selected soundtrack passage has ended; the film continues silently.");
        return;
      }
      try { if (Math.abs(audio.currentTime - target) > .025) audio.currentTime = target; } catch {}
    }
    function activate() {
      if (!intent || silent || failed || blocked || ended || starting) return;
      seekElement(filmTime);
      if (!intent || ended) return;
      starting = true;
      let play;
      try { play = Promise.resolve(audio.play()); } catch (e) { play = Promise.reject(e); }
      play.then(() => {
        starting = false;
        if (intent && !silent && !failed) { mediaError = ""; applyGain(); publish("Soundtrack playing with the film."); }
        else audio.pause();
      }).catch(error => {
        starting = false;
        if (!failed && intent && !silent) {
          blocked = true;
          mediaError = error && `${error.name || "Playback error"}: ${error.message || "play() was rejected"}`;
          try { audio.pause(); } catch {}
          publish("The browser blocked soundtrack playback. Press Play or Resume to allow audio; the film can continue silently.");
        }
      });
    }
    function playAt(t, options = {}) {
      filmTime = Math.max(0, Number.isFinite(t) ? t : 0);
      if (Number.isFinite(options.duration)) filmDuration = Math.max(0, options.duration);
      silent = !!options.silent;
      intent = true; blocked = false; ended = false;
      applyGain();
      if (silent) {
        try { audio.pause(); } catch {}
        publish("Silent preview is playing.");
      } else if (failed) {
        publish(`Local soundtrack missing or unreadable (${cfg.src}); the film is playing silently.`);
      } else {
        publish("Preparing the local soundtrack…");
        activate();
      }
    }
    function pause() {
      intent = false; starting = false;
      try { audio.pause(); } catch {}
      publish(silent ? "Silent preview paused." : "Playback paused.");
    }
    function seek(t, duration, playing = intent) {
      filmTime = Math.max(0, Number.isFinite(t) ? t : 0);
      if (Number.isFinite(duration)) filmDuration = Math.max(0, duration);
      ended = false; applyGain(); seekElement(filmTime);
      if (playing && !silent && !failed) { intent = true; blocked = false; activate(); }
      publishDiagnostics();
    }
    function sync(t, duration) {
      filmTime = Math.max(0, Number.isFinite(t) ? t : 0);
      filmDuration = Math.max(0, Number.isFinite(duration) ? duration : 0);
      applyGain();
      if (!intent || silent || failed || ended) return;
      // Do not force a final seek during the media element's own natural end event.
      const target = soundtrackTime(filmTime, cfg);
      if (filmTime >= filmDuration - .15 && Number.isFinite(audio.duration) && audio.duration - target <= .25) return;
      if (!starting && !blocked && audio.paused) activate();
      else if (!starting && !blocked && !audio.seeking) {
        const drift = target - Number(audio.currentTime || 0);
        if (audio.readyState >= 1 && Math.abs(drift) > .22) seekElement(filmTime);
      }
    }
    function finish() {
      filmTime = filmDuration; applyGain();
      const remaining = Number(audio.duration) - soundtrackTime(filmDuration, cfg);
      if (Number.isFinite(remaining) && remaining <= .25) {
        publish("The picture has resolved; the soundtrack is finishing.");
        return;
      }
      intent = false; starting = false;
      try { audio.pause(); } catch {}
      publish("Film finished.");
    }
    function setVolume(value) { volume = Math.min(1, Math.max(0, Number(value) || 0)); applyGain(); publishDiagnostics(); }
    function setMuted(value) { muted = !!value; applyGain(); publishDiagnostics(); }
    function setSilent(value) {
      silent = !!value; applyGain();
      if (silent) { starting = false; try { audio.pause(); } catch {} publish("Silent preview is playing."); }
      else if (intent && !failed) { blocked = false; publish("Resuming the local soundtrack…"); activate(); }
      else publishDiagnostics();
    }
    function playTestTone() {
      if (!AudioCtor || typeof Blob !== "function" || typeof URL === "undefined" || !URL.createObjectURL) {
        testToneStatus = "unavailable in this browser"; publishDiagnostics(); return Promise.resolve(false);
      }
      try {
        if (!testAudio) {
          testToneUrl = makeTestToneUrl();
          testAudio = new AudioCtor();
          testAudio.preload = "auto"; testAudio.src = testToneUrl;
          testAudio.addEventListener("ended", () => {
            diagnosticActive = false; applyGain(); testToneStatus = "played; check the system output"; publishDiagnostics();
          });
          testAudio.addEventListener("error", () => {
            diagnosticActive = false; applyGain(); testToneStatus = "failed: " + mediaErrorText(testAudio); publishDiagnostics();
          });
        }
        diagnosticActive = true; applyGain();
        testAudio.volume = .65; testAudio.muted = false;
        if (!testAudio.paused) testAudio.pause();
        try { testAudio.currentTime = 0; } catch {}
        testToneStatus = "playing 523 Hz diagnostic tone";
        publishDiagnostics();
        let result;
        try { result = Promise.resolve(testAudio.play()); } catch (e) { result = Promise.reject(e); }
        return result.then(() => { publishDiagnostics(); return true; }).catch(error => {
          diagnosticActive = false; applyGain();
          testToneStatus = `blocked: ${error && (error.name || error.message) || "play() failed"}`;
          publishDiagnostics(); return false;
        });
      } catch (error) {
        diagnosticActive = false; applyGain();
        testToneStatus = `failed: ${error.message || String(error)}`; publishDiagnostics(); return Promise.resolve(false);
      }
    }
    function destroy() {
      try { if (testAudio) testAudio.pause(); } catch {}
      if (testToneUrl && typeof URL !== "undefined") URL.revokeObjectURL(testToneUrl);
    }

    return {
      config: cfg, audio, playAt, pause, seek, sync, finish, setVolume, setMuted, setSilent, playTestTone, destroy,
      get status() { return status; },
      get context() { return null; },
      get gain() { return audio.muted ? 0 : Number(audio.volume); },
      get isPlaying() { return intent && !silent && !failed && !audio.paused; },
      get isSilent() { return silent; },
      get failed() { return failed; },
      diagnostics,
    };
  }

  const api = { DEFAULT_CONFIG, normalizeConfig, configFromQuery, resolveDuration, soundtrackTime, fadeGain, createAudioController };
  if (typeof module === "object" && module.exports) module.exports = api;
  else (root.ETERNAL = root.ETERNAL || {}).audio = api;
})(typeof self !== "undefined" ? self : globalThis);
