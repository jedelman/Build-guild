-- Quests & bounties (#6), increment 1: the demand side of the guild.
--
-- A patron (any verified Bluesky DID) posts a quest declaring the canonical
-- skills it needs; a guild or individual builder claims it. Rewards are
-- free-text for now (honor/non-monetary) — no payments/PII in D1 yet; monetary
-- escrow via Stripe is a later increment. Identity is the patron's DID, so no
-- new PII either. Non-destructive.

CREATE TABLE IF NOT EXISTS quests (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  patron_did    TEXT NOT NULL,                 -- verified poster (Bluesky DID)
  patron_handle TEXT NOT NULL DEFAULT '',
  title         TEXT NOT NULL,
  brief         TEXT NOT NULL DEFAULT '',
  reward        TEXT NOT NULL DEFAULT '',      -- free text: "rev share", "$500", "kudos"
  status        TEXT NOT NULL DEFAULT 'open',  -- open | claimed | delivered | closed
  claimed_guild_id   INTEGER,                  -- the party that took it (a guild; 1-member guilds = individuals)
  claimed_builder_id INTEGER,                  -- or a single builder
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (claimed_guild_id)   REFERENCES guilds(id)   ON DELETE SET NULL,
  FOREIGN KEY (claimed_builder_id) REFERENCES builders(id) ON DELETE SET NULL
);

-- Canonical skills a quest needs (links to the shared catalog from #5).
CREATE TABLE IF NOT EXISTS quest_skills (
  quest_id  INTEGER NOT NULL,
  skill_id  INTEGER NOT NULL,
  name      TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (quest_id, skill_id),
  FOREIGN KEY (quest_id) REFERENCES quests(id)        ON DELETE CASCADE,
  FOREIGN KEY (skill_id) REFERENCES skill_catalog(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_quests_status ON quests(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_quest_skills_quest ON quest_skills(quest_id);
