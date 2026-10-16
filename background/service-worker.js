import { TAB_GROUP_ID_NONE, getGroup } from "../lib/chrome-tabs.js";
import {
  loadAnchors,
  addAnchor,
  createAnchor,
  deleteAnchorByTabId,
  findAnchorByTabId,
  findAnchorsByWindow,
  findAnchorsByGroup,
} from "../lib/anchors.js";
import { enforceAnchor, enforceAllAnchors } from "../lib/enforce.js";
import { setMarker, clearMarker, syncMarkers } from "../lib/marker.js";
import {
  ensureMarkerScriptRegistered,
  enableMarkerForTab,
  notifyMarker,
} from "../lib/tab-marker.js";

// Guard against loops: enforcing an anchor fires tab events itself.
// Record tabs we are currently moving and skip re-entry for a moment.
const inFlight = new Map(); // tabId -> timestamp
const IN_FLIGHT_MS = 1500;

async function enforceOne(anchor) {
  const now = Date.now();
  if (now - (inFlight.get(anchor.tabId) ?? 0) < IN_FLIGHT_MS) return;
  inFlight.set(anchor.tabId, now);
  try {
    await enforceAnchor(anchor);
  } catch (err) {
    console.debug("Anchor: enforce failed, will retry on next event", err);
  } finally {
    setTimeout(() => inFlight.delete(anchor.tabId), IN_FLIGHT_MS);
  }
}

async function enforceTab(tabId) {
  const anchors = await loadAnchors();
  const anchor = findAnchorByTabId(anchors, tabId);
  if (anchor) await enforceOne(anchor);
}

// Position lock: another tab moving/being created in front of an anchored
// tab does not fire an event "for" the anchored tab. So any event in a
// window/group re-checks every anchor in that window/group.
async function enforceWindow(windowId) {
  if (windowId === undefined || windowId < 0) return;
  const anchors = await loadAnchors();
  for (const anchor of findAnchorsByWindow(anchors, windowId)) {
    await enforceOne(anchor);
  }
}

async function enforceGroup(groupId) {
  const anchors = await loadAnchors();
  for (const anchor of findAnchorsByGroup(anchors, groupId)) {
    await enforceOne(anchor);
  }
}

async function restoreSession() {
  // Registers the on-tab marker script if site access was granted before.
  await ensureMarkerScriptRegistered().catch(() => {});
  await enforceAllAnchors();
  const anchors = await loadAnchors();
  await syncMarkers(anchors);
  // Re-assert the title marker on already-loaded tabs (no-ops without
  // site access, and on pages where injection is blocked).
  for (const anchor of anchors) {
    await enableMarkerForTab(anchor.tabId).catch(() => {});
  }
}

// Content scripts ask whether their tab is anchored.
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type !== "anchor:is-anchored") return undefined;
  (async () => {
    const tabId = sender.tab?.id;
    const anchors = await loadAnchors();
    sendResponse({
      anchored: tabId !== undefined && Boolean(findAnchorByTabId(anchors, tabId)),
    });
  })();
  return true; // keep the channel open for the async response
});

async function notifyIfAnchored(tabId) {
  const anchors = await loadAnchors();
  if (findAnchorByTabId(anchors, tabId)) await notifyMarker(tabId, true);
}

// ---- Context menus ----

const MENU_ANCHOR_TO_GROUP = "anchor-to-its-group";
const MENU_REMOVE_ANCHOR = "anchor-remove";

chrome.runtime.onInstalled.addListener(async () => {
  chrome.contextMenus.create({
    id: MENU_ANCHOR_TO_GROUP,
    title: "Anchor tab to its group",
    contexts: ["tab"],
  });
  chrome.contextMenus.create({
    id: MENU_REMOVE_ANCHOR,
    title: "Remove anchor",
    contexts: ["tab"],
  });
  // Pick up anchors restored from a previous session.
  await restoreSession();
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (!tab?.id) return;
  if (info.menuItemId === MENU_REMOVE_ANCHOR) {
    await deleteAnchorByTabId(tab.id);
    await clearMarker(tab.id);
    await notifyMarker(tab.id, false); // strip the "⚓ " title prefix
  } else if (info.menuItemId === MENU_ANCHOR_TO_GROUP) {
    if (tab.groupId === TAB_GROUP_ID_NONE) return; // not in a group yet
    const group = await getGroup(tab.groupId);
    if (!group) return;
    const anchor = createAnchor(tab, group);
    await addAnchor(anchor);
    await enforceOne(anchor);
    await setMarker(tab.id, group.title);
    // On-tab marker only if site access was already granted — a context
    // menu click in the worker cannot request permissions (needs the popup).
    await enableMarkerForTab(tab.id);
  }
});

// ---- Guard loop: keep anchored tabs in their group, at the front ----
// The anchored tab's own events AND any other tab's events in its
// window/group, because other tabs can push it back from the front.

chrome.tabs.onMoved.addListener((tabId, moveInfo) => {
  void enforceTab(tabId);
  void enforceWindow(moveInfo.windowId);
});

chrome.tabs.onCreated.addListener((tab) => {
  // A new tab can be created directly into a group, at its front.
  void enforceWindow(tab.windowId);
});

chrome.tabs.onAttached.addListener((tabId, attachInfo) => {
  void enforceTab(tabId);
  void enforceWindow(attachInfo.newWindowId);
});

chrome.tabs.onDetached.addListener((tabId, detachInfo) => {
  void enforceWindow(detachInfo.oldWindowId);
});

chrome.tabs.onActivated.addListener(({ tabId, windowId }) => {
  // Cheap sweep: catches anything an earlier event missed.
  void enforceTab(tabId);
  void enforceWindow(windowId);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  // groupId changes when a tab is dragged out / ungrouped / regrouped.
  if ("groupId" in changeInfo || "pinned" in changeInfo) {
    void enforceTab(tabId);
    if (tab) void enforceWindow(tab.windowId);
  }
  // A finished navigation is a new document: re-assert the title marker.
  if (changeInfo.status === "complete") void notifyIfAnchored(tabId);
});

chrome.tabs.onRemoved.addListener((tabId) => {
  void deleteAnchorByTabId(tabId);
  void clearMarker(tabId);
});

chrome.tabGroups.onUpdated.addListener((group) => void enforceGroup(group.id));
chrome.tabGroups.onMoved.addListener((group) => void enforceGroup(group.id));

chrome.tabGroups.onRemoved.addListener(async (group) => {
  // If the group is gone and its anchored tab went with it, onRemoved for
  // the tab already cleaned up. Nothing else to do for now.
  void group;
});

// Re-match anchors (by URL + group title) after a browser restart.
chrome.runtime.onStartup.addListener(() => void restoreSession());
