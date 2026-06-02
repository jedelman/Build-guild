// Payment math + escrow state machine (src/payments.js) for the authorize→capture
// →transfer model. Pure + fully testable; the Stripe provider is wired on top.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applicationFee,
  splitAmounts,
  settlementMath,
  authorize,
  capture,
  markTransferred,
  cancel,
  authExpired,
  payoutPlan,
  buildSettlement,
  APPLICATION_FEE_BPS,
  MAX_QUEST_DAYS,
  questDeadline,
  withinQuestCap,
} from "../src/payments.js";

test("application fee (1%) on integer cents", () => {
  assert.equal(APPLICATION_FEE_BPS, 100);
  assert.equal(applicationFee(100000), 1000); // $1000 → $10
  assert.equal(applicationFee(50000, 250), 1250); // 2.5% override
});

test("quests are capped at 5 days (forces incremental delivery)", () => {
  assert.equal(MAX_QUEST_DAYS, 5);
  const now = 1_000_000;
  assert.equal(questDeadline(now), now + 5 * 864e5);
  assert.equal(withinQuestCap(now, now + 4 * 864e5), true);
  assert.equal(withinQuestCap(now, now + 6 * 864e5), false); // too long
  assert.equal(withinQuestCap(now, now - 864e5), false); // past
  assert.equal(withinQuestCap(now, now + 5 * 864e5), true); // exactly 5d ok
});

test("splits divide evenly and the remainder is deterministic + sums to net", () => {
  assert.deepEqual(splitAmounts(100, ["a", "b"]), [{ did: "a", cents: 50 }, { did: "b", cents: 50 }]);
  const three = splitAmounts(100, ["a", "b", "c"]); // 34/33/33
  assert.deepEqual(three.map((s) => s.cents), [34, 33, 33]);
  assert.equal(three.reduce((n, s) => n + s.cents, 0), 100);
  assert.deepEqual(splitAmounts(100, []), []);
});

test("settlementMath: fee + net + party split", () => {
  const m = settlementMath(100000, ["a", "b"]); // $1000, 1% fee
  assert.equal(m.feeCents, 1000);
  assert.equal(m.netCents, 99000);
  assert.deepEqual(m.splits, [{ did: "a", cents: 49500 }, { did: "b", cents: 49500 }]);
});

test("escrow state machine: authorize → capture → transferred", () => {
  const a = authorize({ questId: 1, patronDid: "did:ex:p", amountCents: 50000, now: 1000 });
  assert.equal(a.state, "authorized");
  assert.equal(a.authExpiresAt, 1000 + 7 * 864e5);
  const c = capture(a, { payeeDid: "did:ex:g", party: ["did:ex:a"], now: 2000 });
  assert.equal(c.state, "captured");
  const t = markTransferred(c, { now: 3000 });
  assert.equal(t.state, "transferred");
});

test("authorization expiry is enforced", () => {
  const a = authorize({ questId: 1, patronDid: "did:ex:p", amountCents: 50000, now: 0 });
  assert.equal(authExpired(a, 8 * 864e5), true);
  assert.throws(() => capture(a, { payeeDid: "did:ex:g", now: 8 * 864e5 }), /authorization expired/);
});

test("invalid transitions throw", () => {
  const a = authorize({ questId: 1, patronDid: "did:ex:p", amountCents: 1000 });
  const c = capture(a, { payeeDid: "did:ex:g" });
  assert.throws(() => cancel(c), /cannot cancel from 'captured'/);
  assert.throws(() => markTransferred(a), /cannot transfer from 'authorized'/);
  assert.throws(() => authorize({ questId: 1, patronDid: "did:ex:p", amountCents: -5 }), /positive integer/);
});

test("cancel an authorized (un-captured) hold", () => {
  const a = authorize({ questId: 1, patronDid: "did:ex:p", amountCents: 1000, now: 1 });
  assert.equal(cancel(a, { now: 2 }).state, "canceled");
});

test("payoutPlan: option (a) — party nets gross − Stripe fee − 1%", () => {
  // $1000 gross, Stripe fee $32.00 (read from balance txn), 1% app fee = $10.
  const plan = payoutPlan(100000, 3200, [
    { did: "did:a", account_id: "acct_a" },
    { did: "did:b", account_id: "acct_b" },
  ]);
  assert.equal(plan.appFeeCents, 1000);
  assert.equal(plan.stripeFeeCents, 3200);
  assert.equal(plan.distributableCents, 95800); // 100000 − 3200 − 1000
  assert.deepEqual(plan.transfers, [
    { did: "did:a", account: "acct_a", cents: 47900 },
    { did: "did:b", account: "acct_b", cents: 47900 },
  ]);
});

test("payoutPlan guards: no payees, and fee-exceeding bounty", () => {
  assert.throws(() => payoutPlan(100000, 3200, []), /no connected payee/);
  assert.throws(() => payoutPlan(100, 3200, [{ did: "a", account_id: "acct_a" }]), /too small to cover fees/);
});

test("buildSettlement matches the locked lexicon shape (no PII, opaque ref)", () => {
  const s = buildSettlement({
    patronDid: "did:ex:p", questUri: "at://did:ex:p/org.buildguild.quest/abc", questCid: "bafy123",
    payee: "guild:42", party: ["did:ex:a", "did:ex:b"], amountCents: 100000, currency: "usd", paymentRef: "tr_test_123",
  });
  assert.equal(s.type, "org.buildguild.settlement");
  assert.equal(s.author, "did:ex:p");
  assert.deepEqual(s.quest, { uri: "at://did:ex:p/org.buildguild.quest/abc", cid: "bafy123" });
  assert.equal(s.amount, 100000);
  assert.equal(s.paymentRef, "tr_test_123");
  assert.ok(!("card" in s) && !("email" in s)); // never any PII
});
