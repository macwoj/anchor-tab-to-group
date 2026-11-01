// Unit tests for settings defaults. Run: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_SETTINGS,
  mergeSettings,
  isReopenPromptEnabled,
} from "../lib/settings.js";

test("reopen prompt defaults to true when nothing is stored", () => {
  assert.equal(DEFAULT_SETTINGS.reopenPrompt, true);
  assert.equal(isReopenPromptEnabled(undefined), true);
  assert.equal(isReopenPromptEnabled({}), true);
  assert.deepEqual(mergeSettings(undefined), { reopenPrompt: true });
});

test("an explicit false survives the merge", () => {
  assert.equal(isReopenPromptEnabled({ reopenPrompt: false }), false);
  assert.deepEqual(mergeSettings({ reopenPrompt: false }), {
    reopenPrompt: false,
  });
});

test("other stored keys are preserved", () => {
  assert.deepEqual(mergeSettings({ reopenPrompt: true, other: 1 }), {
    reopenPrompt: true,
    other: 1,
  });
});
