// Build Guild — Cloudflare Worker: JSON API under /api/*, static SPA otherwise.
import {
  listBuilders,
  getBuilder,
  createBuilder,
  getBuilderByDid,
  updateBuilder,
  deleteBuilder,
  listGuilds,
  getGuild,
  createGuild,
  joinGuild,
  leaveGuild,
  suggestSkills,
  syncBuilderSkills,
  syncBuilderRepos,
  syncEndorsements,
  listQuests,
  getQuest,
  createQuest,
  claimQuest,
  setQuestStatus,
  createSession,
  getSession,
  deleteSession,
  logAuthEvent,
} from "./db.js";
import { recommendRecruits } from "./logic.js";
import { fetchBlueskyProfile, suggestSkillsFromProfile } from "./atproto.js";
import { escoSearch } from "./esco.js";
import { ingestTelemetry, scrub } from "./telemetry.js";
import { clientMetadata, parseCookies, serializeCookie } from "./oauth.js";
import { serviceDidForOrigin, didWebDocument, verifyServiceAuthJwt } from "./serviceauth.js";
import { testEnabled, seedPersonas, listPersonas, actAsSession } from "./testfixtures.js";
import {
  registerKey,
  hasKey,
  putClaim,
  putAttestation,
  guildGraph,
  reputation,
  getQuestSettlement,
  auditGraph,
} from "./govstore.js";
import { auditTrail } from "./audit.js";

const SESSION_COOKIE = "bg_session";
// Lexicon-method the browser binds its Service Auth token to when establishing a
// session. Verified server-side so a token minted for us can't be replayed at a
// different service.
const ESTABLISH_LXM = "org.buildguild.establishSession";

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
const fail = (message, status = 400) => json({ error: message }, status);

const readJson = async (request) => {
  try {
    return await request.json();
  } catch {
    return null;
  }
};

const currentSession = (request, env) =>
  getSession(env, parseCookies(request.headers.get("cookie") || "")[SESSION_COOKIE]);

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // The OAuth client id is the URL of this document; it must be reachable on
    // whatever origin the app is deployed to (prod or a per-PR preview).
    if (url.pathname === "/client-metadata.json") {
      return json(clientMetadata(url.origin));
    }

    // Our did:web service identity — used as the `aud` of the Service Auth JWT
    // the browser presents at /api/auth/establish. Per-origin so it resolves on
    // prod and every preview.
    if (url.pathname === "/.well-known/did.json") {
      return json(didWebDocument(url.origin));
    }

    if (url.pathname.startsWith("/api/")) {
      try {
        const res = await route(request, env, url);
        return res || fail("not found", 404);
      } catch (e) {
        if (/UNIQUE constraint/i.test(e.message)) {
          return fail("that handle or guild name is already taken", 409);
        }
        return fail(e.message || "internal error", 500);
      }
    }
    return env.ASSETS.fetch(request);
  },
};

