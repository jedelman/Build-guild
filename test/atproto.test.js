import { test } from "node:test";
import assert from "node:assert/strict";
import { suggestSkillsFromProfile } from "../src/atproto.js";

test("suggestSkillsFromProfile maps bio keywords to skills", () => {
  const skills = suggestSkillsFromProfile("Rust enjoyer, dabble in machine learning and design.");
  const names = skills.map((s) => s.name);
  assert.ok(names.includes("Rust"));
  assert.ok(names.includes("Machine Learning"));
  assert.ok(names.includes("Product Design"));
  assert.ok(skills.every((s) => s.peak >= 1 && s.peak <= 100));
});

test("suggestSkillsFromProfile dedupes and caps at 5", () => {
  const skills = suggestSkillsFromProfile(
    "rust rust python python ml data design devops security writing community growth"
  );
  const names = skills.map((s) => s.name);
  assert.ok(skills.length <= 5);
  assert.equal(new Set(names).size, names.length); // no duplicates
});

test("suggestSkillsFromProfile returns [] for an empty or unmatched bio", () => {
  assert.deepEqual(suggestSkillsFromProfile(""), []);
  assert.deepEqual(suggestSkillsFromProfile("just vibes here"), []);
});
