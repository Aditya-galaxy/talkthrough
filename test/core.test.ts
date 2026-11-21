import { test } from "node:test";
import assert from "node:assert/strict";
import { checkRewrite } from "../src/lib/guard.ts";
import { buildSteps, toHtml, toMarkdown } from "../src/lib/steps.ts";

test("guard accepts a tidy rewrite of what was said", () => {
  assert.deepEqual(checkRewrite("Go to the Settings page.", "Okay so first you, um, go to the settings page up here."), { ok: true });
  assert.deepEqual(checkRewrite("Click Export and choose CSV.", "there's this export button, you click that and pick CSV"), { ok: true });
});

test("guard rejects invented buttons and details", () => {
  const r = checkRewrite("Open Admin Console and enable Two-Factor Authentication.", "then click on billing");
  assert.equal(r.ok, false);
  assert.equal(!r.ok && r.reason, "new-words");
});

test("guard keeps quoted error text word for word", () => {
  const said = 'it says "invalid token" so you hit retry';
  assert.equal(checkRewrite('If it says "invalid token", click Retry.', said).ok, true);
  const r = checkRewrite("If you see an error, click Retry.", said);
  assert.equal(!r.ok && r.reason, "lost-quote");
});

test("guard rejects empty and runaway answers", () => {
  assert.equal(checkRewrite("   ", "click save").ok, false);
  assert.equal(checkRewrite("Click Save. ".repeat(40), "click save").ok, false);
});

test("steps join short fragments, drop filler, and keep the last screenshot", () => {
  const steps = buildSteps([
    { text: "um", at: 1 },
    { text: "go to", at: 2, shot: "a" },
    { text: "the settings page", at: 3, shot: "b" },
    { text: "then click billing and wait", at: 4, shot: "c" },
  ]);
  assert.equal(steps.length, 2);
  assert.equal(steps[0].said, "go to the settings page");
  assert.equal(steps[0].shot, "b");
  assert.equal(steps[1].shot, "c");
});

test("exports escape HTML and number the steps", () => {
  const steps = buildSteps([{ text: "click the <Save> button now", at: 1 }]);
  assert.match(toHtml("How to <save>", steps), /How to &lt;save&gt;/);
  assert.match(toMarkdown("How to save", steps), /^# How to save\n\n1\. click the <Save> button now/);
});
