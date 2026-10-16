import { queryTabs, queryGroups, groupTabs } from "../lib/chrome-tabs.js";
import {
  loadAnchors,
  addAnchor,
  createAnchor,
  deleteAnchorByTabId,
  findAnchorByTabId,
} from "../lib/anchors.js";
import { enforceAnchor } from "../lib/enforce.js";
import { setMarker, clearMarker } from "../lib/marker.js";
import {
  hasSiteAccess,
  requestSiteAccess,
  enableMarkerForTab,
  notifyMarker,
} from "../lib/tab-marker.js";

const GROUP_COLORS = {
  grey: "#5f6368", blue: "#1a73e8", red: "#d93025", yellow: "#f9ab00",
  green: "#188038", pink: "#d01884", purple: "#9334e6", cyan: "#007b83",
  orange: "#fa903e",
};

const $ = (id) => document.getElementById(id);
const status = (msg) => { $("status").textContent = msg; };

async function currentTab() {
  const [tab] = await queryTabs({ active: true, currentWindow: true });
  return tab;
}

// The on-tab "⚓ " title marker needs optional site access. Ask for it on
// the anchoring click (a user gesture, which chrome.permissions requires);
// declining is fine — anchoring still works, with the badge only.
async function ensureSiteAccess() {
  if (await hasSiteAccess()) return true;
  return requestSiteAccess();
}

async function anchorTabToGroup(tab, group, siteAccess) {
  const anchor = createAnchor(tab, group);
  await addAnchor(anchor);
  await enforceAnchor(anchor);
  await setMarker(tab.id, group.title);
  if (siteAccess) await enableMarkerForTab(tab.id);
  // Let the worker impose the strict multi-anchor order for the group.
  await chrome.runtime
    .sendMessage({ type: "anchor:reconcile", windowId: tab.windowId })
    .catch(() => {});
  status(
    `Anchored to “${group.title || group.color}”.` +
      (siteAccess ? "" : " On-tab marker skipped (site access declined) — badge only.")
  );
  await render();
}

async function render() {
  const tab = await currentTab();
  if (!tab) { status("No active tab."); return; }
  $("tab-info").textContent = tab.title || tab.url || `Tab ${tab.id}`;

  const anchors = await loadAnchors();
  const existing = findAnchorByTabId(anchors, tab.id);
  $("current-anchor").hidden = !existing;
  $("enable-marker").hidden = true;
  if (existing) {
    $("anchor-group-name").textContent =
      existing.groupTitle || existing.groupColor;
    void setMarker(tab.id, existing.groupTitle); // keep badge in sync
    // Anchors created before v0.3, via the context menu, or with the
    // permission prompt missed never got the on-tab marker. Heal that:
    // enable it if access exists, otherwise offer the button below.
    if (await hasSiteAccess()) {
      void enableMarkerForTab(tab.id);
    } else {
      $("enable-marker").hidden = false;
    }
  }

  const groups = await queryGroups({ windowId: tab.windowId });
  const list = $("group-list");
  list.replaceChildren();
  $("no-groups").hidden = groups.length > 0;
  for (const group of groups) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "group-row";
    const dot = document.createElement("span");
    dot.className = "dot";
    dot.style.background = GROUP_COLORS[group.color] ?? GROUP_COLORS.grey;
    const label = document.createElement("span");
    label.textContent = group.title || "(unnamed group)";
    btn.append(dot, label);
    btn.addEventListener("click", async () => {
      const siteAccess = await ensureSiteAccess();
      await anchorTabToGroup(tab, group, siteAccess);
    });
    list.append(btn);
  }
}

$("enable-marker").addEventListener("click", async () => {
  const granted = await requestSiteAccess();
  const tab = await currentTab();
  if (granted && tab) {
    await enableMarkerForTab(tab.id);
    status("On-tab marker on — this tab’s title now starts with ⚓.");
  } else {
    status("Site access declined — badge only.");
  }
  await render();
});

$("remove-anchor").addEventListener("click", async () => {
  const tab = await currentTab();
  if (tab) {
    await deleteAnchorByTabId(tab.id);
    await clearMarker(tab.id);
    await notifyMarker(tab.id, false); // strip the "⚓ " title prefix
    // The remaining anchored tabs move in front of this one: let the
    // worker reconcile the group's layout now that this tab is plain.
    await chrome.runtime
      .sendMessage({
        type: "anchor:reconcile",
        windowId: tab.windowId,
        removedTabId: tab.id,
      })
      .catch(() => {});
  }
  status("Anchor removed — remaining anchored tabs move in front of it.");
  await render();
});

$("new-group-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const siteAccess = await ensureSiteAccess();
  const tab = await currentTab();
  if (!tab) return;
  const name = $("new-group-name").value.trim();
  // group() with no groupId creates a new group containing this tab.
  const groupId = await groupTabs(tab.id);
  await chrome.tabGroups.update(groupId, { title: name });
  const group = await chrome.tabGroups.get(groupId);
  await anchorTabToGroup({ ...tab, groupId }, group, siteAccess);
});

void render();
