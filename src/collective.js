// Collective — founder-free guild authority (PURE, deterministic).
//
// Anarcho-syndicalist model: NO durable founder, no standing officer class. The
// membership is sovereign; authority comes only from passed microvotes. "Officers"
// are scoped, recallable DELEGATE MANDATES — a member is mandated by vote to carry a
// bounded capability, and the collective can recall it (typically at a lower bar
// than granting it). Founding is just ratifying the genesis charter: the genesis
// cohort are the initial members and hold no special power thereafter.
//
// State is derived by TEMPORAL REPLAY: proposals are decided in close-time order,
// each tallied against the electorate (members) AS OF THAT MOMENT, and a passed
// proposal mutates the membership / mandates that later proposals are judged
// against. This is the price of vote-rooted (not founder-rooted) authority.
//
// Reuses the existing primitives: org.buildguild.proposal carries an `action` +
// `enacts`; a vote is an org.buildguild.attestation (contract "vote", subject =
// proposal). See notes/designation-primitive.md.

const active = (r, now) => r && r._verified !== false && (!r.expiry || Date.parse(r.expiry) > now);
const inScope = (m, scope) => m.scope === scope || m.scope === "*" || scope === "*";
const DEFAULT_RULE = { threshold: 50, quorum: 50 }; // integer percents

function applyEffect(P, members, mandates) {
  const e = P.enacts || {};
  switch (P.action) {
    case "admit": if (e.grantee) members.add(e.grantee); break;
    case "remove": if (e.grantee) members.delete(e.grantee); break;
    case "grant_mandate":
      if (e.grantee && e.capability)
        mandates.push({ grantee: e.grantee, capability: e.capability, scope: e.scope ?? "*", mode: e.mode ?? "delegate", via: P._ref, active: true });
      break;
    case "recall":
      for (const m of mandates)
        if (m.via === e.target || (e.grantee && m.grantee === e.grantee && m.capability === e.capability && (e.scope == null || m.scope === e.scope)))
          m.active = false;
      break;
    // "amend" (charter) handled by the charter chain, not here.
  }
}

export function deriveCollective(charter, records, { now = Date.now() } = {}) {
  const rules = charter.rules || {};
  const guild = charter.guild;
  const mine = (r) => r && r._verified !== false && (r.guild === guild || r.guild == null);
  const genesis = rules.genesis || [];
  const voteRule = (action) => rules.vote?.[action] ?? rules.vote?.default ?? DEFAULT_RULE;

  const proposals = records.filter((r) => mine(r) && r.type === "org.buildguild.proposal");
  const votes = records.filter((r) => mine(r) && r.type === "org.buildguild.attestation" && (r.contract === "vote" || r.predicate === "vote"));

  // index votes by proposal → voter → choices (for equivocation voiding)
  const byProp = {};
  for (const v of votes) ((byProp[v.subject] ??= {})[v.author] ??= []).push(v.value);

  const decideAt = (p) => p.closesAt ?? p.createdAt;
  const ordered = [...proposals].sort((a, b) => {
    const ta = decideAt(a), tb = decideAt(b);
    return ta === tb ? (a._ref < b._ref ? -1 : 1) : ta < tb ? -1 : 1;
  });

  const members = new Set(genesis);
  const mandates = [];
  const decided = {};

  for (const P of ordered) {
    if (!active(P, now)) continue;
    const closed = P.closesAt == null || Date.parse(P.closesAt) <= now;
    const electorate = new Set(members); // snapshot AS OF this decision
    let yes = 0, no = 0, cast = 0;
    for (const [voter, choices] of Object.entries(byProp[P._ref] || {})) {
      if (!electorate.has(voter)) continue; // only members-at-the-time count
      const uniq = new Set(choices);
      if (uniq.size > 1) continue; // equivocation voids this voter
      const c = [...uniq][0];
      if (c === "yes") yes++; else if (c === "no") no++; else continue;
      cast++;
    }
    const rule = voteRule(P.action);
    const eligible = electorate.size;
    let outcome;
    if (!closed) outcome = "open";
    else if (eligible === 0 || (cast * 100) / eligible < rule.quorum) outcome = "failed_quorum";
    else outcome = (cast === 0 ? 0 : (yes * 100) / cast) >= rule.threshold ? "passed" : "rejected";
    decided[P._ref] = { ref: P._ref, action: P.action, outcome, rule, tally: { yes, no, cast, eligible } };
    if (outcome === "passed") applyEffect(P, members, mandates);
  }

  const liveMandates = mandates.filter((m) => m.active);
  return {
    guild,
    members: [...members].sort(),
    mandates: liveMandates,
    proposals: decided,
    isMember: (did) => members.has(did),
    // A capability is held via an active mandate, or membership for role:member.
    holdsCapability: (did, cap, scope = "*") =>
      liveMandates.some((m) => m.grantee === did && m.capability === cap && inScope(m, scope)) ||
      (cap === "role:member" && members.has(did)),
    trustees: (cap, scope = "*") =>
      [...new Set(liveMandates.filter((m) => m.mode === "trust" && m.capability === cap && inScope(m, scope)).map((m) => m.grantee))].sort(),
    mandatesOf: (did) => liveMandates.filter((m) => m.grantee === did),
  };
}
