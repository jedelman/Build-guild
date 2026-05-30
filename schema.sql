-- Build Guild schema. Re-runnable: drops and recreates everything.
DROP TABLE IF EXISTS guild_members;
DROP TABLE IF EXISTS projects;
DROP TABLE IF EXISTS skills;
DROP TABLE IF EXISTS guilds;
DROP TABLE IF EXISTS builders;

-- A builder = a member's character sheet.
CREATE TABLE builders (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  handle       TEXT UNIQUE NOT NULL,            -- e.g. bsky handle
  display_name TEXT NOT NULL,
  klass        TEXT NOT NULL DEFAULT 'Generalist', -- archetype: Architect, Artificer, Druid...
  tagline      TEXT DEFAULT '',
  bio          TEXT DEFAULT '',
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
