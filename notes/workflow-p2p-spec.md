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

## 2. Lifecycle

```
open ─▶ offered ─▶ AGREED ─▶ in-progress ─▶ delivered ─▶ paid ─▶ confirmed/closed
        (offer)   (accept)     (work)       (party+ev)  (patron+ev) (payee co-signs)
          │           │                                   │
          └── withdraw┘                          dispute ─┴─ (contested + evidence → arbiter?)
```

| State | Who acts | Record |
|---|---|---|
| `open` | patron | `org.buildguild.quest` (reward, terms, skills) |
| `offered` | **either** a party (claim) **or** the patron (invite a guild) | `org.buildguild.offer` |
| `AGREED` | the other side accepts | `org.buildguild.acceptance` (strongRef → offer) |
| `in-progress` | — | (none; thread comments) |
| `delivered` | party | `org.buildguild.delivery` (evidence[]) |
| `paid` | patron | `org.buildguild.settlement` (rail, ref, evidence[]) |
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
- **`org.buildguild.acceptance`** — `{ offer: strongRef, by: did, createdAt }`. The
  counterparty co-signs → AGREED. (Accepting the *exact* offer version via `cid` means
  terms can't be silently changed after acceptance.)
- **`org.buildguild.delivery`** — `{ quest: strongRef, by: did, note?, evidence: [
  {type,value,note} ], createdAt }`. Party asserts delivery, with checkable evidence
  (repo URL, commit hash, deploy link).
- **`org.buildguild.message`** — `{ subject: strongRef (quest/offer/…), body, replyTo?:
  strongRef, createdAt }`. A signed, public, threaded comment in the author's repo —
  the Tangled `…issue.comment` pattern (no standard cross-record comment lexicon
  exists; `chat.bsky` is centralized/off-record). Doubles as the negotiation + dispute
  trail. Private 1:1 is deferred (link out to Bluesky DMs if ever needed).

`org.buildguild.settlement` is unchanged (already P2P, carries evidence). Quests
already carry `terms`.

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
5. **Party pinning moves earlier** — the agreement (not the settlement) fixes who's on
   the hook and who gets paid, feeding split + attestation eligibility from the start.
6. **Evidence everywhere** — offers/deliveries/settlements all carry `evidence[]`; the
   audit lens (`src/audit.js`) flags un-evidenced steps and collusion, which is how a
   no-escrow system stays honest.

## 5. Dispute model (proposed: lightweight now)

- Default: contested attestations are *visible* (a quest with `deliver:yes` from the
  party and `deliver:no`-equivalent from the patron shows as contested, not clean).
- Optional escalation: the charter may name an **arbiter** DID; their ruling is an
  attestation (`deliver.*` / `pays.promptly`) that viewers may weight highly. No
  platform adjudication — just an extra, clearly-attributed opinion.
- Reputation + the audit lens do the enforcing. Formal multi-round arbitration is out
  of scope for v1 (revisit if abuse shows up).

## 6. Build plan (increments)

1. **Agreement**: offer + acceptance records + `agreed` status; UI for offer-from-
   either-side and accept; lock party/reward/terms. (Replaces the unilateral claim.)
2. **Delivery**: `delivery` record + evidence; `delivered` status; ordering by terms.
3. **Quest threads**: `org.buildguild.message` + a comment UI on the quest drawer.
4. **Disputes**: contested-state surfacing + optional charter arbiter.

Payment (settlement) + confirmation + ratings already exist and slot in unchanged.

## 7. Open questions

- Should `offer` allow counter-offers (negotiation as a chain of offers), or is it
  one offer → accept/reject? (Threads can carry the haggling; offers stay clean.)
- Are quests strictly atomic (≤5 days) with big work = a sequence of agreements, or do
  we want explicit milestones on one quest? (Leaning atomic.)
- Does the agreement need both parties' *device-key* signatures, or is the atproto
  identity enough? (Consistent with the rest: device-key-signed Claimstead records.)
- Charter-named arbiter: per-guild only, or a network-level arbiter registry later?
