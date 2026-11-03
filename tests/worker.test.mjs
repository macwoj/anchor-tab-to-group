// Worker tests: drive the real service worker through fake Chrome
// events. Each test gets a fresh fake + a fresh worker instance, and
// unique window/group/tab ids so deferred timers from one test cannot
// touch another. Run: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { createFakeChrome, loadWorker, sleep } from "./fake-chrome.mjs";

let caseNo = 0;

async function setup(options) {
  const fake = createFakeChrome(options);
  await loadWorker(fake, `case-${++caseNo}`);
  return fake;
}

async function loadAnchors(fake) {
  return (await fake.storage.local.get("anchors")).anchors ?? [];
}

async function loadClosed(fake) {
  return (await fake.storage.local.get("closedAnchors")).closedAnchors ?? [];
}

function seedAnchor(fake, anchor) {
  return fake.storage.local.set({ anchors: [anchor] });
}

// 0.5.5 regression: a saved-group reopen keeps the tab id but changes
// the window/group ids. The badge matches by tab id, but the lock used
// to filter by stored window id and never see the tab.
test("saved-group reopen: restored tab is healed and locked", async () => {
  const fake = await setup();
  await seedAnchor(fake, {
    tabId: 71, windowId: 11, groupId: 41,
    groupTitle: "Work", groupColor: "blue",
    tabUrl: "https://example.com/", tabTitle: "Example", createdAt: 5,
  });
  const group = fake.addGroup({ id: 91, windowId: 12, title: "Work", color: "blue" });
  const tab = fake.addTab({ id: 71, windowId: 12, groupId: 91, index: 1, url: "https://example.com/", title: "Example" });
  fake.addTab({ id: 72, windowId: 12, groupId: 91, index: 0, url: "https://other.com/", title: "Other" });
  fake.currentWindowId = 12;

  await fake.tabs.onCreated.fire(tab);
  await fake.tabGroups.onCreated.fire(group);
  await fake.tabs.onActivated.fire({ tabId: 71, windowId: 12 });
  await fake.tabs.onUpdated.fire(71, { status: "complete" }, tab);
  await sleep(1200); // deferred reconciles

  const [anchor] = await loadAnchors(fake);
  assert.equal(anchor.windowId, 12);
  assert.equal(anchor.groupId, 91);
  assert.equal(fake.setBadge(71).text, "⚓");
  // Heal moved it to the front of the group (index 0).
  assert.equal(fake.tabsState.find((t) => t.id === 71).index, 0);

  // Drag it behind the other member: the lock must snap it back.
  await fake.tabs.move(71, { index: 1 });
  await fake.tabs.onMoved.fire(71, { windowId: 12, fromIndex: 0, toIndex: 1 });
  await sleep(1200);
  assert.equal(fake.tabsState.find((t) => t.id === 71).index, 0);
});

// 0.4.3 regression: window reopen assigns new ids; anchors re-match
// by URL + group title.
test("window reopen: orphan anchor re-matches by URL and title", async () => {
  const fake = await setup();
  await seedAnchor(fake, {
    tabId: 73, windowId: 13, groupId: 43,
    groupTitle: "Work", groupColor: "blue",
    tabUrl: "https://example.com/docs", tabTitle: "Docs", createdAt: 7,
  });
  const group = fake.addGroup({ id: 93, windowId: 14, title: "Work", color: "blue" });
  const tab = fake.addTab({ id: 79, windowId: 14, groupId: 93, index: 0, url: "https://example.com/docs", title: "Docs" });
  fake.addTab({ id: 80, windowId: 14, groupId: 93, index: 1, url: "https://example.com/other", title: "Other" });
  fake.currentWindowId = 14;

  await fake.tabs.onCreated.fire(tab);
  await fake.tabGroups.onCreated.fire(group);
  await sleep(1200);

  const [anchor] = await loadAnchors(fake);
  assert.equal(anchor.tabId, 79);
  assert.equal(anchor.windowId, 14);
  assert.equal(anchor.groupId, 93);
  assert.equal(fake.setBadge(79).text, "⚓");
});

