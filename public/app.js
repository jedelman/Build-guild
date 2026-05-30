// Build Guild — front-end. Vanilla JS, talks to the Worker's /api.

const app = document.getElementById("app");
const drawer = document.getElementById("drawer");
const drawerBody = document.getElementById("drawer-body");
const identitySel = document.getElementById("identity");

const state = { builders: [], guilds: [], me: localStorage.getItem("bg_me") || "" };

// ---- helpers ---------------------------------------------------------------
const esc = (s = "") =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const initials = (n = "?") => n.split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();

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

// ---- data loading ----------------------------------------------------------
async function refresh() {
  [state.builders, state.guilds] = await Promise.all([api("/builders"), api("/guilds")]);
  renderIdentity();
}

function renderIdentity() {
  identitySel.innerHTML =
    '<option value="">— pick your builder —</option>' +
    state.builders.map((b) => `<option value="${b.id}">${esc(b.display_name)}</option>`).join("");
  if (state.me) identitySel.value = state.me;
}
identitySel.addEventListener("change", () => {
  state.me = identitySel.value;
  localStorage.setItem("bg_me", state.me);
  if (currentView === "guilds") renderGuilds();
});

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

function renderGuilds() {
  app.innerHTML = `
    <div class="section-head">
      <div><h2>Guild Hall</h2><p>Suitably diverse parties combining their skill-peaks.</p></div>
      <button class="btn" id="new-guild">+ Found a guild</button>
    </div>
    <div class="grid" id="guild-grid"></div>`;
  document.getElementById("new-guild").addEventListener("click", foundGuildPrompt);

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
      <div class="avatar">${esc(initials(b.display_name))}</div>
      <div><div class="name">${esc(b.display_name)}</div><div class="klass">${esc(b.klass)}</div></div>
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
  openDrawer(`
    <div class="builder-head">
      <div class="avatar">${esc(initials(b.display_name))}</div>
      <div><h2 style="margin:0">${esc(b.display_name)}</h2>
      <div class="klass">${esc(b.klass)} · @${esc(b.handle)}</div></div>
    </div>
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
}

async function openGuild(id) {
  const [g, recruits] = await Promise.all([api(`/guilds/${id}`), api(`/guilds/${id}/recruits`)]);
  const meId = Number(state.me) || null;
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
        meId
          ? `<button class="btn ${inGuild ? "ghost" : "gold"}" id="join-toggle">${
              inGuild ? "Leave guild" : "Join this guild"
            }</button>`
          : `<span class="muted">Pick who you're playing as (top right) to join.</span>`
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
    <p class="muted" style="font-size:.8rem;margin-top:-.4rem">Builders who'd fill the party's current gaps.</p>
    ${
      recruits.length
        ? recruits
            .map(
              (r) => `<div class="subform"><div class="row" style="justify-content:space-between">
        <strong>${esc(r.builder.display_name)}</strong>
        <button class="btn ghost recruit" data-id="${r.builder.id}">Recruit</button></div>
        <div class="muted" style="font-size:.82rem">Fills: ${r.fills.map(esc).join(", ")}</div></div>`
            )
            .join("")
        : '<p class="muted">This party already covers the candidate pool. Enlist more builders!</p>'
    }`);

  const toggle = document.getElementById("join-toggle");
  if (toggle)
    toggle.addEventListener("click", async () => {
      const action = inGuild ? "leave" : "join";
      await api(`/guilds/${id}/${action}`, { method: "POST", body: { builder_id: meId } });
      await refresh();
      toast(inGuild ? "Left the guild" : "Joined the guild!");
      openGuild(id);
    });

  drawerBody.querySelectorAll(".recruit").forEach((btn) =>
    btn.addEventListener("click", async () => {
      await api(`/guilds/${id}/join`, { method: "POST", body: { builder_id: Number(btn.dataset.id) } });
      await refresh();
      toast("Recruit added to the party!");
      openGuild(id);
    })
  );
}

async function foundGuildPrompt() {
  const name = prompt("Name your guild:");
  if (!name) return;
  const charter = prompt("Guild charter (one line):") || "";
  try {
    const g = await api("/guilds", {
      method: "POST",
      body: { name, charter, founder_id: Number(state.me) || undefined },
    });
    await refresh();
    renderGuilds();
    toast("Guild founded!");
    openGuild(g.id);
  } catch (e) {
    toast(e.message, true);
  }
}

// ---- enlist form -----------------------------------------------------------
function renderEnlist() {
  app.innerHTML = `
    <div class="section-head"><div><h2>Enlist</h2>
      <p>Create your character sheet. Be honest about your peaks — that's the whole point.</p></div></div>
    <form class="enlist" id="enlist-form">
      <div class="row" style="gap:.9rem">
        <label style="flex:1">Display name<input name="display_name" required placeholder="Ada Lovelace" /></label>
        <label style="flex:1">Handle<input name="handle" required placeholder="ada.bsky.social" /></label>
      </div>
      <div class="row" style="gap:.9rem">
        <label style="flex:1">Class / archetype<input name="klass" placeholder="Architect, Bard, Druid…" /></label>
        <label style="flex:1">Seeking<input name="seeking" placeholder="income, collaborators, both" /></label>
      </div>
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

      <button class="btn gold" type="submit">Join the Build Guild</button>
    </form>`;

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
  const addProject = () => {
    const div = document.createElement("div");
    div.className = "project-line";
    div.innerHTML = `
      <input class="p-name" placeholder="Project name" />
      <input class="p-desc" placeholder="What is it?" />
      <input class="p-help" placeholder="Where you'd welcome help" />
      <button type="button" class="btn ghost rm">Remove project</button>`;
    div.querySelector(".rm").addEventListener("click", () => div.remove());
    projectRows.appendChild(div);
  };
  document.getElementById("add-skill").addEventListener("click", () => addSkill());
  document.getElementById("add-project").addEventListener("click", addProject);
  addSkill("", 80);
  addSkill("", 60);

  document.getElementById("enlist-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = e.target;
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
      display_name: f.display_name.value,
      handle: f.handle.value,
      klass: f.klass.value,
      seeking: f.seeking.value,
      tagline: f.tagline.value,
      bio: f.bio.value,
      ai_augmented: f.ai_augmented.checked,
      skills,
      projects,
    };
    try {
      const b = await api("/builders", { method: "POST", body });
      await refresh();
      state.me = String(b.id);
      localStorage.setItem("bg_me", state.me);
      identitySel.value = state.me;
      toast(`Welcome, ${b.display_name}!`);
      tabs.forEach((x) => x.classList.toggle("active", x.dataset.view === "roster"));
      currentView = "roster";
      render();
    } catch (err) {
      toast(err.message, true);
    }
  });
}

// ---- boot ------------------------------------------------------------------
refresh().then(render).catch((e) => {
  app.innerHTML = `<p class="empty">Couldn't reach the guild hall: ${esc(e.message)}</p>`;
});
