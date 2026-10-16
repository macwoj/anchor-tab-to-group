// Unit tests for the pure anchor helpers. Run: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createAnchor,
  upsertAnchor,
  removeAnchorByTabId,
  findAnchorByTabId,
  shouldForgetAnchor,
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

test("groupFirstIndex returns the leftmost index of the group", () => {
  const tabs = [
    { index: 0, groupId: -1 }, { index: 3, groupId: 42 },
    { index: 2, groupId: 42 }, { index: 4, groupId: 7 },
  ];
  assert.equal(groupFirstIndex(tabs, 42), 2);
  assert.equal(groupFirstIndex(tabs, 123), undefined);
});
