# Build Guild — design system

A nocturnal guild hall, rendered with restraint. The aesthetic deliberately
avoids "AI-slop" defaults (generic violet, gradients-on-everything, heavy uniform
shadows): **gold is the signature** (rank / value), **teal is the arcane accent**
(interactive), and depth comes from hairlines + directional highlights, not fills.

All tokens live as CSS custom properties in `public/styles.css` (`:root`).

## Color

| Token | Value | Use |
| ----- | ----- | --- |
| `--bg` / `--bg-2` | `#0b0a0f` / `#100e16` | page / drawer base |
| `--surface` / `--surface-2` | `#15131d` / `#1c1926` | cards / inputs |
| `--inset` | `#0e0c13` | bar troughs |
| `--ink` / `--ink-dim` / `--faint` | `#f4f1ea` / `#bbb4c6` / `#7c7689` | text scale (high → label) |
| `--gold` / `--gold-soft` / `--gold-deep` | `#d8b15a` / `#ecd49a` / `#6f5727` | signature: rank, value, headings, primary CTA |
| `--accent` / `--accent-deep` | `#67bcb3` / `#2c5651` | arcane accent: links, focus, interactive |
| `--good` / `--danger` | `#6cbf95` / `#d77c72` | success / error |
| `--line` / `--line-strong` | `#251f30` / `#342d42` | hairlines, borders |

No generic violet anywhere. Avoid introducing new hues — extend via the existing
gold/teal families.

## Type

- **Inter** for everything except display; **Cinzel** (serif) reserved for the
  wordmark, section titles, and drawer/guild headings.
- Base 15px / 1.55. Headings use `text-wrap: balance`.
- Stats use `font-variant-numeric: tabular-nums` (`.peak-num`, meters, `.bar-row`).

## Spacing & shape

- 4px scale: `--s1`..`--s7` (0.25rem → 3rem). Prefer these over ad-hoc values.
- Radii: `--r-sm` 8 / `--r` 12 / `--r-lg` 16 / `--r-pill` 999.
- `--maxw` 1080px content width.
- Motion easing: `--ease` `cubic-bezier(0.2,0.6,0.2,1)`.

## Components

- **Cards** — `var(--surface)`, hairline border, faint top-edge highlight (no
  gradient fill); `.card.click` lifts on hover.
- **Buttons** — `.btn` (neutral), `.btn.gold` (primary CTA), `.btn.ghost`
  (transparent). Never wrap labels (`white-space: nowrap`).
- **Badges** — `.badge` + `.ai` (good/teal), `.role` (gold), `.ok` (success).
- **Tier chips** — endorsement relationship tiers; stronger ties read with more
  colour (`.tier-client` / `.tier-leader` gold, `.tier-guildmate` teal).
- **Skill bars** — gold fill on inset trough; an ESCO 🔗 tag when linked.
- **Drawer** — right-side dialog: `role="dialog"`/`aria-modal`, Esc to close,
  focus trap + restore, slide-in.
- **Toasts** — `role=status`/`alert`, animated in/out, auto-dismiss.
- **Skeletons** — `.skeleton-card` + `.sk-line` shimmer for first paint.

## Accessibility

- Focus is always visible (`:focus-visible` ring via `--ring`).
- Tabs follow the WAI-ARIA tabs pattern (roving tabindex, Left/Right arrows).
- All animation is disabled under `prefers-reduced-motion`.
- Avatars fall back to initials on image error.

## Brand assets

- `public/favicon.svg` — the gold heraldic sigil (diamond) on ink.
- `public/icon-180.png` — apple-touch icon (rendered from the SVG).
- `public/manifest.webmanifest` — installable PWA metadata, themed `#0b0a0f`.
- `public/og.svg` — Open Graph / Twitter social card.

## Responsive

- Grid auto-fills `minmax(290px, 1fr)`; eases to 240px ≤820px and a single
  column ≤520px. Topbar + tabs wrap.
