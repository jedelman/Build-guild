import { test } from "node:test";
import assert from "node:assert/strict";
import { endorsementTier, ENDORSEMENT_TIERS } from "../src/skills.js";

const A = "did:plc:endorser", B = "did:plc:subject";

test("no relationship → none", () => {
  assert.equal(endorsementTier({ endorserDid: A, subjectDid: B }), "none");
});

test("self-endorsement → none", () => {
  assert.equal(endorsementTier({ endorserDid: A, subjectDid: A }), "none");
});

test("shared guild → guildmate", () => {
  const memberships = [
    { guild_id: 1, did: A, role: "member" },
    { guild_id: 1, did: B, role: "member" },
  ];
  assert.equal(endorsementTier({ endorserDid: A, subjectDid: B, memberships }), "guildmate");
});

test("endorser leads a shared guild → guild_leader", () => {
  const memberships = [
    { guild_id: 7, did: A, role: "founder" },
    { guild_id: 7, did: B, role: "member" },
  ];
  assert.equal(endorsementTier({ endorserDid: A, subjectDid: B, memberships }), "guild_leader");
});

test("leader role only counts in a guild they actually share", () => {
  const memberships = [
    { guild_id: 1, did: A, role: "founder" }, // A leads guild 1, but B isn't in it
    { guild_id: 2, did: A, role: "member" },  // shared guild 2, A is just a member
    { guild_id: 2, did: B, role: "member" },
  ];
  assert.equal(endorsementTier({ endorserDid: A, subjectDid: B, memberships }), "guildmate");
});

test("client relationship outranks guild ties", () => {
  const memberships = [
    { guild_id: 1, did: A, role: "founder" },
    { guild_id: 1, did: B, role: "member" },
  ];
  const clients = [{ client_did: A, builder_did: B }];
  assert.equal(endorsementTier({ endorserDid: A, subjectDid: B, memberships, clients }), "client");
});

test("client edge is directional (client→builder, not the reverse)", () => {
  const clients = [{ client_did: B, builder_did: A }];
  assert.equal(endorsementTier({ endorserDid: A, subjectDid: B, clients }), "none");
});

test("ENDORSEMENT_TIERS is ranked weakest→strongest", () => {
  assert.deepEqual(ENDORSEMENT_TIERS, ["none", "guildmate", "guild_leader", "client"]);
});
