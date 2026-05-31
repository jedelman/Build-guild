// D1 data access for Build Guild.
import { guildSkillMap, diversityScore, championRoster } from "./logic.js";

const groupBy = (rows, key) => {
  const out = {};
  for (const r of rows) (out[r[key]] ||= []).push(r);
  return out;
};

const clampPeak = (v) => Math.max(1, Math.min(100, Math.round(Number(v) || 1)));
const byPeak = (a, b) => b.peak - a.peak;

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
  const [{ results: skills }, { results: projects }, { results: guilds }] = await env.DB.batch([
    env.DB.prepare("SELECT * FROM skills WHERE builder_id = ? ORDER BY peak DESC").bind(id),
    env.DB.prepare("SELECT * FROM projects WHERE builder_id = ?").bind(id),
    env.DB.prepare(
      "SELECT g.id, g.name, gm.role FROM guilds g JOIN guild_members gm ON gm.guild_id = g.id WHERE gm.builder_id = ?"
    ).bind(id),
  ]);
  return { ...builder, skills, projects, guilds };
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

  const stmts = [];
  for (const s of body.skills || []) {
    if (!s?.name?.trim()) continue;
    stmts.push(
      env.DB.prepare("INSERT INTO skills (builder_id, name, peak) VALUES (?, ?, ?)").bind(
        builderId,
        s.name.trim(),
        clampPeak(s.peak)
      )
    );
  }
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
  const [{ results: rows }, { results: skills }] = await env.DB.batch([
    env.DB.prepare(
      "SELECT b.*, gm.role FROM guild_members gm JOIN builders b ON b.id = gm.builder_id WHERE gm.guild_id = ?"
    ).bind(id),
    env.DB.prepare(
      "SELECT s.* FROM skills s JOIN guild_members gm ON gm.builder_id = s.builder_id WHERE gm.guild_id = ?"
    ).bind(id),
  ]);
  const skillsByBuilder = groupBy(skills, "builder_id");
  const members = rows.map((b) => ({ ...b, skills: (skillsByBuilder[b.id] || []).sort(byPeak) }));

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

/** Update a builder's editable fields and replace its skills/projects. */
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

  // Replace skills/projects wholesale — simplest correct behaviour for an edit form.
  const stmts = [
    env.DB.prepare("DELETE FROM skills WHERE builder_id = ?").bind(id),
    env.DB.prepare("DELETE FROM projects WHERE builder_id = ?").bind(id),
  ];
  for (const s of body.skills || []) {
    if (!s?.name?.trim()) continue;
    stmts.push(
      env.DB.prepare("INSERT INTO skills (builder_id, name, peak) VALUES (?, ?, ?)").bind(
        id,
        s.name.trim(),
        clampPeak(s.peak)
      )
    );
  }
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
