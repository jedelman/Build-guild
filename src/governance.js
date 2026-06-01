// Claimstead — governance as verifiable claims (proof-of-concept).
//
// Recording-office model: governance acts are SIGNED CLAIMS authored in each
// member's own repo. No server is authoritative; validity is COMPUTED by any
// verifier replaying claims against the guild's signed charter. Archives /
// AppViews are a convenience index (a "title plant"), never the source of truth.
//
// This module is intentionally dependency-free and runtime-portable: it uses
// only WebCrypto (ECDSA P-256, SHA-256), which is identical in browsers,
// Cloudflare Workers, and Node — so the SAME verifier runs client-side, in the
// Worker, and under `node --test`. Two verifiers with the same claim set MUST
// reach byte-identical state (ambient verifiability).
//
// Design notes / production deltas:
// - Canonicalization here is a deterministic JSON (sorted keys). Production
//   should use JCS (RFC 8785) or dag-cbor to match atproto's hashing.
// - Each record carries an EXPLICIT detached signature over its canonical bytes,
//   so a claim is self-verifying independent of the atproto repo/commit it ships
//   in (the repo is distribution, not authority). `resolveKey(did)` stands in for
//   DID-document resolution.
// - `recordRef` = SHA-256 over the canonical signed record — the local analogue
//   of an atproto strongRef `cid`, used by votes to pin an exact proposal version.

const enc = new TextEncoder();
const subtle = globalThis.crypto.subtle;

// ---- canonicalization + hashing -------------------------------------------
// Deterministic JSON: object keys sorted, `undefined` dropped. Good enough for a
// PoC; swap for JCS/dag-cbor in production.
export function canonicalize(v) {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(canonicalize).join(",") + "]";
  const keys = Object.keys(v).filter((k) => v[k] !== undefined).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + canonicalize(v[k])).join(",") + "}";
}

const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function digestHex(str) {
  const h = await subtle.digest("SHA-256", enc.encode(str));
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
// Content id of a (signed) record — the strongRef-cid analogue.
export const recordRef = (rec) => digestHex(canonicalize(rec));

// Strip the signature + any transient (underscore) fields to recover exactly the
// bytes that were signed.
function unsigned(rec) {
  const out = {};
  for (const k of Object.keys(rec)) if (k !== "sig" && !k.startsWith("_")) out[k] = rec[k];
  return out;
}

// ---- signing + verification (ECDSA P-256) ---------------------------------
export const generateKeypair = () =>
  subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);

export async function signRecord(record, privateKey) {
  const bytes = enc.encode(canonicalize(unsigned(record)));
  const sig = await subtle.sign({ name: "ECDSA", hash: "SHA-256" }, privateKey, bytes);
  return { ...record, sig: b64(sig) };
}

async function verifySig(record, publicKey) {
  if (!record.sig || !publicKey) return false;
  const bytes = enc.encode(canonicalize(unsigned(record)));
  try {
    return await subtle.verify({ name: "ECDSA", hash: "SHA-256" }, publicKey, unb64(record.sig), bytes);
  } catch {
    return false;
  }
}

// Verify a batch of records and attach `_ref` (content id) + `_verified`.
// `resolveKey(did)` resolves the author's public key (DID-doc resolution in prod;
// a keyring map in tests). This is the only async step; the reducer below is pure.
export async function verifyRecords(records, resolveKey) {
  return Promise.all(
    records.map(async (r) => {
      const author = r.author ?? r.founder;
      const key = await resolveKey(author);
      const _verified = await verifySig(r, key);
      const _ref = await recordRef(r);
      return { ...r, _ref, _verified };
    })
  );
}

