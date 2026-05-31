-- OAuth (Bluesky / atproto) support.
--
-- GUARDRAIL: no PII in D1. These tables hold atproto DIDs/handles (public
-- identifiers) and opaque session/PKCE material — not emails, passwords, or
-- payment data. See "Data & privacy" in the README.

-- Short-lived state for an in-flight authorization request. A row is created
-- at /api/auth/login and consumed (deleted) at /api/auth/callback. Rows older
-- than a few minutes are stale and can be swept.
CREATE TABLE IF NOT EXISTS oauth_auth_state (
  state          TEXT PRIMARY KEY,          -- random, also the lookup key from the callback
  handle         TEXT NOT NULL,             -- handle the user is logging in as
  did            TEXT NOT NULL DEFAULT '',  -- resolved DID (if known before consent)
  pkce_verifier  TEXT NOT NULL,             -- PKCE code_verifier
  dpop_jwk       TEXT NOT NULL,             -- DPoP private key (JSON JWK) for this flow
  token_endpoint TEXT NOT NULL,             -- resolved authorization server token endpoint
  issuer         TEXT NOT NULL,             -- authorization server issuer (validated on callback)
  dpop_nonce     TEXT NOT NULL DEFAULT '',  -- most recent DPoP-Nonce from the auth server
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

-- A logged-in session. We mint our own opaque session id (cookie) once the
-- atproto handshake proves the user controls the DID. We deliberately do NOT
-- persist atproto access/refresh tokens yet: today we only need to verify
-- identity at login. (Token storage comes with the PDS-storage phase.)
CREATE TABLE IF NOT EXISTS sessions (
  id         TEXT PRIMARY KEY,              -- random session id stored in an httpOnly cookie
  did        TEXT NOT NULL,                 -- verified atproto DID
  handle     TEXT NOT NULL,                 -- handle at login time
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL                  -- ISO8601; checked on every authed request
);

CREATE INDEX IF NOT EXISTS idx_sessions_did ON sessions(did);
