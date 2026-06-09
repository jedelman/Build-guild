// Browser smoke — loads the REAL SPA in headless Chromium, drives it as a test persona via
// the switcher, walks the guild tabs, and screenshots each view for human review. This is
// tier 2 (the API harness is the gate); it covers the DOM/routing the API can't.
//
//   BASE_URL=http://127.0.0.1:8787 node scripts/smoke-browser.mjs
//
// Exit 0 = pass · 1 = fail · 2 = SKIPPED (Playwright/Chromium unavailable — not a failure).
// NixOS: Playwright's bundled Chromium won't run; set CHROMIUM_PATH=$(which chromium) (or
// nix-shell -p ungoogled-chromium) so we launch the nix-provided binary.
import { mkdirSync } from "node:fs";

const BASE = (process.env.BASE_URL || "http://127.0.0.1:8787").replace(/\/$/, "");
const OUT = "artifacts/smoke";
const skip = (msg) => { console.log(`\n⏭ browser smoke SKIPPED: ${msg}\n`); process.exit(2); };

let chromium;
try { ({ chromium } = await import("playwright")); }
catch { skip("playwright not installed (npm i -D playwright)"); }

mkdirSync(OUT, { recursive: true });
let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; console.log(`  ✓ ${msg}`); } else { fail++; console.error(`  ✗ ${msg}`); } };

const launchOpts = { headless: true };
if (process.env.CHROMIUM_PATH) launchOpts.executablePath = process.env.CHROMIUM_PATH;

let browser;
try { browser = await chromium.launch(launchOpts); }
catch (e) { skip(`couldn't launch Chromium (${e.message}). Set CHROMIUM_PATH to a nix chromium.`); }

const shot = async (page, name) => { const p = `${OUT}/${name}.png`; await page.screenshot({ path: p, fullPage: true }); console.log(`    📸 ${p}`); };

try {
  console.log(`\n▶ browser smoke against ${BASE}\n`);
  const page = await (await browser.newContext({ viewport: { width: 1100, height: 1600 } })).newPage();
  page.on("pageerror", (e) => console.error("    page error:", e.message));

  // 1) app boots
  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.waitForSelector("main", { timeout: 15000 });
  ok(true, "app loaded");
  await shot(page, "01-home");

  // 2) act as Ada via the test-persona switcher (only present when TEST_FIXTURES is on)
  const sw = page.locator(".ts-select");
  if (await sw.count()) {
    await sw.selectOption({ label: /Ada/i }).catch(() => sw.selectOption({ index: 1 }));
    await page.waitForLoadState("networkidle");
    const handle = await page.locator(".handle").first().textContent().catch(() => "");
    ok(/ada/i.test(handle || ""), `acting as a persona (${(handle || "").trim()})`);
  } else {
    ok(false, "test-persona switcher not found — is TEST_FIXTURES=1?");
  }
  await shot(page, "02-persona");

  // 3) Guild Hall → open the first guild → walk the tabs
  await page.goto(`${BASE}/#/guilds`, { waitUntil: "networkidle" });
  await page.waitForTimeout(400);
  const firstGuild = page.locator('[data-go^="#/guild/"], a[href^="#/guild/"]').first();
  if (await firstGuild.count()) {
    await firstGuild.click();
    await page.waitForSelector(".tabs .tab", { timeout: 8000 });
    ok(true, "guild page rendered with tabs");
    await shot(page, "03-guild-overview");

    for (const tab of ["party", "governance"]) {
      const t = page.locator(`.tabs .tab[href*="/${tab}"]`);
      if (await t.count()) { await t.click(); await page.waitForTimeout(500); await shot(page, `04-guild-${tab}`); ok(true, `${tab} tab renders`); }
    }
  } else {
    ok(false, "no guild found in the Guild Hall (seed personas first)");
  }

  console.log(`\n${fail ? "✗" : "✓"} browser smoke: ${pass} passed, ${fail} failed · screenshots in ${OUT}/\n`);
  await browser.close();
  process.exit(fail ? 1 : 0);
} catch (e) {
  console.error(`\n✗ browser smoke errored: ${e?.stack || e}`);
  await browser?.close();
  process.exit(1);
}
