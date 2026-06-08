// Claimstead simulation harness — agent-based, fully in-memory.
//
// Generates synthetic actors (real ECDSA keypairs), has them author SIGNED claims
// per behavioral policy, and runs the SAME pure verifier/tally from
// src/governance.js. Nothing touches a PDS or the network — claims are self-signed
// and the repo is only distribution, so a simulation simply skips distribution.
//
// Purpose: stress the reputation model and surface attacks the unit tests don't —
// outsider Sybil floods, insider collusion rings, contestability/unilateral power,
// and reputation concentration. Run: `node sim/claimstead-sim.mjs`
import {
  generateKeypair,
  signRecord,
  verifyRecords,
  tallyBadges,
  buildContext,
} from "../src/governance.js";

// ---- seeded RNG (reproducible runs) ---------------------------------------
function mulberry32(seed) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(0xc0ffee);
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];

// ---- actor keyring (in-memory only) ---------------------------------------
const keyring = new Map();
const secrets = new Map();
let nextId = 0;
async function spawn(prefix) {
  const did = `did:sim:${prefix}-${nextId++}`;
  const { publicKey, privateKey } = await generateKeypair();
  keyring.set(did, publicKey);
  secrets.set(did, privateKey);
  return did;
}
const resolveKey = (did) => keyring.get(did) || null;
const sign = (did, rec) => signRecord({ ...rec }, secrets.get(did));

// ---- ontology -------------------------------------------------------------
const CONTRACTS = {
  "attest.delivered-on-time": { id: "attest.delivered-on-time", subjectType: "guild", eligibility: { rule: "patron_of_quest" } },
  "attest.splits-fairly": { id: "attest.splits-fairly", subjectType: "guild", eligibility: { rule: "party_of_quest" } },
};

// ---- record builders ------------------------------------------------------
let clock = 0;
const ts = () => `2026-06-01T00:00:${String(clock++).padStart(2, "0")}Z`;
const quest = (patron, guild, party, value) => ({
  type: "org.buildguild.event", kind: "quest", author: patron,
  body: { guild, party, value }, createdAt: ts(),
});
const attest = (attester, subject, contract, value, questRef) => ({
  type: "org.buildguild.attestation", attester, subject, contract, value,
  context: { quest: questRef }, createdAt: ts(), nonce: rnd().toString(36).slice(2),
});

// verify quests → context (gives each quest its _ref) and a signed/verified set.
async function settle(questObjs) {
  const signed = await Promise.all(questObjs.map((q) => sign(q.author, q)));
  const verified = await verifyRecords(signed, resolveKey);
  return { verified, ctx: buildContext(verified) };
}
async function tallyAtts(subject, attObjs, ctx) {
  const verified = await verifyRecords(await Promise.all(attObjs.map((a) => sign(a.attester, a))), resolveKey);
  return tallyBadges(subject, verified, CONTRACTS, ctx, { subjectType: "guild" });
}
const yesOf = (cloud, c = "attest.delivered-on-time") => cloud.badges[c]?.yes ?? 0;

// Gini coefficient of a distribution (0 = equal, →1 = concentrated).
function gini(values) {
  const v = [...values].sort((a, b) => a - b);
  const n = v.length, sum = v.reduce((a, b) => a + b, 0);
  if (!n || sum === 0) return 0;
  let cum = 0;
  for (let i = 0; i < n; i++) cum += (i + 1) * v[i];
  return (2 * cum) / (n * sum) - (n + 1) / n;
}

// ===========================================================================
// Scenario 1 — honest economy: how does reputation distribute?
// ===========================================================================
async function honestEconomy() {
  const guilds = [];
  for (let i = 0; i < 8; i++) guilds.push(await spawn("guild"));
  const clients = [];
  for (let i = 0; i < 20; i++) clients.push(await spawn("client"));

  const qs = [];
  for (const c of clients) {
    const n = 1 + Math.floor(rnd() * 4);
    for (let k = 0; k < n; k++) qs.push(quest(c, pick(guilds), [], 100)); // popularity skews to picked guilds
  }
  const { verified, ctx } = await settle(qs);
  const atts = verified.map((q) => attest(q.author, q.body.guild, "attest.delivered-on-time", rnd() < 0.92 ? "yes" : "no", q._ref));
  const verifiedAtts = await verifyRecords(await Promise.all(atts.map((a) => sign(a.attester, a))), resolveKey);
  const counts = guilds.map((g) => yesOf(tallyBadges(g, verifiedAtts, CONTRACTS, ctx, { subjectType: "guild" })));
  return { guilds: guilds.length, quests: verified.length, perGuildYes: counts.sort((a, b) => b - a), gini: gini(counts) };
}

// ===========================================================================
// Scenario 2 — outsider Sybil flood: can fake accounts inflate a badge?
// ===========================================================================
async function outsiderSybil() {
  const target = await spawn("target");
  const patron = await spawn("honest-patron");
  const { verified, ctx } = await settle([quest(patron, target, [], 100)]);
  const qref = verified[0]._ref;

  const atts = [attest(patron, target, "attest.delivered-on-time", "yes", qref)]; // 1 eligible
  const S = 60;
  for (let i = 0; i < S; i++) {
    const s = await spawn("sybil");
    atts.push(attest(s, target, "attest.delivered-on-time", "yes", qref)); // not the patron → ineligible
  }
  const cloud = await tallyAtts(target, atts, ctx);
  return { sybils: S, attestationsSubmitted: atts.length, counted: yesOf(cloud), blockedByEligibility: atts.length - yesOf(cloud) };
}

