import { test } from "node:test";
import assert from "node:assert/strict";
import { reconcileSkillKeys } from "../src/skills.js";

test("deletes only records loaded from the repo that the user removed", () => {
  const wanted = [{ rkey: "rust" }, { rkey: "devops" }];
  const loaded = ["rust", "kubernetes"]; // kubernetes was loaded but dropped
  const { putKeys, deleteKeys } = reconcileSkillKeys(wanted, loaded);
  assert.deepEqual(putKeys.sort(), ["devops", "rust"]);
  assert.deepEqual(deleteKeys, ["kubernetes"]);
});

test("DATA SAFETY: never deletes when the repo could not be read (null)", () => {
  // The prod-wipe bug: form seeded from a stale/empty index, repo unknown.
  const wanted = [{ rkey: "rust" }];
  const { putKeys, deleteKeys } = reconcileSkillKeys(wanted, null);
  assert.deepEqual(putKeys, ["rust"]);
  assert.deepEqual(deleteKeys, [], "must not delete real records on unknown repo state");
});

test("DATA SAFETY: records never loaded into the form are never deleted", () => {
  // User edits one skill; other real records exist in the repo but weren't shown.
  const wanted = [{ rkey: "rust" }];
  const loaded = ["rust"]; // only what the form actually loaded
  const { deleteKeys } = reconcileSkillKeys(wanted, loaded);
  assert.deepEqual(deleteKeys, []);
});

test("empty repo read (loaded=[]) with new skills: pure upsert, no deletes", () => {
  const wanted = [{ rkey: "rust" }, { rkey: "devops" }];
  const { putKeys, deleteKeys } = reconcileSkillKeys(wanted, []);
  assert.deepEqual(putKeys.sort(), ["devops", "rust"]);
  assert.deepEqual(deleteKeys, []);
});

test("removing all skills from a loaded form deletes exactly those", () => {
  const wanted = [];
  const loaded = ["rust", "devops"];
  const { putKeys, deleteKeys } = reconcileSkillKeys(wanted, loaded);
  assert.deepEqual(putKeys, []);
  assert.deepEqual(deleteKeys.sort(), ["devops", "rust"]);
});

test("ignores rows without an rkey (defensive)", () => {
  const wanted = [{ rkey: "rust" }, { name: "no-key" }];
  const { putKeys } = reconcileSkillKeys(wanted, ["rust"]);
  assert.deepEqual(putKeys, ["rust"]);
});
