// Feasibility proof for the Claimstead governance model (src/governance.js).
// Demonstrates, with real ECDSA P-256 signatures, that guild state is:
//   - locally computable from signed claims (no authoritative server),
//   - deterministic + order-independent (gossip claims in any order → same state),
//   - authority-enforcing (only charter-permitted roles can act),
//   - tamper-evident (mutating a signed claim drops it),
//   - duplicity-detecting (conflicting votes from one key are caught + voided).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  canonicalize,
  generateKeypair,
  signRecord,
  verifyRecords,
  deriveGuildState,
} from "../src/governance.js";

// ---- tiny actor + keyring harness -----------------------------------------
const GUILD = "did:example:guild-cartographers";
const keyring = new Map(); // did -> publicKey
const secrets = new Map(); // did -> privateKey

async function actor(did) {
  const { publicKey, privateKey } = await generateKeypair();
  keyring.set(did, publicKey);
  secrets.set(did, privateKey);
  return did;
}
const resolveKey = (did) => keyring.get(did) || null;

const sign = (did, record) => signRecord({ ...record }, secrets.get(did));

// charter signed by the founder
async function makeCharter(founder, version = 1) {
  return sign(founder, {
    type: "org.buildguild.charter",
    guild: GUILD,
    version,
    founder,
    prose: "The Cartographers chart together and split fairly.",
    rules: {
      roles: {
        founder: { can: ["admit", "remove", "grant_role", "open_proposal", "vote", "propose", "amend"] },
        officer: { can: ["admit", "remove", "open_proposal", "vote", "propose"] },
        member: { can: ["vote", "propose"] },
      },
      membership: { requireAcceptance: true },
      proposal: { rule: "majority", threshold: 0.5, quorum: 0.5 },
    },
    createdAt: "2026-01-01T00:00:00Z",
  });
}

