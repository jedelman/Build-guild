// Designation — the authority/trust resolver (PURE, deterministic).
//
// Resolves "does DID X hold capability C in scope S?" from signed designation /
// acceptance / revocation records, replayed against a guild charter — the same
// recording-office model as governance.js. Two modes: `delegate` (act WITH the
// grantor's authority) and `trust` (the grantor relies on the grantee). See
// notes/designation-primitive.md.
//
// COLLECTIVE ROOT: authority does NOT flow from a single founder. The charter's
// `rules.root = { founders:[did,…], threshold:int }` says who the root authorities
// are and how many must consent to a root-level grant. A lone founder is just the
// degenerate { founders:[founder], threshold:1 } case. A root grant becomes
// effective only when ≥ threshold distinct root founders have co-signed it (the
// grant's author consents by authoring; others co-sign with an acceptance).

import { canonicalize } from "./governance.js";

const active = (r, now) => r && r._verified !== false && (!r.expiry || Date.parse(r.expiry) > now);
const inScope = (d, scope) => d.scope === scope || d.scope === "*" || scope === "*";

// Capabilities under `role:` are taken on by a person, so they require the
// grantee's acceptance to take effect (membership, officerships). Trust grants
// and resource capabilities (e.g. quest.transact) do not.
const needsAcceptance = (cap) => cap.startsWith("role:");

// To GRANT a role you must hold a role whose charter `can` permits it.
const grantAction = (cap) =>
  cap === "role:officer" ? "grant_role" : cap === "role:member" ? "admit" : null;

export function rootRule(charter) {
  const r = charter?.rules?.root;
  if (r && Array.isArray(r.founders) && r.founders.length)
    return { founders: [...r.founders], threshold: Math.max(1, r.threshold | 0 || 1) };
  return { founders: [charter.founder], threshold: 1 }; // degenerate single-founder root
}

// Authors who have filed an acceptance for a given record ref.
function acceptersOf(ref, acceptances) {
  const s = new Set();
  for (const a of acceptances) if (a?._verified !== false && a.subject === ref) s.add(a.author);
  return s;
}

// Resolve the full authority state for a charter from a record set. Returns
// queryable helpers; everything is computed by fixpoint over the designation set
// so it's order-independent and deterministic.
export function buildAuthority(charter, records, { now = Date.now() } = {}) {
  const designations = records.filter((r) => r.type === "org.buildguild.designation");
  const acceptances = records.filter((r) => r.type === "org.buildguild.acceptance");
  const revocations = records.filter((r) => r.type === "org.buildguild.revocation");
  const { founders, threshold } = rootRule(charter);
  const can = (role, action) =>
    !!role && Array.isArray(charter.rules?.roles?.[role]?.can) && charter.rules.roles[role].can.includes(action);

  const accepted = (d) => !needsAcceptance(d.capability) || acceptersOf(d._ref, acceptances).has(d.grantee);

  // A root grant (no `prev`, author is a root founder) is effective only when
  // ≥ threshold distinct founders consent — the collective-consent rule.
  const rootEffective = (d) => {
    if (!founders.includes(d.author) || d.prev) return false;
    const accs = acceptersOf(d._ref, acceptances);
    accs.add(d.author); // authoring is consent
    return founders.filter((f) => accs.has(f)).length >= threshold;
  };

  // Fixpoint: a designation counts if it's active, accepted, authorized by its
  // grantor (root collective, OR a granter holding a role that may grant it), and
  // not revoked by someone authorized to revoke it. Recompute until stable —
  // revocation makes this non-monotonic, so we iterate.
  let effective = new Set();
  const rolesOf = (did, scope, eff) => {
    const roles = [];
    if (founders.includes(did)) roles.push("founder");
    for (const d of designations)
      if (eff.has(d._ref) && d.grantee === did && d.capability.startsWith("role:") && inScope(d, scope))
        roles.push(d.capability.slice(5));
    return roles;
  };
  const authorizedGranter = (did, cap, scope, eff) => {
    const action = grantAction(cap);
    if (action == null) return false; // non-role caps aren't granted via guild roles
    return rolesOf(did, scope, eff).some((role) => can(role, action));
  };
  const revoked = (d, eff) => {
    for (const r of revocations) {
      if (r?._verified === false) continue;
      const match = r.target ? r.target === d._ref
        : r.grantee === d.grantee && r.capability === d.capability && r.scope === d.scope;
      if (!match) continue;
      if (r.author === d.author || authorizedGranter(r.author, d.capability, d.scope, eff)) return true;
    }
    return false;
  };

  for (let i = 0; i <= designations.length; i++) {
    const next = new Set();
    for (const d of designations) {
      if (!active(d, now) || !accepted(d)) continue;
      const authorized = !d.prev && founders.includes(d.author)
        ? rootEffective(d)
        : authorizedGranter(d.author, d.capability, d.scope, effective);
      if (authorized && !revoked(d, effective)) next.add(d._ref);
    }
    const stable = next.size === effective.size && [...next].every((x) => effective.has(x));
    effective = next;
    if (stable) break;
  }

  const holdsCapability = (did, cap, scope = "*") =>
    (cap === "role:founder" && founders.includes(did)) ||
    designations.some((d) => effective.has(d._ref) && d.grantee === did && d.capability === cap && inScope(d, scope));

  const trustees = (cap, scope = "*") =>
    [...new Set(designations.filter((d) => effective.has(d._ref) && d.mode === "trust" && d.capability === cap && inScope(d, scope)).map((d) => d.grantee))].sort();

  const members = (scope = "*") =>
    [...new Set([...founders, ...designations.filter((d) => effective.has(d._ref) && d.capability === "role:member" && inScope(d, scope)).map((d) => d.grantee)])].sort();

  return { founders, threshold, effective, holdsCapability, trustees, members, rolesOf: (d, s = "*") => rolesOf(d, s, effective) };
}