async function route(request, env, url) {
  const [, resource, id, action, sub] = url.pathname.split("/").filter(Boolean);
  const method = request.method;
  const gid = Number(id);

  if (resource === "health") return json({ ok: true, ts: Date.now() });

  // Client OTLP trace uploads (tail-sampled: only sent on error / bug report).
  if (resource === "telemetry" && method === "POST") return ingestTelemetry(env, request);

  if (resource === "auth") return authRoute(request, env, url, id);

  // Canonical-skill autocomplete for the Enlist form.
  if (resource === "skills" && id === "suggest" && method === "GET") {
    return json(await suggestSkills(env, url.searchParams.get("q") || ""));
  }

  // ESCO concept candidates for a skill term (proxied; best-effort).
  if (resource === "skills" && id === "esco" && method === "GET") {
    try {
      return json(await escoSearch(url.searchParams.get("q") || ""));
    } catch {
      return json([]);
    }
  }

  // Look up a Bluesky profile to verify a handle and prefill a character sheet.
  if (resource === "atproto" && id === "profile" && method === "GET") {
    const handle = url.searchParams.get("handle");
    if (!handle) return fail("handle query param required");
    const profile = await fetchBlueskyProfile(handle);
    if (!profile) return fail("couldn't find that handle on Bluesky", 404);
    return json({ ...profile, suggested_skills: suggestSkillsFromProfile(profile.bio) });
  }

  if (resource === "builders") {
    if (method === "GET" && !id) return json(await listBuilders(env));
    if (method === "POST" && !id) {
      // Creating a builder requires a logged-in session; the handle/DID are
      // taken from the verified session, never the client, so you can only
      // enlist as yourself.
      const session = await currentSession(request, env);
      if (!session) return fail("log in with Bluesky to enlist", 401);
      const existing = await getBuilderByDid(env, session.did);
      if (existing) return fail("you already have a builder", 409);
      const body = (await readJson(request)) || {};
      const profile = await fetchBlueskyProfile(session.handle);
      body.handle = session.handle;
      body.did = session.did;
      if (profile && !body.avatar) body.avatar = profile.avatar;
      if (!body.display_name) body.display_name = profile?.display_name || session.handle;
      return json(await createBuilder(env, body), 201);
    }
    if (id && method === "GET") {
      const builder = await getBuilder(env, gid);
      return builder ? json(builder) : fail("builder not found", 404);
    }
    if (id && (method === "PUT" || method === "DELETE")) {
      const session = await currentSession(request, env);
      if (!session) return fail("log in to edit your builder", 401);
      const target = await getBuilder(env, gid);
      if (!target) return fail("builder not found", 404);
      if (!target.did || target.did !== session.did) return fail("that isn't your builder", 403);
      if (method === "DELETE") {
        await deleteBuilder(env, gid);
        return json({ ok: true });
      }
      const body = (await readJson(request)) || {};
      return json(await updateBuilder(env, gid, body));
    }
    // Re-index this builder's skills from their PDS records (owner only).
    if (id && action === "skills" && method === "POST") {
      const session = await currentSession(request, env);
      if (!session) return fail("log in to sync your skills", 401);
      const target = await getBuilder(env, gid);
      if (!target) return fail("builder not found", 404);
      if (!target.did || target.did !== session.did) return fail("that isn't your builder", 403);
      return json(await syncBuilderSkills(env, gid));
    }
    // Re-index this builder's linked repos from their PDS records (owner only).
    if (id && action === "repos" && method === "POST") {
      const session = await currentSession(request, env);
      if (!session) return fail("log in to sync your repos", 401);
      const target = await getBuilder(env, gid);
      if (!target) return fail("builder not found", 404);
      if (!target.did || target.did !== session.did) return fail("that isn't your builder", 403);
      return json(await syncBuilderRepos(env, gid));
    }
  }

  // Re-index the logged-in user's own endorsements from their PDS records.
  // Anyone logged in can endorse; you can only (re)index your own repo.
  if (resource === "endorsements" && method === "POST" && !id) {
    const session = await currentSession(request, env);
    if (!session) return fail("log in to endorse", 401);
    return json(await syncEndorsements(env, session.did));
  }

  if (resource === "guilds") {
    if (method === "GET" && !id) return json(await listGuilds(env));
    if (method === "POST" && !id) {
      const me = await sessionBuilder(request, env);
      if (!me) return fail("log in and create your builder first", 401);
      const body = (await readJson(request)) || {};
      body.founder_id = me.id; // found guilds as yourself
      return json(await createGuild(env, body), 201);
    }
    if (id) {
      if (method === "GET" && !action) {
        const guild = await getGuild(env, gid);
        return guild ? json(guild) : fail("guild not found", 404);
      }
      if (method === "GET" && action === "recruits") {
        const guild = await getGuild(env, gid);
        if (!guild) return fail("guild not found", 404);
        const memberIds = new Set(guild.members.map((m) => m.id));
        const candidates = (await listBuilders(env)).filter((b) => !memberIds.has(b.id));
        return json(recommendRecruits(guild.members, candidates));
      }
      // The live commons graph: collective authority (members, mandates, delegated admits,
      // proposal outcomes) + the verified record DAG, recomputed from signed claims. This is
      // what the debug view reads instead of the static sample.
      if (method === "GET" && action === "graph") {
        return json(await guildGraph(env, gid));
      }
      if (method === "POST" && (action === "join" || action === "leave")) {
        // You can only join/leave as your own builder.
        const me = await sessionBuilder(request, env);
        if (!me) return fail("log in and create your builder first", 401);
        if (action === "join") await joinGuild(env, gid, me.id);
        else await leaveGuild(env, gid, me.id);
        const guild = await getGuild(env, gid);
        return guild ? json(guild) : fail("guild not found", 404);
      }
    }
  }

  // ---------- quests (#6) ----------
  if (resource === "quests") {
    if (method === "GET" && !id) return json(await listQuests(env));
    if (method === "POST" && !id) {
      // Any verified Bluesky user can post a quest as a patron.
      const session = await currentSession(request, env);
      if (!session) return fail("log in with Bluesky to post a quest", 401);
      const body = (await readJson(request)) || {};
      return json(
        await createQuest(env, { patron_did: session.did, patron_handle: session.handle }, body),
        201
      );
    }
    if (id) {
      if (method === "GET" && !action) {
        const quest = await getQuest(env, gid);
        return quest ? json(quest) : fail("quest not found", 404);
      }
      if (method === "POST" && action === "claim") {
        // Claim as your own builder, or as a guild you belong to.
        const me = await sessionBuilder(request, env);
        if (!me) return fail("log in and create your builder first", 401);
        const body = (await readJson(request)) || {};
        if (body.guild_id) {
          const guild = await getGuild(env, Number(body.guild_id));
          if (!guild || !guild.members.some((m) => m.id === me.id))
            return fail("you can only claim for a guild you belong to", 403);
          return json(await claimQuest(env, gid, { guildId: Number(body.guild_id) }));
        }
        return json(await claimQuest(env, gid, { builderId: me.id }));
      }
      if (method === "POST" && action === "status") {
        // Only the patron who posted it can advance status.
        const session = await currentSession(request, env);
        if (!session) return fail("log in", 401);
        const quest = await getQuest(env, gid);
        if (!quest) return fail("quest not found", 404);
        if (quest.patron_did !== session.did) return fail("only the patron can update this quest", 403);
        const body = (await readJson(request)) || {};
        return json(await setQuestStatus(env, gid, body.status));
      }
      // ---- peer-to-peer payment record (no custody) ----
      // The patron pays the party directly off-platform and posts a co-signed
      // SETTLEMENT (with evidence). We just verify + index it; the payee confirms
      // receipt with a `pays.promptly` attestation. GET returns the record, if any.
      if (action === "payment" && method === "GET") {
        return json((await getQuestSettlement(env, gid)) || { paid: false });
      }
      if (action === "payment" && method === "POST") {
        const session = await currentSession(request, env);
        if (!session) return fail("log in", 401);
        const quest = await getQuest(env, gid);
        if (!quest) return fail("quest not found", 404);
        if (quest.patron_did !== session.did) return fail("only the patron can record payment", 403);
        const rec = ((await readJson(request)) || {}).record;
        if (!rec || rec.kind !== "quest" || rec.author !== session.did)
          return fail("a patron-signed settlement is required");
        const { ref } = await putClaim(env, session.did, rec); // verify signature + index
        return json({ paid: true, ref });
      }
    }
  }

  // ---------- audit: the public signed-claim graph + reference fraud lens ----
  // Independent auditors pull the verified records and re-check them themselves;
  // `flags` is one reference reading (collusion rings, reciprocity, unevidenced
  // payments), not a verdict — bring your own algorithm.
  if (resource === "audit" && method === "GET") {
    const graph = await auditGraph(env, url.searchParams.get("subject"));
    return json({ ...graph, flags: auditTrail(graph.attestations, graph.events).flags });
  }

  // ---------- TEST-ONLY persona harness (gated; 404 in prod) ----------
  if (resource === "test") {
    if (!testEnabled(env)) return null; // → 404 in production
    if (id === "status" && method === "GET") return json({ enabled: true, personas: await listPersonas(env) });
    if (id === "seed" && method === "POST") return json({ seeded: await seedPersonas(env) });
    if (id === "act-as" && method === "POST") {
      const did = ((await readJson(request)) || {}).did;
      const s = await actAsSession(env, did);
      return new Response(JSON.stringify({ ok: true, did }), {
        status: 200,
        headers: {
          "content-type": "application/json",
          "cache-control": "no-store",
          "set-cookie": serializeCookie(SESSION_COOKIE, s.id, { maxAge: 60 * 60 * 24 * 7 }),
        },
      });
    }
  }

  // ---------- Claimstead governance + reputation (#21) ----------
  if (resource === "gov") {
    if (id === "me" && method === "GET") {
      const session = await currentSession(request, env);
      return json({ keyRegistered: session ? await hasKey(env, session.did) : false });
    }
    if (id === "reputation" && method === "GET") {
      const subject = url.searchParams.get("subject");
      if (!subject) return fail("subject query param required");
      return json(await reputation(env, subject, url.searchParams.get("type") || "builder"));
    }
    const session = await currentSession(request, env);
    if (id === "keys" && method === "POST") {
      if (!session) return fail("log in first", 401);
      return json(await registerKey(env, session.did, ((await readJson(request)) || {}).jwk));
    }
    if (id === "claims" && method === "POST") {
      if (!session) return fail("log in first", 401);
      return json(await putClaim(env, session.did, ((await readJson(request)) || {}).record));
    }
    if (id === "attestations" && method === "POST") {
      if (!session) return fail("log in first", 401);
      return json(await putAttestation(env, session.did, ((await readJson(request)) || {}).record));
    }
  }

  return null;
}

