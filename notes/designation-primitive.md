# Designation — the "X authorizes/trusts Y" primitive

_Status: design, for review. Extracts a recurring pattern into one record. Builds on
`notes/governance-claimstead-spec.md` (§6 capability chains, §8 nested enterprises) and
`notes/workflow-p2p-spec.md`. Lexicon: `lexicons/org.buildguild.designation.json`._

## 1. Why

"X authorizes/trusts Y to act in some capacity" was being reinvented per feature:

| Where | Current form | Problem |
|---|---|---|
| founder → officer | `role_grant` claim (`governance.js`) | only "officer", only founder-granted, guild-wide only |
| patron → delegate | `quest.delegates[]` field | one-off field; not revocable/auditable as its own act |
| guild → **arbiter** | "charter names an arbiter" (prose) | free text; no scope, expiry, or consent |
| guild → **witness/mirror** | "charter names trusted witnesses" (prose) | same |
| guild → **labeler** | "charter names trusted labelers" (prose) | same |
| guild → member | `admit` + `accept` | membership-specific (fine, but a special case of the same shape) |

Claimstead already anticipated the fix — §6: *"borrow UCAN / SPKI-SDSI / macaroon
capability chains: the charter delegates an attenuated, revocable capability to an
officer's own DID; the officer signs actions with their own key and presents the
delegation chain."* §8 wants these to **nest** (guild-of-guilds, per-quest sub-parties).
It was listed as not-yet-built. This is that primitive.

## 2. The primitive

One record — `org.buildguild.designation` — authored by the **grantor** (repo owner):

`{ grantee: did, mode: "delegate"|"trust", capability: string, scope: string,
   prev?: strongRef, expiry?: datetime, reason?, createdAt }`

**Two modes** (the one distinction that matters):
- **`delegate`** — the grantee may act **with the grantor's authority** within scope.
  Attenuated, revocable, chainable (UCAN). Their in-scope records count as authorized by
  the grantor. This is *authority flowing outward*.
- **`trust`** — the grantor **relies on** the grantee for a function; their records under
  the capability are weighted/trusted. **No authority transfer** — the grantee acts on
  their own behalf; the grantor just chooses to count them. This is *reliance*, and it's
  how atproto labelers already work (you subscribe to whom you trust).

**Capability** is an id from a capability ontology (a cousin of the predicate/contract
ontology): `quest.transact`, `role:officer`, `guild.admit`, `dispute.arbitrate`,
`delivery.witness`, `moderation.label`, … Granting a `role:` resolves its bundled
capabilities through the charter's `rules.roles` (so charters stay the policy layer).

**Scope** bounds it: an AT-URI / guild id / quest uri, or `*`. Attenuation rule: a
sub-delegation's capability and scope must be a **subset** of its parent's.

## 3. Authorization (the verifier rule)

A designation *counts* iff the grantor had standing to grant it:
- **Resource owner** — you can always designate over what's yours (a patron grants
  `quest.transact` on their own quest; a builder grants `trust` for their own reads).
- **Upstream authority** — otherwise the grantor must hold a `prev` designation (or a
  charter role/capability) that includes the power to grant this capability at this
  scope, and the grant must be attenuated (⊆ parent). Chains bottom out at a resource
  owner or `charter.founder`.

For `delegate`: a record authored by the grantee, in scope, is treated as authorized by
the grantor — the verifier walks the chain to a root. For `trust`: the verifier simply
checks "did a principal I care about designate this grantee for this capability (and not
expired/revoked)?" before counting their arbiter ruling / witness / label.

**Consent.** Where taking the capability is itself an act (officer, arbiter), the
designee co-signs with `org.buildguild.acceptance` (subject → the designation) — the
same co-sign primitive used everywhere else.

