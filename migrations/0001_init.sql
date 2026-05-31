-- Production migration: same shape as schema.sql but non-destructive
-- (no DROP / DELETE). Safe to apply to the remote D1 database, including
-- via the CI deploy workflow's `wrangler d1 migrations apply`.

CREATE TABLE IF NOT EXISTS builders (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  handle       TEXT UNIQUE NOT NULL,
  did          TEXT DEFAULT '',
  display_name TEXT NOT NULL,
  klass        TEXT NOT NULL DEFAULT 'Generalist',
  tagline      TEXT DEFAULT '',
  bio          TEXT DEFAULT '',
  avatar       TEXT DEFAULT '',
  seeking      TEXT DEFAULT '',
  ai_augmented INTEGER NOT NULL DEFAULT 1,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS skills (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  builder_id INTEGER NOT NULL,
  name       TEXT NOT NULL,
  peak       INTEGER NOT NULL CHECK (peak BETWEEN 1 AND 100),
  FOREIGN KEY (builder_id) REFERENCES builders(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS projects (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  builder_id  INTEGER NOT NULL,
  name        TEXT NOT NULL,
  description TEXT DEFAULT '',
  help_wanted TEXT DEFAULT '',
  url         TEXT DEFAULT '',
  FOREIGN KEY (builder_id) REFERENCES builders(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS guilds (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT UNIQUE NOT NULL,
  charter    TEXT DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS guild_members (
  guild_id   INTEGER NOT NULL,
  builder_id INTEGER NOT NULL,
  role       TEXT NOT NULL DEFAULT 'member',
  joined_at  TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (guild_id, builder_id),
  FOREIGN KEY (guild_id)   REFERENCES guilds(id)   ON DELETE CASCADE,
  FOREIGN KEY (builder_id) REFERENCES builders(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_skills_builder ON skills(builder_id);
CREATE INDEX IF NOT EXISTS idx_projects_builder ON projects(builder_id);
CREATE INDEX IF NOT EXISTS idx_guild_members_guild ON guild_members(guild_id);
CREATE INDEX IF NOT EXISTS idx_guild_members_builder ON guild_members(builder_id);
