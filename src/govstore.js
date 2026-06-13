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
import { verifyRecords, tallyBadges, observe, buildContext } from "./governance.js";
import { guildGraphFromRecords } from "./guild.js";
import { projectMembership } from "./membership.js";
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
  // Membership is the derived set from signed claims — refresh the guild_members projection
  // the rest of the app reads (roster, Guild Power, recruits). Roster-relevant claims only;
  // the table is a cache, so a reproject hiccup must not fail the (authoritative) write.
  if (guild && ROSTER_KINDS.has(record.type)) {
    try { await reprojectGuildMembers(env, guild); } catch (e) { console.warn("reproject failed", guild, e?.message); }
  }
  return { ref: v._ref };
}

// Claim types that can change a guild's roster: charter (genesis/rules), designation +
// acceptance + revocation (delegated/self admits), proposal + vote (admit/remove enact).
const ROSTER_KINDS = new Set([
  "org.buildguild.charter",
  "org.buildguild.designation",
  "org.buildguild.acceptance",
  "org.buildguild.revocation",
  "org.buildguild.proposal",
  "org.buildguild.attestation", // votes are attestations posted via this path
]);

// Rebuild the guild_members PROJECTION from signed claims. Founder rows (role 'founder') are
// the server-asserted genesis; everyone else is recomputed from claims. Idempotent; safe to
// call after any roster-relevant write.
export async function reprojectGuildMembers(env, guildId) {
  const gidText = String(guildId);
  const gidNum = Number(guildId);
  const { results: founderRows } = await env.DB.prepare(
    "SELECT b.did FROM guild_members gm JOIN builders b ON b.id = gm.builder_id WHERE gm.guild_id = ? AND gm.role = 'founder' AND b.did != ''"
  ).bind(gidNum).all();
  const founderDids = (founderRows || []).map((r) => r.did);

  const { results } = await env.DB.prepare("SELECT json FROM gov_claims WHERE guild = ?").bind(gidText).all();
  const records = await verifiedRows(env, results);
  const { roles } = projectMembership(gidText, founderDids, records);

  // map derived member DIDs -> builder ids (skip DIDs with no builder on this instance)
  const desired = new Map(); // builder_id -> role
  for (const [did, role] of roles) {
    const row = await env.DB.prepare("SELECT id FROM builders WHERE did = ?").bind(did).first();
    if (row) desired.set(row.id, role);
  }

  const { results: cur } = await env.DB.prepare("SELECT builder_id FROM guild_members WHERE guild_id = ?").bind(gidNum).all();
  const stmts = [];
  for (const r of cur || []) {
    if (!desired.has(r.builder_id)) stmts.push(env.DB.prepare("DELETE FROM guild_members WHERE guild_id = ? AND builder_id = ?").bind(gidNum, r.builder_id));
  }
  for (const [bid, role] of desired) {
    stmts.push(env.DB.prepare(
      "INSERT INTO guild_members (guild_id, builder_id, role) VALUES (?, ?, ?) ON CONFLICT(guild_id, builder_id) DO UPDATE SET role = excluded.role"
    ).bind(gidNum, bid, role));
  }
  if (stmts.length) await env.DB.batch(stmts);
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

// The live commons graph for a guild: verify its stored signed claims, derive unified
// authority (collective root + delegated admits) and build the record DAG. Same shape the
// debug view consumes from the offline sim, but recomputed on read from real claims — so
// nothing here is authoritative; any client can re-verify the `records` themselves.
export async function guildGraph(env, guildId) {
  const id = String(guildId);
  const { results } = await env.DB.prepare("SELECT json FROM gov_claims WHERE guild = ?").bind(id).all();
  const records = await verifiedRows(env, results);
  return { guild: id, generatedAt: new Date().toISOString(), ...guildGraphFromRecords(records) };
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
