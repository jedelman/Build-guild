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
- **Cloudflare D1** (SQLite at the edge) — `schema.sql`
- Vanilla JS / CSS front-end in `public/` (no build step)
- Pure, dependency-free guild math in `src/logic.js` (unit-tested)

## Quick start

```bash
npm install
npm run db:reset      # create local D1 tables (schema.sql) + seed sample roster (seed.sql)
npm run dev           # wrangler dev → http://localhost:8787
```

`db:reset` runs against the **local** D1 instance used by `wrangler dev`.

## Tests

```bash
npm test              # node --test — exercises the guild scoring & matchmaking logic
```

## Deploying

1. Create the database and copy its id into `wrangler.jsonc` (`d1_databases[0].database_id`):
   ```bash
   wrangler d1 create build_guild
   ```
2. Apply the schema to the remote database:
   ```bash
   wrangler d1 execute build_guild --remote --file=./schema.sql
   # optional sample data:
   wrangler d1 execute build_guild --remote --file=./seed.sql
   ```
3. Ship it:
   ```bash
   npm run deploy
   ```

## API

| Method | Path | Description |
| ------ | ---- | ----------- |
| `GET`  | `/api/health` | liveness check |
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
