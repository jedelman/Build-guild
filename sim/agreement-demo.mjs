// Builds a complete, signed commons — a guild GOVERNING ITSELF (founder-free:
// genesis cohort, admit-by-microvote, a granted-then-recalled mandate, a witness
// mandate) AND running a full quest lifecycle (co-signed party agreement, accepted
// amendment, git delivery, witness, progressive settlement) — then writes
// public/debug-sample.json for the debug graph view.
//
//   node sim/agreement-demo.mjs
import { writeFileSync, mkdirSync } from "node:fs";
import { generateKeypair, signRecord, verifyRecords } from "../src/governance.js";
import { deriveCollective } from "../src/collective.js";
import { deriveAgreement } from "../src/agreement.js";
import { buildGraph } from "../src/graph.js";

const keyring = new Map(), secrets = new Map();
async function actor(did) {
  const { publicKey, privateKey } = await generateKeypair();
  keyring.set(did, publicKey); secrets.set(did, privateKey); return did;
}
const resolveKey = (did) => keyring.get(did) || null;
const all = [];
const vr = async (did, rec) => {
  const v = (await verifyRecords([await signRecord({ ...rec, author: did }, secrets.get(did))], resolveKey))[0];
  all.push(v); return v;
};
let n = 0;
const at = () => `2026-03-${String(++n).padStart(2, "0")}T00:00:00Z`;

const A = await actor("did:plc:memberA"), B = await actor("did:plc:memberB"), C = await actor("did:plc:memberC");
const M = await actor("did:plc:recruitM"), W = await actor("did:plc:witnessW"), X = await actor("did:plc:builderX");
const GUILD = "did:guild:cartographers";

// Founder-free charter: genesis cohort are the initial members; per-action vote bars.
const charter = await vr(A, {
  type: "org.buildguild.charter", guild: GUILD, version: 1,
  prose: "The Cartographers chart together, decide collectively, and recall freely.",
  rules: {
    genesis: [A, B, C],
    vote: {
      admit: { threshold: 50, quorum: 50 },
      grant_mandate: { threshold: 60, quorum: 50 },
      recall: { threshold: 34, quorum: 25 }, // recall is cheap
      default: { threshold: 50, quorum: 50 },
    },
  },
  createdAt: at(),
});

// --- the guild governs itself (microvotes) ---
// Votes pin `basis` = the membership HEAD they were cast under (genesis = charter).
const vote = (who, prop, val, basis) => vr(who, { type: "org.buildguild.attestation", guild: GUILD, contract: "vote", subject: prop._ref, value: val, basis, createdAt: at() });

// admit recruit M — voted under the GENESIS head (the charter)
const pAdmit = await vr(A, { type: "org.buildguild.proposal", guild: GUILD, action: "admit", enacts: { grantee: M }, question: "Admit M to the guild?", createdAt: at() });
await vote(A, pAdmit, "yes", charter._ref); await vote(B, pAdmit, "yes", charter._ref);
const head = pAdmit._ref; // admitting M advanced the roster head; later votes pin it
// grant W a delivery-witness mandate (trust)
const pWit = await vr(B, { type: "org.buildguild.proposal", guild: GUILD, action: "grant_mandate", enacts: { grantee: W, capability: "delivery.witness", scope: GUILD, mode: "trust" }, question: "Trust W as a delivery witness?", createdAt: at() });
await vote(A, pWit, "yes", head); await vote(B, pWit, "yes", head); await vote(C, pWit, "yes", head);
// grant M a scoped 'admit' mandate, then RECALL it (cheap)
const pGrant = await vr(A, { type: "org.buildguild.proposal", guild: GUILD, action: "grant_mandate", enacts: { grantee: M, capability: "admit", scope: GUILD }, question: "Mandate M to admit?", createdAt: at() });
await vote(A, pGrant, "yes", head); await vote(B, pGrant, "yes", head); await vote(C, pGrant, "yes", head);
const pRecall = await vr(C, { type: "org.buildguild.proposal", guild: GUILD, action: "recall", enacts: { grantee: M, capability: "admit", scope: GUILD }, question: "Recall M's admit mandate?", createdAt: at() });
await vote(C, pRecall, "yes", head); // one vote clears the low recall bar

// --- the agreement: member A posts a quest; X claims for party [X, M] ---
const quest = await vr(A, { type: "org.buildguild.quest", title: "Chart the northern reach", reward: "$1500", createdAt: at() });
const offer = await vr(X, { type: "org.buildguild.offer", quest: quest._ref, role: "party", party: [X, M], reward: "$1500", amount: 150000, currency: "usd", terms: "on_delivery", createdAt: at() });
const pAcc = await vr(A, { type: "org.buildguild.acceptance", subject: offer._ref, createdAt: at() });
await vr(M, { type: "org.buildguild.acceptance", subject: offer._ref, createdAt: at() });
const amend = await vr(X, { type: "org.buildguild.amendment", supersedes: offer._ref, role: "party", changes: { amount: 180000, reward: "$1800" }, reason: "added the eastern survey", createdAt: at() });
await vr(A, { type: "org.buildguild.acceptance", subject: amend._ref, createdAt: at() });
await vr(M, { type: "org.buildguild.acceptance", subject: amend._ref, createdAt: at() });
const del = await vr(X, { type: "org.buildguild.delivery", quest: quest._ref, agreement: pAcc._ref, source: { repo: "https://tangled.sh/cartographers/atlas", commit: "9f2c1ab7e4d0" }, createdAt: at() });
await vr(W, { type: "org.buildguild.witness", delivery: del._ref, commit: "9f2c1ab7e4d0", treeHash: "5d41402abc4b", mirror: "https://mirror.guild/atlas.git", fetchedAt: at(), createdAt: at() });
await vr(A, { type: "org.buildguild.settlement", quest: quest._ref, for: del._ref, payee: X, party: [X, M], amount: 90000, of: 180000, rail: "btc", createdAt: at() });
await vr(A, { type: "org.buildguild.settlement", quest: quest._ref, for: del._ref, payee: X, party: [X, M], amount: 90000, of: 180000, rail: "btc", createdAt: at() });

const collective = deriveCollective(charter, all);
const agreement = deriveAgreement(quest, all);
const graph = buildGraph(all);

mkdirSync("public", { recursive: true });
writeFileSync("public/debug-sample.json", JSON.stringify({
  generatedAt: new Date().toISOString(),
  collective: {
    members: collective.members,
    mandates: collective.mandates.map((m) => ({ grantee: m.grantee, capability: m.capability, scope: m.scope, mode: m.mode })),
    proposals: Object.values(collective.proposals).map((p) => ({ action: p.action, outcome: p.outcome, tally: p.tally })),
  },
  agreement,
  records: all,
  graph,
}, null, 2));

console.log("members:", collective.members.map((d) => d.slice(-1)).join(","), "| mandates:", collective.mandates.map((m) => `${m.grantee.slice(-1)}:${m.capability}`).join(",") || "none (M recalled)");
console.log("agreement:", agreement.status, "paid", agreement.paid, "/", agreement.total);
console.log(`wrote public/debug-sample.json — ${all.length} records, ${graph.edges.length} edges`);
