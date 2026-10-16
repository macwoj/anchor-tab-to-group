// Anchor on-tab marker (content script, classic script — no imports).
// Prepends "⚓ " to document.title while this tab is anchored, and keeps
// it there when the site changes its title. Does nothing on tabs that are
// not anchored: it asks the service worker once on load, and listens for
// anchor:set-marker messages.
//
// The prefix helpers below mirror lib/tab-title.js (unit-tested there).

(function () {
  if (window.__anchorTabMarkerLoaded) return;
  window.__anchorTabMarkerLoaded = true;

  const PREFIX = "\u2693 "; // "⚓ "
  const strip = (t) => String(t ?? "").replace(/^(\s*\u2693\s*)+/, "");

  let enabled = false;
  let observer = null;

  function apply() {
    if (!enabled) return;
    const current = document.title;
    if (!current) return;
    const wanted = PREFIX + strip(current);
    if (current !== wanted) document.title = wanted;
  }

  function restore() {
    const current = document.title;
    const clean = strip(current);
    if (current !== clean) document.title = clean;
  }

  function startObserver() {
    if (observer) return;
    observer = new MutationObserver(() => apply());
    const titleEl = document.querySelector("title");
    if (titleEl) {
      observer.observe(titleEl, { childList: true, characterData: true, subtree: true });
    }
    if (document.head) observer.observe(document.head, { childList: true, subtree: true });
  }

  function setEnabled(on) {
    enabled = on;
    if (on) {
      startObserver();
      apply();
    } else {
      if (observer) { observer.disconnect(); observer = null; }
      restore();
    }
  }

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type === "anchor:set-marker") setEnabled(Boolean(msg.anchored));
  });

  // Initial check: am I an anchored tab?
  try {
    chrome.runtime.sendMessage({ type: "anchor:is-anchored" }, (resp) => {
      if (chrome.runtime.lastError) return;
      if (resp?.anchored) setEnabled(true);
    });
  } catch {
    // Extension context gone (e.g. extension reloaded); stay inert.
  }
})();
