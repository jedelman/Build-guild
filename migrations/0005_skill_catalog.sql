-- Consensus skills, step 1: a shared, canonical skill vocabulary.
--
-- Until now skills were free text (skills.name), and the guild math in
-- src/logic.js keyed off lower(name) — so "Rust", "rustlang", and "Rust "
-- silently fragmented into separate skills. This introduces a canonical
-- catalog that every builder skill points at: the prerequisite for peer
-- endorsements (and Guild Power) to aggregate per skill rather than per
-- spelling. Non-destructive (no DROP/DELETE) — safe for the CI deploy's
-- `wrangler d1 migrations apply`.
--
-- GUARDRAIL: no PII in D1. This table is public, builder-authored vocabulary.

CREATE TABLE IF NOT EXISTS skill_catalog (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  slug       TEXT UNIQUE NOT NULL,          -- canonical key: case-folded, trimmed
  name       TEXT NOT NULL,                 -- canonical display name
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Link each builder skill to its canonical entry. Nullable so ADD COLUMN is
-- non-destructive; backfilled just below and always set on write thereafter.
ALTER TABLE skills ADD COLUMN skill_id INTEGER REFERENCES skill_catalog(id);

-- Seed the catalog from existing free-text skills. The canonical display name
-- is the lexicographically-first spelling seen (MIN sorts capitalized "Rust"
-- ahead of "rust") — a stable, sensible default.
INSERT OR IGNORE INTO skill_catalog (slug, name)
  SELECT lower(trim(name)), MIN(trim(name))
    FROM skills
   GROUP BY lower(trim(name));

-- Point every existing skill at its catalog entry and canonicalize its display
-- name, so the still-name-keyed guild math stops fragmenting on spelling.
UPDATE skills
   SET skill_id = (SELECT id FROM skill_catalog c WHERE c.slug = lower(trim(skills.name)));
UPDATE skills
   SET name = (SELECT name FROM skill_catalog c WHERE c.id = skills.skill_id)
 WHERE skill_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_skills_skill ON skills(skill_id);
