// Thin promise wrappers over chrome.tabs / chrome.tabGroups.
// MV3 APIs already return promises; these exist so the rest of the code
// has one small, mockable surface.

export const TAB_GROUP_ID_NONE = -1;

export function queryTabs(queryInfo) {
  return chrome.tabs.query(queryInfo);
}

export async function getTab(tabId) {
  try {
    return await chrome.tabs.get(tabId);
  } catch {
    return undefined;
  }
}

export async function getGroup(groupId) {
  try {
    return await chrome.tabGroups.get(groupId);
  } catch {
    return undefined;
  }
}

export function queryGroups(queryInfo) {
  return chrome.tabGroups.query(queryInfo);
}

export function groupTabs(tabIds, groupId) {
  const options = { tabIds };
  if (groupId !== undefined) options.groupId = groupId;
  return chrome.tabs.group(options);
}

export function moveTab(tabId, index) {
  return chrome.tabs.move(tabId, { index });
}

export function updateTab(tabId, updateProperties) {
  return chrome.tabs.update(tabId, updateProperties);
}
