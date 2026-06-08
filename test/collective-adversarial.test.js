// Adversarial replay: the founder-free collective is only safe if two verifiers
// reach BYTE-IDENTICAL state from the same claim set regardless of gossip order,
// even with removals mid-stream, same-tick grant/recall, equivocation, and re-grants.
import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeypair, signRecord, verifyRecords } from "../src/governance.js";
import { deriveCollective } from "../src/collective.js";

const keyring = new Map(), secrets = new Map();
async function actor(did) {
  const { publicKey, privateKey } = await generateKeypair();
  keyring.set(did, publicKey); secrets.set(did, privateKey); return did;
}
const resolveKey = (did) => keyring.get(did) || null;
const vr = async (did, rec) => (await verifyRecords([await signRecord({ ...rec, author: did }, secrets.get(did))], resolveKey))[0];

const GUILD = "did:guild:adv";
const charter = (genesis) => ({
  type: "org.buildguild.charter", guild: GUILD, version: 1, prose: "x",
  rules: { genesis, vote: { admit: { threshold: 50, quorum: 50 }, remove: { threshold: 50, quorum: 50 }, grant_mandate: { threshold: 50, quorum: 50 }, recall: { threshold: 34, quorum: 25 }, default: { threshold: 50, quorum: 50 } } },
});
// No closesAt → decided immediately (ordered by createdAt), so tests don't depend on
// the wall clock. `ref` is a proposal's _ref string.
const prop = (a, action, enacts, t) => vr(a, { type: "org.buildguild.proposal", guild: GUILD, action, enacts, createdAt: t });
const vote = (a, ref, v, t) => vr(a, { type: "org.buildguild.attestation", guild: GUILD, contract: "vote", subject: ref, value: v, createdAt: t });
const T = (n) => `2026-05-${String(n).padStart(2, "0")}T00:00:00Z`;

const shuffle = (arr) => { const a = [...arr]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const snap = (c) => JSON.stringify({
  members: c.members,
  mandates: c.mandates.map((m) => ({ g: m.grantee, c: m.capability, s: m.scope, m: m.mode })).sort((a, b) => (JSON.stringify(a) < JSON.stringify(b) ? -1 : 1)),
  props: Object.entries(c.proposals).sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([r, p]) => ({ r, a: p.action, o: p.outcome, t: p.tally })),
});

test("order-independence: shuffled gossip → byte-identical state (50 shuffles)", async () => {
  const A = await actor("did:m:Aa"), B = await actor("did:m:Bb"), C = await actor("did:m:Cc"), R = await actor("did:m:Rr"), Z = await actor("did:m:Zz");
  const ch = charter([A, B, C, R]);
  const recs = [];
  const p1 = await prop(A, "admit", { grantee: Z }, T(1)); recs.push(p1, await vote(A, p1._ref, "yes", T(1)), await vote(B, p1._ref, "yes", T(1)));
  const p2 = await prop(A, "remove", { grantee: R }, T(2)); recs.push(p2, await vote(A, p2._ref, "yes", T(2)), await vote(B, p2._ref, "yes", T(2)), await vote(C, p2._ref, "yes", T(2)));
  const p3 = await prop(B, "grant_mandate", { grantee: C, capability: "admit", scope: GUILD }, T(3)); recs.push(p3, await vote(A, p3._ref, "yes", T(3)), await vote(B, p3._ref, "yes", T(3)));
  const p4 = await prop(A, "recall", { grantee: C, capability: "admit", scope: GUILD }, T(4)); recs.push(p4, await vote(A, p4._ref, "yes", T(4)));

  const base = snap(deriveCollective(ch, recs));
  for (let i = 0; i < 50; i++) assert.equal(snap(deriveCollective(ch, shuffle(recs))), base, "state must not depend on order");
});

test("a member removed mid-stream cannot vote on later proposals", async () => {
  const A = await actor("did:m:A2"), B = await actor("did:m:B2"), V = await actor("did:m:V2");
  const ch = charter([A, B, V]);
  const p1 = await prop(A, "remove", { grantee: V }, T(1));
  const p2 = await prop(A, "admit", { grantee: "did:m:new" }, T(2));
  const recs = [p1, await vote(A, p1._ref, "yes", T(1)), await vote(B, p1._ref, "yes", T(1)),
    p2, await vote(A, p2._ref, "yes", T(2)), await vote(V, p2._ref, "yes", T(2))];
  const c = deriveCollective(ch, recs);
  assert.equal(c.isMember(V), false, "V removed");
  assert.equal(c.proposals[p2._ref].tally.cast, 1, "V's later vote is ignored");
  assert.equal(c.proposals[p2._ref].tally.eligible, 2, "electorate shrank to {A,B}");
});

test("same-tick grant + recall resolve deterministically (ref tiebreak)", async () => {
  const A = await actor("did:m:A3"), B = await actor("did:m:B3"), C = await actor("did:m:C3");
  const ch = charter([A, B, C]);
  const g = await prop(A, "grant_mandate", { grantee: C, capability: "arb", scope: GUILD }, T(5));
  const r = await prop(A, "recall", { grantee: C, capability: "arb", scope: GUILD }, T(5)); // SAME tick
  const recs = [g, await vote(A, g._ref, "yes", T(5)), await vote(B, g._ref, "yes", T(5)),
    r, await vote(A, r._ref, "yes", T(5))];
  const base = snap(deriveCollective(ch, recs));
  for (let i = 0; i < 30; i++) assert.equal(snap(deriveCollective(ch, shuffle(recs))), base, "same-tick must be deterministic");
});

test("equivocation: yes+no on one proposal voids that voter", async () => {
  const A = await actor("did:m:A4"), B = await actor("did:m:B4");
  const ch = charter([A, B]);
  const p = await prop(A, "admit", { grantee: "did:m:q" }, T(1));
  const c = deriveCollective(ch, [p, await vote(A, p._ref, "yes", T(1)), await vote(B, p._ref, "yes", T(1)), await vote(B, p._ref, "no", T(1))]);
  assert.equal(c.proposals[p._ref].tally.cast, 1, "B equivocated → voided; only A counts");
});

test("grant → recall → re-grant ends granted", async () => {
  const A = await actor("did:m:A5"), B = await actor("did:m:B5"), C = await actor("did:m:C5");
  const ch = charter([A, B, C]);
  const g1 = await prop(A, "grant_mandate", { grantee: C, capability: "admit", scope: GUILD }, T(1));
  const rc = await prop(A, "recall", { grantee: C, capability: "admit", scope: GUILD }, T(2));
  const g2 = await prop(A, "grant_mandate", { grantee: C, capability: "admit", scope: GUILD }, T(3));
  const recs = [
    g1, await vote(A, g1._ref, "yes", T(1)), await vote(B, g1._ref, "yes", T(1)),
    rc, await vote(A, rc._ref, "yes", T(2)),
    g2, await vote(A, g2._ref, "yes", T(3)), await vote(B, g2._ref, "yes", T(3)),
  ];
  assert.equal(deriveCollective(ch, recs).holdsCapability(C, "admit", GUILD), true, "re-grant after recall holds");
});
