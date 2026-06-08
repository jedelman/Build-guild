// Agreement — derive a quest's workflow state from signed records (PURE).
//
// Folds quest + offer + acceptances + amendments (+ deliveries + settlements)
// into the current terms and lifecycle status, under FULL per-person consent:
// an offer binds no one until the patron side AND every party[] member have
// co-signed it. The plan is amendable — current terms = the original offer folded
// with the chain of accepted amendments. See notes/workflow-p2p-spec.md.

import { buildAuthority } from "./designation.js";

const active = (r, now) => r && r._verified !== false && (!r.expiry || Date.parse(r.expiry) > now);

// Patron-side delegates for a quest: grantees of an active, un-revoked
// `quest.transact` designation issued by the quest's owner (a resource-owner
// grant). Guild-patrons may instead delegate via charter authority (`auth`).
function questDelegates(quest, records, now) {
  const desigs = records.filter(
    (d) => d?._verified !== false && d.type === "org.buildguild.designation" &&
      d.capability === "quest.transact" && d.scope === quest._ref &&
      d.author === quest.author && active(d, now)
  );
  const revoked = (d) => records.some(
    (x) => x.type === "org.buildguild.revocation" && x.author === quest.author &&
      (x.target === d._ref || (x.grantee === d.grantee && x.capability === d.capability && x.scope === d.scope))
  );
  return new Set(desigs.filter((d) => !revoked(d)).map((d) => d.grantee));
}

// Fold an offer + its accepted amendment chain into the effective terms.
function foldTerms(offer, amendments, principalsAccepted) {
  const terms = {
    party: offer.party ?? [],
    reward: offer.reward,
    amount: offer.amount,
    currency: offer.currency,
    terms: offer.terms,
    milestones: offer.milestones,
    deadline: offer.deadline,
  };
  const chain = [];
  // Walk amendments that supersede the offer or the last applied link, in order,
  // applying only those every CURRENT principal has accepted.
  let head = offer._ref;
  const bySupersedes = {};
  for (const a of amendments) (bySupersedes[a.supersedes] ??= []).push(a);
  for (;;) {
    const candidates = (bySupersedes[head] ?? []).sort((x, y) =>
      x.createdAt === y.createdAt ? (x._ref < y._ref ? -1 : 1) : x.createdAt < y.createdAt ? -1 : 1
    );
    const applied = candidates.find((am) => principalsAccepted(terms.party, am._ref));
    if (!applied) break;
    Object.assign(terms, applied.changes || {});
    chain.push({ ref: applied._ref, by: applied.author, role: applied.role, changes: applied.changes, accepted: true });
    head = applied._ref;
  }
  // surface proposed-but-not-yet-accepted amendments too (visible, not applied)
  for (const a of bySupersedes[head] ?? [])
    chain.push({ ref: a._ref, by: a.author, role: a.role, changes: a.changes, accepted: false });
  return { terms, chain };
}

export function deriveAgreement(quest, records, { charter = null, now = Date.now() } = {}) {
  const r = (t) => records.filter((x) => x?._verified !== false && x.type === t);
  const auth = charter ? buildAuthority(charter, records, { now }) : null;
  const delegates = questDelegates(quest, records, now);
  const patronAuthorized = (did) =>
    did === quest.author || delegates.has(did) || (!!auth && auth.holdsCapability(did, "quest.transact", quest._ref));
  const offers = r("org.buildguild.offer").filter((o) => o.quest === quest._ref);
  const acceptances = r("org.buildguild.acceptance");
  const amendments = r("org.buildguild.amendment");
  const deliveries = r("org.buildguild.delivery").filter((d) => d.quest === quest._ref);
  const settlements = r("org.buildguild.settlement").filter((s) => s.quest === quest._ref);

  const acceptersOf = (ref) => new Set(acceptances.filter((a) => a.subject === ref).map((a) => a.author));

  // Evaluate each offer's consent state; pick the "leading" one (most consented,
  // tiebreak by createdAt/ref) as the quest's agreement.
  const evals = offers.map((offer) => {
    const accepted = acceptersOf(offer._ref);
    accepted.add(offer.author); // authoring is consent
    const party = offer.party ?? [];
    // principals who must consent = patron side + every party member
    const patronSigner =
      offer.role === "patron"
        ? offer.author
        : [...accepted].find((d) => patronAuthorized(d)) ?? null;
    const patronOk = offer.role === "patron" ? patronAuthorized(offer.author) : !!patronSigner;
    const pendingParty = party.filter((d) => !accepted.has(d));
    const pending = [...pendingParty, ...(patronOk ? [] : ["<patron>"])];
    const agreed = patronOk && pendingParty.length === 0;
    const consentCount = accepted.size;
    return { offer, accepted, party, patronSigner, patronOk, pending, agreed, consentCount };
  });
  evals.sort((a, b) =>
    b.consentCount - a.consentCount ||
    (a.offer.createdAt < b.offer.createdAt ? -1 : a.offer.createdAt > b.offer.createdAt ? 1 : a.offer._ref < b.offer._ref ? -1 : 1)
  );
  const lead = evals[0] || null;

  // Status.
  let status = "open";
  let terms = null;
  let chain = [];
  if (lead) {
    const principalsAccepted = (party, amRef) => {
      const accs = acceptersOf(amRef);
      const principals = new Set([...(party ?? []), lead.patronSigner].filter(Boolean));
      return [...principals].every((d) => accs.has(d) || amendmentAuthoredBy(amRef, d));
    };
    const amendmentAuthoredBy = (amRef, did) => amendments.some((a) => a._ref === amRef && a.author === did);
    ({ terms, chain } = foldTerms(lead.offer, amendments, principalsAccepted));

    if (!lead.agreed) status = lead.consentCount > 1 ? "part-agreed" : "offered";
    else {
      const total = terms.amount;
      const paid = settlements.reduce((s, x) => s + (x.amount || 0), 0);
      if (settlements.length && total != null && paid >= total) status = "fully-paid";
      else if (settlements.length) status = "part-paid";
      else if (deliveries.length) status = "delivered";
      else status = "agreed";
    }
  }

  return {
    quest: quest._ref,
    status,
    terms,
    offer: lead?.offer?._ref ?? null,
    accepted: lead ? [...lead.accepted].sort() : [],
    pending: lead?.pending ?? [],
    amendments: chain,
    deliveries: deliveries.map((d) => ({ ref: d._ref, by: d.author, commit: d.source?.commit, milestone: d.milestone })),
    settlements: settlements.map((s) => ({ ref: s._ref, amount: s.amount, for: s.for })),
    paid: settlements.reduce((s, x) => s + (x.amount || 0), 0),
    total: terms?.amount ?? null,
  };
}
