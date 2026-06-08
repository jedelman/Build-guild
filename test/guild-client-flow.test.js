// Locks the migrated front-end ↔ backend contract: build the EXACT records web/claimstead.js
// now posts (founder-free charter with rules.genesis, a `proposal` with question+basis, a
// vote `attestation` with subject+value+basis) and assemble them through the same pure
// function the live /api/guilds/:id/graph endpoint uses. Guards against the panel going
// blank after the /state → /graph migration.
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
const GUILD = "guild:42";

// mirrors web/app.js DEFAULT_RULES(genesis)
const DEFAULT_RULES = (genesis) => ({
  genesis,
  vote: { admit: { threshold: 50, quorum: 50 }, grant_mandate: { threshold: 60, quorum: 50 }, recall: { threshold: 34, quorum: 25 }, amend: { threshold: 75, quorum: 60 }, default: { threshold: 50, quorum: 50 } },
  roles: { member: { can: ["propose", "vote"] } }, membership: { requireAcceptance: false },
});

test("client flow: adopt → propose(question) → vote renders in the /graph payload", async () => {
  const A = await actor("did:c:A");

  // 1) adoptCharter(A, GUILD, prose, DEFAULT_RULES([A]))
  const charter = await sign(A, { type: "org.buildguild.charter", guild: GUILD, version: 1, prev: null, prose: "We chart together and split fairly.", rules: DEFAULT_RULES([A]) });
  const head0 = (await verifyRecords([charter], resolveKey))[0]._ref; // /graph collective.head for a fresh charter

  // 2) propose(A, GUILD, { question, basis: head })  — no action ⇒ a plain question vote
  const proposal = await sign(A, { type: "org.buildguild.proposal", guild: GUILD, question: "Adopt the gold standard?", basis: head0 });
  const pref = (await verifyRecords([proposal], resolveKey))[0]._ref;

  // 3) castVote(A, GUILD, { subject: pref, value: "yes", basis: head })
  const vote = await sign(A, { type: "org.buildguild.attestation", guild: GUILD, contract: "vote", subject: pref, value: "yes", basis: head0 });

  // server verifies on read (govstore.verifiedRows) then assembles the payload
  const records = await verifyRecords([charter, proposal, vote], resolveKey);
  const payload = guildGraphFromRecords(records);

  assert.equal(payload.charter.version, 1, "panel header: charter v1");
  assert.equal(payload.collective.charterVersion, 1);
  assert.deepEqual(payload.collective.members, [A], "genesis cohort is the member roster");
  assert.equal(payload.collective.head, head0, "head is the genesis charter — what the client pins as basis");
  const p = payload.collective.proposals[0];
  assert.equal(p.ref, pref);
  assert.equal(p.question, "Adopt the gold standard?", "the panel renders the question");
  assert.equal(p.outcome, "passed", "1 of 1 yes meets the default bar");
  assert.deepEqual({ yes: p.tally.yes, no: p.tally.no }, { yes: 1, no: 0 });
  assert.equal(p.rule.quorum, 50, "panel renders quorum % from rule");
  // the graph carries the vote→proposal and proposal→charter(basis) edges for the DAG view
  assert.equal(payload.graph.edges.some((e) => e.rel === "subject" && e.from === records[2]._ref && e.to === pref), true);
  assert.equal(payload.graph.edges.some((e) => e.rel === "basis" && e.to === head0), true);
});
