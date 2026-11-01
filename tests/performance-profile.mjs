// Compare ETERNAL's fixed-resolution render cost at standard window sizes and the host display-sized viewport.
// Example: ETERNAL_MAXIMIZED_VIEWPORT=1920x1080 ETERNAL_DPR=1 ETERNAL_PROFILE_ADAPT=1 node tests/performance-profile.mjs
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { findChrome, launch } from "./cdp.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const INDEX = pathToFileURL(join(ROOT, "index.html")).href;
const SHOTS = join(ROOT, "tests", "shots");
const CHROME = findChrome();
if (!CHROME) { console.log("SKIP: no headless Chromium found (set CHROME=...)" ); process.exit(0); }
const dpr = Number(process.env.ETERNAL_DPR || 1);
const adaptive = process.env.ETERNAL_PROFILE_ADAPT === "1";
const sizes = [
  { label: "small", width: 800, height: 450 },
  { label: "720p", width: 1280, height: 720 },
  { label: "1080p", width: 1920, height: 1080 },
];
const maximized = process.env.ETERNAL_MAXIMIZED_VIEWPORT;
if (maximized) {
  const m = maximized.match(/^(\d+)x(\d+)$/);
  if (!m) throw new Error("ETERNAL_MAXIMIZED_VIEWPORT must be WIDTHxHEIGHT");
  const width = Number(m[1]), height = Number(m[2]);
  const match = sizes.find(s => s.width === width && s.height === height);
  if (match) match.label += "+host-display";
  else sizes.push({ label: "host-display", width, height });
}
mkdirSync(SHOTS, { recursive: true });
const page = await launch(CHROME);
const reports = [];
try {
  for (const size of sizes) {
    await page.resize(size.width, size.height, dpr);
    await page.goto(`${INDEX}?bench=1${adaptive ? "&adapt=1" : ""}`);
    await page.waitFor("document.documentElement.dataset.reported === '1'", 120000);
    const report = JSON.parse(await page.eval("document.getElementById('report').textContent"));
    const row = { ...size, dpr, report };
    reports.push(row);
    const a = report.animationLoop, g = report.gl;
    console.log(`${size.label} ${size.width}x${size.height}@${dpr} ` +
      `buffer ${g.width}x${g.height} scale ${report.scale.toFixed(2)} ` +
      `avg ${a.avgFps}fps p50/p95/p99 ${a.medianMs}/${a.p95Ms}/${a.p99Ms}ms ` +
      `1%low ${a.onePercentLowFps}fps sync ${report.synchronous.meanMs}ms ` +
      `governor ${report.governor.initialScale}->${report.governor.finalScale} (${report.governor.changes.length} changes) renderer=${g.renderer}`);
  }
  writeFileSync(join(SHOTS, "performance-profile.json"), JSON.stringify({ dpr, adaptive, reports }, null, 2) + "\n");
} finally {
  await page.close();
}
