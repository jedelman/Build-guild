// Charter amendment execution: a passed `amend` swaps the active rules for SUBSEQUENT
// proposals — self-amending (judged by the PRIOR charter's amend bar), order-independent,
// and clock-free. Covers inline rules, referenced-charter chaining, and that an amendment
// changing a bar actually binds the next vote.
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
const GUILD = "did:guild:amend";

// amend needs 75/60; admit needs 50/50.
const mkCharter = (genesis) => vr(genesis[0], {
  type: "org.buildguild.charter", guild: GUILD, version: 1, prose: "v1",
  rules: { genesis, vote: { admit: { threshold: 50, quorum: 50 }, amend: { threshold: 75, quorum: 60 }, default: { threshold: 50, quorum: 50 } } },
  createdAt: "2026-06-01T00:00:00Z",
});
const prop = (a, action, enacts, basis) => vr(a, { type: "org.buildguild.proposal", guild: GUILD, action, enacts, basis });
const vote = (a, ref, v, basis) => vr(a, { type: "org.buildguild.attestation", guild: GUILD, contract: "vote", subject: ref, value: v, basis });
const shuffle = (arr) => { const x = [...arr]; for (let i = x.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [x[i], x[j]] = [x[j], x[i]]; } return x; };

test("a passed amend raises the version and rebinds later proposals to the new rules", async () => {
  const A = await actor("did:a:A"), B = await actor("did:a:B"), C = await actor("did:a:C"), D = await actor("did:a:D");
  const ch = await mkCharter([A, B, C, D]); // 4 members

  // Amend: make admit STRICTER (unanimous: threshold 100, quorum 100). Inline new rules.
  const newRules = { vote: { admit: { threshold: 100, quorum: 100 }, amend: { threshold: 75, quorum: 60 }, default: { threshold: 50, quorum: 50 } } };
  const amend = await prop(A, "amend", { rules: newRules }, ch._ref);
  // 3 of 4 yes = 75% (meets amend's 75/60).
  const recs = [amend, await vote(A, amend._ref, "yes", ch._ref), await vote(B, amend._ref, "yes", ch._ref), await vote(C, amend._ref, "yes", ch._ref)];

  // An admit built causally ON the amend (basis → amend) so it is judged by v2. 3/4 yes
  // would PASS under v1 (50%) but must FAIL the amended unanimous rule.
  const adm = await prop(A, "admit", { grantee: "did:a:new" }, amend._ref);
  recs.push(adm, await vote(A, adm._ref, "yes", ch._ref), await vote(B, adm._ref, "yes", ch._ref), await vote(C, adm._ref, "yes", ch._ref));

  const c = deriveCollective(ch, recs);
  assert.equal(c.proposals[amend._ref].outcome, "passed", "amend passes at 75%");
  assert.equal(c.charterVersion, 2, "charter advanced to v2");
  assert.deepEqual(c.amendments.map((a) => a.version), [2]);
  assert.equal(c.proposals[adm._ref].rule.threshold, 100, "later admit is bound to the amended rule");
  assert.equal(c.proposals[adm._ref].outcome, "failed_quorum", "3/4 no longer suffices under the amendment");
  assert.equal(c.members.includes("did:a:new"), false, "so the admit does not take effect");
});

test("amend is judged by the PRIOR bar; an under-threshold amend is rejected and rules stand", async () => {
  const A = await actor("did:a:A2"), B = await actor("did:a:B2"), C = await actor("did:a:C2"), D = await actor("did:a:D2");
  const ch = await mkCharter([A, B, C, D]);
  const amend = await prop(A, "amend", { rules: { vote: { admit: { threshold: 10, quorum: 10 } } } }, ch._ref);
  // Full turnout (quorum met) but only 2 of 4 yes = 50% < amend's 75% threshold → rejected.
  const recs = [amend, await vote(A, amend._ref, "yes", ch._ref), await vote(B, amend._ref, "yes", ch._ref),
    await vote(C, amend._ref, "no", ch._ref), await vote(D, amend._ref, "no", ch._ref)];
  const c = deriveCollective(ch, recs);
  assert.equal(c.proposals[amend._ref].outcome, "rejected", "fails the 75% amend bar");
  assert.equal(c.charterVersion, 1, "rules unchanged");
  assert.deepEqual(c.amendments, []);
});

test("amend via a referenced charter record (chained by prev)", async () => {
  const A = await actor("did:a:A3"), B = await actor("did:a:B3"), C = await actor("did:a:C3"), D = await actor("did:a:D3");
  const ch = await mkCharter([A, B, C, D]);
  // A new charter v2 record, chained from v1.
  const v2 = await vr(A, { type: "org.buildguild.charter", guild: GUILD, version: 2, prev: ch._ref, prose: "v2",
    rules: { genesis: [A, B, C, D], vote: { admit: { threshold: 90, quorum: 90 }, amend: { threshold: 75, quorum: 60 }, default: { threshold: 50, quorum: 50 } } }, createdAt: "2026-06-02T00:00:00Z" });
  const amend = await prop(A, "amend", { charter: v2._ref }, ch._ref);
  const recs = [v2, amend, await vote(A, amend._ref, "yes", ch._ref), await vote(B, amend._ref, "yes", ch._ref), await vote(C, amend._ref, "yes", ch._ref)];
  const c = deriveCollective(ch, recs);
  assert.equal(c.proposals[amend._ref].outcome, "passed");
  assert.equal(c.charterVersion, 2);
  assert.equal(c.charterRef, v2._ref, "active charter is the referenced v2 record");
  assert.deepEqual(c.amendments, [{ ref: amend._ref, version: 2, charter: v2._ref }]);
});

test("amendment outcome is order-independent (20 shuffles)", async () => {
  const A = await actor("did:a:A4"), B = await actor("did:a:B4"), C = await actor("did:a:C4"), D = await actor("did:a:D4");
  const ch = await mkCharter([A, B, C, D]);
  const amend = await prop(A, "amend", { rules: { vote: { admit: { threshold: 100, quorum: 100 } } } }, ch._ref);
  const recs = [amend, await vote(A, amend._ref, "yes", ch._ref), await vote(B, amend._ref, "yes", ch._ref), await vote(C, amend._ref, "yes", ch._ref)];
  const base = JSON.stringify({ v: deriveCollective(ch, recs).charterVersion, o: deriveCollective(ch, recs).proposals[amend._ref].outcome });
  for (let i = 0; i < 20; i++) {
    const c = deriveCollective(ch, shuffle(recs));
    assert.equal(JSON.stringify({ v: c.charterVersion, o: c.proposals[amend._ref].outcome }), base);
  }
});
