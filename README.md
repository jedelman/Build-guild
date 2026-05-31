# ⚔️ Build Guild

> Don't job-hunt alone. Team up and combine your skill-peaks.

Build Guild turns the mutual-aid idea from
[@codewright's Bluesky thread](https://bsky.app/profile/codewright.bsky.social/post/3mmyav5klfc2l)
into a working app. The pitch, in the author's words:

- Lots of builders are in the same boat — need income, work passionately on their
  own projects, and have learned to leverage AI to augment what they're already good at.
- The best results come from **human skill-peaks + AI augmentation**.
- So team up. Find a **suitably diverse** group, explore each other's projects, and
  cover each other's gaps. *"100% like an MMORPG guild."*

Build Guild makes that literal: builders publish a character sheet (class + **skill
peaks** + projects), form **guilds**, and the app surfaces each guild's combined
skill-map, a **Guild Power** score that rewards complementary peaks over redundancy,
and **recruit suggestions** that fill the party's current gaps.

## Stack

- **Cloudflare Workers** — API + static asset serving (`src/index.js`)
- **Cloudflare D1** (SQLite at the edge) — schema in `migrations/`
- Vanilla JS / CSS front-end in `public/` (no build step)
- Pure, dependency-free guild math in `src/logic.js` (unit-tested)

## Quick start

```bash
npm install
npm run db:reset      # apply migrations/ to local D1 + seed sample roster (seed.sql)
npm run dev           # wrangler dev → http://localhost:8787
```

`db:reset` runs against the **local** D1 instance used by `wrangler dev`
(`db:migrate` applies `migrations/`, then `db:seed` loads `seed.sql`).

## Tests

```bash
npm test              # node --test — exercises the guild scoring & matchmaking logic
```

## Bluesky / atproto

Build Guild is handle-first: a builder's identity *is* their Bluesky handle.

- **Import & verify** — on the Enlist form, "🦋 Import from Bluesky" resolves the
  handle against the public AppView (`app.bsky.actor.getProfile`), prefills display
  name / avatar / bio, and suggests starter skills from the bio.
- **Server-side verification** — `POST /api/builders` re-resolves the handle on the
  server and stores the authoritative **DID** + avatar, so a verified badge can't be
  spoofed by the client. If Bluesky is unreachable the builder is still created, just
  unverified (empty `did`).

See `src/atproto.js`. No auth or API key is needed for this — it's all public reads.

### Auth (Bluesky OAuth)
Identity is gated behind **Bluesky OAuth** — you log in with your handle (no password
shared) and can only create/edit/delete *your own* builder, so no one can impersonate
anyone. Implemented in `src/oauth.js` (hand-rolled for Workers: PKCE + DPoP + PAR, public
client) and `src/index.js` (`/api/auth/login`, `/api/auth/callback`, `/api/auth/me`,
`/api/auth/logout`). The OAuth client id is `/client-metadata.json`, served dynamically so
it resolves on prod *and* every per-PR preview origin. We mint our own session cookie once
the handshake proves DID ownership; no atproto tokens are persisted yet, and **no new
secrets are required** (public client).

Next step:
- **PDS storage** — store each builder's skill-peaks/projects as records in *their own*
  atproto repo under a custom lexicon (`build.guild.*`), making profiles user-owned and
  portable, with D1 as a cache/index. (This is when atproto token storage gets added.)

## Data & privacy

**No PII in D1.** The database holds only public, builder-authored content — Bluesky
handle/DID, display name, avatar, skill-peaks, projects, guilds. By design it must never
store personally identifiable or sensitive data:

- **Payments / billing** live in **Stripe** — Stripe is the system of record for customer
  identity, payment methods, and anything billing-related. We reference a Stripe customer
  id at most, never card or contact PII.
- **Identity / account actions** are gated behind **Bluesky OAuth** (see the auth
  roadmap) — we authenticate against the user's handle rather than storing credentials.

This is what keeps the per-PR preview model safe: because D1 carries no PII, cloning the
**full** production database into throwaway preview environments leaks nothing sensitive.
If a future change would introduce PII into D1, stop — put it in Stripe or the user's PDS
instead, and switch the preview clone step to schema-only (`--no-data`).

## Deploying

### Via GitHub Actions (recommended)
`.github/workflows/deploy.yml` runs tests, applies D1 migrations, and deploys on every
push to `main`. Set two repository secrets (**Settings → Secrets and variables → Actions**):

| Secret | Value |
| ------ | ----- |
| `CLOUDFLARE_API_TOKEN` | token with *Workers Scripts:Edit* + *D1:Edit* |
| `CLOUDFLARE_ACCOUNT_ID` | your Cloudflare account id |

One-time bootstrap before the first deploy (creates the DB and gives you the id):
```bash
wrangler d1 create build_guild      # paste the id into wrangler.jsonc → d1_databases[0].database_id
```
Then merging to `main` deploys automatically. Migrations live in `migrations/` and are
applied with `wrangler d1 migrations apply` (non-destructive, unlike `schema.sql`).

### Preview deployments (per-PR, ephemeral)
`.github/workflows/preview.yml` gives every pull request its **own isolated** live
preview — a throwaway Worker and D1 database, torn down when the PR closes:

- Runs the test suite (forks included).
- Provisions a per-PR database `build_guild_pr_<N>`. On first creation it's a **full
  copy of production** (`wrangler d1 export build_guild` → import), then branch
  migrations are applied on top, so the preview runs the PR's code against
  production-shaped data.
- Renders a per-PR wrangler config from `.github/preview/wrangler.template.jsonc` and
  deploys a `build-guild-pr-<N>` Worker bound to that database.
- Comments the unique preview URL on the PR, redeployed on every push.

`.github/workflows/preview-cleanup.yml` runs on PR close and deletes both the Worker and
the database via the Cloudflare API, so nothing is left orphaned.

Because each PR has its own copy, previews are fully isolated from each other and from
production. Note the copy includes **real production data** — fine for this app, but if
the database ever holds sensitive data, switch the clone step to schema-only
(`wrangler d1 export --no-data`) plus a re-seed.

### Manually
```bash
wrangler d1 create build_guild                                   # then paste id into wrangler.jsonc
wrangler d1 migrations apply build_guild --remote
wrangler d1 execute build_guild --remote --file=./seed.sql       # optional sample data
npm run deploy
```

## API

| Method | Path | Description |
| ------ | ---- | ----------- |
| `GET`  | `/api/health` | liveness check |
| `GET`  | `/api/atproto/profile?handle=` | resolve a Bluesky handle → `{did, handle, display_name, avatar, bio, suggested_skills}` |
| `GET`  | `/api/builders` | roster, each with sorted skill peaks |
| `POST` | `/api/builders` | create a builder (`{display_name, handle, klass, skills:[{name,peak}], projects:[…]}`) |
| `GET`  | `/api/builders/:id` | full character sheet (skills, projects, guilds) |
| `GET`  | `/api/guilds` | guilds with member counts |
| `POST` | `/api/guilds` | found a guild (`{name, charter, founder_id}`) |
| `GET`  | `/api/guilds/:id` | guild detail: members, combined skill-map, champions, Guild Power |
| `GET`  | `/api/guilds/:id/recruits` | ranked recruits that fill the party's gaps |
| `POST` | `/api/guilds/:id/join` | add a member (`{builder_id}`) |
| `POST` | `/api/guilds/:id/leave` | remove a member (`{builder_id}`) |

## How the guild math works

See `src/logic.js`:

- **`guildSkillMap`** — collapses every member's skills into the party's best-in-class
  map (highest peak per skill + who champions it).
- **`diversityScore`** ("Guild Power") — rewards strongly-covered distinct skills and
  breadth, with a party-size bonus, and subtracts for overlap (everyone piling onto the
  same peak).
- **`recommendRecruits`** — scores candidates by the strong skills they'd add that the
  guild currently lacks.
