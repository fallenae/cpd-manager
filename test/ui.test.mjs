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
