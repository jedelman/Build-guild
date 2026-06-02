// Claimstead client — signs governance claims + attestations with a browser-held
// device key (ECDSA P-256 in IndexedDB), reusing the SAME governance.js that the
// Worker uses to verify. Nothing is written to the user's atproto PDS; signed
// records are posted to our index (the title plant). The private key is
// non-extractable and never leaves the device.
import { signRecord, recordRef } from "../src/governance.js";

const DB = "bg-claimstead";
const STORE = "keys";

function idb() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
function idbGet(k) {
  return idb().then((db) => new Promise((res, rej) => {
    const t = db.transaction(STORE, "readonly").objectStore(STORE).get(k);
    t.onsuccess = () => res(t.result);
    t.onerror = () => rej(t.error);
  }));
}
function idbPut(k, v) {
  return idb().then((db) => new Promise((res, rej) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(v, k);
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
  }));
}

// Device keys are scoped to the current session DID, so switching test personas
// (each a different DID) uses a distinct key rather than sharing one.
let _did;
async function whoami() {
  if (_did !== undefined) return _did;
  try {
    _did = (await api("/auth/me")).did || null;
  } catch {
    _did = null;
  }
  return _did;
}
let pair = null;
let pairKey = null;
async function deviceKey() {
  const key = "devkey:" + ((await whoami()) || "anon");
  if (pair && pairKey === key) return pair;
  let stored = await idbGet(key);
  if (!stored) {
    // private key non-extractable (can't be exfiltrated); public is still exportable.
    stored = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, false, ["sign", "verify"]);
    await idbPut(key, stored);
  }
  pair = stored;
  pairKey = key;
  return pair;
}

async function api(path, opts = {}) {
  const r = await fetch("/api" + path, {
    headers: { "content-type": "application/json" },
    ...opts,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || r.statusText);
  return d;
}

// Make sure the server has our device public key registered (idempotent).
let registered = false;
async function ensureRegistered() {
  if (registered) return;
  const { keyRegistered } = await api("/gov/me");
  if (!keyRegistered) {
    const { publicKey } = await deviceKey();
    const jwk = await crypto.subtle.exportKey("jwk", publicKey);
    delete jwk.key_ops;
    delete jwk.ext;
    await api("/gov/keys", { method: "POST", body: { jwk } });
  }
  registered = true;
}

// Build + sign a record (createdAt + nonce added before signing).
async function signed(fields) {
  await ensureRegistered();
  const { privateKey } = await deviceKey();
  return signRecord(
    { ...fields, createdAt: new Date().toISOString(), nonce: Math.random().toString(36).slice(2) },
    privateKey
  );
}

// ---- governance ------------------------------------------------------------
export async function postClaim(fields) {
  const record = await signed(fields);
  await api("/gov/claims", { method: "POST", body: { record } });
  return record;
}
export const adoptCharter = (did, guildId, prose, rules) =>
  postClaim({ type: "org.buildguild.charter", guild: String(guildId), version: 1, founder: did, prose, rules, author: did });
export const govClaim = (did, guildId, kind, body) =>
  postClaim({ type: "org.buildguild.claim", kind, author: did, guild: String(guildId), charterVersion: 1, body });
export const guildState = (guildId) => api(`/guilds/${guildId}/state`);

// ---- reputation ------------------------------------------------------------
export const reputation = (subject, type) =>
  api(`/gov/reputation?subject=${encodeURIComponent(subject)}&type=${type}`);
export async function attest(did, subject, contract, value, questRef) {
  const record = await signed({ type: "org.buildguild.attestation", attester: did, subject, contract, value, context: questRef ? { quest: questRef } : null });
  await api("/gov/attestations", { method: "POST", body: { record } });
  return record;
}

// ---- test-persona harness (these 404 when TEST_FIXTURES is off) -------------
export const testStatus = () => api("/test/status");
export const testSeed = () => api("/test/seed", { method: "POST", body: {} });
export const actAs = (did) => api("/test/act-as", { method: "POST", body: { did } });

// ---- Stripe Connect (payouts onboarding) -----------------------------------
export const connectStatus = () => api("/connect/status");
export const connectOnboard = () => api("/connect/onboard", { method: "POST", body: {} });

// ---- mock escrow -----------------------------------------------------------
export const getEscrow = (questId) => api(`/quests/${questId}/escrow`);
export const fundEscrow = (questId, cents, method = "card") =>
  api(`/quests/${questId}/escrow`, { method: "POST", body: { amount_cents: cents, method } });
export const confirmCheckout = (questId, session) => api(`/quests/${questId}/escrow/confirm`, { method: "POST", body: { session } });
// Release = the patron signs the settlement (delivery anchor) and posts it; the
// server captures + transfers (Stripe) and returns { escrow, payout }.
export async function releaseEscrow(did, questId, payee, party = [], paymentRef = "") {
  const record = await signed({ type: "org.buildguild.event", kind: "quest", author: did, body: { quest: questId, guild: payee, party, paymentRef } });
  const result = await api(`/quests/${questId}/escrow/release`, { method: "POST", body: { record } });
  return { result, settlementRef: await recordRef(record), payee };
}
