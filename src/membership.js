// Guild membership = the derived set from signed claims (see notes/membership-use-cases.md).
// This module holds the pure decision logic shared by the Worker and the browser; the DB
// projection (reprojectGuildMembers) lands in phase 2.

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
