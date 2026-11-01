// Render-scale governor. Pure logic: it is fed frame times and answers "should the internal resolution change?".
// It never touches the DOM, WebGL or the clock, so it is unit-tested in node with synthetic frame times.
//
// What it does NOT do: guarantee 60 fps. It only trades sharpness for speed when frames are sustainedly slow,
// and restores resolution only after sustained stable frames. Below the minimum scale it stops, whatever the frame rate.
//
// The scale is a multiplier (MIN..MAX, default 0.5..1) applied to the page's base resolution (devicePixelRatio and the
// drawing-buffer cap, or a manual ?scale). Changing it resizes buffers only: shaders are never recompiled and the
// CSS size of the frame, and so the composition and typography, does not change.
//
// Policy (all numbers are the defaults in DEFAULTS and are overridable for tests):
//  * A trimmed mean of the last 60 foreground frames drops the slowest 10%, so an isolated hitch is ignored.
//    Decisions begin after 12 frames / 300 ms; a slow machine is judged quickly even when frames are late.
//  * The first 12 frames after start, resize or restart are ignored. Foreground frames over 250 ms are capped at
//    120 ms and counted; hidden-tab time is discarded explicitly by the caller.
//  * DOWN: trimmed mean above 23 ms -> scale x0.82, x0.68 above 40 ms, or x0.55 above 80 ms. Severe overload reacts
//    within about a second and can reach a 0.35 floor. At least 850 ms pass between reductions.
//  * UP: trimmed mean below 18.5 ms and within 1.15x of the estimated refresh interval (minimum 15 ms) -> scale x1.05.
//    At least `upDwell` (8 s) of stable performance pass between quality probes.
//    On a vsync-capped display frame time cannot show spare headroom, so this is a probe: if it is followed by a DOWN
//    within 10 s, the probe failed: the scale returns to exactly what it was before the probe, that value becomes a
//    ceiling for 120 s, and upDwell doubles (up to 60 s). So a limit costs one brief slow stretch every few minutes, not a flicker.
//  * The gap between the DOWN threshold (24 ms) and the UP condition (<= 18.5 ms) is the hysteresis band: in between,
//    nothing changes.
(function (root) {
  "use strict";

  const DEFAULTS = {
    min: .35, max: 1,
    window: 60, minFrames: 12, minWindowMs: 300, warmup: 12, stallMs: 250, stallContributionMs: 120, trim: .10,
    downMs: 23, hardMs: 40, criticalMs: 80, downStep: .82, hardStep: .68, criticalStep: .55, downDwell: 850,
    upMs: 18.5, upRefreshFactor: 1.15, upStep: 1.05, upDwell: 8000, maxUpDwell: 60000,
    failWindow: 10000, ceilingHold: 120000,
    refreshMin: 15, refreshMax: 34,
  };

  const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
  const round2 = x => Math.round(x * 100) / 100;

  // ?scale=N is a manual override: it fixes the base resolution and switches the governor off. ?adapt=0 switches it off too.
  function parseScaleOptions(query) {
    const get = k => (query && typeof query.get === "function" ? query.get(k) : null);
    const raw = get("scale"), manual = raw !== null && raw !== "" ? parseFloat(raw) : NaN;
    const hasManual = Number.isFinite(manual) && manual > 0;
    const adaptOff = get("adapt") === "0";
    return { manual: hasManual ? clamp(manual, .1, 4) : null, adapt: !hasManual && !adaptOff };
  }

  function createGovernor(options = {}) {
    const C = Object.assign({}, DEFAULTS, options);
    const enabled = options.enabled !== false;
    const lo = Math.max(.05, C.min), hi = Math.max(lo, C.max);
    let scale = clamp(options.initial == null ? hi : options.initial, lo, hi);
    let dts = [], seen = 0, lastChangeAt = null, lastUpAt = null, scaleBeforeUp = null;
    let upDwell = C.upDwell, ceiling = hi, ceilingAt = -Infinity, refresh = null;
    const allDts = [];
    const log = [];

    function trimmedMean(a) {
      const s = a.slice().sort((x, y) => x - y), keep = Math.max(1, Math.floor(s.length * (1 - C.trim)));
      let sum = 0; for (let i = 0; i < keep; i++) sum += s[i];
      return sum / keep;
    }
    function estimateRefresh() {
      if (allDts.length < 30) return null;
      const s = allDts.slice().sort((x, y) => x - y);
      return clamp(s[Math.floor(s.length * .05)], C.refreshMin, C.refreshMax);
    }
    function change(next, now, reason, mean) {
      next = round2(clamp(next, lo, Math.min(hi, ceiling)));
      if (next === scale) return null;
      log.push({ at: Math.round(now), from: scale, to: next, reason, meanMs: +mean.toFixed(1) });
      scale = next; lastChangeAt = now; dts = [];      // the new scale gets a fresh window: old frames say nothing about it
      return scale;
    }

    return {
      get scale() { return scale; },
      get enabled() { return enabled; },
      get log() { return log; },
      get state() { return { scale, upDwell, ceiling, refreshMs: refresh, framesSeen: seen, window: dts.length }; },
      limits: { min: lo, max: hi },

      // Call once per presented frame with the time since the previous frame (ms) and the current time (ms).
      // Returns the new scale if it changed, otherwise null.
      sample(dt, now, { hidden = false } = {}) {
        if (!enabled || !(dt > 0)) return null;
        if (hidden) { dts = []; seen = 0; return null; }
        // In a visible tab, late frames are evidence of overload. Capping stops one debugger pause from
        // dominating the mean while repeated very slow frames still trigger a rapid reduction.
        const measured = dt > C.stallMs ? Math.min(dt, C.stallContributionMs) : dt;
        if (++seen <= C.warmup) return null;
        dts.push(measured); allDts.push(measured);
        if (dts.length > C.window) dts.shift();
        if (allDts.length > 600) allDts.shift();
        // enough evidence: a full window, or at least minFrames spanning minWindowMs (so a slow machine is judged in seconds)
        if (dts.length < C.minFrames || (dts.length < C.window && dts.reduce((a, b) => a + b, 0) < C.minWindowMs)) return null;

        if (now - ceilingAt > C.ceilingHold) ceiling = hi;
        const mean = trimmedMean(dts), since = lastChangeAt == null ? Infinity : now - lastChangeAt;
        refresh = estimateRefresh();

        if (mean > C.downMs && scale > lo && since >= C.downDwell) {
          const step = mean > C.criticalMs ? C.criticalStep : mean > C.hardMs ? C.hardStep : C.downStep;
          let next = scale * step;
          if (lastUpAt != null && now - lastUpAt < C.failWindow && scaleBeforeUp != null) {
            // the probe failed: go back to exactly the scale that worked, and stop probing above it for a while
            ceiling = scaleBeforeUp; ceilingAt = now; upDwell = Math.min(C.maxUpDwell, upDwell * 2);
            next = Math.min(next, scaleBeforeUp) === next && mean > C.hardMs ? next : scaleBeforeUp;
          }
          lastUpAt = null;
          return change(next, now, "slow", mean);
        }
        const holdingRefresh = refresh != null && mean <= refresh * C.upRefreshFactor;
        if (mean <= C.upMs && holdingRefresh && scale < Math.min(hi, ceiling) && since >= upDwell) {
          scaleBeforeUp = scale; lastUpAt = now;
          return change(scale * C.upStep, now, "probe", mean);
        }
        return null;
      },

      // After a resize, a restart or the tab becoming visible again: forget the window and warm up again.
      reset() { dts = []; seen = 0; },
    };
  }

  const api = { createGovernor, parseScaleOptions, DEFAULTS };
  if (typeof module === "object" && module.exports) module.exports = api;
  else (root.ETERNAL = root.ETERNAL || {}).governor = api;
})(typeof self !== "undefined" ? self : globalThis);
