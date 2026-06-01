// D1 data access for Build Guild.
import {
  guildSkillMap,
  diversityScore,
  championRoster,
  consensusPeak,
  rankPartiesForQuest,
} from "./logic.js";
import { skillSlug, endorsementTier, classifyRepo } from "./skills.js";
import { resolveDidToPds } from "./oauth.js";

// atproto collections in a builder's own PDS (source of truth; D1 indexes them).
const SKILL_COLLECTION = "org.buildguild.skill";
const ENDORSEMENT_COLLECTION = "org.buildguild.endorsement";
const REPO_COLLECTION = "org.buildguild.repo";

const groupBy = (rows, key) => {
  const out = {};
  for (const r of rows) (out[r[key]] ||= []).push(r);
  return out;
};

const clampPeak = (v) => Math.max(1, Math.min(100, Math.round(Number(v) || 1)));
// Provisional strength for a declared-but-unendorsed skill. Self-rating (the
// old slider) is gone; real strength will come from peer endorsement (#4), so
// until then every declared skill starts from the same neutral baseline.
const DEFAULT_PEAK = 70;
const byPeak = (a, b) => b.peak - a.peak;

/**
 * Rebuild a builder's D1 skill index from the authoritative records in their
 * atproto repo (collection org.buildguild.skill). We read the repo directly via
 * public listRecords — never trusting client-supplied data — then mirror each
 * record into the skills index with its AT-URI/CID and confirmed ESCO ref, and
 * cache the ESCO ref on the shared catalog so others benefit.
 */
export async function syncBuilderSkills(env, builderId) {
  const builder = await env.DB.prepare("SELECT id, did FROM builders WHERE id = ?").bind(builderId).first();
  if (!builder) throw new Error("builder not found");
  if (!builder.did) throw new Error("builder has no verified DID");

  const pds = await resolveDidToPds(builder.did);
  const url =
    `${pds}/xrpc/com.atproto.repo.listRecords?repo=${encodeURIComponent(builder.did)}` +
    `&collection=${SKILL_COLLECTION}&limit=100`;
  const res = await fetch(url, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`listRecords failed: ${res.status}`);
  const { records = [] } = await res.json();

  // Rebuild this builder's index from scratch from the PDS source of truth.
  const stmts = [env.DB.prepare("DELETE FROM skills WHERE builder_id = ?").bind(builderId)];
  for (const rec of records) {
    const v = rec?.value || {};
    const name = String(v.name || "").trim();
    if (!name) continue;
    const slug = skillSlug(name);
    const ref = String(v.externalRef || "");
    const escoUri =
      ref.includes("/esco/skill/") || String(v.externalScheme || "").toLowerCase() === "esco" ? ref : "";
    const escoLabel = escoUri ? String(v.externalLabel || "") : "";
    stmts.push(
      env.DB.prepare("INSERT OR IGNORE INTO skill_catalog (slug, name) VALUES (?, ?)").bind(slug, name)
    );
    stmts.push(
      env.DB.prepare(
        `INSERT INTO skills (builder_id, name, peak, skill_id, at_uri, cid, esco_uri, esco_label)
         SELECT ?, c.name, ?, c.id, ?, ?, ?, ? FROM skill_catalog c WHERE c.slug = ?`
      ).bind(builderId, DEFAULT_PEAK, rec.uri || "", rec.cid || "", escoUri, escoLabel, slug)
    );
    if (escoUri) {
      stmts.push(
        env.DB.prepare(
          "UPDATE skill_catalog SET esco_uri = ?, esco_label = ? WHERE slug = ? AND esco_uri = ''"
        ).bind(escoUri, escoLabel, slug)
      );
    }
  }
  await env.DB.batch(stmts);
  return getBuilder(env, builderId);
}

/**
 * Rebuild a builder's linked-repo index from org.buildguild.repo records in
 * their own atproto repo (read via public listRecords; never trust the client).
 * Tangled repos under the builder's own DID/handle are marked verified.
 */
