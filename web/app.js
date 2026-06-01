// Build Guild — front-end. Vanilla JS, talks to the Worker's /api.

import { initTelemetry, reportBug, flush } from "./telemetry.js";
import { BrowserOAuthClient } from "@atproto/oauth-client-browser";
import { Agent } from "@atproto/api";
import { reconcileSkillKeys } from "../src/skills.js";
// Telemetry must never be able to break the app.
try {
  initTelemetry();
} catch (e) {
  console.warn("telemetry init failed", e);
}

const app = document.getElementById("app");
const drawer = document.getElementById("drawer");
const drawerBody = document.getElementById("drawer-body");
const authbar = document.getElementById("authbar");

// Identity comes from the logged-in Bluesky session (/api/auth/me), not a
// free picker — you can only act as your own verified builder.
const state = { builders: [], guilds: [], auth: { authenticated: false }, me: null };

// atproto OAuth lives on-device (tokens in IndexedDB). We keep the client and
// the active/restored session here.
let oauthClient = null;
let atprotoSession = null;

// ---- crafted inline-SVG icon set ------------------------------------------
// Line-art matching the heraldic .sigil / favicon (currentColor, ~1.6 stroke).
// Replaces emoji-as-iconography; restyled centrally via the .icon class.
const ICON = {
  crest: '<path d="M12 3 5 6v5c0 4 3 6.5 7 9 4-2.5 7-5 7-9V6l-7-3Z"/>',
  quest: '<path d="M7 4h7l4 4v11a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Z"/><path d="M14 4v4h4"/><path d="M9 12h6M9 15h6"/>',
  reward: '<rect x="4" y="9" width="16" height="11" rx="1"/><path d="M4 13h16M12 9v11"/><path d="M12 9c-2-4-6-3-6 0M12 9c2-4 6-3 6 0"/>',
  link: '<path d="M10 14a4 4 0 0 0 6 .5l2-2a4 4 0 0 0-6-6l-1 1"/><path d="M14 10a4 4 0 0 0-6-.5l-2 2a4 4 0 0 0 6 6l1-1"/>',
  check: '<path d="M5 12.5 10 17 19 7"/>',
  bluesky: '<path d="M12 11c-1.6-3-5-5.5-6.5-5.5C4 5.5 4 7 4 8c0 1.3.8 4 2 5 .7.6 1.7.8 3 .5-2 .4-2.5 1.7-2 3 .6 1.4 2 .8 3-1 .4-.7.8-1.7 1-2.2.2.5.6 1.5 1 2.2 1 1.8 2.4 2.4 3 1 .5-1.3 0-2.6-2-3 1.3.3 2.3.1 3-.5 1.2-1 2-3.7 2-5 0-1 0-2.5-1.5-2.5C17 5.5 13.6 8 12 11Z"/>',
};
const icon = (name, cls = "") =>
  `<svg class="icon${cls ? " " + cls : ""}" viewBox="0 0 24 24" aria-hidden="true">${ICON[name] || ""}</svg>`;

// ---- helpers ---------------------------------------------------------------
const esc = (s = "") =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const initials = (n = "?") => n.split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();
const avatarEl = (b) =>
  b.avatar
    ? // Fall back to initials if the avatar image fails to load (dead CDN link, etc.).
      `<img class="avatar" src="${esc(b.avatar)}" alt="" loading="lazy"
        onerror="this.outerHTML='<div class=\\'avatar\\'>${esc(initials(b.display_name))}</div>'" />`
    : `<div class="avatar">${esc(initials(b.display_name))}</div>`;
const verified = (b) =>
  b.did ? ` <span class="badge ai" title="Bluesky handle verified">${icon("check")} verified</span>` : "";

// Render helpers (DRY the markup duplicated across views)
const badge = (label, variant = "") => `<span class="badge${variant ? " " + variant : ""}">${esc(label)}</span>`;
const badgeRaw = (html, variant = "") => `<span class="badge${variant ? " " + variant : ""}">${html}</span>`;
const sectionHeading = (text) => `<h3>${esc(text)}</h3>`;

