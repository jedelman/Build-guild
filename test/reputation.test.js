// Feasibility proof for the reputation layer (src/governance.js).
// Reputation = eligibility-gated COUNTS of co-signed attestations, never a score.
// Proves: only attesters with provable standing are counted (Sybil resistance),
// ternary yes/no/unknown aggregates across contexts (contested = visible),
// self-attestation is rejected, conflicting attestations are voided, "skills are
// contracts," counts derive from signed events, and tallies are deterministic.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  canonicalize,
  generateKeypair,
  signRecord,
  verifyRecords,
  tallyBadges,
  observe,
  buildContext,
  isEligible,
} from "../src/governance.js";

const keyring = new Map();
const secrets = new Map();
async function actor(did) {
  const { publicKey, privateKey } = await generateKeypair();
  keyring.set(did, publicKey);
  secrets.set(did, privateKey);
  return did;
}
const resolveKey = (did) => keyring.get(did) || null;
const sign = (did, rec) => signRecord({ ...rec }, secrets.get(did));

// Ontology of contracts (predicates) with eligibility rules.
const CONTRACTS = {
  "attest.delivered-on-time": { id: "attest.delivered-on-time", subjectType: "guild", eligibility: { rule: "patron_of_quest" } },
  "attest.splits-fairly": { id: "attest.splits-fairly", subjectType: "guild", eligibility: { rule: "party_of_quest" } },
  "attest.pays-promptly": { id: "attest.pays-promptly", subjectType: "client", eligibility: { rule: "party_of_quest" } },
  "skill.rust": { id: "skill.rust", subjectType: "builder", eligibility: { rule: "anyone" } },
};

const attestation = (attester, subject, contract, value, context, createdAt = "2026-05-01T00:00:00Z") => ({
  type: "org.buildguild.attestation",
  attester,
  subject,
  contract,
  value,
  context,
  createdAt,
  nonce: Math.random().toString(36).slice(2),
});

const shuffle = (arr) => {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

test("eligibility-gated counts: a Sybil mob cannot inflate a badge", async () => {
  const client = await actor("did:ex:client");
  const guild = await actor("did:ex:guild-G");
  const alice = await actor("did:ex:alice");
  const bob = await actor("did:ex:bob");
  const ctx = { quests: { "quest:1": { patron: client, guild, party: [alice, bob] } }, guildMembers: {} };

  const records = [
    // eligible: the quest's patron attests delivery
    attestation(client, guild, "attest.delivered-on-time", "yes", { quest: "quest:1" }),
    // eligible: a party member attests fairness of the split
    attestation(alice, guild, "attest.splits-fairly", "yes", { quest: "quest:1" }),
  ];
  // 25 Sybils try to farm delivered-on-time about the guild (none are the patron)
  for (let i = 0; i < 25; i++) {
    const s = await actor(`did:ex:sybil-${i}`);
    records.push(attestation(s, guild, "attest.delivered-on-time", "yes", { quest: "quest:1" }));
  }
  const verified = await verifyRecords(await Promise.all(records.map((r) => sign(r.attester, r))), resolveKey);
  const { badges } = tallyBadges(guild, verified, CONTRACTS, ctx, { subjectType: "guild" });

  assert.deepEqual(badges["attest.delivered-on-time"], { yes: 1, no: 0, unknown: 0, attesters: 1 });
  assert.deepEqual(badges["attest.splits-fairly"], { yes: 1, no: 0, unknown: 0, attesters: 1 });
});

test("self-attestation is rejected", async () => {
  const guild = await actor("did:ex:guild-self");
  const ctx = { quests: { "quest:9": { patron: guild, guild, party: [guild] } } };
  const rec = await sign(guild, attestation(guild, guild, "attest.delivered-on-time", "yes", { quest: "quest:9" }));
  const verified = await verifyRecords([rec], resolveKey);
  const { badges } = tallyBadges(guild, verified, CONTRACTS, ctx, { subjectType: "guild" });
  assert.equal(Object.keys(badges).length, 0);
  assert.equal(isEligible(guild, JSON.parse(JSON.stringify(rec)), CONTRACTS["attest.delivered-on-time"], ctx), false);
});

test("ternary aggregates across contexts: contested delivery shows yes AND no", async () => {
  const guild = await actor("did:ex:guild-H");
  const c1 = await actor("did:ex:c1");
  const c2 = await actor("did:ex:c2");
  const ctx = {
    quests: {
      "quest:a": { patron: c1, guild, party: [] },
      "quest:b": { patron: c2, guild, party: [] },
    },
  };
  const recs = await Promise.all([
    sign(c1, attestation(c1, guild, "attest.delivered-on-time", "yes", { quest: "quest:a" })),
    sign(c2, attestation(c2, guild, "attest.delivered-on-time", "no", { quest: "quest:b" })),
  ]);
  const verified = await verifyRecords(recs, resolveKey);
  const { badges } = tallyBadges(guild, verified, CONTRACTS, ctx, { subjectType: "guild" });
  assert.deepEqual(badges["attest.delivered-on-time"], { yes: 1, no: 1, unknown: 0, attesters: 2 });
});

test("conflicting attestations from one attester in one context are voided", async () => {
  const guild = await actor("did:ex:guild-K");
  const client = await actor("did:ex:client-K");
  const ctx = { quests: { "quest:z": { patron: client, guild, party: [] } } };
  const recs = await Promise.all([
    sign(client, attestation(client, guild, "attest.delivered-on-time", "yes", { quest: "quest:z" })),
    sign(client, attestation(client, guild, "attest.delivered-on-time", "no", { quest: "quest:z" })),
  ]);
  const verified = await verifyRecords(recs, resolveKey);
  const { badges, conflicts } = tallyBadges(guild, verified, CONTRACTS, ctx, { subjectType: "guild" });
  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0].type, "conflicting_attestation");
  assert.equal(badges["attest.delivered-on-time"], undefined); // the only slot was voided
});

