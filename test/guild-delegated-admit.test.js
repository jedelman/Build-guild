// Delegated admit: a member granted an `admit` MANDATE by vote can admit newcomers
// DIRECTLY (a role:member designation the newcomer accepts) — no per-admit vote — and the
// grant stays revocable and auditable. Authority is the recallable mandate, not a founder.
import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeypair, signRecord, verifyRecords } from "../src/governance.js";
import { deriveGuild } from "../src/guild.js";

const keyring = new Map(), secrets = new Map();
async function actor(did) {
  const { publicKey, privateKey } = await generateKeypair();
  keyring.set(did, publicKey); secrets.set(did, privateKey); return did;
}
const resolveKey = (did) => keyring.get(did) || null;
const vr = async (did, rec) => (await verifyRecords([await signRecord({ ...rec, author: did }, secrets.get(did))], resolveKey))[0];
const GUILD = "did:guild:deleg";

const mkCharter = (genesis, memberCan = []) => vr(genesis[0], {
  type: "org.buildguild.charter", guild: GUILD, version: 1, prose: "delegated admit",
  rules: { genesis, roles: { member: { can: memberCan } }, vote: { admit: { threshold: 50, quorum: 50 }, grant_mandate: { threshold: 50, quorum: 50 }, recall: { threshold: 34, quorum: 25 }, default: { threshold: 50, quorum: 50 } } },
  createdAt: "2026-06-01T00:00:00Z",
});
const prop = (a, action, enacts, basis) => vr(a, { type: "org.buildguild.proposal", guild: GUILD, action, enacts, basis });
const vote = (a, ref, v, basis) => vr(a, { type: "org.buildguild.attestation", guild: GUILD, contract: "vote", subject: ref, value: v, basis });
const designate = (a, grantee, capability, scope = GUILD, mode = "delegate") => vr(a, { type: "org.buildguild.designation", guild: GUILD, grantee, capability, scope, mode });
const accept = (a, subject) => vr(a, { type: "org.buildguild.acceptance", guild: GUILD, subject });
const revoke = (a, target) => vr(a, { type: "org.buildguild.revocation", guild: GUILD, target });
const shuffle = (arr) => { const x = [...arr]; for (let i = x.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [x[i], x[j]] = [x[j], x[i]]; } return x; };

// Grant R an admit mandate by vote, returning the records + R's holder did.
async function mandateAdmit(ch, A, B, R) {
  const g = await prop(A, "grant_mandate", { grantee: R, capability: "admit", scope: GUILD }, ch._ref);
  return [g, await vote(A, g._ref, "yes", ch._ref), await vote(B, g._ref, "yes", ch._ref)];
}

test("a mandate-holder admits directly — newcomer accepts, becomes a member, NO vote on them", async () => {
  const A = await actor("did:d:A"), B = await actor("did:d:B"), R = await actor("did:d:R"), N = await actor("did:d:N");
  const ch = await mkCharter([A, B]);
  const recs = [...await mandateAdmit(ch, A, B, R)];

  let c = deriveGuild(ch, recs);
  assert.equal(c.holdsCapability(R, "admit", GUILD), true, "R holds the admit mandate by vote");
  assert.equal(c.isMember(N), false, "N not yet admitted");

  // R issues a role:member designation for N; N co-signs. No proposal/vote about N exists.
  const dN = await designate(R, N, "role:member");
  recs.push(dN, await accept(N, dN._ref));
  c = deriveGuild(ch, recs);
  assert.equal(c.isMember(N), true, "N admitted by delegation, no vote required");
  assert.deepEqual(c.delegatedAdmits, [{ grantee: N, via: dN._ref, by: R }], "admit is attributable to R, walkable to dN");
  assert.equal(c.members.includes(N), true);
  // sanity: nobody opened a proposal to admit N
  assert.equal(Object.values(c.proposals).some((p) => p.action === "admit"), false);
});

test("an UNmandated member cannot delegated-admit", async () => {
  const A = await actor("did:d:A2"), B = await actor("did:d:B2"), N = await actor("did:d:N2");
  const ch = await mkCharter([A, B]); // member role has NO admit capability, A holds no mandate
  const dN = await designate(A, N, "role:member");
  const c = deriveGuild(ch, [dN, await accept(N, dN._ref)]);
  assert.equal(c.isMember(N), false, "a bare member can't admit without a mandate or open admission");
});

test("a delegated admit needs the newcomer's acceptance", async () => {
  const A = await actor("did:d:A3"), B = await actor("did:d:B3"), R = await actor("did:d:R3"), N = await actor("did:d:N3");
  const ch = await mkCharter([A, B]);
  const recs = [...await mandateAdmit(ch, A, B, R), await designate(R, N, "role:member")]; // no acceptance
  assert.equal(deriveGuild(ch, recs).isMember(N), false, "unaccepted role grant doesn't take effect");
});

test("revoking the delegated admit drops the member (cross-repo, by an admit-capable author)", async () => {
  const A = await actor("did:d:A4"), B = await actor("did:d:B4"), R = await actor("did:d:R4"), N = await actor("did:d:N4");
  const ch = await mkCharter([A, B]);
  const recs = [...await mandateAdmit(ch, A, B, R)];
  const dN = await designate(R, N, "role:member");
  recs.push(dN, await accept(N, dN._ref));
  assert.equal(deriveGuild(ch, recs).isMember(N), true);

  recs.push(await revoke(R, dN._ref)); // grantor withdraws
  assert.equal(deriveGuild(ch, recs).isMember(N), false, "revocation drops the delegated member");
});

test("open admission: charter member.can=['admit'] lets any member admit directly", async () => {
  const A = await actor("did:d:A5"), B = await actor("did:d:B5"), N = await actor("did:d:N5");
  const ch = await mkCharter([A, B], ["admit"]); // member role may admit → open admission
  const dN = await designate(A, N, "role:member"); // A is a bare genesis member, no mandate
  const c = deriveGuild(ch, [dN, await accept(N, dN._ref)]);
  assert.equal(c.isMember(N), true, "any member admits under open admission");
});

test("delegated chain: a mandate-holder admits N, N (re-mandated) admits P; order-independent", async () => {
  const A = await actor("did:d:A6"), B = await actor("did:d:B6"), R = await actor("did:d:R6"), N = await actor("did:d:N6"), P = await actor("did:d:P6");
  const ch = await mkCharter([A, B]);
  const recs = [...await mandateAdmit(ch, A, B, R)];
  const dN = await designate(R, N, "role:member");
  recs.push(dN, await accept(N, dN._ref));
  // grant N an admit mandate too (by vote), then N admits P by delegation
  const gN = await prop(A, "grant_mandate", { grantee: N, capability: "admit", scope: GUILD }, ch._ref);
  recs.push(gN, await vote(A, gN._ref, "yes", ch._ref), await vote(B, gN._ref, "yes", ch._ref));
  const dP = await designate(N, P, "role:member");
  recs.push(dP, await accept(P, dP._ref));

  const base = deriveGuild(ch, recs);
  assert.deepEqual(base.members, [A, B, N, P].sort(), "R mandated, N & P admitted by delegation chain");
  for (let i = 0; i < 20; i++) assert.deepEqual(deriveGuild(ch, shuffle(recs)).members, base.members, "fixpoint is order-independent");
});
