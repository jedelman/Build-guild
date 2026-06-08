// Agreement workflow — full per-person consent, amendable terms, the deliver→pay
// loop, patron delegation, and the debug graph.
import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeypair, signRecord, verifyRecords } from "../src/governance.js";
import { deriveAgreement } from "../src/agreement.js";
import { buildGraph } from "../src/graph.js";

const keyring = new Map(), secrets = new Map();
async function actor(did) {
  const { publicKey, privateKey } = await generateKeypair();
  keyring.set(did, publicKey); secrets.set(did, privateKey); return did;
}
const resolveKey = (did) => keyring.get(did) || null;
const vr = async (did, rec) => (await verifyRecords([await signRecord({ ...rec, author: did }, secrets.get(did))], resolveKey))[0];
const at = (n) => `2026-02-0${n}T00:00:00Z`;

test("party claim binds only when patron + every party member co-sign", async () => {
  const P = await actor("did:p:patron"), X = await actor("did:b:x"), Y = await actor("did:b:y");
  const quest = await vr(P, { type: "org.buildguild.quest", title: "Map the frontier", reward: "$1000", createdAt: at(1) });

  // X claims for a two-person party [X, Y]. X authors (consents); P and Y still must.
  const offer = await vr(X, { type: "org.buildguild.offer", quest: quest._ref, role: "party", party: [X, Y], reward: "$1000", amount: 100000, currency: "usd", terms: "on_delivery", createdAt: at(2) });

  let s = deriveAgreement(quest, [quest, offer]);
  assert.equal(s.status, "offered");
  assert.deepEqual(s.pending.sort(), [Y, "<patron>"].sort());

  const yAcc = await vr(Y, { type: "org.buildguild.acceptance", subject: offer._ref, createdAt: at(3) });
  s = deriveAgreement(quest, [quest, offer, yAcc]);
  assert.equal(s.status, "part-agreed");
  assert.deepEqual(s.pending, ["<patron>"]);

  const pAcc = await vr(P, { type: "org.buildguild.acceptance", subject: offer._ref, createdAt: at(4) });
  s = deriveAgreement(quest, [quest, offer, yAcc, pAcc]);
  assert.equal(s.status, "agreed");
  assert.deepEqual(s.pending, []);
  return { P, X, Y, quest, offer, yAcc, pAcc };
});

test("amendable terms: applied only when all current principals consent", async () => {
  const P = await actor("did:p:p2"), X = await actor("did:b:x2"), Y = await actor("did:b:y2");
  const quest = await vr(P, { type: "org.buildguild.quest", title: "T", reward: "$1000", createdAt: at(1) });
  const offer = await vr(X, { type: "org.buildguild.offer", quest: quest._ref, role: "party", party: [X, Y], amount: 100000, currency: "usd", terms: "on_delivery", createdAt: at(2) });
  const yAcc = await vr(Y, { type: "org.buildguild.acceptance", subject: offer._ref, createdAt: at(3) });
  const pAcc = await vr(P, { type: "org.buildguild.acceptance", subject: offer._ref, createdAt: at(4) });

  // X proposes raising the reward to $1500. Needs P and Y (X authored = consent).
  const amend = await vr(X, { type: "org.buildguild.amendment", supersedes: offer._ref, role: "party", changes: { amount: 150000 }, reason: "scope grew", createdAt: at(5) });
  let base = [quest, offer, yAcc, pAcc, amend];
  let s = deriveAgreement(quest, base);
  assert.equal(s.total, 100000, "amendment not yet applied (P, Y haven't accepted)");
  assert.equal(s.amendments.find((a) => a.ref === amend._ref).accepted, false);

  const pAmend = await vr(P, { type: "org.buildguild.acceptance", subject: amend._ref, createdAt: at(6) });
  const yAmend = await vr(Y, { type: "org.buildguild.acceptance", subject: amend._ref, createdAt: at(7) });
  s = deriveAgreement(quest, [...base, pAmend, yAmend]);
  assert.equal(s.total, 150000, "amendment applied once all principals consent");
});

test("deliver→pay loop reaches fully-paid by summing slices", async () => {
  const P = await actor("did:p:p3"), X = await actor("did:b:x3");
  const quest = await vr(P, { type: "org.buildguild.quest", title: "Solo", reward: "$500", createdAt: at(1) });
  const offer = await vr(X, { type: "org.buildguild.offer", quest: quest._ref, role: "party", party: [X], amount: 50000, currency: "usd", terms: "on_delivery", createdAt: at(2) });
  const pAcc = await vr(P, { type: "org.buildguild.acceptance", subject: offer._ref, createdAt: at(3) });
  let recs = [quest, offer, pAcc];
  assert.equal(deriveAgreement(quest, recs).status, "agreed");

  const del = await vr(X, { type: "org.buildguild.delivery", quest: quest._ref, agreement: pAcc._ref, source: { repo: "https://git/x", commit: "abc1234def" }, createdAt: at(4) });
  recs.push(del);
  assert.equal(deriveAgreement(quest, recs).status, "delivered");

  const half = await vr(P, { type: "org.buildguild.settlement", quest: quest._ref, for: del._ref, payee: X, amount: 25000, of: 50000, rail: "btc", createdAt: at(5) });
  recs.push(half);
  assert.equal(deriveAgreement(quest, recs).status, "part-paid");

  const rest = await vr(P, { type: "org.buildguild.settlement", quest: quest._ref, for: del._ref, payee: X, amount: 25000, of: 50000, rail: "btc", createdAt: at(6) });
  recs.push(rest);
  const s = deriveAgreement(quest, recs);
  assert.equal(s.status, "fully-paid");
  assert.equal(s.paid, 50000);
});

test("patron delegation: a quest.transact grantee can accept patron-side", async () => {
  const P = await actor("did:p:p4"), D = await actor("did:p:deleg"), X = await actor("did:b:x4");
  const quest = await vr(P, { type: "org.buildguild.quest", title: "Deleg", reward: "$1", createdAt: at(1) });
  const grant = await vr(P, { type: "org.buildguild.designation", grantee: D, mode: "delegate", capability: "quest.transact", scope: quest._ref, createdAt: at(2) });
  const offer = await vr(X, { type: "org.buildguild.offer", quest: quest._ref, role: "party", party: [X], amount: 100, currency: "usd", terms: "on_delivery", createdAt: at(3) });

  // The delegate (not the patron) accepts patron-side → AGREED.
  const dAcc = await vr(D, { type: "org.buildguild.acceptance", subject: offer._ref, createdAt: at(4) });
  const s = deriveAgreement(quest, [quest, grant, offer, dAcc]);
  assert.equal(s.status, "agreed", "delegate's acceptance counts as patron-side");
});

test("graph: records become nodes, strongRefs become edges", async () => {
  const P = await actor("did:p:p5"), X = await actor("did:b:x5");
  const quest = await vr(P, { type: "org.buildguild.quest", title: "G", createdAt: at(1) });
  const offer = await vr(X, { type: "org.buildguild.offer", quest: quest._ref, role: "party", party: [X], createdAt: at(2) });
  const acc = await vr(P, { type: "org.buildguild.acceptance", subject: offer._ref, createdAt: at(3) });
  const g = buildGraph([quest, offer, acc]);
  assert.equal(g.nodes.length, 3);
  assert.ok(g.edges.some((e) => e.from === offer._ref && e.to === quest._ref && e.rel === "quest"));
  assert.ok(g.edges.some((e) => e.from === acc._ref && e.to === offer._ref && e.rel === "subject"));
  assert.ok(g.edges.every((e) => !e.dangling), "all edges resolve to known nodes");
});
