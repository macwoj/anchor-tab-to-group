// Bridge between extension pages / service worker and the on-tab title
// marker (content/tab-marker.js).
//
// Site access is OPTIONAL on purpose: it lives in
// optional_host_permissions and is requested from the popup (a user
// gesture) the first time a tab is anchored. Without it, anchoring still
// works — only the on-tab marker is missing (the badge still shows).

export const MARKER_ORIGINS = ["*://*/*"];
export const MARKER_SCRIPT_ID = "anchor-tab-marker";

export async function hasSiteAccess() {
  try {
    return await chrome.permissions.contains({ origins: MARKER_ORIGINS });
  } catch {
    return false;
  }
}

// Must be called from a user gesture (popup click) to succeed.
export async function requestSiteAccess() {
  try {
    return await chrome.permissions.request({ origins: MARKER_ORIGINS });
  } catch {
    return false;
  }
}

export async function ensureMarkerScriptRegistered() {
  if (!(await hasSiteAccess())) return false;
  const existing = await chrome.scripting.getRegisteredContentScripts({
    ids: [MARKER_SCRIPT_ID],
  });
  if (existing.length === 0) {
    await chrome.scripting.registerContentScripts([
      {
        id: MARKER_SCRIPT_ID,
        js: ["content/tab-marker.js"],
        matches: MARKER_ORIGINS,
        runAt: "document_idle",
        persistAcrossSessions: true,
      },
    ]);
  }
  return true;
}

// For tabs that are already open when access is first granted: registered
// scripts only run on the next navigation, so inject into this tab now.
export async function injectMarker(tabId) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["content/tab-marker.js"],
    });
  } catch {
    // chrome://, Web Store, PDFs etc. block injection — no marker there.
  }
}

export async function notifyMarker(tabId, anchored) {
  try {
    await chrome.tabs.sendMessage(tabId, {
      type: "anchor:set-marker",
      anchored,
    });
  } catch {
    // No content script in this tab (blocked page or not injected yet).
  }
}

// Full enable flow for a freshly anchored tab, minus the permission
// request itself (that needs the popup's user gesture — see popup.js).
export async function enableMarkerForTab(tabId) {
  if (!(await ensureMarkerScriptRegistered())) return false;
  await injectMarker(tabId);
  await notifyMarker(tabId, true);
  return true;
}
