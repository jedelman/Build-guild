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

### Auth roadmap
This is the read-only foundation. Next steps, in order of lift:
1. **Bluesky OAuth** (recommended) — log in with your handle, no password shared.
   Needs hosted client metadata + DPoP/PAR; works on Workers.
2. **PDS storage** — store each builder's skill-peaks/projects as records in *their own*
   atproto repo under a custom lexicon (`build.guild.*`), making profiles user-owned and
   portable, with D1 as a cache/index.

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

### Preview deployments (per-PR)
`.github/workflows/preview.yml` gives every pull request its own live preview without
touching production:

- Runs the test suite (forks included).
- Applies pending migrations to a **shared staging** database (`build_guild_preview`),
  then deploys a separate `build-guild-preview` Worker via
  `wrangler deploy --env preview`.
- Comments the preview URL on the PR, refreshed on every push.

The `preview` environment is defined in `wrangler.jsonc` under `env.preview` and binds
`DB` to the staging database, so previews exercise real schema changes against
throwaway data. Production D1 (`build_guild`) is only ever written by the `main` deploy.
Because staging is shared across open PRs, concurrent PRs can see each other's writes —
fine for review, not isolated test fixtures.

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
