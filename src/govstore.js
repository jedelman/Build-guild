// Claimstead store — the "title plant". D1 holds SIGNED records as a convenience
// index; this module verifies signatures on write and recomputes state on read via
// the pure verifier (governance.js). It is deliberately non-authoritative: every
// answer is re-derivable from the stored signatures alone.
import { verifyRecords, deriveGuildState, tallyBadges, observe, buildContext } from "./governance.js";
import { openHold, release as escrowRelease, feeFor, netToPayee } from "./escrow.js";
import { contractsFor } from "./contracts.js";
import * as stripe from "./stripe.js";
import { APPLICATION_FEE_BPS, payoutPlan } from "./payments.js";

// ---- Stripe Connect onboarding (payees can receive payouts) ----------------
export const paymentsConfigured = (env) => stripe.stripeConfigured(env);

// Start (or resume) Express onboarding for the session DID; returns a Stripe
// hosted-onboarding URL to redirect to. Stores only the connected account id.
export async function startOnboarding(env, did, origin) {
  if (!stripe.stripeConfigured(env)) throw new Error("payments are not configured");
  let row = await env.DB.prepare("SELECT account_id FROM connect_accounts WHERE did = ?").bind(did).first();
  let accountId = row?.account_id;
  if (!accountId) {
    const acct = await stripe.createConnectAccount(env, {});
    accountId = acct.id;
    await env.DB.prepare("INSERT OR REPLACE INTO connect_accounts (did, account_id) VALUES (?, ?)").bind(did, accountId).run();
  }
  const link = await stripe.createAccountLink(env, {
    account: accountId,
    refresh_url: `${origin}/?connect=refresh`,
    return_url: `${origin}/?connect=done`,
  });
  return { url: link.url };
}

// Cheap local check (no Stripe call) — does this DID have payouts enabled?
export async function payoutsReady(env, did) {
  const row = await env.DB.prepare("SELECT payouts_enabled FROM connect_accounts WHERE did = ?").bind(did).first();
  return !!(row && row.payouts_enabled);
}

// Read connect status; refreshes from Stripe when configured + connected.
export async function connectStatus(env, did) {
  const row = await env.DB.prepare("SELECT * FROM connect_accounts WHERE did = ?").bind(did).first();
  if (!row) return { connected: false, payouts_ready: false };
  if (stripe.stripeConfigured(env)) {
    try {
      const a = await stripe.retrieveAccount(env, row.account_id);
      await env.DB.prepare("UPDATE connect_accounts SET charges_enabled=?, payouts_enabled=?, details_submitted=? WHERE did=?")
        .bind(a.charges_enabled ? 1 : 0, a.payouts_enabled ? 1 : 0, a.details_submitted ? 1 : 0, did)
        .run();
      return { connected: true, payouts_ready: !!a.payouts_enabled, details_submitted: !!a.details_submitted };
    } catch {
      /* fall through to stored values */
    }
  }
  return { connected: true, payouts_ready: !!row.payouts_enabled, details_submitted: !!row.details_submitted };
}

// Resolve did -> public CryptoKey from the registered device keys (memoized/run).
async function keyResolver(env) {
  const cache = new Map();
  return async (did) => {
    if (cache.has(did)) return cache.get(did);
    const row = await env.DB.prepare("SELECT pubkey_jwk FROM gov_keys WHERE did = ?").bind(did).first();
    let key = null;
    if (row) {
      try {
        key = await crypto.subtle.importKey("jwk", JSON.parse(row.pubkey_jwk), { name: "ECDSA", namedCurve: "P-256" }, true, ["verify"]);
      } catch {
        key = null;
      }
    }
    cache.set(did, key);
    return key;
  };
}

// Register (or rotate) the browser device key that signs a DID's claims.
export async function registerKey(env, did, jwk) {
  if (!jwk || jwk.kty !== "EC" || jwk.crv !== "P-256") throw new Error("expected a P-256 public JWK");
  await env.DB.prepare("INSERT OR REPLACE INTO gov_keys (did, pubkey_jwk) VALUES (?, ?)").bind(did, JSON.stringify(jwk)).run();
  return { ok: true };
}
export async function hasKey(env, did) {
  return !!(await env.DB.prepare("SELECT 1 FROM gov_keys WHERE did = ?").bind(did).first());
}

// Ingest a signed governance claim (verify author == you + signature, then index).
export async function putClaim(env, did, record) {
  if (!record || record.author !== did) throw new Error("claim author must be you");
  const resolve = await keyResolver(env);
  const [v] = await verifyRecords([record], resolve);
  if (!v._verified) throw new Error("signature did not verify — is your device key registered?");
  const guild = String(record.guild ?? record.body?.guild ?? "");
  await env.DB.prepare("INSERT OR IGNORE INTO gov_claims (ref, guild, kind, author_did, json) VALUES (?, ?, ?, ?, ?)")
    .bind(v._ref, guild, record.kind || record.type, did, JSON.stringify(record))
    .run();
  return { ref: v._ref };
}

