import test from "node:test";
import assert from "node:assert/strict";
import { generateLogbookDocx, generateReflectionDocx } from "../src/docx.mjs";

const state = {
  settings: { fullName: "Alex Example", registrationNumber: "40-01234" },
  activities: [{
    id: "a1", activityDate: "2025-05-01", activityYear: 2025, name: "Workshop", provider: "MIT", location: "Auckland", hours: 2, type: "substantive",
    attachments: [{ id: "e1" }], reflections: []
  }]
};

test("logbook output is an OOXML package with the expected content", () => {
  const output = generateLogbookDocx(state, { years: [2025, 2026], totals: { substantive: 2, general: 0 }, selectedEvidence: [], selectedReflections: [] });
  assert.equal(output.subarray(0, 2).toString(), "PK");
  assert.match(output.toString("utf8"), /word\/document\.xml/);
  assert.match(output.toString("utf8"), /MRTB CPD Logbook/);
});

test("reflection output includes the three required prompts", () => {
  const output = generateReflectionDocx(state, { activityId: "a1", category: "scope", did: "Did", learned: "Learned", impact: "Changed", furtherLearning: "Next" });
  const text = output.toString("utf8");
  assert.match(text, /What did I do/);
  assert.match(text, /What did I learn/);
  assert.match(text, /How did this affect my practice/);
});
