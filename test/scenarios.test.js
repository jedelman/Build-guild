// Scenario-based design: detailed, multi-user narratives driven end-to-end through the SAME
// pure engine the Worker runs (deriveGuild for membership/governance, deriveAgreement for the
// quest→deliver→pay loop). Each test is a story with named actors and goals; each beat is one
// actor's signed action, asserted as an observable outcome. See notes/scenarios.md for the
// narrative write-ups. These guard the INTEGRATION seams between actors that unit tests miss.
import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeypair, signRecord, verifyRecords } from "../src/governance.js";
import { deriveGuild } from "../src/guild.js";
import { deriveAgreement } from "../src/agreement.js";
import { DEFAULT_RULES } from "../src/charter.js";
import { admitPath } from "../src/membership.js";

const keyring = new Map(), secrets = new Map();
async function cast(did) {
  const { publicKey, privateKey } = await generateKeypair();
  keyring.set(did, publicKey); secrets.set(did, privateKey); return did;
}
const resolveKey = (did) => keyring.get(did) || null;

// A scenario keeps a running, append-only log of signed records (the commons), a clock, and
// derive helpers that recompute the live state at each beat — like the live index would.
function scenario(guild) {
  const recs = [];
  let clock = 0;
  const at = () => `2026-06-${String(++clock).padStart(2, "0")}T00:00:00Z`;
  const vr = async (did, rec) => {
    const v = (await verifyRecords([await signRecord({ ...rec, author: did, createdAt: rec.createdAt || at() }, secrets.get(did))], resolveKey))[0];
    recs.push(v); return v;
  };
  return {
    recs, vr,
    // --- membership / governance ---
    charter: (founder, rules) => vr(founder, { type: "org.buildguild.charter", guild, version: 1, prose: "scenario", rules }),
    join: (who) => vr(who, { type: "org.buildguild.designation", guild, grantee: who, capability: "role:member", scope: guild, mode: "delegate" }), // self-grant
    invite: (who, recruit) => vr(who, { type: "org.buildguild.designation", guild, grantee: recruit, capability: "role:member", scope: guild, mode: "delegate" }),
    accept: (who, ref) => vr(who, { type: "org.buildguild.acceptance", guild, subject: ref }),
    leave: (who) => vr(who, { type: "org.buildguild.revocation", guild, grantee: who, capability: "role:member", scope: guild }),
    proposeAdmit: (who, recruit, basis) => vr(who, { type: "org.buildguild.proposal", guild, action: "admit", enacts: { grantee: recruit }, question: `Admit ${recruit}?`, basis }),
    vote: (who, ref, value, basis) => vr(who, { type: "org.buildguild.attestation", guild, contract: "vote", subject: ref, value, basis }),
    // --- quest agreement ---
    quest: (patron, title, reward) => vr(patron, { type: "org.buildguild.quest", title, reward }),
    offer: (who, questRef, party, amount) => vr(who, { type: "org.buildguild.offer", quest: questRef, role: "party", party, amount, currency: "usd", terms: "on_delivery" }),
    acceptOffer: (who, ref) => vr(who, { type: "org.buildguild.acceptance", subject: ref }),
    deliver: (who, questRef, commit) => vr(who, { type: "org.buildguild.delivery", quest: questRef, source: { repo: "https://tangled.sh/g/repo", commit } }),
    settle: (patron, questRef, delRef, payee, party, amount, of) => vr(patron, { type: "org.buildguild.settlement", quest: questRef, for: delRef, payee, party, amount, of, rail: "btc" }),
  };
}