export async function putAttestation(env, did, record) {
  if (!record || record.attester !== did) throw new Error("attester must be you");
  if (!record.subject || !record.contract) throw new Error("attestation needs a subject + contract");
  const resolve = await keyResolver(env);
  const [v] = await verifyRecords([record], resolve);
  if (!v._verified) throw new Error("signature did not verify — is your device key registered?");
  await env.DB.prepare("INSERT OR IGNORE INTO gov_attestations (ref, subject_did, contract, attester_did, json) VALUES (?, ?, ?, ?, ?)")
    .bind(v._ref, record.subject, record.contract, did, JSON.stringify(record))
    .run();
  return { ref: v._ref };
}

async function verifiedRows(env, rows) {
  const resolve = await keyResolver(env);
  return verifyRecords(rows.map((r) => JSON.parse(r.json)), resolve);
}

// Derive a guild's governance state from its stored, signed claims.
export async function guildState(env, guildId, opts) {
  const id = String(guildId);
  const { results } = await env.DB.prepare("SELECT json FROM gov_claims WHERE guild = ?").bind(id).all();
  const verified = await verifiedRows(env, results || []);
  const charter = verified.find((r) => r.type === "org.buildguild.charter" && r._verified);
  if (!charter) return { guild: id, charter: null, members: [], roles: {}, proposals: {}, conflicts: [] };
  const state = deriveGuildState(charter, verified.filter((r) => r.kind), opts);
  return { charter: { version: charter.version, prose: charter.prose, founder: charter.founder }, ...state };
}

// Reputation badge cloud for a subject (builder DID, "guild:<id>", or client DID).
// Eligibility context comes from settlement quest events → only ESCROW-SETTLED
// quests are reputation-bearing (the collusion tax).
export async function reputation(env, subject, subjectType) {
  const [{ results: attRows }, { results: eventRows }] = await Promise.all([
    env.DB.prepare("SELECT json FROM gov_attestations WHERE subject_did = ?").bind(subject).all(),
    env.DB.prepare("SELECT json FROM gov_claims WHERE kind = 'quest'").all(),
  ]);
  const vAtts = await verifiedRows(env, attRows || []);
  const vEvents = await verifiedRows(env, eventRows || []);
  const ctx = buildContext(vEvents);
  const contracts = contractsFor(vAtts.map((a) => a.contract));
  const cloud = tallyBadges(subject, vAtts, contracts, ctx, { subjectType });
  const facts = observe(subject, vAtts, contracts, ctx, { subjectType });
  return { ...cloud, facts };
}

// ---- mock escrow (no real money) ------------------------------------------
// Fund: with Stripe configured, return a hosted Checkout URL that AUTHORIZES the
// bounty (manual capture → funds held, not captured); otherwise mock-fund now.
export async function fundEscrow(env, questId, patronDid, amountCents, origin, method = "card") {
  if (stripe.stripeConfigured(env)) {
    const base = {
      mode: "payment",
      success_url: `${origin}/?pay=done&quest=${questId}&session={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/?pay=cancel&quest=${questId}`,
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: "usd",
            unit_amount: amountCents,
            product_data: { name: `Build Guild — quest #${questId} bounty` },
          },
        },
      ],
    };
    const metadata = { quest_id: String(questId), patron_did: patronDid, fund_method: method };
    // Card authorizes a HOLD (manual capture). ACH can't hold — it charges now
    // and settles over a few days (the upfront-escrow-balance path).
    const params =
      method === "ach"
        ? { ...base, payment_method_types: ["us_bank_account"], payment_intent_data: { metadata } }
        : { ...base, payment_method_types: ["card"], payment_intent_data: { capture_method: "manual", metadata } };
    const session = await stripe.createCheckoutSession(env, params);
    return { checkout_url: session.url };
  }
  // Mock fallback (no Stripe key configured).
  const hold = openHold({ questId, patronDid, amountCents });
  await env.DB.prepare("INSERT INTO escrow_holds (quest_id, patron_did, amount_cents, fee_bps, state, provider) VALUES (?, ?, ?, ?, 'funded', 'mock')")
    .bind(questId, patronDid, amountCents, hold.feeBps)
    .run();
  return getEscrow(env, questId);
}

