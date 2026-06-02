// Mock escrow state machine (src/escrow.js). Proves funding, fee math, release →
// settlement fact (objective delivery anchor), refund, invalid transitions, and
// the collusion-tax figure the simulation reports.
import { test } from "node:test";
import assert from "node:assert/strict";
import { openHold, release, refund, feeFor, netToPayee, collusionTax, FEE_BPS } from "../src/escrow.js";

test("openHold funds a hold and validates input", () => {
  const h = openHold({ questId: 7, patronDid: "did:ex:patron", amountCents: 50000, now: 1 });
  assert.equal(h.state, "funded");
  assert.equal(h.amountCents, 50000);
  assert.equal(h.feeBps, FEE_BPS);
  assert.throws(() => openHold({ questId: 7, patronDid: "did:ex:p", amountCents: 0 }), /positive integer/);
  assert.throws(() => openHold({ questId: 7, amountCents: 100 }), /required/);
});

test("fee + net math (2.9%)", () => {
  const h = openHold({ questId: 1, patronDid: "did:ex:p", amountCents: 50000 });
  assert.equal(feeFor(h), 1450); // 50000 * 0.029
  assert.equal(netToPayee(h), 48550);
});

test("release transitions funded → released and emits the settlement anchor", () => {
  const h = openHold({ questId: 42, patronDid: "did:ex:patron", amountCents: 100000, now: 1 });
  const { hold, settlement } = release(h, { payeeDid: "did:ex:guild", party: ["did:ex:a", "did:ex:b"], now: 2 });
  assert.equal(hold.state, "released");
  assert.equal(hold.releasedAt, 2);
  // The settlement is a patron-authored quest event → eligibility anchor + delivery proof.
  assert.equal(settlement.kind, "quest");
  assert.equal(settlement.author, "did:ex:patron");
  assert.equal(settlement.body.guild, "did:ex:guild");
  assert.deepEqual(settlement.body.party, ["did:ex:a", "did:ex:b"]);
  assert.equal(settlement.body.escrow.released, true);
  assert.equal(settlement.body.escrow.netCents, 97100); // 100000 - 2900
});

test("invalid transitions throw", () => {
  const h = openHold({ questId: 1, patronDid: "did:ex:p", amountCents: 1000 });
  const { hold: released } = release(h, { payeeDid: "did:ex:g" });
  assert.throws(() => release(released, { payeeDid: "did:ex:g" }), /cannot release from state 'released'/);
  assert.throws(() => refund(released), /cannot refund from state 'released'/);
  assert.throws(() => release(h, {}), /payeeDid required/);
});

test("refund returns a funded hold to the patron", () => {
  const h = openHold({ questId: 1, patronDid: "did:ex:p", amountCents: 1000, now: 1 });
  const r = refund(h, { now: 5 });
  assert.equal(r.state, "refunded");
  assert.equal(r.refundedAt, 5);
});

test("collusion tax matches the simulation ($87 on $3,000 cycled)", () => {
  assert.equal(collusionTax(300000), 8700); // cents
});
