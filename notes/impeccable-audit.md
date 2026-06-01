# Impeccable Audit — Build Guild

Run via `/impeccable audit` (skill v3.5.0). Register: **product** (design serves the
task; the bar is earned familiarity à la Linear/Stripe, not theatrics). Technical,
code-level audit — documents issues for `polish`/`bolder`/`typeset` to fix; no fixes here.

## Audit Health Score

| # | Dimension | Score | Key finding |
|---|-----------|-------|-------------|
| 1 | Accessibility | 3/4 | `--faint` body text fails AA on card/drawer surfaces (4.21 / 3.95 < 4.5); clickable card semantics fixed earlier but verify focus |
| 2 | Performance | 3/4 | 926 KB bundle (atproto SDK); skeletons present; no lazy-load on the SDK |
| 3 | Responsive | 3/4 | Breakpoints exist (820/520); touch targets on small chips/buttons under 44px |
| 4 | Theming | 2/4 | Strong color tokens, but ~30 inline styles + 8 ad-hoc font-sizes + 5 control paddings bypass the system; 10 drawer `<h3>` use wrong `--gold` |
| 5 | Anti-Patterns | 2/4 | **Identical card grids** (roster/guild/quest) — an absolute ban; emoji-as-icons; otherwise clean (no gradient text, no glassmorphism, no AI-violet) |
| **Total** | | **13/20** | **Acceptable — significant work needed** |

## Anti-Patterns Verdict — would a category-fluent user trust this?

Mostly yes; it does not scream "AI made this" (the gold/teal hairline system is distinctive,
no purple gradients, no glassmorphism, no hero-metric template). But it trips real tells:

- **P1 — Identical card grids.** Roster, Guild Hall, and Quest Board are the *same* card
  (avatar/crest + name + sub + badges) repeated in the same `auto-fill minmax(290px)` grid.
  Impeccable: "Cards are the lazy answer." Three views reading identically is the tell.
- **P2 — Emoji as iconography.** 🛡️ 📜 🎁 🔗 ✓ render inconsistently cross-platform and clash
  with the crafted `.sigil`/favicon line-art. (User already approved a crafted SVG set.)
- **P2 — Muted-gray under-contrast** (`--faint` on surfaces) — the single most common AI tell
  per the skill, and it's measurably present.

## Detailed findings by severity

**P1 (fix before release)**
- `--faint` (#7c7689) on `--surface`/`--surface-2` = 4.21 / 3.95:1, fails WCAG AA body.
  Used by `.caption`, `.hint`, `.klass`, `.peak-num`, `.tagline`-adjacent muted text inside
  cards and the drawer. Fix: nudge `--faint` lighter (target ≥4.5 on surface-2) or introduce
  a surface-specific muted token.
- Identical card grids across 3 views: differentiate by register (roster = people, quests =
  work, guilds = parties) so each view has its own rhythm, not one card cloned.

**P2 (next pass)**
- ~30 inline `style="…"` in `web/app.js`; 10 drawer `<h3 style="color:var(--gold)…">` use the
  wrong gold (system rule uses `--gold-soft`) and duplicate the existing `.drawer-panel h3`.
- 8+ ad-hoc font-sizes (0.7–0.98rem) with no scale; 5 control paddings; stray non-tokenized
  shadows/heights/colors (`--bar-h`, `--meter-h`, `#1a1304`).
- Emoji iconography → crafted inline-SVG set (approved).
- Touch targets: tier-chips, endorse-btn, esco-opt below 44px min on touch.

**P3 (polish)**
- Letter-spacing scattered; 3 heading sizes that could consolidate to 2 tiers.
- Motion: transitions exist but no state-conveying micro-interactions on endorse/claim/join.
- Missing component states: `:hover` on badges/tier-chips, form `:invalid`.

## Recommended next steps (skill commands)
1. `init` / `document` → capture PRODUCT.md + DESIGN.md (context layer is missing).
2. `typeset` → the type scale + heading hierarchy + tokenize control sizing.
3. `bolder` (product-register) → stronger hierarchy + differentiate the 3 grids + one sharper
   accent; NOT theatrics.
4. `polish` → contrast fix, inline-style sweep, crafted SVG icons, all component states, a11y.
