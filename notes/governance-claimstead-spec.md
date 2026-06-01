# Claimstead — verifiable-claim governance for guilds (draft spec v0.1)

_Status: draft / frontier. Feasibility validated by a runnable PoC (`src/governance.js`
+ `test/governance.test.js`, 8/8 passing). Custody decision and lexicon NSIDs still
open pending atproto-core-dev input (see [#21](https://github.com/jedelman/Build-guild/issues/21)).
Builds on `notes/governance-research.md`._

## 1. Premise — the recording-office model

A guild is governed not by an authoritative server but by a growing set of
**signed claims**, each authored in its signer's own repo. Truth is **computed**,
not served:

- **Claims are the truth.** "I propose X", "I vote yes on P@ref", "as officer I admit
  Bob", "I accept membership" — each is a record signed by its author's key.
- **Archives are a title plant.** An AppView/relay indexes claims for fast lookup,
  exactly as a title company keeps a private copy of the public record. It holds **no
  authority** and is detectably wrong if it lies or omits (a member produces the
  missing signed claim).
- **The recorder doesn't adjudicate.** Publishing a claim = constructive notice +
  priority (cf. real-estate race-notice statutes), not a ruling. Validity is decided
  later by replaying claims against the guild's signed **charter**.
- **No single source of failure.** Authoritative state = the union of self-held
  claims; every member keeps what they authored, so the full picture is
  reconstructable from members' repos even if the guild anchor disappears.

This is deliberately **not** the Tangled model, where a server-side RBAC engine is the
runtime authority. Here the verifier is pure and reproducible: any two parties with the
same claim set derive **byte-identical** state.

## 2. Object model

### Charter (the constitution — a Ricardian contract)
Human-readable `prose` **and** machine-enforced `rules`, signed by the founder. Versioned;
amendments chain via `prev` and must satisfy the *prior* charter's amendment rule
(self-amending). Shape (from the PoC):

```jsonc
{ "type": "org.buildguild.charter", "guild": "<guild-id|did>", "version": 1,
  "founder": "<did>", "prev": null,
  "prose": "The Cartographers chart together and split fairly.",
  "rules": {
    "roles": {
      "founder": { "can": ["admit","remove","grant_role","open_proposal","vote","propose","amend"] },
      "officer": { "can": ["admit","remove","open_proposal","vote","propose"] },
      "member":  { "can": ["vote","propose"] } },
    "membership": { "requireAcceptance": true },
    "proposal":   { "rule": "majority", "threshold": 0.5, "quorum": 0.5 } },
  "createdAt": "…", "sig": "<founder signature over canonical bytes>" }
```

### Claim (a governance act)
```jsonc
{ "type": "org.buildguild.claim", "kind": "admit|accept|remove|role_grant|proposal|vote|sanction",
  "author": "<did>", "guild": "<guild>", "charterVersion": 1,
  "body": { /* kind-specific */ }, "createdAt": "…", "nonce": "…",
  "sig": "<author signature over canonical bytes>" }
```
Kind bodies (PoC subset): `admit {subject}`, `accept {guild}`, `remove {subject, reason}`,
`role_grant {subject, role}`, `proposal {question, threshold?, quorum?, opensAt?, closesAt}`,
`vote {proposal:<ref>, choice:"yes"|"no"}`. A `vote` pins the exact proposal version by
`ref` (= SHA-256 of the signed proposal record — the local analogue of an atproto
strongRef `cid`).

## 3. Signatures, canonicalization, refs

- **Explicit detached signature** over the record's canonical bytes (everything except
  `sig`). A claim is therefore self-verifying **independent of the repo/commit it ships
  in** — the atproto repo is *distribution*, not *authority*. This is the key divergence
  from relying on atproto's commit-level auth, and it keeps claims portable (they'd verify
  even if exported off atproto).
- **Canonicalization:** deterministic JSON (sorted keys) in the PoC; production should use
  **JCS (RFC 8785)** or **dag-cbor** to match atproto hashing.
- **Crypto:** ECDSA **P-256** + SHA-256 via WebCrypto — identical in browser, Cloudflare
  Worker, and Node, so the same verifier runs everywhere. (Production keys = the author's
  atproto signing key resolved from their DID document; the PoC's `resolveKey(did)` is the
  resolution seam.)
- **`recordRef`** = SHA-256 over the canonical signed record → content id used for
  cross-claim references (votes→proposals, amendments→prior charter).

## 4. The verifier contract

`deriveGuildState(charter, verifiedClaims, {now}) → { members, roles, proposals, conflicts }`
is **pure, synchronous, and order-independent** (the only async step is signature
verification + ref hashing in `verifyRecords`). Proven properties (each maps to a passing
test in `test/governance.test.js`):