const claim = (author, kind, body, createdAt) => ({
  type: "org.buildguild.claim",
  kind,
  author,
  guild: GUILD,
  charterVersion: 1,
  body,
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

// Build a representative guild: founder admits Alice; Alice is made officer;
// officer Alice admits Bob; both accept. Returns {charter, signedClaims, refs}.
async function scenario() {
  const founder = await actor("did:example:founder");
  const alice = await actor("did:example:alice");
  const bob = await actor("did:example:bob");
  const charter = await makeCharter(founder);

  const raw = [
    claim(founder, "admit", { subject: alice }, "2026-01-02T00:00:00Z"),
    claim(alice, "accept", { guild: GUILD }, "2026-01-02T01:00:00Z"),
    claim(founder, "role_grant", { subject: alice, role: "officer" }, "2026-01-02T02:00:00Z"),
    claim(alice, "admit", { subject: bob }, "2026-01-03T00:00:00Z"),
    claim(bob, "accept", { guild: GUILD }, "2026-01-03T01:00:00Z"),
  ];
  const signedClaims = await Promise.all(
    raw.map((c) => sign(c.author, c))
  );
  return { founder, alice, bob, charter, signedClaims };
}

test("membership + roles derive from signed claims (officer admits a member)", async () => {
  const { founder, alice, bob, charter, signedClaims } = await scenario();
  const verified = await verifyRecords([charter, ...signedClaims], resolveKey);
  const ch = verified[0];
  const state = deriveGuildState(ch, verified.slice(1));

  assert.deepEqual(state.members, [alice, bob, founder].sort());
  assert.equal(state.roles[founder], "founder");
  assert.equal(state.roles[alice], "officer");
  assert.equal(state.roles[bob], "member");
});

test("order-independent + deterministic: shuffled claims yield byte-identical state", async () => {
  const { charter, signedClaims } = await scenario();
  const verified = await verifyRecords([charter, ...signedClaims], resolveKey);
  const ch = verified[0];
  const claims = verified.slice(1);

  const a = deriveGuildState(ch, claims);
  const b = deriveGuildState(ch, shuffle(shuffle(claims)));
  assert.equal(canonicalize(a), canonicalize(b));
});

test("authority is enforced: an unauthorized admit is ignored", async () => {
  const { charter, signedClaims, founder, alice, bob } = await scenario();
  const mallory = await actor("did:example:mallory"); // never admitted
  const dave = await actor("did:example:dave");
  // Mallory (not a member, no role) tries to admit Dave; Dave accepts.
  const bad = [
    await sign(mallory, claim(mallory, "admit", { subject: dave }, "2026-01-04T00:00:00Z")),
    await sign(dave, claim(dave, "accept", { guild: GUILD }, "2026-01-04T01:00:00Z")),
  ];
  const verified = await verifyRecords([charter, ...signedClaims, ...bad], resolveKey);
  const state = deriveGuildState(verified[0], verified.slice(1));
  assert.ok(!state.members.includes(dave), "Dave must NOT be a member (admitter had no authority)");
  assert.deepEqual(state.members, [alice, bob, founder].sort());
});

test("tamper-evident: mutating a signed claim drops it from the derived state", async () => {
  const { charter, signedClaims, founder, alice, bob } = await scenario();
  // Tamper with Bob's admit (change the subject AFTER signing).
  const tampered = signedClaims.map((c) =>
    c.kind === "admit" && c.body.subject === bob ? { ...c, body: { subject: "did:example:evil" } } : c
  );
  const verified = await verifyRecords([charter, ...tampered], resolveKey);
  const state = deriveGuildState(verified[0], verified.slice(1));
  assert.ok(!state.members.includes(bob), "tampered admit must not verify");
  assert.ok(!state.members.includes("did:example:evil"), "forged subject must not be admitted");
  assert.deepEqual(state.members, [alice, founder].sort());
});

test("proposal tally: majority passes after close; respects quorum + voter eligibility", async () => {
  const { founder, alice, bob, charter, signedClaims } = await scenario();
  const prop = await sign(
    alice,
    claim(alice, "proposal", { question: "Adopt the gold standard?", closesAt: 1000 }, "2026-02-01T00:00:00Z")
  );
  const pre = await verifyRecords([prop], resolveKey);
  const pref = pre[0]._ref;

  const outsider = await actor("did:example:outsider"); // not a member
  const votes = await Promise.all([
    sign(alice, claim(alice, "vote", { proposal: pref, choice: "yes" }, "2026-02-01T01:00:00Z")),
    sign(bob, claim(bob, "vote", { proposal: pref, choice: "yes" }, "2026-02-01T02:00:00Z")),
    sign(founder, claim(founder, "vote", { proposal: pref, choice: "no" }, "2026-02-01T03:00:00Z")),
    sign(outsider, claim(outsider, "vote", { proposal: pref, choice: "no" }, "2026-02-01T04:00:00Z")),
  ]);

  const verified = await verifyRecords([charter, ...signedClaims, prop, ...votes], resolveKey);
  const ch = verified[0];
  const claims = verified.slice(1);

  // Before close → open; after close → tallied (outsider's vote excluded).
  assert.equal(deriveGuildState(ch, claims, { now: 500 }).proposals[pref].outcome, "open");
  const after = deriveGuildState(ch, claims, { now: 2000 }).proposals[pref];
  assert.equal(after.outcome, "passed");
  assert.deepEqual(after.tally, { yes: 2, no: 1, cast: 3, eligible: 3 });
});

test("duplicity detection: conflicting votes from one key are caught + voided", async () => {
  const { founder, alice, bob, charter, signedClaims } = await scenario();
  const prop = await sign(
    founder,
    claim(founder, "proposal", { question: "Rename the guild?", closesAt: 1000 }, "2026-03-01T00:00:00Z")
  );
  const pref = (await verifyRecords([prop], resolveKey))[0]._ref;

  const votes = await Promise.all([
    sign(alice, claim(alice, "vote", { proposal: pref, choice: "yes" }, "2026-03-01T01:00:00Z")),
    // Bob equivocates: signs both YES and NO.
    sign(bob, claim(bob, "vote", { proposal: pref, choice: "yes" }, "2026-03-01T02:00:00Z")),
    sign(bob, claim(bob, "vote", { proposal: pref, choice: "no" }, "2026-03-01T02:30:00Z")),
    sign(founder, claim(founder, "vote", { proposal: pref, choice: "no" }, "2026-03-01T03:00:00Z")),
  ]);

  const verified = await verifyRecords([charter, ...signedClaims, prop, ...votes], resolveKey);
  const state = deriveGuildState(verified[0], verified.slice(1), { now: 2000 });

  // One conflict recorded, with both offending signed records as evidence.
  assert.equal(state.conflicts.length, 1);
  assert.equal(state.conflicts[0].type, "double_vote");
  assert.equal(state.conflicts[0].author, bob);
  assert.equal(state.conflicts[0].evidence.length, 2);
  // Bob's vote is voided; tally counts only Alice (yes) and founder (no).
  assert.deepEqual(state.proposals[pref].tally, { yes: 1, no: 1, cast: 2, eligible: 3 });
});

test("graduated sanction: an authorized removal revokes membership", async () => {
  const { founder, alice, bob, charter, signedClaims } = await scenario();
  // Founder removes Bob after he was admitted (later timestamp wins).
  const removal = await sign(
    founder,
    claim(founder, "remove", { subject: bob, reason: "left the party" }, "2026-04-01T00:00:00Z")
  );
  const verified = await verifyRecords([charter, ...signedClaims, removal], resolveKey);
  const state = deriveGuildState(verified[0], verified.slice(1));
  assert.ok(!state.members.includes(bob), "Bob should be removed");
  assert.deepEqual(state.members, [alice, founder].sort());
});

test("two independent verifiers agree (ambient verifiability)", async () => {
  const { charter, signedClaims } = await scenario();
  // Simulate two parties verifying the same wire bytes independently.
  const wire = JSON.parse(JSON.stringify([charter, ...signedClaims]));
  const v1 = await verifyRecords(wire, resolveKey);
  const v2 = await verifyRecords(shuffle(wire), resolveKey);
  const s1 = deriveGuildState(v1.find((r) => r.type === "org.buildguild.charter"), v1.filter((r) => r.kind));
  const s2 = deriveGuildState(v2.find((r) => r.type === "org.buildguild.charter"), v2.filter((r) => r.kind));
  assert.equal(canonicalize(s1), canonicalize(s2));
});
