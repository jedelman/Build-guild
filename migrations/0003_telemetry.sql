-- Client telemetry uploads (OpenTelemetry traces), redacted on ingest.
--
-- GUARDRAIL: no PII / secrets. The Worker scrubs tokens, JWTs, DPoP proofs,
-- and OAuth query params (code/state/…) before a payload is stored. Rows are
-- diagnostic traces (span timings, error messages, public identifiers) only.
CREATE TABLE IF NOT EXISTS telemetry_reports (
  id         TEXT PRIMARY KEY,
  session_id TEXT NOT NULL DEFAULT '',  -- groups all spans from one page session
  trace_id   TEXT NOT NULL DEFAULT '',
  reason     TEXT NOT NULL DEFAULT '',  -- error | login_error | manual
  span_count INTEGER NOT NULL DEFAULT 0,
  user_agent TEXT NOT NULL DEFAULT '',
  payload    TEXT NOT NULL,             -- redacted OTLP/HTTP JSON
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_telemetry_created ON telemetry_reports(created_at DESC);
