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

**Revocation.** Delete or supersede the designation (the grantor owns it in their own
repo; the deletion is witnessed/detectable like any other record). `expiry` gives
time-boxing without action. (An explicit append-only revoke record is a possible future
refinement; deletion is enough for v1 because a unilateral grant is the grantor's to
withdraw, and the withdrawal is observable.)

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
- **admit/accept** *could* be `designation{ mode:delegate, capability:"role:member" }` +
  acceptance — but membership has its own lifecycle (remove, requireAcceptance) and a
  working PoC, so leave it as-is for now and note it's the same shape. (Unify later if it
  earns its keep.)

Net: one primitive replaces three prose mechanisms and one bespoke record + one field,
and finally delivers the UCAN-style capability chains the system was designed around.

## 5. Open questions

- **Capability ontology** — publish capabilities as `org.buildguild.contract`-style
  definitions (so "who may grant X" is itself on-record and forkable), or keep a hardcoded
  core set in the verifier for v1? (Lean: hardcoded core now, ontology later.)
- **Membership** — fold `admit`/`accept` into designation now, or after it's proven on the
  lighter cases (delegate/arbiter/witness)? (Lean: after.)
- **Explicit revoke vs delete** — is silent delete acceptable for capability withdrawal,
  given the project's append-only ethos elsewhere? (A grant is unilateral and the deletion
  is witnessed, so probably yes — but worth a deliberate call.)
- **Chain depth / attenuation checks** — how deep do we verify, and do we cache resolved
  authority in the AppView? (Perf vs. purity; the reference verifier stays pure.)
