// Reopen prompt: recreate a closed anchored tab from its stored anchor.
//
// The tab itself is gone, so this restores the URL in the original window
// (or the current window if that window is gone), puts it back in its
// group (recreating the group by title if needed), and re-anchors it
// with its ORIGINAL createdAt so it returns to its old slot in the
// anchored order. Page state (forms, scroll, history) cannot be restored.
import {
  queryTabs,
  queryGroups,
  groupTabs,
  updateGroup,
  getWindow,
  createTab,
} from "./chrome-tabs.js";
import { createAnchor, addAnchor, findGroupForAnchor } from "./anchors.js";
import { enforceAnchor, reconcileWindow } from "./enforce.js";

export function isReopenableUrl(url) {
  // Extensions cannot open chrome:// pages programmatically.
  return Boolean(url) && !url.startsWith("chrome://");
}

export function closedNotificationId(tabUrl) {
  return `anchor-closed:${tabUrl}`;
}

// Build the anchor for a reopened tab. The URL comes from the closed
// anchor, NOT from the tabs.create() snapshot: that snapshot can carry
// url "" (navigation not committed yet) and no pendingUrl, which stored
// an empty tabUrl — and an empty tabUrl fails isReopenableUrl, so closing
// the reopened tab silently dropped it instead of re-listing it.
export function buildReopenedAnchor(closedAnchor, newTab, group) {
  return createAnchor(
    { ...newTab, url: closedAnchor.tabUrl, pendingUrl: closedAnchor.tabUrl },
    group,
    closedAnchor.createdAt
  );
}

export async function notifyClosedAnchor(anchor) {
  await chrome.notifications.create(closedNotificationId(anchor.tabUrl), {
    type: "basic",
    iconUrl: "icons/icon48.png",
    title: "Anchored tab closed",
    message: `“${anchor.tabTitle || anchor.tabUrl}” was closed. Reopen it in “${anchor.groupTitle || "its group"}”?`,
    buttons: [{ title: "Reopen" }, { title: "Dismiss" }],
    requireInteraction: true,
  });
}

export async function reopenClosedAnchor(closedAnchor) {
  if (!isReopenableUrl(closedAnchor.tabUrl)) return "not-reopenable";

  let windowId = closedAnchor.windowId;
  if (!(await getWindow(windowId))) {
    const [active] = await queryTabs({ active: true, currentWindow: true });
    windowId = active?.windowId;
    if (windowId === undefined) return "no-window";
  }

  const newTab = await createTab({
    url: closedAnchor.tabUrl,
    windowId,
    active: true,
  });

  const groups = await queryGroups({ windowId });
  let group = findGroupForAnchor({ ...closedAnchor, windowId }, groups);
  if (!group) {
    const groupId = await groupTabs(newTab.id);
    group = await updateGroup(groupId, {
      title: closedAnchor.groupTitle,
      color: closedAnchor.groupColor,
    });
  } else if (newTab.groupId !== group.id) {
    await groupTabs(newTab.id, group.id);
  }

  const anchor = buildReopenedAnchor(closedAnchor, newTab, group);
  await addAnchor(anchor);
  await enforceAnchor(anchor);
  await reconcileWindow(windowId);
  return "reopened";
}
