// Collective — founder-free guild authority (PURE, deterministic).
//
// Anarcho-syndicalist model: NO durable founder, no standing officer class. The
// membership is sovereign; authority comes only from passed microvotes. "Officers"
// are scoped, recallable DELEGATE MANDATES — a member is mandated by vote to carry a
// bounded capability, and the collective can recall it (typically at a lower bar
// than granting it). Founding is just ratifying the genesis charter: the genesis
// cohort are the initial members and hold no special power thereafter.
//
// State is derived by CAUSAL REPLAY: there is no wall clock in the trust path. Each
// governance act names the prior acts it builds on — a proposal's `basis` (the membership
// HEAD it assumes) and any act it explicitly supersedes/targets (recall→grant,
// re-grant→recall). Those references form a DAG; content addressing guarantees it is
// acyclic (you can only reference a cid that already exists). We topologically sort that
// DAG, breaking ties between genuinely CONCURRENT acts by ref hash (deterministic, and
// emphatically not by a self-asserted timestamp). Each proposal is tallied against the
// electorate AS OF its causal position, and a passed proposal mutates the membership /
// mandates that later acts are judged against. This is the price of vote-rooted (not
// founder-rooted) authority — paid in causal order, not in trust of anyone's clock.
//
// Reuses the existing primitives: org.buildguild.proposal carries an `action` +
// `enacts`; a vote is an org.buildguild.attestation (contract "vote", subject =
// proposal). See notes/designation-primitive.md.

// LIVE ROSTER: a vote pins `basis` = the membership HEAD it was cast under (the cid of
// the last roster-changing act it saw; the charter is the genesis head). A vote counts
// only if its basis equals the head current at its proposal's causal position — so the
// instant the roster changes, every pending vote pinning the old head is STALE and must
// be recast. Staleness is detectable by walking the basis link, not guessed from a clock.
// Votes without a `basis` are treated as legacy/fresh.

const active = (r, now) => r && r._verified !== false && (!r.expiry || Date.parse(r.expiry) > now);
const inScope = (m, scope) => m.scope === scope || m.scope === "*" || scope === "*";
const DEFAULT_RULE = { threshold: 50, quorum: 50 }; // integer percents

// The causal predecessors of a proposal: the prior acts it builds on. `basis` is the
// membership head it assumes; `target`/`supersedes` are the acts it cancels or replaces
// (recall→grant, re-grant→recall). Only refs that resolve to known proposals are edges.
function predecessorsOf(P, propRefs) {
  const e = P.enacts || {};
  return [P.basis, e.target, e.supersedes].filter((r) => r && r !== P._ref && propRefs.has(r));
}