async function api(path, opts = {}) {
  const res = await fetch("/api" + path, {
    headers: { "content-type": "application/json" },
    ...opts,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

function toast(msg, isErr = false) {
  const t = document.createElement("div");
  t.className = "toast" + (isErr ? " err" : "");
  // Announce to assistive tech; errors are assertive, successes polite.
  t.setAttribute("role", isErr ? "alert" : "status");
  t.setAttribute("aria-live", isErr ? "assertive" : "polite");
  t.textContent = msg;
  document.body.appendChild(t);
  // Enter/exit animation via a class the CSS transitions on.
  requestAnimationFrame(() => t.classList.add("show"));
  setTimeout(() => {
    t.classList.remove("show");
    setTimeout(() => t.remove(), 250);
  }, 2600);
}

const skillBar = (s) => `
  <div class="bar-row"><span>${esc(s.name)}${
    s.esco_uri
      ? ` <a class="esco-tag" href="${esc(s.esco_uri)}" target="_blank" rel="noopener" title="ESCO: ${esc(s.esco_label || "linked concept")}">${icon("link")}</a>`
      : ""
  }</span><span class="peak-num">${s.peak}</span></div>
  <div class="bar"><span style="width:${s.peak}%"></span></div>`;

// ---- auth ------------------------------------------------------------------
async function loadAuth() {
  try {
    state.auth = await api("/auth/me");
  } catch {
    state.auth = { authenticated: false };
  }
  state.me = state.auth.builder_id || null;
}

// Set up on-device atproto OAuth, complete the post-login redirect if present,
// and sync our server session cookie with the active atproto session.
async function initAtprotoAuth() {
  try {
    oauthClient = await BrowserOAuthClient.load({
      clientId: `${location.origin}/client-metadata.json`,
      handleResolver: "https://bsky.social",
    });
    const result = await oauthClient.init(); // handles the redirect or restores
    atprotoSession = result?.session || null;
    if (atprotoSession && result?.state !== undefined) toast("Logged in with Bluesky 🦋");
  } catch (e) {
    console.warn("atproto auth init failed", e);
    toast("Login failed: " + (e?.message || e), true);
  }

  await loadAuth();
  if (atprotoSession && !state.auth.authenticated) {
    try {
      await establishServerSession(atprotoSession);
    } catch (e) {
      console.warn("establish session failed", e);
      flush("establish_error", e?.message || String(e));
    }
  }
  state.me = state.auth.builder_id || null;
}

// Prove the on-device DID to our server with a Service Auth JWT, minted by the
// user's PDS and signed by their atproto key → our server sets a session cookie.
async function establishServerSession(session) {
  const agent = new Agent(session);
  const { data } = await agent.com.atproto.server.getServiceAuth({
    aud: `did:web:${location.host}`,
    lxm: "org.buildguild.establishSession",
  });
  state.auth = await api("/auth/establish", {
    method: "POST",
    headers: { authorization: `Bearer ${data.token}` },
  });
}

const SKILL_COLLECTION = "org.buildguild.skill";

// Read the builder's skill records straight from their PDS — the source of
// truth. Our D1 is only a per-deployment index, which can be stale or empty
// relative to the user's real repo (e.g. records written from a preview, then
// viewed on prod). Returns null if the read fails, so callers can refuse to
// delete when they don't actually know the repo's contents.
async function loadSkillRecordsFromPds() {
  if (!atprotoSession) return null;
  try {
    const agent = new Agent(atprotoSession);
    const { data } = await agent.com.atproto.repo.listRecords({
      repo: atprotoSession.did,
      collection: SKILL_COLLECTION,
      limit: 100,
    });
    return (data.records || [])
      .map((r) => ({
        rkey: r.uri.split("/").pop(),
        name: r.value?.name || "",
        slug: r.value?.slug || "",
        createdAt: r.value?.createdAt,
        esco: r.value?.externalRef
          ? { uri: r.value.externalRef, label: r.value.externalLabel || "" }
          : null,
      }))
      .filter((r) => r.name);
  } catch {
    return null;
  }
}

// Reconcile the builder's skill records in their own PDS to match `skills`
// (each {name, slug?, esco?, rkey?, createdAt?}). Writes are user-owned and
// on-device.
//
// DATA SAFETY: we only delete records that were loaded from the PDS into this
// form and the user then removed — `loadedKeys` minus the wanted set. If the
// repo couldn't be read (loadedKeys == null) we NEVER delete, only upsert, so a
// stale or empty D1 view can't wipe real records. createdAt is preserved for
// records that already existed (no silent timestamp churn).
async function writeSkillRecordsToPds(skills, loadedKeys) {
  if (!atprotoSession) throw new Error("not logged in on-device");
  const agent = new Agent(atprotoSession);
  const repo = atprotoSession.did;

  const want = new Map(); // rkey -> record value
  for (const s of skills) {
    const slug = (s.slug || s.name).toLowerCase().replace(/\s+/g, " ").trim();
    const rkey = s.rkey || slugToRkey(slug);
    const value = {
      $type: SKILL_COLLECTION,
      name: s.name,
      slug,
      createdAt: s.createdAt || new Date().toISOString(),
    };
    if (s.esco?.uri) {
      value.externalRef = s.esco.uri;
      value.externalScheme = "esco";
      if (s.esco.label) value.externalLabel = s.esco.label;
    }
    want.set(rkey, value);
  }

  // reconcileSkillKeys enforces the data-safety invariant (and is unit-tested):
  // delete only records loaded from the repo into this form that the user
  // removed; never delete when the repo state is unknown (loadedKeys == null).
  const wantedRows = [...want.keys()].map((rkey) => ({ rkey }));
  const { deleteKeys } = reconcileSkillKeys(wantedRows, loadedKeys);

  for (const [rkey, record] of want) {
    await agent.com.atproto.repo.putRecord({ repo, collection: SKILL_COLLECTION, rkey, record });
  }
  for (const rkey of deleteKeys) {
    await agent.com.atproto.repo
      .deleteRecord({ repo, collection: SKILL_COLLECTION, rkey })
      .catch(() => {});
  }
}

// atproto record keys allow a limited charset; map a slug to a safe rkey.
function slugToRkey(slug) {
  const k = slug.replace(/[^a-zA-Z0-9._~-]/g, "-").replace(/^-+|-+$/g, "").slice(0, 100);
  return k || "skill";
}

const REPO_COLLECTION = "org.buildguild.repo";

// Reconcile linked-repo records in the builder's own PDS to match `repos`
// (each {url, name, host?, description?}). Same on-device, source-of-truth model
// as skills; we load existing records and only delete ones the user removed.
async function writeRepoRecordsToPds(repos) {
  if (!atprotoSession) throw new Error("not logged in on-device");
  const agent = new Agent(atprotoSession);
  const repo = atprotoSession.did;

  let existing = [];
  try {
    const { data } = await agent.com.atproto.repo.listRecords({ repo, collection: REPO_COLLECTION, limit: 100 });
    existing = data.records || [];
  } catch {
    /* none yet */
  }
  const loadedKeys = existing.map((r) => r.uri.split("/").pop());

  const want = new Map();
  for (const r of repos) {
    const url = (r.url || "").trim();
    if (!url) continue;
    const rkey = slugToRkey(url.replace(/^https?:\/\//, ""));
    want.set(rkey, {
      $type: REPO_COLLECTION,
      host: r.host || "",
      name: r.name || url,
      url,
      description: r.description || "",
      createdAt: r.createdAt || new Date().toISOString(),
    });
  }
  for (const [rkey, record] of want) {
    await agent.com.atproto.repo.putRecord({ repo, collection: REPO_COLLECTION, rkey, record });
  }
  // Safe deletion: only remove records we loaded that are no longer wanted.
  for (const rkey of loadedKeys) {
    if (!want.has(rkey)) {
      await agent.com.atproto.repo.deleteRecord({ repo, collection: REPO_COLLECTION, rkey }).catch(() => {});
    }
  }
}

// Inline handle widget. Submitting starts the on-device atproto OAuth flow (see
// the delegated submit handler near boot), which redirects to the user's PDS.
function loginFormHTML(btnLabel = "Log in with Bluesky") {
  return `<form class="login-form">
    <input class="login-handle" name="handle" placeholder="you.bsky.social"
      autocomplete="username" autocapitalize="none" autocorrect="off"
      spellcheck="false" inputmode="email" aria-label="Bluesky handle" />
    <button class="btn gold" type="submit">${btnLabel}</button>
  </form>`;
}

// Used by buttons that aren't themselves a form (e.g. in the guild drawer):
// surface the handle widget in the top bar and focus it.
function startLogin() {
  const input = document.querySelector(".login-form .login-handle");
  if (input) {
    input.scrollIntoView({ block: "center", behavior: "smooth" });
    input.focus();
  }
}

async function logout() {
  // Sign out on-device (revoke tokens + clear IndexedDB) and clear our cookie.
  try {
    await (atprotoSession?.signOut?.() ?? oauthClient?.revoke?.(atprotoSession?.sub));
  } catch (e) {
    console.warn("atproto sign-out failed", e);
  }
  atprotoSession = null;
  try {
    await api("/auth/logout", { method: "POST" });
  } catch {}
  window.location.href = "/";
}

function renderAuthBar() {
  if (state.auth.authenticated) {
    authbar.innerHTML = `
      <span class="muted">${icon("bluesky")} @${esc(state.auth.handle)}</span>
      <button class="btn ghost" id="logout-btn">Log out</button>`;
    document.getElementById("logout-btn").addEventListener("click", logout);
  } else {
    authbar.innerHTML = loginFormHTML();
  }
}

const requireLogin = (why) => {
  toast(why || "Log in with Bluesky first", true);
  startLogin();
};

// ---- data loading ----------------------------------------------------------
async function refresh() {
  [state.builders, state.guilds, state.quests] = await Promise.all([
    api("/builders"),
    api("/guilds"),
    api("/quests").catch(() => []),
  ]);
}

// ---- views -----------------------------------------------------------------
let currentView = "quests"; // job-board-first: Quest Board is the landing view
const tabs = document.querySelectorAll(".tab");
const activateTab = (t) => {
  tabs.forEach((x) => {
    const on = x === t;
    x.classList.toggle("active", on);
    x.setAttribute("aria-selected", on ? "true" : "false");
    x.tabIndex = on ? 0 : -1;
  });
  currentView = t.dataset.view;
  render();
};
const tabList = [...tabs];
tabs.forEach((t) => {
  t.setAttribute("role", "tab");
  t.addEventListener("click", () => activateTab(t));
  // Left/Right arrows move between tabs (WAI-ARIA tabs pattern).
  t.addEventListener("keydown", (e) => {
    const i = tabList.indexOf(t);
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      e.preventDefault();
      const next = tabList[(i + (e.key === "ArrowRight" ? 1 : tabList.length - 1)) % tabList.length];
      next.focus();
      activateTab(next);
    }
  });
});
document.querySelector(".tabs")?.setAttribute("role", "tablist");

// Make a non-button element keyboard-operable (Enter/Space) as well as clickable.
function onActivate(el, fn) {
  el.addEventListener("click", fn);
  el.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); fn(); }
  });
}

