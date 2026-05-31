import { test } from "node:test";
import assert from "node:assert/strict";
import { skillSlug } from "../src/skills.js";

test("skillSlug case-folds, trims, and collapses whitespace", () => {
  assert.equal(skillSlug("Rust"), "rust");
  assert.equal(skillSlug("  Rust "), "rust");
  assert.equal(skillSlug("RUSTLANG"), "rustlang");
  assert.equal(skillSlug("Distributed   Systems"), "distributed systems");
  assert.equal(skillSlug("\tProduct  Design\n"), "product design");
});

test("skillSlug collapses spellings that should be one skill", () => {
  assert.equal(skillSlug("Rust "), skillSlug("rust"));
  assert.equal(skillSlug("distributed systems"), skillSlug("Distributed Systems"));
});

test("skillSlug tolerates empty / nullish input", () => {
  assert.equal(skillSlug(""), "");
  assert.equal(skillSlug(), "");
  assert.equal(skillSlug("   "), "");
});
