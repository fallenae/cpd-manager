import assert from "node:assert/strict";
import test from "node:test";
import { hashPassword, normalizeUsername, verifyPassword } from "../src/passwords.mjs";

test("passwords are salted, hashed and verifiable", async () => {
  const first = await hashPassword("correct-horse-battery-staple");
  const second = await hashPassword("correct-horse-battery-staple");
  assert.notEqual(first.salt, second.salt);
  assert.notEqual(first.hash, second.hash);
  assert.equal(await verifyPassword("correct-horse-battery-staple", first.salt, first.hash), true);
  assert.equal(await verifyPassword("incorrect-password", first.salt, first.hash), false);
});

test("usernames are normalized and constrained", () => {
  assert.equal(normalizeUsername("  Alice.Smith  "), "alice.smith");
  assert.throws(() => normalizeUsername("no spaces allowed"));
  assert.throws(() => normalizeUsername("x"));
});
