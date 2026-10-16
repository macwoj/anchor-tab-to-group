import { TAB_GROUP_ID_NONE, getGroup } from "../lib/chrome-tabs.js";
import {
  loadAnchors,
  addAnchor,
  createAnchor,
  deleteAnchorByTabId,
  findAnchorByTabId,
  shouldForgetAnchor,
} from "../lib/anchors.js";
import {
  enforceAnchor,
  enforceAllAnchors,
  reconcileWindow,
  rematchOrphanedAnchors,
} from "../lib/enforce.js";
import { setMarker, clearMarker, syncMarkers } from "../lib/marker.js";
import {
  ensureMarkerScriptRegistered,
  enableMarkerForTab,
  notifyMarker,
} from "../lib/tab-marker.js";

// ---- Strict-lock scheduler ----
// Every tab/group event schedules a reconcile of its window. There is NO
// time-based skip (v0.2's 1500 ms in-flight window could eat the decisive
// drop event): if an event arrives while a reconcile is running, the
// window is marked dirty and reconciled once more right after, so the
// last event always gets a pass. Reconciling is cheap — the layout
// planner returns no moves when the group is already correct, which is
// also what stops our own moves from looping forever.
const running = new Set(); // windowId
const dirty = new Set(); // windowId
const deferredTimers = new Map(); // windowId -> [timer, timer]

async function runReconcile(windowId) {
  if (running.has(windowId)) {
    dirty.add(windowId);
    return;
  }
  running.add(windowId);
  try {
    do {
      dirty.delete(windowId);
      await reconcileWindow(windowId);
    } while (dirty.has(windowId));
  } catch (err) {
    console.debug("Anchor: reconcile failed", err);
  } finally {
    running.delete(windowId);
  }
}

function scheduleReconcile(windowId, { deferred = true } = {}) {
  if (windowId === undefined || windowId < 0) return;
  void runReconcile(windowId);
  if (!deferred) return;
  // Post-drop re-checks: Chrome can refuse moves around a drag; a fresh
  // pass shortly after catches anything the immediate pass missed.
  const old = deferredTimers.get(windowId) ?? [];
  old.forEach(clearTimeout);
  deferredTimers.set(
    windowId,
    [300, 1000].map((ms) =>
      setTimeout(() => void runReconcile(windowId), ms)
    )
  );
}

// Re-match sweep for anchors orphaned by a window that was closed and
// reopened mid-session (new window/tab/group ids). Coalesced like the
// reconcile scheduler: events during a run queue exactly one more pass.
let rematchRunning = false;
let rematchDirty = false;

async function runRematch() {
  if (rematchRunning) {
    rematchDirty = true;
    return;
  }
  rematchRunning = true;
  try {
    do {
      rematchDirty = false;
      const rematched = await rematchOrphanedAnchors();
      for (const anchor of rematched) {
        await setMarker(anchor.tabId, anchor.groupTitle);
        await enableMarkerForTab(anchor.tabId).catch(() => {});
        scheduleReconcile(anchor.windowId);
      }
    } while (rematchDirty);
  } catch (err) {
    console.debug("Anchor: re-match sweep failed", err);
  } finally {
    rematchRunning = false;
  }
}

async function restoreSession() {
  // Registers the on-tab marker script if site access was granted before.
  await ensureMarkerScriptRegistered().catch(() => {});
  await enforceAllAnchors();
  const anchors = await loadAnchors();
  await syncMarkers(anchors);
  // Strict layout per window, and re-assert the title marker on
  // already-loaded tabs (no-ops without site access / on blocked pages).
  for (const windowId of new Set(anchors.map((a) => a.windowId))) {
    await reconcileWindow(windowId).catch(() => {});
  }
  for (const anchor of anchors) {
    await enableMarkerForTab(anchor.tabId).catch(() => {});
  }
}

// Messages: content scripts ask whether their tab is anchored; the popup
// asks for a strict-layout reconcile after it anchors a tab itself.
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === "anchor:reconcile") {
    // After a removal, re-strip the title prefix from the worker too, in
    // case the popup's own message did not reach the page.
    if (msg.removedTabId !== undefined) {
      void notifyMarker(msg.removedTabId, false);
    }
    scheduleReconcile(msg.windowId);
    return undefined;
  }
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

