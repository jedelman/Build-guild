// Pure guild math — no Worker or D1 dependencies, so it runs under `node --test`.
//
// The premise (from @codewright's thread): a guild's strength is the union of its
// members' *skill-peaks* — the things each person is genuinely great at. A good
// party covers many skills strongly, with each member championing something, and
// without everyone piling onto the same peak.

const STRONG = 70; // peak at or above this counts as a real, relied-upon strength.

// Consensus peak: a skill's strength is no longer self-rated — it's how strongly
// peers vouch for it. A declared-but-unendorsed skill sits at BASELINE; each
// endorsement lifts it toward 100 with diminishing returns, weighted by the
// endorser's relationship tier (a client's vouch counts more than a stranger's).
const BASELINE_PEAK = 55;
const TIER_WEIGHT = { none: 1, guildmate: 2, guild_leader: 3, client: 4 };
const SATURATION = 5; // higher → more endorsements needed to approach 100

/**
 * Consensus peak (1–100) for one skill from its endorsements.
 * peak = baseline + (100 - baseline) * S / (S + SATURATION), where S is the
 * sum of endorser tier weights. Monotonic, bounded, with diminishing returns.
 * @param {Array<{tier?:string}>} endorsements
 * @param {object} [opts] {baseline}
 */
export function consensusPeak(endorsements = [], { baseline = BASELINE_PEAK } = {}) {
  const S = endorsements.reduce((sum, e) => sum + (TIER_WEIGHT[e?.tier] ?? TIER_WEIGHT.none), 0);
  if (S <= 0) return baseline;
  const peak = baseline + (100 - baseline) * (S / (S + SATURATION));
  return Math.max(1, Math.min(100, Math.round(peak)));
}

/**
 * Collapse every member's skills into the guild's best-in-class map.
 * For each skill we keep the highest peak and remember who carries it.
 * @param {Array<{display_name:string, skills?:Array<{name:string,peak:number}>}>} members
 * @returns {Array<{name:string, peak:number, champion:string}>} sorted by peak desc
 */
export function guildSkillMap(members) {
  const best = new Map(); // lowercased name -> { name, peak, champion }
  for (const m of members) {
    for (const s of m.skills || []) {
      const key = s.name.trim().toLowerCase();
      const current = best.get(key);
      if (!current || s.peak > current.peak) {
        best.set(key, { name: s.name, peak: s.peak, champion: m.display_name });
      }
    }
  }
  return [...best.values()].sort((a, b) => b.peak - a.peak);
}

/**
 * For each member, the skills they are the guild's top performer in.
 * A healthy guild has every member championing at least one peak.
 */
export function championRoster(members) {
  const byChampion = new Map();
  for (const s of guildSkillMap(members)) {
    if (!byChampion.has(s.champion)) byChampion.set(s.champion, []);
    byChampion.get(s.champion).push(s.name);
  }
  return members.map((m) => ({
    display_name: m.display_name,
    champions: byChampion.get(m.display_name) || [],
  }));
}

/**
 * "Guild Power" — rewards complementary peaks, penalizes redundancy.
 *  + strongly-covered distinct skills (the union of peaks >= STRONG)
 *  + breadth of distinct skills
 *  + a modest bonus for party size
 *  - overlap (multiple members crowding the same skills)
 */
export function diversityScore(members) {
  const map = guildSkillMap(members);
  const distinct = map.length;
  const strong = map.filter((s) => s.peak >= STRONG).length;
  const totalEntries = members.reduce((n, m) => n + (m.skills?.length || 0), 0);
  const overlap = totalEntries ? (totalEntries - distinct) / totalEntries : 0;

  const raw = strong * 10 + distinct * 3 + members.length * 2 - overlap * 15;
  return Math.max(0, Math.round(raw));
}

/**
 * Rank parties (guilds, or individual builders as a party of one) by how well
 * their combined skill-map covers a quest's required skills. Reuses the same
 * "strong coverage" idea as Guild Power: a required skill is covered when some
 * member's peak on it is >= threshold; partial credit for a present-but-weak
 * skill. Pure, so it's unit-testable.
 *
 * @param {Array<{name:string}>} requiredSkills
 * @param {Array<{id:any, name:string, members:Array}>} parties  each with members[].skills
 * @returns ranked [{ party, coverage(0..1), covered:string[], missing:string[] }]
 */
export function rankPartiesForQuest(requiredSkills, parties, { threshold = STRONG } = {}) {
  const required = requiredSkills.map((s) => s.name.toLowerCase()).filter(Boolean);
  if (!required.length) return [];
  return parties
    .map((party) => {
      const best = guildSkillMap(party.members || []); // [{name, peak}]
      const peakByName = new Map(best.map((s) => [s.name.toLowerCase(), s.peak]));
      let score = 0;
      const covered = [];
      const missing = [];
      for (const r of required) {
        const peak = peakByName.get(r) || 0;
        if (peak >= threshold) {
          score += 1;
          covered.push(r);
        } else if (peak > 0) {
          score += 0.5; // present but not yet strong
          covered.push(r);
        } else {
          missing.push(r);
        }
      }
      return { party, coverage: score / required.length, covered, missing };
    })
    .sort((a, b) => b.coverage - a.coverage);
}

/**
 * Suggest recruits that fill the guild's gaps.
 * A candidate scores for every skill where they'd be strong (peak >= threshold)
 * and the guild currently is not, plus a smaller bump for raising an existing peak.
 * @returns ranked [{ builder, fit, fills:string[] }], best first, zero-fit dropped.
 */
export function recommendRecruits(members, candidates, { threshold = 60 } = {}) {
  const covered = new Map();
  for (const s of guildSkillMap(members)) covered.set(s.name.toLowerCase(), s.peak);

  return candidates
    .map((builder) => {
      let newStrong = 0;
      let raised = 0;
      const fills = [];
      for (const s of builder.skills || []) {
        const current = covered.get(s.name.toLowerCase()) || 0;
        if (s.peak >= threshold && current < threshold) {
          newStrong++;
          fills.push(s.name);
        } else if (s.peak > current) {
          raised++;
        }
      }
      return { builder, fit: newStrong * 10 + raised, fills };
    })
    .filter((r) => r.fit > 0)
    .sort((a, b) => b.fit - a.fit);
}
