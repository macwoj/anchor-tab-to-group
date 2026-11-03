// Unit tests for the pure anchor helpers. Run: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createAnchor,
  upsertAnchor,
  removeAnchorByTabId,
  findAnchorByTabId,
  shouldForgetAnchor,
  findOrphanedAnchors,
  moveAnchorToClosed,
  findClosedAnchor,
  removeClosedAnchor,
  restoreBurstClosedGroup,
  anchorIdsStale,
  findAnchorsByWindow,
  findAnchorsByGroup,
  findGroupForAnchor,
  findTabForAnchor,
  groupFirstIndex,
} from "../lib/anchors.js";

const tab = { id: 7, windowId: 1, groupId: 42, url: "https://example.com/", title: "Example" };
const group = { id: 42, windowId: 1, title: "Work", color: "blue" };

test("createAnchor captures ids plus restart keys (url + group title)", () => {
  const a = createAnchor(tab, group, 123);
  assert.equal(a.tabId, 7);
  assert.equal(a.groupId, 42);
  assert.equal(a.tabUrl, "https://example.com/");
  assert.equal(a.groupTitle, "Work");
  assert.equal(a.createdAt, 123);
});

test("upsertAnchor replaces the same tab / same URL instead of duplicating", () => {
  const a1 = createAnchor(tab, group, 1);
  const a2 = createAnchor({ ...tab, id: 9 }, group, 2);
  assert.equal(upsertAnchor([a1], a2).length, 1);
  assert.equal(upsertAnchor([a1], a2)[0].tabId, 9);
});

test("remove + find by tabId", () => {
  const a = createAnchor(tab, group);
  assert.equal(findAnchorByTabId([a], 7), a);
  assert.equal(removeAnchorByTabId([a], 7).length, 0);
});

test("findGroupForAnchor: id match wins, title is the restart fallback", () => {
  const a = createAnchor(tab, group);
  const restored = { id: 99, windowId: 1, title: "Work", color: "blue" };
  assert.equal(findGroupForAnchor(a, [restored]).id, 99);
  assert.equal(findGroupForAnchor(a, [group]).id, 42);
  assert.equal(findGroupForAnchor(a, []), undefined);
});

test("findTabForAnchor matches a still-loading restored tab by pendingUrl", () => {
  const a = createAnchor(tab, group);
  const loading = { id: 91, url: "", pendingUrl: "https://example.com/" };
  assert.equal(findTabForAnchor(a, [loading]).id, 91);
});

test("findTabForAnchor: id match wins, URL is the restart fallback", () => {
  const a = createAnchor(tab, group);
  assert.equal(findTabForAnchor(a, [{ ...tab, id: 55 }]).id, 55);
  assert.equal(findTabForAnchor(a, [tab]).id, 7);
  assert.equal(findTabForAnchor(a, [{ id: 1, url: "https://other/" }]), undefined);
});

test("findAnchorsByWindow / ByGroup scope the position-lock re-check", () => {
  const a = createAnchor(tab, group);
  const other = createAnchor(
    { id: 8, windowId: 2, groupId: 43, url: "https://x/", title: "X" },
    { id: 43, windowId: 2, title: "Other", color: "red" }
  );
  assert.deepEqual(findAnchorsByWindow([a, other], 1), [a]);
  assert.deepEqual(findAnchorsByWindow([a, other], 2), [other]);
  assert.deepEqual(findAnchorsByGroup([a, other], 42), [a]);
  assert.deepEqual(findAnchorsByGroup([a, other], 999), []);
});

test("shouldForgetAnchor: window/browser close keeps the anchor", () => {
  assert.equal(shouldForgetAnchor({ isWindowClosing: true, windowId: 1 }), false);
  assert.equal(shouldForgetAnchor({ isWindowClosing: false, windowId: 1 }), true);
  assert.equal(shouldForgetAnchor(undefined), true);
});

test("findOrphanedAnchors flags anchors with stale window or tab ids", () => {
  const live = createAnchor(tab, group); // windowId 1, tabId 7
  const staleWindow = { ...createAnchor(tab, group), windowId: 99, tabId: 8 };
  const staleTab = { ...createAnchor(tab, group), tabId: 12345 };
  assert.deepEqual(findOrphanedAnchors([live], [1], [7]), []);
  assert.deepEqual(
    findOrphanedAnchors([live, staleWindow, staleTab], [1], [7, 8]),
    [staleWindow, staleTab]
  );
});

