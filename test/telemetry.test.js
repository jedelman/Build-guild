import { test } from "node:test";
import assert from "node:assert/strict";
import { scrub, redactPayload } from "../src/telemetry.js";

test("scrub removes JWTs, bearer tokens, and OAuth query secrets", () => {
  assert.equal(scrub("header.eyJhbGc.payloadpart.sigpart end"), "header.[jwt] end");
  assert.equal(scrub("Authorization: Bearer abc.def-123"), "Authorization: Bearer [redacted]");
  const url = "https://x/api/auth/callback?code=SEKRET&state=ALSO&iss=https://bsky.social";
  const out = scrub(url);
  assert.match(out, /code=\[redacted\]/);
  assert.match(out, /state=\[redacted\]/);
  assert.match(out, /iss=https/); // non-secret params survive
  assert.doesNotMatch(out, /SEKRET|ALSO/);
});

test("redactPayload drops sensitive attribute values and scrubs strings", () => {
  const payload = {
    resourceSpans: [
      {
        resource: { attributes: [{ key: "authorization", value: { stringValue: "Bearer xyz" } }] },
        scopeSpans: [
          {
            spans: [
              {
                traceId: "t1",
                name: "HTTP GET",
                attributes: [
                  { key: "http.url", value: { stringValue: "https://x/cb?code=LEAK&ok=1" } },
                  { key: "dpop_proof", value: { stringValue: "eyJh.bbb.ccc" } },
                ],
                status: { message: "token eyJh.bbb.ccc failed" },
                events: [{ name: "evt", attributes: [{ key: "token", value: { stringValue: "abc123" } }] }],
              },
            ],
          },
        ],
      },
    ],
  };
  redactPayload(payload);
  const span = payload.resourceSpans[0].scopeSpans[0].spans[0];
  // sensitive-keyed attributes fully redacted
  assert.equal(payload.resourceSpans[0].resource.attributes[0].value.stringValue, "[redacted]");
  assert.equal(span.attributes[1].value.stringValue, "[redacted]"); // dpop_proof
  assert.equal(span.events[0].attributes[0].value.stringValue, "[redacted]"); // token
  // non-sensitive key keeps its value but secrets within are scrubbed
  assert.match(span.attributes[0].value.stringValue, /code=\[redacted\]/);
  assert.match(span.attributes[0].value.stringValue, /ok=1/);
  assert.match(span.status.message, /\[jwt\]/);
});
