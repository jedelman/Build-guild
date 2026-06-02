// Test-persona harness — a lightweight, GATED stand-in for real Bluesky accounts so
// the whole multi-party flow (governance, attestations, payouts) can be driven solo
// on staging/previews. Opaque did:test: identities (nothing resolves them); a Stripe
// Custom test account per persona (transfers-ready instantly); an "act as" session.
//
// HARD GATE: every route that uses this checks env.TEST_FIXTURES — set only on
// staging/preview (see the wrangler template). Production omits it, so /api/test/*
// 404s and none of this can ever touch real users.
import { createSession } from "./db.js";
import { createCustomConnectAccount, retrieveAccount, stripeConfigured } from "./stripe.js";

export const testEnabled = (env) => env.TEST_FIXTURES === "1" || env.TEST_FIXTURES === 1;

export const PERSONAS = [
  { did: "did:test:ada", handle: "ada.test", display_name: "Ada (test)", klass: "Architect" },
  { did: "did:test:bjorn", handle: "bjorn.test", display_name: "Bjorn (test)", klass: "Artificer" },
  { did: "did:test:cleo", handle: "cleo.test", display_name: "Cleo (test)", klass: "Bard" },
];

// Seed each persona: a builder row + a payouts-ready Stripe Custom test account,
// and a shared "Test Guild" they all belong to (so it can claim quests as a party).
// Idempotent.
export async function seedPersonas(env) {
  const out = [];
  for (const p of PERSONAS) {
    await env.DB.prepare("INSERT OR IGNORE INTO builders (handle, did, display_name, klass) VALUES (?, ?, ?, ?)")
      .bind(p.handle, p.did, p.display_name, p.klass)
      .run();

    let stripeStatus = "no-stripe";
    if (stripeConfigured(env)) {
      const existing = await env.DB.prepare("SELECT account_id FROM connect_accounts WHERE did = ?").bind(p.did).first();
      if (existing) {
        stripeStatus = "exists";
      } else {
        try {
          const acct = await createCustomConnectAccount(env, p);
          const full = await retrieveAccount(env, acct.id);
          const ready = !!(full.payouts_enabled || full.capabilities?.transfers === "active");
          await env.DB.prepare("INSERT OR REPLACE INTO connect_accounts (did, account_id, charges_enabled, payouts_enabled, details_submitted) VALUES (?, ?, ?, ?, ?)")
            .bind(p.did, acct.id, full.charges_enabled ? 1 : 0, ready ? 1 : 0, full.details_submitted ? 1 : 0)
            .run();
          stripeStatus = ready ? "payouts-ready" : "pending";
        } catch (e) {
          stripeStatus = "stripe-error: " + e.message;
        }
      }
    }
    out.push({ ...p, stripe: stripeStatus });
  }
  await seedTestGuild(env);
  return out;
}

async function seedTestGuild(env) {
  let g = await env.DB.prepare("SELECT id FROM guilds WHERE name = ?").bind("Test Guild").first();
  if (!g) {
    const res = await env.DB.prepare("INSERT INTO guilds (name, charter) VALUES (?, ?)").bind("Test Guild", "Seeded personas, for testing.").run();
    g = { id: res.meta.last_row_id };
  }
  for (const p of PERSONAS) {
    const b = await env.DB.prepare("SELECT id FROM builders WHERE did = ?").bind(p.did).first();
    if (b) await env.DB.prepare("INSERT OR IGNORE INTO guild_members (guild_id, builder_id, role) VALUES (?, ?, 'member')").bind(g.id, b.id).run();
  }
  return g.id;
}

export async function listPersonas(env) {
  const out = [];
  for (const p of PERSONAS) {
    const b = await env.DB.prepare("SELECT id FROM builders WHERE did = ?").bind(p.did).first();
    const c = await env.DB.prepare("SELECT payouts_enabled FROM connect_accounts WHERE did = ?").bind(p.did).first();
    out.push({ ...p, seeded: !!b, payouts_ready: !!(c && c.payouts_enabled) });
  }
  return out;
}

// Mint a session for a persona ("act as"). Only known test personas are allowed.
export async function actAsSession(env, did) {
  const p = PERSONAS.find((x) => x.did === did);
  if (!p) throw new Error("unknown test persona");
  return createSession(env, { did: p.did, handle: p.handle });
}
