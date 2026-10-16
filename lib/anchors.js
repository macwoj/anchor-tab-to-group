// Anchor model + storage.
//
// An anchor is a remembered tab <-> group pairing:
// { tabId, windowId, groupId, groupTitle, groupColor, tabUrl, tabTitle, createdAt }
// tabId/groupId are session-only, so tabUrl + groupTitle are kept for
// best-effort re-matching after a browser restart.

export const ANCHORS_KEY = "anchors";

// ---- Pure helpers (unit-tested, no chrome.* calls) ----

export function createAnchor(tab, group, now = Date.now()) {
  return {
    tabId: tab.id,
    windowId: tab.windowId,
    groupId: group.id,
    groupTitle: group.title ?? "",
    groupColor: group.color ?? "grey",
    tabUrl: tab.url ?? tab.pendingUrl ?? "",
    tabTitle: tab.title ?? "",
    createdAt: now,
  };
}

export function upsertAnchor(anchors, anchor) {
  const rest = anchors.filter(
    (a) => a.tabId !== anchor.tabId && a.tabUrl !== anchor.tabUrl
  );
  return [...rest, anchor];
}

export function removeAnchorByTabId(anchors, tabId) {
  return anchors.filter((a) => a.tabId !== tabId);
}

// chrome.tabs.onRemoved also fires for every tab when a window (or the
// whole browser) closes, with removeInfo.isWindowClosing = true. Those
// anchors must be KEPT so tabs can be re-matched after a restart — only
// an individually closed tab forgets its anchor.
export function shouldForgetAnchor(removeInfo) {
  return !removeInfo?.isWindowClosing;
}

// Anchors whose window or tab no longer exists under their stored ids —
// e.g. a window was closed while Chrome kept running, then reopened:
// Chrome restores it with NEW window/tab/group ids, so the anchor's ids
// are stale and it must be re-matched by URL + group title.
export function findOrphanedAnchors(anchors, liveWindowIds, liveTabIds) {
  const windows = new Set(liveWindowIds);
  const tabs = new Set(liveTabIds);
  return anchors.filter((a) => !windows.has(a.windowId) || !tabs.has(a.tabId));
}

export function findAnchorByTabId(anchors, tabId) {
  return anchors.find((a) => a.tabId === tabId);
}

// Position lock: when ANY tab in a window/group moves, the anchors in
// that window/group must be re-checked — not just the tab that moved.
export function findAnchorsByWindow(anchors, windowId) {
  return anchors.filter((a) => a.windowId === windowId);
}

export function findAnchorsByGroup(anchors, groupId) {
  return anchors.filter((a) => a.groupId === groupId);
}

// Prefer the live group id; fall back to a same-window title match
// (group ids change across restarts, titles usually survive a restore).
export function findGroupForAnchor(anchor, groups) {
  return (
    groups.find((g) => g.id === anchor.groupId && g.windowId === anchor.windowId) ??
    groups.find((g) => g.title === anchor.groupTitle && g.windowId === anchor.windowId) ??
    groups.find((g) => g.title === anchor.groupTitle)
  );
}

// Prefer the live tab id (with a URL sanity check); fall back to URL match.
// Restored tabs that are still loading expose their URL as pendingUrl
// with url === "", so match against both.
export function findTabForAnchor(anchor, tabs) {
  const byId = tabs.find((t) => t.id === anchor.tabId);
  if (byId && (!anchor.tabUrl || !byId.url || byId.url === anchor.tabUrl)) return byId;
  return tabs.find(
    (t) =>
      anchor.tabUrl !== "" &&
      (t.url === anchor.tabUrl || t.pendingUrl === anchor.tabUrl)
  );
}

export function groupFirstIndex(tabs, groupId) {
  const indexes = tabs.filter((t) => t.groupId === groupId).map((t) => t.index);
  return indexes.length ? Math.min(...indexes) : undefined;
}

// Strict lock planner (pure): the one correct layout for a group is
//   [anchored tabs, ordered by createdAt — first anchored, front-most]
//   followed by the other members in their current relative order.
// Returns the moves needed as [{ tabId, toIndex }] (absolute window
// indexes), or [] when the layout is already correct. Simulated
// sequentially: each move only ever moves an anchored tab.
export function planGroupLayout(tabs, groupId, anchors) {
  const members = tabs
    .filter((t) => t.groupId === groupId)
    .sort((a, b) => a.index - b.index);
  if (members.length === 0) return [];

  const anchorByTabId = new Map(
    anchors.filter((a) => a.groupId === groupId).map((a) => [a.tabId, a])
  );
  const anchored = members
    .filter((t) => anchorByTabId.has(t.id))
    .sort(
      (a, b) =>
        (anchorByTabId.get(a.id).createdAt ?? 0) -
          (anchorByTabId.get(b.id).createdAt ?? 0) || a.index - b.index
    );
  if (anchored.length === 0) return [];

  const anchoredIds = new Set(anchored.map((t) => t.id));
  const desired = [
    ...anchored.map((t) => t.id),
    ...members.filter((t) => !anchoredIds.has(t.id)).map((t) => t.id),
  ];

  const firstIndex = members[0].index;
  const current = members.map((t) => t.id);
  const moves = [];
  for (let i = 0; i < desired.length; i++) {
    if (current[i] === desired[i]) continue;
    const j = current.indexOf(desired[i], i + 1);
    if (j === -1) continue;
    moves.push({ tabId: desired[i], toIndex: firstIndex + i });
    current.splice(j, 1);
    current.splice(i, 0, desired[i]);
  }
  return moves;
}

// ---- Storage (chrome.storage.local) ----

export async function loadAnchors() {
  const data = await chrome.storage.local.get(ANCHORS_KEY);
  return Array.isArray(data[ANCHORS_KEY]) ? data[ANCHORS_KEY] : [];
}

export async function saveAnchors(anchors) {
  await chrome.storage.local.set({ [ANCHORS_KEY]: anchors });
}

export async function addAnchor(anchor) {
  const anchors = upsertAnchor(await loadAnchors(), anchor);
  await saveAnchors(anchors);
  return anchors;
}

export async function deleteAnchorByTabId(tabId) {
  const anchors = removeAnchorByTabId(await loadAnchors(), tabId);
  await saveAnchors(anchors);
  return anchors;
}
