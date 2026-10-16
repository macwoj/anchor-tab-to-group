import { queryTabs, queryGroups, groupTabs } from "../lib/chrome-tabs.js";
import {
  loadAnchors,
  addAnchor,
  createAnchor,
  deleteAnchorByTabId,
  findAnchorByTabId,
} from "../lib/anchors.js";
import { enforceAnchor } from "../lib/enforce.js";

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

async function anchorTabToGroup(tab, group) {
  const anchor = createAnchor(tab, group);
  await addAnchor(anchor);
  await enforceAnchor(anchor);
  status(`Anchored to “${group.title || group.color}”.`);
  await render();
}

async function render() {
  const tab = await currentTab();
  if (!tab) { status("No active tab."); return; }
  $("tab-info").textContent = tab.title || tab.url || `Tab ${tab.id}`;

  const anchors = await loadAnchors();
  const existing = findAnchorByTabId(anchors, tab.id);
  $("current-anchor").hidden = !existing;
  if (existing) {
    $("anchor-group-name").textContent =
      existing.groupTitle || existing.groupColor;
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
    btn.addEventListener("click", () => void anchorTabToGroup(tab, group));
    list.append(btn);
  }
}

$("remove-anchor").addEventListener("click", async () => {
  const tab = await currentTab();
  if (tab) await deleteAnchorByTabId(tab.id);
  status("Anchor removed. The tab stays in its group.");
  await render();
});

$("new-group-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const tab = await currentTab();
  if (!tab) return;
  const name = $("new-group-name").value.trim();
  // group() with no groupId creates a new group containing this tab.
  const groupId = await groupTabs(tab.id);
  await chrome.tabGroups.update(groupId, { title: name });
  const group = await chrome.tabGroups.get(groupId);
  await anchorTabToGroup({ ...tab, groupId }, group);
});

void render();
