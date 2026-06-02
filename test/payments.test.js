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
  buildSettlement,
  APPLICATION_FEE_BPS,
} from "../src/payments.js";

test("application fee (5%) on integer cents", () => {
  assert.equal(APPLICATION_FEE_BPS, 500);
  assert.equal(applicationFee(100000), 5000); // $1000 → $50
  assert.equal(applicationFee(50000, 250), 1250); // 2.5% override
});

test("splits divide evenly and the remainder is deterministic + sums to net", () => {
  assert.deepEqual(splitAmounts(100, ["a", "b"]), [{ did: "a", cents: 50 }, { did: "b", cents: 50 }]);
  const three = splitAmounts(100, ["a", "b", "c"]); // 34/33/33
  assert.deepEqual(three.map((s) => s.cents), [34, 33, 33]);
  assert.equal(three.reduce((n, s) => n + s.cents, 0), 100);
  assert.deepEqual(splitAmounts(100, []), []);
});

test("settlementMath: fee + net + party split", () => {
  const m = settlementMath(100000, ["a", "b"]); // $1000, 5% fee
  assert.equal(m.feeCents, 5000);
  assert.equal(m.netCents, 95000);
  assert.deepEqual(m.splits, [{ did: "a", cents: 47500 }, { did: "b", cents: 47500 }]);
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
