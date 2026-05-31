// Telemetry ingest: accept OTLP/HTTP JSON trace uploads from the browser and
// store them (redacted) in D1 so they're queryable for debugging. We never
// retain tokens or secrets — see redactPayload below and the no-PII guardrail.

const MAX_BYTES = 512 * 1024;

// Attribute keys whose values are dropped wholesale.
const SENSITIVE_KEY = /(authorization|cookie|dpop|password|secret|token|code_verifier|code_challenge|nonce)/i;
// Patterns scrubbed out of any free-text string value.
const JWT = /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g;
const BEARER = /Bearer\s+[A-Za-z0-9._~+/\-]+=*/gi;
const QS_SECRET =
  /([?&](?:code|state|token|access_token|refresh_token|id_token|nonce|code_verifier|code_challenge|dpop)=)[^&#\s"']+/gi;

export const scrub = (s) =>
  String(s).replace(JWT, "[jwt]").replace(BEARER, "Bearer [redacted]").replace(QS_SECRET, "$1[redacted]");

function redactAttributes(attrs) {
  if (!Array.isArray(attrs)) return attrs;
  return attrs.map((a) => {
    if (!a || typeof a.key !== "string" || !a.value || typeof a.value !== "object") return a;
    if (SENSITIVE_KEY.test(a.key)) {
      const v = {};
      for (const k of Object.keys(a.value)) v[k] = k.endsWith("Value") ? "[redacted]" : a.value[k];
      return { key: a.key, value: v };
    }
    if (typeof a.value.stringValue === "string") {
      return { key: a.key, value: { ...a.value, stringValue: scrub(a.value.stringValue) } };
    }
    return a;
  });
}

/** Redact an OTLP payload in place and return it. */
export function redactPayload(payload) {
  for (const r of payload?.resourceSpans || []) {
    if (r.resource?.attributes) r.resource.attributes = redactAttributes(r.resource.attributes);
    for (const ss of r.scopeSpans || []) {
      for (const span of ss.spans || []) {
        if (span.name) span.name = scrub(span.name);
        if (span.attributes) span.attributes = redactAttributes(span.attributes);
        if (span.status?.message) span.status.message = scrub(span.status.message);
        for (const ev of span.events || []) {
          if (ev.name) ev.name = scrub(ev.name);
          if (ev.attributes) ev.attributes = redactAttributes(ev.attributes);
        }
      }
    }
  }
  return payload;
}

const attr = (attrs, key) => {
  const a = (attrs || []).find((x) => x.key === key);
  return a ? a.value?.stringValue ?? a.value?.intValue ?? "" : "";
};

// OTLP/HTTP success is any 2xx with a JSON body the exporter can parse.
const ok = () =>
  new Response("{}", { status: 200, headers: { "content-type": "application/json" } });

export async function ingestTelemetry(env, request) {
  const ua = (request.headers.get("user-agent") || "").slice(0, 300);
  const raw = await request.text();
  if (raw.length > MAX_BYTES) {
    return new Response(JSON.stringify({ error: "payload too large" }), {
      status: 413,
      headers: { "content-type": "application/json" },
    });
  }
  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    return new Response(JSON.stringify({ error: "invalid JSON" }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }

  redactPayload(payload);
  const spans = (payload.resourceSpans || []).flatMap((r) =>
    (r.scopeSpans || []).flatMap((s) => s.spans || [])
  );
  const resAttrs = payload.resourceSpans?.[0]?.resource?.attributes || [];
  const reason =
    spans.map((s) => attr(s.attributes, "report.reason")).find(Boolean) || "error";

  await env.DB.prepare(
    `INSERT INTO telemetry_reports (id, session_id, trace_id, reason, span_count, user_agent, payload)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      crypto.randomUUID(),
      String(attr(resAttrs, "session.id")),
      spans[0]?.traceId || "",
      String(reason),
      spans.length,
      ua,
      JSON.stringify(payload)
    )
    .run();

  return ok();
}
