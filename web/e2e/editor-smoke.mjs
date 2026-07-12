/**
 * Browser smoke: claim session, open local markdown editor in headless Chrome.
 * Asserts Muya mount, no pageerrors, and no failed Font loads (CSP font-src).
 *
 * Usage: node web/e2e/editor-smoke.mjs
 */
import { spawn } from "node:child_process";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

const require = createRequire(import.meta.url);
const WebSocket = require("ws");

const root = join(import.meta.dirname, "../..");
const chrome =
  process.env.CHROME_PATH ||
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const md = `# Editor smoke

Hello **bold** and \`code\`.

\`\`\`js
console.log("hi")
\`\`\`

$$E = mc^2$$

\`\`\`mermaid
graph TD
  A-->B
\`\`\`
`;

const dataDir = await mkdtemp(join(tmpdir(), "fk-editor-smoke-data-"));
const mdDir = await mkdtemp(join(tmpdir(), "fk-editor-smoke-md-"));
const mdPath = join(mdDir, "smoke.md");
await writeFile(mdPath, md, "utf8");

const child = spawn("go", ["run", "./scripts/editor-smoke-server.go", mdPath], {
  cwd: root,
  env: { ...process.env, FORKLY_DATA_DIR: dataDir, FORKLY_LISTEN: "127.0.0.1:0" },
  stdio: ["ignore", "pipe", "pipe"],
});

let out = "";
child.stdout.on("data", (d) => (out += d.toString()));
child.stderr.on("data", (d) => (out += d.toString()));

let base = "";
let claimURL = "";
let fileId = "";
for (let i = 0; i < 120; i++) {
  const lines = out
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  const https = lines.filter((l) => l.startsWith("http://"));
  if (https.length >= 2) {
    base = https[0].replace(/\/$/, "");
    claimURL = https[1];
    fileId = lines.find((l) => !l.startsWith("http://") && /^[A-Za-z0-9_-]{10,}$/.test(l)) || "";
    if (fileId) break;
  }
  await sleep(200);
}
if (!base || !claimURL || !fileId) {
  console.error("editor-smoke: server failed\n", out);
  child.kill();
  process.exit(1);
}

const claimRes = await fetch(claimURL, { redirect: "manual" });
const setCookies = claimRes.headers.getSetCookie?.() || [];
if (claimRes.status !== 302 || setCookies.length === 0) {
  console.error("editor-smoke: claim failed", claimRes.status);
  child.kill();
  process.exit(1);
}

const editorURL = `${base}/editor/local/${encodeURIComponent(fileId)}`;
const profile = await mkdtemp(join(tmpdir(), "fk-editor-smoke-chrome-"));
const port = 9333 + Math.floor(Math.random() * 500);
const chromeProc = spawn(
  chrome,
  [
    `--remote-debugging-port=${port}`,
    "--headless=new",
    "--disable-gpu",
    "--no-first-run",
    "--no-default-browser-check",
    `--user-data-dir=${profile}`,
    "about:blank",
  ],
  { stdio: ["ignore", "pipe", "pipe"] },
);

let pageWS = "";
for (let i = 0; i < 50; i++) {
  try {
    const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then((r) => r.json());
    const page = (targets || []).find((t) => t.type === "page" && t.webSocketDebuggerUrl);
    if (page?.webSocketDebuggerUrl) {
      pageWS = page.webSocketDebuggerUrl;
      break;
    }
  } catch {
    // retry
  }
  await sleep(120);
}
if (!pageWS) {
  console.error("editor-smoke: CDP page not ready");
  chromeProc.kill();
  child.kill();
  process.exit(1);
}

const ws = new WebSocket(pageWS);
await new Promise((resolve, reject) => {
  ws.once("open", resolve);
  ws.once("error", reject);
});

let id = 0;
const pending = new Map();
const pageErrors = [];
const failedFonts = [];
const failedRequests = [];

