// Canonical skill-vocabulary helpers.
//
// Pure (no Worker/D1 deps) so they run under `node --test`. The slug is the
// identity key shared by the app's write path and the SQL backfill in
// migrations/0005_skill_catalog.sql: case-folded, trimmed, internal whitespace
// collapsed. Two spellings that slug-match are the same skill.
export function skillSlug(name = "") {
  return String(name).trim().replace(/\s+/g, " ").toLowerCase();
}
