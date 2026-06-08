// Anti-grief: live roster is correct but stallable — a griefer can churn the membership
// to reset everyone's `basis` and keep a vote from ever resolving. The charter guard is
// per-action `freeze`: a frozen proposal pins its electorate to the head it OPENED on, so
// its votes survive churn. These tests prove frozen is churn-IMMUNE (deterministic across
// shuffles) and that live pays the recast cost frozen avoids.
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
const GUILD = "did:guild:grief";

// grant_mandate is FROZEN (churn-immune); admit is LIVE (it is the churn).
const mkCharter = (genesis) => vr(genesis[0], {
  type: "org.buildguild.charter", guild: GUILD, version: 1, prose: "anti-grief",
  rules: { genesis, vote: { admit: { threshold: 50, quorum: 50 }, grant_mandate: { threshold: 50, quorum: 50, freeze: true }, default: { threshold: 50, quorum: 50 } } },
  createdAt: "2026-06-01T00:00:00Z",
});
const prop = (a, action, enacts, basis) => vr(a, { type: "org.buildguild.proposal", guild: GUILD, action, enacts, basis });
const vote = (a, ref, v, basis) => vr(a, { type: "org.buildguild.attestation", guild: GUILD, contract: "vote", subject: ref, value: v, basis });
const shuffle = (arr) => { const a = [...arr]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

test("freeze: a frozen proposal is immune to roster churn (deterministic across 30 shuffles)", async () => {
  const A = await actor("did:g:A"), B = await actor("did:g:B"), C = await actor("did:g:C"), D = await actor("did:g:D"), X = await actor("did:g:X");
  const ch = await mkCharter([A, B, C]); // genesis roster of 3

  // The griefer's churn: admit D (live), advancing the head.
  const pAdmit = await prop(A, "admit", { grantee: D }, ch._ref);
  // The victim: grant X a mandate, OPENED on the genesis head and voted there. Because the
  // action is frozen, this must resolve against the genesis roster no matter where the
  // admit lands in causal order.
  const pGrant = await prop(A, "grant_mandate", { grantee: X, capability: "arb", scope: GUILD }, ch._ref);
  const recs = [
    pAdmit, await vote(A, pAdmit._ref, "yes", ch._ref), await vote(B, pAdmit._ref, "yes", ch._ref),
    pGrant, await vote(A, pGrant._ref, "yes", ch._ref), await vote(B, pGrant._ref, "yes", ch._ref),
  ];

  const seen = new Set();
  for (let i = 0; i < 30; i++) {
    const c = deriveCollective(ch, shuffle(recs));
    seen.add(JSON.stringify(c.proposals[pGrant._ref].tally));
    assert.equal(c.proposals[pGrant._ref].outcome, "passed", "frozen grant always passes");
    assert.equal(c.proposals[pGrant._ref].basis, "frozen");
    assert.equal(c.holdsCapability(X, "arb", GUILD), true, "mandate holds despite churn");
    assert.ok(c.members.includes(D), "and the admit still went through");
  }
  assert.equal(seen.size, 1, "frozen tally is byte-identical regardless of churn order");
  // proof it used the OPEN-TIME roster (3), not the post-admit roster (4):
  assert.equal(JSON.parse([...seen][0]).eligible, 3, "electorate frozen to the genesis roster");
});

test("the live cost frozen avoids: a live vote staled by churn must be recast", async () => {
  // Default (live) charter: grant_mandate is NOT frozen.
  const A = await actor("did:g:A2"), B = await actor("did:g:B2"), D = await actor("did:g:D2"), X = await actor("did:g:X2");
  const ch = await vr(A, { type: "org.buildguild.charter", guild: GUILD, version: 1, prose: "live",
    rules: { genesis: [A, B], vote: { admit: { threshold: 50, quorum: 50 }, grant_mandate: { threshold: 50, quorum: 50 }, default: { threshold: 50, quorum: 50 } } }, createdAt: "2026-06-01T00:00:00Z" });

  // admit D passes and advances the head; a grant opens on the new head but its voters
  // cast under the stale genesis head (the realistic grief timing).
  const pAdmit = await prop(A, "admit", { grantee: D }, ch._ref);
  const pGrant = await prop(A, "grant_mandate", { grantee: X, capability: "arb", scope: GUILD }, pAdmit._ref);
  const stale = [
    pAdmit, await vote(A, pAdmit._ref, "yes", ch._ref), await vote(B, pAdmit._ref, "yes", ch._ref),
    pGrant, await vote(A, pGrant._ref, "yes", ch._ref), await vote(B, pGrant._ref, "yes", ch._ref), // basis = genesis (stale vs head pAdmit)
  ];

  // LIVE: the grant is judged at the post-admit head; genesis-pinned votes are stale → it fails.
  const live = deriveCollective(ch, stale);
  assert.equal(live.proposals[pGrant._ref].outcome, "failed_quorum", "live grant stalled by churn");
  assert.equal(live.proposals[pGrant._ref].tally.stale, 2, "both votes flagged stale by inspection");
  assert.equal(live.holdsCapability(X, "arb", GUILD), false);
  // recast under the new head → live grant now passes. (A frozen action would have needed
  // no recast — cf. the immunity test above.)
  const recast = [...stale, await vote(A, pGrant._ref, "yes", pAdmit._ref), await vote(B, pGrant._ref, "yes", pAdmit._ref)];
  assert.equal(deriveCollective(ch, recast).holdsCapability(X, "arb", GUILD), true, "live passes only after recast");
});