ws.on("message", (raw) => {
  const msg = JSON.parse(String(raw));
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    if (msg.error) reject(new Error(JSON.stringify(msg.error)));
    else resolve(msg.result);
    return;
  }
  if (msg.method === "Runtime.exceptionThrown") {
    pageErrors.push(
      msg.params?.exceptionDetails?.exception?.description ||
        msg.params?.exceptionDetails?.text ||
        JSON.stringify(msg.params),
    );
  }
  if (msg.method === "Network.loadingFailed" && !msg.params?.canceled) {
    if (msg.params?.type === "Font") {
      failedFonts.push(msg.params);
    } else {
      failedRequests.push({ error: msg.params?.errorText, type: msg.params?.type });
    }
  }
  if (msg.method === "Network.responseReceived") {
    const { response } = msg.params || {};
    if (response?.status >= 400 && !String(response.url).endsWith("/favicon.ico")) {
      failedRequests.push({ url: response.url, status: response.status });
    }
  }
});

function send(method, params = {}) {
  const msgId = ++id;
  return new Promise((resolve, reject) => {
    pending.set(msgId, { resolve, reject });
    ws.send(JSON.stringify({ id: msgId, method, params }));
  });
}

await send("Runtime.enable");
await send("Page.enable");
await send("Network.enable");

for (const raw of setCookies) {
  const [nv, ...attrs] = raw.split(";");
  const eq = nv.indexOf("=");
  const name = nv.slice(0, eq);
  const value = nv.slice(eq + 1);
  const attrMap = Object.fromEntries(
    attrs.map((a) => {
      const p = a.trim().split("=");
      return [p[0].toLowerCase(), p[1] ?? true];
    }),
  );
  await send("Network.setCookie", {
    name,
    value,
    domain: "127.0.0.1",
    path: typeof attrMap.path === "string" ? attrMap.path : "/",
    httpOnly: Object.prototype.hasOwnProperty.call(attrMap, "httponly"),
    secure: Object.prototype.hasOwnProperty.call(attrMap, "secure"),
    sameSite: "Lax",
  });
}

await send("Page.navigate", { url: editorURL });
await sleep(10000);

const evalResult = await send("Runtime.evaluate", {
  expression: `({
    title: document.title,
    hasMuya: !!document.querySelector('.forkly-muya-mount'),
    hasTopbar: !!document.querySelector('.forkly-md-editor-topbar'),
    scrollX: window.scrollX,
    topbarX: (() => {
      const el = document.querySelector('.forkly-md-editor-topbar');
      return el ? Math.round(el.getBoundingClientRect().x) : null;
    })(),
    bodyText: (document.body?.innerText || '').slice(0, 400),
  })`,
  returnByValue: true,
});
const state = evalResult?.result?.value ?? evalResult;

ws.close();
chromeProc.kill();
child.kill();
await Promise.all([
  rm(dataDir, { recursive: true, force: true }).catch(() => {}),
  rm(mdDir, { recursive: true, force: true }).catch(() => {}),
  rm(profile, { recursive: true, force: true }).catch(() => {}),
]);

const problems = [];
if (!state?.hasMuya) problems.push("missing .forkly-muya-mount");
if (!state?.hasTopbar) problems.push("missing editor topbar");
if (typeof state?.scrollX === "number" && Math.abs(state.scrollX) > 1) {
  problems.push(`document scrolled off-screen (scrollX=${state.scrollX})`);
}
if (typeof state?.topbarX === "number" && state.topbarX < -10) {
  problems.push(`editor topbar off-screen (x=${state.topbarX})`);
}
if (pageErrors.length) problems.push(`pageerrors: ${pageErrors.join(" | ")}`);
if (failedFonts.length) problems.push(`font load failures: ${failedFonts.length}`);
if (failedRequests.length) problems.push(`failed requests: ${JSON.stringify(failedRequests)}`);

if (problems.length) {
  console.error("editor-smoke FAILED", { state, problems });
  process.exit(10);
}

console.log("editor-smoke ok", { title: state.title, fileId, scrollX: state.scrollX, topbarX: state.topbarX });
process.exit(0);
