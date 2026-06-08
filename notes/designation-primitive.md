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

1. **One authority graph.** `charter.founder` is the root (the genesis grant the charter
   itself confers). The founder designates officers (`role:officer`); officers designate
   members (`role:member`); a member could sub-designate within a per-quest sub-party —
   all the *same* record, chained by `prev`, each optionally accepted, each revocable by
   sufficient authority. Governance stops being a bespoke `admit`/`role_grant`/`remove`
   engine and becomes **one designation DAG rooted at the founder** — exactly the nested
   capability chains Claimstead §6/§8 called for.
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

## 6. Open questions

- **Capability ontology** — publish capabilities as `org.buildguild.contract`-style
  definitions (so "who may grant X" is itself on-record and forkable), or keep a hardcoded
  core set in the verifier for v1? (Lean: hardcoded core now, ontology later.)
- **Genesis / root authority** — is `charter.founder` the sole root, or can a charter name
  co-founders / multiple roots? (Affects how the DAG bottoms out.)
- **Revocation retroactivity** — does revoking a grant invalidate acts the grantee already
  took under it (votes cast, members they admitted), or only future ones? (Lean: future
  only — past acts stand, like real-world resignations; but sanctions may need otherwise.)
- **Chain depth / attenuation checks** — how deep do we verify, and do we cache resolved
  authority in the AppView? (Perf vs. purity; the reference verifier stays pure.)