| Property | Test |
|---|---|
| State derives from signed claims alone (no server) | _membership + roles derive…_ |
| Deterministic + order-independent (gossip in any order) | _shuffled claims yield byte-identical state_ |
| Authority enforced (only charter-permitted roles act) | _unauthorized admit is ignored_ |
| Tamper-evident (mutate a claim → it drops out) | _tamper-evident…_ |
| Quorum + threshold + voter eligibility + close-time | _proposal tally…_ |
| Duplicity detection (conflicting votes voided + evidenced) | _conflicting votes caught + voided_ |
| Graduated sanction (authorized removal revokes membership) | _authorized removal…_ |
| Ambient verifiability (independent verifiers agree) | _two independent verifiers agree_ |

## 5. Ostrom's principles → mechanism

| Principle | Mechanism |
|---|---|
| 1 Defined boundaries | Signed charter + enumerable admit/accept claim chain |
| 2 Congruence | Guild-authored, self-amending charter (not a global template) |
| 3 Collective choice | Amendments require member votes per the charter's own amendment rule |
| 4 Monitoring | Public, replayable claim graph → ambient verifiability |
| 5 Graduated sanctions | Misbehavior is signed evidence; warn→suspend→remove are signed claims |
| 6 Conflict resolution | Charter names arbiters; disputes settled on self-verifying evidence bundles |
| 7 Right to organize | **Constraint on us:** the app *hosts + verifies* whatever charter a guild signs |
| 8 Nested enterprises | Capability chains nest → guild-of-guilds, per-quest sub-parties |

## 6. Acting on behalf of the guild — capabilities, not shared keys

The research's headache was "the guild must operate its own account / hold shared keys."
Instead, borrow **UCAN / SPKI-SDSI / macaroon** capability chains: the charter delegates an
**attenuated, revocable capability** to an officer's *own* DID; the officer signs actions
with their own key and presents the delegation chain proving they were authorized **at that
time**. No shared key custody. A guild *DID* may still exist as a stable anchor/identifier
for the charter, but it need not hold authoritative state or be actively operated.

## 7. Money finality (ties escrow #18)

Without a global ledger you can **detect** equivocation but not **prevent** it — which is
fine, because the one moment that needs finality (releasing a bounty) happens **off-protocol**:
**Stripe is the finalizer.** Funds release only when presented a self-verifying **evidence
bundle** (`evidenceBundle()` in the PoC): charter + proposal + votes + tally, re-derivable by
anyone offline. Optional **OpenTimestamps** anchor for high-stakes decisions. Reward-splits
follow Grigg's **triple-entry** shape (signed receipts held by both parties + a witness).

## 8. Durability over time — borrow e-signature LTV

Keys rotate (did:plc rotation was the research's flagged choke point). The e-signature world
solved "prove a signature was valid *when made*" with **RFC 3161 timestamps + ETSI *AdES +
Evidence Record Syntax (RFC 4998/6283)**: timestamp each decision, bundle the validation
material, periodically re-timestamp. Adopt this so a passed proposal remains verifiable for
years across key rotation.

## 9. How it sits on atproto

- Claims are written as atproto records under an `org.buildguild.*` (or `community.lexicon.*`)
  namespace and distributed via repos + firehose — but their **authority is the embedded
  signature + charter rules**, not the AppView.
- The AppView indexes for speed (the title plant) and SHOULD verify on read; for
  **money-affecting tallies it must verify authenticated records** (firehose-with-sigs or
  `getRecord` + sig/CID check), **not** trust Jetstream (which is explicitly not
  self-authenticating — see research §4).
- State is recoverable from the union of members' repos → no single point of failure.

## 10. Feasibility verdict

**Validated (running code, 8/8 tests):** signed-claim authorship; pure, deterministic,
order-independent state derivation; charter-driven authority; tamper-evidence; quorum/
threshold tallies with eligibility + deadlines; duplicity detection with non-repudiable
evidence; ambient verifiability; Worker/browser/Node-portable crypto.

**Not yet built / open:** amendment execution (charter chain replay); capability-chain
delegation (UCAN); LTV timestamping; the AppView indexer + on-read verification; mapping
explicit signatures onto atproto's own commit-level auth (use embedded sig, or derive a
per-record inclusion proof?); JCS/dag-cbor canonicalization; Sybil resistance beyond
verified DIDs.

## 11. Open questions for atproto core devs (additions to #21)
- Embed an explicit per-claim signature, or rely on atproto's commit-level auth + per-record
  inclusion proofs for "self-verifying claims"? Which is idiomatic?
- Recommended canonicalization for signed app records (JCS vs dag-cbor)?
- Is verify-on-read (`getRecord`+sig) the sanctioned path for verifiable tallies vs the
  authenticated firehose?

## 12. The human-factors question (next, not resolved here)

Cryptographic verifiability makes blame **assignable**; it does not make outcomes **just**.
The open risk: do we end up reinventing a slow, adversarial **claims court** — where every
dispute becomes a battle of evidence bundles, and the "wild west" punishes the
less-technical and the less-litigious? Threads to work next: legitimacy & buy-in vs. raw
proof; default charters so guilds don't author law from scratch; making sanctions
*restorative* not just *punitive*; UX that hides the crypto; the role of human arbiters and
reputation; and whether "possession/participation" (homesteading) should confer standing
alongside signed claims. **This is the subject of the next working session.**
