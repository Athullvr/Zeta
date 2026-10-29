// Runs the real page in headless Chromium (software WebGL2 via SwiftShader) and checks what node cannot:
// that both shader programs compile, that the picture is deterministic and animates region by region, that the
// frame is never blank, and that the no-WebGL2 path shows a readable message. Writes screenshots to tests/shots/.
// Usage: node tests/browser-check.mjs [--shots-only]   (set CHROME=/path/to/chrome-headless-shell to override)
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, mkdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import assert from "node:assert/strict";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const INDEX = pathToFileURL(join(ROOT, "index.html")).href;
const SHOTS = join(ROOT, "tests", "shots");

function findChrome() {
  if (process.env.CHROME) return process.env.CHROME;
  const base = join(homedir(), ".cache", "ms-playwright");
  if (!existsSync(base)) return null;
  for (const d of readdirSync(base).filter(d => d.startsWith("chromium_headless_shell")).sort().reverse()) {
    const dir = join(base, d);
    for (const sub of readdirSync(dir)) { const p = join(dir, sub, "chrome-headless-shell"); if (existsSync(p)) return p; }
  }
  return null;
}
const CHROME = findChrome();
if (!CHROME) { console.log("SKIP: no headless Chromium found (set CHROME=...)"); process.exit(0); }

const GL = ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"];
const BASE = ["--no-sandbox", "--disable-gpu-sandbox", "--hide-scrollbars", "--virtual-time-budget=100000"];
const run = (args, timeout = 240000) => spawnSync(CHROME, [...BASE, ...args], { encoding: "utf8", timeout, maxBuffer: 1 << 26 });
const dump = (query, size, extra = GL) => run([...extra, `--window-size=${size}`, "--dump-dom", `${INDEX}${query}`]).stdout || "";
const report = html => { const m = html.match(/<pre id="report">([^<]*)<\/pre>/); assert.ok(m, "page produced no report (did it fail to start?)"); return JSON.parse(m[1].replaceAll("&quot;", '"')); };

let failures = 0;
const check = (name, fn) => { try { fn(); console.log("ok   ", name); } catch (e) { failures++; console.log("FAIL ", name, "\n     ", e.message.split("\n")[0]); } };

// 1. compile, determinism, animation, no blank frames
const probeHtml = dump("?probe=1", "960,540");
check("page starts: no failure panel, both programs compiled", () => {
  assert.ok(!/id="fail"[^>]*>(?!\s*<h1><\/h1>)/.test(probeHtml.replace(/id="fail" hidden/, "")) || /id="fail" hidden/.test(probeHtml), "failure panel visible");
  const r = report(probeHtml);
  assert.ok(r.renderer.length > 0);
  console.log("      renderer:", r.renderer, "| float target:", r.floatTarget, "| drawing buffer:", r.size.join("x"));
});
const P = (() => { try { return report(probeHtml); } catch { return null; } })();
if (P) {
  check("rendering is deterministic: same time, identical pixels", () => { for (const m of Object.values(P.moments)) assert.equal(m.identicalRerender, true); });
  check("black at t=0, picture present afterwards, nothing blank or blown out", () => {
    const tl = Object.fromEntries(P.timeline);
    assert.ok(tl[0] < 1, `t=0 mean ${tl[0]}`);
    assert.ok(tl[2] > tl[0] && tl[3] > tl[2], "silver light grows from black");
    for (const t of [5, 7, 9, 11, 13]) assert.ok(tl[t] > 5 && tl[t] < 120, `t=${t} mean ${tl[t]}`);
    assert.ok(tl[14.5] < tl[13], "fades out");
    console.log("      mean brightness (0-255) by second:", P.timeline.map(([t, v]) => `${t}s=${v}`).join(" "));
  });
  check("moon, clouds, mist and castle animate (camera pinned, grain off), measured over 2 s", () => {
    for (const t of [8, 11]) for (const k of ["moon", "clouds", "mist", "castle"]) assert.ok(P.moments[t].change2s[k] > .4, `${k} at ${t}s changed only ${P.moments[t].change2s[k]}`);
    for (const t of [8, 11]) console.log(`      mean level change over 2 s from t=${t}:`, JSON.stringify(P.moments[t].change2s));
  });
}

// 2. screenshots (for eyes; the files are the evidence)
mkdirSync(SHOTS, { recursive: true });
const SIZES = [["1920x1080", [0, 2.5, 5, 7.2, 9.5, 12.5]], ["1280x720", [12.5]], ["800x450", [9.5]], ["520x800", [12.5]]];
check("screenshots written at desktop, small and portrait sizes", () => {
  let n = 0;
  for (const [size, times] of SIZES) for (const t of times) {
    const out = join(SHOTS, `t${String(t).replace(".", "_")}_${size}.png`);
    run([...GL, `--window-size=${size.replace("x", ",")}`, `--screenshot=${out}`, `${INDEX}?t=${t}`]);
    assert.ok(existsSync(out) && statSync(out).size > 2000, `${out} missing or empty`);
    n++;
  }
  console.log(`      ${n} screenshots in tests/shots/`);
});

// 3. no WebGL2: a readable message, not a blank page
check("without WebGL2 the page explains itself", () => {
  const html = dump("", "960,540", ["--disable-gpu", "--disable-webgl", "--disable-3d-apis", "--disable-software-rasterizer"]);
  assert.ok(/WebGL2 is not available/.test(html) && !/id="fail" hidden/.test(html), "no readable error shown");
});

// 4. timing (synchronous, read-back synced). On SwiftShader this is a CPU figure, not a GPU one.
check("frame timing measured", () => {
  for (const size of ["960,540", "1920,1080"]) {
    const r = report(dump("?bench=1", size));
    console.log(`      ${r.info.width}x${r.info.height}: ${r.msPerFrame} ms/frame on [${r.info.renderer}]`);
    assert.ok(r.msPerFrame > 0);
  }
});

console.log(failures ? `\n${failures} check(s) failed` : "\nall browser checks passed");
process.exit(failures ? 1 : 0);
