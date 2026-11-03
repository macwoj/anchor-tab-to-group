// In-memory fake of the chrome.* APIs Anchor uses, for worker tests.
//
// Usage in a test file:
//   import { createFakeChrome, loadWorker, sleep } from "./fake-chrome.mjs";
//   const fake = createFakeChrome();
//   await loadWorker(fake); // sets globalThis.chrome, imports the worker
//   fake.tabs.onCreated.fire(tab); // drive the worker through real events
//
// The fake keeps full tab data internally but exposes tabs the way real
// Chrome does: when `tabsPermission` is false, url/pendingUrl/title are
// withheld from query/get/create results, exactly like Chrome without
// the "tabs" permission. That lets tests cover the permission-off
// variant without a real browser.
//
// The worker module is imported once per test file (node --test runs
// each file in its own process). Within a file, loadWorker(fake, tag)
// re-imports it with a cache-busting query so each test gets a fresh
// worker bound to its own fake. Give each test unique window/group/tab
// ids so deferred timers from an earlier test can't touch a later one.

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function event() {
  const listeners = [];
  return {
    addListener(fn) {
      listeners.push(fn);
    },
    async fire(...args) {
      for (const fn of listeners) await fn(...args);
    },
    get count() {
      return listeners.length;
    },
  };
}

