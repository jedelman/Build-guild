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
// Causality is STRUCTURAL: a proposal `basis`-names the head it builds on (default
// "genesis") and may target/supersede a prior act; a vote pins the head it saw. No
// closesAt and NO clock participates in sequencing — createdAt is advisory only.
// `ref` is a proposal's _ref string.
const prop = (a, action, enacts, basis = "genesis") => vr(a, { type: "org.buildguild.proposal", guild: GUILD, action, enacts, basis });
const vote = (a, ref, v, basis = "genesis") => vr(a, { type: "org.buildguild.attestation", guild: GUILD, contract: "vote", subject: ref, value: v, basis });

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
  // A causal chain: admit Z → remove R → grant C → recall C (recall targets the grant).
  const p1 = await prop(A, "admit", { grantee: Z }); recs.push(p1, await vote(A, p1._ref, "yes"), await vote(B, p1._ref, "yes"));
  const p2 = await prop(A, "remove", { grantee: R }, p1._ref); recs.push(p2, await vote(A, p2._ref, "yes", p1._ref), await vote(B, p2._ref, "yes", p1._ref), await vote(C, p2._ref, "yes", p1._ref));
  const p3 = await prop(B, "grant_mandate", { grantee: C, capability: "admit", scope: GUILD }, p2._ref); recs.push(p3, await vote(A, p3._ref, "yes", p2._ref), await vote(B, p3._ref, "yes", p2._ref));
  const p4 = await prop(A, "recall", { grantee: C, capability: "admit", scope: GUILD, target: p3._ref }, p2._ref); recs.push(p4, await vote(A, p4._ref, "yes", p2._ref));

  const base = snap(deriveCollective(ch, recs));
  for (let i = 0; i < 50; i++) assert.equal(snap(deriveCollective(ch, shuffle(recs))), base, "state must not depend on order");
});

test("a member removed mid-stream cannot vote on later proposals", async () => {
  const A = await actor("did:m:A2"), B = await actor("did:m:B2"), V = await actor("did:m:V2");
  const ch = charter([A, B, V]);
  const p1 = await prop(A, "remove", { grantee: V });
  const p2 = await prop(A, "admit", { grantee: "did:m:new" }, p1._ref); // built on the post-removal head
  const recs = [p1, await vote(A, p1._ref, "yes"), await vote(B, p1._ref, "yes"),
    p2, await vote(A, p2._ref, "yes", p1._ref), await vote(V, p2._ref, "yes", p1._ref)];
  const c = deriveCollective(ch, recs);
  assert.equal(c.isMember(V), false, "V removed");
  assert.equal(c.proposals[p2._ref].tally.cast, 1, "V's later vote is ignored");
  assert.equal(c.proposals[p2._ref].tally.eligible, 2, "electorate shrank to {A,B}");
});

test("same-tick grant + recall resolve deterministically (ref tiebreak)", async () => {
  const A = await actor("did:m:A3"), B = await actor("did:m:B3"), C = await actor("did:m:C3");
  const ch = charter([A, B, C]);
  // No causal edge between them (the recall does not target the grant) → genuinely
  // CONCURRENT, resolved by ref tiebreak, not a clock.
  const g = await prop(A, "grant_mandate", { grantee: C, capability: "arb", scope: GUILD });
  const r = await prop(A, "recall", { grantee: C, capability: "arb", scope: GUILD });
  const recs = [g, await vote(A, g._ref, "yes"), await vote(B, g._ref, "yes"),
    r, await vote(A, r._ref, "yes")];
  const base = snap(deriveCollective(ch, recs));
  for (let i = 0; i < 30; i++) assert.equal(snap(deriveCollective(ch, shuffle(recs))), base, "same-tick must be deterministic");
});

test("equivocation: yes+no on one proposal voids that voter", async () => {
  const A = await actor("did:m:A4"), B = await actor("did:m:B4");
  const ch = charter([A, B]);
  const p = await prop(A, "admit", { grantee: "did:m:q" });
  const c = deriveCollective(ch, [p, await vote(A, p._ref, "yes"), await vote(B, p._ref, "yes"), await vote(B, p._ref, "no")]);
  assert.equal(c.proposals[p._ref].tally.cast, 1, "B equivocated → voided; only A counts");
});

test("grant → recall → re-grant ends granted", async () => {
  const A = await actor("did:m:A5"), B = await actor("did:m:B5"), C = await actor("did:m:C5");
  const ch = charter([A, B, C]);
  // Causal chain via explicit edges: recall targets g1; re-grant supersedes the recall.
  // Order is forced by references, not by T(1)<T(2)<T(3).
  const g1 = await prop(A, "grant_mandate", { grantee: C, capability: "admit", scope: GUILD });
  const rc = await prop(A, "recall", { grantee: C, capability: "admit", scope: GUILD, target: g1._ref });
  const g2 = await prop(A, "grant_mandate", { grantee: C, capability: "admit", scope: GUILD, supersedes: rc._ref });
  const recs = [
    g1, await vote(A, g1._ref, "yes"), await vote(B, g1._ref, "yes"),
    rc, await vote(A, rc._ref, "yes"),
    g2, await vote(A, g2._ref, "yes"), await vote(B, g2._ref, "yes"),
  ];
  assert.equal(deriveCollective(ch, recs).holdsCapability(C, "admit", GUILD), true, "re-grant after recall holds");
});
