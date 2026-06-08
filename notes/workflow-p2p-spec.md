# Quest workflow review + spec (post-P2P)

_A workflow review prompted by the peer-to-peer payment pivot, which removed escrow
— the thing that used to bind the two sides. It re-centers the lifecycle on a
**co-signed, amendable agreement**, adds progressive (milestone) settlement, anchors
delivery to git commits, makes public quest threads first-class, and works out which
state belongs on-protocol vs. in git. Builds on `notes/governance-claimstead-spec.md`
and `LEXICON.md`. Status: design, for review._

## 0. Start here (for a reader new to Build Guild)

**Build Guild is a team job board built on atproto.** Builders publish a character
sheet, form guilds, and claim paid *quests* from patrons; reputation comes from peers
vouching for each other, not self-ratings. The defining choice: **every meaningful fact
is a signed record in its author's own atproto repo, and truth is *computed* from those
records — never served by an authoritative database.** The web app and its index are
just one *reader* over the records; anyone can run their own. This spec designs the
quest workflow — agreement → delivery → payment — on top of that. The records it defines
live in `lexicons/`.

If you read nothing else: **the records are the contract; the server is a cache.**

### Vocabulary (and why each exists)

*The people and things*
- **Builder** — an independent maker; identity *is* their Bluesky/atproto handle (a DID),
  so it's portable and not ours to revoke.
- **Patron** — someone who posts work and pays for it. (Two-sided: a builder can be
  either, on different quests.)
- **Guild** — a self-governing team of builders. Exists so reputation and work can be
  *collective* and governance can be member-run, not platform-run.
- **Party** — the specific builders delivering one quest (a guild's "raid group"). Named
  so reward splits and ratings attach to the actual contributors.
- **Quest** — a posted unit of work + reward. *An advert, not the deal* — the binding
  terms live on the `offer` (see §3).
- **Charter** — a guild's constitution: human prose + machine-enforced rules (roles,
  vote thresholds, who may admit members). Exists so each guild sets its *own* rules and
  they bind verifiably, without a central admin. (The *policy* layer; who is actually
  assigned to a role/trust is a **designation**.)
- **Designation** — the one "X authorizes/trusts Y to act in some capacity" record
  (`org.buildguild.designation`). Mode `delegate` = act *with* the grantor's authority
  (attenuated, revocable, chainable — UCAN-style: officers, patron delegates, sub-parties);
  mode `trust` = the grantor *relies on* the grantee (arbiters, witnesses, labelers), no
  authority transferred. One primitive instead of six ad-hoc mechanisms — see
  `notes/designation-primitive.md`.

*How truth works (the part most worth internalizing)*
- **Attestation** — the universal primitive: a signed, ternary (`yes`/`no`/`unknown`)
  opinion about a `subject` under a named `predicate` (e.g. "delivered on time", "pays
  promptly", "has skill: rust"). Endorsements, ratings, votes, and membership are *all*
  attestations — one primitive instead of ten record types.
- **Predicate / eligibility** — the predicate is the sentence being answered; eligibility
  is the rule for *whose answer counts* (e.g. only a quest's patron may rate its
  delivery). Eligibility is what makes a rating mean something; it all reduces to "are
  you named in the relevant anchor?"
- **Claimstead** — the governance model: a guild is a **recording office**, not a server.
  Signed claims are the truth; an index is a "title plant" (a convenience copy) with no
  authority — and *detectably wrong* if it lies, because anyone can produce the missing
  signed claim. Two parties with the same claims compute byte-identical state.
- **The commons** — the public, append-only set of these signed records. Because no
  escrow holds the money, the commons *is* the enforcement: trust accrues only to what's
  on the record (see §1a).
- **Audit lens** — a reader (`src/audit.js`) that scans the commons for un-evidenced or
  collusive patterns and flags them; the no-escrow system's smoke detector. (Can ship as
  an atproto *labeler* — §7.)
- **AppView** — standard atproto term: a service that indexes records into a queryable
  view. Ours is one of many possible; the records outlive it.

*This spec's new records* — `offer`, `acceptance`, `amendment`, `delivery`, `witness`,
`message` (plus an extended `settlement`) — are defined in §3, full JSON in `lexicons/`.