export function createFakeChrome({ tabsPermission = true } = {}) {
  let nextTabId = 1000;
  let nextGroupId = 500;
  let nextNotificationId = 1;
  const tabs = [];
  const groups = [];
  const store = {};
  const badges = new Map();
  const notifications = new Map();
  const menuItems = new Map();
  const registeredScripts = [];

  const fake = {
    tabsPermission,
    currentWindowId: 1,
    tabsState: tabs,
    groupsState: groups,
    store,
    badges,
    notifications,
    menuItems,

    // Seed helpers (bypass events): build restored/closed states directly.
    addTab(tab) {
      const full = {
        id: tab.id ?? nextTabId++,
        windowId: tab.windowId ?? 1,
        groupId: tab.groupId ?? -1,
        index: tab.index ?? 0,
        url: tab.url ?? "",
        pendingUrl: tab.pendingUrl,
        title: tab.title ?? "",
        pinned: tab.pinned ?? false,
        active: tab.active ?? false,
      };
      tabs.push(full);
      return full;
    },
    addGroup(group) {
      const full = {
        id: group.id ?? nextGroupId++,
        windowId: group.windowId ?? 1,
        title: group.title ?? "",
        color: group.color ?? "grey",
      };
      groups.push(full);
      return full;
    },
    removeTabInternal(tabId) {
      const i = tabs.findIndex((t) => t.id === tabId);
      if (i !== -1) tabs.splice(i, 1);
    },
    setBadge(tabId) {
      return badges.get(tabId) ?? {};
    },
  };

  function expose(tab) {
    if (!tab) return tab;
    const copy = { ...tab };
    if (!tabsPermission) {
      delete copy.url;
      delete copy.pendingUrl;
      delete copy.title;
      delete copy.favIconUrl;
    }
    return copy;
  }

  function windowTabs(windowId) {
    return tabs
      .filter((t) => t.windowId === windowId)
      .sort((a, b) => a.index - b.index);
  }

  fake.tabs = {
    onCreated: event(),
    onRemoved: event(),
    onMoved: event(),
    onUpdated: event(),
    onActivated: event(),
    onAttached: event(),
    onDetached: event(),
    async query(queryInfo = {}) {
      const out = tabs.filter((t) => {
        for (const [key, value] of Object.entries(queryInfo)) {
          if (key === "currentWindow") {
            if (value && t.windowId !== fake.currentWindowId) return false;
          } else if (t[key] !== value) return false;
        }
        return true;
      });
      out.sort((a, b) => a.windowId - b.windowId || a.index - b.index);
      return out.map(expose);
    },
    async get(tabId) {
      const tab = tabs.find((t) => t.id === tabId);
      if (!tab) throw new Error(`No tab with id: ${tabId}`);
      return expose(tab);
    },
    async create({ url, windowId, active } = {}) {
      const win = windowTabs(windowId ?? fake.currentWindowId);
      const tab = {
        id: nextTabId++,
        windowId: windowId ?? fake.currentWindowId,
        groupId: -1,
        index: win.length,
        url: url ?? "",
        title: "",
        pinned: false,
        active: Boolean(active),
      };
      if (active) {
        for (const t of win) t.active = false;
      }
      tabs.push(tab);
      return expose(tab);
    },
    async group({ tabIds, groupId }) {
      const ids = Array.isArray(tabIds) ? tabIds : [tabIds];
      let group;
      if (groupId === undefined) {
        const first = tabs.find((t) => t.id === ids[0]);
        if (!first) throw new Error("No tab for new group");
        group = {
          id: nextGroupId++,
          windowId: first.windowId,
          title: "",
          color: "grey",
        };
        groups.push(group);
      } else {
        group = groups.find((g) => g.id === groupId);
        if (!group) throw new Error(`No group with id: ${groupId}`);
      }
      for (const id of ids) {
        const tab = tabs.find((t) => t.id === id);
        if (tab) tab.groupId = group.id;
      }
      return group.id;
    },
    async move(tabId, { index }) {
      const tab = tabs.find((t) => t.id === tabId);
      if (!tab) throw new Error(`No tab with id: ${tabId}`);
      const win = windowTabs(tab.windowId).filter((t) => t.id !== tabId);
      const at = Math.max(0, Math.min(index, win.length));
      win.splice(at, 0, tab);
      win.forEach((t, i) => {
        t.index = i;
      });
      return expose(tab);
    },
    async update(tabId, props) {
      const tab = tabs.find((t) => t.id === tabId);
      if (!tab) throw new Error(`No tab with id: ${tabId}`);
      Object.assign(tab, props);
      return expose(tab);
    },
    async sendMessage() {
      return {};
    },
  };

  fake.tabGroups = {
    onCreated: event(),
    onUpdated: event(),
    onMoved: event(),
    onRemoved: event(),
    async query(queryInfo = {}) {
      return groups
        .filter((g) => {
          for (const [key, value] of Object.entries(queryInfo)) {
            if (g[key] !== value) return false;
          }
          return true;
        })
        .map((g) => ({ ...g }));
    },
    async get(groupId) {
      const group = groups.find((g) => g.id === groupId);
      if (!group) throw new Error(`No group with id: ${groupId}`);
      return { ...group };
    },
    async update(groupId, props) {
      const group = groups.find((g) => g.id === groupId);
      if (!group) throw new Error(`No group with id: ${groupId}`);
      Object.assign(group, props);
      return { ...group };
    },
  };

  fake.windows = {
    onCreated: event(),
    async get(windowId) {
      if (!tabs.some((t) => t.windowId === windowId) && windowId !== fake.currentWindowId) {
        throw new Error(`No window with id: ${windowId}`);
      }
      return { id: windowId };
    },
  };

  fake.storage = {
    local: {
      async get(keys) {
        if (keys === undefined) return { ...store };
        if (typeof keys === "string") return { [keys]: store[keys] };
        if (Array.isArray(keys)) {
          return Object.fromEntries(keys.map((k) => [k, store[k]]));
        }
        return { ...keys, ...store };
      },
      async set(items) {
        Object.assign(store, items);
      },
    },
  };

  fake.action = {
    async setBadgeText({ tabId, text }) {
      badges.set(tabId, { ...(badges.get(tabId) ?? {}), text });
    },
    async setBadgeBackgroundColor({ tabId, color }) {
      badges.set(tabId, { ...(badges.get(tabId) ?? {}), color });
    },
    async setTitle({ tabId, title }) {
      badges.set(tabId, { ...(badges.get(tabId) ?? {}), title });
    },
  };

  fake.notifications = {
    onButtonClicked: event(),
    // The recorded notifications, for assertions.
    items: notifications,
    async create(id, options) {
      const nid = id ?? `fake-${nextNotificationId++}`;
      notifications.set(nid, options);
      return nid;
    },
    async clear(id) {
      return notifications.delete(id);
    },
  };

  fake.contextMenus = {
    onClicked: event(),
    create({ id }) {
      if (menuItems.has(id)) throw new Error(`Duplicate menu id: ${id}`);
      menuItems.set(id, true);
    },
    async removeAll() {
      menuItems.clear();
    },
  };

  fake.permissions = {
    granted: false,
    async contains() {
      return fake.permissions.granted;
    },
    async request() {
      return fake.permissions.granted;
    },
  };

  fake.scripting = {
    async getRegisteredContentScripts() {
      return registeredScripts;
    },
    async registerContentScripts(scripts) {
      registeredScripts.push(...scripts);
    },
    async executeScript() {
      return [];
    },
  };

  fake.runtime = {
    onInstalled: event(),
    onStartup: event(),
    onMessage: event(),
    // Deliver a message to the worker's onMessage listeners and await
    // the async sendResponse value (the worker returns true for these).
    async deliverMessage(msg, sender = {}) {
      return new Promise((resolve) => {
        const timer = setTimeout(() => resolve(undefined), 2000);
        let settled = false;
        const sendResponse = (value) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve(value);
        };
        const listeners = fake.runtime.onMessageListeners;
        (async () => {
          let willRespond = false;
          for (const fn of listeners) {
            const ret = fn(msg, sender, sendResponse);
            if (ret === true) willRespond = true;
            if (ret && typeof ret.then === "function") await ret;
            if (settled) return;
          }
          // A listener returning true means "I will call sendResponse
          // asynchronously" — wait for it (or the timeout) instead of
          // resolving undefined right away.
          if (!willRespond && !settled) {
            settled = true;
            clearTimeout(timer);
            resolve(undefined);
          }
        })();
      });
    },
  };
  // The worker registers via addListener; keep the list reachable.
  fake.runtime.onMessageListeners = [];
  fake.runtime.onMessage.addListener = (fn) => {
    fake.runtime.onMessageListeners.push(fn);
  };

  return fake;
}

export async function loadWorker(fake, tag = "default") {
  globalThis.chrome = fake;
  await import(`../background/service-worker.js?worker-test=${tag}`);
  return fake;
}
