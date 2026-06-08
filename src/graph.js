// Graph — turn a record set into a node-link graph for the debug view (PURE).
//
// Every Build Guild record is a node (keyed by its content id `_ref`); every
// strongRef-bearing field is an edge. Lets you SEE the whole commons: the
// agreement chain, the consent co-signs, the designation/authority DAG, the
// deliver→pay loop, and where any of it dangles.

// Fields whose value is a ref to another record (a strongRef `_ref`).
const REF_FIELDS = [
  "subject", "supersedes", "prev", "quest", "agreement",
  "for", "delivery", "target", "context", "supersededBy", "basis",
];

const shortType = (t) => (t || "?").replace(/^org\.buildguild\./, "").replace(/^sh\.tangled\./, "");

function label(rec) {
  const t = shortType(rec.type);
  if (t === "offer") return `offer (${rec.role})`;
  if (t === "amendment") return `amendment (${rec.role})`;
  if (t === "designation") return `grant ${rec.capability} → ${(rec.grantee || "").slice(-6)}`;
  if (t === "revocation") return `revoke ${rec.capability || rec.target?.slice(0, 6) || ""}`;
  if (t === "delivery") return `delivery @${(rec.source?.commit || "").slice(0, 7)}`;
  if (t === "settlement") return `settle ${rec.amount ?? ""}`;
  if (t === "proposal") return `vote: ${rec.action || "proposal"}${rec.enacts?.grantee ? " " + rec.enacts.grantee.slice(-6) : rec.enacts?.capability ? " " + rec.enacts.capability : ""}`;
  if (t === "attestation") return rec.contract === "vote" || rec.predicate === "vote" ? `vote ${rec.value}` : `attest ${rec.contract || rec.predicate}=${rec.value}`;
  if (t === "quest") return `quest: ${rec.title || rec.body?.title || ""}`.slice(0, 40);
  return t;
}

export function buildGraph(records) {
  const known = new Set(records.map((r) => r._ref).filter(Boolean));
  const nodes = records.map((r) => ({
    id: r._ref,
    type: shortType(r.type),
    author: r.author ?? r.attester ?? r.founder ?? null,
    label: label(r),
    verified: r._verified !== false,
    createdAt: r.createdAt ?? null,
  }));
  const edges = [];
  const addEdge = (from, to, rel) => { if (typeof to === "string" && to) edges.push({ from, to, rel, dangling: !known.has(to) }); };
  for (const r of records) {
    for (const f of REF_FIELDS) addEdge(r._ref, r[f], f);
    // causal edges that order authority acts live inside `enacts` (recall→grant,
    // re-grant→recall); surface them so the audit can walk the chain forward.
    if (r.enacts) { addEdge(r._ref, r.enacts.target, "target"); addEdge(r._ref, r.enacts.supersedes, "supersedes"); }
  }
  return { nodes, edges };
}
