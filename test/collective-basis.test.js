// Live-roster governance: a vote pins the membership HEAD it saw (basis); when the
// roster changes the head advances and old-basis votes are STALE by inspection and
// must be recast. Proves the user's property: no clock races — staleness is walkable.
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
const GUILD = "did:guild:basis";
const T = (n) => `2026-06-${String(n).padStart(2, "0")}T00:00:00Z`;

const mkCharter = (genesis) => vr(genesis[0], {
  type: "org.buildguild.charter", guild: GUILD, version: 1, prose: "live roster",
  rules: { genesis, vote: { admit: { threshold: 50, quorum: 50 }, grant_mandate: { threshold: 50, quorum: 50 }, default: { threshold: 50, quorum: 50 } } },
  createdAt: T(1),
});
const prop = (a, action, enacts, t) => vr(a, { type: "org.buildguild.proposal", guild: GUILD, action, enacts, createdAt: t });
const vote = (a, ref, val, basis, t) => vr(a, { type: "org.buildguild.attestation", guild: GUILD, contract: "vote", subject: ref, value: val, basis, createdAt: t });

const shuffle = (arr) => { const a = [...arr]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

test("a vote pinning a stale head does not count; recast under the new head does", async () => {
  const A = await actor("did:m:A"), B = await actor("did:m:B"), C = await actor("did:m:C"), X = await actor("did:m:X");
  const ch = await mkCharter([A, B]); // genesis head = charter cid

  // P1 admits C — A & B vote under the GENESIS head.
  const p1 = await prop(A, "admit", { grantee: C }, T(2));
  const recs = [p1, await vote(A, p1._ref, "yes", ch._ref, T(2)), await vote(B, p1._ref, "yes", ch._ref, T(2))];
  let c = deriveCollective(ch, recs);
  assert.ok(c.members.includes(C), "C admitted");
  assert.equal(c.head, p1._ref, "head advanced to the admit");

  // P2 grants X a mandate. Electorate is now {A,B,C}=3 (quorum 50 → need 2 votes).
  // A votes under the STALE genesis head; B votes under the new head p1.
  const p2 = await prop(A, "grant_mandate", { grantee: X, capability: "foo", scope: GUILD }, T(3));
  recs.push(p2, await vote(A, p2._ref, "yes", ch._ref, T(3)), await vote(B, p2._ref, "yes", p1._ref, T(3)));
  c = deriveCollective(ch, recs);
  assert.equal(c.proposals[p2._ref].tally.cast, 1, "only B's fresh vote counts");
  assert.equal(c.proposals[p2._ref].tally.stale, 1, "A's vote flagged stale");
  assert.ok(c.staleVotes.some((s) => s.voter === A && s.proposal === p2._ref), "stale vote is walkable by inspection");
  assert.equal(c.proposals[p2._ref].outcome, "failed_quorum", "stale vote can't make quorum");
  assert.equal(c.holdsCapability(X, "foo", GUILD), false);

  // A RECASTS under the current head p1 → now 2 fresh votes → passes.
  recs.push(await vote(A, p2._ref, "yes", p1._ref, T(4)));
  c = deriveCollective(ch, recs);
  assert.equal(c.proposals[p2._ref].tally.cast, 2, "recast counts");
  assert.equal(c.holdsCapability(X, "foo", GUILD), true, "mandate granted after recast");
});

test("basis staleness is order-independent (30 shuffles)", async () => {
  const A = await actor("did:m:A2"), B = await actor("did:m:B2"), C = await actor("did:m:C2"), X = await actor("did:m:X2");
  const ch = await mkCharter([A, B]);
  const p1 = await prop(A, "admit", { grantee: C }, T(2));
  const p2 = await prop(A, "grant_mandate", { grantee: X, capability: "foo", scope: GUILD }, T(3));
  const recs = [
    p1, await vote(A, p1._ref, "yes", ch._ref, T(2)), await vote(B, p1._ref, "yes", ch._ref, T(2)),
    p2, await vote(A, p2._ref, "yes", ch._ref, T(3)), await vote(B, p2._ref, "yes", p1._ref, T(3)),
  ];
  const base = JSON.stringify(deriveCollective(ch, recs).proposals[p2._ref].tally);
  for (let i = 0; i < 30; i++) assert.equal(JSON.stringify(deriveCollective(ch, shuffle(recs)).proposals[p2._ref].tally), base);
});
