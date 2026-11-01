// Unit tests for the reopened-anchor builder. Run: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildReopenedAnchor, isReopenableUrl } from "../lib/reopen.js";

// Regression: tabs.create() can resolve before navigation commits, with
// url "" and no pendingUrl. The reopened anchor must still carry the
// closed tab's URL, or closing it again silently drops it (empty URL
// fails isReopenableUrl and produces no Recently closed entry).
test("reopened anchor keeps the closed URL even from an empty snapshot", () => {
  const closed = {
    tabId: 1,
    windowId: 2,
    groupId: 3,
    groupTitle: "Work",
    groupColor: "blue",
    tabUrl: "https://example.com/docs",
    tabTitle: "Docs",
    createdAt: 12345,
  };
  const snapshot = { id: 9, windowId: 2, url: "" }; // no pendingUrl
  const group = { id: 7, title: "Work", color: "blue", windowId: 2 };
  const anchor = buildReopenedAnchor(closed, snapshot, group);
  assert.equal(anchor.tabUrl, "https://example.com/docs");
  assert.equal(anchor.tabId, 9);
  assert.equal(anchor.groupId, 7);
  assert.equal(anchor.createdAt, 12345); // old slot in anchor order
  assert.equal(isReopenableUrl(anchor.tabUrl), true);
});

test("empty and chrome:// URLs are not reopenable", () => {
  assert.equal(isReopenableUrl(""), false);
  assert.equal(isReopenableUrl("chrome://extensions"), false);
  assert.equal(isReopenableUrl("https://example.com"), true);
});
