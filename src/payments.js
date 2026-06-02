// Payment math + escrow state machine for the chosen model: AUTHORIZE on fund,
// CAPTURE on delivery, then TRANSFER to the party (minus a platform application
// fee). Pure + provider-agnostic — a provider (mock today, Stripe next) performs
// the side effects; this module decides amounts and legal transitions. No floats:
// all money is integer minor units (cents), fees in basis points.

export const APPLICATION_FEE_BPS = 100; // 1% platform fee (configurable)

// Quests are capped at 5 days — a forcing function for incremental delivery (no
// "you have 6 months to build the Torment Nexus"), and comfortably inside the
// ~7-day card-auth window so authorize→capture never lapses. Bigger engagements
// don't get a longer quest; they fund an upfront escrow BALANCE drawn down across
// capped quests, with a ledger visible to both parties (see the escrow-balance RFC).
export const MAX_QUEST_DAYS = 5;
export const MAX_QUEST_MS = MAX_QUEST_DAYS * 24 * 60 * 60 * 1000;
export const questDeadline = (createdAtMs) => createdAtMs + MAX_QUEST_MS;
export const withinQuestCap = (createdAtMs, closesAtMs) =>
  Number.isFinite(closesAtMs) && closesAtMs > createdAtMs && closesAtMs - createdAtMs <= MAX_QUEST_MS;

export const applicationFee = (grossCents, bps = APPLICATION_FEE_BPS) =>
  Math.round((grossCents * bps) / 10000);

// Split a NET amount across the party as evenly as possible; the remainder cents
// go to the earliest members (deterministic), so the splits always sum to net.
export function splitAmounts(netCents, party) {
  const n = party.length;
  if (n === 0) return [];
  const base = Math.floor(netCents / n);
  let rem = netCents - base * n;
  return party.map((did) => ({ did, cents: base + (rem-- > 0 ? 1 : 0) }));
}

// Platform fee + net + per-member split for a gross bounty. (Stripe's own
// processing fee is separate and configured per-charge.)
export function settlementMath(grossCents, party, bps = APPLICATION_FEE_BPS) {
  const feeCents = applicationFee(grossCents, bps);
  const netCents = grossCents - feeCents;
  return { grossCents, feeCents, netCents, splits: splitAmounts(netCents, party) };
}

// ---- escrow state machine (authorize → captured → transferred | canceled) ----
// Card authorizations expire (~7 days); authExpiresAt makes that explicit so the
// provider can re-authorize or capture-early before it lapses.
const AUTH_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

export function authorize({ questId, patronDid, amountCents, now = Date.now() }) {
  if (questId == null || !patronDid) throw new Error("authorize: questId and patronDid required");
  if (!Number.isInteger(amountCents) || amountCents <= 0) throw new Error("authorize: amountCents must be a positive integer");
  return {
    questId, patronDid, amountCents,
    state: "authorized",
    payeeDid: null, party: [],
    authorizedAt: now, authExpiresAt: now + AUTH_WINDOW_MS,
    capturedAt: null, transferredAt: null, canceledAt: null,
  };
}
export const authExpired = (hold, now = Date.now()) => hold.state === "authorized" && now >= hold.authExpiresAt;

export function capture(hold, { payeeDid, party = [], now = Date.now() }) {
  if (hold.state !== "authorized") throw new Error(`capture: cannot capture from '${hold.state}'`);
  if (authExpired(hold, now)) throw new Error("capture: authorization expired — re-authorize first");
  if (!payeeDid) throw new Error("capture: payeeDid required");
  return { ...hold, state: "captured", payeeDid, party, capturedAt: now };
}
export function markTransferred(hold, { now = Date.now() } = {}) {
  if (hold.state !== "captured") throw new Error(`transfer: cannot transfer from '${hold.state}'`);
  return { ...hold, state: "transferred", transferredAt: now };
}
export function cancel(hold, { now = Date.now() } = {}) {
  if (hold.state !== "authorized") throw new Error(`cancel: cannot cancel from '${hold.state}'`);
  return { ...hold, state: "canceled", canceledAt: now };
}

// Build the patron-signed settlement body (lexicon org.buildguild.settlement) — the
// off-protocol payment PROOF + on-protocol delivery anchor. `paymentRef` is an
// opaque Stripe id; no card data / PII ever lands here.
export function buildSettlement({ patronDid, questUri, questCid, payee, party = [], amountCents, currency = "usd", paymentRef }) {
  return {
    type: "org.buildguild.settlement",
    author: patronDid,
    quest: { uri: questUri, cid: questCid },
    payee,
    party,
    amount: amountCents,
    currency,
    paymentRef: paymentRef || "",
    createdAt: new Date().toISOString(),
  };
}
