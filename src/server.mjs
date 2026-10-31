import { createServer } from "node:http";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { extname, isAbsolute, join, normalize, relative, resolve } from "node:path";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import { calculateAudit } from "./audit.mjs";
import { createDatabase } from "./db.mjs";
import { generateLogbookDocx, generateReflectionDocx } from "./docx.mjs";
import { hashPassword, normalizeUsername, validatePassword, verifyPassword } from "./passwords.mjs";
import { MRTB_REQUIREMENTS, REFLECTION_LABELS } from "./requirements.mjs";
import { createZip } from "./zip.mjs";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const publicRoot = join(projectRoot, "public");
const dataRoot = resolve(process.env.DATA_DIR || join(projectRoot, "data"));
const filesRoot = join(dataRoot, "files");
await mkdir(filesRoot, { recursive: true });
const database = createDatabase(join(dataRoot, "cpd-manager.sqlite"));
const port = Number(process.env.PORT || 8787);
const maxUploadBytes = Number(process.env.MAX_UPLOAD_BYTES || 25 * 1024 * 1024); // 25 MB by default.
if (database.countUsers() === 0) {
  const username = normalizeUsername(process.env.CPD_ADMIN_USERNAME || "admin");
  const password = process.env.CPD_ADMIN_PASSWORD || "";
  validatePassword(password);
  const displayName = String(process.env.CPD_ADMIN_DISPLAY_NAME || "Administrator").trim().slice(0, 100) || "Administrator";
  const credentials = await hashPassword(password);
  const admin = database.createUser({ username, displayName, passwordSalt: credentials.salt, passwordHash: credentials.hash, role: "admin", mustChangePassword: false });
  database.addAdminEvent(admin.id, admin.id, "bootstrap_admin_created");
}

const sessionCookie = "cpd_session";
const sessionLifetimeSeconds = 12 * 60 * 60;
const loginAttempts = new Map();

const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon"
};

function json(response, status, value) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  response.end(JSON.stringify(value));
}

function cookies(request) {
  return Object.fromEntries(String(request.headers.cookie || "").split(";").map((item) => item.trim()).filter(Boolean).map((item) => {
    const separator = item.indexOf("=");
    return separator < 0 ? [item, ""] : [item.slice(0, separator), decodeURIComponent(item.slice(separator + 1))];
  }));
}

function sessionFor(request) {
  const token = cookies(request)[sessionCookie];
  if (!token) return null;
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const user = database.getSession(tokenHash);
  return user ? { tokenHash, user } : null;
}

function secureRequest(request) {
  return request.headers["x-forwarded-proto"] === "https";
}

function setSessionCookie(response, request, token, maxAge = sessionLifetimeSeconds) {
  const secure = secureRequest(request) ? "; Secure" : "";
  response.setHeader("set-cookie", `${sessionCookie}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure}`);
}

function loginKey(request) {
  return request.socket.remoteAddress || "unknown";
}

function blockedLogin(request) {
  const item = loginAttempts.get(loginKey(request));
  if (!item || item.resetAt <= Date.now()) {
    loginAttempts.delete(loginKey(request));
    return false;
  }
  return item.count >= 5;
}

function recordFailedLogin(request) {
  const key = loginKey(request);
  const current = loginAttempts.get(key);
  const resetAt = current?.resetAt > Date.now() ? current.resetAt : Date.now() + 15 * 60 * 1000;
  loginAttempts.set(key, { count: (current?.resetAt > Date.now() ? current.count : 0) + 1, resetAt });
}

function download(response, data, filename, type = "application/octet-stream") {
  response.writeHead(200, {
    "content-type": type,
    "content-length": data.length,
    "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
    "cache-control": "no-store"
  });
  response.end(data);
}

async function readJson(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 1024 * 1024) throw new Error("Request is too large");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

