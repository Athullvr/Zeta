const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs"), path = require("path");

const ROOT = path.join(__dirname, "..");
function walk(dir, out = []) {
  for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
    if ([".git", "node_modules", "shots"].includes(f.name)) continue;
    const p = path.join(dir, f.name);
    f.isDirectory() ? walk(p, out) : out.push(p);
  }
  return out;
}
const files = walk(ROOT);
const rel = p => path.relative(ROOT, p);
const runtime = files.filter(f => /\.(html|css|js)$/.test(f) && !rel(f).startsWith("tests" + path.sep));

test("no image, video, audio, font or texture files ship with the project", () => {
  const bad = files.filter(f => /\.(png|jpe?g|gif|webp|avif|svg|ico|bmp|tiff?|mp4|webm|mov|mkv|mp3|ogg|wav|flac|aac|m4a|woff2?|ttf|otf|ktx2?|dds|hdr|exr|glb|gltf|obj)$/i.test(f));
  assert.deepEqual(bad.map(rel), []);
});

test("index.html loads only local scripts and styles, and every one exists", () => {
  const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  const refs = [...html.matchAll(/<(?:script|link)\b[^>]*?(?:src|href)="([^"]+)"/g)].map(m => m[1]);
  assert.ok(refs.length >= 7);
  for (const r of refs) {
    assert.ok(!/^([a-z]+:)?\/\//i.test(r), `${r} must be local`);
    assert.ok(fs.existsSync(path.join(ROOT, r)), `${r} must exist`);
  }
  for (const f of fs.readdirSync(path.join(ROOT, "src"), { recursive: true }).filter(f => f.endsWith(".js")))
    assert.ok(refs.includes("src/" + f.split(path.sep).join("/")), `src/${f} is not loaded by index.html`);
  assert.ok(!/<(img|video|audio|source|iframe|object|embed)\b/i.test(html));
});

test("runtime code makes no network requests or loads external dependencies", () => {
  for (const f of runtime) {
    const code = fs.readFileSync(f, "utf8");
    assert.ok(!/https?:\/\/|\/\/cdn\./i.test(code), `${rel(f)} mentions a remote URL`);
    assert.ok(!/\bfetch\s*\(|XMLHttpRequest|WebSocket|EventSource|sendBeacon|importScripts|\bimport\s*\(|@import|\burl\s*\(/.test(code), `${rel(f)} loads a remote resource`);
    assert.ok(!/new\s+Image\b|createImageBitmap|HTMLImageElement|texImage2D|<img|<video|<audio/i.test(code), `${rel(f)} uses an image or video asset`);
  }
});

test("audio is optional, local-only, and not bundled", () => {
  const code = fs.readFileSync(path.join(ROOT, "src", "audio.js"), "utf8");
  assert.match(code, /assets\/audio\/eternal-score\.mp3/);
  assert.match(code, /audio\.play\(\)/);
  assert.match(code, /sourceValid/);
  assert.ok(!/createOscillator|fetch\s*\(|XMLHttpRequest/.test(code));
  assert.ok(!files.some(f => /\.(mp3|wav|ogg|flac|aac|m4a)$/i.test(f)), "a soundtrack or test recording must not ship");
});

test("no external libraries: no package dependencies", () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
  assert.ok(!pkg.dependencies && !pkg.devDependencies);
});
