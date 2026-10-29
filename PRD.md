# PRD (reverse-engineered): *What You Don't See*

Status: derived from the shipped source (README.md, ENGINE.md, TALK.md, and a read of all `*.js` / `*.html` files, ~6,200 lines, ~320 KB of JS). Items marked **[inferred]** are my interpretation of intent, not stated in the repo.

---

## 1. Product summary

A ~4-minute interactive film that teaches **survivorship bias** through the Abraham Wald / WWII bomber story. The viewer rides a B-17, counts bullet holes on the planes that returned, chooses where to add armour, and is then shown that the planes hit in the engines are the ones missing from the data.

Built for the **Claude Opus Build Day**. It doubles as a showpiece: every frame is generated live by WebGL2 shaders, every sound is synthesized by WebAudio, and there are no images, video, audio files or libraries.

## 2. Problem and goals

**Problem.** Survivorship bias is easy to state and hard to feel. People nod at the definition and then repeat the error.

**Goals**
1. The viewer makes the wrong decision on their own, then sees why it was wrong. The aim is to make them feel the bias, not be told about it.
2. The core fact lands in one number: engines were hit on **19%** of planes that came home and **82%** of planes that did not.
3. Make a technical statement: a full cinematic experience from pure code, offline, from a single folder.
4. Run unattended at a booth or demo, on one laptop, with no network.

**Non-goals**
- Not a historical dataset. The simulation is explicitly illustrative, not Wald's data.
- No mobile or touch-first design (README recommends a laptop or larger). **[inferred: touch events exist for pointer input but no mobile layout work is evident]**
- No backend, accounts, analytics, or persistence.

## 3. Audience and usage contexts

| context | needs |
|---|---|
| Hackathon judges / booth visitors | Self-explanatory, resets by itself after 75 s idle, survives a cold laptop |
| Presenter on stage (`?talk`) | Chapter skipping, forced outcomes (`?fate=lost`), scripted talk track (TALK.md) |
| Curious web visitor (GitHub Pages) | Plays start to finish without instructions |
| Contributors | Clear engine contract for adding media and scenes, tools to preview them |

## 4. User experience: the film

Order is fixed in `ORDER` in `film.js`. Each chapter is a "reel" with its own clock.

| # | reel | length | what happens | interaction |
|---|---|---|---|---|
| - | title | until Begin | Shaders compile in the background; button reads "Preparing the film N%" | click Begin (also unlocks audio) |
| - | open | 21 s | "1943." Montage of 18 art styles on the same arc (blueprint, metal, embroidery, thermal, halftone, stained glass, ...), ending on the title | none |
| I | The raid | ~50 s | Formation above clouds, flak, fighters. The viewer's plane is one of the 300 simulated sorties and is outlined in gold | click your plane (or Space/Enter); auto-claims at 25.5 s |
| II | Home | 21.5 s | English airfield; planes land one by one; a counter ticks "N of 300 home". Ends on "250 of 300 came home." | none (skippable in talk mode) |
| III | The count | ~16 s | Thermal camera heat map; holes of returned planes accumulate as the viewer holds | **press and hold ~3 s** (mouse, touch or Space). Time only advances while held |
| IV | The decision | ~12 s | "Armour is heavy... Where does it go?" Zone hover highlight and percentages | click a zone, or press 1/2/3 |
| V | The question | ~20 s | Wald: "Where are the hits on the planes that didn't come back?" | Show me (or Enter); auto after 24 s |
| VI | The missing | ~57 s | Ghosts of the 50 lost planes rise from empty hardstands; their holes fall onto the diagram; heat map splits and resolves into per-zone shares; the viewer's choice is judged | none |
| VII | Everywhere | 32.5 s | The "echo": same bias in old buildings, old songs, fortunes, old trees (illustrations, not data) | none |
| - | Credits | open-ended | "This wasn't a video." The film's own GLSL source rolls as credits; buttons for end panels | Explore the cost, The team |

