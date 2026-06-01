-- Consensus skills (#8 PR 3): peer endorsements. Each row INDEXES an
-- org.buildguild.endorsement record that lives in the ENDORSER's atproto repo
-- (source of truth); D1 mirrors it for fast reads and, later, consensus math.
--
-- We store the raw endorser identity and the strongRef to the endorsed skill
-- record. The endorser↔subject *relationship tier* (none / guildmate /
-- guild_leader / client) is computed at read time from guild membership etc.,
-- not stored, so it stays correct as relationships change.

CREATE TABLE IF NOT EXISTS endorsements (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  endorser_did  TEXT NOT NULL,
  subject_did   TEXT NOT NULL,
  skill_slug    TEXT NOT NULL,
  skill_name    TEXT NOT NULL DEFAULT '',
  skill_at_uri  TEXT NOT NULL DEFAULT '',  -- strongRef.uri (endorsee's skill record)
  skill_cid     TEXT NOT NULL DEFAULT '',  -- strongRef.cid (exact version vouched for)
  at_uri        TEXT NOT NULL DEFAULT '',  -- the endorsement record itself
  cid           TEXT NOT NULL DEFAULT '',
  note          TEXT NOT NULL DEFAULT '',
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  -- One endorsement per (endorser, subject, skill); re-indexing upserts.
  UNIQUE (endorser_did, subject_did, skill_slug)
);

CREATE INDEX IF NOT EXISTS idx_endorse_subject ON endorsements(subject_did, skill_slug);
CREATE INDEX IF NOT EXISTS idx_endorse_endorser ON endorsements(endorser_did);
