/**
 * Minimal Playwright-style smoke using Node fetch against FORKLY_SERVER_ONLY.
 * Full browser E2E can be added when Playwright is installed in CI.
 *
 * Usage:
 *   FORKLY_SERVER_ONLY=1 FORKLY_DATA_DIR=/tmp/forkly-e2e go run ./cmd/forkly &
 *   node web/e2e/smoke.mjs http://127.0.0.1:PORT OPEN_URL
 */
import { spawn } from "node:child_process";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

const root = join(import.meta.dirname, "../..");
const dataDir = await mkdtemp(join(tmpdir(), "forkly-e2e-"));
const repo = await mkdtemp(join(tmpdir(), "forkly-repo-"));
await writeFile(join(repo, "note.txt"), "hello\n");

const child = spawn("go", ["run", "./cmd/forkly"], {
  cwd: root,
  env: { ...process.env, FORKLY_SERVER_ONLY: "1", FORKLY_DATA_DIR: dataDir },
  stdio: ["ignore", "pipe", "pipe"],
});

let out = "";
child.stdout.on("data", (d) => (out += d.toString()));
child.stderr.on("data", (d) => (out += d.toString()));

for (let i = 0; i < 50; i++) {
  if (out.includes("http://127.0.0.1")) break;
  await sleep(200);
}
const lines = out.trim().split("\n").filter((l) => l.startsWith("http://"));
if (lines.length < 2) {
  console.error("server did not start", out);
  child.kill();
  process.exit(1);
}
const [base, openURL] = lines;

const claim = await fetch(openURL, { redirect: "manual" });
const cookies = claim.headers.getSetCookie?.() || [];
const cookieHeader = cookies.map((c) => c.split(";")[0]).join("; ");
const csrf = cookies.find((c) => c.startsWith("forkly_csrf="))?.split("=")[1]?.split(";")[0];

const add = await fetch(`${base}/local-api/v1/projects`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Cookie: cookieHeader,
    "X-Forkly-CSRF": csrf,
  },
  body: JSON.stringify({ path: repo, init: true }),
});
if (!add.ok) {
  console.error("add failed", await add.text());
  child.kill();
  process.exit(1);
}
const project = await add.json();
const status = await fetch(`${base}/local-api/v1/projects/${project.id}/status`, {
  headers: { Cookie: cookieHeader },
});
const snap = await status.json();
if (!snap.files?.length) {
  console.error("expected dirty files", snap);
  child.kill();
  process.exit(1);
}
console.log("e2e smoke ok", { project: project.id, files: snap.files.length });
child.kill();
await rm(dataDir, { recursive: true, force: true });
process.exit(0);
