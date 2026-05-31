import { test } from "node:test";
import assert from "node:assert/strict";
import {
  base64url,
  createPkce,
  generateDpopKey,
  dpopProof,
  parseCookies,
  serializeCookie,
  clientMetadata,
} from "../src/oauth.js";

const decodeJson = (seg) =>
  JSON.parse(Buffer.from(seg.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"));

test("base64url encodes without padding or url-unsafe chars", () => {
  const out = base64url("subjects?>>");
  assert.ok(!/[+/=]/.test(out));
});

test("createPkce challenge is the S256 hash of the verifier", async () => {
  const { verifier, challenge, method } = await createPkce();
  assert.equal(method, "S256");
  assert.ok(verifier.length >= 43); // 32 bytes base64url
  const expected = base64url(
    new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)))
  );
  assert.equal(challenge, expected);
});

test("dpopProof is a well-formed ES256 JWT with the public JWK in the header", async () => {
  const jwk = await generateDpopKey();
  const proof = await dpopProof({
    privateJwk: jwk,
    htm: "POST",
    htu: "https://pds.example/token",
    nonce: "abc",
  });
  const [h, p, sig] = proof.split(".");
  assert.ok(h && p && sig);
  const header = decodeJson(h);
  assert.equal(header.typ, "dpop+jwt");
  assert.equal(header.alg, "ES256");
  assert.equal(header.jwk.kty, "EC");
  assert.equal(header.jwk.crv, "P-256");
  assert.ok(header.jwk.x && header.jwk.y);
  assert.equal(header.jwk.d, undefined); // private component must not leak
  const payload = decodeJson(p);
  assert.equal(payload.htm, "POST");
  assert.equal(payload.htu, "https://pds.example/token");
  assert.equal(payload.nonce, "abc");
  assert.ok(payload.jti && payload.iat);
});

test("dpopProof includes ath only when an access token is given", async () => {
  const jwk = await generateDpopKey();
  const withAth = await dpopProof({ privateJwk: jwk, htm: "GET", htu: "https://x/y", accessToken: "tok" });
  assert.ok(decodeJson(withAth.split(".")[1]).ath);
  const without = await dpopProof({ privateJwk: jwk, htm: "GET", htu: "https://x/y" });
  assert.equal(decodeJson(without.split(".")[1]).ath, undefined);
});

test("cookies round-trip and the session cookie is hardened", () => {
  assert.equal(parseCookies("a=1; bg_session=xyz%20z").bg_session, "xyz z");
  const c = serializeCookie("bg_session", "v", { maxAge: 100 });
  assert.match(c, /HttpOnly/);
  assert.match(c, /Secure/);
  assert.match(c, /SameSite=Lax/);
  assert.match(c, /Max-Age=100/);
  assert.match(serializeCookie("bg_session", "", { expires: 0 }), /Max-Age=0/);
});

test("clientMetadata is derived from the deployment origin", () => {
  const cm = clientMetadata("https://build-guild-pr-7.example.workers.dev");
  assert.equal(cm.client_id, "https://build-guild-pr-7.example.workers.dev/client-metadata.json");
  assert.equal(cm.redirect_uris[0], "https://build-guild-pr-7.example.workers.dev/api/auth/callback");
  assert.equal(cm.token_endpoint_auth_method, "none");
  assert.equal(cm.dpop_bound_access_tokens, true);
  assert.equal(cm.scope, "atproto");
});
