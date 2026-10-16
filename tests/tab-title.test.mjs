// Unit tests for the on-tab title prefix helpers. Run: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  TITLE_PREFIX,
  addAnchorPrefix,
  stripAnchorPrefix,
  hasAnchorPrefix,
} from "../lib/tab-title.js";

test("addAnchorPrefix prepends ⚓ once", () => {
  assert.equal(addAnchorPrefix("Example"), "⚓ Example");
  assert.equal(TITLE_PREFIX, "⚓ ");
});

test("addAnchorPrefix is idempotent and never stacks", () => {
  assert.equal(addAnchorPrefix("⚓ Example"), "⚓ Example");
  assert.equal(addAnchorPrefix("⚓ ⚓ Example"), "⚓ Example");
  assert.equal(addAnchorPrefix(addAnchorPrefix("Example")), "⚓ Example");
});

test("stripAnchorPrefix removes one or many prefixes", () => {
  assert.equal(stripAnchorPrefix("⚓ Example"), "Example");
  assert.equal(stripAnchorPrefix("⚓ ⚓ Example"), "Example");
  assert.equal(stripAnchorPrefix("Example"), "Example");
});

test("strip restores a site-changed title (prefix + new title)", () => {
  // Site updates its title while anchored; content script re-prefixes.
  assert.equal(addAnchorPrefix("⚓ (2) Inbox"), "⚓ (2) Inbox");
  assert.equal(stripAnchorPrefix("⚓ (2) Inbox"), "(2) Inbox");
});

test("hasAnchorPrefix and empty titles", () => {
  assert.equal(hasAnchorPrefix("⚓ Example"), true);
  assert.equal(hasAnchorPrefix("Example"), false);
  assert.equal(addAnchorPrefix(""), "");
  assert.equal(stripAnchorPrefix(""), "");
});
