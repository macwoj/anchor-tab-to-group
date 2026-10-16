// Unit tests for the strict-lock group layout planner. Run: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { createAnchor, planGroupLayout } from "../lib/anchors.js";

const G = 42;
const tab = (id, index, groupId = G) => ({ id, index, groupId, windowId: 1, url: `https://${id}/`, title: `${id}` });
const anchorFor = (t, createdAt) =>
  createAnchor(t, { id: G, title: "Work", color: "blue" }, createdAt);

// Window: [x(0, other), A(1), B(2), U(3)] — group starts at index 1.
test("already in anchored order -> no moves", () => {
  const A = tab("A", 1), B = tab("B", 2), U = tab("U", 3);
  const anchors = [anchorFor(A, 100), anchorFor(B, 200)];
  assert.deepEqual(planGroupLayout([tab("x", 0, -1), A, B, U], G, anchors), []);
});

test("intruder dragged in front of a single anchored tab", () => {
  const U = tab("U", 1), A = tab("A", 2);
  assert.deepEqual(
    planGroupLayout([U, A], G, [anchorFor(A, 100)]),
    [{ tabId: "A", toIndex: 1 }]
  );
});

test("intruder between two anchored tabs is pushed behind both", () => {
  const A = tab("A", 0), U = tab("U", 1), B = tab("B", 2);
  const anchors = [anchorFor(A, 100), anchorFor(B, 200)];
  assert.deepEqual(planGroupLayout([A, U, B], G, anchors), [
    { tabId: "B", toIndex: 1 },
  ]);
});

test("two anchored tabs swapped -> first anchored returns to the front", () => {
  const B = tab("B", 0), A = tab("A", 1); // A anchored first, but sits second
  const anchors = [anchorFor(A, 100), anchorFor(B, 200)];
  assert.deepEqual(planGroupLayout([B, A], G, anchors), [
    { tabId: "A", toIndex: 0 },
  ]);
});

test("anchored tab dragged to the back comes back to the front", () => {
  const U1 = tab("U1", 0), U2 = tab("U2", 1), A = tab("A", 2);
  assert.deepEqual(
    planGroupLayout([U1, U2, A], G, [anchorFor(A, 100)]),
    [{ tabId: "A", toIndex: 0 }]
  );
});

test("after removing the front anchor, the remaining anchor moves in front of it", () => {
  // X just had its anchor removed (not in anchors anymore); A is still
  // anchored but sits behind a plain tab U.
  const X = tab("X", 0), U = tab("U", 1), A = tab("A", 2);
  assert.deepEqual(planGroupLayout([X, U, A], G, [anchorFor(A, 100)]), [
    { tabId: "A", toIndex: 0 },
  ]);
  // Same, with the remaining anchor directly behind the ex-anchor:
  // desired [A, X, U] — the ex-anchor ends up right behind the block.
  const X2 = tab("X", 0), A2 = tab("A", 1), U2 = tab("U", 2);
  assert.deepEqual(planGroupLayout([X2, A2, U2], G, [anchorFor(A2, 100)]), [
    { tabId: "A", toIndex: 0 },
  ]);
});

test("no anchors for the group -> no moves; empty group -> no moves", () => {
  const A = tab("A", 0);
  assert.deepEqual(planGroupLayout([A], G, []), []);
  assert.deepEqual(planGroupLayout([A], 999, [anchorFor(A, 100)]), []);
});
