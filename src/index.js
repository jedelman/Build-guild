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
  createSession,
  getSession,
  deleteSession,
  logAuthEvent,
} from "./db.js";
import { recommendRecruits } from "./logic.js";
import { fetchBlueskyProfile, suggestSkillsFromProfile } from "./atproto.js";
import { ingestTelemetry, scrub } from "./telemetry.js";
import { clientMetadata, parseCookies, serializeCookie } from "./oauth.js";
import { serviceDidForOrigin, didWebDocument, verifyServiceAuthJwt } from "./serviceauth.js";

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
  const [, resource, id, action] = url.pathname.split("/").filter(Boolean);
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
