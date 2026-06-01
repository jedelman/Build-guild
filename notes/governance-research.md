# Governance on atproto — research findings

_Foundation research for **#21 (Epic: Guild governance)**. Method: 5 parallel research
agents over primary sources (atproto specs, did-method-plc, Tangled, lexicon-community,
Bluesky/Ozone docs, GitHub discussions), then cross-agent verification. Confidence labels
and flagged conflicts are preserved. This is **findings, not a design decision** — the
custody call is deliberately left open pending atproto-core-dev input._

---

## TL;DR

1. **There is no multi-writer repo on atproto.** Single-writer repos with a single
   signing key per DID is firm and load-bearing — a guild cannot have many members
   co-sign one repo. (high)
2. **The proven pattern for multi-party state is "host-owned anchor record + per-member
   records in each member's own PDS, all `strongRef`-linked, aggregated by an AppView."**
   Both **Tangled** (git collaboration) and **Smoke Signal** (events/RSVP) do exactly this.
   It is the single most important precedent for us. (high)
3. **No native voting / quorum / DAO primitive exists.** That part is genuinely frontier;
   it must be synthesized at the AppView by tallying per-member vote records. (high)
4. **For a PDS-native guild, the guild should be its _own_ atproto account (a guild DID).**
   You cannot write into a separate DID's repo on someone else's authority, so canonical
   guild records must be authored by a session operating _as the guild account_. `did:plc`
   supports up to **5 priority-ordered rotation keys**, giving real (but hierarchical, not
   multisig) shared/escrow custody of that identity. (high)
5. **Money stays off-protocol** (Stripe); the atproto-native move is to **attest outcomes**
   only. There is no native escrow or dispute primitive. (high)

---

## 1. The hard constraint: single-writer repos

- **C1.1** Each atproto account has exactly one repository holding all its public records.
  (high) — https://atproto.com/specs/repository
- **C1.2** A repo is single-writer: commits are signed by that account's one active signing
  key; there is no mechanism for one account to write into another's repo. (high) —
  https://atproto.com/specs/repository ; corroborated https://atproto.com/specs/permission
- **C1.3** Records are content-addressed by **CID** (immutable, self-certifying) over an MST
  whose root is covered by the signed commit. (high) — https://atproto.com/specs/data-model
