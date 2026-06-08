# Quest workflow review + spec (post-P2P)

_A workflow review prompted by the peer-to-peer payment pivot, which removed escrow
— the thing that used to bind the two sides. This re-centers the lifecycle on a
**co-signed agreement** and adds public quest threads. Builds on `notes/governance-
claimstead-spec.md` and `LEXICON.md`. Status: design, for review._

## 1. Why this review

Escrow was the handshake: a claim was backed by held funds. P2P removed that, so
nothing binds patron and party until money moves. The fix is to make the **agreement
explicit and co-signed** — it becomes the trust anchor everything downstream
(delivery, payment, ratings, disputes) references. And once parties are committing to
each other, they need to **talk** — negotiate scope, coordinate, and leave a dispute
trail — so we add quest threads.

Decisions taken (this review): **public quest threads** as signed records;
**mutual agreement** where either side may offer and the other accepts.

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
open ─▶ offered ─▶ AGREED ─▶ delivered ─▶ part-paid ──────┘─▶ fully-paid ─▶ confirmed/closed
        (offer)   (accept)  (party@commit)(patron, partial)   (Σ ≥ reward)  (payee co-signs)
          │           │                        │
          └── withdraw┘               dispute ─┴─ (contested + evidence → arbiter?)
```
A quest is one agreement with a **deliver→pay loop**: each delivery pins a git commit,
each settlement pays a slice; the quest is done when paid slices sum to the reward.

| State | Who acts | Record |
|---|---|---|
| `open` | patron | `org.buildguild.quest` (reward, terms, skills) |
| `offered` | **either** a party (claim) **or** the patron (invite a guild) | `org.buildguild.offer` |
| `AGREED` | the other side accepts | `org.buildguild.acceptance` (strongRef → offer) |
| `in-progress` | — | (none; thread comments) |
| `delivered` | party | `org.buildguild.delivery` (git commit + evidence[]) |
| `part-paid` | patron | `org.buildguild.settlement` (amount, rail, ref, evidence[]) |
| `fully-paid` | — | Σ settlement amounts ≥ reward |
| `confirmed` | payee | `pays.promptly` attestation (the receipt co-sign) |
| ratings | both | attestations (`deliver.*`, `splits.fair`, `pays.promptly`, `specs.clearly`) |
| `withdrawn` | offerer | delete/tombstone the offer (before acceptance) |
| `disputed` | either | contested attestation (`deliver:no` / `pays.promptly:no`) + evidence |

**The keystone — the agreement = offer + acceptance** (two single-writer records,
paired by strongRef, mirroring governance's admit+accept). The pair locks **{party
DIDs, reward, terms}**; "AGREED" = both exist and agree. This is the escrow lock,
re-expressed as a co-signed claim.

## 3. New lexicons (sketch; `lexicon: 1`)

- **`org.buildguild.offer`** — `{ quest: strongRef, by: did, role: "patron"|"party",
  party: [did], reward: string, terms: "upfront"|"on_delivery", createdAt }`. Either
  side proposes terms.
- **`org.buildguild.acceptance`** — `{ subject: strongRef (offer | amendment), by: did,
  createdAt }`. The counterparty co-signs → AGREED (or an amendment takes effect).
  Referencing the *exact* version via `cid` means terms can't be silently changed after
  acceptance — any change has to come back through a new, co-signed amendment.
- **`org.buildguild.amendment`** — `{ supersedes: strongRef (offer | prior amendment),
  by: did, role: "patron"|"party", changes: { reward?, terms?, party?, milestones?,
  deadline? }, reason?, createdAt }`. The append-only unit of change: proposes a delta
  to the agreed terms, takes effect only when the counterparty files an `acceptance`
  against it (so amendment is as mutual as the original deal). Current terms = original
  offer + ordered chain of accepted amendments; the diff between any two links is the
  paper trail. Rejected/unaccepted amendments stay visible as proposed-but-not-agreed.
- **`org.buildguild.delivery`** — `{ quest: strongRef, by: did, milestone?: string,
  source: { repo: uri, commit: sha, ref?, path? }, note?, evidence?: [{type,value,note}],
  createdAt }`. Party asserts delivery **anchored to a specific git commit** — the
  primary, independently-testable proof (anyone can `git fetch` the sha and run it; no
  trust in the assertion needed). `evidence[]` stays for the non-git tail (deploy link,
  design file). One delivery per milestone in the loop.
- **`org.buildguild.message`** — `{ subject: strongRef (quest/offer/…), body, replyTo?:
  strongRef, createdAt }`. A signed, public, threaded comment in the author's repo —
  the Tangled `…issue.comment` pattern (no standard cross-record comment lexicon
  exists; `chat.bsky` is centralized/off-record). Doubles as the negotiation + dispute
  trail. Private 1:1 is deferred (link out to Bluesky DMs if ever needed).

- **`org.buildguild.settlement`** (extended) — add `{ amount: string, of?: string
  (reward total), for?: strongRef → delivery }`. P2P removed the CC/ACH minimums and
  per-transaction friction that forced one lump sum, so a settlement now pays a
  **slice**: deposits, milestone payouts, drips. The agreement holds the total; a
  client sums settlements to compute `part-paid` → `fully-paid`. `for` ties a payment
  to the delivery (commit) it settles, so the deliver→pay loop is auditable end to end.

Quests already carry `terms`.

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
6. **Evidence everywhere** — offers/deliveries/settlements all carry `evidence[]`; the
   audit lens (`src/audit.js`) flags un-evidenced steps and collusion, which is how a
   no-escrow system stays honest.
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
- Optional escalation: the charter may name an **arbiter** DID; their ruling is an
  attestation (`deliver.*` / `pays.promptly`) that viewers may weight highly. No
  platform adjudication — just an extra, clearly-attributed opinion.
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
4. **Disputes**: contested-state surfacing + optional charter arbiter.

Confirmation + ratings already exist and slot in unchanged.

## 7. Open questions

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