// Confirm a returned Checkout session → record the authorized hold (idempotent).
export async function confirmCheckout(env, questId, sessionId, patronDid) {
  const session = await stripe.retrieveSession(env, sessionId);
  const pi = typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id;
  if (!pi) throw new Error("payment not completed");
  const amount = session.amount_total ?? 0;
  const existing = await env.DB.prepare("SELECT id FROM escrow_holds WHERE quest_id = ? AND payment_intent_id = ?").bind(questId, pi).first();
  if (!existing) {
    await env.DB.prepare("INSERT INTO escrow_holds (quest_id, patron_did, amount_cents, fee_bps, state, provider, payment_intent_id) VALUES (?, ?, ?, ?, 'funded', 'stripe', ?)")
      .bind(questId, patronDid, amount, APPLICATION_FEE_BPS, pi)
      .run();
  }
  return getEscrow(env, questId);
}
export async function getEscrow(env, questId) {
  const row = await env.DB.prepare("SELECT * FROM escrow_holds WHERE quest_id = ? ORDER BY id DESC LIMIT 1").bind(questId).first();
  if (!row) return null;
  return { ...row, fee_cents: feeFor({ amountCents: row.amount_cents, feeBps: row.fee_bps }), net_cents: netToPayee({ amountCents: row.amount_cents, feeBps: row.fee_bps }) };
}

// Build the unsigned settlement the patron must sign to release (delivery anchor).
export async function settlementTemplate(env, questId, patronDid, payeeDid, party = []) {
  const row = await env.DB.prepare("SELECT * FROM escrow_holds WHERE quest_id = ? ORDER BY id DESC LIMIT 1").bind(questId).first();
  if (!row) throw new Error("no escrow hold for this quest");
  if (row.patron_did !== patronDid) throw new Error("only the patron can release");
  if (row.state !== "funded") throw new Error(`escrow already ${row.state}`);
  const { settlement } = escrowRelease(
    { questId, patronDid: row.patron_did, amountCents: row.amount_cents, feeBps: row.fee_bps, state: row.state },
    { payeeDid, party }
  );
  return settlement; // caller stamps createdAt + signs as the patron, then posts to /gov/claims
}

// Record payee + settlement ref + released state. No state guard (a Stripe release
// captures/transfers first, setting 'released', then records here).
export async function markReleased(env, questId, payeeDid, settlementRef = "") {
  await env.DB.prepare("UPDATE escrow_holds SET state='released', payee_did=?, settlement_ref=?, released_at=COALESCE(released_at, datetime('now')) WHERE quest_id = ?")
    .bind(payeeDid, settlementRef, questId)
    .run();
  return getEscrow(env, questId);
}

// Live release: capture the held PaymentIntent (card) and transfer the split to
// the party's connected accounts (option a: party nets gross − Stripe fee − 1%).
// Idempotent at the hold level — only a 'funded' Stripe hold proceeds.
export async function releaseEscrowStripe(env, questId, partyDids = []) {
  const row = await env.DB.prepare("SELECT * FROM escrow_holds WHERE quest_id = ? AND state = 'funded' AND provider = 'stripe' ORDER BY id DESC LIMIT 1").bind(questId).first();
  if (!row || !row.payment_intent_id) throw new Error("no funded Stripe escrow to release");

  let pi = await stripe.retrievePaymentIntent(env, row.payment_intent_id, ["latest_charge.balance_transaction"]);
  if (pi.status === "requires_capture") {
    await stripe.capturePaymentIntent(env, row.payment_intent_id);
    pi = await stripe.retrievePaymentIntent(env, row.payment_intent_id, ["latest_charge.balance_transaction"]);
  }
  if (pi.status !== "succeeded")
    throw new Error(`payment not capturable yet (status: ${pi.status}) — an ACH debit may still be settling`);

  const stripeFeeCents = pi.latest_charge?.balance_transaction?.fee ?? 0;

  // Resolve party members who can actually receive payouts.
  const accounts = [];
  for (const did of partyDids) {
    const a = await env.DB.prepare("SELECT account_id, payouts_enabled FROM connect_accounts WHERE did = ?").bind(did).first();
    if (a && a.payouts_enabled) accounts.push({ did, account_id: a.account_id });
  }
  const plan = payoutPlan(row.amount_cents, stripeFeeCents, accounts);

  const transferIds = [];
  for (const t of plan.transfers) {
    const tr = await stripe.createTransfer(env, {
      amount: t.cents,
      currency: "usd",
      destination: t.account,
      transfer_group: `quest_${questId}`,
    });
    transferIds.push(tr.id);
  }
  await env.DB.prepare("UPDATE escrow_holds SET state='released', released_at=datetime('now') WHERE id = ?").bind(row.id).run();
  return { ...plan, transferIds };
}
