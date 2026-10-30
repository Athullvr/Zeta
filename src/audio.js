// Local soundtrack support. Film time remains authoritative; this module only follows it.
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

  function soundtrackTime(filmTime, config) {
    return Math.max(0, config.offsetSeconds + filmTime);
  }

  function fadeGain(filmTime, filmDuration, config) {
    const fadeIn = config.fadeInSeconds <= 0 ? 1 : Math.min(1, Math.max(0, filmTime / config.fadeInSeconds));
    const remain = filmDuration - filmTime;
    const fadeOut = config.fadeOutSeconds <= 0 ? 1 : Math.min(1, Math.max(0, remain / config.fadeOutSeconds));
    return Math.min(fadeIn, fadeOut);
  }

  function createAudioController({ audio, AudioContext: AudioContextCtor, config = DEFAULT_CONFIG, onStatus = () => {} }) {
    if (!audio) throw new Error("audio element required");
    const cfg = normalizeConfig(config);
    let context = null, sourceNode = null, gainNode = null, resumePromise = null;
    let intent = false, silent = false, muted = false, blocked = false, failed = !cfg.sourceValid;
    let starting = false, ended = false, filmTime = 0, filmDuration = 0, volume = cfg.volume;
    let status = "Checking for the local soundtrack…";

    const publish = value => { status = value; onStatus(value); };
    const audioError = () => {
      failed = true; starting = false; intent = false;
      try { audio.pause(); } catch {}
      publish(`Local soundtrack missing or unreadable (${cfg.src}); the film remains available silently.`);
    };
    const ready = () => {
      if (failed) return;
      publish("Local soundtrack ready. Select Play film to start it with the picture.");
      if (intent && !silent) activate();
    };
    const on = (name, fn) => audio.addEventListener(name, fn);
    on("error", audioError);
    on("loadedmetadata", ready);
    on("canplay", ready);
    on("ended", () => {
      if (intent && audio.duration > 0 && soundtrackTime(filmTime, cfg) >= audio.duration - .03) {
        ended = true; intent = false;
        publish("The selected soundtrack passage has ended; the film continues silently.");
      }
    });

    audio.preload = "auto";
    if (cfg.sourceValid) {
      audio.src = cfg.src;
      if (typeof audio.load === "function") audio.load();
    } else audioError();

    function ensureGraph() {
      if (context || !AudioContextCtor) return;
      try {
        context = new AudioContextCtor();
        sourceNode = context.createMediaElementSource(audio);
        try {
          gainNode = context.createGain();
          sourceNode.connect(gainNode);
          gainNode.connect(context.destination);
        } catch {
          gainNode = null;
          sourceNode.connect(context.destination);
        }
        audio.volume = 1;
      } catch {
        context = null; sourceNode = null; gainNode = null;
      }
    }

    function resumeContext() {
      if (!context || context.state === "running") return Promise.resolve();
      if (resumePromise) return resumePromise;
      try {
        resumePromise = Promise.resolve(context.resume()).finally(() => { resumePromise = null; });
      } catch (e) {
        resumePromise = Promise.reject(e).finally(() => { resumePromise = null; });
      }
      return resumePromise;
    }

    function applyGain() {
      const g = muted || silent || failed ? 0 : volume * fadeGain(filmTime, filmDuration, cfg);
      if (gainNode) gainNode.gain.value = g;
      else { try { audio.volume = g; } catch {} }
      return g;
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
      ensureGraph();
      const resume = resumeContext();
      seekElement(filmTime);
      starting = true;
      let play;
      try { play = Promise.resolve(audio.play()); } catch (e) { play = Promise.reject(e); }
      Promise.all([resume, play]).then(() => {
        starting = false;
        if (intent && !silent && !failed) { applyGain(); publish("Soundtrack playing with the film."); }
        else audio.pause();
      }).catch(() => {
        starting = false;
        if (!failed && intent && !silent) {
          blocked = true;
          publish("The browser paused soundtrack playback. Select Resume to try again; the film can continue silently.");
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
    }

    function sync(t, duration) {
      filmTime = Math.max(0, Number.isFinite(t) ? t : 0);
      filmDuration = Math.max(0, Number.isFinite(duration) ? duration : 0);
      applyGain();
      if (!intent || silent || failed || ended) return;
      if (context && context.state !== "running") {
        resumeContext().catch(() => {});
      }
      if (!starting && !blocked && audio.paused) activate();
      else if (!starting && !blocked && !audio.seeking) {
        const drift = soundtrackTime(filmTime, cfg) - Number(audio.currentTime || 0);
        if (audio.readyState >= 1 && Math.abs(drift) > .22) seekElement(filmTime);
      }
    }

    function setVolume(value) { volume = Math.min(1, Math.max(0, Number(value) || 0)); applyGain(); }
    function setMuted(value) { muted = !!value; applyGain(); }
    function setSilent(value) {
      silent = !!value; applyGain();
      if (silent) { starting = false; try { audio.pause(); } catch {} publish("Silent preview is playing."); }
      else if (intent && !failed) { blocked = false; publish("Resuming the local soundtrack…"); activate(); }
    }

    return {
      config: cfg, audio,
      playAt, pause, seek, sync, setVolume, setMuted, setSilent,
      get status() { return status; },
      get context() { return context; },
      get gain() { return gainNode ? gainNode.gain.value : audio.volume; },
      get isPlaying() { return intent && !silent && !failed && !audio.paused; },
      get isSilent() { return silent; },
      get failed() { return failed; },
    };
  }

  const api = { DEFAULT_CONFIG, normalizeConfig, configFromQuery, resolveDuration, soundtrackTime, fadeGain, createAudioController };
  if (typeof module === "object" && module.exports) module.exports = api;
  else (root.ETERNAL = root.ETERNAL || {}).audio = api;
})(typeof self !== "undefined" ? self : globalThis);
