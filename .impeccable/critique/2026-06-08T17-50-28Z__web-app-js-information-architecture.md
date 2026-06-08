---
target: web/app.js (information architecture)
total_score: 26
p0_count: 0
p1_count: 3
timestamp: 2026-06-08T17-50-28Z
slug: web-app-js-information-architecture
---
# IA Critique — Build Guild (web/app.js)

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 3 | Async governance/reputation pop into the drawer with no skeleton |
| 2 | Match System / Real World | 3 | Guild/party/quest/bounty metaphors apt + consistent |
| 3 | User Control and Freedom | 3 | Esc/back/drawer sync with history; votes are final (no undo) |
| 4 | Consistency and Standards | 3 | Strong component vocab; drawer-vs-page inconsistent; creation actions scattered |
| 5 | Error Prevention | 2 | Consequential governance acts (adopt charter, vote) have no confirm; propose-then-can't-vote |
| 6 | Recognition Rather Than Recall | 3 | Labeled nav (good); governance buried; Enlist→Character swap hides state |
| 7 | Flexibility and Efficiency | 2 | No keyboard shortcuts, command palette, or bulk actions; deep links are the only accelerator |
| 8 | Aesthetic and Minimalist Design | 2 | Guild drawer stacks 7 sections at equal weight; no progressive disclosure |
| 9 | Error Recovery | 3 | Plain-language toasts; deep-link-to-removed-entity recovers gracefully |
| 10 | Help and Documentation | 2 | Good inline captions; no governance explainer at point of use; the-idea.md unlinked |
| **Total** | | **26/40** | **Acceptable — solid plumbing, overloaded structure** |

## Overall Impression

The *plumbing* is genuinely good: a clean hash router with shareable deep links, focus-trapped drawers that restore focus, a responsive rail/bottomnav shell, consistent `subform`/`badge`/`btn` vocabulary. The problem is **structural, not cosmetic** — which is exactly why fixing it before the visual pass is right. Almost every entity (quest, guild, builder) renders as a right-side **drawer over a list**, and the guild drawer has become an *everything-drawer*: a full page of IA crammed into a 420px overlay. The headline new capability — governance — is buried at the bottom of it.

## What's Working

- **The hash router + deep linking** (`applyRoute`/`parseHash`): `#/quest/:id` etc. are bookmarkable, Back/forward and cold loads resolve, and a link to a removed entity recovers with a toast instead of throwing. That's careful work.
- **Labeled nav, not icon-only** (`navItems`/`renderNav`) with active `aria-current`, mirrored to rail + bottomnav from one source. Recognition-friendly and DRY.
- **Inline captions teach the domain** (Guild Power "rewards complementary peaks…", recruits "fills the party's gaps"). The vocabulary is consistent and on-brand.

## Priority Issues

- **[P1] The guild drawer is an everything-drawer.** `openGuild` stacks ~7 major sections in one scroll: header, Guild Power meter, join/leave, Party, Combined skill-map, Recommended recruits, Reputation (async), Governance (async). That's far past the ≤4-chunk working-memory limit with no progressive disclosure, in a 420px overlay. **Why it matters:** the user came to *do one thing* (govern, recruit, scan the party) and must scroll a page-length column to find it. **Fix:** promote the guild to a real routed view with sections/tabs (Overview · Party · Quests · Governance), or at minimum tab the drawer. *Suggested command: `/impeccable shape` the guild surface.*

- **[P1] Governance has no first-class entry point.** It's the new flagship (adopt → propose → vote → mandate → amend) but there's no nav item, no signal on the guild card that proposals are open, and no deep link to a proposal. The only path is Guilds → open guild → scroll past 5 sections → panel (which then async-mounts last). **Why it matters:** discoverability is near zero; you can't share "vote on this." **Fix:** surface governance state on the guild card ("2 open proposals"), give proposals a deep-linkable sub-route (`#/guild/:id/gov` or `#/proposal/:id`). *Suggested: `/impeccable shape`.*

- **[P1] Drawer-as-primary-navigation fights the content.** Quests and guilds are *destinations* (a quest is a job posting; a guild is a team) but always render as transient overlays over a list, never a focused page. On mobile the drawer is full-screen anyway — so it's a page wearing a drawer's clothes. **Fix:** decide drawer vs page per entity: quests + guilds want real pages; a builder peek can stay a drawer. *Suggested: `/impeccable shape`.*

- **[P2] The Enlist→Character nav swap hides state.** The 4th destination silently changes label + target based on whether you have a sheet. The nav isn't stable between sessions/users, there's no stable "my stuff" home, and no way back to an "enlist/edit" entry once you're a character. **Fix:** keep Character always present once authed; fold "Enlist" into an empty Character state. *Suggested: `/impeccable clarify` + `shape`.*

- **[P2] Primary "create" actions are scattered and inconsistent.** Post a quest (hero button in Quests), Found a guild (Guilds view), Enlist (Enlist view) live in three different places with three vocabularies — yet PRODUCT.md says quests + earnings are first-class. There's no consistent primary affordance. **Fix:** one primary-action pattern, consistent placement per view; reconcile the three creation flows. *Suggested: `/impeccable layout`.*

## Cognitive Load

The guild drawer fails 4 of 8: **Single focus** (7 sections compete), **Chunking** (>4 groups), **Minimal choices** (join + recruit + vote + endorse + navigate all present), **Progressive disclosure** (everything rendered at once). 4 fails = **high load** on the most important authenticated surface.

## Persona Red Flags

- **Jordan (first-timer):** Opens a guild, sees a wall of 7 sections; "Guild Power 62", "mandates", "delegated admit" arrive with no point-of-use explainer. Adopts a charter via one button with no preview of what rules they're committing to. Likely scrolls past governance without realizing it's the point.
- **Casey (mobile, one-handed):** The guild drawer is a long full-screen scroll; the governance actions (propose/vote) sit at the very bottom, far from the thumb. No tab to jump straight to them. State is preserved on the URL (good), but the reach is bad.
- **Alex (power user):** No keyboard shortcuts, no command palette, no way to jump to "open proposals" across guilds. Deep links are the only accelerator and they aren't surfaced.

## Questions to Consider

- If a guild is a *team with a constitution*, shouldn't it be a **page with tabs**, not an overlay?
- What's the single thing a member opens a guild to do this week — and is it reachable in one tap?
- Should "open proposals" be a cross-guild surface (a governance inbox), not buried per-guild?