function render() {
  if (currentView === "guilds") return renderGuilds();
  if (currentView === "roster") return renderRoster();
  if (currentView === "quests") return renderQuests();
  if (currentView === "enlist") return renderEnlist();
}

// ---- quest board (the team job board) --------------------------------------
// Parse a free-text reward into a display amount + qualifier. "$12,000" → mono
// money; "rev share" / "kudos" → worded. (Real escrow is issue #18.)
function parseReward(reward = "") {
  const m = String(reward).match(/\$?\s?([\d][\d,]*\.?\d*)\s?([kKmM])?/);
  if (m && /[\d]/.test(m[1])) {
    let n = parseFloat(m[1].replace(/,/g, ""));
    if (/[kK]/.test(m[2] || "")) n *= 1000;
    if (/[mM]/.test(m[2] || "")) n *= 1e6;
    return { amount: n, label: reward.replace(/[\d$,.\skKmM]+/g, " ").trim() || "bounty" };
  }
  return { amount: null, label: reward || "" };
}
const money = (n) =>
  n >= 1000 ? "$" + (n / 1000).toFixed(n % 1000 ? 1 : 0).replace(/\.0$/, "") + "k" : "$" + n;

function questRow(q) {
  const r = parseReward(q.reward);
  const feat = q.status === "open" && r.amount >= 5000 ? " feat" : "";
  const rewardEl = r.amount != null
    ? `<div class="amt">${money(r.amount)}<small>${esc(r.label || "bounty")}</small></div>`
    : r.label
      ? `<div class="amt" style="font-size:1.05rem">${esc(r.label)}</div>`
      : "";
  const top = (q.suggested_parties || [])[0];
  const matchEl = top
    ? `<div class="qmatch">${q.status === "open" ? "best match" : "claimed by"}: <b>${esc(top.name)}${top.coverage != null ? " · " + top.coverage + "%" : ""}</b></div>`
    : "";
  return `
    <div class="quest${feat}" data-quest="${q.id}" role="button" tabindex="0" aria-label="Open quest ${esc(q.title)}">
      <div>
        <span class="qstatus ${esc(q.status)}">${esc(q.status)}</span>
        <div class="title">${esc(q.title)}</div>
        <div class="by">by <span class="mono">@${esc(q.patron_handle || "patron")}</span></div>
        ${q.brief ? `<div class="brief">${esc(q.brief)}</div>` : ""}
        <div class="badges">${(q.skills || []).map((s) => badge(s.name)).join("")}</div>
      </div>
      <div class="reward">${rewardEl}${matchEl}</div>
    </div>`;
}

function renderQuests() {
  const loggedIn = state.auth.authenticated;
  const quests = state.quests || [];
  const open = quests.filter((q) => q.status === "open");
  const board = open.reduce((sum, q) => sum + (parseReward(q.reward).amount || 0), 0);
  const paid = quests
    .filter((q) => q.status === "delivered" || q.status === "closed")
    .reduce((sum, q) => sum + (parseReward(q.reward).amount || 0), 0);

  app.innerHTML = `
    <div class="pulse">
      <div class="stat live"><div class="n">${open.length}</div><div class="l">open quests right now</div></div>
      <div class="stat"><div class="n">${board ? money(board) : "—"}</div><div class="l">bounties on the board</div></div>
      <div class="stat"><div class="n">${paid ? money(paid) : "—"}</div><div class="l">paid out to date</div></div>
    </div>
    <div class="section-head">
      <div><h2>Open Quests</h2><p>Post the work, rally a party, split the bounty. Quests are matched to your party by peer-endorsed peaks.</p></div>
      ${loggedIn ? '<button class="btn gold" id="new-quest">Post a quest</button>' : ""}
    </div>
    <div class="quests-list" id="quest-list"></div>`;
  if (loggedIn) document.getElementById("new-quest").addEventListener("click", postQuestPrompt);

  const list = document.getElementById("quest-list");
  if (!quests.length) {
    list.innerHTML = `<p class="empty">No quests posted yet. ${loggedIn ? "Be the first to post one." : "Log in with Bluesky to post the first one."}</p>`;
    return;
  }
  list.innerHTML = quests.map(questRow).join("");
  list.querySelectorAll("[data-quest]").forEach((el) =>
    onActivate(el, () => openQuest(Number(el.dataset.quest)))
  );
}

async function openQuest(id) {
  const q = await api(`/quests/${id}`);
  const meId = state.me;
  const isPatron = state.auth.authenticated && q.patron_did === state.auth.did;
  const canClaim = state.auth.authenticated && meId && q.status === "open" && !isPatron;
  openDrawer(`
    <div class="builder-head"><span class="crest">${icon("quest")}</span>
      <div><h2>${esc(q.title)}</h2>
      <div class="klass">by @${esc(q.patron_handle || "patron")} · ${esc(q.status)}</div></div></div>
    <p class="tagline">${esc(q.brief || "")}</p>
    <div class="badges">
      ${q.reward ? badgeRaw(`${icon("reward")} ${esc(q.reward)}`, "role") : ""}
      ${(q.skills || []).map((s) => `<span class="badge">${esc(s.name)}</span>`).join("")}
    </div>
    ${
      canClaim
        ? `<div class="row my-3"><button class="btn gold" id="claim-quest">Claim this quest</button></div>`
        : ""
    }
    ${
      isPatron && q.status !== "closed"
        ? `<div class="row my-3 gap-sm">
             ${q.status === "claimed" ? '<button class="btn" id="q-delivered">Mark delivered</button>' : ""}
             <button class="btn ghost" id="q-closed">Close quest</button></div>`
        : ""
    }
    <h3>Suggested parties</h3>
    <p class="caption">Ranked by how well their combined, peer-endorsed skill-peaks cover this quest.</p>
    ${
      (q.suggested_parties || []).length
        ? q.suggested_parties
            .map(
              (p) => `<div class="subform"><div class="row between">
                <strong>${esc(p.name)}</strong><span class="badge ${p.coverage >= 100 ? "ok" : ""}">${p.coverage}% match</span></div>
                <div class="klass">${p.kind}</div>
                ${p.covered.length ? `<div class="hint">Covers: ${p.covered.map(esc).join(", ")}</div>` : ""}
                ${p.missing.length ? `<div class="hint">Gaps: ${p.missing.map(esc).join(", ")}</div>` : ""}</div>`
            )
            .join("")
        : '<p class="muted">No parties cover these skills yet — recruit some builders!</p>'
    }`);

  const claim = document.getElementById("claim-quest");
  if (claim)
    claim.addEventListener("click", async () => {
      try {
        await api(`/quests/${id}/claim`, { method: "POST", body: {} });
        await refresh();
        toast("Quest claimed!");
        openQuest(id);
      } catch (e) {
        toast(e.message, true);
      }
    });
  for (const [btnId, status] of [["q-delivered", "delivered"], ["q-closed", "closed"]]) {
    const btn = document.getElementById(btnId);
    if (btn)
      btn.addEventListener("click", async () => {
        try {
          await api(`/quests/${id}/status`, { method: "POST", body: { status } });
          await refresh();
          toast(`Quest ${status}.`);
          openQuest(id);
        } catch (e) {
          toast(e.message, true);
        }
      });
  }
}

