# ETERNAL — Product and implementation brief

This document describes the current source in this repository. It separates implemented behavior from test evidence and work that remains open.

## Product summary

ETERNAL is an offline, procedural gothic romance told as a five act cinematic poem. An immortal figure waits through centuries for a lost beloved. Its emotional movement is loneliness, memory, longing, an oath against time, and acceptance of love that persists without physical presence.

The film is drawn at runtime with JavaScript and WebGL2 shaders. It has no image, video, bundled audio, or font assets; no third party packages; and no runtime network requests. It runs by opening `index.html` from disk. An optional owner-supplied local soundtrack can be played from `assets/audio/eternal-score.mp3`; that file is absent from this repository, so the default experience remains silent until one is supplied.

## Film timeline

The director is the single source of film time. Scene uniforms, camera motion, lightning, transitions, and timed poetry are functions of the timestamp supplied to `frameAt`; they do not keep separate clocks.

| Act | Global interval | Local length | Picture and story | Handoff |
|---|---:|---:|---|---|
| I — The Waiting | 0–28 s | 28 s | The preserved opening grows from darkness into a moonlit castle reveal. The original verse remains: “A hundred winters I have kept your name, and the moon alone still keeps the count.” | 4 s bloom into the cathedral; Act II starts at 24 s. |
| II — The Memory | 24–58 s | 34 s | A receding cathedral nave, pointed arches, shafts of moonlight, dust, and a procedural rose window frame memories of a voice and name. | 4 s fog dissolve; Act III starts at 54 s. |
| III — The Lost Beloved | 54–88 s | 34 s | A ruined moonlit terrace with arches, thorn growth, drifting petals, and a fleeting light shaped like an absent figure. | 3.2 s fade through darkness; Act IV starts at 84.8 s. |
| IV — The Oath | 84.8–120.8 s | 36 s | The exterior castle returns under a gathering storm. Scheduled lightning reveals the stone as the camera rises toward the tower. | Act V starts at 116.8 s and shares the same storm clock and picture for a 4 s continuous handoff. |
| V — Until Eternity | 116.8–168.15 s | 51.35 s | The storm subsides, the camera withdraws through a longer quiet night view, and the final title resolves to black with the soundtrack. | Film ends at about 168.15 s. |

Intervals overlap during transitions, so the complete film is about 168.15 seconds, not the sum of local act lengths. Act I–IV timings and transitions remain unchanged; Act V carries the extended quiet resolution. Transition progress and poetry cues are defined in the director and act/script data.

## Implemented experience

- **Act I:** retains the existing opening scene and expands it to 28 seconds. It reveals clouds, moon, castle, mist, window lights, title, and the required opening verse.
- **Act II:** uses a dedicated interior shader with ray intersections against floor, walls, vault, and end wall. Its geometry and stained glass are mathematical; no cathedral image is loaded.
- **Act III:** uses a separate layered terrace shader for the garden, ruined arcade, balustrade, thorns, figure of light, mist, and petals.
- **Acts IV and V:** share the procedural exterior shader and one scheduled storm timeline. Lightning and camera keyframes are deterministic. Act V carries the storm into a calm wide composition and final fade.
- **Poetry:** all wording and local cue timing live in `src/script.js`; the DOM overlay animates those cues from director state. Fonts come from local system serif fallbacks.
- **Transitions:** the post shader blends the two scene buffers for bloom, fog, and darkness transitions. The IV to V handoff uses the same exterior state without crossfading between different pictures.
- **Rendering:** the renderer compiles four WebGL2 programs once: exterior, interior, terrace, and post. It reuses the targets during playback and does not recompile when the scale changes.
- **Quality controls:** the governor adjusts internal render scale; `?scale=` fixes the base scale and disables adaptation, while `?adapt=0` disables the governor. Buffer size is capped by a 2.6 megapixel budget and device limits.
- **Benchmarking:** `?bench` reports requestAnimationFrame pacing separately from synchronous render cost and labels known software renderers.
- **Failure handling:** unavailable WebGL2, shader compile failures, framebuffer errors, and context loss are surfaced through the failure UI.
- **Local soundtrack playback:** the playback panel supports play, pause, resume, restart, scrubbing, volume, mute, and silent preview. Audio starts only after a user action. A missing or unsupported local file leaves the visual film available silently. Audio follows the director's clock, uses a configurable start offset and fade envelope, and does not change playback speed. Benchmark, fixed-frame, loop, and probe modes do not initialize audio.

