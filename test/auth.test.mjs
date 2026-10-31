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
    try { if ((await fetch(`${baseUrl}/api/health`)).ok) return; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("test server did not become ready");
}

async function post(baseUrl, path, body, cookie = "") {
  return await fetch(`${baseUrl}${path}`, { method: "POST", headers: { "content-type": "application/json", origin: baseUrl, ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) });
}

test("admin provisioning, forced password changes and cross-user isolation", async (context) => {
  const dataDir = await mkdtemp(join(tmpdir(), "mit-cpd-auth-"));
  const port = await freePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ["src/server.mjs"], {
    cwd: new URL("..", import.meta.url),
    env: { ...process.env, DATA_DIR: dataDir, PORT: String(port), CPD_ADMIN_USERNAME: "admin", CPD_ADMIN_PASSWORD: "long-admin-passphrase", CPD_ADMIN_DISPLAY_NAME: "Test Admin" },
    stdio: "ignore"
  });
  context.after(async () => {
    child.kill("SIGTERM");
    await new Promise((resolve) => child.once("exit", resolve));
    await rm(dataDir, { recursive: true, force: true });
  });
  await waitForHealth(baseUrl, child);

  assert.equal((await fetch(`${baseUrl}/api/state`)).status, 401);
  assert.equal((await post(baseUrl, "/api/auth/login", { username: "admin", password: "wrong-password" })).status, 401);

  const adminLogin = await post(baseUrl, "/api/auth/login", { username: "admin", password: "long-admin-passphrase" });
  assert.equal(adminLogin.status, 200);
  const adminCookie = adminLogin.headers.get("set-cookie").split(";", 1)[0];
  assert.equal((await adminLogin.json()).user.role, "admin");

  const createdResponse = await post(baseUrl, "/api/admin/users", { username: "friend", displayName: "Friend User", temporaryPassword: "temporary-passphrase" }, adminCookie);
  assert.equal(createdResponse.status, 201);
  const created = await createdResponse.json();

  const friendLogin = await post(baseUrl, "/api/auth/login", { username: "friend", password: "temporary-passphrase" });
  assert.equal(friendLogin.status, 200);
  const friendCookie = friendLogin.headers.get("set-cookie").split(";", 1)[0];
  assert.equal((await friendLogin.json()).user.mustChangePassword, true);
  assert.equal((await fetch(`${baseUrl}/api/state`, { headers: { cookie: friendCookie } })).status, 403);

  const changed = await post(baseUrl, "/api/auth/change-password", { newPassword: "friend-permanent-passphrase" }, friendCookie);
  assert.equal(changed.status, 200);
  assert.equal((await fetch(`${baseUrl}/api/state`, { headers: { cookie: friendCookie } })).status, 200);

  const activityResponse = await post(baseUrl, "/api/activities", { activityDate: "2026-08-30", name: "Friend private activity", hours: 1, provider: "", location: "", type: "general", summary: "" }, friendCookie);
  assert.equal(activityResponse.status, 201);
  const activity = await activityResponse.json();
  const adminState = await (await fetch(`${baseUrl}/api/state`, { headers: { cookie: adminCookie } })).json();
  assert.equal(adminState.activities.length, 0);
  assert.equal((await fetch(`${baseUrl}/api/activities/${activity.id}`, { method: "DELETE", headers: { origin: baseUrl, cookie: adminCookie } })).status, 404);

  const users = await (await fetch(`${baseUrl}/api/admin/users`, { headers: { cookie: adminCookie } })).json();
  const friendStats = users.users.find((user) => user.id === created.id);
  assert.equal(friendStats.activityCount, 1);
  assert.equal(friendStats.documentCount, 0);
  assert.ok(friendStats.lastLoginAt);
});