## 1. Why this review

Escrow was the handshake: a claim was backed by held funds. P2P removed that, so
nothing binds patron and party until money moves. The fix is to make the **agreement
explicit and co-signed** — it becomes the trust anchor everything downstream
(delivery, payment, ratings, disputes) references. And once parties are committing to
each other, they need to **talk** — negotiate scope, coordinate, and leave a dispute
trail — so we add quest threads.

Decisions taken across this review: **public quest threads** as signed records;
**mutual agreement** (either side offers, the other accepts); **progressive/milestone
settlement**; **git-anchored delivery**; **amendable terms on an append-only chain**
(§1a); **atproto as the witnessed commons, git as untrusted content** (§7); and
**trusted third-party witnesses/mirrors** for evidence durability (§7).

## 1a. Governing principle — the commons is the trust signal

Everything official is **on the record, append-only, and public**. The plan is meant
to change — scope shifts, milestones get re-cut, rewards get renegotiated — but the
chain has to show *what was originally agreed and what changed since*. So:

- **On-record or it isn't official.** People will DM, hop on a call, agree things in a
  hallway — that's fine and expected. But it carries no weight, builds no reputation,
  and binds no one until it lands as a signed record. Trust accrues only to the commons.
- **Amend, never overwrite.** atproto record updates clobber the prior value with no
  history, so agreement-bearing records (offer, acceptance, the agreed terms) are
  **never mutated in place**. A change is a new **amendment** record that strongRefs the
  state it supersedes; "current terms" = the original folded with the accepted amendment
  chain. The original is always the first link and stays visible.
- **Off-record drift is detectable.** If the work, payments, or party diverge from the
  on-record terms with no amendment to match, the audit lens flags it. The cost of going
  off-record isn't a block — it's that the divergence shows.

This is the no-escrow trust model stated plainly: there's no held money to enforce the
deal, so the **public, append-only commons is the enforcement** — visible, comparable,
and reputational.

## 2. Lifecycle

```
                                    ┌──── milestone loop (0..n) ────┐
                                    ▼                               │
open ─▶ offered ─▶ part-agreed ─▶ AGREED ─▶ delivered ─▶ part-paid ─┘─▶ fully-paid ─▶ confirmed
        (offer)   (some co-sign) (all co-sign)(party@commit)(patron)   (Σ ≥ reward)  (payee)
          │            │                          │
          └── withdraw ┘                 dispute ─┴─ (contested + evidence → arbiter?)
```
A quest is one agreement with a **deliver→pay loop**: each delivery pins a git commit,
each settlement pays a slice; the quest is done when paid slices sum to the reward.
Between AGREED and the first delivery the party works and the thread stays open; that
"in-progress" span is a *derived* status, not its own record.

| State | Who acts | Record |
|---|---|---|
| `open` | patron | `org.buildguild.quest` (reward, terms, skills — a public advert) |
| `offered` | **either** a party (claim) **or** the patron/delegate (invite) | `org.buildguild.offer` |
| `part-agreed` | some named principals | `org.buildguild.acceptance` (subject → offer) |
| `AGREED` | **all** principals have co-signed | (derived: patron-side + every `party[]` DID) |
| `in-progress` | party | *derived* (no record; thread comments) |
| `delivered` | party | `org.buildguild.delivery` (git commit + evidence[]) |
| `part-paid` | patron | `org.buildguild.settlement` (amount, rail, ref, evidence[]) |
| `fully-paid` | — | Σ settlement amounts ≥ reward |
| `confirmed` | payee | `pays.promptly` attestation (the receipt co-sign) |
| ratings | both | attestations (`deliver.*`, `splits.fair`, `pays.promptly`, `specs.clearly`) |
| `withdrawn` | offerer | delete/tombstone the offer (self-revocation; before AGREED) |
| `disputed` | either | contested attestation (`deliver:no` / `pays.promptly:no`) + evidence |

