// Collective (founder-free) authority — genesis cohort, per-action microvotes,
// scoped recallable delegate-mandates, easy recall, and temporal electorate growth.
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

const GUILD = "did:guild:syndicate";
// No founder role. Genesis cohort = initial members. Per-action vote bars; recall is cheap.
const charter = (genesis) => ({
  type: "org.buildguild.charter", guild: GUILD, version: 1, prose: "No masters.",
  rules: {
    genesis,
    vote: {
      admit: { threshold: 50, quorum: 50 },
      grant_mandate: { threshold: 60, quorum: 50 },
      recall: { threshold: 34, quorum: 25 }, // recall is easy
      amend: { threshold: 75, quorum: 60 },
      default: { threshold: 50, quorum: 50 },
    },
  },
});

// Causality is structural, not temporal: a proposal names the head it `basis`-builds on
// (default "genesis"); a vote pins the head it was cast under. createdAt is advisory only.
const proposal = (author, action, enacts, n, basis = "genesis") => vr(author, {
  type: "org.buildguild.proposal", guild: GUILD, action, enacts, basis,
  createdAt: `2026-04-${String(n).padStart(2, "0")}T00:00:00Z`,
});
const vote = (author, propRef, value, n, basis = "genesis") => vr(author, {
  type: "org.buildguild.attestation", guild: GUILD, contract: "vote", subject: propRef, value, basis,
  createdAt: `2026-04-${String(n).padStart(2, "0")}T12:00:00Z`,
});

test("genesis cohort are members; nobody holds founder power", async () => {
  const A = await actor("did:m:a"), B = await actor("did:m:b");
  const c = deriveCollective(charter([A, B]), []);
  assert.deepEqual(c.members, [A, B].sort());
  assert.equal(c.holdsCapability(A, "role:member", GUILD), true);
  assert.equal(c.mandatesOf(A).length, 0, "no standing powers from founding");
});

test("admit by microvote, then the new member can vote (temporal electorate)", async () => {
  const A = await actor("did:m:a2"), B = await actor("did:m:b2"), C = await actor("did:m:c2"), D = await actor("did:m:d2");
  const ch = charter([A, B]);

  // Proposal 1: admit C. A & B vote yes (2/2 → passes).
  const p1 = await proposal(A, "admit", { grantee: C }, 1);
  const recs = [p1, await vote(A, p1._ref, "yes", 1), await vote(B, p1._ref, "yes", 1)];
  let c = deriveCollective(ch, recs);
  assert.ok(c.members.includes(C), "C admitted");

  // Proposal 2: admit D, built causally ON the admit-C head (p1). Now C is part of the
  // electorate and helps reach quorum; A & C vote under the post-admit head.
  const p2 = await proposal(A, "admit", { grantee: D }, 2, p1._ref);
  recs.push(p2, await vote(A, p2._ref, "yes", 2, p1._ref), await vote(C, p2._ref, "yes", 2, p1._ref));
  c = deriveCollective(ch, recs);
  assert.ok(c.members.includes(D), "D admitted with the once-new member C voting");
  assert.equal(c.proposals[p2._ref].tally.eligible, 3, "electorate had grown to 3 by P2");
});

test("officer = scoped delegate-mandate by vote; recall is cheap", async () => {
  const A = await actor("did:m:a3"), B = await actor("did:m:b3"), O = await actor("did:m:o3");
  const ch = charter([A, B, O]);

  // Grant O an 'admit' mandate scoped to the guild (needs 60% / quorum 50).
  const g = await proposal(A, "grant_mandate", { grantee: O, capability: "admit", scope: GUILD }, 1);
  let recs = [g, await vote(A, g._ref, "yes", 1), await vote(B, g._ref, "yes", 1)]; // 2/3 cast yes = 100% of cast, quorum 2/3
  let c = deriveCollective(ch, recs);
  assert.equal(c.holdsCapability(O, "admit", GUILD), true, "O holds the admit mandate");

  // Recall it — references the grant it cancels (causal edge), so it is ordered AFTER the
  // grant without any clock. Only ONE member need vote yes (threshold 34, quorum 25).
  const r = await proposal(A, "recall", { grantee: O, capability: "admit", scope: GUILD, target: g._ref }, 2);
  recs.push(r, await vote(A, r._ref, "yes", 2));
  c = deriveCollective(ch, recs);
  assert.equal(c.holdsCapability(O, "admit", GUILD), false, "mandate recalled at the low bar");
});

test("per-action bars: same votes pass an admit but fail a charter amendment", async () => {
  const A = await actor("did:m:a4"), B = await actor("did:m:b4"), C = await actor("did:m:c4"), D = await actor("did:m:d4");
  const ch = charter([A, B, C, D]);

  // 2 of 4 yes, 2 no → 50% of cast, full quorum.
  const admit = await proposal(A, "admit", { grantee: "did:m:new" }, 1);
  const adminRecs = [admit, await vote(A, admit._ref, "yes", 1), await vote(B, admit._ref, "yes", 1), await vote(C, admit._ref, "no", 1), await vote(D, admit._ref, "no", 1)];
  assert.equal(deriveCollective(ch, adminRecs).proposals[admit._ref].outcome, "passed", "admit passes at 50%");

  const amend = await proposal(A, "amend", { charter: "ref" }, 2);
  const amendRecs = [amend, await vote(A, amend._ref, "yes", 2), await vote(B, amend._ref, "yes", 2), await vote(C, amend._ref, "no", 2), await vote(D, amend._ref, "no", 2)];
  assert.equal(deriveCollective(ch, amendRecs).proposals[amend._ref].outcome, "rejected", "same split fails amend (needs 75%)");
});

test("a non-member's vote does not count", async () => {
  const A = await actor("did:m:a5"), B = await actor("did:m:b5"), OUT = await actor("did:m:out");
  const ch = charter([A, B]);
  const p = await proposal(A, "admit", { grantee: "did:m:x" }, 1);
  // A yes, OUTSIDER yes — OUT isn't a member, so only 1/2 cast → still 50%? A=yes (1 cast), quorum 1/2=50 ok, threshold 100%.
  const c = deriveCollective(ch, [p, await vote(A, p._ref, "yes", 1), await vote(OUT, p._ref, "yes", 1)]);
  assert.equal(c.proposals[p._ref].tally.cast, 1, "outsider vote ignored");
});