async function readUpload(request) {
  const contentLength = Number(request.headers["content-length"] || 0);
  if (contentLength > maxUploadBytes + 1024 * 1024) throw new Error("File is larger than the 25 MB limit");
  const webRequest = new Request(`http://${request.headers.host}${request.url}`, {
    method: request.method,
    headers: request.headers,
    body: Readable.toWeb(request),
    duplex: "half"
  });
  const form = await webRequest.formData();
  const file = form.get("file");
  if (!file || typeof file.arrayBuffer !== "function") throw new Error("Choose a file to upload");
  const data = Buffer.from(await file.arrayBuffer());
  if (data.length > maxUploadBytes) throw new Error("File is larger than the 25 MB limit");
  return { file, data };
}

function validateActivity(userId, values) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(values.activityDate || "")) throw new Error("Enter an activity date");
  const start = Number(database.getState(userId).settings.bienniumStart);
  const activityYear = Number(values.activityDate.slice(0, 4));
  if (![start, start + 1].includes(activityYear)) throw new Error(`Choose a date within ${start}—${start + 1}`);
  if (!values.name?.trim()) throw new Error("Enter an activity name");
  if (!(Number(values.hours) > 0)) throw new Error("Hours must be greater than zero");
  if (!["substantive", "general"].includes(values.type)) throw new Error("Choose a valid CPD type");
}

function validateReflection(userId, values) {
  if (!values.activityId || !database.getActivity(userId, values.activityId)) throw new Error("Choose a linked activity");
  if (!MRTB_REQUIREMENTS.reflectionCategories.includes(values.category)) throw new Error("Choose a valid reflection category");
  for (const field of ["did", "learned", "impact"]) {
    if (!values[field]?.trim()) throw new Error("Complete the three required reflection prompts");
  }
}

