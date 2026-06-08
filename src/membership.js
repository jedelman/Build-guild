// Guild membership = the derived set from signed claims (see notes/membership-use-cases.md).
// This module holds the pure logic shared by the Worker and the browser; the thin D1 glue
// (reprojectGuildMembers, in govstore.js) just persists what projectMembership computes.
import { deriveGuild } from "./guild.js";
import { defaultCharter } from "./charter.js";

// Pure membership projection. Given the guild's founder genesis DIDs and its VERIFIED claim
// records, return the live roster as { members:[did], roles: Map<did,role>, derived }.
// Founders are the server-asserted bootstrap (role "founder"); everyone else is claim-
// derived ("member"). With no adopted charter a synthesized open-join default applies, so a
// brand-new guild is still governable + joinable. Charter selection matches
// guildGraphFromRecords (genesis charter with prev==null, else the first).
export function projectMembership(guildId, founderDids = [], records = [], { now = Date.now() } = {}) {
  const charters = records.filter((r) => r.type === "org.buildguild.charter" && r._verified !== false);
  const adopted = charters.find((r) => r.prev == null) ?? charters[0] ?? null;
  const genesis = [...new Set([...(adopted?.rules?.genesis || []), ...founderDids])];
  const charter = adopted
    ? { ...adopted, rules: { ...adopted.rules, genesis } }
    : defaultCharter(guildId, genesis);
  const derived = deriveGuild(charter, records, { now });
  const founders = new Set(founderDids);
  const roles = new Map(derived.members.map((did) => [did, founders.has(did) ? "founder" : "member"]));
  return { members: derived.members, roles, derived };
}

// "Recruit follows the charter": decide, purely from the rules + the derived guild, how
// `actor` would admit `target`. The browser uses this to pick the flow when you click
// Recruit (or Join), and the Worker can use it to authorize. Returns one of:
//   "self"    — open-join self-admit (actor === target, openJoin)
//   "grant"   — actor may admit directly (designation + the recruit's acceptance)
//   "propose" — actor is a member without admit power → open an admit vote
//   "denied"  — actor may not admit target
export function admitPath(charter, derived, actor, target) {
  const rules = charter?.rules || {};
  const openJoin = rules.membership?.openJoin === true;
  if (actor === target) return openJoin ? "self" : "denied";

  const memberCan = Array.isArray(rules.roles?.member?.can) ? rules.roles.member.can : [];
  const guild = charter?.guild ?? "*";
  const canAdmit =
    derived.holdsCapability(actor, "admit", guild) ||
    (derived.isMember(actor) && memberCan.includes("admit"));
  if (canAdmit) return "grant";
  if (derived.isMember(actor)) return "propose";
  return "denied";
}
