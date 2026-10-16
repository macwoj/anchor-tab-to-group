# Anchor — manual test checklist

Setup: chrome://extensions → Developer mode → Load unpacked → this folder.
The extension should load with no errors and show the Anchor icon.

- [ ] Popup opens, shows the current tab title
- [ ] Popup lists the groups in the current window with color dots
- [ ] Anchor the current tab to a group → tab moves into the group, to its front
- [ ] Drag the anchored tab out of the group → it is put back, at the front
- [ ] Ungroup the anchored tab (right-click tab → Remove from group) → it is put back
- [ ] Move the anchored tab within the group → it returns to the front
- [ ] Create & anchor with a new group name → new group is created, tab anchored in it
- [ ] Right-click the tab in the tab strip → “Anchor tab to its group” works for a grouped tab
- [ ] Remove anchor in the popup → tab can then be dragged out and stays out
- [ ] Anchor a natively pinned tab → it unpins and joins the group (expected: Chrome cannot pin + group)
- [ ] Close the anchored tab → anchor is forgotten (reopen popup on another tab to confirm no stale state errors in the service worker console)
- [ ] Restart Chrome → anchored tab is re-matched by URL + group title and put back at the front (best-effort)
- [ ] Ctrl+Shift+A / Cmd+Shift+A opens the popup

v0.2 — marker + position lock:
- [ ] Anchor a tab → the Anchor toolbar icon shows a ⚓ badge while that tab is active, and hovering it says “Anchored to <group>”
- [ ] Remove the anchor → badge disappears
- [ ] Drag a *different* tab in front of the anchored tab → anchored tab returns to the front (position lock)
- [ ] Open a new tab directly into the group at its front → anchored tab returns to the front
- [ ] Drag a tab from another window into the group at its front → anchored tab returns to the front
- [ ] Restart Chrome → badge is restored on the anchored tab

v0.3 — on-tab title marker:
- [ ] First time anchoring → Chrome asks for optional site access; granting it makes the tab title show “⚓ <title>” in the tab strip
- [ ] Declining site access → anchoring still works, badge only, popup says so
- [ ] Site changes its own title (e.g. YouTube / Gmail) → exactly one “⚓ ” prefix, never stacked
- [ ] Reload / navigate the anchored tab → prefix comes back
- [ ] Remove the anchor → title returns to the original, no ⚓
- [ ] Anchor a chrome:// tab → no marker there and no errors (blocked by Chrome, expected)

v0.4 — strict lock:
- [ ] Drag another tab in front of the anchored tab and drop → anchored tab snaps back to the front immediately
- [ ] Same, but with a slow drag (hold >2s before dropping) → still snaps back
- [ ] Anchor two tabs in one group → they sit at the front in the order anchored (first anchored = front-most)
- [ ] Drag a tab between the two anchored tabs → it ends up behind both
- [ ] Drag the second-anchored tab in front of the first-anchored → anchor order is restored
- [ ] Drag the anchored tab itself out / to the back → it returns to its anchored slot

v0.4.4 — toolbar badge after restore:
- [ ] Restart Chrome → restored anchored tabs show the ⚓ badge on the toolbar icon when active (not just the title prefix), without opening the popup
- [ ] Close a group window and reopen it (other windows open) → re-matched tabs show the ⚓ badge too

v0.4.3 — window close / reopen (browser stays running):
- [ ] Two windows open; close the window containing an anchored group → reopen it (Ctrl+Shift+T or History → Recently closed) → anchors re-attach: tabs return to the front of their group in anchor order, badges/⚓ title markers back
- [ ] Same, reopening just the closed group in a new window

v0.4.1 — remove behavior:
- [ ] Two anchored tabs → remove the front one's anchor → the other anchored tab moves in front, the removed tab sits right behind it, its badge and “⚓ ” title prefix are gone
- [ ] Same via the tab right-click menu → “Remove anchor”
- [ ] Remove the only anchor in a group → tab stays in the group as a plain member, markers gone