// ---- the verifier: derive guild state from claims (PURE, deterministic) ----
// Given the active charter and a set of VERIFIED claims, compute membership,
// roles, and proposal outcomes. Order-independent: all results come from set /
// group operations over the full claim set, with internal tiebreaks by
// (createdAt, ref). Equivocation (e.g. conflicting votes from one key) is
// DETECTED — not prevented — and recorded as non-repudiable evidence.
export function deriveGuildState(charter, verifiedClaims, { now = Date.now() } = {}) {
  const rules = charter.rules;
  const can = (role, action) => !!role && Array.isArray(rules.roles?.[role]?.can) && rules.roles[role].can.includes(action);

  // Only well-formed, verified claims for THIS guild + charter version.
  const claims = verifiedClaims.filter(
    (c) => c && c._verified && c.guild === charter.guild && c.charterVersion === charter.version
  );
  const ofKind = (k) => claims.filter((c) => c.kind === k);

  // Roles: founder from the charter; officers granted by the founder. (PoC keeps
  // the authority graph shallow — only the founder may grant roles — so role
  // resolution is non-recursive and deterministic.)
  const officers = new Set(
    ofKind("role_grant")
      .filter((c) => c.author === charter.founder && c.body?.role === "officer" && c.body?.subject)
      .map((c) => c.body.subject)
  );
  const roleOf = (did) => (did === charter.founder ? "founder" : officers.has(did) ? "officer" : "member");

  // Membership = founder ∪ subjects whose latest authorized membership event is an
  // admit (not a remove) AND who accepted (if the charter requires acceptance).
  const memEvents = {};
  for (const c of claims) {
    const subject = c.body?.subject;
    if (!subject) continue;
    if (c.kind === "admit" && can(roleOf(c.author), "admit"))
      (memEvents[subject] ??= []).push({ type: "admit", at: c.createdAt, ref: c._ref });
    if (c.kind === "remove" && can(roleOf(c.author), "remove") && subject !== charter.founder)
      (memEvents[subject] ??= []).push({ type: "remove", at: c.createdAt, ref: c._ref });
  }
  const accepted = new Set(ofKind("accept").map((c) => c.author));
  const requireAcceptance = rules.membership?.requireAcceptance !== false;

  const isMember = (did) => {
    if (did === charter.founder) return true;
    const evs = memEvents[did];
    if (!evs?.length) return false;
    evs.sort((a, b) => (a.at === b.at ? (a.ref < b.ref ? -1 : 1) : a.at < b.at ? -1 : 1));
    if (evs[evs.length - 1].type !== "admit") return false;
    return requireAcceptance ? accepted.has(did) : true;
  };

  const members = new Set([charter.founder, ...Object.keys(memEvents).filter(isMember)]);

  // Proposals (opened by a member whose role may open_proposal).
  const proposals = {};
  for (const c of ofKind("proposal")) {
    if (!members.has(c.author) || !can(roleOf(c.author), "open_proposal")) continue;
    const b = c.body || {};
    proposals[c._ref] = {
      ref: c._ref,
      by: c.author,
      question: b.question ?? "",
      threshold: b.threshold ?? rules.proposal.threshold,
      quorum: b.quorum ?? rules.proposal.quorum,
      opensAt: b.opensAt ?? c.createdAt,
      closesAt: b.closesAt ?? null,
      votes: {},
      conflicts: [],
    };
  }

  // Votes: one per (member, proposal). Conflicting choices from one key = a
  // duplicity proof → that voter's votes on that proposal are voided.
  const conflicts = [];
  const grouped = {};
  for (const c of ofKind("vote")) {
    const pref = c.body?.proposal;
    if (!proposals[pref] || !members.has(c.author)) continue;
    ((grouped[pref] ??= {})[c.author] ??= []).push({ choice: c.body?.choice, ref: c._ref });
  }
  for (const [pref, byAuthor] of Object.entries(grouped)) {
    const P = proposals[pref];
    for (const [author, list] of Object.entries(byAuthor)) {
      const choices = new Set(list.map((v) => v.choice));
      if (choices.size > 1) {
        const conf = { type: "double_vote", author, proposal: pref, evidence: list.map((v) => v.ref).sort() };
        conflicts.push(conf);
        P.conflicts.push(conf);
        continue; // equivocation voids this voter on this proposal
      }
      P.votes[author] = [...choices][0];
    }
  }

  // Outcomes.
  const eligible = members.size;
  for (const P of Object.values(proposals)) {
    const yes = Object.values(P.votes).filter((v) => v === "yes").length;
    const no = Object.values(P.votes).filter((v) => v === "no").length;
    const cast = yes + no;
    if (P.closesAt != null && now < P.closesAt) P.outcome = "open";
    else if (eligible === 0 || cast / eligible < P.quorum) P.outcome = "failed_quorum";
    else P.outcome = (cast === 0 ? 0 : yes / cast) >= P.threshold ? "passed" : "rejected";
    P.tally = { yes, no, cast, eligible };
  }

  return {
    guild: charter.guild,
    charterVersion: charter.version,
    founder: charter.founder,
    members: [...members].sort(),
    roles: Object.fromEntries([...members].sort().map((d) => [d, roleOf(d)])),
    proposals,
    conflicts,
  };
}

// A self-contained, offline-verifiable evidence bundle for one decision — the
// "the decision carries its own proof" property. Anyone can re-derive the
// outcome from {charter, claims} without trusting any server.
export function evidenceBundle(charter, verifiedClaims, proposalRef, opts) {
  const state = deriveGuildState(charter, verifiedClaims, opts);
  const proposal = state.proposals[proposalRef];
  return { charter, proposal, computedAt: opts?.now ?? Date.now() };
}
