// Quest sizing + reward-split helpers. Payments are PEER-TO-PEER and off-platform:
// the protocol records co-signed settlements, it never moves money — so there's no
// escrow state machine or processing-fee math here anymore.

// Quests are capped at 5 days — a forcing function for incremental delivery.
export const MAX_QUEST_DAYS = 5;
export const MAX_QUEST_MS = MAX_QUEST_DAYS * 24 * 60 * 60 * 1000;
export const questDeadline = (createdAtMs) => createdAtMs + MAX_QUEST_MS;
export const withinQuestCap = (createdAtMs, closesAtMs) =>
  Number.isFinite(closesAtMs) && closesAtMs > createdAtMs && closesAtMs - createdAtMs <= MAX_QUEST_MS;

// Suggest an even split of a reward across a party (deterministic remainder) — for
// display only; the real split is whatever the parties agree and record.
export function splitAmounts(totalCents, party) {
  const n = party.length;
  if (n === 0) return [];
  const base = Math.floor(totalCents / n);
  let rem = totalCents - base * n;
  return party.map((did) => ({ did, cents: base + (rem-- > 0 ? 1 : 0) }));
}
