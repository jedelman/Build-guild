# Design System: Build Guild

## 1. Overview

A nocturnal guild hall rendered as a precise data instrument. Dark, warm-leaning
ink surfaces; **gold** is the signature (rank, value, money), **arcane teal** the
interactive accent. Depth comes from hairlines and directional highlights, not
gradients-on-everything. Register: **product** (a team job board) — earned
familiarity executed with crafted character. Source of truth: `public/styles.css`
(`:root` tokens); this file is the portable spec.

## 2. Colors

### Surfaces (dark, layered, warm-leaning)
- `--bg #0b0a0f` page · `--bg-2 #100e16` drawer · `--surface #15131d` cards ·
  `--surface-2 #1c1926` inputs · `--inset #0e0c13` meter troughs.

### Ink
- `--ink #f4f1ea` primary · `--ink-dim #bbb4c6` secondary · `--faint #8f88a0`
  labels/muted (AA-safe on surfaces: ≥5:1).

### Signature + accent
- Gold: `--gold #d8b15a` · `--gold-soft #ecd49a` · `--gold-deep #6f5727` ·
  `--gold-ink #1a1304` (text on gold fills).
- Teal: `--accent #67bcb3` · `--accent-deep #2c5651`. Semantic: `--good #6cbf95`,
  `--danger #d77c72`. Lines: `--line #251f30` · `--line-strong #342d42`.

### Named Rules
- Gold = rank, value, money, primary CTA, standing. Teal = interactive, open/active
  state, links, focus ring. No generic violet, ever.
- Verify any new text/surface pair ≥ 4.5:1 (large ≥ 3:1). `--faint` is the floor.
- Status: teal = open, gold = claimed, good = delivered.

## 3. Typography

Three families by role: **Inter** (all UI), **Cinzel** serif (display: wordmark,
section + drawer headings), **JetBrains Mono** `--mono` (every meaningful number:
peaks, Guild Power, bounties, the earnings pulse, @handles).

### Hierarchy
- Scale tokens `--fs-xs .72` → `--fs-2xl 1.4` rem; root `--fs-root 15px`.
- Letter-spacing tokens `--ls-tight/normal/wide/caps/caps-wide`.

### Named Rules
- Numbers that carry weight are mono, tabular. `text-wrap: balance` on headings;
  `.hero h2` keeps a `clamp()` for fluid display. No display fonts in UI labels.

## 4. Elevation
- `--shadow` (resting) / `--shadow-lift` (hover): top hairline highlight + soft
  directional shadow, never a flat drop shadow. `--shadow-drawer` directional;
  `--shadow-glow-gold` for the sigil. Cards add a 1px top-edge highlight, no fill.

## 5. Components
- **App shell**: collapsible left **rail** (`.rail`/`.navitem`, desktop) + fixed
  **bottom nav** (`.bottomnav`, ≤760px), both from one destination list; Enlist→
  Character swaps when enlisted. Top bar = brand (left) + **status menu**
  (`.usermenu`/`.menu-pop`, GitHub-style avatar dropdown) right.
- **Modals** (`.modal`/`.modal-panel`): `formDialog`/`confirmDialog` replace native
  prompt/confirm; focus-trapped, Esc/backdrop cancel. `.btn.danger` for destructive.
- **Cross-links** (`.entity-link`): builder↔guild↔quest navigation inside drawers.
- **Quest row** (`.quest`/`.reward`/`.qstatus`/`.qmatch`): reward leads in mono
  gold; status pill; `.feat` gold-tint for high-value open quests; consensus-peak
  party match. The job board's hero component.
- **Earnings pulse** (`.pulse`/`.stat`): job-board vitals in mono numerics.
- **Ranked ledger** (`.ledger`/`.lrow`): roster as a leaderboard — rank in mono
  gold, avatar, name + class, skill chips. NOT a card grid.
- **Cards** (`.card`): guild grid only; hairline border, top-edge highlight,
  hover lift. **Buttons** `.btn`/`.gold`/`.ghost` (labels never wrap).
- **Badges** `.badge` + `.ai`/`.ok`/`.role`; **tier chips** (client/leader = gold,
  guildmate = teal). **Skill bars** gold fill on inset trough. **Drawer** = dialog
  (Esc, focus trap, slide-in). **Toast** role=status/alert, animated.
- **Icons**: crafted inline SVG via `icon(name)` + `.icon` (currentColor, ~1.6
  stroke, matches `.sigil`). Set: crest, quest, reward, link, check, bluesky,
  roster, sheet, caret, logout.

## 6. Do's and Don'ts

### Do:
- Lead with quests + earnings; money/peaks in mono.
- Differentiate each view's layout (ledger vs. quest list vs. guild cards).
- Keep every interactive element keyboard-operable with a visible focus ring.

### Don't:
- Identical card grids across views; emoji as icons; gradient text; glassmorphism.
- Muted gray that fails contrast; display fonts in controls; new hues outside
  gold/teal.