## Runtime and code map

Open `index.html` directly; no server or build step is required.

| File | Responsibility |
|---|---|
| `src/director.js` | Pure film timeline, act overlap, transition progress, cue state, and injectable clock. |
| `src/scenes/film.js` | Orders the five acts. |
| `src/scenes/act1.js`–`act5.js` | Act lengths, camera and lighting parameters, shader selection, and transition declarations. |
| `src/scenes/opening.js`, `src/scenes/storm.js` | Reused opening parameters and shared Act IV/V storm timeline. |
| `src/script.js` | Original poetry and local cue timings. |
| `src/shaders*.js` | GLSL sources, procedural shapes, and shader uniform contracts. |
| `src/renderer.js` | WebGL2 setup, scene targets, uniforms, and post pass. |
| `src/governor.js` | Pure adaptive render scale policy and query parsing. |
| `src/audio.js` | Local soundtrack config, audio context, fades, volume, and clock-following logic. |
| `src/bench.js`, `src/main.js` | Benchmark calculations, boot, authoritative clock, playback controls, options, and animation loop. |
| `index.html`, `src/overlay.js`, `styles.css` | Accessible playback panel, timed typography, and fixed 2.39:1 presentation frame. |

Supported URL options include `?t=<seconds>` for a fixed film timestamp, `?act=<1–5>&t=<local seconds>`, `?loop`, `?scale=<number>`, `?adapt=0`, `?bench` or `?bench=<seconds>`, `?debug`, and `?probe`. Audio options are `?audio=<local relative path>`, `?offset=<seconds>`, `?fadein=<seconds>`, `?fadeout=<seconds>`, and `?duration=<seconds>`. The supplied soundtrack is bundled at `assets/audio/eternal-score.mp3`; it plays offline with a 0 s offset, 2.5 s fade-in, and 5 s fade-out by default. The director ends at about 168.15 s, matching the track. `duration` may shorten the passage; the visual also fades to black at a custom shorter endpoint.

## Verification

The repository provides two verification commands:

- `npm test` runs the dependency free Node suite. It checks utilities, governor behavior, shader contracts, asset/offline constraints, soundtrack config and fade math, missing-file handling, opening behavior, and the five act timeline, transitions, cues, determinism, and scale independence.
- `npm run browser-check` drives local headless Chromium over the DevTools protocol with SwiftShader. It checks shader compilation, opening animation probes, governor changes, resize and scale behavior, fixed timestamp renders across all five acts and transition boundaries, deterministic pixels, several viewport shapes, the Act I to II bloom midpoint brightness guard, benchmark behavior, the WebGL2 failure path, and local audio with a generated 440 Hz WAV test tone. The audio checks cover a missing source, explicit-start behavior, pause/resume, restart, seeking, offset alignment, fade gain, mute, and silent preview. It writes screenshots and the temporary test tone under ignored `tests/shots/`.
- In the current browser check, the bloom midpoint measured 70.2/255 against a regression limit of 90/255. The before/after contact sheet is `tests/shots/bloom-before-after.png`.

The browser checks use software rendering. Their timings describe SwiftShader CPU rendering and are not hardware performance claims. Viewport checks include emulated portrait dimensions; they are not tests on a physical phone.

## Outstanding limitations

- No intended soundtrack has been supplied or tested. The audio controller and generated WAV test path are verified, but successful playback of the owner's actual MP3/WAV and its artistic sync still need confirmation with that file. Browser codec support varies; the app does not transcode files.
- The exterior and terrace are intentionally stylized shader scenes with layered analytic silhouettes; they are not full polygonal 3D environments. The cathedral uses analytic ray geometry for depth.
- The transition and screenshot checks establish rendering and timing behavior, not subjective visual quality on every display. The bloom is now localized and reduced, though it remains a pronounced bright beat by design.
- The browser benchmark cannot establish real GPU performance. Hardware and physical mobile devices have not been measured here.
- WebGL2 is required. There is no non-WebGL renderer fallback.
- `PRD.md` is not a performance target: no fixed frame rate is guaranteed by the render scale governor.
