# RFC: Claimstead — verifiable-claim governance, reputation & escrow on atproto

**Status:** draft for discussion · **Audience:** atproto builders + core devs ·
**Context:** [Build Guild](https://github.com/jedelman/build-guild) — a team job board
where guilds (multi-member groups) form, govern themselves, claim paid quests as a
party, and split bounties.

We're building multi-party **governance** and **reputation** as **signed claims on
atproto**, and we'd love a sanity check on a few frontier points (§9). Everything below
is implemented and tested (PoC: 87 passing tests + an adversarial simulation); this is a
design we can defend, not vaporware.

---

## 1. Thesis: observe, don't judge

A court does two things — admits evidence **and** renders a verdict. We only do the
first. Governance acts and reputation are **signed records** in each participant's own
repo. No authoritative API: validity is **recomputed by any verifier** replaying records
against a guild's signed **charter**. Archives / AppViews are a convenience index (a
"title plant"), never the source of truth; the authoritative state is the union of
self-held signed records, so it survives any one host disappearing.

Two consequences we lean on hard:
- **No canonical score.** We publish facts; consumers bring their own algorithm. The
  reference reader counts; you're free to decay, weight by trust-graph, etc.
- **Observation encodes value, so we declare it.** Choosing what's recordable is a value
  statement; ours is *contribution*. The ontology is a values document, stated openly
  rather than laundered through "neutral" ranking.

## 2. The hard constraint, and the pattern we adopted

atproto repos are single-writer; there is no shared multi-writer repo. So multi-party
state is modeled as the proven pattern (Smoke Signal events↔RSVPs, Tangled
collaborators): a **host-owned anchor** + **per-actor records that `strongRef` it**,
aggregated by an AppView. We push it one step further: the AppView is *non-authoritative*
— every record is independently verifiable, so two AppViews with the same records agree
byte-for-byte.

## 3. Data model (locked, `lexicon: 1`)

Everything reduces to **two shapes**: *things*, and *signed opinions about things*.

**Anchors (a thing, with payload):**
`org.buildguild.charter` (a guild's constitution: roles, thresholds, quorum) ·
`org.buildguild.quest` · `org.buildguild.settlement` (delivery+payment proof) ·
`org.buildguild.proposal` · `org.buildguild.contract` (a predicate definition).

**The universal opinion:**
`org.buildguild.attestation` — a signed **ternary** (`yes`/`no`/`unknown`) about a
`subject` under a `predicate`, with optional `context` (a strongRef to the anchor that
grants standing). **Endorsements, delivery/payment ratings, votes, and membership are all
attestations**, differing only by predicate + eligibility. Skills are contracts too (an
endorsement = `yes` on `skill:rust`), which collapses our consensus-skills and reputation
systems into one primitive.

Two interop rules make records reproducible by anyone (incl. a Python scripter in ~20
lines): **canonical JSON** (sorted keys, no whitespace; ASCII; **no floats** — integer
percents + minor-unit money) and **raw 64-byte `r‖s` P-256 signatures** (WebCrypto/atproto
style, not DER). `recordRef = sha256(canonical(record))` is the strongRef cid analogue.

## 4. Governance

A `charter` defines roles→capabilities, membership policy, and proposal thresholds/quorum
(integer percents). Admit/accept/remove/role-grant/vote are attestations gated by the
charter's rules; `deriveGuildState(charter, records)` is a **pure, order-independent**
reducer → members, roles, proposal outcomes, and detected **duplicity** (e.g. a key that
signs conflicting votes — non-repudiable evidence, not prevention). Amendments chain via
`prev` and must satisfy the prior charter's amendment rule (self-amending).

## 5. Reputation

`tallyBadges` / `observe` count **eligible** attestations per predicate → a ternary
**badge cloud** (size ∝ count; yes/no/unknown split shows sentiment). **Symmetric
subjects**: builders, guilds, *and clients* accrue trails (mutual accountability — a
patron's "pays-promptly" is as public as a guild's "delivers"). Contested facts (a guild
says delivered, a client says not, on the same settlement) surface as visible
disagreement, not a clean mark.

## 6. Eligibility — what makes a count mean something

A raw count is Sybil-bait, so an attestation is counted only if the attester had
**provable standing** from another signed anchor: `deliver.on-time` ← the quest's *patron*;
`splits.fair` ← a *party member*; etc. Four rules, all reducing to *"are you named in the
relevant anchor?"* An adversarial simulation confirmed the edges:

- **Outsider Sybil flood (60 accounts): defended** — eligibility drops them.
- **Insider collusion ring: NOT defended by eligibility alone** — a closed loop posting
  fake quests *to each other* manufactures standing for free. **The fix isn't more crypto,
  it's cost:** escrow-gate reputation so faking standing requires real money to cycle
  (only escrow-settled quests are reputation-bearing). Money becomes a Sybil tax.
- **Single-eligible predicates grant unilateral power** (a bad-faith patron's
  unchallengeable "no") → contestable facts need ≥2-sided eligibility or an **objective
  anchor** (an escrow *release* is itself proof of delivery).

## 7. Money — off-protocol, attested on-protocol

No on-protocol escrow/PII. Money settles via **Stripe Connect**; the `settlement` record
attests only the *outcome* with an opaque transfer id (never card data). Escrow model:
**authorize on fund → capture on delivery → transfer to the party** minus a 1% application
fee. Quests are **capped at 5 days** (a forcing function for incremental delivery, and
inside the ~7-day card-auth window). Larger engagements don't get longer quests — they
fund an upfront **escrow balance** drawn down across capped quests, with a **ledger
visible to both parties**. The release is also the objective delivery anchor of §6.

## 8. Guild identity, custody & acting on behalf

A guild **is its own `did:plc`**, and its **rotation key is held k-of-n by the members via
threshold-ECDSA** (GG20 / CGGMP / DKLs). That produces a standard low-S ECDSA signature
under one joint public key, which plc.directory verifies without knowing — or caring — that
it's collective, so **no protocol change is needed.** (Verified against the did:plc +
atproto-cryptography specs; thanks to @zicklag.dev for the threshold pointer. Note it's
threshold-*ECDSA*, not FROST — did:plc signs with ECDSA, not Schnorr.) An optional
higher-authority **recovery key** (the app, or an escrow) keeps a guild from bricking if
signers go dark, at a known trust cost. Native multiple-rotationKeys is OR/hierarchical
(recovery), *not* consensus — so the threshold sits on a single rotation key.

