// Build Guild — front-end. Vanilla JS, talks to the Worker's /api.

import { initTelemetry, reportBug, flush } from "./telemetry.js";
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

// ---- helpers ---------------------------------------------------------------
const esc = (s = "") =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const initials = (n = "?") => n.split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();
const avatarEl = (b) =>
  b.avatar
    ? `<img class="avatar" src="${esc(b.avatar)}" alt="" />`
    : `<div class="avatar">${esc(initials(b.display_name))}</div>`;
const verified = (b) => (b.did ? ` <span class="badge ai" title="Bluesky handle verified">🦋 verified</span>` : "");

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
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2600);
}

const skillBar = (s) => `
  <div class="bar-row"><span>${esc(s.name)}</span><span class="peak-num">${s.peak}</span></div>
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

// Inline handle widget (the pattern other atproto apps use) instead of a
// prompt(): a plain text field with autofill on and autocapitalize/correct off.
function loginFormHTML(btnLabel = "Log in with Bluesky") {
  // Native GET submit to /api/auth/login works even if JS never wires up; the
  // submit handler below is a progressive enhancement (trims @, same target).
  return `<form class="login-form" action="/api/auth/login" method="get">
    <input class="login-handle" name="handle" placeholder="you.bsky.social"
      autocomplete="username" autocapitalize="none" autocorrect="off"
      spellcheck="false" inputmode="email" aria-label="Bluesky handle" />
    <button class="btn gold" type="submit">${btnLabel}</button>
  </form>`;
}

function wireLoginForms(root = document) {
  root.querySelectorAll(".login-form").forEach((f) => {
    if (f.dataset.wired) return;
    f.dataset.wired = "1";
    f.addEventListener("submit", (e) => {
      e.preventDefault();
      const handle = f.querySelector(".login-handle").value.trim().replace(/^@+/, "");
      if (handle) window.location.href = "/api/auth/login?handle=" + encodeURIComponent(handle);
    });
  });
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
  await api("/auth/logout", { method: "POST" });
  window.location.href = "/";
}

function renderAuthBar() {
  if (state.auth.authenticated) {
    authbar.innerHTML = `
      <span class="muted">🦋 @${esc(state.auth.handle)}</span>
      <button class="btn ghost" id="logout-btn">Log out</button>`;
    document.getElementById("logout-btn").addEventListener("click", logout);
  } else {
    authbar.innerHTML = loginFormHTML();
    wireLoginForms(authbar);
  }
}

const requireLogin = (why) => {
  toast(why || "Log in with Bluesky first", true);
  startLogin();
};

// ---- data loading ----------------------------------------------------------
async function refresh() {
  [state.builders, state.guilds] = await Promise.all([api("/builders"), api("/guilds")]);
}

// ---- views -----------------------------------------------------------------
let currentView = "guilds";
const tabs = document.querySelectorAll(".tab");
tabs.forEach((t) =>
  t.addEventListener("click", () => {
    tabs.forEach((x) => x.classList.toggle("active", x === t));
    currentView = t.dataset.view;
    render();
  })
);

function render() {
  if (currentView === "guilds") return renderGuilds();
  if (currentView === "roster") return renderRoster();
  if (currentView === "enlist") return renderEnlist();
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
  if (loggedOut) wireLoginForms(app);
  else document.getElementById("new-guild").addEventListener("click", foundGuildPrompt);

  const grid = document.getElementById("guild-grid");
  if (!state.guilds.length) {
    grid.innerHTML = `<p class="empty">No guilds yet. Be the first to rally a party.</p>`;
    return;
  }
  grid.innerHTML = state.guilds
    .map(
      (g) => `
    <div class="card click" data-guild="${g.id}">
      <div class="builder-head"><span class="crest">🛡️</span>
        <div><div class="name">${esc(g.name)}</div>
        <div class="klass">${g.member_count} member${g.member_count === 1 ? "" : "s"}</div></div></div>
      <p class="tagline">${esc(g.charter || "")}</p>
      <span class="muted" style="font-size:.82rem">Open the war room →</span>
    </div>`
    )
    .join("");
  grid.querySelectorAll("[data-guild]").forEach((el) =>
    el.addEventListener("click", () => openGuild(Number(el.dataset.guild)))
  );
}

function renderRoster() {
  app.innerHTML = `
    <div class="section-head"><div><h2>Roster</h2>
      <p>Every builder and the peaks they bring to a party.</p></div></div>
    <div class="grid">${
      state.builders.length
        ? state.builders.map(builderCard).join("")
        : `<p class="empty">No builders yet — head to Enlist.</p>`
    }</div>`;
  app.querySelectorAll("[data-builder]").forEach((el) =>
    el.addEventListener("click", () => openBuilder(Number(el.dataset.builder)))
  );
}

function builderCard(b) {
  const top = (b.skills || []).slice(0, 3);
  return `
  <div class="card click" data-builder="${b.id}">
    <div class="builder-head">
      ${avatarEl(b)}
      <div><div class="name">${esc(b.display_name)}${verified(b)}</div><div class="klass">${esc(b.klass)}</div></div>
    </div>
    <p class="tagline">${esc(b.tagline || "")}</p>
    ${top.map(skillBar).join("")}
    <div class="badges">
      ${b.seeking ? `<span class="badge">seeking: ${esc(b.seeking)}</span>` : ""}
      ${b.ai_augmented ? `<span class="badge ai">AI-augmented</span>` : ""}
    </div>
  </div>`;
}

// ---- drawer: builder + guild detail ---------------------------------------
function openDrawer(html) {
  drawerBody.innerHTML = html;
  drawer.classList.remove("hidden");
}
function closeDrawer() {
  drawer.classList.add("hidden");
}
document.getElementById("drawer-close").addEventListener("click", closeDrawer);
drawer.addEventListener("click", (e) => {
  if (e.target === drawer) closeDrawer();
});

async function openBuilder(id) {
  const b = await api(`/builders/${id}`);
  const mine = state.auth.authenticated && b.did && b.did === state.auth.did;
  openDrawer(`
    <div class="builder-head">
      ${avatarEl(b)}
      <div><h2 style="margin:0">${esc(b.display_name)}${verified(b)}</h2>
      <div class="klass">${esc(b.klass)} · <a href="https://bsky.app/profile/${esc(b.handle)}" target="_blank" rel="noopener">@${esc(b.handle)}</a></div></div>
    </div>
    ${
      mine
        ? `<div class="row" style="gap:.5rem;margin:.4rem 0">
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
    <h3 style="color:var(--gold);font-family:Cinzel,serif">Skill peaks</h3>
    ${(b.skills || []).map(skillBar).join("") || '<p class="muted">No skills listed.</p>'}
    <h3 style="color:var(--gold);font-family:Cinzel,serif">Projects</h3>
    ${
      (b.projects || [])
        .map(
          (p) => `<div class="subform"><h3>${esc(p.name)}</h3>
        <p class="muted" style="margin:0">${esc(p.description || "")}</p>
        ${p.help_wanted ? `<p style="margin:.2rem 0 0"><strong>Wants:</strong> ${esc(p.help_wanted)}</p>` : ""}
        ${p.url ? `<a href="${esc(p.url)}" target="_blank" rel="noopener">${esc(p.url)}</a>` : ""}</div>`
        )
        .join("") || '<p class="muted">No projects yet.</p>'
    }`);

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
    <div class="builder-head"><span class="crest">🛡️</span>
      <div><h2 style="margin:0">${esc(g.name)}</h2>
      <div class="klass">${g.members.length} member${g.members.length === 1 ? "" : "s"}</div></div></div>
    <p class="tagline">${esc(g.charter || "")}</p>

    <h3 style="color:var(--gold);font-family:Cinzel,serif">Guild Power</h3>
    <div class="power">
      <div class="meter"><span style="width:${Math.min(100, g.diversity)}%"></span></div>
      <span class="val">${g.diversity}</span>
    </div>
    <p class="muted" style="font-size:.8rem;margin-top:-.4rem">
      Rewards complementary peaks across the party; redundant overlap drags it down.</p>

    <div class="row" style="margin:.8rem 0">
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

    <h3 style="color:var(--gold);font-family:Cinzel,serif">Party</h3>
    ${g.members
      .map((m) => {
        const champs = championOf[m.display_name] || [];
        return `<div class="subform"><div class="row" style="justify-content:space-between">
          <strong>${esc(m.display_name)}</strong><span class="badge role">${esc(m.role)}</span></div>
          <div class="klass">${esc(m.klass)}</div>
          ${
            champs.length
              ? `<div class="muted" style="font-size:.82rem">Carries: ${champs.map(esc).join(", ")}</div>`
              : `<div class="muted" style="font-size:.82rem">Supporting — no top peak yet</div>`
          }</div>`;
      })
      .join("")}

    <h3 style="color:var(--gold);font-family:Cinzel,serif">Combined skill-map</h3>
    ${g.skill_map.map((s) => skillBar({ name: `${s.name} · ${s.champion}`, peak: s.peak })).join("") ||
      '<p class="muted">No skills yet.</p>'}

    <h3 style="color:var(--gold);font-family:Cinzel,serif">Recommended recruits</h3>
    <p class="muted" style="font-size:.8rem;margin-top:-.4rem">Builders who'd fill the party's current gaps. Guild members can recruit them.</p>
    ${
      recruits.length
        ? recruits
            .map(
              (r) => `<div class="subform"><div class="row" style="justify-content:space-between">
        <strong>${esc(r.builder.display_name)}</strong>
        ${inGuild ? `<button class="btn ghost recruit" data-id="${r.builder.id}">Recruit</button>` : ""}</div>
        <div class="muted" style="font-size:.82rem">Fills: ${r.fills.map(esc).join(", ")}</div></div>`
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
      <div class="subform" style="text-align:center;padding:2rem">
        <p>Log in with Bluesky to create your builder.</p>
        ${loginFormHTML()}
      </div>`;
    wireLoginForms(app);
    return;
  }
  if (!existing && state.me) {
    // Already enlisted — point them at their sheet rather than a second one.
    app.innerHTML = `
      <div class="section-head"><div><h2>Enlist</h2></div></div>
      <div class="subform" style="text-align:center;padding:2rem">
        <p>You're already enlisted as <strong>@${esc(state.auth.handle)}</strong>.</p>
        <button class="btn gold" id="open-mine">View / edit my sheet</button>
      </div>`;
    document.getElementById("open-mine").addEventListener("click", () => openBuilder(state.me));
    return;
  }

  const editing = !!existing;
  app.innerHTML = `
    <div class="section-head"><div><h2>${editing ? "Edit your sheet" : "Enlist"}</h2>
      <p>Be honest about your peaks — that's the whole point. You're verified as
      <strong>@${esc(state.auth.handle)}</strong>.</p></div></div>
    <form class="enlist" id="enlist-form">
      <div class="row" style="gap:.9rem">
        <label style="flex:1">Display name<input name="display_name" required placeholder="Ada Lovelace" /></label>
        <label style="flex:1">Class / archetype<input name="klass" placeholder="Architect, Bard, Druid…" /></label>
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

      <button class="btn gold" type="submit">${editing ? "Save changes" : "Join the Build Guild"}</button>
    </form>`;

  const form = document.getElementById("enlist-form");
  const skillRows = document.getElementById("skill-rows");
  const projectRows = document.getElementById("project-rows");
  const addSkill = (name = "", peak = 70) => {
    const div = document.createElement("div");
    div.className = "skill-line";
    div.innerHTML = `
      <input class="s-name" placeholder="Skill (e.g. Rust)" value="${esc(name)}" />
      <span class="peak-num"><output>${peak}</output></span>
      <button type="button" class="btn ghost rm">✕</button>
      <input class="s-peak peak-slider" type="range" min="1" max="100" value="${peak}" style="grid-column:1/-1" />`;
    div.querySelector(".s-peak").addEventListener("input", (e) => {
      div.querySelector("output").textContent = e.target.value;
    });
    div.querySelector(".rm").addEventListener("click", () => div.remove());
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
  document.getElementById("add-skill").addEventListener("click", () => addSkill());
  document.getElementById("add-project").addEventListener("click", () => addProject());

  if (editing) {
    form.display_name.value = existing.display_name || "";
    form.klass.value = existing.klass || "";
    form.seeking.value = existing.seeking || "";
    form.tagline.value = existing.tagline || "";
    form.bio.value = existing.bio || "";
    form.ai_augmented.checked = !!existing.ai_augmented;
    (existing.skills || []).forEach((s) => addSkill(s.name, s.peak));
    (existing.projects || []).forEach(addProject);
    if (!existing.skills?.length) addSkill("", 80);
  } else {
    // Prefill from the logged-in user's own public Bluesky profile.
    addSkill("", 80);
    api(`/atproto/profile?handle=${encodeURIComponent(state.auth.handle)}`)
      .then((p) => {
        if (!form.display_name.value) form.display_name.value = p.display_name || "";
        if (!form.bio.value) form.bio.value = p.bio || "";
        if (p.suggested_skills?.length) {
          skillRows.innerHTML = "";
          p.suggested_skills.forEach((s) => addSkill(s.name, s.peak));
        }
      })
      .catch(() => {});
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const skills = [...skillRows.querySelectorAll(".skill-line")]
      .map((r) => ({ name: r.querySelector(".s-name").value.trim(), peak: Number(r.querySelector(".s-peak").value) }))
      .filter((s) => s.name);
    const projects = [...projectRows.querySelectorAll(".project-line")]
      .map((r) => ({
        name: r.querySelector(".p-name").value.trim(),
        description: r.querySelector(".p-desc").value.trim(),
        help_wanted: r.querySelector(".p-help").value.trim(),
      }))
      .filter((p) => p.name);
    const body = {
      display_name: form.display_name.value,
      klass: form.klass.value,
      seeking: form.seeking.value,
      tagline: form.tagline.value,
      bio: form.bio.value,
      ai_augmented: form.ai_augmented.checked,
      skills,
      projects,
    };
    try {
      const b = editing
        ? await api(`/builders/${existing.id}`, { method: "PUT", body })
        : await api("/builders", { method: "POST", body });
      await refresh();
      state.me = b.id;
      toast(editing ? "Sheet updated!" : `Welcome, ${b.display_name}!`);
      tabs.forEach((x) => x.classList.toggle("active", x.dataset.view === "roster"));
      currentView = "roster";
      render();
    } catch (err) {
      toast(err.message, true);
    }
  });
}

// ---- boot ------------------------------------------------------------------
(async () => {
  try {
    await loadAuth();
    await refresh();
    renderAuthBar();
    render();
    const params = new URLSearchParams(location.search);
    if (params.get("login") === "ok") toast("Logged in with Bluesky 🦋");
    if (params.get("login") === "error") {
      const reason = params.get("reason") || "please try again";
      console.error("Bluesky login failed:", reason);
      toast("Login failed: " + reason, true);
      // No console on mobile — auto-upload the failure trace so we can debug it.
      flush("login_error", reason);
    }
    if (params.has("login")) history.replaceState({}, "", "/");
  } catch (e) {
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