// 0.5.3 regression: closing a whole group keeps its anchors for a
// later restore instead of listing each tab as individually closed.
test("group close: burst-closed anchors return to the active list", async () => {
  const fake = await setup();
  await fake.storage.local.set({
    anchors: [
      { tabId: 75, windowId: 15, groupId: 45, groupTitle: "Team", groupColor: "green", tabUrl: "https://a.com/", tabTitle: "A", createdAt: 1 },
      { tabId: 76, windowId: 15, groupId: 45, groupTitle: "Team", groupColor: "green", tabUrl: "https://b.com/", tabTitle: "B", createdAt: 2 },
    ],
  });
  fake.addGroup({ id: 45, windowId: 15, title: "Team", color: "green" });
  fake.addTab({ id: 75, windowId: 15, groupId: 45, index: 0, url: "https://a.com/", title: "A" });
  fake.addTab({ id: 76, windowId: 15, groupId: 45, index: 1, url: "https://b.com/", title: "B" });

  // Fire sequentially with a pause: the worker handles each close in a
  // fire-and-forget async chain, so the two closes must not interleave
  // their load-modify-save storage writes.
  await fake.tabs.onRemoved.fire(75, { windowId: 15, isWindowClosing: false });
  await sleep(100);
  await fake.tabs.onRemoved.fire(76, { windowId: 15, isWindowClosing: false });
  await sleep(100);
  await fake.tabGroups.onRemoved.fire({ id: 45, windowId: 15, title: "Team", color: "green" });
  await sleep(800); // 500 ms group-close delay + margin

  const anchors = await loadAnchors(fake);
  assert.deepEqual(anchors.map((a) => a.tabId).sort(), [75, 76]);
  assert.deepEqual(await loadClosed(fake), []);
  assert.equal(fake.notifications.items.size, 0);
});

// 0.5.0 + 0.5.2 regression: individual close prompts, reopen restores
// the tab/group/order, and closing it again re-lists it.
test("individual close: reopen prompt round-trips", async () => {
  const fake = await setup();
  await fake.storage.local.set({
    anchors: [
      { tabId: 77, windowId: 16, groupId: 46, groupTitle: "Solo", groupColor: "red", tabUrl: "https://example.com/a", tabTitle: "A", createdAt: 9 },
    ],
  });
  fake.addGroup({ id: 46, windowId: 16, title: "Solo", color: "red" });
  fake.addTab({ id: 77, windowId: 16, groupId: 46, index: 0, url: "https://example.com/a", title: "A" });
  fake.currentWindowId = 16;

  await fake.tabs.onRemoved.fire(77, { windowId: 16, isWindowClosing: false });
  await sleep(200);
  let closed = await loadClosed(fake);
  assert.equal(closed.length, 1);
  assert.equal(closed[0].tabUrl, "https://example.com/a");
  assert.equal(fake.notifications.items.has("anchor-closed:https://example.com/a"), true);

  const resp = await fake.runtime.deliverMessage({
    type: "anchor:reopen-closed",
    tabUrl: "https://example.com/a",
  });
  assert.equal(resp.status, "reopened");
  await sleep(1200);
  let anchors = await loadAnchors(fake);
  assert.equal(anchors.length, 1);
  assert.equal(anchors[0].tabUrl, "https://example.com/a");
  assert.equal(anchors[0].createdAt, 9); // original order preserved
  assert.equal(anchors[0].groupId, 46);
  assert.deepEqual(await loadClosed(fake), []);

  // Closing the reopened tab again must re-list it (0.5.2 regression).
  await fake.tabs.onRemoved.fire(anchors[0].tabId, { windowId: 16, isWindowClosing: false });
  await sleep(200);
  closed = await loadClosed(fake);
  assert.equal(closed.length, 1);
  assert.equal(closed[0].tabUrl, "https://example.com/a");
});

// 0.5.1 regression: menus survive a restart (onInstalled firing twice)
// because the worker clears before recreating.
test("restart: onInstalled twice does not duplicate menu ids", async () => {
  const fake = await setup();
  await fake.runtime.onInstalled.fire();
  await fake.runtime.onInstalled.fire();
  assert.equal(fake.menuItems.has("anchor-to-its-group"), true);
  assert.equal(fake.menuItems.has("anchor-remove"), true);
});

// Permission-off behavior: without the tabs permission Chrome withholds
// tab URLs, so an anchored tab stores an empty URL and a later close
// cannot offer a reopen prompt.
test("without tabs permission: anchored tab URL is withheld, close is silent", async () => {
  const fake = await setup({ tabsPermission: false });
  fake.addGroup({ id: 47, windowId: 17, title: "Work", color: "blue" });
  fake.addTab({ id: 78, windowId: 17, groupId: 47, index: 0, url: "https://example.com/", title: "Example" });
  fake.currentWindowId = 17;

  const exposed = await fake.tabs.get(78);
  assert.equal(exposed.url, undefined);
  await fake.contextMenus.onClicked.fire(
    { menuItemId: "anchor-to-its-group" },
    exposed
  );
  await sleep(200);
  const anchors = await loadAnchors(fake);
  assert.equal(anchors.length, 1);
  assert.equal(anchors[0].tabUrl, "");

  await fake.tabs.onRemoved.fire(78, { windowId: 17, isWindowClosing: false });
  await sleep(200);
  assert.deepEqual(await loadClosed(fake), []);
  assert.equal(fake.notifications.items.size, 0);
});
