# Guild membership — use cases & the consent model

We built the governance engine (signed `designation` / `acceptance` / `revocation` →
`deriveGuild`) but the everyday join/recruit UX wrote straight to the crude `guild_members`
table, bypassing all of it. These are the use cases that reconnect the two, decided with
the product owner:

- **Membership source of truth:** signed claims. `guild_members` becomes a *projection*
  rebuilt from the derived set; genesis (founding members) is the only server-asserted
  bootstrap. Join / recruit / leave all emit signed claims.
- **Recruit:** follows the guild's own charter (delegated grant, or an admit vote).
- **Charter:** composable via a guided builder (not just the hardcoded default).

## The charter knobs (`src/charter.js`)

`DEFAULT_RULES(genesis)` → `{ genesis, vote{…bars}, roles.member.can, membership }`.
- `membership.openJoin` (default **true**): anyone may self-admit. Off ⇒ invite/vote-only.
- `membership.requireAcceptance`: advisory — the engine *always* requires a newcomer to
  co-sign a grant before it takes effect; a self-grant is self-consented.
- `vote` bars: integer-percent `{ threshold, quorum }` per action
  (admit / remove / grant_mandate / recall / amend).

## Use cases

### UC1 — Self-join / leave
- **Open guild:** newcomer signs a self `role:member` designation (`author == grantee`).
  Self-consented, so it admits with no separate acceptance. (`openJoin` only.)
- **Closed guild** (`openJoin:false`): a self-grant does **not** admit — must be recruited
  or voted in.
- **Leave:** member signs a self-`revocation` of their membership grant → dropped.

### UC2 — Recruit (follows the charter) — `admitPath(charter, derived, actor, target)`
- `actor` can admit directly (holds an `admit` mandate, or `roles.member.can` includes
  `admit`) → **grant**: `actor` signs a `role:member` designation; the recruit co-signs an
  `acceptance`. No vote. Unaccepted ⇒ a *pending invite*, not a member.
- `actor` is a member without admit power → **propose**: open an `admit` proposal; the
  guild votes; on pass the recruit is admitted (a collective decision).
- `actor` is not a member → **denied**.

### UC3 — Compose a custom charter
- Guided builder writes a full `rules` object (genesis, vote bars, openJoin,
  member capabilities) → signed `org.buildguild.charter`. Custom bars take effect for
  subsequent proposals (the charter is self-amending by `amend` vote).

### UC4 — Drive it as a test persona (Ada)
- Personas are `did:test:*`; governance signing works (cookie session + device key, no DID
  resolution). The break is the **OAuth/handle-login** resolvers (`didToPds`,
  `resolveDidDoc`) throwing `unsupported DID method` — a persona must be entered via the
  switcher, and a test handle typed into real login must route to `act-as`, not OAuth.

## Phasing
1. **Engine + spec** (this doc): open-self-join in `deriveGuild`; shared `charter.js`;
   `admitPath`; pure use-case tests. ← done
2. **DB projection:** `deriveMembership` + `reprojectGuildMembers`, founder genesis,
   reproject on membership claim writes; getGuild/listGuilds stay table-backed.
3. **Frontend:** client signers (designate/accept/revoke); charter-builder form;
   recruit-follows-charter; pending-invite + accept UI.
4. **Persona/DID fix:** route test handles to `act-as`; clear error otherwise.
