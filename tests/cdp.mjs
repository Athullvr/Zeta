// A minimal Chrome DevTools Protocol client over --remote-debugging-pipe (no dependencies).
// It exists so the browser checks can drive the real page: real requestAnimationFrame, window resizes, screenshots.
import { spawn } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export function findChrome() {
  if (process.env.CHROME) return process.env.CHROME;
  const base = join(homedir(), ".cache", "ms-playwright");
  if (!existsSync(base)) return null;
  for (const d of readdirSync(base).filter(d => d.startsWith("chromium_headless_shell")).sort().reverse()) {
    for (const sub of readdirSync(join(base, d))) { const p = join(base, d, sub, "chrome-headless-shell"); if (existsSync(p)) return p; }
  }
  return null;
}

export const SOFTWARE_GL = ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"];

export async function launch(chrome, extraArgs = SOFTWARE_GL) {
  const proc = spawn(chrome, ["--headless", "--no-sandbox", "--disable-gpu-sandbox", "--hide-scrollbars", "--remote-debugging-pipe", ...extraArgs, "about:blank"],
    { stdio: ["ignore", "ignore", "ignore", "pipe", "pipe"] });
  const toBrowser = proc.stdio[3], fromBrowser = proc.stdio[4];
  let nextId = 1, buffer = "";
  const pending = new Map(), listeners = [];
  fromBrowser.setEncoding("utf8");
  fromBrowser.on("data", chunk => {
    buffer += chunk;
    let i;
    while ((i = buffer.indexOf("\0")) >= 0) {
      const msg = JSON.parse(buffer.slice(0, i)); buffer = buffer.slice(i + 1);
      if (msg.id && pending.has(msg.id)) { const { res, rej } = pending.get(msg.id); pending.delete(msg.id); msg.error ? rej(new Error(`${msg.error.message}`)) : res(msg.result); }
      else for (const l of listeners) l(msg);
    }
  });
  const send = (method, params = {}, sessionId) => new Promise((res, rej) => {
    const id = nextId++; pending.set(id, { res, rej });
    toBrowser.write(JSON.stringify({ id, method, params, sessionId }) + "\0");
  });
  const { targetId } = await send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
  const cmd = (m, p) => send(m, p, sessionId);
  await cmd("Page.enable"); await cmd("Runtime.enable");
  const logs = [];
  listeners.push(m => { if (m.method === "Runtime.consoleAPICalled") logs.push(m.params.args.map(a => a.value ?? a.description).join(" ")); });

  const page = {
    logs,
    async addInitScript(source) { await cmd("Page.addScriptToEvaluateOnNewDocument", { source }); },
    async resize(width, height, dpr = 1) { await cmd("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: dpr, mobile: false }); },
    async goto(url) {
      const loaded = new Promise(r => { const l = m => { if (m.method === "Page.loadEventFired" && m.sessionId === sessionId) { listeners.splice(listeners.indexOf(l), 1); r(); } }; listeners.push(l); });
      await cmd("Page.navigate", { url }); await loaded;
    },
    async eval(expression) {
      const r = await cmd("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
      return r.result.value;
    },
    async waitFor(expression, timeoutMs = 60000, everyMs = 100) {
      const t0 = Date.now();
      while (Date.now() - t0 < timeoutMs) { if (await page.eval(expression)) return true; await new Promise(r => setTimeout(r, everyMs)); }
      throw new Error(`timed out waiting for: ${expression}`);
    },
    async screenshot() { const { data } = await cmd("Page.captureScreenshot", { format: "png" }); return Buffer.from(data, "base64"); },
    async close() { try { await send("Browser.close"); } catch {} proc.kill("SIGKILL"); },
  };
  return page;
}
