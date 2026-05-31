// Build Guild — Cloudflare Worker: JSON API under /api/*, static SPA otherwise.
import {
  listBuilders,
  getBuilder,
  createBuilder,
  listGuilds,
  getGuild,
  createGuild,
  joinGuild,
  leaveGuild,
} from "./db.js";
import { recommendRecruits } from "./logic.js";
import { fetchBlueskyProfile, suggestSkillsFromProfile } from "./atproto.js";

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

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
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
      const body = await readJson(request);
      if (!body) return fail("invalid JSON body");
      // Re-verify the handle server-side so the stored DID/avatar are authoritative
      // rather than client-supplied. If the lookup fails we still create the
      // builder (unverified) so the app works even when Bluesky is unreachable.
      if (body.handle) {
        const profile = await fetchBlueskyProfile(body.handle);
        if (profile) {
          body.handle = profile.handle;
          body.did = profile.did;
          if (!body.avatar) body.avatar = profile.avatar;
        }
      }
      return json(await createBuilder(env, body), 201);
    }
    if (method === "GET" && id) {
      const builder = await getBuilder(env, gid);
      return builder ? json(builder) : fail("builder not found", 404);
    }
  }

  if (resource === "guilds") {
    if (method === "GET" && !id) return json(await listGuilds(env));
    if (method === "POST" && !id) {
      const body = await readJson(request);
      if (!body) return fail("invalid JSON body");
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
        const body = (await readJson(request)) || {};
        if (!body.builder_id) return fail("builder_id required");
        if (action === "join") await joinGuild(env, gid, Number(body.builder_id), body.role);
        else await leaveGuild(env, gid, Number(body.builder_id));
        const guild = await getGuild(env, gid);
        return guild ? json(guild) : fail("guild not found", 404);
      }
    }
  }

  return null;
}
