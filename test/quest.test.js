import { test } from "node:test";
import assert from "node:assert/strict";
import { rankPartiesForQuest } from "../src/logic.js";

const party = (id, ...skills) => ({ id, members: [{ skills }] });
const req = (...names) => names.map((name) => ({ name }));

test("ranks parties by required-skill coverage", () => {
  const parties = [
    party("a", { name: "Rust", peak: 90 }, { name: "DevOps", peak: 80 }),
    party("b", { name: "Rust", peak: 85 }),
    party("c", { name: "Design", peak: 95 }),
  ];
  const ranked = rankPartiesForQuest(req("Rust", "DevOps"), parties);
  assert.equal(ranked[0].party.id, "a");
  assert.equal(ranked[0].coverage, 1);
  assert.deepEqual(ranked[ranked.length - 1].party.id, "c"); // covers nothing
});

test("partial credit for present-but-weak skills, and reports gaps", () => {
  const parties = [party("weak", { name: "Rust", peak: 40 })]; // below STRONG(70)
  const [r] = rankPartiesForQuest(req("Rust", "DevOps"), parties);
  assert.equal(r.coverage, 0.25); // 0.5 of 2 required
  assert.deepEqual(r.covered, ["rust"]);
  assert.deepEqual(r.missing, ["devops"]);
});

test("empty required skills → no ranking", () => {
  assert.deepEqual(rankPartiesForQuest([], [party("a", { name: "Rust", peak: 90 })]), []);
});

test("an individual builder is just a party of one", () => {
  const solo = { id: "solo", members: [{ skills: [{ name: "Rust", peak: 88 }] }] };
  const [r] = rankPartiesForQuest(req("Rust"), [solo]);
  assert.equal(r.coverage, 1);
});