async function postQuestPrompt() {
  if (!state.auth.authenticated) return requireLogin("Log in with Bluesky to post a quest");
  const title = prompt("Quest title:");
  if (!title) return;
  const brief = prompt("Brief — what needs doing?") || "";
  const reward = prompt("Reward (e.g. 'revenue share', '$500', 'kudos'):") || "";
  const skillsRaw = prompt("Required skills (comma-separated, e.g. Rust, Design):") || "";
  const skills = skillsRaw.split(",").map((s) => ({ name: s.trim() })).filter((s) => s.name);
  try {
    const q = await api("/quests", { method: "POST", body: { title, brief, reward, skills } });
    await refresh();
    renderQuests();
    toast("Quest posted!");
    openQuest(q.id);
  } catch (e) {
    toast(e.message, true);
  }
}

function heroHTML() {
  return `
    <section class="hero">
      <h2>Don't job-hunt alone.</h2>
      <p>Publish your character sheet, rally a <em>suitably diverse</em> guild, and combine
      your skill-peaks. 100% like an MMORPG guild — built from
      <a href="https://bsky.app/profile/codewright.bsky.social/post/3mmyav5klfc2l" target="_blank" rel="noopener">a Bluesky thread</a>.</p>
      <p class="muted">Log in with your Bluesky handle to enlist — your sheet is tied to your
      verified identity, so no one can impersonate you. Browse freely below.</p>
      ${loginFormHTML("Log in with Bluesky")}
    </section>`;
}

function renderGuilds() {
  const loggedOut = !state.auth.authenticated;
  app.innerHTML = `
    ${loggedOut ? heroHTML() : ""}
    <div class="section-head">
      <div><h2>Guild Hall</h2><p>Suitably diverse parties combining their skill-peaks.</p></div>
      ${loggedOut ? "" : '<button class="btn" id="new-guild">+ Found a guild</button>'}
    </div>
    <div class="grid" id="guild-grid"></div>`;
  if (!loggedOut) document.getElementById("new-guild").addEventListener("click", foundGuildPrompt);

  const grid = document.getElementById("guild-grid");
  if (!state.guilds.length) {
    grid.innerHTML = `<p class="empty">No guilds yet. Be the first to rally a party.</p>`;
    return;
  }
  grid.innerHTML = state.guilds
    .map(
      (g) => `
    <div class="card click" data-guild="${g.id}" role="button" tabindex="0" aria-label="Open guild ${esc(g.name)}">
      <div class="builder-head"><span class="crest">${icon("crest")}</span>
        <div><div class="name">${esc(g.name)}</div>
        <div class="klass">${g.member_count} member${g.member_count === 1 ? "" : "s"}</div></div></div>
      <p class="tagline">${esc(g.charter || "")}</p>
      <span class="hint">Open the war room →</span>
    </div>`
    )
    .join("");
  grid.querySelectorAll("[data-guild]").forEach((el) =>
    onActivate(el, () => openGuild(Number(el.dataset.guild)))
  );
}

// Roster is a RANKED LEDGER (not another card grid) — ranked by top peer-endorsed
// peak, with a scaled-up lead row. Differentiates roster from guild/quest views.
function renderRoster() {
  const ranked = [...state.builders].sort((a, b) => topPeak(b) - topPeak(a));
  app.innerHTML = `
    <div class="section-head"><div><h2>Roster</h2>
      <p>Every builder, ranked by the peaks their peers vouched for.</p></div></div>
    ${
      ranked.length
        ? `<div class="ledger" id="roster-ledger">${ranked.map((b, i) => ledgerRow(b, i + 1)).join("")}</div>`
        : `<p class="empty">No builders yet — head to Enlist.</p>`
    }`;
  app.querySelectorAll("[data-builder]").forEach((el) =>
    onActivate(el, () => openBuilder(Number(el.dataset.builder)))
  );
}

const topPeak = (b) => (b.skills || []).reduce((m, s) => Math.max(m, s.peak || 0), 0);

function ledgerRow(b, rank) {
  const peaks = (b.skills || []).slice(0, 2);
  return `
  <div class="lrow" data-builder="${b.id}" role="button" tabindex="0" aria-label="Open ${esc(b.display_name)}">
    <div class="rank">${rank}</div>
    ${avatarEl(b)}
    <div>
      <div class="name">${esc(b.display_name)}${verified(b)}</div>
      <div class="klass">${esc(b.klass)}</div>
      ${b.tagline ? `<div class="hint" style="margin-top:2px">${esc(b.tagline)}</div>` : ""}
    </div>
    <div class="lead-skills">${peaks
      .map((s) => badgeRaw(`${esc(s.name)} <b class="mono" style="color:var(--gold-soft)">${s.peak}</b>`, "role"))
      .join("")}</div>
  </div>`;
}

// ---- drawer: builder + guild detail ---------------------------------------
let lastFocused = null;
function openDrawer(html) {
  lastFocused = document.activeElement;
  drawerBody.innerHTML = html;
  drawer.classList.remove("hidden");
  drawer.setAttribute("aria-hidden", "false");
  // Move focus into the panel for keyboard + screen-reader users.
  const first = drawer.querySelector(".drawer-close");
  if (first) first.focus();
}
function closeDrawer() {
  drawer.classList.add("hidden");
  drawer.setAttribute("aria-hidden", "true");
  if (lastFocused && lastFocused.focus) lastFocused.focus();
  lastFocused = null;
}
document.getElementById("drawer-close").addEventListener("click", closeDrawer);
drawer.addEventListener("click", (e) => {
  if (e.target === drawer) closeDrawer();
});
// Esc closes; Tab is trapped within the open drawer.
document.addEventListener("keydown", (e) => {
  if (drawer.classList.contains("hidden")) return;
  if (e.key === "Escape") return closeDrawer();
  if (e.key !== "Tab") return;
  const focusables = drawer.querySelectorAll(
    'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
  );
  if (!focusables.length) return;
  const first = focusables[0];
  const last = focusables[focusables.length - 1];
  if (e.shiftKey && document.activeElement === first) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault();
    first.focus();
  }
});