// Deterministic topological sort (Kahn) over the reference DAG. Among proposals that are
// causally concurrent (all dependencies met) we always take the smallest ref next, so the
// order is a pure function of the record SET — independent of gossip/insertion order and
// of every wall clock. Content addressing makes the graph acyclic; any residue from a
// dangling ref is appended by ref so the function is total.
function causalOrder(proposals) {
  const propRefs = new Set(proposals.map((p) => p._ref));
  const byRef = new Map(proposals.map((p) => [p._ref, p]));
  const indeg = new Map(proposals.map((p) => [p._ref, 0]));
  const succ = new Map(proposals.map((p) => [p._ref, []]));
  for (const P of proposals)
    for (const d of predecessorsOf(P, propRefs)) { indeg.set(P._ref, indeg.get(P._ref) + 1); succ.get(d).push(P._ref); }
  const ready = proposals.filter((p) => indeg.get(p._ref) === 0).map((p) => p._ref).sort();
  const ordered = [];
  const seen = new Set();
  while (ready.length) {
    const ref = ready.shift(); // smallest ref among the causally-ready frontier
    if (seen.has(ref)) continue;
    seen.add(ref);
    ordered.push(byRef.get(ref));
    let added = false;
    for (const s of succ.get(ref) || []) if (indeg.set(s, indeg.get(s) - 1).get(s) === 0) { ready.push(s); added = true; }
    if (added) ready.sort();
  }
  for (const p of [...proposals].sort((a, b) => (a._ref < b._ref ? -1 : 1)))
    if (!seen.has(p._ref)) ordered.push(p); // dangling-ref residue, by ref
  return ordered;
}

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

  // index votes by proposal → voter → {value, basis} (basis pins the roster head)
  const byProp = {};
  for (const v of votes) ((byProp[v.subject] ??= {})[v.author] ??= []).push({ value: v.value, basis: v.basis ?? null });

  const ROSTER_ACTIONS = new Set(["admit", "remove"]);
  const GENESIS = charter._ref ?? "genesis"; // the genesis membership head

  // Causal order: topologically sort proposals over their reference edges, breaking ties
  // between concurrent acts by ref hash. No timestamps participate in sequencing.
  const ordered = causalOrder(proposals);

  const members = new Set(genesis);
  const mandates = [];
  const decided = {};
  const staleVotes = [];
  let head = GENESIS; // the current membership head; live votes must pin this to count
  const headSnap = new Map([[GENESIS, new Set(members)]]); // roster AS OF each head — for FROZEN proposals

  for (const P of ordered) {
    if (!active(P, now)) continue;
    const closed = P.closesAt == null || Date.parse(P.closesAt) <= now;
    const rule = voteRule(P.action);
    // ANTI-GRIEF: a per-action charter policy. LIVE (default) judges against the current
    // roster and stales votes on any churn — correct, but a griefer can stall a vote by
    // churning the roster to reset everyone's basis. FROZEN pins the proposal to the head
    // it OPENED on (its `basis`): its electorate and valid votes are the open-time roster,
    // immune to later churn (the cost: it can be decided by/for a roster that has moved on).
    const frozen = !!rule.freeze;
    const effHead = frozen ? (P.basis ?? GENESIS) : head;
    const electorate = new Set((frozen ? headSnap.get(effHead) : null) ?? members);
    let yes = 0, no = 0, cast = 0, stale = 0;
    for (const [voter, list] of Object.entries(byProp[P._ref] || {})) {
      if (!electorate.has(voter)) continue; // only members of the governing roster count
      // a live vote pins effHead (the current head, or the frozen open-time head); null = legacy/fresh
      const live = list.filter((v) => v.basis == null || v.basis === effHead);
      if (live.length < list.length) { stale++; staleVotes.push({ proposal: P._ref, voter, pinned: list.find((v) => v.basis && v.basis !== effHead)?.basis, head: effHead }); }
      if (!live.length) continue; // all of this voter's votes are stale → recast needed
      const uniq = new Set(live.map((v) => v.value));
      if (uniq.size > 1) continue; // equivocation voids this voter
      const c = [...uniq][0];
      if (c === "yes") yes++; else if (c === "no") no++; else continue;
      cast++;
    }
    const eligible = electorate.size;
    let outcome;
    if (!closed) outcome = "open";
    else if (eligible === 0 || (cast * 100) / eligible < rule.quorum) outcome = "failed_quorum";
    else outcome = (cast === 0 ? 0 : (yes * 100) / cast) >= rule.threshold ? "passed" : "rejected";
    decided[P._ref] = { ref: P._ref, action: P.action, outcome, rule, head: effHead, basis: frozen ? "frozen" : "live", tally: { yes, no, cast, stale, eligible } };
    if (outcome === "passed") {
      applyEffect(P, members, mandates);
      if (ROSTER_ACTIONS.has(P.action)) { head = P._ref; headSnap.set(head, new Set(members)); } // roster changed → advance head + snapshot
    }
  }

  const liveMandates = mandates.filter((m) => m.active);
  return {
    guild,
    head, // the current membership head; a vote must pin this to be live
    members: [...members].sort(),
    mandates: liveMandates,
    proposals: decided,
    staleVotes,
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
