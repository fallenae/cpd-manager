import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

async function freePort() {
  return await new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

async function waitForHealth(baseUrl, child) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`test server exited with ${child.exitCode}`);
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("test server did not become ready");
}

test("CPD data requires a password-backed session", async (context) => {
  const dataDir = await mkdtemp(join(tmpdir(), "mit-cpd-auth-"));
  const port = await freePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const password = "long-test-passphrase";
  const child = spawn(process.execPath, ["src/server.mjs"], {
    cwd: new URL("..", import.meta.url),
    env: { ...process.env, DATA_DIR: dataDir, PORT: String(port), CPD_PASSWORD: password },
    stdio: "ignore"
  });

  context.after(async () => {
    child.kill("SIGTERM");
    await new Promise((resolve) => child.once("exit", resolve));
    await rm(dataDir, { recursive: true, force: true });
  });

  await waitForHealth(baseUrl, child);

  const locked = await fetch(`${baseUrl}/api/state`);
  assert.equal(locked.status, 401);

  const rejected = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: baseUrl },
    body: JSON.stringify({ password: "wrong-password" })
  });
  assert.equal(rejected.status, 401);

  const login = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: baseUrl, "x-forwarded-proto": "https" },
    body: JSON.stringify({ password })
  });
  assert.equal(login.status, 200);
  const cookie = login.headers.get("set-cookie");
  assert.match(cookie, /cpd_session=/);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Strict/);
  assert.match(cookie, /Secure/);

  const unlocked = await fetch(`${baseUrl}/api/state`, { headers: { cookie } });
  assert.equal(unlocked.status, 200);
  assert.ok(Array.isArray((await unlocked.json()).activities));
});
