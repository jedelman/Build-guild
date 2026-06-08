// Unified guild authority — collective ROOT + delegated grants BELOW it (PURE).
//
// deriveCollective gives the founder-free root: members + scoped mandates from passed
// microvotes. This layer adds DELEGATED ADMIT (delegated grants generally): a member who
// holds an `admit` mandate may issue an org.buildguild.designation granting `role:member`
// DIRECTLY — no per-admit vote — which the newcomer co-signs (org.buildguild.acceptance)
// and which stays revocable (org.buildguild.revocation) and auditable as its own act.
//
// Authority for a delegated admit is a COLLECTIVE MANDATE (granted by vote), not a founder
// — or, if the charter's member role `can: ["admit"]`, open admission (any member admits).
// This is the capability-chain idea from the spec (§6) re-rooted on the founder-free
// collective: membership is a designation, authorized by a recallable mandate rather than a
// standing officer. See notes/designation-primitive.md §8.
import { deriveCollective } from "./collective.js";
import { buildGraph } from "./graph.js";

const active = (r, now) => r && r._verified !== false && (!r.expiry || Date.parse(r.expiry) > now);
const inScope = (s, scope) => s === scope || s === "*" || scope === "*";

export function deriveGuild(charter, records, { now = Date.now() } = {}) {
  const col = deriveCollective(charter, records, { now });
  const guild = charter.guild;
  const mine = (r) => r && r._verified !== false && (r.guild === guild || r.guild == null);
  const designations = records.filter((r) => mine(r) && r.type === "org.buildguild.designation");
  const acceptances = records.filter((r) => mine(r) && r.type === "org.buildguild.acceptance");
  const revocations = records.filter((r) => mine(r) && r.type === "org.buildguild.revocation");

  // role: capabilities take effect only when the DESIGNEE co-signs (acceptance.author == grantee).
  const accepted = (d) => acceptances.some((a) => a._verified !== false && a.subject === d._ref && a.author === d.grantee);
  const memberRoleCan = (action) => Array.isArray(charter.rules?.roles?.member?.can) && charter.rules.roles.member.can.includes(action);

  const members = new Set(col.members);
  const liveMandates = col.mandates;
  const holds = (did, cap, scope = "*") =>
    liveMandates.some((m) => m.grantee === did && m.capability === cap && inScope(m.scope, scope)) ||
    (cap === "role:member" && members.has(did));
  // who may issue a delegated admit: an `admit` mandate-holder, or any member if the
  // charter opens admission to the member role.
  const canAdmit = (did) => holds(did, "admit", guild) || (members.has(did) && memberRoleCan("admit"));

  const revoked = (d) => revocations.some((r) =>
    active(r, now) &&
    (r.target === d._ref || (r.grantee === d.grantee && r.capability === d.capability && (r.scope == null || r.scope === d.scope))) &&
    (r.author === d.author || canAdmit(r.author))); // grantor, or anyone who could have granted it

  // Fixpoint: add members admitted by an authorized, accepted, un-revoked delegated grant.
  // Iterate because a delegated-admitted member who ALSO holds an admit mandate (or open
  // admission) may admit further. Order-independent (set-based), so two verifiers agree.
  const admittedVia = new Map(); // grantee → designation ref
  for (let i = 0; i <= designations.length; i++) {
    let changed = false;
    for (const d of designations) {
      if (d.capability !== "role:member" || !inScope(d.scope, guild) || members.has(d.grantee)) continue;
      if (!active(d, now) || !accepted(d) || !canAdmit(d.author) || revoked(d)) continue;
      members.add(d.grantee); admittedVia.set(d.grantee, d._ref); changed = true;
    }
    if (!changed) break;
  }

  const liveMembers = [...members].sort();
  return {
    ...col,
    members: liveMembers,
    isMember: (did) => members.has(did),
    holdsCapability: (did, cap, scope = "*") => holds(did, cap, scope),
    // who was admitted by delegation (vs by the genesis cohort or a passed admit vote)
    delegatedAdmits: [...admittedVia.entries()]
      .map(([grantee, via]) => ({ grantee, via, by: designations.find((d) => d._ref === via)?.author }))
      .sort((a, b) => (a.grantee < b.grantee ? -1 : 1)),
  };
}

// Assemble the live commons payload (the debug-view shape) from VERIFIED records. PURE, so
// it runs identically offline (the sim) and online (the API), and is testable without D1.
export function guildGraphFromRecords(records, { now = Date.now() } = {}) {
  const graph = buildGraph(records);
  const charter = records.find((r) => r.type === "org.buildguild.charter" && r._verified !== false);
  let collective = null;
  if (charter) {
    const g = deriveGuild(charter, records, { now });
    collective = {
      head: g.head,
      members: g.members,
      mandates: g.mandates.map((m) => ({ grantee: m.grantee, capability: m.capability, scope: m.scope, mode: m.mode })),
      proposals: Object.values(g.proposals).map((p) => ({ ref: p.ref, action: p.action, outcome: p.outcome, basis: p.basis, tally: p.tally })),
      delegatedAdmits: g.delegatedAdmits,
      staleVotes: g.staleVotes,
    };
  }
  return { charter: charter ? { version: charter.version, prose: charter.prose } : null, collective, graph, records };
}