// Re-assert BOTH markers (toolbar badge + title prefix) for one tab.
// A single startup sync is not enough: on browser restart / window
// restore, that pass can run before the restored tabs exist, and the
// per-tab badge calls then fail silently against stale tab ids. So this
// runs whenever a tab finishes loading or becomes active — points where
// the tab definitely exists. If the tab isn't anchored under its current
// id, it may be a restored tab whose anchor is still orphaned: sweep.
async function syncTabMarkers(tabId) {
  const anchors = await loadAnchors();
  const anchor = findAnchorByTabId(anchors, tabId);
  if (anchor) {
    await setMarker(tabId, anchor.groupTitle);
    await notifyMarker(tabId, true);
  } else {
    void runRematch();
  }
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
    scheduleReconcile(tab.windowId); // remaining anchors move in front
  } else if (info.menuItemId === MENU_ANCHOR_TO_GROUP) {
    if (tab.groupId === TAB_GROUP_ID_NONE) return; // not in a group yet
    const group = await getGroup(tab.groupId);
    if (!group) return;
    const anchor = createAnchor(tab, group);
    await addAnchor(anchor);
    await enforceAnchor(anchor);
    await setMarker(tab.id, group.title);
    // On-tab marker only if site access was already granted — a context
    // menu click in the worker cannot request permissions (needs the popup).
    await enableMarkerForTab(tab.id);
    scheduleReconcile(tab.windowId);
  }
});

// ---- Guard loop: the strict lock ----
// ANY tab/group event in a window reconciles that window's groups: an
// intruder tab's own event is what pushes an anchored tab back, so
// reacting only to the anchored tab's events is not enough.

chrome.tabs.onMoved.addListener((_tabId, moveInfo) =>
  scheduleReconcile(moveInfo.windowId)
);

chrome.tabs.onCreated.addListener((tab) => {
  scheduleReconcile(tab.windowId);
  // Restored sessions create their tabs one by one; each creation is a
  // chance to re-match orphans whose tabs have now materialized.
  void runRematch();
});

chrome.tabs.onAttached.addListener((_tabId, attachInfo) =>
  scheduleReconcile(attachInfo.newWindowId)
);

chrome.tabs.onDetached.addListener((_tabId, detachInfo) =>
  scheduleReconcile(detachInfo.oldWindowId)
);

chrome.tabs.onActivated.addListener(({ tabId, windowId }) => {
  scheduleReconcile(windowId);
  void syncTabMarkers(tabId);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  // groupId changes when a tab is dragged out / ungrouped / regrouped.
  if ("groupId" in changeInfo || "pinned" in changeInfo) {
    if (tab) scheduleReconcile(tab.windowId);
  }
  // A finished navigation is a new document on a tab that definitely
  // exists now: re-assert both markers (badge + title prefix).
  if (changeInfo.status === "complete") void syncTabMarkers(tabId);
});

// A (re)opened window or group is where orphaned anchors come back:
// restored windows/groups carry new ids, so sweep for stale anchors.
chrome.windows.onCreated.addListener(() => void runRematch());
chrome.tabGroups.onCreated.addListener(() => void runRematch());

chrome.tabs.onRemoved.addListener((tabId, removeInfo) => {
  // A window/browser closing is not the tab being closed on purpose:
  // keep the anchor so the tab can be re-matched after a restart.
  if (!shouldForgetAnchor(removeInfo)) return;
  void deleteAnchorByTabId(tabId);
  void clearMarker(tabId);
});

chrome.tabGroups.onUpdated.addListener((group) =>
  scheduleReconcile(group.windowId)
);
chrome.tabGroups.onMoved.addListener((group) =>
  scheduleReconcile(group.windowId)
);

chrome.tabGroups.onRemoved.addListener(async (group) => {
  // If the group is gone and its anchored tab went with it, onRemoved for
  // the tab already cleaned up. Nothing else to do for now.
  void group;
});

// Re-match anchors (by URL + group title) after a browser restart.
chrome.runtime.onStartup.addListener(() => void restoreSession());
