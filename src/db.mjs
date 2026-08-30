import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";

const now = () => new Date().toISOString();
const toBoolean = (value) => Boolean(Number(value));
const toIntegerBoolean = (value) => value ? 1 : 0;

export function createDatabase(filePath) {
  const db = new DatabaseSync(filePath);
  db.exec("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;");
  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS activities (
      id TEXT PRIMARY KEY,
      activity_date TEXT NOT NULL,
      name TEXT NOT NULL,
      location TEXT NOT NULL DEFAULT '',
      provider TEXT NOT NULL DEFAULT '',
      hours REAL NOT NULL CHECK(hours > 0),
      type TEXT NOT NULL CHECK(type IN ('substantive', 'general')),
      summary TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS attachments (
      id TEXT PRIMARY KEY,
      activity_id TEXT REFERENCES activities(id) ON DELETE CASCADE,
      kind TEXT NOT NULL DEFAULT 'evidence' CHECK(kind IN ('evidence', 'peer')),
      original_name TEXT NOT NULL,
      stored_name TEXT NOT NULL UNIQUE,
      mime_type TEXT NOT NULL,
      size_bytes INTEGER NOT NULL,
      sha256 TEXT NOT NULL,
      audit_selected INTEGER NOT NULL DEFAULT 0,
      name_confirmed INTEGER NOT NULL DEFAULT 0,
      date_confirmed INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS reflections (
      id TEXT PRIMARY KEY,
      activity_id TEXT NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
      category TEXT NOT NULL CHECK(category IN ('ethical', 'scope', 'cultural', 'additional')),
      did TEXT NOT NULL,
      learned TEXT NOT NULL,
      impact TEXT NOT NULL,
      further_learning TEXT NOT NULL DEFAULT '',
      audit_selected INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_activities_date ON activities(activity_date);
    CREATE INDEX IF NOT EXISTS idx_attachments_activity_id ON attachments(activity_id);
    CREATE INDEX IF NOT EXISTS idx_reflections_activity_id ON reflections(activity_id);
    CREATE INDEX IF NOT EXISTS idx_reflections_category_selected ON reflections(category, audit_selected);
    PRAGMA optimize;
  `);

  const currentYear = new Date().getFullYear();
  const defaults = {
    fullName: "",
    registrationNumber: "",
    bienniumStart: String(currentYear % 2 === 1 ? currentYear : currentYear - 1)
  };
  const insertSetting = db.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)");
  for (const [key, value] of Object.entries(defaults)) insertSetting.run(key, value);

  const api = {
    close: () => db.close(),
    getState() {
      const settings = Object.fromEntries(db.prepare("SELECT key, value FROM settings").all().map((row) => [row.key, row.value]));
      settings.bienniumStart = Number(settings.bienniumStart);
      const activities = db.prepare("SELECT * FROM activities ORDER BY activity_date DESC, created_at DESC").all().map(mapActivity);
      const attachments = db.prepare("SELECT * FROM attachments WHERE kind = 'evidence' ORDER BY created_at DESC").all().map(mapAttachment);
      const reflections = db.prepare("SELECT * FROM reflections ORDER BY created_at DESC").all().map(mapReflection);
      for (const activity of activities) {
        activity.attachments = attachments.filter((item) => item.activityId === activity.id);
        activity.reflections = reflections.filter((item) => item.activityId === activity.id);
      }
      const peerRow = db.prepare("SELECT * FROM attachments WHERE kind = 'peer' ORDER BY created_at DESC LIMIT 1").get();
      return { settings, activities, peerDeclaration: peerRow ? mapAttachment(peerRow) : null };
    },
    saveSettings(values) {
      const statement = db.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value");
      for (const key of ["fullName", "registrationNumber", "bienniumStart"]) {
        if (values[key] !== undefined) statement.run(key, String(values[key]).trim());
      }
      return api.getState().settings;
    },
    createActivity(values) {
      const id = randomUUID();
      const timestamp = now();
      db.prepare("INSERT INTO activities (id, activity_date, name, location, provider, hours, type, summary, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .run(id, values.activityDate, values.name.trim(), values.location?.trim() || "", values.provider?.trim() || "", Number(values.hours), values.type, values.summary?.trim() || "", timestamp, timestamp);
      return api.getActivity(id);
    },
    getActivity(id) {
      const row = db.prepare("SELECT * FROM activities WHERE id = ?").get(id);
      if (!row) return null;
      const activity = mapActivity(row);
      activity.attachments = db.prepare("SELECT * FROM attachments WHERE activity_id = ? AND kind = 'evidence' ORDER BY created_at DESC").all(id).map(mapAttachment);
      activity.reflections = db.prepare("SELECT * FROM reflections WHERE activity_id = ? ORDER BY created_at DESC").all(id).map(mapReflection);
      return activity;
    },
    updateActivity(id, values) {
      const result = db.prepare("UPDATE activities SET activity_date = ?, name = ?, location = ?, provider = ?, hours = ?, type = ?, summary = ?, updated_at = ? WHERE id = ?")
        .run(values.activityDate, values.name.trim(), values.location?.trim() || "", values.provider?.trim() || "", Number(values.hours), values.type, values.summary?.trim() || "", now(), id);
      return result.changes ? api.getActivity(id) : null;
    },
    deleteActivity(id) {
      const files = db.prepare("SELECT stored_name FROM attachments WHERE activity_id = ?").all(id).map((row) => row.stored_name);
      db.prepare("DELETE FROM activities WHERE id = ?").run(id);
      return files;
    },
    addAttachment(values) {
      const id = randomUUID();
      db.prepare("INSERT INTO attachments (id, activity_id, kind, original_name, stored_name, mime_type, size_bytes, sha256, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .run(id, values.activityId || null, values.kind || "evidence", values.originalName, values.storedName, values.mimeType, values.sizeBytes, values.sha256, now());
      return mapAttachment(db.prepare("SELECT * FROM attachments WHERE id = ?").get(id));
    },
    getAttachment(id) {
      const row = db.prepare("SELECT * FROM attachments WHERE id = ?").get(id);
      return row ? mapAttachment(row) : null;
    },
    patchAttachment(id, values) {
      const current = api.getAttachment(id);
      if (!current) return null;
      db.prepare("UPDATE attachments SET audit_selected = ?, name_confirmed = ?, date_confirmed = ? WHERE id = ?")
        .run(
          toIntegerBoolean(values.auditSelected ?? current.auditSelected),
          toIntegerBoolean(values.nameConfirmed ?? current.nameConfirmed),
          toIntegerBoolean(values.dateConfirmed ?? current.dateConfirmed),
          id
        );
      return api.getAttachment(id);
    },
    deleteAttachment(id) {
      const item = api.getAttachment(id);
      if (item) db.prepare("DELETE FROM attachments WHERE id = ?").run(id);
      return item;
    },
    replacePeerDeclaration(values) {
      const existing = db.prepare("SELECT * FROM attachments WHERE kind = 'peer'").all().map(mapAttachment);
      db.prepare("DELETE FROM attachments WHERE kind = 'peer'").run();
      return { removed: existing, added: api.addAttachment({ ...values, kind: "peer", activityId: null }) };
    },
    createReflection(values) {
      const id = randomUUID();
      const timestamp = now();
      if (values.auditSelected) db.prepare("UPDATE reflections SET audit_selected = 0 WHERE category = ?").run(values.category);
      db.prepare("INSERT INTO reflections (id, activity_id, category, did, learned, impact, further_learning, audit_selected, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .run(id, values.activityId, values.category, values.did.trim(), values.learned.trim(), values.impact.trim(), values.furtherLearning?.trim() || "", toIntegerBoolean(values.auditSelected), timestamp, timestamp);
      return api.getReflection(id);
    },
    getReflection(id) {
      const row = db.prepare("SELECT * FROM reflections WHERE id = ?").get(id);
      return row ? mapReflection(row) : null;
    },
    updateReflection(id, values) {
      if (values.auditSelected) db.prepare("UPDATE reflections SET audit_selected = 0 WHERE category = ? AND id != ?").run(values.category, id);
      const result = db.prepare("UPDATE reflections SET activity_id = ?, category = ?, did = ?, learned = ?, impact = ?, further_learning = ?, audit_selected = ?, updated_at = ? WHERE id = ?")
        .run(values.activityId, values.category, values.did.trim(), values.learned.trim(), values.impact.trim(), values.furtherLearning?.trim() || "", toIntegerBoolean(values.auditSelected), now(), id);
      return result.changes ? api.getReflection(id) : null;
    },
    selectReflection(id) {
      const reflection = api.getReflection(id);
      if (!reflection) return null;
      db.prepare("UPDATE reflections SET audit_selected = 0 WHERE category = ?").run(reflection.category);
      db.prepare("UPDATE reflections SET audit_selected = 1 WHERE id = ?").run(id);
      return api.getReflection(id);
    },
    deleteReflection(id) {
      return db.prepare("DELETE FROM reflections WHERE id = ?").run(id).changes > 0;
    }
  };
  return api;
}

function mapActivity(row) {
  return {
    id: row.id,
    activityDate: row.activity_date,
    activityYear: Number(row.activity_date.slice(0, 4)),
    name: row.name,
    location: row.location,
    provider: row.provider,
    hours: Number(row.hours),
    type: row.type,
    summary: row.summary,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapAttachment(row) {
  return {
    id: row.id,
    activityId: row.activity_id,
    kind: row.kind,
    originalName: row.original_name,
    storedName: row.stored_name,
    mimeType: row.mime_type,
    sizeBytes: Number(row.size_bytes),
    sha256: row.sha256,
    auditSelected: toBoolean(row.audit_selected),
    nameConfirmed: toBoolean(row.name_confirmed),
    dateConfirmed: toBoolean(row.date_confirmed),
    createdAt: row.created_at
  };
}

function mapReflection(row) {
  return {
    id: row.id,
    activityId: row.activity_id,
    category: row.category,
    did: row.did,
    learned: row.learned,
    impact: row.impact,
    furtherLearning: row.further_learning,
    auditSelected: toBoolean(row.audit_selected),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}
