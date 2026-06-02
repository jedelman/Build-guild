# Build Guild lexicon — locked v1

The on-the-wire record shapes are **frozen at `lexicon: 1`**. Build them against; the
reference web app is just one **AppView** over these records, and records are
**verifiable against the live PDS** they're written to. Fork the canonical
implementation, write your own client (CLI, bot, alternative AppView) — the records
are the contract, not our API.

## The records (in `lexicons/`)

**Anchors — a thing, with payload:**
- `org.buildguild.charter` — a guild's constitution (rules: roles, thresholds, quorum).
- `org.buildguild.quest` — a posted quest (work + reward + skills).
- `org.buildguild.settlement` — patron's signed proof a quest was delivered + paid
  (the objective delivery anchor; money settles off-protocol, this attests the outcome).
- `org.buildguild.proposal` — a governance question to vote on.
- `org.buildguild.contract` — a predicate definition (the ontology / values document).

**Attestation — the universal opinion:**
- `org.buildguild.attestation` — a signed `yes`/`no`/`unknown` about a `subject` under a
  `predicate`, with optional `context`. Endorsements, ratings, **votes**, and
  **membership** are all attestations; they differ only by predicate + eligibility.

**Ancestors (still valid, superseded going forward):** `org.buildguild.skill`,
`org.buildguild.endorsement`, `org.buildguild.repo`. New code uses `attestation`
(`skill:<name>` predicate) for the same job.

## The two interop rules (get these right and the rest is JSON)

1. **Canonical form** — sign over the record's canonical bytes (its `sig` removed):
   keys sorted, no whitespace. One stdlib call:
   `json.dumps(rec, sort_keys=True, separators=(",",":"), ensure_ascii=False)`.
   House rules so every implementation matches: **ASCII text, and no floats.**
   (That's why thresholds/quorum/amounts are **integers** — percents 0-100, money in
   minor units.)
2. **Signatures** — ECDSA **P-256 / SHA-256**, encoded as **raw 64-byte `r‖s`**
   (WebCrypto / atproto style), base64. Not DER. (`low-S` to match atproto exactly.)

A record's content id is `sha256(canonical(signed record))` — used by `context`
strongRefs (a vote pins its proposal; a rating pins its settlement).

## Eligibility (what makes a count mean something)

`anyone` · `patron_of_quest` · `party_of_quest` · `member_of_guild` — all reduce to
*"are you named in the relevant anchor?"* Ineligible attestations are simply not
counted. See `src/governance.js#isEligible`.

## Canonical implementation (fork it)

- `src/governance.js` — sign / verify / `recordRef`, plus the reference readers
  `observe`, `tallyBadges` (reputation) and `deriveGuildState` (governance). Pure,
  runs identically in browser, Worker, and Node.
- `src/contracts.js` — the core ontology.
- `cli/buildguild.mjs` — a tiny pure-CLI client (keygen / attest / tally) for cyborgs
  who'd rather script than click.
- `notes/how-it-works.md` — the whole protocol on one page, with a ~20-line Python client.

The reference readers are **one** reading, not the truth: anyone may run their own
algorithm (recency-decay, trust-graph weighting) over the same facts. We publish facts;
you compute meaning. No canonical score.

## Versioning

`lexicon: 1` is locked: existing fields won't change meaning or type. Evolution is
additive (new optional fields) or a new lexicon id; breaking changes get a new version
with a migration note here. Stability is the point — escrow/payments build on it next.