This yields a clean two-layer split:
- **Identity layer (rare ops):** the threshold rotation key collectively owns the guild
  account — recovery, PDS migration, key changes. PLC ops are infrequent, so an MPC signing
  ceremony among members is acceptable.
- **Governance layer (constant):** everyday acts (admit, vote, settle) are **Claimstead
  attestations** authored in members' *own* repos and gated by the charter's roles — no
  shared signing required. Officer authority is either a charter role (an eligibility rule)
  or, for portable off-app delegation, a capability grant (UCAN/SPKI-style) to the officer's
  own DID.

Pragmatic ladder: founder-key (today) → Shamir-reconstruct → full MPC threshold (the key is
never reassembled). Protocol-compatibility holds at every rung.

## 9. Open questions for atproto core devs

1. **Threshold custody — confirm the path.** §8 proposes threshold-ECDSA on a did:plc
   rotation key for collective guild identity, with zero protocol changes. Any gotchas —
   strict low-S on MPC-produced signatures, recommended threshold-ECDSA tooling for
   k256/P-256, liveness/recovery ergonomics? Appetite for a native threshold primitive, or
   is "bring your own MPC" the expected answer?
2. **Operating a group/service account.** With OAuth "not recommended for headless," what's
   the recommended 2026 way to run an app-operated guild account (stored creds? a sanctioned
   bot-OAuth path? the "multi-user → one org DID" idea in discussion #3424)?
3. **Self-verifying records.** Embed an explicit per-record signature (our current choice,
   for portability beyond atproto), or rely on commit-level auth + per-record inclusion
   proofs? Which is idiomatic for app records meant to be verified standalone?
4. **Canonicalization.** JCS (RFC 8785) vs dag-cbor for signed app records — recommendation?
5. **Verifiable tallies.** For money-affecting vote/attestation counts, is verify-on-read
   (`getRecord` + sig/CID) the sanctioned path vs the authenticated firehose — and is
   Jetstream genuinely off-limits (not self-authenticating) for this?
6. **Ontology home.** Should predicate/contract definitions live in `community.lexicon.*`
   (and how is *that* registry governed) or stay `org.buildguild.*` with a documented exit?

## 10. Feasibility (what's actually built)

- **`src/governance.js`** — sign/verify + `observe`/`tallyBadges` (reputation) +
  `deriveGuildState` (governance). Pure, identical in browser/Worker/Node.
- **`src/payments.js`** — escrow state machine + fee/splits (authorize→capture→transfer).
- **Locked lexicon** (`lexicons/`, `LEXICON.md`), a forkable **CLI** (`cli/buildguild.mjs`),
  and a one-page **how-it-works** with a ~20-line Python client.
- **87 passing tests** + an adversarial **simulation** (`sim/claimstead-sim.mjs`) that found
  the collusion edge above. Reputation and governance are the *same* signed-claim primitive.

Feedback welcome — especially §9. The design is deliberately "DAO without a chain":
recording-office, not consensus-ledger; we'd rather get the atproto-native shape right than
reinvent a blockchain.
