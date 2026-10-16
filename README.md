# Anchor

Chrome extension (Manifest V3) that anchors a tab to a tab group: it remembers the tab ↔ group pairing, keeps the anchored tab at the front of the group, and puts it back if it is dragged out or ungrouped.

Chrome cannot have a tab both natively pinned and grouped at the same time — that is why this is called Anchor, not pin.

See [PLAN.md](PLAN.md) for the project plan, how tabs/groups work, and links to the official Chrome extension documentation.

Repo: https://github.com/macwoj/anchor-tab-to-group
Status: v0.1.0 scaffold — working code, not yet manually tested in Chrome.

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
