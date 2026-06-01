-- Code-host integration (#7), increment 1: linked repositories.
--
-- Indexes org.buildguild.repo records that live in each builder's atproto repo
-- (source of truth). Tangled repos are owned by the same DID as the builder, so
-- ownership is self-evident; other hosts are self-asserted (verified is for a
-- later increment that checks contribution history). Non-destructive.

CREATE TABLE IF NOT EXISTS repos (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  builder_id  INTEGER NOT NULL,
  host        TEXT NOT NULL DEFAULT '',      -- 'tangled' | 'github' | ...
  name        TEXT NOT NULL DEFAULT '',
  url         TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  verified    INTEGER NOT NULL DEFAULT 0,    -- 1 when ownership is proven (Tangled = same DID)
  at_uri      TEXT NOT NULL DEFAULT '',
  cid         TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (builder_id) REFERENCES builders(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_repos_builder ON repos(builder_id);
