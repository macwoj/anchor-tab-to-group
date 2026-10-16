// Visible marker for anchored tabs: a per-tab badge on the Anchor toolbar
// icon ("⚓", shown when that tab is active) plus a per-tab tooltip title.
// Chrome has no API to draw on the tab strip itself; this is the clean
// native marker. Clearing/setting for a closed tab throws — ignored here.

export const BADGE_TEXT = "⚓";
export const BADGE_COLOR = "#2563eb";

export async function setMarker(tabId, groupTitle) {
  try {
    await chrome.action.setBadgeText({ tabId, text: BADGE_TEXT });
    await chrome.action.setBadgeBackgroundColor({ tabId, color: BADGE_COLOR });
    await chrome.action.setTitle({
      tabId,
      title: groupTitle ? `Anchored to “${groupTitle}”` : "Anchored",
    });
  } catch {
    // Tab already closed; nothing to mark.
  }
}

export async function clearMarker(tabId) {
  try {
    await chrome.action.setBadgeText({ tabId, text: "" });
    await chrome.action.setTitle({ tabId, title: "Anchor" });
  } catch {
    // Tab already closed; badge is gone with it.
  }
}

export async function syncMarkers(anchors) {
  for (const anchor of anchors) {
    await setMarker(anchor.tabId, anchor.groupTitle);
  }
}
