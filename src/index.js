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

  if (resource === "builders") {
    if (method === "GET" && !id) return json(await listBuilders(env));
    if (method === "POST" && !id) {
      const body = await readJson(request);
      if (!body) return fail("invalid JSON body");
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
