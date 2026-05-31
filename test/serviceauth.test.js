import { test } from "node:test";
import assert from "node:assert/strict";
import { Secp256k1Keypair } from "@atproto/crypto";
import { verifyServiceAuthJwt, serviceDidForOrigin, didWebDocument } from "../src/serviceauth.js";

const b64url = (buf) =>
  Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

// Mint a Service-Auth-shaped JWT signed by `kp` (as a PDS would for the user).
async function mintJwt(kp, payload) {
  const header = b64url(JSON.stringify({ typ: "JWT", alg: "ES256K" }));
  const body = b64url(JSON.stringify(payload));
  const sig = await kp.sign(new TextEncoder().encode(`${header}.${body}`));
  return `${header}.${body}.${b64url(sig)}`;
}

// A DID doc resolver that returns a doc whose #atproto key is kp's public key.
function stubResolver(did, kp, handle) {
  const doc = {
    id: did,
    alsoKnownAs: [`at://${handle}`],
    verificationMethod: [{ id: `${did}#atproto`, type: "Multikey", publicKeyMultibase: kp.did().slice("did:key:".length) }],
  };
  return async () => doc;
}

const SERVICE_DID = "did:web:build-guild.example.workers.dev";
const LXM = "org.buildguild.establishSession";
const DID = "did:plc:alice000000000000000000";

test("serviceDidForOrigin / didWebDocument derive did:web from the host", () => {
  assert.equal(serviceDidForOrigin("https://build-guild.example.workers.dev"), SERVICE_DID);
  assert.equal(didWebDocument("https://build-guild.example.workers.dev").id, SERVICE_DID);
});

test("verifies a well-formed token and returns {did, handle}", async () => {
  const kp = await Secp256k1Keypair.create();
  const now = 1_900_000_000;
  const token = await mintJwt(kp, { iss: DID, aud: SERVICE_DID, lxm: LXM, iat: now, exp: now + 60 });
  const out = await verifyServiceAuthJwt(token, { serviceDid: SERVICE_DID, lxm: LXM, now, resolve: stubResolver(DID, kp, "alice.test") });
  assert.deepEqual(out, { did: DID, handle: "alice.test" });
});

test("rejects aud mismatch", async () => {
  const kp = await Secp256k1Keypair.create();
  const now = 1_900_000_000;
  const token = await mintJwt(kp, { iss: DID, aud: "did:web:evil.example", lxm: LXM, iat: now, exp: now + 60 });
  await assert.rejects(
    verifyServiceAuthJwt(token, { serviceDid: SERVICE_DID, lxm: LXM, now, resolve: stubResolver(DID, kp, "alice.test") }),
    /aud mismatch/
  );
});

test("rejects an expired token", async () => {
  const kp = await Secp256k1Keypair.create();
  const now = 1_900_000_000;
  const token = await mintJwt(kp, { iss: DID, aud: SERVICE_DID, lxm: LXM, iat: now - 120, exp: now - 60 });
  await assert.rejects(
    verifyServiceAuthJwt(token, { serviceDid: SERVICE_DID, lxm: LXM, now, resolve: stubResolver(DID, kp, "alice.test") }),
    /expired/
  );
});

test("rejects a signature from the wrong key", async () => {
  const kp = await Secp256k1Keypair.create();
  const attacker = await Secp256k1Keypair.create();
  const now = 1_900_000_000;
  const token = await mintJwt(attacker, { iss: DID, aud: SERVICE_DID, lxm: LXM, iat: now, exp: now + 60 });
  // Doc advertises kp's key, but the token was signed by the attacker.
  await assert.rejects(
    verifyServiceAuthJwt(token, { serviceDid: SERVICE_DID, lxm: LXM, now, resolve: stubResolver(DID, kp, "alice.test") }),
    /invalid signature/
  );
});

test("rejects lxm mismatch", async () => {
  const kp = await Secp256k1Keypair.create();
  const now = 1_900_000_000;
  const token = await mintJwt(kp, { iss: DID, aud: SERVICE_DID, lxm: "com.other.method", iat: now, exp: now + 60 });
  await assert.rejects(
    verifyServiceAuthJwt(token, { serviceDid: SERVICE_DID, lxm: LXM, now, resolve: stubResolver(DID, kp, "alice.test") }),
    /lxm mismatch/
  );
});