const ENDORSEMENT_COLLECTION = "org.buildguild.endorsement";

// A skill row in a builder's drawer: the bar plus an endorsement count and, for
// other people's skills, an Endorse / Endorsed✓ toggle. Whether *you* endorsed
// it is computed from the endorsement list against your own DID.
// Relationship-tier presentation. Stronger ties read with more weight/colour;
// "none" (a stranger's vouch) stays quiet so it doesn't overclaim.
const TIER_META = {
  client: { label: "client", cls: "tier-client" },
  guild_leader: { label: "guild leader", cls: "tier-leader" },
  guildmate: { label: "guildmate", cls: "tier-guildmate" },
  none: { label: "", cls: "tier-none" },
};

// Summarize who endorsed, grouped by relationship tier (strongest first).
function endorserSummary(list) {
  if (!list.length) return "";
  const order = ["client", "guild_leader", "guildmate", "none"];
  const counts = {};
  for (const e of list) counts[e.tier || "none"] = (counts[e.tier || "none"] || 0) + 1;
  const parts = order
    .filter((t) => counts[t])
    .map((t) =>
      t === "none"
        ? `${counts[t]} other${counts[t] === 1 ? "" : "s"}`
        : `<span class="tier-chip ${TIER_META[t].cls}">${counts[t]} ${TIER_META[t].label}${counts[t] === 1 ? "" : "s"}</span>`
    );
  return parts.join(" ");
}

function drawerSkill(s, builder, mine) {
  const list = s.endorsements || [];
  const youEndorsed = state.auth.authenticated && list.some((e) => e.endorser_did === state.auth.did);
  const count = s.endorsement_count ?? list.length;
  const canEndorse = state.auth.authenticated && !mine && builder.did;
  const countLabel = count
    ? `${count} endorsement${count === 1 ? "" : "s"} · ${endorserSummary(list)}`
    : "no endorsements yet";
  return `
    ${skillBar(s)}
    <div class="endorse-row">
      <span class="muted endorse-count">${countLabel}</span>
      ${
        canEndorse
          ? `<button class="btn ghost endorse-btn${youEndorsed ? " endorsed" : ""}"
               data-slug="${esc(skillSlugClient(s.name))}" data-name="${esc(s.name)}"
               data-uri="${esc(s.at_uri || "")}" data-cid="${esc(s.cid || "")}"
               ${youEndorsed ? 'data-endorsed="1"' : ""}>
               ${youEndorsed ? "✓ Endorsed" : "+ Endorse"}</button>`
          : ""
      }
    </div>`;
}

// Client-side slug matching src/skills.js skillSlug (kept in sync deliberately).
const skillSlugClient = (name = "") => String(name).trim().replace(/\s+/g, " ").toLowerCase();

// Write (or remove) an endorsement record in the ENDORSER's own PDS, strongRef-
// ing the exact endorsee skill-record version, then ask the server to re-index.
async function toggleEndorsement(btn, subjectDid) {
  if (!atprotoSession) return toast("Log in to endorse.", true);
  const { slug, name, uri, cid } = btn.dataset;
  if (!uri || !cid) return toast("This skill isn't a PDS record yet — ask them to re-save it.", true);
  const agent = new Agent(atprotoSession);
  const repo = atprotoSession.did;
  // Deterministic rkey: one endorsement per (subject, skill) from this endorser.
  const rkey = slugToRkey(`${subjectDid}-${slug}`);
  const undo = btn.dataset.endorsed === "1";
  btn.disabled = true;
  try {
    if (undo) {
      await agent.com.atproto.repo.deleteRecord({ repo, collection: ENDORSEMENT_COLLECTION, rkey });
    } else {
      await agent.com.atproto.repo.putRecord({
        repo,
        collection: ENDORSEMENT_COLLECTION,
        rkey,
        record: {
          $type: ENDORSEMENT_COLLECTION,
          subject: subjectDid,
          subjectSkill: { uri, cid }, // strongRef → exact skill-record version
          skillName: name,
          skillSlug: slug,
          createdAt: new Date().toISOString(),
        },
      });
    }
    await api("/endorsements", { method: "POST" }); // re-index my repo
    await refresh();
    toast(undo ? "Endorsement removed." : "Endorsed!");
  } catch (e) {
    toast(e.message || "Couldn't update endorsement", true);
  } finally {
    btn.disabled = false;
  }
}

async function openBuilder(id) {
  const b = await api(`/builders/${id}`);
  const mine = state.auth.authenticated && b.did && b.did === state.auth.did;
  openDrawer(`
    <div class="builder-head">
      ${avatarEl(b)}
      <div><h2>${esc(b.display_name)}${verified(b)}</h2>
      <div class="klass">${esc(b.klass)} · <a href="https://bsky.app/profile/${esc(b.handle)}" target="_blank" rel="noopener">@${esc(b.handle)}</a></div></div>
    </div>
    ${
      mine
        ? `<div class="row my-2 gap-sm">
             <button class="btn" id="edit-me">Edit my sheet</button>
             <button class="btn ghost" id="delete-me">Delete</button></div>`
        : ""
    }
    <p class="tagline">${esc(b.tagline || "")}</p>
    ${b.bio ? `<p>${esc(b.bio)}</p>` : ""}
    <div class="badges">
      ${b.seeking ? `<span class="badge">seeking: ${esc(b.seeking)}</span>` : ""}
      ${b.ai_augmented ? `<span class="badge ai">AI-augmented</span>` : ""}
      ${(b.guilds || []).map((g) => `<span class="badge role">${esc(g.name)} · ${esc(g.role)}</span>`).join("")}
    </div>
    <h3>Skill peaks</h3>
    <p class="caption">Peaks reflect peer endorsements, not self-rating — endorse the skills you've seen firsthand.</p>
    ${(b.skills || []).map((s) => drawerSkill(s, b, mine)).join("") || '<p class="muted">No skills listed.</p>'}
    <h3>Projects</h3>
    ${
      (b.projects || [])
        .map(
          (p) => `<div class="subform"><h3>${esc(p.name)}</h3>
        <p class="tight muted">${esc(p.description || "")}</p>
        ${p.help_wanted ? `<p style="margin:.2rem 0 0"><strong>Wants:</strong> ${esc(p.help_wanted)}</p>` : ""}
        ${p.url ? `<a href="${esc(p.url)}" target="_blank" rel="noopener">${esc(p.url)}</a>` : ""}</div>`
        )
        .join("") || '<p class="muted">No projects yet.</p>'
    }
    ${
      (b.repos || []).length
        ? `<h3>Repos</h3>` +
          b.repos
            .map(
              (r) => `<div class="row between gap-sm my-2">
                <a href="${esc(r.url)}" target="_blank" rel="noopener">${esc(r.name)}</a>
                <span class="badge ${r.verified ? "ok" : ""}">${esc(r.host || "repo")}${r.verified ? " ✓" : ""}</span></div>`
            )
            .join("")
        : ""
    }`);

  // Endorse buttons (on other builders' skills). Re-open the drawer after, so
  // the count + toggle reflect the freshly indexed state.
  drawerBody.querySelectorAll(".endorse-btn").forEach((btn) =>
    btn.addEventListener("click", async () => {
      await toggleEndorsement(btn, b.did);
      openBuilder(id);
    })
  );

  if (mine) {
    document.getElementById("edit-me").addEventListener("click", () => {
      closeDrawer();
      tabs.forEach((x) => x.classList.toggle("active", x.dataset.view === "enlist"));
      currentView = "enlist";
      renderEnlist(b);
    });
    document.getElementById("delete-me").addEventListener("click", async () => {
      if (!confirm("Delete your builder? This can't be undone.")) return;
      try {
        await api(`/builders/${b.id}`, { method: "DELETE" });
        await refresh();
        state.me = null;
        closeDrawer();
        toast("Your builder was deleted.");
        render();
      } catch (e) {
        toast(e.message, true);
      }
    });
  }
}