- **C1.4** **`com.atproto.repo.strongRef` = `{uri, cid}`** ("A URI with a content-hash
  fingerprint"), both required. It pins one immutable _version_ of a target record and works
  **across repos** — the canonical cross-repo link primitive. (high) —
  https://github.com/bluesky-social/atproto/blob/main/lexicons/com/atproto/repo/strongRef.json

> **Implication:** multi-party guild state is _necessarily_ either (a) one shared/guild DID
> whose single signing key is operated on behalf of many, and/or (b) per-member records in
> members' own repos linked by `strongRef`. These are complementary, and the prior art uses
> both together.

## 2. The proven pattern (prior art)

### Tangled — git collaboration on atproto (our strongest precedent)
- **C2.1** Architecture = AppView (`tangled.sh`) + self-hostable **knots** (git servers, the
  data layer) + **spindles** (CI). (high) — https://docs.tangled.org/single-page
- **C2.2** **Tangled does _not_ use a shared "group/team" record.** Membership/permissions
  are the **union of per-actor, single-writer records**, each in its author's PDS, all
  pointing at a stable **repo DID**:
  - `sh.tangled.repo` — repo pointer: `name`, `knot`, `repoDid`, `createdAt`… (high)
  - `sh.tangled.repo.collaborator` — `{subject (collaborator DID), repo (repo DID), createdAt}`,
    **one record per collaborator**, written by the owner. (high)
  - `sh.tangled.knot.member`, `sh.tangled.spindle.member` — `{subject, domain/instance, createdAt}`. (high)
  - Contributions without write access = `sh.tangled.repo.pull` carrying a gzipped
    `git format-patch` **patch blob** referencing the target repo DID. (high)
  - Sources: the `sh.tangled.*` lexicons under https://tangled.org/tangled.org/core/tree/master/lexicons
- **C2.3** The **authoritative _runtime_ ACL is a server-side Casbin RBAC enforcer** keyed on
  `(user DID, domain, repo)` with roles `knot_owner|knot_member|spindle_owner|spindle_member|collaborator`
  and gates `IsPushAllowed`, `IsCollaboratorInviteAllowed`, etc. It is **derived from** the PDS
  records (ingested via Jetstream), not itself an atproto record. (high; the record→enforcer
  wiring is med-high inference) — https://pkg.go.dev/tangled.sh/tangled.sh/core/rbac
- **C2.4** Repos get their own **repoDID** (stable across rename/transfer); authorship is the
  standard atproto signing-key-under-DID. (high) — https://docs.tangled.org/single-page

> **Takeaway:** declarative state is distributed across many single-writer PDSes; a service
> computes the authoritative _enforcement_ state by aggregating those records. This is almost
> exactly the Build-Guild shape (guild = repo, member = collaborator, officer role = RBAC).

### Smoke Signal — host-owned event + per-actor RSVP
- **C2.5** Organizer hosts a `community.lexicon.calendar.event` record in their PDS; attendees
  publish `community.lexicon.calendar.rsvp` records **in their own PDS** whose `subject` is a
  **`strongRef`** to the event; an AppView aggregates them off the firehose. The event record
  holds **no attendee list** — attendance is expressed externally. (high) —
  https://github.com/lexicon-community/lexicon (calendar `event.json`/`rsvp.json`);
  https://atprotocol.dev/tech-talk-smoke-signal-events/
- **C2.6** These types were moved from app-specific NSIDs to community-owned `community.lexicon.*`
  governed by a volunteer steering committee — a deliberate "credible exit." (high) —
  https://blog.smokesignal.events/posts/3lthgjbbhyk2c-community-lexicons

### Single-owner curation primitives (what they _can't_ do)
- **C2.7** `app.bsky.graph.list` / `starterpack` are single-owner records; being added to a list
  is not an action by the listee. No co-ownership, no membership consent. (high) —
  https://docs.bsky.app/docs/api/app-bsky-graph-get-starter-pack
- **C2.8** **Labelers/Ozone**: a labeler is a service keyed by **one DID**; every label carries
  that single `src`. Ozone supports a _team_ of moderators, but the protocol still attributes
  everything to one signing DID — multi-party is an operational/UI convention, not a
  protocol-expressed collective decision. Cannot express tallies/quorum/proposals. (high) —
  https://atproto.com/specs/label ; https://github.com/bluesky-social/ozone ;
  https://bsky.social/about/blog/03-12-2024-stackable-moderation

## 3. Custody options (the open decision)

| Model | How canonical guild state is held | Pros | Honest failure modes |
|---|---|---|---|
| **A. Guild service-DID** (own account) | Guild is its own atproto account; records authored by an app-operated session as the guild | Established pattern (feed-gens, labelers are service-DID accounts owning canonical records, C3.1); clean "the guild owns its data"; portable; `did:plc` 5 rotation keys → shared/escrow custody (C3.2) | Someone/something must hold the guild account's credentials + rotation keys; OAuth "not recommended for headless/bot" today (C5.x) so likely stored creds; rotation-key custody = the real control point (§7) |
| **B. Founder-hosted + co-signed** | Founder's PDS holds the anchor guild record; members publish records in _their own_ PDS that `strongRef` it (Smoke Signal/Tangled shape) | No custodial account to operate; maximal user-ownership of each member's contribution; matches proven prior art | Single point of failure at the founder: if they delete the record or get taken down, inbound refs **orphan** (C7.x); founder succession is awkward |
| **C. D1-authoritative now** | Server DB is source of truth; PDS relocation deferred | Fastest; mirrors the #4/#8 "build in D1, relocate later" precedent | Not user-owned/portable yet; contradicts the PDS-native goal |

- **C3.1** Service accounts owning canonical records is an established pattern: feed generators
  and labelers are DID-identified accounts that publish declaration records into their own repo.
  (high) — https://docs.bsky.app/docs/advanced-guides/moderation
- **C3.2** `did:plc` control rests in **1–5 priority-ordered rotation keys**; any listed key can
  sign ops, a higher-authority (lower-index) key can override a lower one, with a **72h** recovery
  window. This enables shared/escrow custody of one guild identity — but it is **hierarchical, not
  multisig/threshold**, and framed by the spec as recovery/custody, not co-equal governance.
  (high mechanism; med that it's an intended "group governance" use) —
  https://web.plc.directory/spec/v0.1/did-plc
- **C3.3** `did:web` is the alternative: control = domain control. Simpler, survives plc.directory
  outage, maps to a guild-owned domain — but **less portable** (DID changes if the domain moves),
  no signed rotation audit log, and control collapses to "who edits the DNS/web doc." (high) —
  https://atproto.com/guides/identity

> **Given the PDS-native lean:** the research points to **A as the primary** (guild = its own
> account, so it genuinely "owns" its records and is portable) **composed with B** for member
> consent/votes (members author their own consent in their own repos, `strongRef`-ing the guild
> records). C remains the pragmatic fallback if operating a guild account proves too heavy.

## 4. Voting & proposals (frontier — no precedent)

- **C4.1** **No atproto-native voting/poll/quorum/DAO primitive exists.** A Bluesky maintainer
  (Aug 2023) called it "on our radar … something 3rd parties could do as an extension." The only
  implementation is a third-party workaround (`blueskypolls.xyz`). (high) —
  https://github.com/bluesky-social/atproto/discussions/1310
- **C4.2** atproto frames "consensus" as social coordination between app devs over lexicon
  semantics, deliberately pushing collective-decision logic up to the AppView. (high) —
  https://atproto.com/specs/lexicon

> **Synthesized native design (what the prior art implies):** a **proposal** record authored by
> the guild account (or founder); each member publishes a **vote** record in their _own_ PDS that
> `strongRef`s the proposal (pinning its exact `cid`); the AppView tallies. Sybil resistance =
> verified Bluesky handles + the guild's own membership set (one vote per member DID). An
> _attestation/co-sign_ lexicon is **proposed but not ratified** (`community.lexicon` Discussion #8;
> intentionally _no_ co-signing, invalidates on record update) — usable later for signed outcomes.
> (proposal-stage) — https://github.com/orgs/lexicon-community/discussions/8

- **⚠️ Verification nuance (cross-agent conflict, important):** Tangled ingests records via
  **Jetstream** (C2.3), but Bluesky explicitly says **Jetstream is _not_ self-authenticating** and
  is **inappropriate for "knowing who said what," moderation, or anti-abuse** — those should use the
  authenticated firehose. **Implication for us:** Jetstream is fine for convenience ACLs, but
  **money-affecting vote tallies must be verified against authenticated records** (firehose with
  signatures, or `getRecord` + signature/CID verification), not trusted from Jetstream. (high) —
  https://atproto.com/blog/jetstream

## 5. Permissions — acting on behalf of a guild

- **C5.1** OAuth/App-Passwords authorize actions **only within the authenticating account's own
  repo**; there is **no primitive** to write into a _different_ DID's repo on a user's authority.
  (high) — https://atproto.com/specs/permission ; https://atproto.com/specs/repository
- **C5.2** Therefore a guild's canonical records require operating a session **as the guild
  account** (bot pattern: stored credentials / a managed session). OAuth is currently **"not
  recommended for headless clients,"** so today this leans on stored creds. (med — implied
  best-practice) — https://docs.bsky.app/docs/advanced-guides/oauth-client
- **C5.3** **Granular OAuth scopes** (`repo:<collection>`, `rpc:`, `blob:`, `account:`, `identity:`)
  **shipped on bsky.social in Aug 2025**, rolling out to self-hosted PDS; Bluesky advised holding
  production migrations pending final docs. (high; date-stamped) —
  https://github.com/bluesky-social/atproto/discussions/4118
- **C5.4** **Permission sets** (bundled scopes via `include:<nsid>`) were still **in active
  development as of Dec 2025**. (high; date-stamped, proposed) —
  https://github.com/bluesky-social/atproto/discussions/4437
- **C5.5** **Service auth** (`com.atproto.server.getServiceAuth`) mints short-lived JWTs scoped by
  `aud` + a single `lxm` (lexicon method); it **cannot exceed the session's own authority** and
  cannot grant cross-repo writes — it's for inter-service calls / proving a user's DID to a backend.
  (high) — https://atproto.com/specs/xrpc ; https://github.com/bluesky-social/atproto/discussions/3424
- **C5.6 (frontier):** a community proposal ("multi-user auth → one org DID," HackMD + discussion
  #3424) would let several humans OAuth into one org repo with the PDS issuing tokens whose subject
  is the org DID — **not ratified**, and the network still sees one DID/one signing key. (low —
  snippet-only, login-gated source) — https://github.com/bluesky-social/atproto/discussions/3424

## 6. Membership lifecycle (native shape)

- Invitation + acceptance as **paired records** (guild-hosted invite ↔ member-hosted acceptance via
  `strongRef`), mirroring event↔RSVP (C2.5) and Tangled's per-collaborator records (C2.2). Removal =
  delete/tombstone the membership record (+ optional negation). Index by consuming the firehose /
  `com.atproto.sync` and/or per-repo `listRecords` for backfill. (high, by analogy to proven prior art)
- **C6.1** AppViews aggregate across many PDSes via the firehose `com.atproto.sync.subscribeRepos`
  (`#commit/#identity/#account`, monotonic `seq` cursor); the firehose is **not a complete archive**
  (bounded replay) so a **separate backfill** path (`getRepo` CAR / `listRecords`) is needed. (high) —
  https://atproto.com/specs/sync

## 7. Portability & failure modes

- **C7.1** The **DID is the stable identifier**; repos and AT-URIs are DID-keyed, so records (and
  inbound `strongRef`s) survive **PDS migration**. (high; strongRef-survival is mechanism-inference —
  migration guide doesn't state it explicitly) — https://atproto.com/guides/account-migration
- **C7.2** Migration mechanics are **explicitly not a formal, stable part of the protocol** yet. (high)
  — https://atproto.com/guides/account-migration
- **C7.3** **Rotation-key custody is the true governance choke point.** A single custodian holding the
  highest-authority key can unilaterally re-point/rewrite the DID; if **all** rotation keys are lost
  there is **no recovery**. Bluesky's managed PDS holds a rotation key by default; adding a
  self-controlled key is recommended. (high; total-loss is absence-of-mechanism) —
  https://web.plc.directory/spec/v0.1/did-plc ; https://atproto.com/guides/account-migration
- **C7.4** **Host-owned canonical record = single point of failure**: if the host account is
  `deleted`/`takendown`/offline, that record + blobs stop being served network-wide and inbound
  `strongRef`s **orphan**. Documented mitigation: **discourage deletion, prefer state changes**
  (e.g., `cancelled`). (high) — https://atproto.com/specs/account ;
  https://blog.smokesignal.events/posts/3lvbownlrme2a-atprotocol-record-references-authoritative-vs-unauthoritative-patterns

## 8. Money & disputes (lighter)

- **C8.1** **No atproto-native escrow or dispute primitive.** The emerging precedent
  (`attested.network`, **draft**) defines payment **attestation** records
  (`network.attested.payment.*` + a three-party declare/confirm/witness proof model) and explicitly
  puts settlement (Stripe/bank/etc.) and dispute resolution/refunds **out of scope**. (high; draft) —
  https://attested.network/
- **C8.2** Confirms our existing guardrail: **money + PII live off-protocol (Stripe)**; the protocol
  layer only **attests outcomes** (e.g., "quest delivered," "split released"). (high)

---

## Open questions to put to atproto core devs

1. **Shared guild custody:** is multi-rotation-key `did:plc` (hierarchical, 5 keys, 72h) an
   acceptable way to share/escrow control of a guild account — or is a better collective-custody
   primitive emerging? Any appetite for threshold/multisig at the identity layer?
2. **Operating a group account:** with OAuth "not recommended for headless," what's the recommended
   2026 way to run an app-operated guild/service account (stored creds? a sanctioned bot-OAuth path?
   the "multi-user → one org DID" idea in #3424)?
3. **Verifiable tallies:** for money-affecting votes, is verifying records on read (`getRecord` +
   sig/CID) the right call vs. the authenticated firehose — and is Jetstream genuinely off-limits here?
4. **Native collective primitives:** any roadmap for protocol-level groups / voting / co-signed
   records (beyond the `community.lexicon` attestation proposal)?
5. **Lexicon home:** for guild/governance lexicons, contribute to `community.lexicon.*` or keep an
   `org.buildguild.*` namespace with a documented credible-exit?

---

## Source index (deduped)

**atproto specs/guides:** repository, data-model, account, identity, label, lexicon, oauth,
permission, xrpc, sync · https://atproto.com/specs · https://atproto.com/guides/identity ·
https://atproto.com/guides/account-migration · https://atproto.com/blog/jetstream
**did:plc:** https://web.plc.directory/spec/v0.1/did-plc (mirror: github.com/did-method-plc/did-method-plc)
**Bluesky/Ozone:** https://docs.bsky.app/docs/advanced-guides/moderation ·
https://github.com/bluesky-social/ozone · https://bsky.social/about/blog/03-12-2024-stackable-moderation ·
https://docs.bsky.app/blog/oauth-atproto
**GitHub discussions:** #1310 (voting) · #3424 (service auth / multi-user) · #3655 (OAuth scopes) ·
#4118 (granular scopes shipped, Aug 2025) · #4437 (permission sets, Dec 2025) · #2705 (did:web)
**strongRef lexicon:** github.com/bluesky-social/atproto/.../com/atproto/repo/strongRef.json
**Tangled:** https://docs.tangled.org/single-page · https://blog.tangled.org/ci/ ·
https://pkg.go.dev/tangled.sh/tangled.sh/core/rbac · `sh.tangled.*` lexicons at
https://tangled.org/tangled.org/core/tree/master/lexicons
**lexicon-community:** https://github.com/lexicon-community/lexicon ·
https://github.com/orgs/lexicon-community/discussions/8 (attestation proposal)
**Smoke Signal:** https://blog.smokesignal.events · https://atprotocol.dev/tech-talk-smoke-signal-events/
**attested.network (payments, draft):** https://attested.network/

_Confidence is per-claim above; items marked frontier/proposed/date-stamped are not settled
protocol. The biggest interpretive leaps (flagged inline): multi-rotation-key as "group custody,"
the record→RBAC ingestion wiring in Tangled, and strongRef survival across migration._
