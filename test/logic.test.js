import { test } from "node:test";
import assert from "node:assert/strict";
import {
  guildSkillMap,
  championRoster,
  diversityScore,
  recommendRecruits,
} from "../src/logic.js";

const A = { id: 1, display_name: "A", skills: [{ name: "Rust", peak: 90 }, { name: "Design", peak: 40 }] };
const B = { id: 2, display_name: "B", skills: [{ name: "Design", peak: 85 }, { name: "Rust", peak: 50 }] };

test("guildSkillMap keeps the highest peak per skill and names its champion", () => {
  const map = guildSkillMap([A, B]);
  assert.equal(map.length, 2);
  const rust = map.find((s) => s.name === "Rust");
  const design = map.find((s) => s.name === "Design");
  assert.equal(rust.peak, 90);
  assert.equal(rust.champion, "A");
  assert.equal(design.peak, 85);
  assert.equal(design.champion, "B");
  // sorted by peak descending
  assert.deepEqual(map.map((s) => s.peak), [90, 85]);
});

test("guildSkillMap is case-insensitive when merging skills", () => {
  const map = guildSkillMap([
    { display_name: "X", skills: [{ name: "rust", peak: 60 }] },
    { display_name: "Y", skills: [{ name: "Rust", peak: 95 }] },
  ]);
  assert.equal(map.length, 1);
  assert.equal(map[0].peak, 95);
});

test("championRoster gives each member the skills they top", () => {
  const roster = championRoster([A, B]);
  assert.deepEqual(roster.find((r) => r.display_name === "A").champions, ["Rust"]);
  assert.deepEqual(roster.find((r) => r.display_name === "B").champions, ["Design"]);
});

test("diversityScore rewards complementary peaks over redundant ones", () => {
  const complementary = diversityScore([A, B]);
  const redundant = diversityScore([
    A,
    { id: 3, display_name: "C", skills: [{ name: "Rust", peak: 88 }] },
  ]);
  assert.ok(complementary > redundant, `${complementary} should beat ${redundant}`);
});

test("recommendRecruits ranks gap-fillers above redundant candidates", () => {
  const members = [A, B]; // strong in Rust + Design
  const fillsGap = {
    id: 4,
    display_name: "DevOpsDan",
    skills: [{ name: "DevOps", peak: 88 }, { name: "Security", peak: 75 }],
  };
  const redundant = { id: 5, display_name: "RustRedux", skills: [{ name: "Rust", peak: 70 }] };

  const recs = recommendRecruits(members, [redundant, fillsGap]);
  assert.equal(recs[0].builder.display_name, "DevOpsDan");
  assert.ok(recs[0].fills.includes("DevOps"));
  assert.ok(recs[0].fills.includes("Security"));
  // a candidate who only duplicates existing peaks brings no fit and is dropped
  assert.ok(!recs.some((r) => r.builder.display_name === "RustRedux"));
});
