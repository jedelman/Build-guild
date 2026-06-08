// Membership use cases (notes/membership-use-cases.md): self-join/leave, recruit-follows-
// charter, and custom charters — all derived from signed claims via deriveGuild, the SAME
// engine the Worker verifies with. Pure + offline, like guild-delegated-admit.test.js.
import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeypair, signRecord, verifyRecords } from "../src/governance.js";
import { deriveGuild } from "../src/guild.js";
import { DEFAULT_RULES, defaultCharter } from "../src/charter.js";
import { admitPath } from "../src/membership.js";

const GUILD = "did:guild:uc";
const keyring = new Map(), secrets = new Map();
async function actor(did) {
  const { publicKey, privateKey } = await generateKeypair();
  keyring.set(did, publicKey); secrets.set(did, privateKey); return did;
}
const resolveKey = (did) => keyring.get(did) || null;
const vr = async (did, rec) => (await verifyRecords([await signRecord({ ...rec, author: did }, secrets.get(did))], resolveKey))[0];

const closed = (genesis, patch = {}) => { const r = DEFAULT_RULES(genesis); r.membership = { ...r.membership, openJoin: false, ...patch }; return r; };
const charter = (genesis, rules) => vr(genesis[0], {
  type: "org.buildguild.charter", guild: GUILD, version: 1, prose: "uc",
  rules: rules || DEFAULT_RULES(genesis), createdAt: "2026-06-01T00:00:00Z",
});
const designate = (a, grantee, capability = "role:member", scope = GUILD) =>
  vr(a, { type: "org.buildguild.designation", guild: GUILD, grantee, capability, scope, mode: "delegate" });
const accept = (a, subject) => vr(a, { type: "org.buildguild.acceptance", guild: GUILD, subject });
const revoke = (a, target) => vr(a, { type: "org.buildguild.revocation", guild: GUILD, target });
const propose = (a, action, enacts, basis) => vr(a, { type: "org.buildguild.proposal", guild: GUILD, action, enacts, basis });
const vote = (a, ref, v, basis) => vr(a, { type: "org.buildguild.attestation", guild: GUILD, contract: "vote", subject: ref, value: v, basis });

// ---- UC1: self-join / leave ------------------------------------------------

test("UC1: anyone self-joins an OPEN guild with a self-signed grant — no acceptance needed", async () => {
  const A = await actor("uc:A"), N = await actor("uc:N");
  const ch = await charter([A]); // DEFAULT_RULES → openJoin true
  const c = deriveGuild(ch, [await designate(N, N)]); // N grants N role:member
  assert.equal(c.isMember(N), true, "open self-join admits");
  assert.equal(c.isMember(A), true, "genesis stays a member");
  assert.deepEqual(c.delegatedAdmits, [], "a self-join is not a delegated admit");
});

test("UC1: a CLOSED guild refuses a self-join", async () => {
  const A = await actor("uc:A2"), N = await actor("uc:N2");
  const ch = await charter([A], closed([A]));
  assert.equal(deriveGuild(ch, [await designate(N, N)]).isMember(N), false, "self-grant can't enter a closed guild");
});

test("UC1: leaving — a self-revocation drops the self-joined member", async () => {
  const A = await actor("uc:A3"), N = await actor("uc:N3");
  const ch = await charter([A]);
  const self = await designate(N, N);
  assert.equal(deriveGuild(ch, [self]).isMember(N), true);
  assert.equal(deriveGuild(ch, [self, await revoke(N, self._ref)]).isMember(N), false, "self-revoke = leave");
});

// ---- UC2: recruit follows the charter --------------------------------------

test("UC2: open-admission charter — a member recruits directly; the recruit co-signs to join", async () => {
  const A = await actor("uc:A4"), N = await actor("uc:N4");
  const rules = closed([A], {}); rules.roles = { member: { can: ["propose", "vote", "admit"] } };
  const ch = await charter([A], rules);
  assert.equal(admitPath(ch, deriveGuild(ch, []), A, N), "grant", "A may admit directly");

  const grant = await designate(A, N);
  assert.equal(deriveGuild(ch, [grant]).isMember(N), false, "an unaccepted grant is a PENDING invite, not membership");
  const c = deriveGuild(ch, [grant, await accept(N, grant._ref)]);
  assert.equal(c.isMember(N), true, "the recruit joins by co-signing");
  assert.deepEqual(c.delegatedAdmits, [{ grantee: N, via: grant._ref, by: A }], "attributable to the recruiter");
});

test("UC2: vote charter — a bare member can't grant directly; admission goes to a vote", async () => {
  const A = await actor("uc:A5"), B = await actor("uc:B5"), N = await actor("uc:N5");
  const ch = await charter([A, B], closed([A, B])); // no open admission, no mandates
  assert.equal(admitPath(ch, deriveGuild(ch, []), A, N), "propose", "a bare member opens an admit vote");

  const g = await designate(A, N);
  assert.equal(deriveGuild(ch, [g, await accept(N, g._ref)]).isMember(N), false, "a bare member's direct grant doesn't admit");

  const p = await propose(A, "admit", { grantee: N }, ch._ref);
  const recs = [p, await vote(A, p._ref, "yes", ch._ref), await vote(B, p._ref, "yes", ch._ref)];
  assert.equal(deriveGuild(ch, recs).isMember(N), true, "a passed admit vote admits N");
});

test("UC2: a non-member cannot recruit", async () => {
  const A = await actor("uc:A6"), X = await actor("uc:X6"), N = await actor("uc:N6");
  const ch = await charter([A], closed([A]));
  assert.equal(admitPath(ch, deriveGuild(ch, []), X, N), "denied", "X is not a member");
});

test("UC2/admitPath: an open guild routes a self to the self-join path", async () => {
  const A = await actor("uc:A8"), N = await actor("uc:N8");
  const ch = await charter([A]); // openJoin default true
  assert.equal(admitPath(ch, deriveGuild(ch, []), N, N), "self");
});

// ---- UC3: custom charter ----------------------------------------------------

test("UC3: custom charter vote bars take effect (admit needs 75%)", async () => {
  const A = await actor("uc:A7"), B = await actor("uc:B7"), C = await actor("uc:C7"), N = await actor("uc:N7");
  const rules = closed([A, B, C]); rules.vote = { ...rules.vote, admit: { threshold: 75, quorum: 50 } };
  const ch = await charter([A, B, C], rules);

  const p1 = await propose(A, "admit", { grantee: N }, ch._ref); // 2/3 yes = 66% < 75%
  const fail = [p1, await vote(A, p1._ref, "yes", ch._ref), await vote(B, p1._ref, "yes", ch._ref), await vote(C, p1._ref, "no", ch._ref)];
  assert.equal(deriveGuild(ch, fail).isMember(N), false, "66% < 75% threshold → not admitted");

  const p2 = await propose(A, "admit", { grantee: N }, ch._ref); // 3/3 yes = 100%
  const pass = [p2, await vote(A, p2._ref, "yes", ch._ref), await vote(B, p2._ref, "yes", ch._ref), await vote(C, p2._ref, "yes", ch._ref)];
  assert.equal(deriveGuild(ch, pass).isMember(N), true, "100% ≥ 75% → admitted");
});

test("UC3: defaultCharter() is an open-join, version-0 (synthesized) charter", () => {
  const c = defaultCharter("g1", ["did:x"]);
  assert.equal(c.rules.membership.openJoin, true);
  assert.equal(c.guild, "g1");
  assert.equal(c.version, 0, "0 marks a synthesized default (no signed charter adopted)");
  assert.deepEqual(c.rules.genesis, ["did:x"]);
});
