// ESCO concept lookup — anchors a skill to a stable external reference.
//
// ESCO (European Skills/Competences/Qualifications/Occupations) is EUPL-licensed
// linked open data with persistent URIs (http://data.europa.eu/esco/skill/<uuid>)
// — see issue #8. We surface candidates for the builder to confirm rather than
// auto-assigning the top hit, because ESCO's labour-market vocabulary mis-ranks
// many tech skills (e.g. "Rust" → "remove rust from motor vehicles").

const ESCO_API = "https://ec.europa.eu/esco/api";

/** Pure parse of an ESCO /search response → [{ uri, title }]. */
export function parseEscoResults(data, limit = 6) {
  const results = data?._embedded?.results || data?.results || [];
  const out = [];
  for (const r of results) {
    const uri = r?.uri || "";
    const title = r?.title || r?.preferredLabel?.["en-us"] || r?.preferredLabel?.en || "";
    if (uri.includes("/esco/skill/") && title) out.push({ uri, title });
    if (out.length >= limit) break;
  }
  return out;
}

/** Search ESCO skills for a free-text term. Returns [] for empty input. */
export async function escoSearch(term, limit = 6) {
  const q = String(term || "").trim();
  if (!q) return [];
  const url =
    `${ESCO_API}/search?language=en&type=skill&full=false&limit=${limit}` +
    `&text=${encodeURIComponent(q)}`;
  const res = await fetch(url, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`ESCO search failed: ${res.status}`);
  return parseEscoResults(await res.json(), limit);
}
