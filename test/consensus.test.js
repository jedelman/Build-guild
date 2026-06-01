import { test } from "node:test";
import assert from "node:assert/strict";
import { consensusPeak } from "../src/logic.js";

test("no endorsements → baseline", () => {
  assert.equal(consensusPeak([]), 55);
  assert.equal(consensusPeak([], { baseline: 40 }), 40);
});

test("endorsements lift the peak above baseline, bounded by 100", () => {
  const one = consensusPeak([{ tier: "none" }]);
  assert.ok(one > 55 && one < 100, `expected (55,100), got ${one}`);
  const many = consensusPeak(Array(50).fill({ tier: "client" }));
  assert.ok(many > 95 && many <= 100, `expected near 100, got ${many}`);
});

test("higher tiers raise the peak more than weaker ones", () => {
  const stranger = consensusPeak([{ tier: "none" }]);
  const guildmate = consensusPeak([{ tier: "guildmate" }]);
  const leader = consensusPeak([{ tier: "guild_leader" }]);
  const client = consensusPeak([{ tier: "client" }]);
  assert.ok(stranger < guildmate && guildmate < leader && leader < client,
    `expected none<guildmate<leader<client, got ${[stranger, guildmate, leader, client]}`);
});

test("more endorsements monotonically increase, with diminishing returns", () => {
  const p1 = consensusPeak([{ tier: "guildmate" }]);
  const p2 = consensusPeak([{ tier: "guildmate" }, { tier: "guildmate" }]);
  const p3 = consensusPeak(Array(3).fill({ tier: "guildmate" }));
  assert.ok(p1 < p2 && p2 < p3, "monotonic increasing");
  assert.ok(p2 - p1 > p3 - p2, "diminishing returns");
});

test("unknown/missing tier is treated as the weakest (none)", () => {
  assert.equal(consensusPeak([{ tier: "bogus" }]), consensusPeak([{ tier: "none" }]));
  assert.equal(consensusPeak([{}]), consensusPeak([{ tier: "none" }]));
});
