// Test-persona harness — a lightweight, GATED stand-in for real Bluesky accounts so
// the whole multi-party flow (governance, attestations, P2P payment records) can be
// driven solo on staging/previews. Opaque did:test: identities; an "act as" session.
//
// HARD GATE: routes check env.TEST_FIXTURES — set only on staging/preview (see the
// wrangler template). Production omits it, so /api/test/* 404s.
import { createSession } from "./db.js";

export const testEnabled = (env) => env.TEST_FIXTURES === "1" || env.TEST_FIXTURES === 1;

export const PERSONAS = [
  // Quill is a standalone PATRON (not in the Test Guild) — act as Quill to post,
  // pay, and rate; act as Ada/Bjorn (the party) to claim, deliver, and get paid.
  { did: "did:test:quill", handle: "quill.test", display_name: "Quill (patron)", klass: "Patron", role: "patron" },
  { did: "did:test:ada", handle: "ada.test", display_name: "Ada (test)", klass: "Architect" },
  { did: "did:test:bjorn", handle: "bjorn.test", display_name: "Bjorn (test)", klass: "Artificer" },
];

// Seed each persona as a builder + a shared "Test Guild" (the party). Idempotent.
// No payout setup needed — payment is peer-to-peer.
export async function seedPersonas(env) {
  for (const p of PERSONAS) {
    await env.DB.prepare("INSERT OR IGNORE INTO builders (handle, did, display_name, klass) VALUES (?, ?, ?, ?)")
      .bind(p.handle, p.did, p.display_name, p.klass)
      .run();
  }
  await seedTestGuild(env);
  return listPersonas(env);
}

async function seedTestGuild(env) {
  let g = await env.DB.prepare("SELECT id FROM guilds WHERE name = ?").bind("Test Guild").first();
  if (!g) {
    const res = await env.DB.prepare("INSERT INTO guilds (name, charter) VALUES (?, ?)").bind("Test Guild", "Seeded personas, for testing.").run();
    g = { id: res.meta.last_row_id };
  }
  for (const p of PERSONAS) {
    if (p.role === "patron") continue; // patron isn't a guild member (not a payee)
    const b = await env.DB.prepare("SELECT id FROM builders WHERE did = ?").bind(p.did).first();
    // Seed the party as 'founder' = the genesis cohort. Membership is otherwise the derived
    // set from signed claims (reprojectGuildMembers); genesis is the only no-claim bootstrap,
    // so seeding as 'founder' keeps Ada + Bjorn in the party across reprojections. UPSERT (not
    // OR IGNORE) so re-seeding an older DB promotes pre-existing 'member' rows to 'founder'.
    if (b) await env.DB.prepare(
      "INSERT INTO guild_members (guild_id, builder_id, role) VALUES (?, ?, 'founder') ON CONFLICT(guild_id, builder_id) DO UPDATE SET role = 'founder'"
    ).bind(g.id, b.id).run();
  }
  return g.id;
}

export async function listPersonas(env) {
  const out = [];
  for (const p of PERSONAS) {
    const b = await env.DB.prepare("SELECT id FROM builders WHERE did = ?").bind(p.did).first();
    out.push({ ...p, seeded: !!b });
  }
  return out;
}

// Mint a session for a persona ("act as"). Only known test personas are allowed.
export async function actAsSession(env, did) {
  const p = PERSONAS.find((x) => x.did === did);
  if (!p) throw new Error("unknown test persona");
  return createSession(env, { did: p.did, handle: p.handle });
}
