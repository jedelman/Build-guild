// Mock Stripe-style escrow — NO real money. A pure state machine standing in for
// Stripe Connect (#18) so the reputation system's escrow-gating and objective
// delivery anchor can be wired and tested end-to-end now.
//
// WHY escrow is load-bearing for reputation (from the simulation): only a RELEASED
// hold yields a settlement fact, and only settled quests are reputation-bearing —
// so faking standing costs real (mock) money, taxing collusion. The release is also
// the objective delivery anchor that fixes the single-eligible "unilateral no".

export const FEE_BPS = 290; // 2.9%, Stripe-ish

// Open + fund a hold (mock: funding is synchronous).
export function openHold({ questId, patronDid, amountCents, feeBps = FEE_BPS, now = Date.now() }) {
  if (questId == null || !patronDid) throw new Error("escrow: questId and patronDid required");
  if (!Number.isInteger(amountCents) || amountCents <= 0) throw new Error("escrow: amountCents must be a positive integer");
  return {
    questId, patronDid, amountCents, feeBps,
    state: "funded",
    payeeDid: null, party: [],
    fundedAt: now, releasedAt: null, refundedAt: null,
  };
}

export const feeFor = (hold) => Math.round((hold.amountCents * hold.feeBps) / 10000);
export const netToPayee = (hold) => hold.amountCents - feeFor(hold);

// Release to the payee (the delivering guild) + emit the unsigned settlement event.
// The caller stamps `createdAt` and the PATRON signs it (it's their attestation that
// the work was delivered + paid) before it's indexed.
export function release(hold, { payeeDid, party = [], now = Date.now() }) {
  if (hold.state !== "funded") throw new Error(`escrow: cannot release from state '${hold.state}'`);
  if (!payeeDid) throw new Error("escrow: payeeDid required to release");
  const released = { ...hold, state: "released", payeeDid, party, releasedAt: now };
  const settlement = {
    type: "org.buildguild.event",
    kind: "quest",
    author: hold.patronDid, // the patron settles → eligibility anchor for delivery attestations
    body: {
      quest: hold.questId,
      guild: payeeDid,
      party,
      escrow: { amountCents: hold.amountCents, feeCents: feeFor(hold), netCents: netToPayee(hold), released: true },
    },
  };
  return { hold: released, settlement };
}

export function refund(hold, { now = Date.now() } = {}) {
  if (hold.state !== "funded") throw new Error(`escrow: cannot refund from state '${hold.state}'`);
  return { ...hold, state: "refunded", refundedAt: now };
}

// Cost for a collusion ring to manufacture standing once reputation is escrow-gated
// (the sim's lever, made concrete): fees on the total value they must cycle.
export const collusionTax = (totalCents, feeBps = FEE_BPS) => Math.round((totalCents * feeBps) / 10000);
