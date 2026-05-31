-- Server-side auth flow log — full visibility into the OAuth handshake,
-- including successes (the "log 200s too" case), not just client errors.
--
-- GUARDRAIL: `detail` is scrubbed (same redaction as telemetry) before insert;
-- rows hold public identifiers (handle/DID) + step outcomes, never tokens.
CREATE TABLE IF NOT EXISTS auth_events (
  id         TEXT PRIMARY KEY,
  kind       TEXT NOT NULL,            -- login_init | login_error | callback_recv
                                       -- | callback_nostate | callback_error | callback_ok
  handle     TEXT NOT NULL DEFAULT '',
  did        TEXT NOT NULL DEFAULT '',
  detail     TEXT NOT NULL DEFAULT '',
  user_agent TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_auth_events_created ON auth_events(created_at DESC);