async function openGuild(id) {
  const [g, recruits] = await Promise.all([api(`/guilds/${id}`), api(`/guilds/${id}/recruits`)]);
  const meId = state.me;
  const inGuild = g.members.some((m) => m.id === meId);
  const championOf = Object.fromEntries(g.champions.map((c) => [c.display_name, c.champions]));

  openDrawer(`
    <div class="builder-head"><span class="crest">${icon("crest")}</span>
      <div><h2>${esc(g.name)}</h2>
      <div class="klass">${g.members.length} member${g.members.length === 1 ? "" : "s"}</div></div></div>
    <p class="tagline">${esc(g.charter || "")}</p>

    <h3>Guild Power</h3>
    <div class="power">
      <div class="meter"><span style="width:${Math.min(100, g.diversity)}%"></span></div>
      <span class="val">${g.diversity}</span>
    </div>
    <p class="caption">
      Rewards complementary, peer-endorsed peaks across the party; redundant overlap drags it down.</p>

    <div class="row my-3">
      ${
        state.auth.authenticated && meId
          ? `<button class="btn ${inGuild ? "ghost" : "gold"}" id="join-toggle">${
              inGuild ? "Leave guild" : "Join this guild"
            }</button>`
          : state.auth.authenticated
            ? `<span class="muted">Enlist (create your builder) to join.</span>`
            : `<button class="btn gold" id="login-to-join">Log in with Bluesky to join</button>`
      }
    </div>

    <h3>Party</h3>
    ${g.members
      .map((m) => {
        const champs = championOf[m.display_name] || [];
        return `<div class="subform"><div class="row between">
          <strong>${esc(m.display_name)}</strong><span class="badge role">${esc(m.role)}</span></div>
          <div class="klass">${esc(m.klass)}</div>
          ${
            champs.length
              ? `<div class="hint">Carries: ${champs.map(esc).join(", ")}</div>`
              : `<div class="hint">Supporting — no top peak yet</div>`
          }</div>`;
      })
      .join("")}

    <h3>Combined skill-map</h3>
    ${g.skill_map.map((s) => skillBar({ name: `${s.name} · ${s.champion}`, peak: s.peak })).join("") ||
      '<p class="muted">No skills yet.</p>'}

    <h3>Recommended recruits</h3>
    <p class="caption">Builders who'd fill the party's current gaps. Guild members can recruit them.</p>
    ${
      recruits.length
        ? recruits
            .map(
              (r) => `<div class="subform"><div class="row between">
        <strong>${esc(r.builder.display_name)}</strong>
        ${inGuild ? `<button class="btn ghost recruit" data-id="${r.builder.id}">Recruit</button>` : ""}</div>
        <div class="hint">Fills: ${r.fills.map(esc).join(", ")}</div></div>`
            )
            .join("")
        : '<p class="muted">This party already covers the candidate pool. Enlist more builders!</p>'
    }`);

  const loginToJoin = document.getElementById("login-to-join");
  if (loginToJoin) loginToJoin.addEventListener("click", startLogin);

  const toggle = document.getElementById("join-toggle");
  if (toggle)
    toggle.addEventListener("click", async () => {
      const action = inGuild ? "leave" : "join";
      try {
        await api(`/guilds/${id}/${action}`, { method: "POST", body: {} });
        await refresh();
        toast(inGuild ? "Left the guild" : "Joined the guild!");
        openGuild(id);
      } catch (e) {
        toast(e.message, true);
      }
    });

  drawerBody.querySelectorAll(".recruit").forEach((btn) =>
    btn.addEventListener("click", async () => {
      try {
        await api(`/guilds/${id}/join`, { method: "POST", body: { builder_id: Number(btn.dataset.id) } });
        await refresh();
        toast("Recruit added to the party!");
        openGuild(id);
      } catch (e) {
        toast(e.message, true);
      }
    })
  );
}

async function foundGuildPrompt() {
  if (!state.auth.authenticated) return requireLogin("Log in with Bluesky to found a guild");
  if (!state.me) return toast("Create your builder (Enlist) first", true);
  const name = prompt("Name your guild:");
  if (!name) return;
  const charter = prompt("Guild charter (one line):") || "";
  try {
    const g = await api("/guilds", { method: "POST", body: { name, charter } });
    await refresh();
    renderGuilds();
    toast("Guild founded!");
    openGuild(g.id);
  } catch (e) {
    toast(e.message, true);
  }
}

