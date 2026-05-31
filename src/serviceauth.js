// Server-side verification of atproto Service Auth JWTs, plus our did:web
// service identity document.
//
// Browser-only auth model: the SPA logs in with @atproto/oauth-client-browser
// (tokens stay on-device, in IndexedDB), then asks its PDS to mint a short-lived
// JWT (com.atproto.server.getServiceAuth) signed by the user's atproto key, with
// aud = our did:web identity. Verifying that signature here lets us learn the
// user's DID and establish a session cookie WITHOUT ever holding a credential —
// so there's nothing sensitive for the per-PR preview D1 clone to leak.

import { verifySignature } from "@atproto/crypto";

function b64urlToBytes(s) {
  s = String(s).replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
const b64urlToJson = (s) => JSON.parse(new TextDecoder().decode(b64urlToBytes(s)));

/** Our service identity for a deployment origin: did:web on the host. */
export function serviceDidForOrigin(origin) {
  return "did:web:" + new URL(origin).host;
}

/** The did:web document we publish at /.well-known/did.json (per-origin, so it
 *  resolves on prod and every preview). Minimal: we only ever verify others'
 *  tokens, never sign, so no keys are required here. */
export function didWebDocument(origin) {
  return { "@context": ["https://www.w3.org/ns/did/v1"], id: serviceDidForOrigin(origin) };
}

async function getJson(url) {
  const res = await fetch(url, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`${url} -> ${res.status}`);
  return res.json();
}

/** Resolve a DID document (did:plc and did:web). */
export async function resolveDidDoc(did) {
  if (did.startsWith("did:plc:")) return getJson(`https://plc.directory/${did}`);
  if (did.startsWith("did:web:")) {
    const host = did.slice("did:web:".length).replace(/:/g, "/");
    return getJson(`https://${host}/.well-known/did.json`);
  }
  throw new Error(`unsupported DID method: ${did}`);
}

/** The atproto signing key (as a did:key) and handle from a DID document. */
function atprotoIdentity(doc) {
  const vm = (doc.verificationMethod || []).find((m) => m.id?.endsWith("#atproto"));
  if (!vm?.publicKeyMultibase) throw new Error("no atproto signing key in DID document");
  const handle =
    (doc.alsoKnownAs || []).find((a) => a.startsWith("at://"))?.slice("at://".length) || "";
  return { didKey: `did:key:${vm.publicKeyMultibase}`, handle };
}

/**
 * Verify a Service Auth JWT and return the authenticated { did, handle }.
 * Throws on any failure. The DID-doc resolver is injectable for testing.
 *
 * @param {string} token
 * @param {object} opts
 * @param {string} opts.serviceDid expected `aud` (our did:web)
 * @param {string} [opts.lxm]      expected lexicon-method binding
 * @param {number} [opts.now]      seconds since epoch (overridable for tests)
 * @param {(did:string)=>Promise<object>} [opts.resolve] DID-doc resolver
 */
export async function verifyServiceAuthJwt(
  token,
  { serviceDid, lxm, now = Math.floor(Date.now() / 1000), resolve = resolveDidDoc } = {}
) {
  const parts = String(token || "").split(".");
  if (parts.length !== 3) throw new Error("malformed JWT");
  const [h, p, sig] = parts;
  let payload;
  try {
    payload = b64urlToJson(p);
  } catch {
    throw new Error("malformed JWT");
  }

  if (!payload.iss?.startsWith?.("did:")) throw new Error("missing iss DID");
  if (!serviceDid || payload.aud !== serviceDid) throw new Error("aud mismatch");
  if (lxm && payload.lxm !== lxm) throw new Error("lxm mismatch");
  if (typeof payload.exp !== "number" || payload.exp < now) throw new Error("token expired");
  if (typeof payload.iat === "number" && payload.iat > now + 60) throw new Error("token issued in the future");

  const doc = await resolve(payload.iss);
  const { didKey, handle } = atprotoIdentity(doc);
  const ok = await verifySignature(didKey, new TextEncoder().encode(`${h}.${p}`), b64urlToBytes(sig));
  if (!ok) throw new Error("invalid signature");

  return { did: payload.iss, handle };
}
