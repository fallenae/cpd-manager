import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback);

export function validatePassword(password) {
  if (typeof password !== "string" || password.length < 12) throw new Error("Password must be at least 12 characters");
  if (password.length > 200) throw new Error("Password is too long");
}

export async function hashPassword(password) {
  validatePassword(password);
  const salt = randomBytes(16).toString("base64url");
  const hash = await scrypt(password, salt, 64);
  return { salt, hash: Buffer.from(hash).toString("base64url") };
}

export async function verifyPassword(password, salt, expectedHash) {
  if (typeof password !== "string" || !salt || !expectedHash) return false;
  const actual = Buffer.from(await scrypt(password, salt, 64));
  const expected = Buffer.from(expectedHash, "base64url");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function normalizeUsername(value) {
  const username = String(value || "").trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9._-]{2,63}$/.test(username)) throw new Error("Username must be 3–64 characters using letters, numbers, dots, dashes or underscores");
  return username;
}