**Revocation.** Two cases (the membership case in §5 forced this to be explicit):
- *Self-withdrawal* — the grantor deletes/supersedes their own designation. Fine for
  `trust` grants (only the grantor's reliance, only they withdraw it) and for simple
  self-issued `delegate` grants. `expiry` gives the same effect, time-boxed.
- *Authority revocation* — someone **other than the grantor** revokes, across repos
  (an officer removes a member another officer admitted). You can't delete a record in
  another repo, so this needs an explicit `org.buildguild.revocation` (which also gives
  an append-only trail). Honored iff the revoker is the original grantor *or* holds
  authority to grant that capability at that scope (could have issued it). This
  generalizes governance's `remove`.

## 4. What collapses into it

- **role_grant** → `designation{ mode:delegate, capability:"role:officer", scope:guild }`.
  `governance.js` reads designations instead of a bespoke `role_grant` kind (it already
  separates policy (charter roles) from assignment (the grant); this just generalizes the
  assignment). Migration, not a rewrite.
- **patron delegate** → `designation{ mode:delegate, capability:"quest.transact",
  scope:<quest> }`. **Removes `quest.delegates[]`** — delegation becomes its own
  revocable, auditable act, not a buried field.
- **arbiter** → `designation{ mode:trust, capability:"dispute.arbitrate", scope:guild }`.
- **witness/mirror** → `designation{ mode:trust, capability:"delivery.witness", scope }`.
- **labeler** → `designation{ mode:trust, capability:"moderation.label", scope }`.
- **membership** (`admit`/`accept`/`remove`) → `designation{ mode:delegate,
  capability:"role:member" }` + `acceptance` + `revocation`. See §5 — this is the
  clarifying case, not a leftover.

Net: one primitive (+ its revocation counterpart) replaces three prose mechanisms, one
bespoke record, one field, and the membership lifecycle — and finally delivers the
UCAN-style capability chains the system was designed around.

## 5. Membership is a designation (the clarifying case)

Membership was mis-filed. `LEXICON.md` calls it an **attestation**; the Claimstead PoC
implements it as `admit`/`accept`/`remove` claims. Neither sits right, because an
**attestation is a subjective opinion that counts if you're eligible** ("I think Bob
delivered") whereas **admitting a member is an authority act** — someone with standing
exercising power. That's a designation, not an opinion. This is why membership always
needed special-case eligibility logic: it was the wrong primitive.

Reclassifying it pays off three ways:

1. **One authority graph, rooted in the collective** (see §8 — this superseded an
   earlier founder-co-sign root). Membership and mandates are minted by passed
   microvotes, not by a founder; from there a mandate-holder may sub-designate within
   its scope — all the *same* record, chained by `prev`, each accepted, each revocable.
   Governance stops being a bespoke `admit`/`role_grant`/`remove` engine and becomes
   **one designation DAG rooted in collective consent** — the nested capability chains
   Claimstead §6/§8 called for. (Implemented + tested: `src/collective.js`,
   `src/designation.js`.)
2. **Eligibility unifies.** `member_of_guild`, `patron_of_quest`, `party_of_quest` all
   reduce to the same check: *"does this DID hold the relevant (accepted, un-revoked,
   un-expired) designation, or is it named in the relevant anchor?"* One resolver instead
   of an enum of special cases.
3. **`remove` generalizes** to authority revocation (§3), and `requireAcceptance` becomes
   "this capability needs the designee's `acceptance` to take effect" — already true for
   officer/arbiter seats.

Mode is `delegate`: `role:member` confers whatever the charter's `rules.roles.member.can`
allows (vote, propose, …); a member acts with their own key, and their vote *counts*
because they hold the grant. A guild that wants pure belonging gives `member` an empty
`can`.

**Migration, not rewrite.** `governance.js` already separates policy (charter roles) from
assignment (`role_grant`) and lifecycle (`admit`/`accept`/`remove`); those map 1:1 onto
designation/acceptance/revocation. The working PoC keeps passing while readers move to the
unified resolver. Two primitives now carry governance + work: **attestation** (opinions)
and **designation** (authority/trust), with **acceptance** (consent) and **revocation**
(un-grant) as their shared verbs.

## 6. The closed primitive set (the symmetry check)

The consolidation passes (designation, membership, and a check of `acceptance`/`withdraw`)
leave a small, principled set on **two axes**:

- **Opinion** (descriptive — judgments that aggregate, weighted by eligibility):
  `attestation` (yes/no/unknown). "I judge X."
- **Performative** (acts that change obligations or authority): `designation` (grant),
  `acceptance` (consent — binds the signer), `revocation` (un-grant). "I do X."

This is the same opinion-vs-act line that moved membership out of attestation: consent
*binds you*, so `acceptance` is a performative and correctly stays its own primitive
rather than collapsing into a `yes` attestation.

`acceptance` checks out as genuinely one shape across offers, amendments, and
designations — `{ subject: strongRef, fetched?, note?, createdAt }` (the `fetched`
delivery-ack is the only context-specific, optional field).

**Two non-verbs, settled:**
- **withdraw** — retracting your *own* not-yet-final record is just deleting a record you
  own in your own repo (the self case already under revocation, §3). Not a separate
  primitive. (Revocation needed a *record* only because authority-revocation is cross-repo;
  withdraw never is.)
- **decline** — an eligible principal *refusing* (vs. merely not-yet-deciding) is the one
  place a fifth thing could go. For v1 it's unneeded: an offer that doesn't reach full
  consent simply stalls in `part-agreed` until the offerer withdraws. If that limbo proves
  annoying, add decline as the explicit negative of `acceptance` (a performative — rejecting
  an offer terminates it) — not before.

