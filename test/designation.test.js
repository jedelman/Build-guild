// Designation / authority resolver — collective root, attenuated grants,
// acceptance-gated roles, and authority revocation with cascade.
import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeypair, signRecord, verifyRecords } from "../src/governance.js";
import { buildAuthority } from "../src/designation.js";

const keyring = new Map(), secrets = new Map();
async function actor(did) {
  const { publicKey, privateKey } = await generateKeypair();
  keyring.set(did, publicKey); secrets.set(did, privateKey); return did;
}
const resolveKey = (did) => keyring.get(did) || null;
const vr = async (did, rec) => (await verifyRecords([await signRecord({ ...rec, author: did }, secrets.get(did))], resolveKey))[0];

const GUILD = "did:guild:cartographers";
const charter = (founders, threshold) => ({
  type: "org.buildguild.charter", guild: GUILD, version: 1, founder: founders[0],
  rules: {
    root: { founders, threshold },
    roles: {
      founder: { can: ["grant_role", "admit", "remove"] },
      officer: { can: ["admit"] },
      member: { can: [] },
    },
  },
});

test("collective root: a lone founder cannot grant under threshold 2", async () => {
  const A = await actor("did:f:A"), B = await actor("did:f:B"), C = await actor("did:f:C");
  const O = await actor("did:p:officer");
  const ch = charter([A, B, C], 2);

  // A grants O officer (root grant) — only A consents so far; threshold is 2.
  const grant = await vr(A, { type: "org.buildguild.designation", grantee: O, mode: "delegate", capability: "role:officer", scope: GUILD, createdAt: "2026-01-01T00:00:00Z" });
  let auth = buildAuthority(ch, [grant]);
  assert.equal(auth.holdsCapability(O, "role:officer", GUILD), false, "not effective with one founder");

  // B co-signs the grant → 2 founders. But role:officer also needs the grantee to accept.
  const bAccept = await vr(B, { type: "org.buildguild.acceptance", subject: grant._ref, createdAt: "2026-01-02T00:00:00Z" });
  auth = buildAuthority(ch, [grant, bAccept]);
  assert.equal(auth.holdsCapability(O, "role:officer", GUILD), false, "still needs grantee acceptance");

  const oAccept = await vr(O, { type: "org.buildguild.acceptance", subject: grant._ref, createdAt: "2026-01-03T00:00:00Z" });
  auth = buildAuthority(ch, [grant, bAccept, oAccept]);
  assert.equal(auth.holdsCapability(O, "role:officer", GUILD), true, "effective: 2 founders + grantee consent");
});

test("attenuated chain + authority revocation cascades", async () => {
  const A = await actor("did:f:A2"), B = await actor("did:f:B2"), C = await actor("did:f:C2");
  const O = await actor("did:p:off2"), M = await actor("did:p:mem2");
  const ch = charter([A, B, C], 2);

  const grantO = await vr(A, { type: "org.buildguild.designation", grantee: O, mode: "delegate", capability: "role:officer", scope: GUILD, createdAt: "2026-01-01T00:00:00Z" });
  const bAcc = await vr(B, { type: "org.buildguild.acceptance", subject: grantO._ref, createdAt: "2026-01-02T00:00:00Z" });
  const oAcc = await vr(O, { type: "org.buildguild.acceptance", subject: grantO._ref, createdAt: "2026-01-03T00:00:00Z" });

  // Officer O admits member M (non-root grant; O can admit). M accepts.
  const grantM = await vr(O, { type: "org.buildguild.designation", grantee: M, mode: "delegate", capability: "role:member", scope: GUILD, createdAt: "2026-01-04T00:00:00Z" });
  const mAcc = await vr(M, { type: "org.buildguild.acceptance", subject: grantM._ref, createdAt: "2026-01-05T00:00:00Z" });

  let auth = buildAuthority(ch, [grantO, bAcc, oAcc, grantM, mAcc]);
  assert.ok(auth.members(GUILD).includes(M), "M is a member via the officer's grant");

  // Founder C revokes O's officership → O loses authority → M's membership cascades away.
  const revoke = await vr(C, { type: "org.buildguild.revocation", target: grantO._ref, createdAt: "2026-01-06T00:00:00Z" });
  auth = buildAuthority(ch, [grantO, bAcc, oAcc, grantM, mAcc, revoke]);
  assert.equal(auth.holdsCapability(O, "role:officer", GUILD), false, "officer revoked");
  assert.equal(auth.members(GUILD).includes(M), false, "member admitted by the revoked officer cascades away");
});

test("trust designation: no grantee acceptance required, collective root applies", async () => {
  const A = await actor("did:f:A3"), B = await actor("did:f:B3");
  const W = await actor("did:svc:witness");
  const ch = charter([A, B], 2);

  const grant = await vr(A, { type: "org.buildguild.designation", grantee: W, mode: "trust", capability: "delivery.witness", scope: GUILD, createdAt: "2026-01-01T00:00:00Z" });
  let auth = buildAuthority(ch, [grant]);
  assert.equal(auth.trustees("delivery.witness", GUILD).includes(W), false, "needs both founders");

  const bAcc = await vr(B, { type: "org.buildguild.acceptance", subject: grant._ref, createdAt: "2026-01-02T00:00:00Z" });
  auth = buildAuthority(ch, [grant, bAcc]);
  assert.ok(auth.trustees("delivery.witness", GUILD).includes(W), "trusted once root threshold met (no grantee accept needed)");
});