test("clients accrue reputation too (symmetric): party attests pays-promptly", async () => {
  const guild = await actor("did:ex:guild-P");
  const client = await actor("did:ex:client-P");
  const alice = await actor("did:ex:alice-P");
  const ctx = { quests: { "quest:p": { patron: client, guild, party: [alice] } } };
  // A party member attests about the CLIENT's payment behavior.
  const rec = await sign(alice, attestation(alice, client, "attest.pays-promptly", "yes", { quest: "quest:p" }));
  const verified = await verifyRecords([rec], resolveKey);
  const { badges } = tallyBadges(client, verified, CONTRACTS, ctx, { subjectType: "client" });
  assert.deepEqual(badges["attest.pays-promptly"], { yes: 1, no: 0, unknown: 0, attesters: 1 });
});

test("skills are just contracts: an endorsement is a `yes` on skill.rust", async () => {
  const alice = await actor("did:ex:alice-rust");
  const bob = await actor("did:ex:bob-rust");
  const carol = await actor("did:ex:carol-rust");
  const recs = await Promise.all([
    sign(bob, attestation(bob, alice, "skill.rust", "yes", null)),
    sign(carol, attestation(carol, alice, "skill.rust", "yes", null)),
    sign(alice, attestation(alice, alice, "skill.rust", "yes", null)), // self → dropped
  ]);
  const verified = await verifyRecords(recs, resolveKey);
  const { badges } = tallyBadges(alice, verified, CONTRACTS, {}, { subjectType: "builder" });
  assert.deepEqual(badges["skill.rust"], { yes: 2, no: 0, unknown: 0, attesters: 2 });
});

test("counts derive from signed events: buildContext gates eligibility end-to-end", async () => {
  const client = await actor("did:ex:client-E");
  const guild = await actor("did:ex:guild-E");
  // A patron-signed quest record establishes the eligibility context.
  const questRec = await sign(client, {
    type: "org.buildguild.event",
    kind: "quest",
    author: client,
    body: { guild, party: [], title: "Chart the northern API" },
    createdAt: "2026-05-02T00:00:00Z",
  });
  const [vq] = await verifyRecords([questRec], resolveKey);
  const ctx = buildContext([vq]);
  const qref = vq._ref;

  const stranger = await actor("did:ex:stranger-E");
  const recs = await verifyRecords(
    await Promise.all([
      sign(client, attestation(client, guild, "attest.delivered-on-time", "yes", { quest: qref })),
      sign(stranger, attestation(stranger, guild, "attest.delivered-on-time", "yes", { quest: qref })),
    ]),
    resolveKey
  );
  const { badges } = tallyBadges(guild, recs, CONTRACTS, ctx, { subjectType: "guild" });
  assert.deepEqual(badges["attest.delivered-on-time"], { yes: 1, no: 0, unknown: 0, attesters: 1 });
});

test("observe emits the eligible, timestamped fact stream (consumers bring the algorithm)", async () => {
  const client = await actor("did:ex:client-O");
  const guild = await actor("did:ex:guild-O");
  const sybil = await actor("did:ex:sybil-O");
  const ctx = { quests: { "quest:o": { patron: client, guild, party: [] } } };
  const recs = await verifyRecords(
    await Promise.all([
      sign(client, attestation(client, guild, "attest.delivered-on-time", "yes", { quest: "quest:o" }, "2026-05-01T00:00:00Z")),
      sign(sybil, attestation(sybil, guild, "attest.delivered-on-time", "yes", { quest: "quest:o" }, "2026-05-02T00:00:00Z")),
    ]),
    resolveKey
  );
  const facts = observe(guild, recs, CONTRACTS, ctx, { subjectType: "guild" });
  assert.equal(facts.length, 1); // the sybil has no standing → not an admissible fact
  assert.equal(facts[0].attester, client);
  assert.equal(facts[0].value, "yes");
  assert.ok(facts[0].at, "timestamp preserved → decay/weighting deferred to the consumer");
});

test("badge tally is deterministic + order-independent", async () => {
  const guild = await actor("did:ex:guild-D");
  const ctx = { quests: {} };
  const recs = [];
  for (let i = 0; i < 6; i++) {
    const a = await actor(`did:ex:end-${i}`);
    recs.push(await sign(a, attestation(a, guild, "skill.rust", i % 3 === 0 ? "no" : "yes", null)));
  }
  const verified = await verifyRecords(recs, resolveKey);
  // skill.rust uses the "anyone" rule; omit the subjectType filter here so the
  // contract applies, and assert the shuffled tally is byte-identical.
  const c1 = tallyBadges(guild, verified, CONTRACTS, ctx);
  const c2 = tallyBadges(guild, shuffle(verified), CONTRACTS, ctx);
  assert.equal(canonicalize(c1), canonicalize(c2));
  assert.deepEqual(c1.badges["skill.rust"], { yes: 4, no: 2, unknown: 0, attesters: 6 });
});
