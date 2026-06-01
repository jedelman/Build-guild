import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyRepo } from "../src/skills.js";

test("a Tangled repo under the builder's own handle is verified", () => {
  const r = classifyRepo("https://tangled.sh/@alice.test/myrepo", { handle: "alice.test" });
  assert.deepEqual(r, { host: "tangled", verified: true });
});

test("a Tangled repo under the builder's DID is verified", () => {
  const r = classifyRepo("https://tangled.sh/did:plc:abc/repo", { did: "did:plc:abc" });
  assert.equal(r.host, "tangled");
  assert.equal(r.verified, true);
});

test("someone else's Tangled repo is not verified", () => {
  const r = classifyRepo("https://tangled.sh/@bob.test/repo", { handle: "alice.test" });
  assert.deepEqual(r, { host: "tangled", verified: false });
});

test("GitHub/GitLab are recognized but unverified (self-asserted)", () => {
  assert.deepEqual(classifyRepo("https://github.com/alice/repo", { handle: "alice.test" }), {
    host: "github",
    verified: false,
  });
  assert.equal(classifyRepo("https://gitlab.com/alice/repo").host, "gitlab");
});

test("unknown host → other; junk URL → empty host, unverified", () => {
  assert.equal(classifyRepo("https://example.com/x").host, "other");
  assert.deepEqual(classifyRepo("not a url"), { host: "", verified: false });
});
