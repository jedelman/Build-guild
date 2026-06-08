// Quest sizing + split helpers (src/payments.js). Payments are off-platform P2P now,
// so this just covers the 5-day cap and the display-only even split.
import { test } from "node:test";
import assert from "node:assert/strict";
import { MAX_QUEST_DAYS, questDeadline, withinQuestCap, splitAmounts } from "../src/payments.js";

test("quests are capped at 5 days (forces incremental delivery)", () => {
  assert.equal(MAX_QUEST_DAYS, 5);
  const now = 1_000_000;
  assert.equal(questDeadline(now), now + 5 * 864e5);
  assert.equal(withinQuestCap(now, now + 4 * 864e5), true);
  assert.equal(withinQuestCap(now, now + 6 * 864e5), false);
  assert.equal(withinQuestCap(now, now + 5 * 864e5), true);
  assert.equal(withinQuestCap(now, now - 864e5), false);
});

test("splitAmounts divides evenly with a deterministic remainder summing to total", () => {
  assert.deepEqual(splitAmounts(100, ["a", "b"]), [{ did: "a", cents: 50 }, { did: "b", cents: 50 }]);
  const three = splitAmounts(100, ["a", "b", "c"]);
  assert.deepEqual(three.map((s) => s.cents), [34, 33, 33]);
  assert.equal(three.reduce((n, s) => n + s.cents, 0), 100);
  assert.deepEqual(splitAmounts(100, []), []);
});
