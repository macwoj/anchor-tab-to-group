// Regression tests for the window-move heal bug (v0.5.6): a tab that
// keeps its tab/group ids but moves to a new window (saved-group
// reopen, drag to another window — Chrome keeps the group id) must get
// its stored window id persisted, or every reconcile in the new window
// re-runs the heal loop and visibly re-shuffles multi-anchor groups.
// Run: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { createFakeChrome } from "./fake-chrome.mjs";
import { enforceAnchor, reconcileWindow } from "../lib/enforce.js";
import { loadAnchors } from "../lib/anchors.js";

function seedGroup(fake, { windowId, groupId, tabs }) {
  fake.addGroup({ id: groupId, windowId, title: "ttt" });
  for (const t of tabs) fake.addTab({ ...t, windowId, groupId });
}

function seedAnchors(fake, anchors) {
  fake.store.anchors = anchors;
}

test("enforceAnchor persists a window-only move", async () => {
  const fake = createFakeChrome();
  globalThis.chrome = fake;
  seedGroup(fake, {
    windowId: 2,
    groupId: 600,
    tabs: [{ id: 101, index: 0, url: "https://example.com/a" }],
  });
  // Stored window 1 is stale; tab and group ids are unchanged.
  seedAnchors(fake, [
    {
      tabId: 101,
      windowId: 1,
      groupId: 600,
      groupTitle: "ttt",
      tabUrl: "https://example.com/a",
      tabTitle: "A",
      createdAt: 1,
    },
  ]);

  const [anchor] = await loadAnchors();
  assert.equal(await enforceAnchor(anchor), "enforced");
  const [stored] = await loadAnchors();
  assert.equal(stored.windowId, 2);
});

test("reconcileWindow settles a two-anchor group moved to a new window", async () => {
  const fake = createFakeChrome();
  globalThis.chrome = fake;
  // Restored reversed: B first, A second. Anchor order (createdAt) is A, B.
  seedGroup(fake, {
    windowId: 2,
    groupId: 600,
    tabs: [
      { id: 102, index: 0, url: "https://example.com/b" },
      { id: 101, index: 1, url: "https://example.com/a" },
    ],
  });
  seedAnchors(fake, [
    {
      tabId: 101,
      windowId: 1,
      groupId: 600,
      groupTitle: "ttt",
      tabUrl: "https://example.com/a",
      tabTitle: "A",
      createdAt: 1,
    },
    {
      tabId: 102,
      windowId: 1,
      groupId: 600,
      groupTitle: "ttt",
      tabUrl: "https://example.com/b",
      tabTitle: "B",
      createdAt: 2,
    },
  ]);
  let moves = 0;
  const origMove = fake.tabs.move;
  fake.tabs.move = async (...args) => {
    moves++;
    return origMove(...args);
  };

  await reconcileWindow(2);
  const orderAfterFirst = fake.tabsState
    .filter((t) => t.windowId === 2)
    .sort((a, b) => a.index - b.index)
    .map((t) => t.id);
  assert.deepEqual(orderAfterFirst, [101, 102]);
  assert.deepEqual(
    (await loadAnchors()).map((a) => a.windowId),
    [2, 2]
  );

  // A second pass must be a no-op: no moves, order unchanged.
  moves = 0;
  await reconcileWindow(2);
  assert.equal(moves, 0);
  const orderAfterSecond = fake.tabsState
    .filter((t) => t.windowId === 2)
    .sort((a, b) => a.index - b.index)
    .map((t) => t.id);
  assert.deepEqual(orderAfterSecond, [101, 102]);
});