// ---- enlist / edit form ----------------------------------------------------
// `existing` is a builder object when editing; undefined when enlisting.
function renderEnlist(existing) {
  if (!state.auth.authenticated) {
    app.innerHTML = `
      <div class="section-head"><div><h2>Enlist</h2>
        <p>Your character sheet is tied to your Bluesky identity, so no one can impersonate you.</p></div></div>
      <div class="subform center-pad">
        <p>Log in with Bluesky to create your builder.</p>
        ${loginFormHTML()}
      </div>`;
    return;
  }
  if (!existing && state.me) {
    // Already enlisted — point them at their sheet rather than a second one.
    app.innerHTML = `
      <div class="section-head"><div><h2>Enlist</h2></div></div>
      <div class="subform center-pad">
        <p>You're already enlisted as <strong>@${esc(state.auth.handle)}</strong>.</p>
        <button class="btn gold" id="open-mine">View / edit my sheet</button>
      </div>`;
    document.getElementById("open-mine").addEventListener("click", () => openBuilder(state.me));
    return;
  }

  const editing = !!existing;
  app.innerHTML = `
    <div class="section-head"><div><h2>${editing ? "Edit your sheet" : "Enlist"}</h2>
      <p>List the skills you're genuinely strong at — other builders' endorsements,
      not a self-rated slider, will speak to how strong. You're verified as
      <strong>@${esc(state.auth.handle)}</strong>.</p></div></div>
    <form class="enlist" id="enlist-form">
      <div class="field-pair">
        <label>Display name<input name="display_name" required placeholder="Ada Lovelace" /></label>
        <label>Class / archetype<input name="klass" placeholder="Architect, Bard, Druid…" /></label>
      </div>
      <label>Seeking<input name="seeking" placeholder="income, collaborators, both" /></label>
      <label>Tagline<input name="tagline" placeholder="One line on what you bring" /></label>
      <label>Bio<textarea name="bio" rows="3"></textarea></label>
      <label class="row" style="align-items:center;gap:.5rem">
        <input type="checkbox" name="ai_augmented" checked style="width:auto" /> I leverage AI to augment my work
      </label>

      <div class="subform" id="skills">
        <h3>Skill peaks</h3>
        <div id="skill-rows"></div>
        <button type="button" class="btn ghost" id="add-skill">+ Add skill</button>
      </div>

      <div class="subform" id="projects">
        <h3>Projects (optional)</h3>
        <div id="project-rows"></div>
        <button type="button" class="btn ghost" id="add-project">+ Add project</button>
      </div>

      <div class="subform" id="repos">
        <h3>Linked repos (optional)</h3>
        <p class="hint tight">Paste a repo URL. Tangled repos under your own handle verify automatically (same atproto identity).</p>
        <div id="repo-rows"></div>
        <button type="button" class="btn ghost" id="add-repo">+ Link a repo</button>
      </div>

      <button class="btn gold" type="submit">${editing ? "Save changes" : "Join the Build Guild"}</button>
    </form>`;

  const form = document.getElementById("enlist-form");
  const skillRows = document.getElementById("skill-rows");
  const projectRows = document.getElementById("project-rows");
  // Each skill row carries an optional, builder-confirmed ESCO concept in
  // `row._esco = {uri,label}`. ESCO is opt-in: a skill is complete with just a
  // name; linking a standard definition is an offered convenience, never a gate.
  const addSkill = (name = "", esco = null, rec = null) => {
    const div = document.createElement("div");
    div.className = "skill-row";
    div.innerHTML = `
      <div class="skill-line">
        <input class="s-name" placeholder="Skill (e.g. Rust)" value="${esc(name)}"
          list="skill-options" autocomplete="off" />
        <button type="button" class="btn ghost rm" aria-label="Remove skill">✕</button>
      </div>
      <div class="skill-meta">
        <button type="button" class="linklike esco-toggle">+ link a standard definition (optional)</button>
        <span class="esco-chosen hidden"></span>
        <div class="esco-panel hidden"></div>
      </div>`;
    div._esco = esco || null;
    // Preserve the PDS record identity so a re-save updates in place (no churn,
    // no duplicate records).
    div._rkey = rec?.rkey || null;
    div._createdAt = rec?.createdAt || null;
    div.querySelector(".rm").addEventListener("click", () => div.remove());
    wireEsco(div);
    renderEscoChosen(div);
    skillRows.appendChild(div);
  };
  const addProject = (p = {}) => {
    const div = document.createElement("div");
    div.className = "project-line";
    div.innerHTML = `
      <input class="p-name" placeholder="Project name" value="${esc(p.name || "")}" />
      <input class="p-desc" placeholder="What is it?" value="${esc(p.description || "")}" />
      <input class="p-help" placeholder="Where you'd welcome help" value="${esc(p.help_wanted || "")}" />
      <button type="button" class="btn ghost rm">Remove project</button>`;
    div.querySelector(".rm").addEventListener("click", () => div.remove());
    projectRows.appendChild(div);
  };
  const repoRows = document.getElementById("repo-rows");
  const addRepo = (r = {}) => {
    const div = document.createElement("div");
    div.className = "skill-line";
    div.innerHTML = `
      <input class="r-url" placeholder="https://tangled.sh/@you/repo" value="${esc(r.url || "")}" inputmode="url" autocapitalize="none" />
      <button type="button" class="btn ghost rm" aria-label="Remove repo">✕</button>`;
    div.querySelector(".rm").addEventListener("click", () => div.remove());
    repoRows.appendChild(div);
  };
  document.getElementById("add-skill").addEventListener("click", () => addSkill());
  document.getElementById("add-project").addEventListener("click", () => addProject());
  document.getElementById("add-repo").addEventListener("click", () => addRepo());

  // Canonical-skill autocomplete: one shared <datalist> the skill inputs read
  // from (via list="skill-options"), refreshed from /api/skills/suggest as the
  // builder types so they converge on existing skills instead of re-spelling.
  const skillList = document.createElement("datalist");
  skillList.id = "skill-options";
  form.appendChild(skillList);
  let sugTimer;
  const refreshSkillOptions = (q) => {
    clearTimeout(sugTimer);
    sugTimer = setTimeout(() => {
      api(`/skills/suggest?q=${encodeURIComponent(q || "")}`)
        .then((items) => {
          skillList.innerHTML = items.map((s) => `<option value="${esc(s.name)}"></option>`).join("");
        })
        .catch(() => {});
    }, 150);
  };
  skillRows.addEventListener("input", (e) => {
    if (e.target.classList.contains("s-name")) refreshSkillOptions(e.target.value);
  });
  refreshSkillOptions(""); // preload the most-used skills

  // ESCO concept picker for one skill row. Opening it searches ESCO for the
  // typed skill name; the builder picks a concept (or none). All optional.
  function wireEsco(row) {
    const toggle = row.querySelector(".esco-toggle");
    const panel = row.querySelector(".esco-panel");
    toggle.addEventListener("click", async () => {
      const open = !panel.classList.contains("hidden");
      if (open) return panel.classList.add("hidden");
      const term = row.querySelector(".s-name").value.trim();
      if (!term) return toast("Type the skill name first.", true);
      panel.classList.remove("hidden");
      panel.innerHTML = `<p class="hint">Searching ESCO…</p>`;
      let items = [];
      try {
        items = await api(`/skills/esco?q=${encodeURIComponent(term)}`);
      } catch {
        /* best-effort */
      }
      if (!items.length) {
        panel.innerHTML = `<p class="hint">No ESCO match — that's fine, leave it unlinked.</p>`;
        return;
      }
      panel.innerHTML = items
        .map(
          (it) =>
            `<button type="button" class="esco-opt" data-uri="${esc(it.uri)}" data-label="${esc(it.title)}">${esc(it.title)}</button>`
        )
        .join("");
      panel.querySelectorAll(".esco-opt").forEach((btn) =>
        btn.addEventListener("click", () => {
          row._esco = { uri: btn.dataset.uri, label: btn.dataset.label };
          panel.classList.add("hidden");
          renderEscoChosen(row);
        })
      );
    });
  }

  function renderEscoChosen(row) {
    const chosen = row.querySelector(".esco-chosen");
    const toggle = row.querySelector(".esco-toggle");
    if (row._esco?.uri) {
      chosen.classList.remove("hidden");
      chosen.innerHTML = `<a href="${esc(row._esco.uri)}" target="_blank" rel="noopener" title="ESCO concept">${icon("link")} ${esc(row._esco.label || "linked")}</a>
        <button type="button" class="linklike esco-clear">clear</button>`;
      chosen.querySelector(".esco-clear").addEventListener("click", () => {
        row._esco = null;
        renderEscoChosen(row);
      });
      toggle.classList.add("hidden");
    } else {
      chosen.classList.add("hidden");
      chosen.innerHTML = "";
      toggle.classList.remove("hidden");
    }
  }

  // Which skill rkeys this form actually loaded from the PDS. Stays null until a
  // successful repo read, so the submit handler knows whether deletes are safe.
  let loadedSkillKeys = null;

  // Seed the skill rows from the builder's PDS — the source of truth — NOT from
  // D1 (which is a per-deployment index that may be stale/empty) and NOT from
  // Bluesky suggestions (which would let a re-save delete real records). This is
  // the core of the data-loss fix.
  async function seedSkillsFromPds() {
    const records = await loadSkillRecordsFromPds();
    if (records) {
      loadedSkillKeys = records.map((r) => r.rkey);
      records
        .sort((a, b) => String(a.createdAt || "").localeCompare(String(b.createdAt || "")))
        .forEach((r) => addSkill(r.name, r.esco, r));
    }
    // Suggestions are offered ONLY to a builder with no existing records, and
    // only when we could actually read the repo (so we know it's truly empty).
    if (records && records.length === 0 && !editing) {
      try {
        const p = await api(`/atproto/profile?handle=${encodeURIComponent(state.auth.handle)}`);
        if (!form.display_name.value) form.display_name.value = p.display_name || "";
        if (!form.bio.value) form.bio.value = p.bio || "";
        (p.suggested_skills || []).forEach((s) => addSkill(s.name));
      } catch {
        /* suggestions are best-effort */
      }
    }
    if (!skillRows.children.length) addSkill(""); // always leave one empty row
  }

  if (editing) {
    form.display_name.value = existing.display_name || "";
    form.klass.value = existing.klass || "";
    form.seeking.value = existing.seeking || "";
    form.tagline.value = existing.tagline || "";
    form.bio.value = existing.bio || "";
    form.ai_augmented.checked = !!existing.ai_augmented;
    (existing.projects || []).forEach(addProject);
    (existing.repos || []).forEach(addRepo);
  } else if (!form.display_name.value) {
    // New builder: prefill name/bio from the public Bluesky profile.
    api(`/atproto/profile?handle=${encodeURIComponent(state.auth.handle)}`)
      .then((p) => {
        if (!form.display_name.value) form.display_name.value = p.display_name || "";
        if (!form.bio.value) form.bio.value = p.bio || "";
      })
      .catch(() => {});
  }
  seedSkillsFromPds();

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const skills = [...skillRows.querySelectorAll(".skill-row")]
      .map((r) => ({
        name: r.querySelector(".s-name").value.trim(),
        esco: r._esco || null,
        rkey: r._rkey || null,
        createdAt: r._createdAt || null,
      }))
      .filter((s) => s.name);
    const projects = [...projectRows.querySelectorAll(".project-line")]
      .map((r) => ({
        name: r.querySelector(".p-name").value.trim(),
        description: r.querySelector(".p-desc").value.trim(),
        help_wanted: r.querySelector(".p-help").value.trim(),
      }))
      .filter((p) => p.name);
    const repos = [...repoRows.querySelectorAll(".skill-line")]
      .map((r) => ({ url: r.querySelector(".r-url").value.trim() }))
      .filter((r) => r.url);
    // Profile fields go to D1 via the server; skills are PDS-native.
    const body = {
      display_name: form.display_name.value,
      klass: form.klass.value,
      seeking: form.seeking.value,
      tagline: form.tagline.value,
      bio: form.bio.value,
      ai_augmented: form.ai_augmented.checked,
      projects,
    };
    const submitBtn = form.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    try {
      const b = editing
        ? await api(`/builders/${existing.id}`, { method: "PUT", body })
        : await api("/builders", { method: "POST", body });
      // Write the skill records to the builder's own PDS, then have the server
      // re-index them from the repo (authoritative; never trusts the client).
      // loadedSkillKeys (rkeys read from the PDS into this form) bounds deletes:
      // if the repo read failed, it's null and nothing is ever deleted.
      await writeSkillRecordsToPds(skills, loadedSkillKeys);
      await api(`/builders/${b.id}/skills`, { method: "POST" });
      // Linked repos: write records on-device, then re-index from the repo.
      await writeRepoRecordsToPds(repos);
      await api(`/builders/${b.id}/repos`, { method: "POST" });
      await refresh();
      state.me = b.id;
      toast(editing ? "Sheet updated!" : `Welcome, ${b.display_name}!`);
      tabs.forEach((x) => x.classList.toggle("active", x.dataset.view === "roster"));
      currentView = "roster";
      render();
    } catch (err) {
      toast(err.message, true);
    } finally {
      submitBtn.disabled = false;
    }
  });
}

