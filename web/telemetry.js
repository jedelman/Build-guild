// Client telemetry — OpenTelemetry web SDK with tail-sampling.
//
// We instrument the browser (page load, every /api fetch, uncaught errors) but
// hold finished spans in a bounded in-memory ring buffer and NEVER export on a
// schedule. The buffer is uploaded to /api/telemetry only when something goes
// wrong (window error / unhandled rejection / a failed login) or when the user
// hits "Report a bug". A clean happy-path session uploads nothing.
//
// Privacy: spans carry public identifiers + technical attributes only; the
// Worker redacts tokens/PKCE/sensitive query params on ingest as a backstop.

import { trace, SpanStatusCode } from "@opentelemetry/api";
import { WebTracerProvider, StackContextManager } from "@opentelemetry/sdk-trace-web";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from "@opentelemetry/semantic-conventions";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { registerInstrumentations } from "@opentelemetry/instrumentation";
import { FetchInstrumentation } from "@opentelemetry/instrumentation-fetch";

const SERVICE = "build-guild-web";
const TELEMETRY_PATH = "/api/telemetry";
const MAX_SPANS = 300;

let exporter;
let buffer = [];
let started = false;
let flushing = false;

// Tail-sampling processor: keep ended spans, export nothing on its own.
class BufferingSpanProcessor {
  onStart() {}
  onEnd(span) {
    buffer.push(span);
    if (buffer.length > MAX_SPANS) buffer.shift();
  }
  forceFlush() {
    return Promise.resolve();
  }
  shutdown() {
    return Promise.resolve();
  }
}

const tracer = () => trace.getTracer(SERVICE);

export function initTelemetry() {
  if (started) return;
  started = true;

  const sessionId = crypto.randomUUID ? crypto.randomUUID() : String(Date.now() + Math.random());
  exporter = new OTLPTraceExporter({ url: location.origin + TELEMETRY_PATH });

  const provider = new WebTracerProvider({
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]: SERVICE,
      [ATTR_SERVICE_VERSION]: "0.1.0",
      "session.id": sessionId,
      // path only — never the query string (the OAuth callback carries code/state)
      "page.path": location.pathname,
    }),
    spanProcessors: [new BufferingSpanProcessor()],
  });
  provider.register({ contextManager: new StackContextManager() });

  registerInstrumentations({
    instrumentations: [
      new FetchInstrumentation({
        ignoreUrls: [/\/api\/telemetry/], // never trace the upload itself
        clearTimingResources: true,
      }),
    ],
  });

  addEventListener("error", (e) => {
    recordError(e.error || e.message, "window.error");
    flush("error");
  });
  addEventListener("unhandledrejection", (e) => {
    recordError(e.reason, "unhandledrejection");
    flush("error");
  });
}

function recordError(err, source) {
  const msg = err && err.message ? err.message : String(err);
  const span = tracer().startSpan("client.error");
  span.setAttribute("error.source", source);
  span.setAttribute("error.message", String(msg).slice(0, 500));
  if (err && err.stack) span.setAttribute("error.stack", String(err.stack).slice(0, 2000));
  span.setStatus({ code: SpanStatusCode.ERROR, message: String(msg).slice(0, 200) });
  span.end();
}

// Wrap an async step in a span so its timing + outcome land in the trace.
export async function withSpan(name, fn, attrs = {}) {
  const span = tracer().startSpan(name);
  for (const [k, v] of Object.entries(attrs)) span.setAttribute(k, v);
  try {
    return await fn();
  } catch (e) {
    span.setStatus({ code: SpanStatusCode.ERROR, message: String(e?.message || e).slice(0, 200) });
    span.setAttribute("error.message", String(e?.message || e).slice(0, 500));
    throw e;
  } finally {
    span.end();
  }
}

// Upload the buffered spans plus a marker describing why. Called on errors,
// failed logins, and manual bug reports.
export async function flush(reason, note) {
  if (!started || flushing || !exporter) return;
  flushing = true;
  try {
    const marker = tracer().startSpan("telemetry.report");
    marker.setAttribute("report.reason", reason || "manual");
    marker.setAttribute("report.path", location.pathname);
    if (note) marker.setAttribute("report.note", String(note).slice(0, 1000));
    marker.end();

    const spans = buffer.slice();
    buffer = [];
    await new Promise((resolve) => {
      try {
        exporter.export(spans, () => resolve());
      } catch {
        resolve();
      }
    });
  } finally {
    flushing = false;
  }
}

export const reportBug = (note) => flush("manual", note);
