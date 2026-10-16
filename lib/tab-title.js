// Pure helpers for the on-tab title marker: "⚓ " + title.
// Kept dependency-free and unit-tested. content/tab-marker.js carries a
// small copy of these (content scripts are classic scripts, no imports).

export const TITLE_PREFIX = "⚓ ";

export function stripAnchorPrefix(title) {
  // Remove any number of leading "⚓"/"⚓ " so re-applying never stacks.
  return String(title ?? "").replace(/^(\s*⚓\s*)+/, "");
}

export function hasAnchorPrefix(title) {
  return stripAnchorPrefix(title) !== String(title ?? "");
}

export function addAnchorPrefix(title) {
  const clean = stripAnchorPrefix(title);
  return clean ? TITLE_PREFIX + clean : clean;
}
