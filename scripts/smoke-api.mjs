// API smoke harness — drives the REAL Worker over HTTP, signing governance claims exactly
// like web/claimstead.js does (generate a device key, register it, sign with it), so it
// exercises the full server stack: putClaim → verifyRecords → reprojectGuildMembers →
// getGuild. No browser needed; the signing code is shared from src/governance.js.
//
//   BASE_URL=http://127.0.0.1:8787 node scripts/smoke-api.mjs
//
// Expects a running `wrangler dev` with TEST_FIXTURES=1 and personas seeded
// (POST /api/test/seed). Hermetic: each run founds a uniquely-named guild. Exit 0 = pass.
import { generateKeypair, signRecord } from "../src/governance.js";

const BASE = (process.env.BASE_URL || "http://127.0.0.1:8787").replace(/\/$/, "");
const cookies = new Map(); // did -> "bg_session=…"
const keys = new Map();    // did -> CryptoKeyPair
let pass = 0, fail = 0;

const ok = (cond, msg) => { if (cond) { pass++; console.log(`  ✓ ${msg}`); } else { fail++; console.error(`  ✗ ${msg}`); } };
const die = (e) => { console.error(`\n✗ smoke aborted: ${e?.stack || e}`); process.exit(1); };

async function req(path, { method = "GET", body, did } = {}) {
  const headers = { "content-type": "application/json" };
  if (did && cookies.has(did)) headers.cookie = cookies.get(did);
  const res = await fetch(BASE + "/api" + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${text}`);
  return { data, res };
}

async function actAs(did) {
  const res = await fetch(BASE + "/api/test/act-as", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ did }),
  });
  if (!res.ok) throw new Error(`act-as ${did} → ${res.status} ${await res.text()}`);
  const setCookie = res.headers.get("set-cookie") || "";
  const m = setCookie.match(/bg_session=[^;]+/);
  if (!m) throw new Error(`act-as ${did}: no session cookie returned`);
  cookies.set(did, m[0]);
}

// Generate this process's device key for `did` and register its public JWK (once per run).
// The browser persists one key in IndexedDB; this harness mints a fresh one each run, so it
// always (re)registers — registerKey is INSERT OR REPLACE — to match whatever it signs with,
// even against a DB carrying a stale key from a previous run.
async function ensureKey(did) {
  if (keys.has(did)) return;
  keys.set(did, await generateKeypair());
  const jwk = await crypto.subtle.exportKey("jwk", keys.get(did).publicKey);
  delete jwk.key_ops; delete jwk.ext;
  await req("/gov/keys", { method: "POST", body: { jwk }, did });
}

// Sign a record with `did`'s device key and post it (mirrors claimstead.postClaim).
async function claim(did, fields) {
  await ensureKey(did);
  const record = await signRecord(
    { ...fields, author: did, createdAt: new Date().toISOString(), nonce: Math.random().toString(36).slice(2) },
    keys.get(did).privateKey
  );
  const { data } = await req("/gov/claims", { method: "POST", body: { record }, did });
  return data; // { ref }
}

const guildScope = (id) => String(id);
const joinClaim   = (did, id) => claim(did, { type: "org.buildguild.designation", guild: guildScope(id), grantee: did, capability: "role:member", scope: guildScope(id), mode: "delegate" });
const inviteClaim = (did, id, grantee) => claim(did, { type: "org.buildguild.designation", guild: guildScope(id), grantee, capability: "role:member", scope: guildScope(id), mode: "delegate" });
const acceptClaim = (did, id, ref) => claim(did, { type: "org.buildguild.acceptance", guild: guildScope(id), subject: ref });
const leaveClaim  = (did, id) => claim(did, { type: "org.buildguild.revocation", guild: guildScope(id), grantee: did, capability: "role:member", scope: guildScope(id) });

const rosterDids = async (id) => (await req(`/guilds/${id}`)).data.members.map((m) => m.did);

(async () => {
  console.log(`\n▶ API smoke against ${BASE}\n`);

  // Personas (seeded). Find Ada (a guild builder) + Quill (standalone, our joiner/recruit).
  const { data: status } = await req("/test/status").catch(die);
  ok(status?.enabled, "test harness is enabled");
  const find = (frag) => (status.personas || []).find((p) => p.display_name.toLowerCase().includes(frag))?.did;
  const Ada = find("ada"), Quill = find("quill");
  ok(Ada && Quill, `found personas Ada=${Ada} Quill=${Quill}`);
  if (!Ada || !Quill) return die("missing seeded personas — run POST /api/test/seed first");

  // --- found a fresh guild as Ada (hermetic; Ada is the genesis founder) ---
  await actAs(Ada);
  const { data: guild } = await req("/guilds", { method: "POST", body: { name: `Smoke ${Date.now()}` }, did: Ada });
  const gid = guild.id;
  console.log(`\n• founded guild #${gid} as Ada`);
  ok((await rosterDids(gid)).includes(Ada), "founder Ada is in the roster");
  ok(!(await rosterDids(gid)).includes(Quill), "Quill is not a member yet");

  // --- Scenario: open self-join, then leave ---
  console.log(`\n• self-join + leave (Quill)`);
  await actAs(Quill);
  await joinClaim(Quill, gid);
  ok((await rosterDids(gid)).includes(Quill), "Quill self-joined the open guild");
  await leaveClaim(Quill, gid);
  ok(!(await rosterDids(gid)).includes(Quill), "Quill left (self-revocation drops them)");

  // --- Scenario: consent is the gate (invite → pending → accept) ---
  console.log(`\n• consented invite (Ada invites Quill)`);
  await actAs(Ada);
  const invite = await inviteClaim(Ada, gid, Quill);
  ok(!(await rosterDids(gid)).includes(Quill), "an un-accepted invite is NOT membership (consent gate)");
  await actAs(Quill);
  await acceptClaim(Quill, gid, invite.ref);
  ok((await rosterDids(gid)).includes(Quill), "Quill joins only after co-signing the invite");

  // --- leave again; dangling invite must not re-enroll ---
  console.log(`\n• leave sticks despite the old invite`);
  await leaveClaim(Quill, gid);
  ok(!(await rosterDids(gid)).includes(Quill), "Quill left; the dangling invite doesn't re-enroll");

  console.log(`\n${fail ? "✗" : "✓"} API smoke: ${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
})().catch(die);