// =====================================================================================
// SCENARIO A — "The open commons": found → self-join → invite-with-consent → quest → pay
// Ada founds an open guild; Bjorn walks in; Ada invites Cass (who must co-sign); then the
// party takes Quill's quest and gets paid. The everyday happy path, across every subsystem.
// =====================================================================================
test("Scenario A — open commons: self-join, consented invite, then a quest paid in full", async () => {
  const GUILD = "guild:atlas";
  const Ada = await cast("did:s:ada"), Bjorn = await cast("did:s:bjorn"), Cass = await cast("did:s:cass"), Quill = await cast("did:s:quill");
  const s = scenario(GUILD);
  const members = () => deriveGuild(ch, s.recs).members;
  const isMember = (d) => deriveGuild(ch, s.recs).isMember(d);

  // Beat 1 — Ada founds Atlas Guild on the open-commons default (she's the genesis cohort).
  const ch = await s.charter(Ada, DEFAULT_RULES([Ada]));
  assert.deepEqual(members(), [Ada], "founding cohort is just Ada");

  // Beat 2 — Bjorn discovers the open guild and self-joins; no one's approval needed.
  assert.equal(admitPath(ch, deriveGuild(ch, s.recs), Bjorn, Bjorn), "self", "open guild routes Bjorn to self-join");
  await s.join(Bjorn);
  assert.equal(isMember(Bjorn), true, "Bjorn is in");

  // Beat 3 — Ada invites Cass to round out the party. The invite alone is NOT membership.
  assert.equal(admitPath(ch, deriveGuild(ch, s.recs), Ada, Cass), "grant", "a member invites directly under the open default");
  const inviteCass = await s.invite(Ada, Cass);
  assert.equal(isMember(Cass), false, "an un-accepted invite is a pending invite, not membership");

  // Beat 4 — Cass co-signs (accepts). NOW she's a member. Consent is the gate.
  await s.accept(Cass, inviteCass._ref);
  assert.deepEqual(members(), [Ada, Bjorn, Cass].sort(), "the party is Ada, Bjorn, Cass");

  // Beat 5 — Quill (patron) posts a quest; Ada claims it for the party [Ada, Bjorn].
  const quest = await s.quest(Quill, "Chart the northern reach", "$1500");
  const offer = await s.offer(Ada, quest._ref, [Ada, Bjorn], 150000); // Ada authors ⇒ Ada consents
  let ag = deriveAgreement(quest, s.recs);
  assert.equal(ag.status, "offered", "claimed, awaiting the other principals");
  assert.deepEqual(ag.pending.sort(), [Bjorn, "<patron>"].sort(), "Bjorn + the patron must still co-sign");

  // Beat 6 — Bjorn and Quill co-sign the terms → the agreement binds.
  await s.acceptOffer(Bjorn, offer._ref);
  await s.acceptOffer(Quill, offer._ref);
  ag = deriveAgreement(quest, s.recs);
  assert.equal(ag.status, "agreed", "all principals consented");
  assert.deepEqual(ag.pending, []);

  // Beat 7 — Ada delivers; Quill pays the party directly and records the settlement → paid.
  const del = await s.deliver(Ada, quest._ref, "9f2c1ab7e4d0");
  await s.settle(Quill, quest._ref, del._ref, Ada, [Ada, Bjorn], 150000, 150000);
  ag = deriveAgreement(quest, s.recs);
  assert.equal(ag.status, "fully-paid", "the quest is settled");
  assert.equal(ag.paid, ag.total, "paid in full");
});

