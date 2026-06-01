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
gold/teal families. `--faint` is `#8f88a0` (lightened from `#7c7689`) so muted text
clears WCAG AA on card/drawer surfaces — verify any new text/surface pair ≥ 4.5:1.

## Type

Three families, by role (the "Instrument" system):
- **Inter** — all UI: body, labels, buttons, badges.
- **Cinzel** (serif) — display only: wordmark, section titles, drawer/guild headings.
- **JetBrains Mono** (`--mono`) — every number that carries weight: peaks, Guild
  Power, quest bounties/rewards, the earnings pulse, `@handles`. Mono numerics are
  the core of the data-instrument voice; apply via `.mono` or `--mono`.

Tokens (no ad-hoc sizes):
- Scale: `--fs-xs .72` / `--fs-sm .8` / `--fs-base .86` / `--fs-md .95` / `--fs-lg 1.15`
  / `--fs-xl 1.3` / `--fs-2xl 1.4` (rem); root `--fs-root: 15px`.
- Letter-spacing: `--ls-tight/normal/wide/caps/caps-wide`.
- Headings use `text-wrap: balance`; `.hero h2` keeps a `clamp()` for fluid display.
- Control padding tokens: `--ctl-pad-{y,x}` (+ `-sm`, `-xs`), `--field-pad-{y,x}`.

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
- **Skill bars** — gold fill on inset trough; a crafted ESCO link icon when linked.
- **Quest board** (`.quest`, `.reward`, `.qstatus`, `.qmatch`) — the team job board.
  Reward leads in mono gold; `.qstatus` pills: teal open, gold claimed, good delivered;
  `.feat` gold-tint for high-value open quests; `.qmatch` shows consensus-peak party fit.
- **Earnings pulse** (`.pulse` / `.stat`) — job-board vitals in mono numerics.
- **Ranked ledger** (`.ledger` / `.lrow`) — the roster as a leaderboard (not a card
  grid), ranked by top peer-endorsed peak.
- **Navigation** (`.shell` / `.rail` / `.bottomnav` / `.navitem`) — a Material-style
  shell: a collapsible left rail on desktop (icon+label, toggle persisted in
  `localStorage`), a fixed bottom bar on mobile (`≤760px`), both rendered from one
  destination list. The 4th destination swaps **Enlist → Character** once you have a
  sheet. Top bar holds brand (left) + status cluster (right).
- **Status menu** (`.usermenu` / `.usermenu-btn` / `.menu-pop`) — GitHub-style: avatar
  button → dropdown (your sheet, log out). Logged-out shows the inline login widget.
- **Icons** — crafted inline SVG via `icon(name)` + the `.icon` class (`currentColor`,
  ~1.6 stroke, matches the `.sigil`). Set: crest, quest, reward, link, check, bluesky,
  roster, sheet, caret, logout. No emoji as iconography.
- **Utilities** — `.mono`, `.caption`, `.hint`, `.tight`, `.row.between/.gap-sm/.my-2/.my-3`,
  `.field-pair`, `.center-pad`. Use these instead of inline `style=`.
- **Drawer** — right-side dialog: `role="dialog"`/`aria-modal`, Esc to close,
  focus trap + restore, slide-in. Drawer-to-drawer cross-links via `entityLink()`
  (`[data-go="builder|guild"]`, wired centrally in `openDrawer`).
- **Modals** (`.modal` / `.modal-panel`) — `formDialog()` and `confirmDialog()` replace
  native `prompt`/`confirm`/`alert`: focus-trapped, Esc/backdrop to cancel, returns a
  Promise. Destructive actions use `.btn.danger`.
- **Toasts** — `role=status`/`alert`, animated in/out, auto-dismiss.
- **Skeletons** — `.skeleton-card` + `.sk-line` shimmer for first paint.

## Accessibility

- Focus is always visible (`:focus-visible` ring via `--ring`).
- Drawers and modals trap Tab and restore focus to the opener on close; a modal
  over a drawer stops key propagation so only the top layer responds to Esc/Tab.
- All animation is disabled under `prefers-reduced-motion`.
- Avatars fall back to initials on image error.

## Brand assets

- `public/favicon.svg` — the gold heraldic sigil (diamond) on ink.
- `public/icon-180.png` — apple-touch icon (rendered from the SVG).
- `public/manifest.webmanifest` — installable PWA metadata, themed `#0b0a0f`.
- `public/og.svg` — Open Graph / Twitter social card.

## Responsive

- Grid auto-fills `minmax(290px, 1fr)`; eases to 240px ≤820px and a single
  column ≤520px. At ≤760px the left rail gives way to a fixed bottom nav, the
  brand sub-tagline and the status handle hide, and `main` reserves bottom padding
  (with `safe-area-inset`) so content clears the bar.
