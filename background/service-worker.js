import { TAB_GROUP_ID_NONE, getGroup } from "../lib/chrome-tabs.js";
import {
  loadAnchors,
  addAnchor,
  createAnchor,
  deleteAnchorByTabId,
  findAnchorByTabId,
} from "../lib/anchors.js";
import { enforceAnchor, enforceAllAnchors } from "../lib/enforce.js";

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
  await enforceAllAnchors();
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (!tab?.id) return;
  if (info.menuItemId === MENU_REMOVE_ANCHOR) {
    await deleteAnchorByTabId(tab.id);
  } else if (info.menuItemId === MENU_ANCHOR_TO_GROUP) {
    if (tab.groupId === TAB_GROUP_ID_NONE) return; // not in a group yet
    const group = await getGroup(tab.groupId);
    if (!group) return;
    const anchor = createAnchor(tab, group);
    await addAnchor(anchor);
    await enforceOne(anchor);
  }
});

// ---- Guard loop: keep anchored tabs in their group, at the front ----

chrome.tabs.onMoved.addListener((tabId) => void enforceTab(tabId));
chrome.tabs.onAttached.addListener((tabId) => void enforceTab(tabId));

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  // groupId changes when a tab is dragged out / ungrouped / regrouped.
  if ("groupId" in changeInfo || "pinned" in changeInfo) void enforceTab(tabId);
});

chrome.tabs.onRemoved.addListener((tabId) => {
  void deleteAnchorByTabId(tabId);
});

chrome.tabGroups.onRemoved.addListener(async (group) => {
  // If the group is gone and its anchored tab went with it, onRemoved for
  // the tab already cleaned up. Nothing else to do in v1.
  void group;
});

// Re-match anchors (by URL + group title) after a browser restart.
chrome.runtime.onStartup.addListener(() => void enforceAllAnchors());