// ===========================================================================
// Scenario 3 — insider collusion ring: manufacture your own standing.
// ===========================================================================
async function collusionRing() {
  const R = 6;
  const ring = [];
  for (let i = 0; i < R; i++) ring.push(await spawn("colluder"));

  // Round-robin FAKE quests: each colluder is patron for every other as "guild".
  const value = 100;
  const qs = [];
  for (const patron of ring) for (const g of ring) if (patron !== g) qs.push(quest(patron, g, [], value));
  const { verified, ctx } = await settle(qs);

  // Each patron attests delivered:yes about the guild of their own fake quest —
  // and they ARE the patron, so eligibility PASSES.
  const atts = verified.map((q) => attest(q.author, q.body.guild, "attest.delivered-on-time", "yes", q._ref));
  const verifiedAtts = await verifyRecords(await Promise.all(atts.map((a) => sign(a.attester, a))), resolveKey);
  const perColluder = ring.map((g) => yesOf(tallyBadges(g, verifiedAtts, CONTRACTS, ctx, { subjectType: "guild" })));

  const totalCycled = qs.length * value;
  const feeRate = 0.029; // Stripe-ish
  return {
    ring: R, fakeQuests: qs.length, badgesPerColluder: perColluder,
    costIfFree: 0, costIfEscrowGated: +(totalCycled * feeRate).toFixed(2), totalValueCycled: totalCycled,
  };
}

// ===========================================================================
// Scenario 4 — contestability & unilateral power.
// ===========================================================================
async function contestability() {
  const guild = await spawn("guild-c");
  const patron = await spawn("client-c");
  const party = [];
  for (let i = 0; i < 4; i++) party.push(await spawn("member"));
  const { verified, ctx } = await settle([quest(patron, guild, party, 100)]);
  const qref = verified[0]._ref;

  // splits-fairly: 4 eligible party members; 3 say fair, 1 disputes → CONTESTED.
  const splitAtts = party.map((m, i) => attest(m, guild, "attest.splits-fairly", i < 3 ? "yes" : "no", qref));
  const splits = (await verifyRecords(await Promise.all(splitAtts.map((a) => sign(a.attester, a))), resolveKey));
  const splitCloud = tallyBadges(guild, splits, CONTRACTS, ctx, { subjectType: "guild" }).badges["attest.splits-fairly"];

  // delivered-on-time: only the patron is eligible → a bad-faith client can post an
  // unchallengeable "no" (no second eligible party to contest it).
  const deliv = await verifyRecords([await sign(patron, attest(patron, guild, "attest.delivered-on-time", "no", qref))], resolveKey);
  const delivCloud = tallyBadges(guild, deliv, CONTRACTS, ctx, { subjectType: "guild" }).badges["attest.delivered-on-time"];

  return { splitsFairly_multiEligible: splitCloud, deliveredOnTime_singleEligible: delivCloud };
}

// ---- report ---------------------------------------------------------------
const pct = (x) => `${(x * 100).toFixed(1)}%`;
(async () => {
  console.log("Claimstead simulation — in-memory, no PDS writes\n" + "=".repeat(60));

  const s1 = await honestEconomy();
  console.log(`\n[1] Honest economy: ${s1.guilds} guilds, ${s1.quests} quests`);
  console.log(`    per-guild delivered-yes: [${s1.perGuildYes.join(", ")}]`);
  console.log(`    reputation Gini = ${s1.gini.toFixed(2)}  (volume naturally concentrates → cold-start tax)`);

  const s2 = await outsiderSybil();
  console.log(`\n[2] Outsider Sybil flood: ${s2.sybils} sybils + 1 real patron`);
  console.log(`    ${s2.attestationsSubmitted} attestations submitted → ${s2.counted} counted, ${s2.blockedByEligibility} blocked by eligibility`);
  console.log(`    VERDICT: eligibility gating holds — outsiders cannot inflate a badge.`);

  const s3 = await collusionRing();
  console.log(`\n[3] Insider collusion ring: ${s3.ring} colluders, ${s3.fakeQuests} fake quests`);
  console.log(`    badges farmed per colluder: [${s3.badgesPerColluder.join(", ")}]  ← eligibility does NOT stop this`);
  console.log(`    cost to farm: $${s3.costIfFree} if quests are free  |  $${s3.costIfEscrowGated} if escrow-gated (2.9% on $${s3.totalValueCycled} cycled)`);
  console.log(`    FINDING: closed-loop collusion manufactures standing for free; escrow turns it into a real-money tax.`);

  const s4 = await contestability();
  console.log(`\n[4] Contestability:`);
  console.log(`    splits-fairly (4 eligible): ${JSON.stringify(s4.splitsFairly_multiEligible)}  → contest is VISIBLE (3y/1n)`);
  console.log(`    delivered-on-time (1 eligible): ${JSON.stringify(s4.deliveredOnTime_singleEligible)}  → bad-faith patron's "no" is UNCHALLENGEABLE`);
  console.log(`    FINDING: single-eligible contracts grant unilateral power; contestable facts need ≥2-sided eligibility or an objective anchor (escrow release).`);

  console.log("\n" + "=".repeat(60));
  console.log("Strengthening levers surfaced: (a) escrow-gate reputation-bearing quests");
  console.log("(collusion tax); (b) ≥2-sided eligibility / escrow-as-objective-delivery-proof");
  console.log("for contestable facts; (c) cold-start on-ramp to offset volume concentration.");
})();
