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
  saveAuthState,
  takeAuthState,
  createSession,
  getSession,
  deleteSession,
} from "./db.js";
import { recommendRecruits } from "./logic.js";
import { fetchBlueskyProfile, suggestSkillsFromProfile } from "./atproto.js";
import {
  clientMetadata,
  createPkce,
  generateDpopKey,
  randomToken,
  resolveHandleToDid,
  resolveDidToPds,
  resolveAuthServer,
  pushedAuthorizationRequest,
  exchangeCode,
  parseCookies,
  serializeCookie,
} from "./oauth.js";

const SESSION_COOKIE = "bg_session";

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
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

  if (resource === "auth") return authRoute(request, env, url, id);

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

// ---------- OAuth routes ----------

async function authRoute(request, env, url, action) {
  if (action === "login" && request.method === "GET") return authLogin(env, url);
  if (action === "callback" && request.method === "GET") return authCallback(env, url);
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

async function authLogin(env, url) {
  const handle = url.searchParams.get("handle");
  if (!handle) return fail("handle query param required");

  let did, meta;
  try {
    did = await resolveHandleToDid(handle);
    meta = await resolveAuthServer(await resolveDidToPds(did));
  } catch (e) {
    return fail(`couldn't start login for that handle: ${e.message}`, 400);
  }

  const cm = clientMetadata(url.origin);
  const pkce = await createPkce();
  const dpopJwk = await generateDpopKey();
  const state = randomToken(24);

  const parParams = {
    client_id: cm.client_id,
    response_type: "code",
    redirect_uri: cm.redirect_uris[0],
    scope: "atproto",
    state,
    code_challenge: pkce.challenge,
    code_challenge_method: "S256",
    login_hint: handle,
  };

  let par, nonce;
  try {
    ({ json: par, nonce } = await pushedAuthorizationRequest(meta, parParams, dpopJwk));
  } catch (e) {
    return fail(`authorization request failed: ${e.message}`, 502);
  }

  await saveAuthState(env, {
    state,
    handle,
    did,
    pkce_verifier: pkce.verifier,
    dpop_jwk: JSON.stringify(dpopJwk),
    token_endpoint: meta.token_endpoint,
    issuer: meta.issuer,
    dpop_nonce: nonce,
  });

  const authUrl = `${meta.authorization_endpoint}?client_id=${encodeURIComponent(
    cm.client_id
  )}&request_uri=${encodeURIComponent(par.request_uri)}`;
  return Response.redirect(authUrl, 302);
}

async function authCallback(env, url) {
  const state = url.searchParams.get("state");
  const code = url.searchParams.get("code");
  const iss = url.searchParams.get("iss");
  const err = url.searchParams.get("error");
  // Surface every failure as a clean redirect with the reason in the query
  // string, so it's visible to the user (and shareable for debugging) rather
  // than a raw JSON 500.
  const oops = (reason) => redirectHome(`/?login=error&reason=${encodeURIComponent(reason)}`);
  if (err) return oops(url.searchParams.get("error_description") || err);
  if (!state || !code) return oops("missing state or code");

  const st = await takeAuthState(env, state);
  if (!st) return oops("invalid or expired login state");
  const norm = (s) => (s || "").replace(/\/+$/, "");
  if (iss && norm(iss) !== norm(st.issuer)) return oops(`issuer mismatch (${iss} vs ${st.issuer})`);

  const cm = clientMetadata(url.origin);
  let tok;
  try {
    ({ json: tok } = await exchangeCode(
      { token_endpoint: st.token_endpoint },
      {
        client_id: cm.client_id,
        grant_type: "authorization_code",
        code,
        redirect_uri: cm.redirect_uris[0],
        code_verifier: st.pkce_verifier,
      },
      JSON.parse(st.dpop_jwk),
      st.dpop_nonce
    ));
  } catch (e) {
    return oops(`token exchange failed: ${e.message}`);
  }

  const did = tok.sub || st.did;
  if (!did) return oops("login did not yield a DID");

  const session = await createSession(env, { did, handle: st.handle });
  const headers = new Headers({ location: "/?login=ok" });
  headers.append(
    "set-cookie",
    serializeCookie(SESSION_COOKIE, session.id, { maxAge: 60 * 60 * 24 * 30 })
  );
  return new Response(null, { status: 302, headers });
}

const redirectHome = (location) => new Response(null, { status: 302, headers: { location } });