So: **one opinion primitive + three performatives, with consent (`acceptance`) shared
across all agreements.** The set is closed.

## 7. Open questions

- **Capability ontology** — publish capabilities as `org.buildguild.contract`-style
  definitions (so "who may grant X" is itself on-record and forkable), or keep a hardcoded
  core set in the verifier for v1? (Lean: hardcoded core now, ontology later.)
- ~~Genesis / root authority~~ **Decided + built (§8):** no durable founder — the
  membership is sovereign via per-action microvotes; "officers" are scoped recallable
  mandates. (`src/collective.js`.) An interim founder-co-sign root (`buildAuthority`) was
  built first and is now superseded.
- **Revocation retroactivity** — does revoking a grant invalidate acts the grantee already
  took under it (votes cast, members they admitted), or only future ones? (Lean: future
  only — past acts stand, like real-world resignations; but sanctions may need otherwise.)
- **Chain depth / attenuation checks** — how deep do we verify, and do we cache resolved
  authority in the AppView? (Perf vs. purity; the reference verifier stays pure.)

## 8. Collective sovereignty — no durable founder (decided + built)

A permanent founder is a latent single point of authority no matter how collective
everything downstream is. So **founding carries no durable power or responsibility**: it
is just ratifying the genesis charter, and the **genesis cohort** (`rules.genesis`) are
the initial members — nothing more. This drops the activation threshold (no privileged
founder structure to design) and puts the skin in the game on *membership*, since power
*is* membership.

Authority then comes only from **the membership acting collectively** — which means
votes. And votes are attestations, so this **closes the loop between the two primitive
families: collective opinion confers authority.** Concretely (anarcho-syndicalist):

- **The collective is sovereign via microvotes.** A `proposal` carries an `action`
  (`admit` / `remove` / `grant_mandate` / `recall` / `amend`) and an `enacts` payload;
  when it passes under the charter's rule, it mutates membership or mandates. Votes are
  `org.buildguild.attestation`s (contract `vote`).
- **"Officers" dissolve into scoped, recallable delegate-mandates.** A member is mandated
  *by vote* to carry a bounded capability (`grant_mandate`), and the collective can
  **recall** it — typically at a *lower* bar than granting (delegates are instantly
  recallable, hold no inherent power, execute a mandate).
- **Per-action vote bars.** `rules.vote = { <action>: {threshold, quorum} }` — e.g. admit
  at simple majority, recall cheap, charter amendment a supermajority. ("Micro" = light
  bars for light acts.)
- **Charters simplify:** no `founder` role and no special `can`; roles/mandates are pure
  capability bundles; the root is just the genesis cohort + the per-action vote rules.

The cost, paid deliberately: membership and authority are **temporal and mutually
recursive** — a vote is tallied against the electorate as of its decision, and passing it
changes the electorate later votes face.

### Sequencing is content-addressed, not clock-based (live roster)

Ordering authority decisions by a self-asserted `createdAt` is wrong: a timestamp is a
forgeable, skewed *claim*, and "races" (e.g. same-tick grant/recall) are the symptom. The
fix is **causal, content-addressed sequencing** — but note a strict single hash-*chain*
needs a sequencer to pick the next link, which re-centralizes on single-writer repos; so
the right shape is a causal **DAG** (git/CRDT-style): acts pin, by cid, the state they
were built on, and an auditor replays in causal order with concurrent acts *detectably*
concurrent rather than silently tie-broken.

Two things ride on this, both now built:

1. **Vote validity (live roster).** A vote carries `basis` = the **membership HEAD** it
   was cast under (the cid of the last roster-changing act it saw; the charter at genesis).
   A vote counts only while it pins the *current* head — so the instant the roster changes
   the head advances and every pending old-basis vote is **stale by inspection** (walk the
   `basis` link; no clock) and must be recast.

2. **Sequencing (causal order).** `createdAt` no longer participates in ordering at all.
   Every proposal names its causal predecessors — `basis` (the head it builds on) plus
   `enacts.target`/`enacts.supersedes` (recall→grant, re-grant→recall) — and
   `deriveCollective` **topologically sorts** that DAG (`causalOrder`), breaking ties
   between genuinely concurrent acts by **ref hash**. Replay is a pure function of the
   record *set*: independent of gossip order and of every wall clock. Content addressing
   guarantees acyclicity (you can only reference a cid that already exists).

