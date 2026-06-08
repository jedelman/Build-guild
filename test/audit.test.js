// Fraud-detection lens (src/audit.js): the reference auditor algorithm that makes
// collusion + un-evidenced payments detectable now that there's no escrow tax.
import { test } from "node:test";
import assert from "node:assert/strict";
import { auditTrail } from "../src/audit.js";

const att = (attester, subject) => ({ attester, subject, value: "yes", _verified: true });

test("flags a closed collusion ring (members only attest each other)", () => {
  const ring = [att("A", "B"), att("B", "A"), att("B", "C"), att("C", "B"), att("A", "C"), att("C", "A")];
  const { rings, flags } = auditTrail(ring, []);
  assert.equal(rings.length, 1);
  assert.deepEqual(rings[0], ["A", "B", "C"]);
  assert.ok(flags.some((f) => f.type === "insular_ring"));
});

test("an honest graph with outside attestations is NOT flagged as a ring", () => {
  // A,B,C reciprocate, but each also attests real outsiders → not insular.
  const honest = [
    att("A", "B"), att("B", "A"),
    att("B", "C"), att("C", "B"),
    att("A", "client1"), att("C", "client2"),
  ];
  const { rings } = auditTrail(honest, []);
  assert.equal(rings.length, 0);
});

test("flags reciprocal back-scratching pairs", () => {
  const { reciprocal } = auditTrail([att("X", "Y"), att("Y", "X"), att("X", "Z")], []);
  assert.deepEqual(reciprocal, [["X", "Y"]]);
});

test("flags settlements with no checkable evidence; passes evidenced ones", () => {
  const events = [
    { _verified: true, _ref: "s1", body: { quest: 1, paymentRef: "venmo:txn_abc" } },
    { _verified: true, _ref: "s2", body: { quest: 2, evidence: [{ type: "txid", value: "0xabc" }] } },
    { _verified: true, _ref: "s3", body: { quest: 3 } }, // no evidence at all
  ];
  const { unevidenced } = auditTrail([], events);
  assert.deepEqual(unevidenced, ["s3"]);
});

test("ignores unverified attestations", () => {
  const recs = [att("A", "B"), { ...att("B", "A"), _verified: false }];
  const { reciprocal } = auditTrail(recs, []);
  assert.equal(reciprocal.length, 0); // B->A didn't verify, so no reciprocity
});
