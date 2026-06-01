// Canonical skill-vocabulary helpers.
//
// Pure (no Worker/D1 deps) so they run under `node --test`. The slug is the
// identity key shared by the app's write path and the SQL backfill in
// migrations/0005_skill_catalog.sql: case-folded, trimmed, internal whitespace
// collapsed. Two spellings that slug-match are the same skill.
export function skillSlug(name = "") {
  return String(name).trim().replace(/\s+/g, " ").toLowerCase();
}

/**
 * Decide which PDS skill-record rkeys to put vs. delete when saving a form,
 * with data-loss safety baked in. This is the guard for the bug where saving on
 * one deployment (whose D1 index was stale/empty) deleted real records from the
 * user's single, shared PDS repo.
 *
 * @param {Array<{rkey:string}>} wanted   rows the user is saving (rkeys present)
 * @param {string[]|null} loadedKeys      rkeys actually read from the PDS into
 *   this form, or null if the repo could not be read.
 * @returns {{putKeys:string[], deleteKeys:string[]}}
 *
 * Invariant: we only ever delete a record that was BOTH loaded from the repo
 * into this form AND removed by the user. If loadedKeys is null (unknown repo
 * state) we delete nothing — upsert only — so a stale view can't destroy data.
 */
export function reconcileSkillKeys(wanted, loadedKeys) {
  const want = new Set((wanted || []).map((s) => s.rkey).filter(Boolean));
  const putKeys = [...want];
  if (!Array.isArray(loadedKeys)) return { putKeys, deleteKeys: [] };
  const deleteKeys = loadedKeys.filter((k) => k && !want.has(k));
  return { putKeys, deleteKeys };
}