export async function syncBuilderRepos(env, builderId) {
  const builder = await env.DB.prepare("SELECT id, did, handle FROM builders WHERE id = ?").bind(builderId).first();
  if (!builder) throw new Error("builder not found");
  if (!builder.did) throw new Error("builder has no verified DID");

  const pds = await resolveDidToPds(builder.did);
  const url =
    `${pds}/xrpc/com.atproto.repo.listRecords?repo=${encodeURIComponent(builder.did)}` +
    `&collection=${REPO_COLLECTION}&limit=100`;
  const res = await fetch(url, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`listRecords failed: ${res.status}`);
  const { records = [] } = await res.json();

  const stmts = [env.DB.prepare("DELETE FROM repos WHERE builder_id = ?").bind(builderId)];
  for (const rec of records) {
    const v = rec?.value || {};
    const repoUrl = String(v.url || "").trim();
    const name = String(v.name || "").trim();
    if (!repoUrl || !name) continue;
    // Trust the record's host hint, but recompute verification from identity.
    const { host, verified } = classifyRepo(repoUrl, { handle: builder.handle, did: builder.did });
    stmts.push(
      env.DB.prepare(
        `INSERT INTO repos (builder_id, host, name, url, description, verified, at_uri, cid)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        builderId,
        host || String(v.host || ""),
        name,
        repoUrl,
        String(v.description || "").slice(0, 300),
        verified ? 1 : 0,
        rec.uri || "",
        rec.cid || ""
      )
    );
  }
  await env.DB.batch(stmts);
  return getBuilder(env, builderId);
}

/**
 * Re-index an endorser's endorsements from the records in THEIR atproto repo
 * (org.buildguild.endorsement). Read directly via public listRecords — never
 * trusting client-supplied data — then replace this endorser's rows in the D1
 * index (their repo is authoritative for their own endorsements). Each row
 * keeps the strongRef (uri+cid) to the exact endorsed skill-record version.
 */
export async function syncEndorsements(env, endorserDid) {
  if (!endorserDid) throw new Error("endorser DID required");
  const pds = await resolveDidToPds(endorserDid);
  const url =
    `${pds}/xrpc/com.atproto.repo.listRecords?repo=${encodeURIComponent(endorserDid)}` +
    `&collection=${ENDORSEMENT_COLLECTION}&limit=100`;
  const res = await fetch(url, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`listRecords failed: ${res.status}`);
  const { records = [] } = await res.json();

  // Rebuild this endorser's slice of the index from their repo (source of truth).
  const stmts = [env.DB.prepare("DELETE FROM endorsements WHERE endorser_did = ?").bind(endorserDid)];
  for (const rec of records) {
    const v = rec?.value || {};
    const subject = String(v.subject || "");
    const ref = v.subjectSkill || {};
    const slug = skillSlug(v.skillSlug || v.skillName || "");
    if (!subject || !slug) continue; // malformed record, skip
    stmts.push(
      env.DB.prepare(
        `INSERT INTO endorsements
           (endorser_did, subject_did, skill_slug, skill_name, skill_at_uri, skill_cid, at_uri, cid, note)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (endorser_did, subject_did, skill_slug) DO UPDATE SET
           skill_name=excluded.skill_name, skill_at_uri=excluded.skill_at_uri,
           skill_cid=excluded.skill_cid, at_uri=excluded.at_uri, cid=excluded.cid, note=excluded.note`
      ).bind(
        endorserDid,
        subject,
        slug,
        String(v.skillName || ""),
        String(ref.uri || ""),
        String(ref.cid || ""),
        rec.uri || "",
        rec.cid || "",
        String(v.note || "").slice(0, 300)
      )
    );
  }
  await env.DB.batch(stmts);
  return { indexed: records.length };
}

/** Endorsements OF a builder, grouped by skill slug, each tagged with the
 *  endorser's computed relationship tier (none/guildmate/guild_leader/client).
 *  Tiers are computed here from guild membership, never stored. */
export async function getEndorsementsForBuilder(env, subjectDid) {
  if (!subjectDid) return {};
  const { results } = await env.DB.prepare(
    `SELECT e.skill_slug, e.skill_name, e.endorser_did, e.note, e.created_at, b.handle AS endorser_handle
       FROM endorsements e
       LEFT JOIN builders b ON b.did = e.endorser_did
      WHERE e.subject_did = ?
      ORDER BY e.created_at ASC`
  )
    .bind(subjectDid)
    .all();

  // Guild memberships for the subject + every endorser, so endorsementTier() can
  // classify each endorser's relationship to the subject (by DID).
  const dids = [...new Set([subjectDid, ...results.map((r) => r.endorser_did)])];
  const memberships = await membershipsForDids(env, dids);

  const bySlug = {};
  for (const r of results) {
    const tier = endorsementTier({ endorserDid: r.endorser_did, subjectDid, memberships });
    (bySlug[r.skill_slug] ||= []).push({
      endorser_did: r.endorser_did,
      endorser_handle: r.endorser_handle || null,
      tier,
      note: r.note || "",
      created_at: r.created_at,
    });
  }
  return bySlug;
}

/** {guild_id, did, role} rows for the given DIDs — input to endorsementTier. */
async function membershipsForDids(env, dids) {
  const list = [...new Set(dids)].filter(Boolean);
  if (!list.length) return [];
  const ph = list.map(() => "?").join(",");
  const { results } = await env.DB.prepare(
    `SELECT gm.guild_id, b.did, gm.role
       FROM guild_members gm JOIN builders b ON b.id = gm.builder_id
      WHERE b.did IN (${ph})`
  )
    .bind(...list)
    .all();
  return results;
}

/** Canonical skills matching a query, prefix-first then by usage. For the
 *  Enlist autocomplete. Empty query returns the most-used skills. */
export async function suggestSkills(env, q = "", limit = 20) {
  const slug = skillSlug(q);
  const safe = slug.replace(/[%_\\]/g, "\\$&"); // neutralize LIKE wildcards
  const { results } = await env.DB.prepare(
    `SELECT c.id, c.name, COUNT(s.id) AS uses
       FROM skill_catalog c
       LEFT JOIN skills s ON s.skill_id = c.id
      WHERE ? = '' OR c.slug LIKE ? ESCAPE '\\' OR c.slug LIKE ? ESCAPE '\\'
      GROUP BY c.id, c.name
      ORDER BY (c.slug LIKE ? ESCAPE '\\') DESC, uses DESC, c.name ASC
      LIMIT ?`
  )
    .bind(slug, safe + "%", "%" + safe + "%", safe + "%", Math.min(Number(limit) || 20, 50))
    .all();
  return results.map((r) => ({ id: r.id, name: r.name, uses: r.uses }));
}

export async function listBuilders(env) {
  const { results: builders } = await env.DB.prepare(
    "SELECT * FROM builders ORDER BY created_at DESC, id DESC"
  ).all();
  if (!builders.length) return [];
  const { results: skills } = await env.DB.prepare("SELECT * FROM skills").all();
  const skillsByBuilder = groupBy(skills, "builder_id");
  return builders.map((b) => ({
    ...b,
    skills: (skillsByBuilder[b.id] || []).sort(byPeak),
  }));
}

export async function getBuilder(env, id) {
  const builder = await env.DB.prepare("SELECT * FROM builders WHERE id = ?").bind(id).first();
  if (!builder) return null;
  const [{ results: skills }, { results: projects }, { results: guilds }, { results: repos }] =
    await env.DB.batch([
      env.DB.prepare("SELECT * FROM skills WHERE builder_id = ? ORDER BY peak DESC").bind(id),
      env.DB.prepare("SELECT * FROM projects WHERE builder_id = ?").bind(id),
      env.DB.prepare(
        "SELECT g.id, g.name, gm.role FROM guilds g JOIN guild_members gm ON gm.guild_id = g.id WHERE gm.builder_id = ?"
      ).bind(id),
      env.DB.prepare("SELECT * FROM repos WHERE builder_id = ? ORDER BY verified DESC, id").bind(id),
    ]);
  // Attach peer endorsements (indexed from endorsers' repos) to each skill, and
  // derive its consensus peak from them — strength is what peers vouch for, not
  // a self-rating. self_peak is kept for reference/debugging.
  const endorsementsBySlug = await getEndorsementsForBuilder(env, builder.did);
  const skillsWithEndorsements = skills.map((s) => {
    const list = endorsementsBySlug[skillSlug(s.name)] || [];
    return {
      ...s,
      self_peak: s.peak,
      peak: consensusPeak(list),
      endorsements: list,
      endorsement_count: list.length,
    };
  });
  return { ...builder, skills: skillsWithEndorsements, projects, guilds, repos };
}

export async function createBuilder(env, body) {
  const { handle, display_name, klass, tagline, bio, seeking, ai_augmented, did, avatar } = body;
  if (!handle?.trim() || !display_name?.trim()) {
    throw new Error("handle and display_name are required");
  }
  const res = await env.DB.prepare(
    `INSERT INTO builders (handle, did, display_name, klass, tagline, bio, avatar, seeking, ai_augmented)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      handle.trim().replace(/^@+/, ""),
      did || "",
      display_name.trim(),
      klass?.trim() || "Generalist",
      tagline || "",
      bio || "",
      avatar || "",
      seeking || "",
      ai_augmented ? 1 : 0
    )
    .run();
  const builderId = res.meta.last_row_id;

  // Skills are PDS-native now: the client writes org.buildguild.skill records to
  // the builder's repo and calls the skills-sync endpoint, which indexes them.
  const stmts = [];
  for (const p of body.projects || []) {
    if (!p?.name?.trim()) continue;
    stmts.push(
      env.DB.prepare(
        "INSERT INTO projects (builder_id, name, description, help_wanted, url) VALUES (?, ?, ?, ?, ?)"
      ).bind(builderId, p.name.trim(), p.description || "", p.help_wanted || "", p.url || "")
    );
  }
  if (stmts.length) await env.DB.batch(stmts);
  return getBuilder(env, builderId);
}

export async function listGuilds(env) {
  const { results } = await env.DB.prepare(
    `SELECT g.*, COUNT(gm.builder_id) AS member_count
       FROM guilds g LEFT JOIN guild_members gm ON gm.guild_id = g.id
      GROUP BY g.id ORDER BY g.created_at DESC, g.id DESC`
  ).all();
  return results;
}

export async function getGuild(env, id) {
  const guild = await env.DB.prepare("SELECT * FROM guilds WHERE id = ?").bind(id).first();
  if (!guild) return null;
  const { results: rows } = await env.DB.prepare(
    "SELECT b.id, gm.role FROM guild_members gm JOIN builders b ON b.id = gm.builder_id WHERE gm.guild_id = ?"
  )
    .bind(id)
    .all();
  // Load each member via getBuilder so their skills carry CONSENSUS peaks (from
  // endorsements) — Guild Power must reflect what peers vouch for, not self-rating.
  const members = [];
  for (const r of rows) {
    const b = await getBuilder(env, r.id);
    if (b) members.push({ ...b, role: r.role });
  }

  return {
    ...guild,
    members,
    skill_map: guildSkillMap(members),
    champions: championRoster(members),
    diversity: diversityScore(members),
  };
}

export async function createGuild(env, body) {
  if (!body.name?.trim()) throw new Error("guild name is required");
  const res = await env.DB.prepare("INSERT INTO guilds (name, charter) VALUES (?, ?)")
    .bind(body.name.trim(), body.charter || "")
    .run();
  const guildId = res.meta.last_row_id;
  if (body.founder_id) {
    await env.DB.prepare(
      "INSERT INTO guild_members (guild_id, builder_id, role) VALUES (?, ?, 'founder')"
    )
      .bind(guildId, Number(body.founder_id))
      .run();
  }
  return getGuild(env, guildId);
}

// ---------- builder ownership + edit/delete ----------

/** The builder a given DID owns (handle is identity), or null. */
export async function getBuilderByDid(env, did) {
  if (!did) return null;
  const row = await env.DB.prepare("SELECT * FROM builders WHERE did = ?").bind(did).first();
  return row ? getBuilder(env, row.id) : null;
}

/** Update a builder's editable fields and replace its projects. */
export async function updateBuilder(env, id, body) {
  const { display_name, klass, tagline, bio, seeking, ai_augmented, avatar } = body;
  if (!display_name?.trim()) throw new Error("display_name is required");
  await env.DB.prepare(
    `UPDATE builders SET display_name = ?, klass = ?, tagline = ?, bio = ?, avatar = ?, seeking = ?, ai_augmented = ?
       WHERE id = ?`
  )
    .bind(
      display_name.trim(),
      klass?.trim() || "Generalist",
      tagline || "",
      bio || "",
      avatar || "",
      seeking || "",
      ai_augmented ? 1 : 0,
      id
    )
    .run();

  // Replace projects wholesale. Skills are PDS-native (synced separately from
  // the builder's repo), so the profile edit no longer touches them.
  const stmts = [env.DB.prepare("DELETE FROM projects WHERE builder_id = ?").bind(id)];
  for (const p of body.projects || []) {
    if (!p?.name?.trim()) continue;
    stmts.push(
      env.DB.prepare(
        "INSERT INTO projects (builder_id, name, description, help_wanted, url) VALUES (?, ?, ?, ?, ?)"
      ).bind(id, p.name.trim(), p.description || "", p.help_wanted || "", p.url || "")
    );
  }
  await env.DB.batch(stmts);
  return getBuilder(env, id);
}

/** Delete a builder. ON DELETE CASCADE clears skills/projects/memberships. */
export async function deleteBuilder(env, id) {
  await env.DB.prepare("DELETE FROM builders WHERE id = ?").bind(id).run();
}

// ---------- OAuth state + sessions ----------

export async function saveAuthState(env, s) {
  await env.DB.prepare(
    `INSERT INTO oauth_auth_state (state, handle, did, pkce_verifier, dpop_jwk, token_endpoint, issuer, dpop_nonce)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      s.state,
      s.handle,
      s.did || "",
      s.pkce_verifier,
      s.dpop_jwk,
      s.token_endpoint,
      s.issuer,
      s.dpop_nonce || ""
    )
    .run();
}

/** Fetch and consume (delete) an auth-state row by state. */
export async function takeAuthState(env, state) {
  const row = await env.DB.prepare("SELECT * FROM oauth_auth_state WHERE state = ?").bind(state).first();
  if (row) await env.DB.prepare("DELETE FROM oauth_auth_state WHERE state = ?").bind(state).run();
  return row;
}

export async function createSession(env, { did, handle, ttlSeconds = 60 * 60 * 24 * 30 }) {
  const id = crypto.randomUUID() + crypto.randomUUID().replace(/-/g, "");
  const expires = new Date(Date.now() + ttlSeconds * 1000).toISOString();
  await env.DB.prepare("INSERT INTO sessions (id, did, handle, expires_at) VALUES (?, ?, ?, ?)")
    .bind(id, did, handle, expires)
    .run();
  return { id, expires_at: expires };
}

/** Return a live session row, or null if missing/expired. */
export async function getSession(env, id) {
  if (!id) return null;
  const row = await env.DB.prepare("SELECT * FROM sessions WHERE id = ?").bind(id).first();
  if (!row) return null;
  if (new Date(row.expires_at).getTime() < Date.now()) {
    await deleteSession(env, id);
    return null;
  }
  return row;
}

export async function deleteSession(env, id) {
  await env.DB.prepare("DELETE FROM sessions WHERE id = ?").bind(id).run();
}

// Append-only log of OAuth handshake steps. Best-effort: never let a logging
// failure break the actual auth flow.
export async function logAuthEvent(env, kind, { handle = "", did = "", detail = "", ua = "" } = {}) {
  try {
    await env.DB.prepare(
      "INSERT INTO auth_events (id, kind, handle, did, detail, user_agent) VALUES (?, ?, ?, ?, ?, ?)"
    )
      .bind(crypto.randomUUID(), kind, handle, did, String(detail).slice(0, 500), String(ua).slice(0, 200))
      .run();
  } catch {
    /* logging is best-effort */
  }
}

export async function joinGuild(env, guildId, builderId, role = "member") {
  await env.DB.prepare(
    "INSERT OR IGNORE INTO guild_members (guild_id, builder_id, role) VALUES (?, ?, ?)"
  )
    .bind(guildId, builderId, role === "founder" ? "member" : role)
    .run();
}

export async function leaveGuild(env, guildId, builderId) {
  await env.DB.prepare("DELETE FROM guild_members WHERE guild_id = ? AND builder_id = ?")
    .bind(guildId, builderId)
    .run();
}

// ---------- quests (#6) ----------

/** List quests (newest first), each with its required canonical skills. */
export async function listQuests(env) {
  const { results: quests } = await env.DB.prepare(
    "SELECT * FROM quests ORDER BY (status='open') DESC, created_at DESC, id DESC"
  ).all();
  if (!quests.length) return [];
  const { results: qskills } = await env.DB.prepare("SELECT * FROM quest_skills").all();
  const byQuest = groupBy(qskills, "quest_id");
  return quests.map((q) => ({ ...q, skills: (byQuest[q.id] || []).map((s) => ({ name: s.name })) }));
}

/** A single quest with its required skills + skill-matched party suggestions. */
export async function getQuest(env, id) {
  const quest = await env.DB.prepare("SELECT * FROM quests WHERE id = ?").bind(id).first();
  if (!quest) return null;
  const { results: qskills } = await env.DB.prepare(
    "SELECT * FROM quest_skills WHERE quest_id = ?"
  ).bind(id).all();
  const required = qskills.map((s) => ({ name: s.name }));

  // Candidate parties: every guild (with consensus-peak member skills) plus each
  // builder as a party of one. Reuse the pure matchmaking from logic.js.
  const guilds = await listGuilds(env);
  const parties = [];
  for (const g of guilds) {
    const full = await getGuild(env, g.id);
    if (full) parties.push({ kind: "guild", id: g.id, name: g.name, members: full.members });
  }
  for (const b of await listBuilders(env)) {
    parties.push({ kind: "builder", id: b.id, name: b.display_name, members: [{ skills: b.skills }] });
  }
  const ranked = rankPartiesForQuest(required, parties)
    .filter((r) => r.coverage > 0)
    .slice(0, 8)
    .map((r) => ({
      kind: r.party.kind,
      id: r.party.id,
      name: r.party.name,
      coverage: Math.round(r.coverage * 100),
      covered: r.covered,
      missing: r.missing,
    }));

  return { ...quest, skills: required, suggested_parties: ranked };
}

/** Post a quest as the verified patron (DID/handle from the session). */
export async function createQuest(env, { patron_did, patron_handle }, body) {
  if (!body?.title?.trim()) throw new Error("quest title is required");
  const res = await env.DB.prepare(
    "INSERT INTO quests (patron_did, patron_handle, title, brief, reward) VALUES (?, ?, ?, ?, ?)"
  )
    .bind(patron_did, patron_handle || "", body.title.trim(), body.brief || "", body.reward || "")
    .run();
  const questId = res.meta.last_row_id;

  const stmts = [];
  for (const s of body.skills || []) {
    const name = (s?.name || s || "").toString().trim();
    if (!name) continue;
    const slug = skillSlug(name);
    stmts.push(env.DB.prepare("INSERT OR IGNORE INTO skill_catalog (slug, name) VALUES (?, ?)").bind(slug, name));
    stmts.push(
      env.DB.prepare(
        `INSERT OR IGNORE INTO quest_skills (quest_id, skill_id, name)
         SELECT ?, c.id, c.name FROM skill_catalog c WHERE c.slug = ?`
      ).bind(questId, slug)
    );
  }
  if (stmts.length) await env.DB.batch(stmts);
  return getQuest(env, questId);
}

/** Claim a quest as a guild or an individual builder. Only an open quest. */
export async function claimQuest(env, id, { guildId = null, builderId = null }) {
  const quest = await env.DB.prepare("SELECT * FROM quests WHERE id = ?").bind(id).first();
  if (!quest) throw new Error("quest not found");
  if (quest.status !== "open") throw new Error("quest is no longer open");
  await env.DB.prepare(
    "UPDATE quests SET status='claimed', claimed_guild_id=?, claimed_builder_id=? WHERE id=?"
  )
    .bind(guildId, builderId, id)
    .run();
  return getQuest(env, id);
}

/** Advance a quest's status (patron only — enforced in the route). */
export async function setQuestStatus(env, id, status) {
  const allowed = ["open", "claimed", "delivered", "closed"];
  if (!allowed.includes(status)) throw new Error("invalid status");
  await env.DB.prepare("UPDATE quests SET status=? WHERE id=?").bind(status, id).run();
  return getQuest(env, id);
}
