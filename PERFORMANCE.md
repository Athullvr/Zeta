# Comparing ETERNAL render performance

`npm run profile` benchmarks the same six film moments at 800×450, 1280×720 and 1920×1080. It reports the CSS viewport and film frame, device pixel ratio, WebGL drawing-buffer size, effective render scale, renderer name, average animation-loop FPS, median/p95/p99 frame times, 1% low FPS, and synchronous render cost. The requestAnimationFrame figures describe displayed frame pacing; the synchronous figures use back-to-back draws and readback and include JavaScript and synchronization overhead.

To include the current host display size and match a particular device pixel ratio, run:

```sh
ETERNAL_MAXIMIZED_VIEWPORT=1920x1080 ETERNAL_DPR=1 npm run profile
```

The host used for this profile reports 1920×1080. The CDP profile uses a display-sized emulated viewport without browser chrome; it is not a measurement from a visible, maximized desktop window. Set `ETERNAL_MAXIMIZED_VIEWPORT=WIDTHxHEIGHT` and `ETERNAL_DPR` to values read from the target browser for a direct comparison. Keep the tab visible, use the same browser/GPU/DPR for both runs, and compare the row values in `tests/shots/performance-profile.json`.

To see how the adaptive governor responds during the animation-loop measurement, set `ETERNAL_PROFILE_ADAPT=1`. It records the initial and final scales plus each scale change and reason. The default profile keeps scale fixed so render costs at the three sizes remain comparable.

`npm run browser-check` intentionally uses SwiftShader. Treat those numbers as a software-rendering regression check, not a prediction of hardware-GPU performance. Its report separates animation-loop pacing from synchronous render cost and identifies software rendering by the WebGL renderer string.

## Before optimization

Baseline fixed-scale measurements from the headless SwiftShader profile (`ETERNAL_DPR=1`, one-second windows at six film moments):

| Emulated viewport | Drawing buffer | Avg loop FPS | p50 / p95 / p99 | 1% low | Synchronous ms/frame |
| --- | ---: | ---: | ---: | ---: | ---: |
| 800×450 | 800×335 | 21.3 | 50 / 83.4 / 183.3 ms | 5.5 | 73.9 |
| 1280×720 | 1280×536 | 20.3 | 16.7 / 183.3 / 349.9 ms | 2.9 | 191.6 |
| 1920×1080 (host display size) | 1920×803 | 3.2 | 16.7 / 200 / 13049.5 ms | 0.1 | 490.4 |

All three rows used `ANGLE / SwiftShader`; they expose the severe fill-rate/resolution slope and long software-renderer stalls. The 1920×1080 row is display-sized emulation, not a physical GPU result.