test("moveAnchorToClosed moves the anchor aside and caps the list", () => {
  const a = createAnchor(tab, group);
  const { anchors, closed } = moveAnchorToClosed([a], [], a, 1000, 2);
  assert.deepEqual(anchors, []);
  assert.equal(closed.length, 1);
  assert.equal(closed[0].closedAt, 1000);
  assert.equal(closed[0].createdAt, a.createdAt);

  // Re-closing the same URL replaces the older entry; cap keeps newest.
  const b = { ...createAnchor(tab, group), tabUrl: "https://b/" };
  const c = { ...createAnchor(tab, group), tabUrl: "https://c/" };
  const second = moveAnchorToClosed([b], closed, b, 2000, 2);
  const third = moveAnchorToClosed([c], second.closed, c, 3000, 2);
  assert.deepEqual(
    third.closed.map((x) => x.tabUrl),
    ["https://b/", "https://c/"]
  );
  assert.equal(findClosedAnchor(third.closed, "https://b/").closedAt, 2000);
  assert.deepEqual(
    removeClosedAnchor(third.closed, "https://b/").map((x) => x.tabUrl),
    ["https://c/"]
  );
});

test("restoreBurstClosedGroup moves a burst-closed group back to anchors", () => {
  const a = { ...createAnchor(tab, group), tabUrl: "https://a/" };
  const b = {
    ...createAnchor({ ...tab, id: 8 }, group),
    tabUrl: "https://b/",
  };
  const closed = [
    { ...a, closedAt: 1000 },
    { ...b, closedAt: 1500 },
  ];
  const { anchors, closed: rest, restored } = restoreBurstClosedGroup(
    [],
    closed,
    42,
    1,
    2000
  );
  assert.equal(restored.length, 2);
  assert.deepEqual(rest, []);
  assert.deepEqual(
    anchors.map((x) => x.tabUrl),
    ["https://a/", "https://b/"]
  );
  assert.equal(anchors[0].createdAt, a.createdAt); // order preserved
  assert.equal("closedAt" in anchors[0], false);
});

test("restoreBurstClosedGroup leaves slow individual closes alone", () => {
  const a = { ...createAnchor(tab, group), tabUrl: "https://a/" };
  const b = { ...createAnchor(tab, group), tabUrl: "https://b/" };
  // Closed 10s apart: individual closes that emptied the group, not a
  // group close — entries stay in Recently closed.
  const spread = restoreBurstClosedGroup(
    [],
    [
      { ...a, closedAt: 1000 },
      { ...b, closedAt: 11000 },
    ],
    42,
    1,
    11500
  );
  assert.equal(spread.restored.length, 0);
  assert.equal(spread.closed.length, 2);
  // Burst closes, but the group-removal check runs long after: stale.
  const stale = restoreBurstClosedGroup(
    [],
    [
      { ...a, closedAt: 1000 },
      { ...b, closedAt: 1500 },
    ],
    42,
    1,
    20000
  );
  assert.equal(stale.restored.length, 0);
  // Another group's entries are untouched.
  const other = restoreBurstClosedGroup(
    [],
    [{ ...a, closedAt: 1000 }],
    99,
    1,
    1500
  );
  assert.equal(other.restored.length, 0);
  assert.equal(other.closed.length, 1);
});

test("anchorIdsStale detects a restored tab with new window/group ids", () => {
  const a = createAnchor(tab, group);
  assert.equal(anchorIdsStale(a, tab), false);
  assert.equal(anchorIdsStale(a, { ...tab, windowId: 2 }), true);
  assert.equal(anchorIdsStale(a, { ...tab, groupId: 43 }), true);
  assert.equal(anchorIdsStale(a, { ...tab, id: 8 }), false); // id alone is fine
});

test("groupFirstIndex returns the leftmost index of the group", () => {
  const tabs = [
    { index: 0, groupId: -1 }, { index: 3, groupId: 42 },
    { index: 2, groupId: 42 }, { index: 4, groupId: 7 },
  ];
  assert.equal(groupFirstIndex(tabs, 42), 2);
  assert.equal(groupFirstIndex(tabs, 123), undefined);
});