Worked example — *grant → recall → re-grant ends granted* — no longer relies on
`T(1)<T(2)<T(3)`: the recall `target`s the grant and the re-grant `supersedes` the recall,
so the references force the order. *Same-tick grant + recall* is modelled as genuinely
**concurrent** (no edge between them) and resolved by ref tiebreak. Both are in
`test/collective-adversarial.test.js` (50-shuffle byte-identical replay); live-roster
staleness + recast in `test/collective-basis.test.js`. `basis`/`target`/`supersedes` are
real graph edges, so the debug view *shows* the chain to walk.

Built + tested overall: `src/collective.js` (`causalOrder` + head tracking + `staleVotes`);
`test/collective*.test.js`, 99/99. The whole authority path is now clock-free.

### Anti-grief: per-action freeze-at-open

Live roster has a liveness cost: a griefer can churn membership (keep admitting/removing)
to advance the head and stale everyone's `basis`, so a vote never accumulates enough fresh
votes to resolve. The guard is a **per-action charter policy**, `rules.vote[action].freeze`
(default `false`). A `freeze:true` action pins each of its proposals to the head it
**opened** on (its `basis`): the electorate is the open-time roster snapshot and votes stay
valid through later churn — immune to the stall, at the cost that the decision may land
against a roster that has since moved. Live stays the default (maximally current); freeze
is opt-in for the churn-weaponizable actions (e.g. a critical `amend`). Crucially the guard
is **clock-free** — it pins to a causal head, not a wall-time window — so it composes with
causal ordering rather than smuggling a clock back in. Built + tested: `headSnap` in
`src/collective.js`, `test/collective-antigrief.test.js` (frozen proposal byte-identical
across 30 churn-shuffles + judged on the open-time roster; the live recast cost it avoids).

### Delegated admit + live wiring

The collective root no longer needs a vote per admission. `src/guild.js` (`deriveGuild`)
composes the collective root with the designation chain below it: a member holding an
`admit` **mandate** (granted by vote, recallable) may issue a `role:member` designation
**directly**; the newcomer co-signs with `org.buildguild.acceptance`, and the grant stays
revocable (`org.buildguild.revocation`) and auditable as its own act. Authority is the
recallable mandate, not a founder — or, if the charter's member role `can:["admit"]`, open
admission. It's a fixpoint (a delegated-admitted, re-mandated member can admit further) and
set-based, so two verifiers agree. Built + tested: `test/guild-delegated-admit.test.js`
(mandate-holder admits; unmandated member can't; acceptance required; revocation drops;
open admission; order-independent chain).

And the derivers are no longer orphaned: `guildGraphFromRecords` (pure) assembles the
commons payload — collective summary (members, mandates, delegated admits, proposal
outcomes) + the verified record DAG — and is served live at **`GET /api/guilds/:id/graph`**
(`src/govstore.js#guildGraph`, verifying stored claims on read) and consumed by the debug
view via `?guild=<id>`. The offline sim writes the same payload through the same function,
so online and offline render identically. Tested: `test/guild-graph-payload.test.js`.

### Charter amendment (self-amending)

A passed `amend` now **executes**: it swaps the active charter `rules` for all SUBSEQUENT
proposals, while the amend itself is judged by the *prior* charter's amend bar (so the
constitution amends itself by its own rule). New rules come inline (`enacts.rules`) or from
a referenced `org.buildguild.charter` record chained by `prev` (`enacts.charter`); the
genesis cohort is preserved across versions. `deriveCollective` reports `charterVersion`,
`charterRef`, and the applied `amendments` trail, and the swap is causal/order-independent.
Built + tested: `test/collective-amend.test.js` (raises version + rebinds later proposals;
prior-bar rejection leaves rules standing; referenced-charter chaining; 20-shuffle
determinism).

### One model end-to-end (the `/state` → `/graph` reconciliation)

The older founder-rooted deriver (`deriveGuildState`) is no longer on the request path: the
`GET /api/guilds/:id/state` endpoint is **removed**, and the front-end governance panel
(`web/app.js` + `web/claimstead.js`) now reads the founder-free `GET /api/guilds/:id/graph`
and posts **new-model** records — a charter whose `rules.genesis` is the founding cohort, a
`proposal` carrying `question` + `basis` (the head), and a vote `attestation` with
`subject`/`value`/`basis`. So adopt → propose → vote runs entirely on the collective model.
`deriveGuildState` survives only as a tested standalone primitive (it still backs
`evidenceBundle` + `test/governance.test.js`). Contract locked by
`test/guild-client-flow.test.js` (the exact records the client posts → the payload the
panel renders).

Still open here: delegated *remove* of a delegated member via the vote path (revocation
works today), and the guild-patron delegation in the agreement workflow. (`closesAt`
survives only as an advisory "is voting open" gate — it gates decidability, never order.)