function safeExportName(value) {
  return value.normalize("NFKD").replace(/[^a-zA-Z0-9._-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 90) || "document";
}

async function saveUploadedFile(userId, activityId, kind, request) {
  const { file, data } = await readUpload(request);
  const suffix = extname(file.name).slice(0, 12).replace(/[^.a-zA-Z0-9]/g, "");
  const storedName = `${randomUUID()}${suffix}`;
  await writeFile(join(filesRoot, storedName), data, { flag: "wx" });
  const values = {
    activityId,
    kind,
    originalName: file.name,
    storedName,
    mimeType: file.type || "application/octet-stream",
    sizeBytes: data.length,
    sha256: createHash("sha256").update(data).digest("hex")
  };
  if (kind === "peer") {
    const result = database.replacePeerDeclaration(userId, values);
    await Promise.all(result.removed.map((item) => rm(join(filesRoot, item.storedName), { force: true })));
    return result.added;
  }
  return database.addAttachment(userId, values);
}

function publicUser(user) {
  return { id: user.id, username: user.username, displayName: user.displayName, role: user.role, mustChangePassword: user.mustChangePassword };
}

function currentState(user) {
  const state = database.getState(user.id);
  return { ...state, user: publicUser(user), requirements: MRTB_REQUIREMENTS, reflectionLabels: REFLECTION_LABELS, audit: calculateAudit(state) };
}

function assertSameOrigin(request) {
  const origin = request.headers.origin;
  if (!origin) return;
  if (new URL(origin).host !== request.headers.host) throw new Error("Cross-site request blocked");
}

async function handleApi(request, response, url) {
  const path = url.pathname;
  if (!["GET", "HEAD", "OPTIONS"].includes(request.method)) assertSameOrigin(request);
  if (request.method === "GET" && path === "/api/health") return json(response, 200, { ok: true });
  if (request.method === "GET" && path === "/api/auth/status") {
    const session = sessionFor(request);
    return json(response, 200, { authenticated: Boolean(session), user: session ? publicUser(session.user) : null });
  }
  if (request.method === "POST" && path === "/api/auth/login") {
    if (blockedLogin(request)) return json(response, 429, { error: "Too many attempts. Try again in 15 minutes." });
    const values = await readJson(request);
    let username;
    try { username = normalizeUsername(values.username); } catch { username = ""; }
    const user = username ? database.getUserByUsername(username) : null;
    if (!user || user.status !== "active" || !await verifyPassword(values.password, user.passwordSalt, user.passwordHash)) {
      recordFailedLogin(request);
      return json(response, 401, { error: "Incorrect username or password" });
    }
    loginAttempts.delete(loginKey(request));
    const token = randomBytes(32).toString("base64url");
    const tokenHash = createHash("sha256").update(token).digest("hex");
    database.createSession(tokenHash, user.id, new Date(Date.now() + sessionLifetimeSeconds * 1000).toISOString());
    database.recordLogin(user.id);
    setSessionCookie(response, request, token);
    return json(response, 200, { authenticated: true, user: publicUser(user) });
  }
  const session = sessionFor(request);
  if (!session) return json(response, 401, { error: "Sign in to CPD Manager to continue" });
  const user = session.user;
  if (request.method === "POST" && path === "/api/auth/logout") {
    database.deleteSession(session.tokenHash);
    setSessionCookie(response, request, "", 0);
    return json(response, 200, { authenticated: false });
  }
  if (request.method === "POST" && path === "/api/auth/change-password") {
    const values = await readJson(request);
    validatePassword(values.newPassword);
    const current = database.getUserByUsername(user.username);
    if (!user.mustChangePassword && !await verifyPassword(values.currentPassword, current.passwordSalt, current.passwordHash)) return json(response, 401, { error: "Current password is incorrect" });
    const credentials = await hashPassword(values.newPassword);
    database.updatePassword(user.id, credentials.salt, credentials.hash, false);
    database.deleteSessionsForUser(user.id, session.tokenHash);
    database.addAdminEvent(user.id, user.id, "password_changed");
    return json(response, 200, { ok: true });
  }
  if (user.mustChangePassword) return json(response, 403, { error: "Change your temporary password to continue", mustChangePassword: true });

  if (request.method === "GET" && path === "/api/admin/users") {
    if (user.role !== "admin") return json(response, 403, { error: "Administrator access required" });
    return json(response, 200, { users: database.listUsersWithStats() });
  }
  if (request.method === "POST" && path === "/api/admin/users") {
    if (user.role !== "admin") return json(response, 403, { error: "Administrator access required" });
    const values = await readJson(request);
    const username = normalizeUsername(values.username);
    const displayName = String(values.displayName || "").trim();
    if (!displayName || displayName.length > 100) throw new Error("Enter a display name up to 100 characters");
    const credentials = await hashPassword(values.temporaryPassword);
    if (database.getUserByUsername(username)) return json(response, 409, { error: "That username already exists" });
    const created = database.createUser({ username, displayName, passwordSalt: credentials.salt, passwordHash: credentials.hash, role: "user", mustChangePassword: true });
    database.addAdminEvent(user.id, created.id, "user_created");
    return json(response, 201, created);
  }
  let adminMatch = path.match(/^\/api\/admin\/users\/([^/]+)\/(reset-password|status)$/);
  if (adminMatch && request.method === "POST") {
    if (user.role !== "admin") return json(response, 403, { error: "Administrator access required" });
    const target = database.getUserById(adminMatch[1]);
    if (!target) return json(response, 404, { error: "User not found" });
    if (target.id === user.id) return json(response, 400, { error: "Use your own account settings for this action" });
    const values = await readJson(request);
    if (adminMatch[2] === "reset-password") {
      const credentials = await hashPassword(values.temporaryPassword);
      database.updatePassword(target.id, credentials.salt, credentials.hash, true);
      database.deleteSessionsForUser(target.id);
      database.addAdminEvent(user.id, target.id, "password_reset");
      return json(response, 200, { ok: true });
    }
    if (!['active', 'disabled'].includes(values.status)) throw new Error("Choose a valid account status");
    const updated = database.setUserStatus(target.id, values.status);
    database.addAdminEvent(user.id, target.id, values.status === "disabled" ? "user_disabled" : "user_enabled");
    return json(response, 200, updated);
  }

  if (request.method === "GET" && path === "/api/state") return json(response, 200, currentState(user));
  if (request.method === "PUT" && path === "/api/settings") {
    const values = await readJson(request);
    const year = Number(values.bienniumStart);
    if (!Number.isInteger(year) || year < 2001 || year > 2099 || year % 2 !== 1) throw new Error("Enter a valid odd-numbered biennium start year");
    database.saveSettings(user.id, values);
    return json(response, 200, currentState(user));
  }
  if (request.method === "POST" && path === "/api/activities") {
    const values = await readJson(request);
    validateActivity(user.id, values);
    return json(response, 201, database.createActivity(user.id, values));
  }
  let match = path.match(/^\/api\/activities\/([^/]+)$/);
  if (match && request.method === "PUT") {
    const values = await readJson(request);
    validateActivity(user.id, values);
    const activity = database.updateActivity(user.id, match[1], values);
    return activity ? json(response, 200, activity) : json(response, 404, { error: "Activity not found" });
  }
  if (match && request.method === "DELETE") {
    const files = database.deleteActivity(user.id, match[1]);
    if (!files) return json(response, 404, { error: "Activity not found" });
    await Promise.all(files.map((storedName) => rm(join(filesRoot, storedName), { force: true })));
    return json(response, 200, { ok: true });
  }
  match = path.match(/^\/api\/activities\/([^/]+)\/attachments$/);
  if (match && request.method === "POST") {
    if (!database.getActivity(user.id, match[1])) return json(response, 404, { error: "Activity not found" });
    return json(response, 201, await saveUploadedFile(user.id, match[1], "evidence", request));
  }
  if (request.method === "POST" && path === "/api/peer-declaration") {
    return json(response, 201, await saveUploadedFile(user.id, null, "peer", request));
  }
  match = path.match(/^\/api\/attachments\/([^/]+)$/);
  if (match && request.method === "PATCH") {
    const item = database.patchAttachment(user.id, match[1], await readJson(request));
    return item ? json(response, 200, item) : json(response, 404, { error: "File not found" });
  }
  if (match && request.method === "DELETE") {
    const item = database.deleteAttachment(user.id, match[1]);
    if (!item) return json(response, 404, { error: "File not found" });
    await rm(join(filesRoot, item.storedName), { force: true });
    return json(response, 200, { ok: true });
  }
  match = path.match(/^\/api\/attachments\/([^/]+)\/download$/);
  if (match && request.method === "GET") {
    const item = database.getAttachment(user.id, match[1]);
    if (!item) return json(response, 404, { error: "File not found" });
    return download(response, await readFile(join(filesRoot, item.storedName)), item.originalName, item.mimeType);
  }
  if (request.method === "POST" && path === "/api/reflections") {
    const values = await readJson(request);
    validateReflection(user.id, values);
    return json(response, 201, database.createReflection(user.id, values));
  }
  match = path.match(/^\/api\/reflections\/([^/]+)$/);
  if (match && request.method === "PUT") {
    const values = await readJson(request);
    validateReflection(user.id, values);
    const reflection = database.updateReflection(user.id, match[1], values);
    return reflection ? json(response, 200, reflection) : json(response, 404, { error: "Reflection not found" });
  }
  if (match && request.method === "DELETE") {
    return json(response, database.deleteReflection(user.id, match[1]) ? 200 : 404, { ok: true });
  }
  match = path.match(/^\/api\/reflections\/([^/]+)\/select$/);
  if (match && request.method === "POST") {
    const reflection = database.selectReflection(user.id, match[1]);
    return reflection ? json(response, 200, reflection) : json(response, 404, { error: "Reflection not found" });
  }
  if (request.method === "GET" && path === "/api/audit/logbook.docx") {
    const state = database.getState(user.id);
    const audit = calculateAudit(state);
    return download(response, generateLogbookDocx(state, audit), `MRTB_Logbook_${audit.years.join("-")}.docx`, "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
  }
  match = path.match(/^\/api\/audit\/reflections\/([^/]+)\.docx$/);
  if (match && request.method === "GET") {
    const reflection = database.getReflection(user.id, match[1]);
    if (!reflection) return json(response, 404, { error: "Reflection not found" });
    const state = database.getState(user.id);
    return download(response, generateReflectionDocx(state, reflection), `Reflection_${safeExportName(REFLECTION_LABELS[reflection.category])}.docx`, "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
  }
  if (request.method === "GET" && path === "/api/backup.zip") {
    const state = database.getState(user.id);
    const entries = [{ name: "records.json", data: JSON.stringify({ exportedAt: new Date().toISOString(), ...state }, null, 2) }];
    for (const activity of state.activities) {
      for (const item of activity.attachments) {
        entries.push({ name: `files/evidence/${item.id}_${safeExportName(item.originalName)}`, data: await readFile(join(filesRoot, item.storedName)) });
      }
    }
    if (state.peerDeclaration) {
      entries.push({ name: `files/peer/${state.peerDeclaration.id}_${safeExportName(state.peerDeclaration.originalName)}`, data: await readFile(join(filesRoot, state.peerDeclaration.storedName)) });
    }
    entries.push({ name: "README.txt", data: "Portable CPD Manager backup. records.json contains the structured record; files/ contains untouched uploaded originals. Keep this archive private.\r\n" });
    return download(response, createZip(entries), `CPD_Manager_Backup_${new Date().toISOString().slice(0, 10)}.zip`, "application/zip");
  }
  if (request.method === "GET" && path === "/api/audit/pack.zip") {
    const state = database.getState(user.id);
    const audit = calculateAudit(state);
    const entries = [{ name: `00_MRTB_Logbook_${audit.years.join("-")}.docx`, data: generateLogbookDocx(state, audit) }];
    if (state.peerDeclaration) {
      entries.push({ name: `01_Peer_Manager_Declaration${extname(state.peerDeclaration.originalName)}`, data: await readFile(join(filesRoot, state.peerDeclaration.storedName)) });
    }
    for (const [index, item] of audit.selectedEvidence.entries()) {
      entries.push({ name: `${String(index + 2).padStart(2, "0")}_Evidence_${item.activityYear}_${item.activityType}_${safeExportName(item.originalName)}`, data: await readFile(join(filesRoot, item.storedName)) });
    }
    for (const reflection of audit.selectedReflections) {
      entries.push({ name: `Reflection_${safeExportName(REFLECTION_LABELS[reflection.category])}.docx`, data: generateReflectionDocx(state, reflection) });
    }
    const manifest = [
      "MRTB AUDIT PACKAGE",
      `Practitioner: ${state.settings.fullName}`,
      `Registration: ${state.settings.registrationNumber}`,
      `Biennium: ${audit.years.join("–")}`,
      "",
      "IMPORTANT: Upload these files into their separate slots in the MRTB portal. Do not upload this ZIP as one document.",
      "",
      "Logbook: included",
      `Peer/manager declaration: ${state.peerDeclaration ? "included" : "missing"}`,
      `Evidence: ${audit.selectedEvidence.length} selected (${audit.selectedEvidence.filter((item) => item.activityType === "substantive").length} substantive)`,
      `Reflective statements: ${audit.selectedReflections.length} selected`,
      `Audit readiness checks complete: ${audit.ready ? "yes" : "no"}`,
      "",
      `Requirements snapshot: ${MRTB_REQUIREMENTS.version}`,
      MRTB_REQUIREMENTS.sourceUrl
    ].join("\r\n");
    entries.push({ name: "READ_ME_FIRST.txt", data: manifest });
    return download(response, createZip(entries), `MRTB_Audit_Pack_${audit.years.join("-")}.zip`, "application/zip");
  }
  return json(response, 404, { error: "Not found" });
}

async function serveStatic(response, pathname) {
  const requested = pathname === "/" ? "index.html" : pathname.slice(1);
  const root = resolve(publicRoot);
  const filePath = resolve(root, normalize(requested));
  const pathFromRoot = relative(root, filePath);
  if (pathFromRoot.startsWith("..") || isAbsolute(pathFromRoot)) throw new Error("Not found");
  const content = await readFile(filePath);
  response.writeHead(200, { "content-type": mimeTypes[extname(filePath)] || "application/octet-stream", "cache-control": "no-store" });
  response.end(content);
}

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);
    if (url.pathname.startsWith("/api/")) return await handleApi(request, response, url);
    return await serveStatic(response, url.pathname);
  } catch (error) {
    if (request.url?.startsWith("/api/")) return json(response, 400, { error: error.message || "Request failed" });
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("Not found");
  }
});

server.listen(port, "0.0.0.0", () => console.log(`MIT CPD Manager ready at http://localhost:${port}`));
process.on("SIGTERM", () => { database.close(); server.close(() => process.exit(0)); });
