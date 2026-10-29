# ETERNAL: working notes

- Run it: open `index.html` from disk (no server, no build). URL options: `?t=7.5` one frame, `?loop`, `?scale=0.5`, `?debug`, `?probe`, `?bench`.
- Tests: `npm test` (node, no dependencies). Browser checks: `npm run browser-check` (headless Chromium from the Playwright cache, software WebGL2; writes `tests/shots/`).
- Layout: `src/util.js` maths, `src/director.js` time and frames (pure), `src/scenes/opening.js` timeline + poem, `src/shaders.js` GLSL + uniform contract, `src/renderer.js` WebGL2, `src/overlay.js` DOM type, `src/main.js` boot.
- Adding a uniform: declare it in `UNIFORMS` (shaders.js), in the GLSL, and return it from the scene's `uniforms(t)`; `tests/shaders.test.js` and `tests/director.test.js` fail if any of the three disagree.
- When editing `src/shaders.js` with scripts, assert each replacement matches exactly once (an empty-string slice once corrupted the file).
- `gl.finish()` does not block in Chrome; time GPU work with a 1-pixel `readPixels`. Headless timings are SwiftShader (CPU), not a GPU.
