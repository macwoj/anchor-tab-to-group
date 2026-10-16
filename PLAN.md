# Anchor — Chrome Extension Plan
Date: 2026-10-15

## Critical constraint (verified)
Chrome cannot do literal pinned + grouped at the same time.
- Pinned tabs live outside groups. Pinning a grouped tab removes it from the group.
- Grouping a pinned tab automatically unpins it.
Source: [chrome.tabGroups](https://developer.chrome.com/docs/extensions/reference/api/tabGroups) / [chrome.tabs](https://developer.chrome.com/docs/extensions/reference/api/tabs) APIs, corroborated by multiple extensions.

So anchoring must be emulated. Confirmed v1 meaning (user, 2026-10-15):
Anchor a tab to a specific group: the extension remembers the pairing,
keeps the tab in that group (re-groups it if dragged out / ungrouped),
and keeps it at the front of the group. It is NOT Chrome's native `pinned` flag.

Not in v1: protect/save a group for restore if closed (bookmark/storage based).

## Where the source lives
Local: `~/workspace/anchor/` (git working copy, branch `main`)
Remote: [github.com/macwoj/anchor-tab-to-group](https://github.com/macwoj/anchor-tab-to-group) — public, created by user 2026-10-15
- Load in Chrome via chrome://extensions > Developer mode > Load unpacked > this folder (or `dist/` if we add a build).
- No build setup yet. This machine is authenticated to GitHub as `macwoj` via `gh` (HTTPS), so commits can be pushed to `main`.

## Recommended stack for v1
Vanilla JS, Manifest V3, no dependencies, no build step.
Fastest to load/test. Migrate to TypeScript + Vite/WXT only if it grows.
No content scripts, no host_permissions — no access to page content needed.

## Structure
```
anchor/
  manifest.json            # MV3: name "Anchor", action, service worker, permissions
  background/
    service-worker.js      # context menu, commands, tab/group event listeners
  popup/
    popup.html popup.js popup.css   # pick current tab -> pick group -> Anchor
  lib/
    anchors.js             # storage model + pure helpers (unit-tested)
    chrome-tabs.js         # thin wrappers over chrome.tabs / chrome.tabGroups
    enforce.js             # re-group + move-to-front logic
  icons/                   # 16/32/48/128
  tests/                   # anchors.test.mjs (npm test)
  docs/manual-test.md      # manual test checklist
  package.json             # no dependencies; just the test script + ESM type
  README.md PLAN.md
```

## How tabs / groups work
- Tab: `id, windowId, index, groupId, pinned, active, url/title`. IDs are session-only.
- Group: `id, windowId, title, color, collapsed`. `groupId = -1` means ungrouped.
  Groups are per-window only, never span windows, and their tabs stay contiguous.
- Grouping: `chrome.tabs.group({ tabIds, groupId })` adds to an existing group,
  or without groupId creates a new one. `chrome.tabs.ungroup(tabIds)` removes.
- Group styling: `chrome.tabGroups.query/get/update/move` — title/color/collapsed.
- Moving: `chrome.tabs.move(tabId, { index })` — to put anchored tab at group's first index.
- Events to watch: `tabs.onMoved, tabs.onUpdated, tabs.onRemoved, tabs.onAttached/Detached`,
  `tabGroups.onRemoved/onUpdated`. Ignore events we cause ourselves (debounce / guard flag).

## Permissions (v1, minimal)
`tabs`, `tabGroups`, `storage`, `contextMenus`
Optional later: `commands` keyboard shortcut is declared in manifest, no extra permission.

## State / persistence
MV3 service worker is ephemeral — no state in memory.
Store anchors in `chrome.storage.local`:
`{ anchor: { tabUrl, tabTitle, groupTitle, groupColor, windowHint, createdAt } }`
Problem: tabId and groupId both die on browser restart.
On restart / restore: re-match by URL + group title, then re-apply. Best-effort, not guaranteed.

## v1 user flow
1. Click extension icon (or right-click tab/page > context menu, or shortcut).
2. Popup lists groups in current window.
3. Pick a group -> current tab is anchored: moved into group, moved to front.
4. If user drags it out / ungroups it, worker puts it back.
5. "Remove anchor" from popup removes the anchor.

## Build order
1. [x] Scaffold + manifest + icons (v0.1.0, 2026-10-15) — load unpacked still to be verified in your Chrome.
2. [x] Popup: list groups in current window.
3. [x] Anchor action: group + move-to-front + save to storage.
4. [x] Guard loop: listeners that re-group anchored tabs.
5. [x] Remove anchor + restart re-matching.
6. [ ] Manual test pass: see docs/manual-test.md — drag out, close group, move windows, restart Chrome.

## v0.2 (2026-10-15)
- Marker: `lib/marker.js` — per-tab ⚓ badge + "Anchored to <group>" tooltip via chrome.action (no API exists to draw on the tab strip itself).
- Position lock: service worker now re-checks every anchor in the affected window/group on ANY tab/group event (onMoved/onCreated/onAttached/onDetached/onActivated/onUpdated, tabGroups onUpdated/onMoved), not only the anchored tab's own events; group/move calls retry on Chrome's "Tabs cannot be edited right now" drag error.

## v0.3 (2026-10-15)
- On-tab marker (title prefix only; favicon overlay was offered and declined): `content/tab-marker.js` prepends "⚓ " to `document.title` on anchored tabs and re-applies it via MutationObserver when sites change their title; removing the anchor restores the clean title.
- Access model: `scripting` permission + `optional_host_permissions: ["*://*/*"]`, requested from the popup on the first anchoring click; the content script is registered dynamically (`chrome.scripting.registerContentScripts`, persistAcrossSessions) and self-disables on non-anchored tabs (asks the worker `anchor:is-anchored`). No marker on chrome:// / Web Store / PDF pages.

## v0.4 (2026-10-15) — strict lock
- User's Chrome test showed v0.2's lock still let another tab be dragged in front. Root causes in the shipped code: the 1500 ms in-flight skip could eat the drop's onMoved, and enforcement was single-pass.
- Replaced with a reconciler: pure `planGroupLayout` (lib/anchors.js) computes the correct layout — anchored tabs as a front block ordered by createdAt (first anchored, front-most), others behind in current order; `reconcileGroup/reconcileWindow` (lib/enforce.js) restore membership then apply the plan; the service worker schedules reconciles on any window event with a dirty-flag re-run (no time skip) + deferred re-checks at 300 ms / 1 s; drag-error retry extended to ~2.25 s.
- Chrome has no API to veto a drag — the guarantee is an immediate, deterministic snap-back on drop, not a frozen tab strip.

## v0.4.4 (2026-10-16) — badge not re-applied after restore
- Bug: the toolbar badge was only set in one startup pass; on restart/window-restore that pass can run before the restored tabs exist (and their ids are new), so the per-tab badge calls failed silently and nothing retried. The tab-finished-loading hook only re-asserted the title prefix, never the badge.
- Fix: new `syncTabMarkers(tabId)` re-asserts badge + title marker whenever a tab finishes loading or is activated, and kicks the orphan sweep when the tab isn't anchored under its current id; the sweep also runs on tabs.onCreated; `findTabForAnchor` now matches `pendingUrl` so still-loading restored tabs can re-match.

## v0.4.3 (2026-10-16) — mid-session window reopen
- Bug: closing a window while Chrome kept running preserved its anchors (v0.4.2), but reopening the window/group assigns new window/tab/group ids, and every reconcile is keyed to stored windowIds — orphaned anchors were never re-matched until a full browser restart.
- Fix: `findOrphanedAnchors` + `rematchOrphanedAnchors()` sweep (re-match by URL + group title via enforceAnchor), triggered on `windows.onCreated` and `tabGroups.onCreated`, coalesced with a dirty-flag re-run; re-matched anchors get their markers re-asserted and their (new) window reconciled.

## v0.4.1 (2026-10-15) — remove behavior
- On Remove anchor (popup or context menu), after the anchor is deleted and markers cleared, the window is reconciled: the tab becomes a plain member, so the planner moves the remaining anchored tabs in front of it — it ends up immediately behind the anchored block, still in the group. The worker also re-sends the title-strip message for popup-initiated removals.

## Documentation (developer.chrome.com, all verified 2026-10-15)
Core for Anchor:
- [chrome.tabs](https://developer.chrome.com/docs/extensions/reference/api/tabs) — query/get/move/group/ungroup/update, tab events
- [chrome.tabGroups](https://developer.chrome.com/docs/extensions/reference/api/tabGroups) — query/get/update/move groups, group events

Platform:
- [Manifest V3](https://developer.chrome.com/docs/extensions/develop/migrate/what-is-mv3) — current extension platform
- [Manifest file format](https://developer.chrome.com/docs/extensions/reference/manifest) — every `manifest.json` key: `action`, `background`, `commands`, `permissions`
- [Extension service workers](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers) — ephemeral background, event handler model

APIs we use:
- [chrome.action](https://developer.chrome.com/docs/extensions/reference/api/action) — toolbar icon + popup (`default_popup`)
- [chrome.storage](https://developer.chrome.com/docs/extensions/reference/api/storage) — `storage.local` for anchors
- [chrome.contextMenus](https://developer.chrome.com/docs/extensions/reference/api/contextMenus) — right-click menu, incl. `tab` context
- [chrome.commands](https://developer.chrome.com/docs/extensions/reference/api/commands) — keyboard shortcuts