**The keystone — the agreement = an offer + a co-signature from every named principal**
(single-writer records, paired by strongRef, mirroring governance's admit+accept). The
offer locks **{party DIDs, reward, terms}**; "AGREED" = the patron side *and* every
`party[]` member have co-signed it (§3a). This is the escrow lock, re-expressed as a
fully-consented claim.

## 3. New lexicons (now in `lexicons/`, `lexicon: 1`)

The full JSON is in `lexicons/`; sketches below. **atproto convention: the author is the
repo owner**, so no record carries an explicit author DID — explicit DIDs name *other*
parties, and `role` declares which side the author is.

- **`org.buildguild.offer`** — `{ quest: strongRef, role: "patron"|"party",
  party: [did], reward: string, amount?: int, currency?, terms: "upfront"|"on_delivery",
  milestones?: [{label, amount?}], deadline?, note?, createdAt }`. Either side proposes
  terms. The `quest` is the patron's public advert — a wish; the *binding* reward/terms/
  party are whatever the offer+acceptance lock, and may differ from the advert.
- **`org.buildguild.acceptance`** — `{ subject: strongRef (offer | amendment), fetched?:
  sha, note?, createdAt }`. The counterparty co-signs → AGREED (or an amendment takes
  effect). The strongRef pins the *exact* version (content id), so terms can't be silently
  changed after acceptance — any change has to come back through a new, co-signed
  amendment. `fetched` optionally acknowledges receipt of a delivery sha.
- **`org.buildguild.amendment`** — `{ supersedes: strongRef (offer | prior amendment),
  role: "patron"|"party", changes: { party?, reward?, amount?, currency?, terms?,
  milestones?, deadline? }, reason?, createdAt }`. The append-only unit of change:
  proposes a delta, takes effect only when the counterparty files an `acceptance` against
  it (so amendment is as mutual as the original deal). Current terms = original offer +
  ordered chain of accepted amendments; the diff between any two links is the paper trail.
  Rejected/unaccepted amendments stay visible as proposed-but-not-agreed.
- **`org.buildguild.delivery`** — `{ quest: strongRef, agreement?: strongRef,
  milestone?: string, source: { repo?, commit: sha, treeHash?, ref?, path? }, note?,
  evidence?: [{type,value,note}], createdAt }`. Party asserts delivery **anchored to a
  specific git commit** — the primary, independently-testable proof (anyone can fetch the
  sha and run it; no trust in the assertion). `evidence[]` stays for the non-git tail
  (deploy link, design file). One delivery per milestone in the loop.
- **`org.buildguild.message`** — `{ subject: strongRef (quest/offer/…), replyTo?:
  strongRef, body, createdAt }`. A signed, public, threaded comment in the author's repo —
  the Tangled `…issue.comment` pattern (no standard cross-record comment lexicon exists;
  `chat.bsky` is centralized/off-record). Doubles as the negotiation + dispute trail.
  Private 1:1 is deferred (link out to Bluesky DMs if ever needed).
- **`org.buildguild.witness`** — `{ delivery: strongRef, commit: sha, treeHash?: sha,
  mirror?: uri, fetchedAt, createdAt }`. A trusted third party fetches the referenced sha
  and attests on-protocol that the content matched at time T, optionally serving the bytes
  (`mirror`). See §7 — this is how evidence survives the repo's later deletion.
- **`org.buildguild.settlement`** (extended) — gains optional `agreement` (→ acceptance),
  `for` (→ the delivery this slice pays), and `of` (the reward total), so a payment is one
  *slice* and a client sums slices to `fully-paid`.

Why progressive settlement is now possible: P2P removed the CC/ACH minimums and
per-transaction friction that forced one lump sum, so a settlement can pay a **slice**
(deposit, milestone payout, drip) and the agreement holds the total. The `quest` itself
stays a thin advert — it does *not* carry binding terms; those live on the offer.

## 3a. Standing & eligibility (who may file what)

Offers and amendments aren't attestations — they *create* the relationship, so "named
in the anchor" is circular and the existing eligibility enum doesn't apply. They need
their own standing rules in the verifier (the way `governance.js` validates admit/accept
against the charter). Decisions:

**Who may offer.**
- *Party-side claim:* **any verified builder** (any verified DID). Solo = a party of one;
  guild membership boosts matching/Guild Power but isn't required.
- *Patron-side:* the **quest author or an authorized delegate** — anyone holding a
  `quest.transact` **designation** for the quest (`org.buildguild.designation`, mode
  `delegate`). This is the general primitive, not a one-off field — see
  `notes/designation-primitive.md`.

**What makes it AGREED — every named principal co-signs.** atproto is single-writer and
we chose true per-person consent, so an offer naming `party:[A,B,C]` binds no one until
**all of them, plus the patron side, have co-signed**:
- AGREED(offer *O*) ⟺ for each principal in {patron-side} ∪ `O.party[]` there is an
  `acceptance(subject=O)` authored by them — *except O's own author*, whose authorship is
  their consent.
- So `acceptance` does double duty: a patron's accept = "I agree to the deal"; a party
  member's accept = "I consent to being on this party." The verifier tells them apart by
  author (patron/delegate vs. a `party[]` DID).
- New substate **`part-agreed`**: some principals have signed, not all. Only `AGREED`
  unlocks delivery; an offer that lingers part-agreed can be withdrawn.

**Amendments.** Same consent rule, on an already-accepted agreement:
- An amendment takes effect only when **every *current* principal co-signs it** (the
  proposer implicitly; a member being *added* must accept; on removal, the remaining
  members + patron suffice).
- Either side may propose any field — full mutual consent is the guard.
- Timing: offers are valid only while the quest is `open`/`offered`; once `AGREED`, a
  change goes through an amendment, never a fresh offer. An un-accepted offer is
  withdrawn/replaced, not amended.

## 4. P2P ripple effects (the actual review)

1. **Agreement-as-anchor** — delivery/payment/ratings/disputes all strongRef the
   acceptance, so reputation is judged against what was *agreed*, not asserted.
2. **Terms sequencing** — `upfront`: pay → deliver (patron at risk); `on_delivery`:
   deliver → pay (party at risk). The agreement pins which; the UI orders the steps
   accordingly; the audit lens reads it.
3. **Disputes without claw-back** — no escrow to reverse. A dispute is a *contested
   attestation* + evidence; resolution is reputational, optionally via an **arbiter
   named in the guild charter** whose ruling is itself an attestation. Detectability
   (audit) replaces the escrow penalty.
4. **Cancellation** — withdraw before `AGREED` is free; after `AGREED`, non-delivery /
   non-payment leaves a reputational mark (the agreement is the promise of record).
   A *mutually amended* wind-down (e.g. amend reward to what was delivered, then close)
   is clean; walking away silently is the mark.
5. **Party pinning moves earlier** — the agreement (not the settlement) fixes who's on
   the hook and who gets paid, feeding split + attestation eligibility from the start.
6. **Evidence everywhere** — deliveries and settlements carry `evidence[]` (a delivery
   also pins a commit sha); the audit lens (`src/audit.js`) flags un-evidenced steps and
   collusion, which is how a no-escrow system stays honest.
7. **Progressive settlement** (new) — P2P has no per-transaction floor, so big quests
   no longer need to be one all-or-nothing payment. Milestone payouts shrink the trust
   gap on *both* sides under either `terms`: a deposit de-risks the party, a pay-as-
   delivered drip de-risks the patron. This is the no-escrow substitute for "held
   funds" — risk is chopped into slices small enough that neither side gets badly burned
   if the other walks, and each slice is its own reputational signal.
8. **Git-anchored delivery** (new) — pinning delivery to a commit sha makes the proof
   *independently verifiable*: the patron (or an arbiter, or anyone) checks out the sha
   and runs it, rather than trusting a "done" assertion. This collapses most disputes
   before they start (the artifact either builds/passes or it doesn't) and gives the
   audit lens something concrete to check. Milestones map cleanly to commits, so the
   deliver→pay loop becomes commit→slice. (Caveat: only as strong as the work being
   git-shaped — design/ops deliverables still lean on `evidence[]`.)
9. **Amendable, on the record** (new) — the plan can change but never silently. Terms
   live as an append-only offer→amendment chain, each amendment co-signed like the
   original, original always visible. Off-record agreements are fine but unofficial:
   they carry no trust until filed. The audit lens compares on-record terms against
   actual deliveries/payments/party and flags divergence — so the commons, not escrow,
   is what holds the deal together. (See §1a.)

## 5. Dispute model (proposed: lightweight now)

- Default: contested attestations are *visible* (a quest with `deliver:yes` from the
  party and `deliver:no`-equivalent from the patron shows as contested, not clean).
- Optional escalation: a guild **designates an arbiter** (`org.buildguild.designation`,
  mode `trust`, capability `dispute.arbitrate`); their ruling is an attestation
  (`deliver.*` / `pays.promptly`) that viewers who honor that designation weight highly.
  No platform adjudication — just an extra, clearly-attributed, revocable opinion.
- Reputation + the audit lens do the enforcing. Formal multi-round arbitration is out
  of scope for v1 (revisit if abuse shows up).

## 6. Build plan (increments)

1. **Agreement + amendments**: offer + acceptance + amendment records + `agreed`
   status; UI for offer-from-either-side, accept, and propose/accept an amendment;
   terms folded from the append-only chain with original-vs-current shown. (Replaces
   the unilateral claim.)
2. **Delivery + progressive pay**: `delivery` record git-anchored to a commit;
   `settlement` extended with `amount`/`of`/`for`; the deliver→pay loop with
   `part-paid`/`fully-paid` summed client-side; ordering by terms.
3. **Quest threads**: `org.buildguild.message` + a comment UI on the quest drawer.
4. **Witnesses/mirrors**: `org.buildguild.witness` + a reference mirror that fetches and
   holds delivery shas; charter-named trusted witnesses.
5. **Disputes & moderation**: contested-state surfacing; charter arbiter; audit lens
   packaged as a labeler (`collusion-suspected` / `evidence-vanished`).

Confirmation + ratings already exist and slot in unchanged.

## 7. Substrate: witnessed vs. merely hosted (+ anti-abuse, moderation)

A natural question: how much of this could live in a git repo instead of atproto? Git
is an append-only, content-addressed, signable log — much of what we use atproto for.
But the answer turns on one property: **git is off-protocol, so its history is privately
rewritable and deletable** (`--force`, repo deletion, going private) **with no witness.**
That's the Bluesky deleted-post problem, worse: on atproto a deleted record was already
seen by relays/AppViews, so its prior existence and the *act* of deletion are
detectable; a force-pushed or deleted repo just vanishes, deniably. Git is
tamper-*evident* (a sha pins content) but not tamper-*resistant* or censorship-resistant
— the owner controls reachability.

So the line isn't content-vs-identity, it's **witnessed-vs-hosted**:

- **atproto = the commons (witnessed trust layer).** Anything that bears trust or that
  someone gains by hiding lives here: identity, agreements (offer/accept/amend — §1a's
  chain is *justified by this*, not a hack: git's free history isn't enough because it's
  privately rewritable), **delivery commitments**, settlements, attestations, threads,
  the index. Witnessed by relays → deletion is detectable, prior existence provable.
- **git = content layer (untrusted CDN).** Bulky deliverables (code, files) live here for
  convenience, **addressed by a commit/tree sha recorded on-protocol.** Git is treated as
  untrusted and replaceable; its disappearance is a *flagged signal*, not a lost claim.

The seam is **content-addressing + double-witnessing**: the on-protocol delivery record
embeds the git sha, and the **acceptance/confirmation re-states it**, so "DID X delivered
abc123, DID Y accepted it" is witnessed by both PDSes (plus relays) and survives the
repo's later deletion. The bytes hash to abc123 or they don't; any mirror can re-supply
them — so we don't depend on relay archival alone.

### Witnesses & mirrors — trusted third parties (decided)

Relay/PDS archival is best-effort, and the two principals both have incentives to make
evidence disappear, so the durability of the commons can't rest on them alone. The
answer is **trusted third-party witnesses** — the federated, on-protocol replacement for
the escrow agent. A witness (run by a guild, a neutral service, or a reputable member)
at delivery time fetches the referenced sha and publishes an `org.buildguild.witness`
record attesting "I fetched `commit`/`treeHash` at time T," and optionally **mirrors the
bytes** (`mirror` uri). Because the witness record is itself on-protocol, the witness
can't quietly retract, and multiple independent witnesses compound the guarantee.

Witnesses are **designated** (`org.buildguild.designation`, mode `trust`, capability
`delivery.witness`) — the same primitive as arbiters (§5) and labelers (below), see
`notes/designation-primitive.md`: a guild designates the witnesses/mirrors it trusts, and
a delivery gains weight from how many of them hold it. The audit lens' `evidence-vanished`
label fires only when a referenced sha is unreachable *and* no trusted witness holds it —
so honest deliveries are durable and deletions are loud.

### Anti-abuse scenarios → defenses

| Attack | Defense |
|---|---|
| Deliver, get paid, then delete/privatize the repo to hide the work | sha witnessed on-protocol + re-stated in acceptance; trusted third-party witnesses hold/mirror the bytes; vanished repo → `evidence-vanished` flag, not lost claim |
| Force-push to swap what a branch points at | pin the **commit sha**, never a branch — content-addressed, can only be orphaned, not changed |
| Sybil attestations / dogpiling | identity is on-protocol (DIDs cost something); reputation *weighted* by attester standing / web-of-trust, not raw count |
| Collusion ring (fake quest + delivery + mutual 5★ to farm rep) | closed loops are visible *because* it's all witnessed; audit lens flags them — it can't even see off-protocol collusion |
| Retaliatory false "didn't deliver" after stiffing the party | attestations contested-visible (both sides on record); delivery sha independently checkable; arbiter/labeler can rule |
| Host or PDS deplatforms someone | atproto identity is portable (migrate PDS, keep DID + history); content must be mirror-able → argues *against* deep single-git-host coupling |
| Permanent harmful/illegal content in an un-deletable commons | handled by **labeling/overlay, not deletion** (below) |

### Decentralized moderation — labelers, not takedowns

atproto's native model is **labelers**: independent services publish labels on
records/accounts (`fraud`, `evidence-vanished`, `collusion-suspected`, `abusive`);
clients/AppViews subscribe to the labelers they choose and filter accordingly. Here:

- The **audit lens** (`src/audit.js`) ships as a labeler — publishing
  `collusion-suspected` / `evidence-vanished` labels onto quests and DIDs.
- **Guilds designate the labelers they trust** (`org.buildguild.designation`, mode
  `trust`, capability `moderation.label` — the same primitive as arbiters and witnesses);
  a guild's reputation view is the labelers it endorses.
- Reputation is **subjective and composable** — you weight whose attestations and whose
  labels you trust. No global truth, no central moderator → moderation is decentralized,
  and "trust signal is the commons" sharpens to "the commons *as read through the
  labelers you choose.*"
- Harmful content is **labeled and filtered, not deleted** — the only takedown model
  consistent with a witnessed, append-only commons, and it keeps that power out of any
  single hand.

## 8. Open questions

- Should `offer` allow counter-offers (negotiation as a chain of offers), or is it
  one offer → accept/reject? (Threads can carry the haggling; offers stay clean.)
- Milestones now live *inside* one agreement (the deliver→pay loop), so big work no
  longer forces a chain of separate agreements. Remaining: do we declare milestones
  up front in the offer (`milestones: [{label, amount}]`, so the schedule is agreed)
  or let them emerge ad hoc as delivery/settlement pairs? (Leaning: optional declared
  schedule, ad-hoc allowed.)
- Git anchor: require a public/fetchable repo for the commit to be real proof, or
  accept private repos where only the patron can verify (weaker, but fine for closed
  work)? And do we record the host (GitHub/Tangled/raw) or just a clone URI?
- Does the agreement need both parties' *device-key* signatures, or is the atproto
  identity enough? (Consistent with the rest: device-key-signed Claimstead records.)
- Charter-named arbiter: per-guild only, or a network-level arbiter registry later?
- Witnesses/mirrors are *decided* (§7); remaining: who runs the first reference mirror,
  how many witnesses make a delivery "durable" by default, and do private deliverables
  get witnessed by an *encrypted* mirror or just hash-attested without the bytes?
- Should acceptance require the acceptor to prove they *fetched* the sha (re-state the
  tree hash), foreclosing "I never received it" as a later defense?
- Private/closed work: if the deliverable repo is legitimately private, the commons can
  witness the *hash* but not verify *content* — is hash-witnessing + patron attestation
  enough, or do we need a designated neutral verifier (a witness that also reviews)?
- Labeler bootstrapping: who runs the first audit-lens labeler, and how do guilds
  discover/endorse labelers — a default-trusted set, or fully opt-in?
