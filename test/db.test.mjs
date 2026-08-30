import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createDatabase } from "../src/db.mjs";

test("activities and reflections survive a database reopen", async () => {
  const directory = await mkdtemp(join(tmpdir(), "cpd-manager-test-"));
  const file = join(directory, "test.sqlite");
  let db = createDatabase(file);
  const activity = db.createActivity({ activityDate: "2026-08-30", name: "MRI safety update", location: "Online", provider: "Example", hours: 2, type: "substantive", summary: "Annual update" });
  db.createReflection({ activityId: activity.id, category: "scope", did: "Completed the module", learned: "Reviewed screening risks", impact: "Updated my checks", furtherLearning: "", auditSelected: true });
  db.saveSettings({ fullName: "Alex Example", registrationNumber: "40-01234", bienniumStart: 2025 });
  db.close();
  db = createDatabase(file);
  const state = db.getState();
  assert.equal(state.activities.length, 1);
  assert.equal(state.activities[0].reflections.length, 1);
  assert.equal(state.settings.fullName, "Alex Example");
  db.close();
  await rm(directory, { recursive: true, force: true });
});