**Design rules visible in the code**
- Frame is a fixed **2.39:1** letterbox, black bars, opening-frame animation.
- Words are timed cues drawn over the picture, with ink colour (light/dark) chosen from the medium's `ink` property so text stays legible.
- Subtitles bar below the frame; a hidden `#transcript` element mirrors them **[inferred: screen-reader accessibility]**.
- Sound reacts to the story (flak density follows the sky's barrage, hits are panned by hole x-position, silence after a loss).
- `prefers-reduced-motion` reduces flashes and slows the montage.
- Idle reset: 75 s of waiting for input returns to title (disabled by `?talk`). Only time spent *waiting* counts, not time watching.

## 5. Functional requirements

### 5.1 Data model (`model.js`, pure, shared with node tests)
- FR-1: B-17 plan-view geometry (wingspan 2 units, nose +y), three zones: engines, wings and tail, fuselage. The same numbers are injected into the GLSL plane SDF so the data and the picture cannot drift.
- FR-2: Seeded simulation (seed 168): 300 sorties, each 1 + Poisson(2.2) hits uniformly over the airframe. Engine hit is fatal 42% of the time, any other hit 1%.
- FR-3: Exact outputs: 250 home, 50 lost. Share of planes with at least one hit per zone: engines 19% / 82%, wings and tail 90% / 80%, fuselage 54% / 52% (home / lost).
- FR-4: Lost planes carry a fatal hit index and ghost numbers 0..49 in sortie order.
- FR-5: The viewer's plane is drawn from the 300 with its natural odds (50/300). `?fate=lost|home` overrides.
- API: `simulate`, `stats`, `shareHit`, `pickSortie`, `rng`, `planeD`, `zoneAt`.

### 5.2 Rendering engine (`engine.js`, `glsl-common.js`)
- FR-6: WebGL2 only. Failure shows `#fail` with the error text.
- FR-7: Passes per frame: (a) hole field (crisp, depth-tested point sprites into an RGBA8 target), (b) hole glow (half-res, additive, RGBA16F if available), (c) scene layer A, optional layer B for transitions, (d) post.
- FR-8: Post stack: exposure, bloom, grain, vignette, chromatic aberration, defocus, film weave, halation, flash, fade, tint, invert, plus 5+ transition types (mix with centre point).
- FR-9: Per-instance data in a 128-wide RGBA32F texture, rows allocated by owner (rows 0-7 sky, 8-9 ghosts, 10-15 field/night).
- FR-10: **One shader program per medium and per scene**, since one giant shader took about 20 s to compile and a single medium about 1 s. `compileAll()` runs in parallel (`KHR_parallel_shader_compile`) behind the title. A program that fails to compile falls back to `m0` and is logged.
- FR-11: Adaptive quality: render scale drops (min 0.75) only below ~30 fps (`ftAvg > 34 ms`) and recovers above ~45 fps. Heaviest reels start at a reduced `cap`. `?hq` uses full device pixel ratio.

### 5.3 Art media ("a medium")
- FR-12: Contract: `vec3 m_<name>(vec2 p, float d, vec2 n, Hole h)`, valid for both subject shapes (arc, plane), able to morph between them. Registered via `HOLES.mediaDefs.push({id,name,ink,fn,glsl})`.
- FR-13: `thermal` (id 1, `media-core.js`) is the **only honest data view**. Its heat is hole density, then each zone fills with its measured share. All other media are expressive.
- FR-14: Id ranges: 1 core, 10-19 `media-a.js`, 20-29 `media-b.js`. Helper prefixes (`ma_`, `mb_`) avoid collisions because media share GLSL scope.
- Media referenced by the film include: limb, nightlimb, blueprint, metal, embroidery, thermal, halftone, stainedglass, cells, collage, engraving, constellation, ink, xray, sun, topo, kintsugi, record, treerings, coin, stone.
- FR-15: Per-medium brightness lift table in `film.js` (`LIFT`) for dark media in bright rooms.

### 5.4 Scenes
- Scene 0: abstract subject on a black field (arc or plane) rendered by a medium. Used for open, count, decide, wald, ghosts, reveal.
- Scene 1 (`scene-sky.js`): the raid above clouds. Exposes `beats` (flak, fighters, otherHit, yourHits, fatal, drop, turn, end) and a `state.your` the director uses for hit testing.
- Scene 2 (`scene-field.js`): airfield by day, 30 landings, `state.landed` drives the counter.
- Scene 3 (`scene-field.js`): airfield by night with ghosts.
- Scenes are optional. The film has fallbacks to scene 0 if a module is missing, so artists can work independently.

### 5.5 Audio (`audio.js`)
- FR-16: 100% synthesized WebAudio, no assets. Built synchronously inside the Begin click (autoplay policy). Wakes on later input if the browser suspends.
- FR-17: Score: a "mood" bed per chapter (title, dawn, raid, home, hangar, decision, wald, credits, silence), harmonically fixed around D with a recurring motif (A4 E5 D5 A5).
- FR-18: Continuous layers `engines`, `wind`, `tension`, `fire`. One-shots `flak`, `hit`, `fighter`, `boom`, `stamp`, `tick`, `clink`, `bell`, `whoosh`, `riser`, `heartbeat`, `claim`, `motif`. Rate and voice limited. Sound failure never breaks the picture (`au()` wrapper).
- FR-19: `M` toggles mute. `_build(ctx, destination)` is reusable on an OfflineAudioContext for testing.

### 5.6 Director (`film.js`, `index.html`)
- FR-20: A reel is `{chapter, words, subs, cues, dur, enter, exit, layers(t,L,P), tick, waiting, down/move/key, outro}`. `outro` cross-dissolves the last seconds into the next reel's first frame.
- FR-21: Hold-to-count clock: `rate(t)` freezes the reel until the user holds.
- FR-22: Camera helpers `toScreen`/`toWorld`/`toPlane` for hit-testing in rotated/zoomed space.
- FR-23: Keyboard: Space/Enter/1/2/3/M, plus ← and → in talk mode.

### 5.7 End panels (`extras.js`, `making-of.js`)
- **Explore the cost:** modal `<dialog>` showing tokens and time spent building the film, measured from Claude Code session transcripts (snapshot 26 Sep 2026: ~274 M total tokens, 857 calls, 12.1 h wall clock, ~5.4 h active, broken down by sub-agent part).
- **The team:** contributors.
- Both are independent of the film clock and are closed on any chapter change.

### 5.8 URL parameters

| param | effect |
|---|---|
| `?talk` | disables idle reset; enables ←/→ chapter jump |
| `?fate=lost\|home` | force viewer's outcome |
| `?at=<reel>` | start at a chapter after Begin |
| `?hq` | native pixel density |
| `?scale=` | explicit render scale |
| `?still=reel@sec` | render one frame and stop |
| `?strip=open@2,raid@20,...` (`cols`, `seed`, `choice`) | contact sheet of moments |
| `?debug` | exposes `window.__film` (id, t, fps, scale) |

## 6. Tooling and QA

| tool | purpose |
|---|---|
| `lab.html` | still-frame bench for any scene/medium/moment via params (`medium`, `sheet=plane\|arc`, `cam`, `ret`, `lost`, `gain`, `p0..p7`, ...). Shows shader errors on the page for headless testing |
| `perf.html` | compile time and GPU ms/frame for every medium and scene at 1440x602 |
| `audio-test.html` | measures each sound in isolation (offline render) |
| `audio-mix.html` | renders the whole film's mix offline: loudness per chapter, true peak, bass share, clicks |
| `test_model.mjs` | asserts every number shown on screen, geometry containment, determinism, fatal-hit invariants |
| `test_film.py` | runs the model test; checks pages load only local scripts, no `fetch`/`XMLHttpRequest`/`import()` anywhere, and that required claims exist in the copy ("250 of 300 came home.", "one bomber in six", "Abraham Wald", "illustrative simulation") |

Note: `test_film.py` has a stale docstring path (`holes/test_film.py`) and `test_model.mjs` a stale comment (`node holes/test_model.mjs`) from the monorepo it was extracted from. They resolve paths with `__file__`/`import.meta.url`, so they still run.

## 7. Non-functional requirements

| area | requirement | evidence |
|---|---|---|
| Offline | Runs from `file://`, no network at runtime | classic `<script>` files, shared `window.HOLES`, enforced by test_film.py |
| Dependencies | Zero | no package.json, no CDN |
| Performance | 60 fps target, 30 fps floor without blur; first load can take up to 30 s of shader compile (25 programs), cached after | README "At the booth", `perf.html` |
| Resilience | Missing modules, failed shaders, failed audio all degrade instead of crash | fallbacks in `film.js`, `m0`, `au()` |
| Determinism | Same seed gives the same 300 sorties and numbers | test_model.mjs |
| Honesty | On-screen numbers are computed, not typed; heat maps are density per plane, not raw counts | README "The heat maps are honest" |
| Accessibility **[inferred]** | reduced-motion respected, transcript element, keyboard path for every interaction, focus styling in panels | film.js, extras.js |
| Browser | Needs WebGL2; best on Chromium (shader cache; parallel compile extension optional) | engine.js |

## 8. Architecture (as reverse-engineered)

```
index.html  ── loads classic scripts in order, all attach to window.HOLES
 │
 ├─ model.js        pure data + simulation        (also CommonJS for node tests)
 ├─ glsl-common.js  GLSL library, generated from model.GEO (plane SDF, zones, hole lookup, scene 0)
 ├─ engine.js       class Engine: programs, FBOs, hole passes, scene passes, post
 ├─ media-core.js   thermal           ┐
 ├─ media-a.js      media 10-19       ├─ push into HOLES.mediaDefs  (GLSL strings)
 ├─ media-b.js      media 20-29       ┘
 ├─ scene-sky.js    HOLES.scenes.sky    {id:1, glsl, update(t,L,E,ctx), beats, state}
 ├─ scene-field.js  HOLES.scenes.field  {id:2} and .night {id:3}
 ├─ audio.js        HOLES.audio         WebAudio synth graph
 ├─ making-of.js    HOLES.makingOf      static measured data
 ├─ extras.js       HOLES.extras        end-panel dialogs
 └─ film.js         main(): reels, input, cues, render loop, idle reset, adaptive scale
```

**Frame loop (per rAF).** Advance the reel clock (`rate(t)`), fire due cues, call `R.layers(t, L, P)` to fill layer params (scene, medium, shape, camera, arc, plane transform, FX) and post params, optionally build a second layer for an outro dissolve, `E.render(A, B, post, clock)`, then draw DOM words/subtitles/labels, then auto-advance, idle-reset and adapt render scale.

**Shader assembly.** `Engine.build(model)` concatenates common GLSL plus the selected medium and scene `fn` into per-program fragment sources. `main()` reaches only one medium and one scene, so the driver prunes the rest.

**Key design decisions and their rationale**
1. *Global namespace and classic scripts*: lets the film run from disk with no server or bundler.
2. *Program-per-medium*: cut compile time from about 20 s to about 1 s per program.
3. *Data to GLSL via generated source*: one geometry definition, so hit tests in JS and drawing in GLSL agree.
4. *Parallel agent authorship against a contract* (ENGINE.md): media, scenes and score were built by separate Claude agents. This explains the strict conventions (ids, rows, prefixes, `beats` objects with defaults).
5. *Heat-per-plane normalisation*: each side divided by its own plane count so 250 vs 50 compare fairly.

## 9. Risks and open issues

1. **Cold start**: the first load can take up to 30 s on a busy laptop. Mitigated only by the booth checklist and background compile. There is no precompiled fallback.
2. **WebGL2 / float-texture dependence**: needs RGBA32F data texture upload. A `floatOK` path exists for half-float glow, but there is no non-WebGL fallback beyond an error panel.
3. **Mobile / touch**: not designed for it.
4. **Stale comments** in tests (above) and `TALK.md` timings that depend on measured chapter lengths; they drift if reels change.
5. **Hard-coded copy-claims** (`250 of 300`, `19%` in TALK.md) are partly checked by `test_film.py`, but TALK.md numbers are not.
6. **No automated visual or e2e test**: correctness of the art is verified by eye through `lab.html` and `?strip=`.
7. **Interaction ambiguity**: hold-to-count has no explicit keyboard-only affordance text beyond Space **[inferred]**.
8. `making-of.js` is a generated snapshot with no generator script in the repo.

## 10. Success metrics **[inferred, none are instrumented]**
- A viewer completes the film (reaches Credits).
- A viewer's initial armour choice is *not* "engines" (most should pick wings and tail, which sets up the reveal).
- Booth: zero manual resets needed over a day (75 s idle reset works).
- First interactive frame under 2 s on a warm cache; Begin enabled within 30 s cold.

## 11. Possible roadmap
- Precompile or progressive reveal so Begin is never blocked.
- Touch and mobile layout.
- Local choice tally (opt-in, offline) to show "N% of players chose engines".
- A Wald-style "armour where it is missing" simulation the viewer can re-run with different seeds.
- Localisation (copy is inline in `film.js`).
- Move to ES modules plus a bundler only if the `file://` constraint is dropped.
