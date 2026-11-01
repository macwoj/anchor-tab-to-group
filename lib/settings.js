// Extension settings, stored in chrome.storage.local under SETTINGS_KEY.
// Defaults apply when nothing is stored yet, so older installs get the
// default behavior without a migration step.

export const SETTINGS_KEY = "settings";

export const DEFAULT_SETTINGS = {
  // Offer to reopen an anchored tab after it is closed (notification +
  // popup "Recently closed" entry). Default on.
  reopenPrompt: true,
};

export function mergeSettings(stored) {
  return { ...DEFAULT_SETTINGS, ...(stored ?? {}) };
}

export function isReopenPromptEnabled(settings) {
  return mergeSettings(settings).reopenPrompt !== false;
}

export async function loadSettings() {
  const data = await chrome.storage.local.get(SETTINGS_KEY);
  return mergeSettings(data[SETTINGS_KEY]);
}

export async function saveSettings(partial) {
  const current = await loadSettings();
  const next = { ...current, ...partial };
  await chrome.storage.local.set({ [SETTINGS_KEY]: next });
  return next;
}
