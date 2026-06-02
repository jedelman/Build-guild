// Claimstead store — the "title plant". D1 holds SIGNED records as a convenience
// index; this module verifies signatures on write and recomputes state on read via
// the pure verifier (governance.js). It is deliberately non-authoritative: every
// answer is re-derivable from the stored signatures alone.
import { verifyRecords, deriveGuildState, tallyBadges, observe, buildContext } from "./governance.js";
import { openHold, release as escrowRelease, feeFor, netToPayee } from "./escrow.js";
import { contractsFor } from "./contracts.js";

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
export async function fundEscrow(env, questId, patronDid, amountCents) {
  const hold = openHold({ questId, patronDid, amountCents });
  await env.DB.prepare("INSERT INTO escrow_holds (quest_id, patron_did, amount_cents, fee_bps, state) VALUES (?, ?, ?, ?, 'funded')")
    .bind(questId, patronDid, amountCents, hold.feeBps)
    .run();
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

// Mark the hold released once the signed settlement has been ingested, recording
// the settlement's ref so party members can attest split-fairness against it.
export async function markReleased(env, questId, payeeDid, settlementRef = "") {
  await env.DB.prepare("UPDATE escrow_holds SET state='released', payee_did=?, settlement_ref=?, released_at=datetime('now') WHERE quest_id = ? AND state='funded'")
    .bind(payeeDid, settlementRef, questId)
    .run();
  return getEscrow(env, questId);
}