// ---- boot ------------------------------------------------------------------
// A login form submission anywhere starts the on-device atproto OAuth flow.
document.addEventListener("submit", async (e) => {
  const form = e.target;
  if (!form?.classList?.contains("login-form")) return;
  e.preventDefault();
  const handle = form.querySelector(".login-handle")?.value.trim();
  if (!handle) return;
  if (!oauthClient) return toast("Login isn't ready yet — one moment.", true);
  try {
    await oauthClient.signIn(handle); // redirects to the user's PDS; never returns
  } catch (err) {
    toast("Login failed: " + (err?.message || err), true);
  }
});

// Skeleton placeholder shown while the first data load is in flight, so the
// initial paint has structure instead of a blank page.
function showLoadingSkeleton() {
  const card = `<div class="skeleton-card" aria-hidden="true">
    <div class="sk-line head"></div><div class="sk-line"></div><div class="sk-line sm"></div></div>`;
  app.innerHTML = `<div class="section-head"><div><div class="sk-line head" style="width:160px"></div></div></div>
    <div class="grid">${card.repeat(6)}</div>`;
  app.setAttribute("aria-busy", "true");
}

(async () => {
  try {
    showLoadingSkeleton();
    await initAtprotoAuth();
    await refresh();
    renderAuthBar();
    app.removeAttribute("aria-busy");
    render();
  } catch (e) {
    app.removeAttribute("aria-busy");
    app.innerHTML = `<p class="empty">Couldn't reach the guild hall: ${esc(e.message)}</p>`;
  }
})();

// "Report a bug" — upload the recent trace with an optional note.
document.getElementById("report-bug")?.addEventListener("click", async () => {
  const note = prompt("What went wrong? (optional — a diagnostic trace is sent either way)");
  if (note === null) return; // cancelled
  await reportBug(note);
  toast("Thanks — diagnostics sent 🛠️");
});
