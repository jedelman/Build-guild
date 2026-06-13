# Dev / test / deploy on the NixOS box

The working model: the **repo is the interface**. Claude drives dev + test on the NixOS box
through committed instructions; we **push-to-deploy only at the end of a sprint**. This file +
`flake.nix` + the `/smoke-test` skill are all the box needs.

## Why a flake
`wrangler` ships `workerd` as a prebuilt binary, and the browser smoke needs Chromium — both
assume a standard FHS filesystem NixOS doesn't have. `flake.nix` provides an **FHS dev shell**
(Node 22, Chromium, libs) so they run unmodified, and wires `CHROMIUM_PATH` for the browser
tier. Enter it once and everything below "just works" like a vanilla Linux box.

## Enter the environment
```bash
cd <repo>
nix develop            # FHS shell: node 22, chromium, wrangler-via-npm ready
npm ci                 # first time / after dependency changes
```
(Flakes must be enabled: `experimental-features = nix-command flakes` in nix.conf. With direnv
+ nix-direnv installed, `direnv allow` auto-enters the shell on `cd`. Commit `flake.lock` after
the first `nix develop` so the toolchain is pinned for everyone.)

## The loop (what Claude runs on the box)
| Goal | Command |
|------|---------|
| Unit + scenario suite | `npm test` (133 tests; pure, fast) |
| Full smoke (API gate + browser) | invoke **`/smoke-test`** — see `.claude/skills/smoke-test/SKILL.md` |
| API smoke only | `npm run smoke:api` (needs a running worker; the skill boots one) |
| **Live demo over VPN** | `npm run dev:demo` → reachable at `http://<box-VPN-IP>:8787` (personas enabled) |
| Deploy (end of sprint only) | `npm run deploy` (needs `CLOUDFLARE_API_TOKEN`) |

### Live demos
`npm run dev:demo` binds `0.0.0.0` with `TEST_FIXTURES=1`, so over the VPN you can open
`http://<box-VPN-IP>:8787`, use the test-persona switcher, and click through the real build.
Run it in the background; share the URL. (It's the dev server — fine for demos, not public.)

### Deploy discipline
No mid-sprint pushes to Cloudflare. At sprint end: `npm test` green → `/smoke-test` green →
`npm run deploy`. Secrets (`CLOUDFLARE_API_TOKEN`, etc.) live in the box's environment, never
in the repo.

## Kickoff prompts (paste into the box's session)
**Smoke a branch:**
> Enter the dev shell (`nix develop`), `npm ci`, check out `<branch>`, run `npm test`, then run
> the `/smoke-test` skill. Report each tier's result and send the screenshots from
> `artifacts/smoke/`. Don't push or deploy.

**Stand up a demo:**
> Enter the dev shell, `npm run dev:demo` in the background, wait until it's ready, seed personas
> (`curl -s -XPOST http://127.0.0.1:8787/api/test/seed`), and give me the
> `http://<box-VPN-IP>:8787` URL plus which personas to try.

**Ship the sprint:**
> `npm test` and `/smoke-test` must both be green. Then `npm run deploy` and report the
> deployed URL. If either gate fails, stop and show me the failure.
