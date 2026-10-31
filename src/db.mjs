import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

const now = () => new Date().toISOString();
const toBoolean = (value) => Boolean(Number(value));
const toIntegerBoolean = (value) => value ? 1 : 0;

export function createDatabase(filePath) {
  const db = new DatabaseSync(filePath);
  db.exec("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;");
  const hasLegacy = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'settings'").get();
  const hasUsers = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'users'").get();
  if (hasLegacy && !hasUsers) throw new Error("Legacy single-user database detected. Back it up, then start this version with an empty data directory.");

  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE COLLATE NOCASE, display_name TEXT NOT NULL,
      password_salt TEXT NOT NULL, password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user' CHECK(role IN ('admin', 'user')),
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'disabled')),
      must_change_password INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL, last_login_at TEXT
    );
    CREATE TABLE IF NOT EXISTS user_settings (
      user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      full_name TEXT NOT NULL DEFAULT '', registration_number TEXT NOT NULL DEFAULT '', biennium_start INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS activities (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      activity_date TEXT NOT NULL, name TEXT NOT NULL, location TEXT NOT NULL DEFAULT '', provider TEXT NOT NULL DEFAULT '',
      hours REAL NOT NULL CHECK(hours > 0), type TEXT NOT NULL CHECK(type IN ('substantive', 'general')),
      summary TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS attachments (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      activity_id TEXT REFERENCES activities(id) ON DELETE CASCADE,
      kind TEXT NOT NULL DEFAULT 'evidence' CHECK(kind IN ('evidence', 'peer')),
      original_name TEXT NOT NULL, stored_name TEXT NOT NULL UNIQUE, mime_type TEXT NOT NULL,
      size_bytes INTEGER NOT NULL, sha256 TEXT NOT NULL,
      audit_selected INTEGER NOT NULL DEFAULT 0, name_confirmed INTEGER NOT NULL DEFAULT 0,
      date_confirmed INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS reflections (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      activity_id TEXT NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
      category TEXT NOT NULL CHECK(category IN ('ethical', 'scope', 'cultural', 'additional')),
      did TEXT NOT NULL, learned TEXT NOT NULL, impact TEXT NOT NULL, further_learning TEXT NOT NULL DEFAULT '',
      audit_selected INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS admin_events (
      id TEXT PRIMARY KEY, actor_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      target_user_id TEXT REFERENCES users(id) ON DELETE SET NULL, action TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_activities_user_date ON activities(user_id, activity_date);
    CREATE INDEX IF NOT EXISTS idx_attachments_user_activity ON attachments(user_id, activity_id);
    CREATE INDEX IF NOT EXISTS idx_reflections_user_activity ON reflections(user_id, activity_id);
    CREATE INDEX IF NOT EXISTS idx_reflections_user_selected ON reflections(user_id, category, audit_selected);
    CREATE INDEX IF NOT EXISTS idx_sessions_expiry ON sessions(expires_at);
    PRAGMA user_version = 2;
    PRAGMA optimize;
  `);

  const currentYear = new Date().getFullYear();
  const defaultBiennium = currentYear % 2 === 1 ? currentYear : currentYear - 1;

  const api = {
    close: () => db.close(),
    countUsers: () => Number(db.prepare("SELECT COUNT(*) AS count FROM users").get().count),
    createUser(values) {
      const id = randomUUID();
      const timestamp = now();
      db.exec("BEGIN IMMEDIATE");
      try {
        db.prepare("INSERT INTO users (id, username, display_name, password_salt, password_hash, role, status, must_change_password, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)")
          .run(id, values.username, values.displayName, values.passwordSalt, values.passwordHash, values.role || "user", toIntegerBoolean(values.mustChangePassword !== false), timestamp, timestamp);
        db.prepare("INSERT INTO user_settings (user_id, full_name, registration_number, biennium_start) VALUES (?, ?, '', ?)")
          .run(id, values.displayName, defaultBiennium);
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
      return api.getUserById(id);
    },
    getUserById(id) {
      const row = db.prepare("SELECT * FROM users WHERE id = ?").get(id);
      return row ? mapUser(row) : null;
    },
    getUserByUsername(username) {
      const row = db.prepare("SELECT * FROM users WHERE username = ? COLLATE NOCASE").get(username);
      return row ? mapUser(row, true) : null;
    },
    recordLogin(userId) {
      const timestamp = now();
      db.prepare("UPDATE users SET last_login_at = ?, updated_at = ? WHERE id = ?").run(timestamp, timestamp, userId);
    },
    updatePassword(userId, passwordSalt, passwordHash, mustChangePassword = false) {
      const result = db.prepare("UPDATE users SET password_salt = ?, password_hash = ?, must_change_password = ?, updated_at = ? WHERE id = ?")
        .run(passwordSalt, passwordHash, toIntegerBoolean(mustChangePassword), now(), userId);
      return result.changes > 0;
    },
    setUserStatus(userId, status) {
      const result = db.prepare("UPDATE users SET status = ?, updated_at = ? WHERE id = ?").run(status, now(), userId);
      if (status === "disabled") api.deleteSessionsForUser(userId);
      return result.changes ? api.getUserById(userId) : null;
    },
    listUsersWithStats() {
      return db.prepare(`SELECT u.*,
        (SELECT COUNT(*) FROM activities a WHERE a.user_id = u.id) AS activity_count,
        (SELECT COUNT(*) FROM attachments x WHERE x.user_id = u.id) AS document_count,
        (SELECT COUNT(*) FROM reflections r WHERE r.user_id = u.id) AS reflection_count,
        (SELECT COALESCE(SUM(x.size_bytes), 0) FROM attachments x WHERE x.user_id = u.id) AS storage_bytes
        FROM users u ORDER BY u.role = 'admin' DESC, u.display_name COLLATE NOCASE`).all().map(mapUserStats);
    },
    addAdminEvent(actorUserId, targetUserId, action) {
      db.prepare("INSERT INTO admin_events (id, actor_user_id, target_user_id, action, created_at) VALUES (?, ?, ?, ?, ?)")
        .run(randomUUID(), actorUserId || null, targetUserId || null, action, now());
    },
    createSession(tokenHash, userId, expiresAt) {
      db.prepare("DELETE FROM sessions WHERE expires_at <= ?").run(now());
      db.prepare("INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)").run(tokenHash, userId, expiresAt, now());
    },
    getSession(tokenHash) {
      db.prepare("DELETE FROM sessions WHERE expires_at <= ?").run(now());
      const row = db.prepare("SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND u.status = 'active'").get(tokenHash);
      return row ? mapUser(row) : null;
    },
    deleteSession(tokenHash) {
      db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(tokenHash);
    },
    deleteSessionsForUser(userId, exceptTokenHash = null) {
      if (exceptTokenHash) db.prepare("DELETE FROM sessions WHERE user_id = ? AND token_hash != ?").run(userId, exceptTokenHash);
      else db.prepare("DELETE FROM sessions WHERE user_id = ?").run(userId);
    },
    getState(userId) {
      const settingsRow = db.prepare("SELECT * FROM user_settings WHERE user_id = ?").get(userId);
      if (!settingsRow) throw new Error("User profile not found");
      const settings = { fullName: settingsRow.full_name, registrationNumber: settingsRow.registration_number, bienniumStart: Number(settingsRow.biennium_start) };
      const activities = db.prepare("SELECT * FROM activities WHERE user_id = ? ORDER BY activity_date DESC, created_at DESC").all(userId).map(mapActivity);
      const attachments = db.prepare("SELECT * FROM attachments WHERE user_id = ? AND kind = 'evidence' ORDER BY created_at DESC").all(userId).map(mapAttachment);
      const reflections = db.prepare("SELECT * FROM reflections WHERE user_id = ? ORDER BY created_at DESC").all(userId).map(mapReflection);
      for (const activity of activities) {
        activity.attachments = attachments.filter((item) => item.activityId === activity.id);
        activity.reflections = reflections.filter((item) => item.activityId === activity.id);
      }
      const peerRow = db.prepare("SELECT * FROM attachments WHERE user_id = ? AND kind = 'peer' ORDER BY created_at DESC LIMIT 1").get(userId);
      return { settings, activities, peerDeclaration: peerRow ? mapAttachment(peerRow) : null };
    },
    saveSettings(userId, values) {
      const current = api.getState(userId).settings;
      db.prepare("UPDATE user_settings SET full_name = ?, registration_number = ?, biennium_start = ? WHERE user_id = ?")
        .run(values.fullName !== undefined ? String(values.fullName).trim() : current.fullName, values.registrationNumber !== undefined ? String(values.registrationNumber).trim() : current.registrationNumber, values.bienniumStart !== undefined ? Number(values.bienniumStart) : current.bienniumStart, userId);
      return api.getState(userId).settings;
    },
    createActivity(userId, values) {
      const id = randomUUID();
      const timestamp = now();
      db.prepare("INSERT INTO activities (id, user_id, activity_date, name, location, provider, hours, type, summary, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .run(id, userId, values.activityDate, values.name.trim(), values.location?.trim() || "", values.provider?.trim() || "", Number(values.hours), values.type, values.summary?.trim() || "", timestamp, timestamp);
      return api.getActivity(userId, id);
    },
    getActivity(userId, id) {
      const row = db.prepare("SELECT * FROM activities WHERE user_id = ? AND id = ?").get(userId, id);
      if (!row) return null;
      const activity = mapActivity(row);
      activity.attachments = db.prepare("SELECT * FROM attachments WHERE user_id = ? AND activity_id = ? AND kind = 'evidence' ORDER BY created_at DESC").all(userId, id).map(mapAttachment);
      activity.reflections = db.prepare("SELECT * FROM reflections WHERE user_id = ? AND activity_id = ? ORDER BY created_at DESC").all(userId, id).map(mapReflection);
      return activity;
    },
    updateActivity(userId, id, values) {
      const result = db.prepare("UPDATE activities SET activity_date = ?, name = ?, location = ?, provider = ?, hours = ?, type = ?, summary = ?, updated_at = ? WHERE user_id = ? AND id = ?")
        .run(values.activityDate, values.name.trim(), values.location?.trim() || "", values.provider?.trim() || "", Number(values.hours), values.type, values.summary?.trim() || "", now(), userId, id);
      return result.changes ? api.getActivity(userId, id) : null;
    },
    deleteActivity(userId, id) {
      const files = db.prepare("SELECT stored_name FROM attachments WHERE user_id = ? AND activity_id = ?").all(userId, id).map((row) => row.stored_name);
      const result = db.prepare("DELETE FROM activities WHERE user_id = ? AND id = ?").run(userId, id);
      return result.changes ? files : null;
    },
    addAttachment(userId, values) {
      const id = randomUUID();
      db.prepare("INSERT INTO attachments (id, user_id, activity_id, kind, original_name, stored_name, mime_type, size_bytes, sha256, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .run(id, userId, values.activityId || null, values.kind || "evidence", values.originalName, values.storedName, values.mimeType, values.sizeBytes, values.sha256, now());
      return api.getAttachment(userId, id);
    },
    getAttachment(userId, id) {
      const row = db.prepare("SELECT * FROM attachments WHERE user_id = ? AND id = ?").get(userId, id);
      return row ? mapAttachment(row) : null;
    },
    patchAttachment(userId, id, values) {
      const current = api.getAttachment(userId, id);
      if (!current) return null;
      db.prepare("UPDATE attachments SET audit_selected = ?, name_confirmed = ?, date_confirmed = ? WHERE user_id = ? AND id = ?")
        .run(toIntegerBoolean(values.auditSelected ?? current.auditSelected), toIntegerBoolean(values.nameConfirmed ?? current.nameConfirmed), toIntegerBoolean(values.dateConfirmed ?? current.dateConfirmed), userId, id);
      return api.getAttachment(userId, id);
    },
    deleteAttachment(userId, id) {
      const item = api.getAttachment(userId, id);
      if (item) db.prepare("DELETE FROM attachments WHERE user_id = ? AND id = ?").run(userId, id);
      return item;
    },
    replacePeerDeclaration(userId, values) {
      const existing = db.prepare("SELECT * FROM attachments WHERE user_id = ? AND kind = 'peer'").all(userId).map(mapAttachment);
      db.prepare("DELETE FROM attachments WHERE user_id = ? AND kind = 'peer'").run(userId);
      return { removed: existing, added: api.addAttachment(userId, { ...values, kind: "peer", activityId: null }) };
    },
    createReflection(userId, values) {
      const id = randomUUID();
      const timestamp = now();
      if (values.auditSelected) db.prepare("UPDATE reflections SET audit_selected = 0 WHERE user_id = ? AND category = ?").run(userId, values.category);
      db.prepare("INSERT INTO reflections (id, user_id, activity_id, category, did, learned, impact, further_learning, audit_selected, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .run(id, userId, values.activityId, values.category, values.did.trim(), values.learned.trim(), values.impact.trim(), values.furtherLearning?.trim() || "", toIntegerBoolean(values.auditSelected), timestamp, timestamp);
      return api.getReflection(userId, id);
    },
    getReflection(userId, id) {
      const row = db.prepare("SELECT * FROM reflections WHERE user_id = ? AND id = ?").get(userId, id);
      return row ? mapReflection(row) : null;
    },
    updateReflection(userId, id, values) {
      if (values.auditSelected) db.prepare("UPDATE reflections SET audit_selected = 0 WHERE user_id = ? AND category = ? AND id != ?").run(userId, values.category, id);
      const result = db.prepare("UPDATE reflections SET activity_id = ?, category = ?, did = ?, learned = ?, impact = ?, further_learning = ?, audit_selected = ?, updated_at = ? WHERE user_id = ? AND id = ?")
        .run(values.activityId, values.category, values.did.trim(), values.learned.trim(), values.impact.trim(), values.furtherLearning?.trim() || "", toIntegerBoolean(values.auditSelected), now(), userId, id);
      return result.changes ? api.getReflection(userId, id) : null;
    },
    selectReflection(userId, id) {
      const reflection = api.getReflection(userId, id);
      if (!reflection) return null;
      db.prepare("UPDATE reflections SET audit_selected = 0 WHERE user_id = ? AND category = ?").run(userId, reflection.category);
      db.prepare("UPDATE reflections SET audit_selected = 1 WHERE user_id = ? AND id = ?").run(userId, id);
      return api.getReflection(userId, id);
    },
    deleteReflection(userId, id) {
      return db.prepare("DELETE FROM reflections WHERE user_id = ? AND id = ?").run(userId, id).changes > 0;
    }
  };
  return api;
}

function mapUser(row, includePassword = false) {
  const user = { id: row.id, username: row.username, displayName: row.display_name, role: row.role, status: row.status, mustChangePassword: toBoolean(row.must_change_password), createdAt: row.created_at, updatedAt: row.updated_at, lastLoginAt: row.last_login_at || null };
  if (includePassword) { user.passwordSalt = row.password_salt; user.passwordHash = row.password_hash; }
  return user;
}

function mapUserStats(row) {
  return { ...mapUser(row), activityCount: Number(row.activity_count), documentCount: Number(row.document_count), reflectionCount: Number(row.reflection_count), storageBytes: Number(row.storage_bytes) };
}

function mapActivity(row) {
  return { id: row.id, activityDate: row.activity_date, activityYear: Number(row.activity_date.slice(0, 4)), name: row.name, location: row.location, provider: row.provider, hours: Number(row.hours), type: row.type, summary: row.summary, createdAt: row.created_at, updatedAt: row.updated_at };
}

function mapAttachment(row) {
  return { id: row.id, activityId: row.activity_id, kind: row.kind, originalName: row.original_name, storedName: row.stored_name, mimeType: row.mime_type, sizeBytes: Number(row.size_bytes), sha256: row.sha256, auditSelected: toBoolean(row.audit_selected), nameConfirmed: toBoolean(row.name_confirmed), dateConfirmed: toBoolean(row.date_confirmed), createdAt: row.created_at };
}

function mapReflection(row) {
  return { id: row.id, activityId: row.activity_id, category: row.category, did: row.did, learned: row.learned, impact: row.impact, furtherLearning: row.further_learning, auditSelected: toBoolean(row.audit_selected), createdAt: row.created_at, updatedAt: row.updated_at };
}