/** The builder owned by the current session, or null. */
async function sessionBuilder(request, env) {
  const session = await currentSession(request, env);
  return session ? getBuilderByDid(env, session.did) : null;
}

// ---------- auth routes (browser-only) ----------

async function authRoute(request, env, url, action) {
  if (action === "establish" && request.method === "POST") return authEstablish(request, env, url);
  if (action === "me" && request.method === "GET") {
    const session = await currentSession(request, env);
    if (!session) return json({ authenticated: false });
    const builder = await getBuilderByDid(env, session.did);
    return json({
      authenticated: true,
      did: session.did,
      handle: session.handle,
      builder_id: builder?.id || null,
    });
  }
  if (action === "logout" && request.method === "POST") {
    const cookies = parseCookies(request.headers.get("cookie") || "");
    if (cookies[SESSION_COOKIE]) await deleteSession(env, cookies[SESSION_COOKIE]);
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: {
        "content-type": "application/json",
        "set-cookie": serializeCookie(SESSION_COOKIE, "", { expires: 0 }),
      },
    });
  }
  return null;
}

/**
 * Establish a session from a Service Auth JWT. The SPA logs in on-device via
 * @atproto/oauth-client-browser, then mints a short-lived JWT (signed by the
 * user's atproto key, aud = our did:web) and posts it here. We verify the
 * signature to learn the DID and mint our own cookie — no atproto credential is
 * ever stored server-side, so the per-PR preview D1 clone leaks nothing.
 */
async function authEstablish(request, env, url) {
  const auth = request.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice("Bearer ".length) : "";
  if (!token) return fail("missing service-auth token", 401);

  let id;
  try {
    id = await verifyServiceAuthJwt(token, {
      serviceDid: serviceDidForOrigin(url.origin),
      lxm: ESTABLISH_LXM,
    });
  } catch (e) {
    await logAuthEvent(env, "establish_error", { detail: scrub(e.message) });
    return fail(`could not verify identity: ${e.message}`, 401);
  }

  const session = await createSession(env, { did: id.did, handle: id.handle });
  const builder = await getBuilderByDid(env, id.did);
  await logAuthEvent(env, "establish_ok", { handle: id.handle, did: id.did, detail: "session created" });
  return new Response(
    JSON.stringify({
      authenticated: true,
      did: id.did,
      handle: id.handle,
      builder_id: builder?.id || null,
    }),
    {
      status: 200,
      headers: {
        "content-type": "application/json",
        "cache-control": "no-store",
        "set-cookie": serializeCookie(SESSION_COOKIE, session.id, { maxAge: 60 * 60 * 24 * 30 }),
      },
    }
  );
}
