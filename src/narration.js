// Optional local narration tied to the authoritative film clock. It owns a separate native audio element;
// the soundtrack remains on its existing element and is ducked through the soundtrack controller.
(function (root) {
  "use strict";

  const DEFAULT_CONFIG = Object.freeze({
    src: "assets/audio/narration/audition.mp3",
    filmStartSeconds: 10.2,
    durationSeconds: 15,
    volume: .72,
    duckGain: .18,
    duckRampSeconds: .25,
    speechRampSeconds: .35,
    // Relative to the audition file; tune these two windows to the approved recording's actual pauses.
    speechWindows: [[0, 5.9], [7.0, 14.65]],
  });
  const READY = ["nothing loaded", "metadata loaded", "current data", "enough data to begin", "enough data to finish"];
  const MEDIA_ERRORS = ["", "aborted", "network error", "decode error", "unsupported media"];

  function localSource(src) {
    if (typeof src !== "string" || !src.trim()) return false;
    const value = src.trim();
    return !value.startsWith("//") && (!/^[a-z][a-z\d+.-]*:/i.test(value) || /^file:/i.test(value));
  }
  function finite(value, fallback) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  }
  function normalizeConfig(value = {}) {
    const src = value.src == null ? DEFAULT_CONFIG.src : String(value.src).trim();
    const duration = finite(value.durationSeconds, DEFAULT_CONFIG.durationSeconds);
    const windows = Array.isArray(value.speechWindows) ? value.speechWindows : DEFAULT_CONFIG.speechWindows;
    return {
      src: localSource(src) ? src : DEFAULT_CONFIG.src,
      sourceValid: localSource(src),
      filmStartSeconds: Math.max(0, finite(value.filmStartSeconds, DEFAULT_CONFIG.filmStartSeconds)),
      durationSeconds: Math.max(.1, duration),
      volume: Math.min(.75, Math.max(0, finite(value.volume, DEFAULT_CONFIG.volume))),
      duckGain: Math.min(1, Math.max(0, finite(value.duckGain, DEFAULT_CONFIG.duckGain))),
      duckRampSeconds: Math.max(0, finite(value.duckRampSeconds, DEFAULT_CONFIG.duckRampSeconds)),
      speechRampSeconds: Math.max(0, finite(value.speechRampSeconds, DEFAULT_CONFIG.speechRampSeconds)),
      speechWindows: windows.map(pair => Array.isArray(pair) && pair.length >= 2
        ? [Math.max(0, Math.min(duration, finite(pair[0], 0))), Math.max(0, Math.min(duration, finite(pair[1], duration)))]
        : null).filter(pair => pair && pair[1] > pair[0]).sort((a, b) => a[0] - b[0]),
    };
  }
  function configFromQuery(params, defaults = DEFAULT_CONFIG) {
    const number = (key, fallback) => params.has(key) ? Number(params.get(key)) : fallback;
    return normalizeConfig({
      ...defaults,
      src: params.has("narration") ? params.get("narration") : defaults.src,
      filmStartSeconds: number("narrationStart", defaults.filmStartSeconds),
    });
  }
  function duckEnvelope(localTime, config = DEFAULT_CONFIG) {
    const cfg = normalizeConfig(config), t = Number(localTime);
    if (!Number.isFinite(t) || t < -cfg.speechRampSeconds || t >= cfg.durationSeconds) return 1;
    const ramp = cfg.speechRampSeconds;
    let result = 1;
    for (const [start, end] of cfg.speechWindows) {
      let amount = 1;
      if (t >= start && t <= end) amount = cfg.duckGain;
      else if (ramp > 0 && t >= start - ramp && t < start) {
        const p = (t - (start - ramp)) / ramp;
        const smooth = p * p * (3 - 2 * p);
        amount = 1 + (cfg.duckGain - 1) * smooth;
      } else if (ramp > 0 && t > end && t <= end + ramp) {
        const p = (t - end) / ramp;
        const smooth = p * p * (3 - 2 * p);
        amount = cfg.duckGain + (1 - cfg.duckGain) * smooth;
      }
      result = Math.min(result, amount);
    }
    return result;
  }

  function createNarrationController({ audio, config = DEFAULT_CONFIG, onStatus = () => {}, onDuck = () => {} }) {
    if (!audio) throw new Error("narration audio element required");
    const cfg = normalizeConfig(config);
    let enabled = false, intent = false, silent = false, muted = false, failed = !cfg.sourceValid;
    let starting = false, blocked = false, clipEnded = false, loaded = false;
    let filmTime = 0, volume = cfg.volume, status = "Narration is off. Enable the 15-second audition to load its local file.";

    const publish = value => { status = value; onStatus(value); };
    const mediaErrorText = () => {
      if (!audio.error) return "none";
      const code = audio.error.code || 0;
      return `${MEDIA_ERRORS[code] || `media error ${code}`}${audio.error.message ? `: ${audio.error.message}` : ""}`;
    };
    const inPassage = t => t >= cfg.filmStartSeconds && t < cfg.filmStartSeconds + cfg.durationSeconds;
    const playable = () => enabled && intent && !silent && !failed && !blocked && inPassage(filmTime);
    const setDuck = (gain, seconds = cfg.duckRampSeconds) => onDuck(Math.min(1, Math.max(0, gain)), seconds);
    function applyVolume() {
      try { audio.volume = failed || silent || muted || !enabled ? 0 : volume; } catch {}
    }
    function load() {
      if (loaded || failed || !enabled) return;
      loaded = true;
      audio.preload = "auto";
      audio.src = cfg.src;
      if (typeof audio.load === "function") audio.load();
      publish(`Loading the local narration audition (${cfg.src})…`);
    }
    function stopOutput({ reset = false, duck = true } = {}) {
      starting = false;
      try { audio.pause(); } catch {}
      if (reset && Math.abs(Number(audio.currentTime || 0)) > .04) { try { audio.currentTime = 0; } catch {} }
      if (duck) setDuck(1);
    }
    function seekElement(localTime) {
      if (failed || !Number.isFinite(localTime)) return;
      if (Number.isFinite(audio.duration) && audio.duration > 0 && localTime >= audio.duration) {
        clipEnded = true; stopOutput();
        publish("The narration file ended before the audition window finished.");
        return;
      }
      try { if (Math.abs(Number(audio.currentTime || 0) - localTime) > .22) audio.currentTime = localTime; } catch {}
    }
    function activate() {
      if (!playable() || starting || clipEnded) return;
      const localTime = filmTime - cfg.filmStartSeconds;
      seekElement(localTime);
      if (!playable() || clipEnded) return;
      starting = true;
      let result;
      try { result = Promise.resolve(audio.play()); } catch (error) { result = Promise.reject(error); }
      result.then(() => {
        starting = false;
        if (playable() && !clipEnded) { blocked = false; applyVolume(); publish("Narration audition playing with the film."); }
        else stopOutput();
      }).catch(error => {
        starting = false;
        if (!failed && enabled && intent && !silent) {
          blocked = true;
          try { audio.pause(); } catch {}
          setDuck(1);
          publish(`The browser blocked narration playback (${error && (error.name || error.message) || "play() failed"}). Press Play or Resume to retry.`);
        }
      });
    }

    audio.preload = "none";
    audio.addEventListener("error", () => {
      failed = true; starting = false;
      try { audio.pause(); } catch {}
      applyVolume(); setDuck(1);
      publish(`Local narration missing or unreadable (${cfg.src}); the film and soundtrack continue normally.`);
    });
    audio.addEventListener("loadedmetadata", () => {
      if (!failed) publish(`Narration audition loaded (${audio.duration.toFixed(2)}s).`);
    });
    audio.addEventListener("playing", () => { if (playable()) publish("Narration audition playing with the film."); });
    audio.addEventListener("ended", () => {
      clipEnded = true; starting = false; setDuck(1);
      publish("The narration audition file has ended.");
    });
    audio.addEventListener("pause", () => { if (!playable()) setDuck(1); });
    if (failed) publish(`Invalid narration source (${cfg.src}); the film and soundtrack continue normally.`);

    function setEnabled(value) {
      enabled = !!value;
      if (enabled) {
        if (intent && !silent && inPassage(filmTime))
          setDuck(duckEnvelope(filmTime - cfg.filmStartSeconds, cfg), 0);
        load(); applyVolume();
        if (!failed) publish("Narration audition is ready when the film reaches 0:10.");
      } else {
        stopOutput({ reset: true }); applyVolume();
        publish("Narration is off. The film plays with the soundtrack only.");
      }
    }
    function playAt(t, options = {}) {
      filmTime = Math.max(0, Number.isFinite(Number(t)) ? Number(t) : 0);
      intent = true; silent = !!options.silent; blocked = false;
      if (filmTime < cfg.filmStartSeconds || filmTime >= cfg.filmStartSeconds + cfg.durationSeconds) clipEnded = false;
      if (enabled && !silent && inPassage(filmTime))
        setDuck(duckEnvelope(filmTime - cfg.filmStartSeconds, cfg), 0);
      load(); applyVolume(); sync(filmTime, { playing: true, silent });
    }
    function pause() {
      intent = false; stopOutput({ duck: false });
      setDuck(enabled && !silent ? duckEnvelope(filmTime - cfg.filmStartSeconds, cfg) : 1, 0);
      publish(silent ? "Narration audition paused in silent-film mode." : "Narration audition paused with the film.");
    }
    function seek(t, options = {}) {
      filmTime = Math.max(0, Number.isFinite(Number(t)) ? Number(t) : 0);
      if (filmTime < cfg.filmStartSeconds || filmTime >= cfg.filmStartSeconds + cfg.durationSeconds) clipEnded = false;
      if (options.playing === true) intent = true;
      if (options.playing === false) intent = false;
      if (enabled && !silent && options.playing === true && inPassage(filmTime))
        setDuck(duckEnvelope(filmTime - cfg.filmStartSeconds, cfg), 0);
      sync(filmTime, options);
    }
    function sync(t, options = {}) {
      filmTime = Math.max(0, Number.isFinite(Number(t)) ? Number(t) : 0);
      if (options.silent != null) silent = !!options.silent;
      const playing = options.playing == null ? intent : !!options.playing;
      if (enabled && !failed && !silent && intent && playing && filmTime < cfg.filmStartSeconds
          && filmTime >= cfg.filmStartSeconds - cfg.speechRampSeconds) {
        stopOutput({ reset: true, duck: false });
        setDuck(duckEnvelope(filmTime - cfg.filmStartSeconds, cfg), 0);
        applyVolume();
        return;
      }
      if (!enabled || failed || silent || !intent || !playing || !inPassage(filmTime)) {
        stopOutput({ reset: filmTime < cfg.filmStartSeconds });
        applyVolume();
        return;
      }
      load(); applyVolume();
      const localTime = filmTime - cfg.filmStartSeconds;
      if (audio.ended && localTime < cfg.durationSeconds - .05) clipEnded = false;
      seekElement(localTime);
      if (failed || clipEnded) { setDuck(1); return; }
      setDuck(duckEnvelope(localTime, cfg));
      if (!starting && !blocked && audio.paused) activate();
      else if (!starting && !blocked && !audio.seeking) {
        const drift = localTime - Number(audio.currentTime || 0);
        if (audio.readyState >= 1 && Math.abs(drift) > .22) seekElement(localTime);
      }
    }
    function setVolume(value) {
      volume = Math.min(.75, Math.max(0, Number(value) || 0)); applyVolume();
    }
    function setMuted(value) { muted = !!value; applyVolume(); }
    function setSilent(value) {
      silent = !!value;
      if (silent) { stopOutput({ duck: false }); setDuck(1, 0); }
      else if (enabled && intent && inPassage(filmTime)) setDuck(duckEnvelope(filmTime - cfg.filmStartSeconds, cfg), 0);
      applyVolume();
    }
    function diagnostics() {
      return {
        source: cfg.src,
        enabled,
        load: failed ? "error" : loaded ? READY[audio.readyState] || `readyState ${audio.readyState}` : "not loaded (optional)",
        playback: failed ? "failed" : !enabled ? "off" : audio.ended ? "ended" : audio.paused ? "paused" : "playing",
        filmTime: +filmTime.toFixed(2),
        currentTime: Number.isFinite(audio.currentTime) ? +audio.currentTime.toFixed(2) : null,
        duration: Number.isFinite(audio.duration) ? +audio.duration.toFixed(2) : null,
        volume: volume, muted, duckFactor: +duckEnvelope(filmTime - cfg.filmStartSeconds, cfg).toFixed(3),
        mediaError: mediaErrorText(),
      };
    }
    function destroy() { stopOutput(); }

    return {
      config: cfg, audio, setEnabled, playAt, pause, seek, sync, setVolume, setMuted, setSilent, destroy, diagnostics,
      get enabled() { return enabled; },
      get failed() { return failed; },
      get status() { return status; },
      get isPlaying() { return intent && enabled && !silent && !failed && !audio.paused; },
      get gain() { return audio.muted || muted || failed ? 0 : Number(audio.volume); },
    };
  }

  const api = { DEFAULT_CONFIG, normalizeConfig, configFromQuery, duckEnvelope, createNarrationController };
  if (typeof module === "object" && module.exports) module.exports = api;
  else (root.ETERNAL = root.ETERNAL || {}).narration = api;
})(typeof self !== "undefined" ? self : globalThis);
