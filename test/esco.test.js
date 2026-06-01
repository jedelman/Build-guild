import { test } from "node:test";
import assert from "node:assert/strict";
import { parseEscoResults } from "../src/esco.js";

// Shape mirrors the real ESCO /search response (verified against the live API).
const sample = {
  _embedded: {
    results: [
      { title: "DevOps", uri: "http://data.europa.eu/esco/skill/f0de4973-0a70-4644-8fd4-3a97080476f4" },
      { title: "use software design patterns", uri: "http://data.europa.eu/esco/skill/abc-123" },
      { title: "an occupation", uri: "http://data.europa.eu/esco/occupation/should-be-dropped" },
      { title: "", uri: "http://data.europa.eu/esco/skill/no-title-dropped" },
    ],
  },
};

test("parseEscoResults keeps skill concepts with titles, drops the rest", () => {
  const out = parseEscoResults(sample);
  assert.deepEqual(out, [
    { title: "DevOps", uri: "http://data.europa.eu/esco/skill/f0de4973-0a70-4644-8fd4-3a97080476f4" },
    { title: "use software design patterns", uri: "http://data.europa.eu/esco/skill/abc-123" },
  ]);
});

test("parseEscoResults respects the limit and tolerates empty/odd input", () => {
  assert.equal(parseEscoResults(sample, 1).length, 1);
  assert.deepEqual(parseEscoResults({}), []);
  assert.deepEqual(parseEscoResults(null), []);
  assert.deepEqual(parseEscoResults({ results: [] }), []);
});
