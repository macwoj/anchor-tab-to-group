import {
  TAB_GROUP_ID_NONE,
  getTab,
  getGroup,
  queryTabs,
  queryGroups,
  groupTabs,
  moveTab,
  updateTab,
} from "./chrome-tabs.js";
import {
  loadAnchors,
  saveAnchors,
  findGroupForAnchor,
  findTabForAnchor,
  findAnchorsByWindow,
  findOrphanedAnchors,
  groupFirstIndex,
  planGroupLayout,
} from "./anchors.js";

// Chrome refuses tab edits while the user is dragging a tab. That is
// exactly the "another tab pushes the anchored tab back" moment, so
// group/move calls retry briefly instead of giving up.
export function isDragError(err) {
  return String(err?.message ?? err).includes("Tabs cannot be edited right now");
}

export async function retryOnDrag(
  fn,
  attempts = 10,
  delayMs = 50,
  sleep = (ms) => new Promise((r) => setTimeout(r, ms))
) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (!isDragError(err) || i === attempts - 1) throw err;
      await sleep(delayMs * (i + 1));
    }
  }
  throw lastErr;
}

// Put one anchored tab back where it belongs: in its group, at the front.
// With { toFront: false } it only restores group membership — the caller
// (reconcileGroup) then applies the strict multi-anchor layout itself.
// Returns a status string; mutates the stored anchor's ids if they were
// re-matched by title/URL after a restart.
export async function enforceAnchor(anchor, { toFront = true } = {}) {
  // getTab by stale id fails after a restart; then scan all tabs by URL.
  let liveTab = await getTab(anchor.tabId);
  if (!liveTab) {
    const tabs = await queryTabs({});
    liveTab = findTabForAnchor(anchor, tabs);
  }
  if (!liveTab) return "tab-gone";

  const groups = await queryGroups({});
  const group = findGroupForAnchor(
    { ...anchor, windowId: liveTab.windowId },
    groups
  ) ?? (anchor.groupId >= 0 ? await getGroup(anchor.groupId) : undefined);
  if (!group) return "group-gone";

  // Keep stored ids current so the next pass is cheap.
  if (anchor.tabId !== liveTab.id || anchor.groupId !== group.id) {
    anchor.tabId = liveTab.id;
    anchor.windowId = liveTab.windowId;
    anchor.groupId = group.id;
    const anchors = await loadAnchors();
    await saveAnchors(
      anchors.map((a) => (a.tabUrl === anchor.tabUrl ? anchor : a))
    );
  }

  // A natively pinned tab cannot be grouped; anchoring unpins it.
  if (liveTab.pinned) await updateTab(liveTab.id, { pinned: false });

  if (liveTab.groupId !== group.id) {
    await retryOnDrag(() => groupTabs(liveTab.id, group.id));
  }

  // Move to the front of the group if it is not already there.
  if (toFront) {
    const tabsInWindow = await queryTabs({ windowId: liveTab.windowId });
    const first = groupFirstIndex(tabsInWindow, group.id);
    const current = tabsInWindow.find((t) => t.id === liveTab.id);
    if (first !== undefined && current && current.index !== first) {
      await retryOnDrag(() => moveTab(liveTab.id, first));
    }
  }
  return "enforced";
}

// Strict lock: make one group match the planned layout exactly —
// anchored tabs as a front block in anchor order (first anchored,
// front-most), everyone else behind them in current relative order.
export async function reconcileGroup(windowId, groupId) {
  let anchors = await loadAnchors();
  const candidates = anchors.filter((a) => a.groupId === groupId);
  if (candidates.length === 0) return "no-anchors";

  // Membership first (re-group escapees, unpin), without front moves —
  // the planner below decides the final order in one pass.
  for (const anchor of candidates) {
    try {
      await enforceAnchor(anchor, { toFront: false });
    } catch (err) {
      console.debug("Anchor: reconcile membership failed", err);
    }
  }

  anchors = await loadAnchors(); // ids may have been re-matched above
  const tabs = await queryTabs({ windowId });
  const moves = planGroupLayout(tabs, groupId, anchors);
  for (const move of moves) {
    await retryOnDrag(() => moveTab(move.tabId, move.toIndex));
  }
  return moves.length ? "moved" : "ok";
}

export async function reconcileWindow(windowId) {
  if (windowId === undefined || windowId < 0) return;
  const anchors = await loadAnchors();
  const groupIds = [
    ...new Set(findAnchorsByWindow(anchors, windowId).map((a) => a.groupId)),
  ];
  for (const groupId of groupIds) {
    try {
      await reconcileGroup(windowId, groupId);
    } catch (err) {
      console.debug("Anchor: reconcile failed, next event retries", err);
    }
  }
}

// Mid-session re-match: a window closed while Chrome kept running keeps
// its anchors (v0.4.2), but reopening that window/group gives it NEW
// window/tab/group ids, and no reconcile keyed to the old windowId will
// ever find them. This sweep finds anchors with stale ids and re-matches
// them by URL + group title (enforceAnchor updates the stored ids).
// Returns the anchors that were successfully re-matched.
export async function rematchOrphanedAnchors() {
  const anchors = await loadAnchors();
  if (anchors.length === 0) return [];
  const tabs = await queryTabs({});
  const orphans = findOrphanedAnchors(
    anchors,
    tabs.map((t) => t.windowId),
    tabs.map((t) => t.id)
  );
  const rematched = [];
  for (const anchor of orphans) {
    try {
      if ((await enforceAnchor(anchor)) === "enforced") rematched.push(anchor);
    } catch (err) {
      console.debug("Anchor: orphan re-match failed", err);
    }
  }
  return rematched;
}

export async function enforceAllAnchors() {
  const anchors = await loadAnchors();
  for (const anchor of anchors) {
    try {
      await enforceAnchor(anchor);
    } catch (err) {
      // A drag in progress makes tabs temporarily uneditable; the next
      // tab event will retry. Don't let one anchor abort the rest.
      console.debug("Anchor: enforce failed, will retry on next event", err);
    }
  }
}

export { TAB_GROUP_ID_NONE };
