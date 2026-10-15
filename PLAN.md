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
- No build setup yet. Push pending: this machine is not authenticated to GitHub (`gh` not logged in, SSH blocked), so commits stay local until you log in.

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
    anchors.js             # storage model + re-group / move-to-front logic
    chrome-tabs.js         # thin wrappers over chrome.tabs / chrome.tabGroups
  icons/                   # 16/32/48/128
  tests/                   # manual test checklist first, unit mocks later
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
1. Scaffold + manifest + icons, load unpacked, verify it loads clean.
2. Popup: list groups in current window.
3. Anchor action: group + move-to-front + save to storage.
4. Guard loop: listeners that re-group anchored tabs.
5. Remove anchor + restart re-matching.
6. Manual test pass: drag out, close group, move windows, restart Chrome.

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
