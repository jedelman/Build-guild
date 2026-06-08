-- Build Guild schema. Re-runnable: drops and recreates everything.
DROP TABLE IF EXISTS guild_members;
DROP TABLE IF EXISTS projects;
DROP TABLE IF EXISTS skills;
DROP TABLE IF EXISTS guilds;
DROP TABLE IF EXISTS builders;

-- A builder = a member's character sheet.
CREATE TABLE builders (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  handle       TEXT UNIQUE NOT NULL,            -- atproto/bsky handle, e.g. ada.bsky.social
  did          TEXT DEFAULT '',                 -- atproto DID once the handle is verified
  display_name TEXT NOT NULL,
  klass        TEXT NOT NULL DEFAULT 'Generalist', -- archetype: Architect, Artificer, Druid...
  tagline      TEXT DEFAULT '',
  bio          TEXT DEFAULT '',
  avatar       TEXT DEFAULT '',                 -- avatar URL (imported from Bluesky)
  seeking      TEXT DEFAULT '',                 -- what they're after: income, collaborators, both
  ai_augmented INTEGER NOT NULL DEFAULT 1,      -- "learned to leverage AI" (1/0)
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Skill peaks: the things a builder is genuinely great at (peak 1-100).
CREATE TABLE skills (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  builder_id INTEGER NOT NULL,
  name       TEXT NOT NULL,
  peak       INTEGER NOT NULL CHECK (peak BETWEEN 1 AND 100),
  FOREIGN KEY (builder_id) REFERENCES builders(id) ON DELETE CASCADE
);

-- Projects a builder is working on (and where they'd welcome help).
CREATE TABLE projects (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  builder_id  INTEGER NOT NULL,
  name        TEXT NOT NULL,
  description TEXT DEFAULT '',
  help_wanted TEXT DEFAULT '',
  url         TEXT DEFAULT '',
  FOREIGN KEY (builder_id) REFERENCES builders(id) ON DELETE CASCADE
);

-- A guild = a suitably diverse party of builders.
CREATE TABLE guilds (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT UNIQUE NOT NULL,
  charter    TEXT DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE guild_members (
  guild_id   INTEGER NOT NULL,
  builder_id INTEGER NOT NULL,
  role       TEXT NOT NULL DEFAULT 'member',    -- founder | officer | member
  joined_at  TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (guild_id, builder_id),
  FOREIGN KEY (guild_id)   REFERENCES guilds(id)   ON DELETE CASCADE,
  FOREIGN KEY (builder_id) REFERENCES builders(id) ON DELETE CASCADE
);

CREATE INDEX idx_skills_builder ON skills(builder_id);
CREATE INDEX idx_projects_builder ON projects(builder_id);
CREATE INDEX idx_guild_members_guild ON guild_members(guild_id);
CREATE INDEX idx_guild_members_builder ON guild_members(builder_id);

-- Claimstead governance + reputation (#21) + mock escrow (see migration 0010).
-- D1 is a non-authoritative index of SIGNED records; the verifier (governance.js)
-- recomputes validity. Mock escrow holds no real money.
CREATE TABLE IF NOT EXISTS gov_keys (
  did TEXT PRIMARY KEY, pubkey_jwk TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS gov_claims (
  ref TEXT PRIMARY KEY, guild TEXT NOT NULL DEFAULT '', kind TEXT NOT NULL,
  author_did TEXT NOT NULL, json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_gov_claims_guild ON gov_claims(guild);
CREATE INDEX IF NOT EXISTS idx_gov_claims_kind ON gov_claims(kind);
CREATE TABLE IF NOT EXISTS gov_attestations (
  ref TEXT PRIMARY KEY, subject_did TEXT NOT NULL, contract TEXT NOT NULL,
  attester_did TEXT NOT NULL, json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_gov_att_subject ON gov_attestations(subject_did);
CREATE TABLE IF NOT EXISTS escrow_holds (
  id INTEGER PRIMARY KEY AUTOINCREMENT, quest_id INTEGER NOT NULL, patron_did TEXT NOT NULL,
  amount_cents INTEGER NOT NULL, fee_bps INTEGER NOT NULL DEFAULT 290,
  state TEXT NOT NULL DEFAULT 'funded', payee_did TEXT NOT NULL DEFAULT '',
  settlement_ref TEXT NOT NULL DEFAULT '',
  payment_intent_id TEXT NOT NULL DEFAULT '', provider TEXT NOT NULL DEFAULT 'mock',
  created_at TEXT NOT NULL DEFAULT (datetime('now')), released_at TEXT,
  FOREIGN KEY (quest_id) REFERENCES quests(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_escrow_quest ON escrow_holds(quest_id);
CREATE TABLE IF NOT EXISTS connect_accounts (
  did TEXT PRIMARY KEY, account_id TEXT NOT NULL,
  charges_enabled INTEGER NOT NULL DEFAULT 0, payouts_enabled INTEGER NOT NULL DEFAULT 0,
  details_submitted INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
