// The attestation ontology — the VALUES DOCUMENT. Choosing what is recordable is
// itself a value judgment, stated openly: we value CONTRIBUTION. Each contract is a
// Ricardian predicate + an eligibility rule that gates whose attestation counts
// (enforced by isEligible in governance.js). Shared verbatim by server + client.
export const CONTRACTS = {
  "deliver.on-time": { id: "deliver.on-time", prose: "Delivered the agreed work on time.", subjectType: "guild", eligibility: { rule: "patron_of_quest" } },
  "deliver.quality": { id: "deliver.quality", prose: "The delivered work was high quality.", subjectType: "guild", eligibility: { rule: "patron_of_quest" } },
  "splits.fair": { id: "splits.fair", prose: "Split the reward fairly across the party.", subjectType: "guild", eligibility: { rule: "party_of_quest" } },
  "pays.promptly": { id: "pays.promptly", prose: "Paid promptly and without drama.", subjectType: "client", eligibility: { rule: "party_of_quest" } },
  "specs.clearly": { id: "specs.clearly", prose: "Specified the work clearly.", subjectType: "client", eligibility: { rule: "party_of_quest" } },
};

// Skills are just contracts: an endorsement = a `yes` on `skill:<name>`. Eligibility
// is "anyone" here to match the existing endorse UX; collaboration-gating
// (party_of_quest) is the stricter knob if skill-farming becomes a problem.
export function contractFor(id) {
  if (CONTRACTS[id]) return CONTRACTS[id];
  if (typeof id === "string" && id.startsWith("skill:"))
    return { id, prose: `Competent at ${id.slice(6)}.`, subjectType: "builder", eligibility: { rule: "anyone" } };
  return null;
}

// Build a contracts map covering exactly the ids present in a set of attestations
// (static contracts + synthesized skill contracts).
export function contractsFor(ids) {
  const out = { ...CONTRACTS };
  for (const id of ids) {
    const c = contractFor(id);
    if (c) out[id] = c;
  }
  return out;
}

// Which contracts an attester may answer about a subject of the given type — used
// to drive AppView prompts ("Quest closed — did they deliver?").
export const promptsFor = (subjectType) =>
  Object.values(CONTRACTS).filter((c) => c.subjectType === subjectType);
