// Canonical skill-vocabulary helpers.
//
// Pure (no Worker/D1 deps) so they run under `node --test`. The slug is the
// identity key shared by the app's write path and the SQL backfill in
// migrations/0005_skill_catalog.sql: case-folded, trimmed, internal whitespace
// collapsed. Two spellings that slug-match are the same skill.
export function skillSlug(name = "") {
  return String(name).trim().replace(/\s+/g, " ").toLowerCase();
}

/**
 * Decide which PDS skill-record rkeys to put vs. delete when saving a form,
 * with data-loss safety baked in. This is the guard for the bug where saving on
 * one deployment (whose D1 index was stale/empty) deleted real records from the
 * user's single, shared PDS repo.
 *
 * @param {Array<{rkey:string}>} wanted   rows the user is saving (rkeys present)
 * @param {string[]|null} loadedKeys      rkeys actually read from the PDS into
 *   this form, or null if the repo could not be read.
 * @returns {{putKeys:string[], deleteKeys:string[]}}
 *
 * Invariant: we only ever delete a record that was BOTH loaded from the repo
 * into this form AND removed by the user. If loadedKeys is null (unknown repo
 * state) we delete nothing — upsert only — so a stale view can't destroy data.
 */
export function reconcileSkillKeys(wanted, loadedKeys) {
  const want = new Set((wanted || []).map((s) => s.rkey).filter(Boolean));
  const putKeys = [...want];
  if (!Array.isArray(loadedKeys)) return { putKeys, deleteKeys: [] };
  const deleteKeys = loadedKeys.filter((k) => k && !want.has(k));
  return { putKeys, deleteKeys };
}

// Relationship tiers between an endorser and the builder they endorse, ranked.
// Stored endorsements are tier-agnostic; the tier is computed at read time so it
// stays correct as guilds/clients change. UI weighting by tier comes later.
export const ENDORSEMENT_TIERS = ["none", "guildmate", "guild_leader", "client"];

/**
 * Compute the strongest relationship tier of an endorser toward a subject.
 * Pure and data-driven so it's unit-testable and reused by the API.
 *
 * @param {object} ctx
 * @param {string} ctx.endorserDid
 * @param {string} ctx.subjectDid
 * @param {Array<{guild_id:(string|number), did:string, role?:string}>} [ctx.memberships]
 *   guild-membership rows for BOTH parties (did + guild_id [+ role]).
 * @param {Array<{client_did:string, builder_did:string}>} [ctx.clients]
 *   established client→builder relationships (e.g. from delivered quests, #6).
 * @returns {"none"|"guildmate"|"guild_leader"|"client"}
 */
export function endorsementTier({ endorserDid, subjectDid, memberships = [], clients = [] }) {
  if (!endorserDid || !subjectDid || endorserDid === subjectDid) return "none";

  if (clients.some((c) => c.client_did === endorserDid && c.builder_did === subjectDid)) {
    return "client";
  }

  const LEADER_ROLES = new Set(["founder", "leader", "officer"]);
  const endorserGuilds = new Map(); // guild_id -> endorser's role there
  const subjectGuilds = new Set();
  for (const m of memberships) {
    if (m.did === endorserDid) endorserGuilds.set(String(m.guild_id), m.role || "member");
    if (m.did === subjectDid) subjectGuilds.add(String(m.guild_id));
  }
  let shared = false;
  let leader = false;
  for (const [gid, role] of endorserGuilds) {
    if (subjectGuilds.has(gid)) {
      shared = true;
      if (LEADER_ROLES.has(role)) leader = true;
    }
  }
  if (leader) return "guild_leader";
  if (shared) return "guildmate";
  return "none";
}

/**
 * Classify a linked repo URL: its host, and whether ownership is self-evident.
 * A Tangled repo under the builder's own handle/DID is owned by the same atproto
 * identity, so it's verified without a second OAuth; other hosts are unverified
 * (self-asserted) until a later contribution-history check.
 * Pure + unit-testable.
 *
 * @param {string} url
 * @param {object} [ctx] { handle, did } of the builder
 * @returns {{host:string, verified:boolean}}
 */
export function classifyRepo(url, { handle = "", did = "" } = {}) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return { host: "", verified: false };
  }
  const hostname = u.hostname.toLowerCase().replace(/^www\./, "");
  const path = u.pathname.toLowerCase();
  let host = "other";
  if (hostname === "tangled.sh" || hostname === "tangled.org") host = "tangled";
  else if (hostname === "github.com") host = "github";
  else if (hostname.endsWith("gitlab.com")) host = "gitlab";

  // Tangled paths are /@handle/repo or /did:plc:.../repo — owned iff that owner
  // segment matches the builder's identity.
  let verified = false;
  if (host === "tangled") {
    const owner = path.split("/").filter(Boolean)[0] || "";
    const h = handle.toLowerCase();
    if (owner === `@${h}` || owner === h || (did && owner === did.toLowerCase())) verified = true;
  }
  return { host, verified };
}
