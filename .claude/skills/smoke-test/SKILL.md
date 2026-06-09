---
name: smoke-test
description: Run automated smoke tests for Build-guild on this machine — boots a local wrangler dev with seeded test personas and drives the real Worker (and optionally the SPA in headless Chromium) through the guild membership / consent / quest flows. Use when asked to smoke-test, smoke, run the smoke suite, verify a build end-to-end, or check that join/recruit/charter still work after a change.
---

# Build-guild smoke test

Two tiers, both against a **local hermetic `wrangler dev`**:

1. **API harness** (`scripts/smoke-api.mjs`) — the gate. Signs governance claims exactly like
   the browser (`src/governance.js` device key) and drives the real Worker:
   `putClaim → verify → reprojectGuildMembers → getGuild`. Covers self-join, the consent gate
   (invite ≠ membership until co-signed), and leave. No browser.
2. **Browser smoke** (`scripts/smoke-browser.mjs`) — best-effort. Loads the SPA in headless
   Chromium, acts as a persona via the switcher, walks the guild tabs, screenshots each view.

## One-time setup
- **On the NixOS box: run everything inside `nix develop`** — the flake provides Node 22 +
  Chromium and exports `CHROMIUM_PATH` + `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD` for you (see
  `notes/dev-environment.md`). Then `npm ci`.
- Browser tier needs Playwright: `npm i -D playwright` (it uses the flake's Chromium via
  `CHROMIUM_PATH`, not a downloaded build). If Playwright/Chromium is missing the browser tier
  SKIPS (exit 2) and the API gate still runs.
- Off NixOS: Node ≥ 18 + `npx wrangler`; set `CHROMIUM_PATH` yourself for the browser tier.

## Run procedure
Run from the repo root. Do these in order; **do not** use `sleep` to wait — poll.

1. **Reset to a clean local DB** (hermetic — no cross-run claim/key drift):
   ```bash
   rm -rf .wrangler/state
   npm run build
   npx wrangler d1 migrations apply build_guild --local
   ```
2. **Start the Worker in the background** with the test harness enabled:
   ```bash
   npx wrangler dev --port 8787 --var TEST_FIXTURES:1
   ```
   Launch this with the Bash tool's `run_in_background: true` (it must keep running across the
   next steps). Capture its shell id so you can kill it in teardown.
3. **Wait until it's ready**, then seed personas (poll, don't sleep):
   ```bash
   until curl -sf http://127.0.0.1:8787/api/test/status >/dev/null; do :; done
   curl -s -XPOST http://127.0.0.1:8787/api/test/seed
   ```
   The seed response should list personas (Quill, Ada, Bjorn) with `"seeded": true`.
4. **Run the API gate:**
   ```bash
   BASE_URL=http://127.0.0.1:8787 npm run smoke:api
   ```
   Exit 0 = pass. Exit 1 = a real regression — capture the `✗` lines.
5. **Run the browser tier** (best-effort):
   ```bash
   BASE_URL=http://127.0.0.1:8787 CHROMIUM_PATH="${CHROMIUM_PATH:-}" npm run smoke:browser
   ```
   Exit 0 = pass · 1 = fail · 2 = skipped. Screenshots land in `artifacts/smoke/`.
6. **Teardown:** kill the background `wrangler dev` shell. Optionally `rm -rf .wrangler/state`.

## Reporting back
- State the result of **each tier** (pass / fail / skipped) and the pass/fail counts.
- If the API gate failed, quote the failing `✗` assertion(s) and the offending HTTP response —
  that's the regression.
- If the browser tier ran, **send the screenshots** in `artifacts/smoke/` with `SendUserFile`
  (01-home, 02-persona, 03-guild-overview, 04-guild-party, 04-guild-governance) so the human
  can eyeball the DOM. Note any `page error:` lines printed during the run.
- Do **not** push or open PRs from this skill unless explicitly asked — it's a verification run.

## Extending
The API harness mirrors `web/claimstead.js`; to add a scenario, add `actAs`/`claim` beats and
assert `rosterDids(gid)`. The narrative scenarios in `test/scenarios.test.js` +
`notes/scenarios.md` are the script to translate into live smoke beats (charter builder,
admit-by-vote, the quest→pay loop).
