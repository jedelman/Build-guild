// Bluesky / atproto OAuth for Cloudflare Workers.
//
// Hand-rolled because the official @atproto/oauth-client-node depends on Node
// APIs that don't run on Workers. We implement just what we need: the
// authorization-code flow with PKCE + DPoP for a *public* client, enough to
// prove the user controls their handle/DID at login. We mint our own session
// afterwards and do not persist atproto tokens yet.
//
// The pure helpers (base64url, PKCE, DPoP proof, cookies) are exported for
// unit testing; the network steps (resolve*, par, exchangeCode) need a live
// PDS and are exercised via the preview deploys.

// ---------- encoding helpers ----------

export function base64url(input) {
  const bytes =
    typeof input === "string" ? new TextEncoder().encode(input) : new Uint8Array(input);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function base64urlJson(obj) {
  return base64url(JSON.stringify(obj));
}

function randomBytes(len) {
  const a = new Uint8Array(len);
  crypto.getRandomValues(a);
  return a;
}

export function randomToken(bytes = 32) {
  return base64url(randomBytes(bytes));
}

async function sha256(text) {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
}

// ---------- PKCE ----------

export async function createPkce() {
  const verifier = randomToken(32);
  const challenge = base64url(await sha256(verifier));
  return { verifier, challenge, method: "S256" };
}

// ---------- DPoP ----------

const EC_PARAMS = { name: "ECDSA", namedCurve: "P-256" };

/** Generate a per-flow DPoP keypair; returns the private JWK (with `d`). */
export async function generateDpopKey() {
  const kp = await crypto.subtle.generateKey(EC_PARAMS, true, ["sign", "verify"]);
  return crypto.subtle.exportKey("jwk", kp.privateKey);
}

function publicJwkFrom(privateJwk) {
  return { kty: privateJwk.kty, crv: privateJwk.crv, x: privateJwk.x, y: privateJwk.y };
}

/**
 * Build a signed DPoP proof JWT for a request.
 * @param {object} opts {privateJwk, htm, htu, nonce?, accessToken?}
 */
export async function dpopProof({ privateJwk, htm, htu, nonce, accessToken }) {
  const header = { typ: "dpop+jwt", alg: "ES256", jwk: publicJwkFrom(privateJwk) };
  const payload = {
    jti: randomToken(16),
    htm,
    htu,
    iat: Math.floor(Date.now() / 1000),
  };
  if (nonce) payload.nonce = nonce;
  if (accessToken) payload.ath = base64url(await sha256(accessToken));
  return signEs256(header, payload, privateJwk);
}

async function signEs256(header, payload, privateJwk) {
  const key = await crypto.subtle.importKey("jwk", privateJwk, EC_PARAMS, false, ["sign"]);
  const data = `${base64urlJson(header)}.${base64urlJson(payload)}`;
  const sig = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    key,
    new TextEncoder().encode(data),
  );
  return `${data}.${base64url(sig)}`;
}

// ---------- cookies ----------

export function parseCookies(header = "") {
  const out = {};
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i === -1) continue;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export function serializeCookie(name, value, { maxAge, expires } = {}) {
  let c = `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; Secure; SameSite=Lax`;
  if (maxAge != null) c += `; Max-Age=${maxAge}`;
  if (expires === 0) c += `; Max-Age=0`;
  return c;
}

// ---------- client metadata ----------

/**
 * The OAuth client metadata document, derived from the deployment origin.
 * Browser-only (SPA) public client: @atproto/oauth-client-browser runs the flow
 * client-side and the authorization response is handled on the app origin, so
 * the redirect URI is the app root rather than a server callback endpoint.
 */
export function clientMetadata(origin) {
  return {
    client_id: `${origin}/client-metadata.json`,
    client_name: "Build Guild",
    client_uri: origin,
    redirect_uris: [`${origin}/`],
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    scope: "atproto transition:generic",
    token_endpoint_auth_method: "none",
    application_type: "web",
    dpop_bound_access_tokens: true,
  };
}

// ---------- atproto identity + auth-server resolution ----------

const stripAt = (h = "") => h.trim().replace(/^@+/, "").toLowerCase();

async function getJson(url, init) {
  const res = await fetch(url, { ...init, headers: { accept: "application/json", ...(init?.headers || {}) } });
  if (!res.ok) throw new Error(`${url} -> ${res.status}`);
  return res.json();
}

/** handle -> DID using a public resolver. */
export async function resolveHandleToDid(handle) {
  const actor = stripAt(handle);
  const data = await getJson(
    `https://bsky.social/xrpc/com.atproto.identity.resolveHandle?handle=${encodeURIComponent(actor)}`,
  );
  if (!data.did) throw new Error("handle did not resolve to a DID");
  return data.did;
}

/** DID -> PDS service endpoint. Supports did:plc and did:web. */
export async function resolveDidToPds(did) {
  let doc;
  if (did.startsWith("did:plc:")) {
    doc = await getJson(`https://plc.directory/${did}`);
  } else if (did.startsWith("did:web:")) {
    const host = did.slice("did:web:".length).replace(/:/g, "/");
    doc = await getJson(`https://${host}/.well-known/did.json`);
  } else {
    throw new Error(`unsupported DID method: ${did}`);
  }
  const svc = (doc.service || []).find((s) => s.id === "#atproto_pds" || s.type === "AtprotoPersonalDataServer");
  if (!svc?.serviceEndpoint) throw new Error("no PDS endpoint in DID document");
  return svc.serviceEndpoint;
}

/** PDS -> authorization server metadata (issuer, endpoints). */
export async function resolveAuthServer(pdsUrl) {
  const protyected = await getJson(`${pdsUrl}/.well-known/oauth-protected-resource`);
  const issuer = (protyected.authorization_servers || [])[0];
  if (!issuer) throw new Error("PDS advertised no authorization server");
  const meta = await getJson(`${issuer}/.well-known/oauth-authorization-server`);
  for (const k of ["issuer", "authorization_endpoint", "token_endpoint", "pushed_authorization_request_endpoint"]) {
    if (!meta[k]) throw new Error(`auth server metadata missing ${k}`);
  }
  return meta;
}

// ---------- PAR + token exchange (with one DPoP-nonce retry) ----------

/**
 * POST a form to an endpoint with a DPoP proof. If the server replies with a
 * `use_dpop_nonce` error and a DPoP-Nonce header, retry once with the nonce.
 * @returns {Promise<{json, nonce}>}
 */
async function dpopPost(endpoint, form, privateJwk, nonce) {
  const attempt = async (n) => {
    const proof = await dpopProof({ privateJwk, htm: "POST", htu: endpoint, nonce: n });
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", dpop: proof },
      body: new URLSearchParams(form).toString(),
    });
    return res;
  };
  let res = await attempt(nonce);
  let serverNonce = res.headers.get("dpop-nonce") || nonce || "";
  if (!res.ok) {
    const body = await res.clone().json().catch(() => ({}));
    if (body.error === "use_dpop_nonce" && res.headers.get("dpop-nonce")) {
      res = await attempt(res.headers.get("dpop-nonce"));
      serverNonce = res.headers.get("dpop-nonce") || serverNonce;
    }
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`${endpoint} -> ${res.status} ${text.slice(0, 300)}`);
  }
  return { json: await res.json(), nonce: serverNonce };
}

export async function pushedAuthorizationRequest(meta, params, privateJwk) {
  return dpopPost(meta.pushed_authorization_request_endpoint, params, privateJwk, "");
}

export async function exchangeCode(meta, params, privateJwk, nonce) {
  return dpopPost(meta.token_endpoint, params, privateJwk, nonce);
}
