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
  groupFirstIndex,
} from "./anchors.js";

// Chrome refuses tab edits while the user is dragging a tab. That is
// exactly the "another tab pushes the anchored tab back" moment, so
// group/move calls retry briefly instead of giving up.
export function isDragError(err) {
  return String(err?.message ?? err).includes("Tabs cannot be edited right now");
}

export async function retryOnDrag(
  fn,
  attempts = 6,
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
// Returns a status string; mutates the stored anchor's ids if they were
// re-matched by title/URL after a restart.
export async function enforceAnchor(anchor) {
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
  const tabsInWindow = await queryTabs({ windowId: liveTab.windowId });
  const first = groupFirstIndex(tabsInWindow, group.id);
  const current = tabsInWindow.find((t) => t.id === liveTab.id);
  if (first !== undefined && current && current.index !== first) {
    await retryOnDrag(() => moveTab(liveTab.id, first));
  }
  return "enforced";
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
