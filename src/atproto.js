// atproto / Bluesky helpers.
//
// Two things live here:
//  1. fetchBlueskyProfile — read a public profile from the AppView (no auth).
//     Used to verify a handle is real and to prefill a builder's character
//     sheet (display name, avatar, bio). This is the foundation the OAuth /
//     PDS-storage work builds on later.
//  2. suggestSkillsFromProfile — a tiny heuristic to seed skill peaks from a
//     bio so a freshly-imported builder isn't a blank slate.

const APPVIEW = "https://public.api.bsky.app";

const stripAt = (h = "") => h.trim().replace(/^@+/, "").toLowerCase();

/**
 * Resolve a handle and return its public Bluesky profile.
 * @returns {Promise<null | {did, handle, display_name, avatar, bio}>}
 *   null when the handle doesn't resolve (treat as "unverified").
 */
export async function fetchBlueskyProfile(handle) {
  const actor = stripAt(handle);
  if (!actor) return null;
  const url = `${APPVIEW}/xrpc/app.bsky.actor.getProfile?actor=${encodeURIComponent(actor)}`;
  let res;
  try {
    res = await fetch(url, { headers: { accept: "application/json" } });
  } catch {
    return null; // network/DNS failure — caller decides whether to proceed unverified
  }
  if (!res.ok) return null;
  const p = await res.json().catch(() => null);
  if (!p || !p.did) return null;
  return {
    did: p.did,
    handle: p.handle || actor,
    display_name: p.displayName || p.handle || actor,
    avatar: p.avatar || "",
    bio: p.description || "",
  };
}

// Map bio keywords -> a canonical skill name. Keep it small and obvious;
// the user can edit everything afterwards.
const SKILL_HINTS = [
  [/\brust\b/i, "Rust"],
  [/\b(typescript|javascript|node|react|frontend|front-end)\b/i, "Frontend"],
  [/\b(python|pandas|numpy)\b/i, "Python"],
  [/\b(machine learning|\bml\b|deep learning|neural)\b/i, "Machine Learning"],
  [/\b(data|analytics|sql)\b/i, "Data Engineering"],
  [/\b(design|ux|ui|figma)\b/i, "Product Design"],
  [/\b(devops|kubernetes|docker|infra|sre)\b/i, "DevOps"],
  [/\b(security|infosec|appsec)\b/i, "Security"],
  [/\b(writing|writer|copy|content)\b/i, "Writing"],
  [/\b(community|growth|marketing)\b/i, "Community"],
];

/** Heuristic starter skills from a bio — peaks are deliberately modest defaults. */
export function suggestSkillsFromProfile(bio = "") {
  const out = [];
  const seen = new Set();
  for (const [re, name] of SKILL_HINTS) {
    if (re.test(bio) && !seen.has(name)) {
      seen.add(name);
      out.push({ name, peak: 65 });
    }
    if (out.length >= 5) break;
  }
  return out;
}
