// Builds a complete, signed quest-lifecycle commons — collective-root guild,
// officer + member via the designation DAG, a co-signed party agreement, an
// accepted amendment, a git-anchored delivery, a witness, and progressive
// settlement — then writes public/debug-sample.json for the debug graph view.
//
//   node sim/agreement-demo.mjs
import { writeFileSync, mkdirSync } from "node:fs";
import { generateKeypair, signRecord, verifyRecords } from "../src/governance.js";
import { buildAuthority } from "../src/designation.js";
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

const A = await actor("did:plc:founderA"), B = await actor("did:plc:founderB");
const O = await actor("did:plc:officerO"), M = await actor("did:plc:memberM");
const X = await actor("did:plc:builderX"), W = await actor("did:plc:witnessW");
const GUILD = "did:guild:cartographers";

const charter = await vr(A, {
  type: "org.buildguild.charter", guild: GUILD, version: 1, founder: A,
  prose: "The Cartographers chart together, decide collectively, and split fairly.",
  rules: {
    root: { founders: [A, B], threshold: 2 },
    roles: { founder: { can: ["grant_role", "admit", "remove"] }, officer: { can: ["admit"] }, member: { can: ["vote"] } },
  },
  createdAt: at(),
});

// --- authority DAG: A grants O officer (collective root → B co-signs), O accepts
const grantO = await vr(A, { type: "org.buildguild.designation", grantee: O, mode: "delegate", capability: "role:officer", scope: GUILD, createdAt: at() });
const bCoO = await vr(B, { type: "org.buildguild.acceptance", subject: grantO._ref, createdAt: at() });
const oAcc = await vr(O, { type: "org.buildguild.acceptance", subject: grantO._ref, createdAt: at() });
// O (officer) admits M; M accepts
const grantM = await vr(O, { type: "org.buildguild.designation", grantee: M, mode: "delegate", capability: "role:member", scope: GUILD, createdAt: at() });
const mAcc = await vr(M, { type: "org.buildguild.acceptance", subject: grantM._ref, createdAt: at() });
// trust: the guild designates W as a delivery witness (collective root → B co-signs)
const grantW = await vr(A, { type: "org.buildguild.designation", grantee: W, mode: "trust", capability: "delivery.witness", scope: GUILD, createdAt: at() });
const bCoW = await vr(B, { type: "org.buildguild.acceptance", subject: grantW._ref, createdAt: at() });

// --- the agreement: patron A posts a quest; X claims for party [X, M]
const quest = await vr(A, { type: "org.buildguild.quest", title: "Chart the northern reach", reward: "$1500", createdAt: at() });
const offer = await vr(X, { type: "org.buildguild.offer", quest: quest._ref, role: "party", party: [X, M], reward: "$1500", amount: 150000, currency: "usd", terms: "on_delivery", createdAt: at() });
const pAcc = await vr(A, { type: "org.buildguild.acceptance", subject: offer._ref, createdAt: at() });
const mOfferAcc = await vr(M, { type: "org.buildguild.acceptance", subject: offer._ref, createdAt: at() });
// amendment: raise reward; all current principals (A, X, M) consent
const amend = await vr(X, { type: "org.buildguild.amendment", supersedes: offer._ref, role: "party", changes: { amount: 180000, reward: "$1800" }, reason: "added the eastern survey", createdAt: at() });
const aAmend = await vr(A, { type: "org.buildguild.acceptance", subject: amend._ref, createdAt: at() });
const mAmend = await vr(M, { type: "org.buildguild.acceptance", subject: amend._ref, createdAt: at() });
// delivery anchored to a commit, witnessed, then paid in two slices
const del = await vr(X, { type: "org.buildguild.delivery", quest: quest._ref, agreement: pAcc._ref, source: { repo: "https://tangled.sh/cartographers/atlas", commit: "9f2c1ab7e4d0" }, createdAt: at() });
const wit = await vr(W, { type: "org.buildguild.witness", delivery: del._ref, commit: "9f2c1ab7e4d0", treeHash: "5d41402abc4b", mirror: "https://mirror.guild/atlas.git", fetchedAt: at(), createdAt: at() });
const pay1 = await vr(A, { type: "org.buildguild.settlement", quest: quest._ref, for: del._ref, payee: X, party: [X, M], amount: 90000, of: 180000, rail: "btc", createdAt: at() });
const pay2 = await vr(A, { type: "org.buildguild.settlement", quest: quest._ref, for: del._ref, payee: X, party: [X, M], amount: 90000, of: 180000, rail: "btc", createdAt: at() });

const auth = buildAuthority(charter, all);
const agreement = deriveAgreement(quest, all, { charter });
const graph = buildGraph(all);

mkdirSync("public", { recursive: true });
writeFileSync("public/debug-sample.json", JSON.stringify({
  generatedAt: new Date().toISOString(),
  authority: { founders: auth.founders, threshold: auth.threshold, officers: [O].filter((d) => auth.holdsCapability(d, "role:officer", GUILD)), members: auth.members(GUILD), witnesses: auth.trustees("delivery.witness", GUILD) },
  agreement,
  records: all,
  graph,
}, null, 2));

console.log("authority:", { members: auth.members(GUILD), witnesses: auth.trustees("delivery.witness", GUILD) });
console.log("agreement:", agreement.status, "paid", agreement.paid, "/", agreement.total);
console.log(`wrote public/debug-sample.json — ${all.length} records, ${graph.edges.length} edges`);
