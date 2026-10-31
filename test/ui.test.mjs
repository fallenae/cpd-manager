import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("form controls do not shadow the form identifier used by delegated submissions", async () => {
  const source = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  const forms = [...source.matchAll(/<form id="([^"]+)"[^>]*>([\s\S]*?)<\/form>/g)];

  assert.ok(forms.length >= 3, "expected the application forms to be present");
  for (const [, formId, contents] of forms) {
    const controlNames = [...contents.matchAll(/\bname="([^"]+)"/g)].map((match) => match[1]);
    assert.ok(!controlNames.includes("id"), `${formId} must not contain a control named id`);
  }

  assert.match(source, /const formId = form\.getAttribute\("id"\)/);
  assert.doesNotMatch(source, /if \(form\.id ===/);
});

test("non-admin users are returned home from a remembered admin route", async () => {
  const source = await readFile(new URL("../public/app.js", import.meta.url), "utf8");

  assert.match(source, /location\.hash === "#admin" && state\.user\.role !== "admin"/);
  assert.match(source, /history\.replaceState\(null, "", "#home"\)/);
});

test("empty attachment storage is displayed as zero bytes", async () => {
  const source = await readFile(new URL("../public/app.js", import.meta.url), "utf8");

  assert.match(source, /bytes === 0 \? "0 B"/);
});

test("the app header identifies the signed-in account without duplicating the logbook name", async () => {
  const source = await readFile(new URL("../public/app.js", import.meta.url), "utf8");

  assert.ok(source.includes('${escapeHtml(state.user.displayName)} · @${escapeHtml(state.user.username)}'));
});
