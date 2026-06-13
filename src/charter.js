// The default guild charter — shared verbatim by the Worker (membership derivation,
// seeding) and the browser (the "adopt charter" + charter-builder UI), so a guild
// created with defaults derives identically wherever it's verified.
//
// Founder-free model: `genesis` is the founding cohort; all authority thereafter comes
// from passed microvotes (integer-percent bars per action) or recallable mandates — no
// standing officer class. `membership.openJoin` lets anyone self-admit (the public
// commons default); set it false for an invite/vote-only guild. `requireAcceptance` is
// advisory — the engine ALWAYS requires a newcomer to co-sign a grant before it takes
// effect (see deriveGuild); self-grants are self-consented.

export const DEFAULT_VOTE_BARS = {
  admit: { threshold: 50, quorum: 50 },
  remove: { threshold: 50, quorum: 50 },
  grant_mandate: { threshold: 60, quorum: 50 },
  recall: { threshold: 34, quorum: 25 },
  amend: { threshold: 75, quorum: 60 },
  default: { threshold: 50, quorum: 50 },
};

// The actions a charter can set a vote bar on — the canonical list the builder UI renders.
export const VOTE_ACTIONS = ["admit", "remove", "grant_mandate", "recall", "amend"];

export const DEFAULT_RULES = (genesis = []) => ({
  genesis,
  vote: { ...DEFAULT_VOTE_BARS },
  // Open commons by default: members may propose, vote, AND invite (admit directly — the
  // invitee still co-signs). A curated guild drops "admit" so admission goes to a vote.
  roles: { member: { can: ["propose", "vote", "admit"] } },
  // Open commons by default: anyone may self-join; recruits still co-sign to join.
  membership: { openJoin: true, requireAcceptance: true },
});

// A full charter object usable by deriveGuild/deriveCollective. `overrides.rules` is
// shallow-merged over the defaults so a partial rules patch (e.g. just custom vote bars)
// still yields a complete, valid charter.
export const defaultCharter = (guildId, genesis = [], overrides = {}) => ({
  type: "org.buildguild.charter",
  guild: String(guildId),
  version: 0, // 0 = synthesized default (no signed charter adopted yet)
  prose: overrides.prose || "",
  ...overrides,
  rules: { ...DEFAULT_RULES(genesis), ...(overrides.rules || {}) },
});
