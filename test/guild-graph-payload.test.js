// The /api/guilds/:id/graph payload is assembled by the PURE guildGraphFromRecords (the
// same function the offline sim uses). This locks the contract the debug view depends on:
// a `collective` summary (members, mandates, delegated admits, proposal outcomes) + the
// verified record `graph`, recomputed from signed claims alone.
import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeypair, signRecord, verifyRecords } from "../src/governance.js";
import { guildGraphFromRecords } from "../src/guild.js";

const keyring = new Map(), secrets = new Map();
async function actor(did) {
  const { publicKey, privateKey } = await generateKeypair();
  keyring.set(did, publicKey); secrets.set(did, privateKey); return did;
}
const resolveKey = (did) => keyring.get(did) || null;
const sign = async (did, rec) => signRecord({ ...rec, author: did }, secrets.get(did));
const GUILD = "did:guild:payload";

test("guildGraphFromRecords: live payload reflects votes + a delegated admit", async () => {
  const A = await actor("did:p:A"), B = await actor("did:p:B"), R = await actor("did:p:R"), N = await actor("did:p:N");
  // Build the signed claim set a guild would accumulate in gov_claims.
  const charter = await sign(A, { type: "org.buildguild.charter", guild: GUILD, version: 1, prose: "live wiring",
    rules: { genesis: [A, B], vote: { grant_mandate: { threshold: 50, quorum: 50 }, default: { threshold: 50, quorum: 50 } } }, createdAt: "2026-06-01T00:00:00Z" });
  const ch = (await verifyRecords([charter], resolveKey))[0];

  const g = await sign(A, { type: "org.buildguild.proposal", guild: GUILD, action: "grant_mandate", enacts: { grantee: R, capability: "admit", scope: GUILD }, basis: ch._ref });
  const gref = (await verifyRecords([g], resolveKey))[0]._ref;
  const vA = await sign(A, { type: "org.buildguild.attestation", guild: GUILD, contract: "vote", subject: gref, value: "yes", basis: ch._ref });
  const vB = await sign(B, { type: "org.buildguild.attestation", guild: GUILD, contract: "vote", subject: gref, value: "yes", basis: ch._ref });
  const dN = await sign(R, { type: "org.buildguild.designation", guild: GUILD, grantee: N, capability: "role:member", scope: GUILD, mode: "delegate" });
  const dref = (await verifyRecords([dN], resolveKey))[0]._ref;
  const aN = await sign(N, { type: "org.buildguild.acceptance", guild: GUILD, subject: dref });

  // Verify like govstore does on read, then assemble the payload.
  const records = await verifyRecords([charter, g, vA, vB, dN, aN], resolveKey);
  const payload = guildGraphFromRecords(records);

  assert.equal(payload.charter.version, 1);
  assert.deepEqual(payload.collective.members, [A, B, N].sort(), "N admitted by delegation appears in the live roster");
  assert.equal(payload.collective.mandates.some((m) => m.grantee === R && m.capability === "admit"), true, "R's admit mandate is live");
  assert.deepEqual(payload.collective.delegatedAdmits, [{ grantee: N, via: dref, by: R }], "delegated admit attributed + walkable");
  assert.equal(payload.collective.proposals.find((p) => p.ref === gref).outcome, "passed");
  // graph carries the basis chain + the role:member designation edge
  assert.equal(payload.graph.nodes.length, records.length, "every record is a node");
  assert.equal(payload.graph.edges.some((e) => e.rel === "basis"), true, "basis edges present");
  assert.equal(payload.graph.edges.some((e) => e.rel === "subject"), true, "vote→proposal edges present");
  assert.equal(payload.graph.edges.some((e) => e.to === dref && e.rel === "subject"), true, "acceptance→designation edge present");
});

test("guildGraphFromRecords: no charter → graph only, collective null (degrades cleanly)", async () => {
  const A = await actor("did:p:A2");
  const stray = await sign(A, { type: "org.buildguild.proposal", guild: GUILD, action: "admit", enacts: { grantee: "did:p:x" } });
  const records = await verifyRecords([stray], resolveKey);
  const payload = guildGraphFromRecords(records);
  assert.equal(payload.collective, null, "no charter → no derived authority");
  assert.equal(payload.charter, null);
  assert.equal(payload.graph.nodes.length, 1, "graph still renders the orphan record");
});
