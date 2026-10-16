// Unit tests for the drag-retry helper in enforce.js. Run: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { isDragError, retryOnDrag } from "../lib/enforce.js";

const dragError = () =>
  new Error("Tabs cannot be edited right now (user may be dragging a tab).");
const noSleep = async () => {};

test("isDragError recognizes Chrome's drag refusal only", () => {
  assert.equal(isDragError(dragError()), true);
  assert.equal(isDragError(new Error("No tab with id: 1")), false);
});

test("retryOnDrag retries drag errors and then succeeds", async () => {
  let calls = 0;
  const result = await retryOnDrag(async () => {
    calls++;
    if (calls < 3) throw dragError();
    return "ok";
  }, 6, 1, noSleep);
  assert.equal(result, "ok");
  assert.equal(calls, 3);
});

test("retryOnDrag gives up after the attempt limit", async () => {
  let calls = 0;
  await assert.rejects(
    retryOnDrag(async () => { calls++; throw dragError(); }, 3, 1, noSleep),
    /cannot be edited/
  );
  assert.equal(calls, 3);
});

test("retryOnDrag does not retry other errors", async () => {
  let calls = 0;
  await assert.rejects(
    retryOnDrag(async () => { calls++; throw new Error("boom"); }, 6, 1, noSleep),
    /boom/
  );
  assert.equal(calls, 1);
});
