// Claimstead store — the "title plant". D1 holds SIGNED records as a convenience
// index; this module verifies signatures on write and recomputes state on read via
// the pure verifier (governance.js). Non-authoritative: every answer is re-derivable
// from the stored signatures alone.
//
// Payment is PEER-TO-PEER: the platform never custodies funds. Parties pay each
// other directly via any rail; a patron-signed SETTLEMENT record (with evidence)
// attests that it happened, and the payee co-signs by confirming receipt. Trust is
// the reputation system, and fraud is caught by independent audit (src/audit.js) —
// not by held money.
import { verifyRecords, deriveGuildState, tallyBadges, observe, buildContext } from "./governance.js";
import { contractsFor } from "./contracts.js";

// Resolve did -> public CryptoKey from the registered device keys.
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

export async function registerKey(env, did, jwk) {
  if (!jwk || jwk.kty !== "EC" || jwk.crv !== "P-256") throw new Error("expected a P-256 public JWK");
  await env.DB.prepare("INSERT OR REPLACE INTO gov_keys (did, pubkey_jwk) VALUES (?, ?)").bind(did, JSON.stringify(jwk)).run();
  return { ok: true };
}
export async function hasKey(env, did) {
  return !!(await env.DB.prepare("SELECT 1 FROM gov_keys WHERE did = ?").bind(did).first());
}

// Ingest a signed governance/settlement claim (verify author == you + signature).
// Any `evidence` the record carries is persisted verbatim inside the signed JSON.
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
  return verifyRecords((rows || []).map((r) => JSON.parse(r.json)), resolve);
}

// Derive a guild's governance state from its stored, signed claims.
export async function guildState(env, guildId, opts) {
  const id = String(guildId);
  const { results } = await env.DB.prepare("SELECT json FROM gov_claims WHERE guild = ?").bind(id).all();
  const verified = await verifiedRows(env, results);
  const charter = verified.find((r) => r.type === "org.buildguild.charter" && r._verified);
  if (!charter) return { guild: id, charter: null, members: [], roles: {}, proposals: {}, conflicts: [] };
  const state = deriveGuildState(charter, verified.filter((r) => r.kind), opts);
  return { charter: { version: charter.version, prose: charter.prose, founder: charter.founder }, ...state };
}

// Reputation badge cloud for a subject (builder DID, "guild:<id>", or client DID).
// Eligibility context comes from settlement records → only quests with a co-signed
// payment record are reputation-bearing.
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

// The patron-signed settlement (payment record) for a quest, if any: its ref +
// details + author. Used as the eligibility context for delivery/split attestations,
// and to show "paid" status. A settlement is a kind:"quest" event whose body.quest
// references this quest.
export async function getQuestSettlement(env, questId) {
  const { results } = await env.DB.prepare("SELECT json FROM gov_claims WHERE kind = 'quest'").all();
  const resolve = await keyResolver(env);
  for (const r of results || []) {
    const rec = JSON.parse(r.json);
    if (String(rec.body?.quest) !== String(questId)) continue;
    const [v] = await verifyRecords([rec], resolve);
    if (v._verified) return { ref: v._ref, author: rec.author, settlement: rec.body };
  }
  return null;
}

// Auditor dump: the verified signed-claim graph (all attestations + settlement
// events), optionally scoped to a subject. Independent auditors pull this, re-verify
// the signatures themselves, and run their own fraud detection (or src/audit.js).
export async function auditGraph(env, subject = null) {
  const attStmt = subject
    ? env.DB.prepare("SELECT json FROM gov_attestations WHERE subject_did = ? OR attester_did = ?").bind(subject, subject)
    : env.DB.prepare("SELECT json FROM gov_attestations");
  const [{ results: atts }, { results: events }] = await Promise.all([
    attStmt.all(),
    env.DB.prepare("SELECT json FROM gov_claims WHERE kind = 'quest'").all(),
  ]);
  return {
    attestations: await verifiedRows(env, atts || []),
    events: await verifiedRows(env, events || []),
  };
}
