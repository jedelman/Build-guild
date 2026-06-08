-- Claimstead governance + reputation (#21) + mock escrow.
--
-- D1 is the "title plant" — a convenience INDEX, NOT authoritative. Every row
-- carries the author's signature; validity is recomputed by the pure verifier
-- (src/governance.js). A browser-held device key (ECDSA P-256) signs claims; its
-- public key is registered to the session DID here so the server can verify them.
-- No new PII beyond the DID already stored. Mock escrow holds NO real money
-- (Stripe Connect is #18). Non-destructive.

-- did -> public key (JWK), used to verify that DID's signed claims/attestations.
CREATE TABLE IF NOT EXISTS gov_keys (
  did        TEXT PRIMARY KEY,
  pubkey_jwk TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Signed governance records: charter | admit | accept | role_grant | proposal |
-- vote | remove, plus 'quest' settlement events (escrow releases). Stored verbatim.
CREATE TABLE IF NOT EXISTS gov_claims (
  ref        TEXT PRIMARY KEY,           -- content id = sha-256 of the canonical signed record
  guild      TEXT NOT NULL DEFAULT '',   -- guild id this claim concerns ('' for global events)
  kind       TEXT NOT NULL,
  author_did TEXT NOT NULL,
  json       TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_gov_claims_guild ON gov_claims(guild);
CREATE INDEX IF NOT EXISTS idx_gov_claims_kind ON gov_claims(kind);

-- Signed reputation attestations (subject = the DID being attested about).
CREATE TABLE IF NOT EXISTS gov_attestations (
  ref          TEXT PRIMARY KEY,
  subject_did  TEXT NOT NULL,
  contract     TEXT NOT NULL,
  attester_did TEXT NOT NULL,
  json         TEXT NOT NULL,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_gov_att_subject ON gov_attestations(subject_did);

-- Mock escrow holds (NO real money; Stripe Connect is #18).
CREATE TABLE IF NOT EXISTS escrow_holds (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  quest_id     INTEGER NOT NULL,
  patron_did   TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  fee_bps      INTEGER NOT NULL DEFAULT 290,
  state        TEXT NOT NULL DEFAULT 'funded',  -- funded | released | refunded
  payee_did    TEXT NOT NULL DEFAULT '',
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  released_at  TEXT,
  FOREIGN KEY (quest_id) REFERENCES quests(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_escrow_quest ON escrow_holds(quest_id);
