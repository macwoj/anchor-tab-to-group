# Anchor

Chrome extension (Manifest V3) that anchors a tab to a tab group: it remembers the tab ↔ group pairing, keeps the anchored tab at the front of the group, and puts it back if it is dragged out or ungrouped.

Chrome cannot have a tab both natively pinned and grouped at the same time — that is why this is called Anchor, not pin.

See [PLAN.md](PLAN.md) for the project plan, how tabs/groups work, and links to the official Chrome extension documentation.

Repo: https://github.com/macwoj/anchor-tab-to-group
Status: v0.4.0 — v0.1–v0.3 manually tested by the user in Chrome (marker gap and drag-in-front failure found and addressed); v0.4 changes not yet re-tested.
v0.4 adds: the strict lock — a group-layout reconciler keeps anchored tabs as a front block ordered by when they were anchored (first anchored, front-most); other tabs always end up behind them. (Chrome can't veto a drag itself, so the snap-back on drop is made deterministic: no event-skip window, queued re-runs, deferred re-checks.)
v0.3 adds: an on-tab marker — anchored tabs show “⚓ ” at the start of their title in the tab strip. This needs optional site access (requested the first time you anchor; decline and anchoring still works, badge only). Blocked on chrome:// and similar pages.
v0.2 adds: a ⚓ badge marker on the toolbar icon for anchored tabs (with an “Anchored to …” tooltip), and a position lock — other tabs can no longer push the anchored tab back from the front of its group.

## Load it (development)

1. Open `chrome://extensions`
2. Turn on **Developer mode**
3. Click **Load unpacked** and select this folder

## Use it

Click the Anchor icon → pick a group in the current window (or create a new one) → the current tab is anchored. Drag it out and the service worker puts it back at the front. “Remove anchor” in the popup, or right-click the tab in the tab strip. Shortcut: `Ctrl+Shift+A` (`Cmd+Shift+A` on Mac) opens the popup.

## Develop

No build step, no dependencies. Unit tests for the anchor logic:

```bash
npm test
```

Manual test checklist: [docs/manual-test.md](docs/manual-test.md)