// =====================================================================================
// SCENARIO B — "The curated council": a closed charter admits by vote; members can leave.
// Iris/Jad/Kira charter a guild that vets newcomers. Nadia can't walk in or be hand-waved
// in — the council votes. Later she leaves of her own accord, though a vote let her in.
// =====================================================================================
test("Scenario B — curated council: closed charter, admit-by-vote, sovereign leave", async () => {
  const GUILD = "guild:council";
  const Iris = await cast("did:s:iris"), Jad = await cast("did:s:jad"), Kira = await cast("did:s:kira"), Nadia = await cast("did:s:nadia");
  const s = scenario(GUILD);
  const isMember = (d) => deriveGuild(ch, s.recs).isMember(d);
  const members = () => deriveGuild(ch, s.recs).members;

  // Beat 1 — the founders adopt a CLOSED charter: no open join, members can't admit
  // directly, admission needs a 50% vote.
  const rules = DEFAULT_RULES([Iris, Jad, Kira]);
  rules.membership = { ...rules.membership, openJoin: false };
  rules.roles = { member: { can: ["propose", "vote"] } }; // no direct admit
  const ch = await s.charter(Iris, rules);
  assert.deepEqual(members(), [Iris, Jad, Kira].sort(), "the founding council");

  // Beat 2 — Nadia tries to walk in. The closed charter refuses a self-join.
  assert.equal(admitPath(ch, deriveGuild(ch, s.recs), Nadia, Nadia), "denied", "no open join here");
  await s.join(Nadia);
  assert.equal(isMember(Nadia), false, "a self-grant can't enter a closed guild");

  // Beat 3 — Iris tries to wave Nadia in directly. A bare member can't admit → it's a vote.
  assert.equal(admitPath(ch, deriveGuild(ch, s.recs), Iris, Nadia), "propose", "admission must go to a vote");
  const handWave = await s.invite(Iris, Nadia);
  await s.accept(Nadia, handWave._ref);
  assert.equal(isMember(Nadia), false, "even with Nadia's acceptance, an unauthorized grant doesn't admit");

  // Beat 4 — Iris opens an admit proposal; Iris + Jad vote yes (2/3 ≥ 50%) → Nadia is in.
  const p = await s.proposeAdmit(Iris, Nadia, ch._ref);
  await s.vote(Iris, p._ref, "yes", ch._ref);
  await s.vote(Jad, p._ref, "yes", ch._ref);
  assert.equal(isMember(Nadia), true, "the council voted Nadia in");

  // Beat 5 — Nadia later resigns. Departure is sovereign: her own revocation drops her,
  // even though a council VOTE (not a grant) admitted her.
  await s.leave(Nadia);
  assert.deepEqual(members(), [Iris, Jad, Kira].sort(), "Nadia left of her own accord");
});

// =====================================================================================
// SCENARIO C — "Consent is not optional": the regression for the bug that started this.
// Mara is an eager recruiter; Theo is busy and never asked to join. No amount of inviting —
// by Mara, or by anyone else — makes Theo a member until Theo himself co-signs.
// =====================================================================================
test("Scenario C — consent is not optional: invites never auto-enroll an unwilling recruit", async () => {
  const GUILD = "guild:eager";
  const Mara = await cast("did:s:mara"), Otto = await cast("did:s:otto"), Theo = await cast("did:s:theo");
  const s = scenario(GUILD);
  const isMember = (d) => deriveGuild(ch, s.recs).isMember(d);

  // Beat 1 — an open guild; Mara and Otto are members.
  const ch = await s.charter(Mara, DEFAULT_RULES([Mara]));
  await s.join(Otto);
  assert.equal(isMember(Otto), true);

  // Beat 2 — Mara invites Theo. Theo did not ask and has not answered → not a member.
  await s.invite(Mara, Theo);
  assert.equal(isMember(Theo), false, "an invite is a request, not an enrollment");

  // Beat 3 — Mara invites again, and Otto piles on. Spamming invites changes nothing.
  await s.invite(Mara, Theo);
  await s.invite(Otto, Theo);
  assert.equal(isMember(Theo), false, "consent is the gate, not the number of inviters");

  // Beat 4 — Theo finally chooses to join, co-signing ONE of the invites.
  const open = s.recs.find((r) => r.type === "org.buildguild.designation" && r.grantee === Theo);
  await s.accept(Theo, open._ref);
  assert.equal(isMember(Theo), true, "Theo joins only when Theo says yes");

  // Beat 5 — Theo changes his mind and leaves; the dangling invites don't re-enroll him.
  await s.leave(Theo);
  assert.equal(isMember(Theo), false, "leaving sticks even with old invites lying around");
});
