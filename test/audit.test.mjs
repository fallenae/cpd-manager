import test from "node:test";
import assert from "node:assert/strict";
import { calculateAudit } from "../src/audit.mjs";

function evidence(id, selected = true) {
  return { id, auditSelected: selected, nameConfirmed: true, dateConfirmed: true };
}

test("audit readiness mirrors the MRTB upload shape", () => {
  const state = {
    settings: { fullName: "Alex Example", registrationNumber: "40-01234", bienniumStart: 2025 },
    peerDeclaration: { id: "peer" },
    activities: [
      {
        id: "a1", activityDate: "2025-05-01", activityYear: 2025, name: "Workshop", hours: 20, type: "substantive",
        attachments: [evidence("e1"), evidence("e2"), evidence("e3")],
        reflections: [
          { id: "r1", activityId: "a1", category: "ethical", auditSelected: true },
          { id: "r2", activityId: "a1", category: "scope", auditSelected: true }
        ]
      },
      {
        id: "a2", activityDate: "2026-04-02", activityYear: 2026, name: "Study", hours: 10, type: "substantive",
        attachments: [evidence("e4"), evidence("e5")],
        reflections: [
          { id: "r3", activityId: "a2", category: "cultural", auditSelected: true },
          { id: "r4", activityId: "a2", category: "additional", auditSelected: true }
        ]
      },
      {
        id: "a3", activityDate: "2026-06-02", activityYear: 2026, name: "BLS", hours: 10, type: "general",
        attachments: [evidence("e6")], reflections: []
      }
    ]
  };
  const result = calculateAudit(state);
  assert.equal(result.totals.total, 40);
  assert.equal(result.totals.substantive, 30);
  assert.equal(result.totals.general, 10);
  assert.equal(result.ready, true);
});

test("a ZIP-shaped pile of evidence is not considered ready", () => {
  const state = {
    settings: { fullName: "Alex Example", registrationNumber: "40-01234", bienniumStart: 2025 },
    peerDeclaration: { id: "peer" },
    activities: [{
      id: "a1", activityDate: "2025-05-01", activityYear: 2025, name: "Workshop", hours: 40, type: "substantive",
      attachments: [evidence("one-big-zip")], reflections: []
    }]
  };
  const result = calculateAudit(state);
  assert.equal(result.checks.evidenceCount, false);
  assert.equal(result.checks.evidenceAcrossYears, false);
  assert.equal(result.ready, false);
});
