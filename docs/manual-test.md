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
