// Reference fraud-detection lens over the public signed-claim graph.
//
// "Observe, don't judge": these are SIGNALS for independent auditors, not verdicts.
// Pure + deterministic — anyone can run this (or write their own) over the records
// pulled from /api/audit. With peer-to-peer payments there's no escrow to make
// fraud costly, so we make it DETECTABLE: collusion rings, reciprocal back-
// scratching, and payment claims with no evidence all surface here.

// `attestations`: verified org.buildguild.attestation records ({attester, subject,
// value, evidence?, _ref, _verified}). `events`: verified settlement records
// (kind "quest", body has quest/payee/party/amount/paymentRef?/evidence?).
export function auditTrail(attestations = [], events = []) {
  const A = attestations.filter((a) => a && a._verified);

  // Directed graph: attester -> subjects they attested.
  const out = new Map();
  for (const a of A) {
    if (!out.has(a.attester)) out.set(a.attester, new Set());
    out.get(a.attester).add(a.subject);
  }
  const attests = (x, y) => out.get(x)?.has(y) || false;

  // 1. Reciprocal attestations (A vouches B and B vouches A — back-scratching).
  const reciprocal = [];
  for (const [x, ys] of out) for (const y of ys) if (x < y && attests(y, x)) reciprocal.push([x, y]);

  // 2. Insular rings: groups (>=3) connected by reciprocal edges whose members
  //    ONLY attest each other (no outside attestations) — classic collusion.
  const adj = new Map();
  for (const [x, y] of reciprocal) {
    if (!adj.has(x)) adj.set(x, new Set());
    if (!adj.has(y)) adj.set(y, new Set());
    adj.get(x).add(y);
    adj.get(y).add(x);
  }
  const seen = new Set();
  const rings = [];
  for (const start of adj.keys()) {
    if (seen.has(start)) continue;
    const comp = [];
    const stack = [start];
    seen.add(start);
    while (stack.length) {
      const n = stack.pop();
      comp.push(n);
      for (const m of adj.get(n) || []) if (!seen.has(m)) (seen.add(m), stack.push(m));
    }
    if (comp.length < 3) continue;
    const inGroup = new Set(comp);
    const insular = comp.every((m) => [...(out.get(m) || [])].every((s) => inGroup.has(s)));
    if (insular) rings.push(comp.sort());
  }

  // 3. Payment records with no independently-checkable evidence (no paymentRef and
  //    no evidence items) — an auditor should weight these lower.
  const unevidenced = events
    .filter((e) => e && e._verified && !(e.body?.paymentRef || (e.body?.evidence || []).length))
    .map((e) => e._ref);

  const flags = [];
  for (const [a, b] of reciprocal) flags.push({ type: "reciprocal_attestation", parties: [a, b] });
  for (const r of rings) flags.push({ type: "insular_ring", members: r, note: "group attests only itself — possible collusion" });
  if (unevidenced.length) flags.push({ type: "unevidenced_payment", refs: unevidenced, note: "settlement has no checkable evidence" });

  return { flags, reciprocal, rings, unevidenced };
}
