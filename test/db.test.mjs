import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createDatabase } from "../src/db.mjs";

test("user records remain private and survive a database reopen", async () => {
  const directory = await mkdtemp(join(tmpdir(), "cpd-manager-test-"));
  const file = join(directory, "test.sqlite");
  let db = createDatabase(file);
  const alex = db.createUser({ username: "alex", displayName: "Alex Example", passwordSalt: "salt", passwordHash: "hash", role: "admin", mustChangePassword: false });
  const bob = db.createUser({ username: "bob", displayName: "Bob Example", passwordSalt: "salt", passwordHash: "hash", role: "user" });
  const activity = db.createActivity(alex.id, { activityDate: "2026-08-30", name: "MRI safety update", location: "Online", provider: "Example", hours: 2, type: "substantive", summary: "Annual update" });
  db.createReflection(alex.id, { activityId: activity.id, category: "scope", did: "Completed the module", learned: "Reviewed screening risks", impact: "Updated my checks", furtherLearning: "", auditSelected: true });
  db.createActivity(bob.id, { activityDate: "2026-09-01", name: "Bob's private activity", location: "", provider: "", hours: 1, type: "general", summary: "" });
  db.saveSettings(alex.id, { fullName: "Alex Example", registrationNumber: "40-01234", bienniumStart: 2025 });
  db.close();

  db = createDatabase(file);
  const alexState = db.getState(alex.id);
  const bobState = db.getState(bob.id);
  assert.equal(alexState.activities.length, 1);
  assert.equal(alexState.activities[0].reflections.length, 1);
  assert.equal(bobState.activities.length, 1);
  assert.equal(bobState.activities[0].name, "Bob's private activity");
  assert.equal(db.getActivity(bob.id, activity.id), null);
  assert.equal(alexState.settings.fullName, "Alex Example");

  db.saveSettings(alex.id, { bienniumStart: 2023 });
  const switched = db.getState(alex.id);
  assert.equal(switched.settings.bienniumStart, 2023);
  assert.equal(switched.settings.fullName, "Alex Example");
  assert.equal(switched.settings.registrationNumber, "40-01234");

  const stats = db.listUsersWithStats();
  assert.equal(stats.find((user) => user.id === alex.id).activityCount, 1);
  assert.equal(stats.find((user) => user.id === bob.id).activityCount, 1);
  db.close();
  await rm(directory, { recursive: true, force: true });
});
