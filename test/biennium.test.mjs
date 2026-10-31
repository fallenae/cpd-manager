import assert from "node:assert/strict";
import test from "node:test";
import { activitiesForBiennium, availableBienniums, bienniumStartForYear } from "../public/biennium.js";

test("calendar years map to the correct two-year biennium", () => {
  assert.equal(bienniumStartForYear(2025), 2025);
  assert.equal(bienniumStartForYear(2026), 2025);
  assert.equal(bienniumStartForYear(2024), 2023);
});

test("activities are scoped to the selected biennium", () => {
  const activities = [
    { id: "a", activityYear: 2023 },
    { id: "b", activityYear: 2024 },
    { id: "c", activityYear: 2025 }
  ];
  assert.deepEqual(activitiesForBiennium(activities, 2023).map((item) => item.id), ["a", "b"]);
  assert.deepEqual(activitiesForBiennium(activities, 2025).map((item) => item.id), ["c"]);
});

test("the selector includes recent, recorded and currently selected bienniums", () => {
  const activities = [{ activityYear: 2018 }, { activityYear: 2024 }];
  assert.deepEqual(availableBienniums(activities, 2023, 2026), [2025, 2023, 2021, 2019, 2017, 2015]);
  assert.ok(availableBienniums([], 2027, 2026).includes(2027));
});
