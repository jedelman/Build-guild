# Scenarios — multi-user, end-to-end

Scenario-based design: instead of testing functions, we test **stories** — named actors with
goals, acting in sequence, observed at each beat. They run through the same pure engine the
Worker does (`deriveGuild`, `deriveAgreement`), so a passing scenario is a guarantee about the
*lived* product, not a unit. They exist to catch the **integration seams between actors** —
the class of gap unit tests glide past (the recruit-without-consent bug was exactly this).

Executable form: `test/scenarios.test.js`. Each test is one story; each `// Beat` is one
actor's signed action with its expected, observable outcome.

## How to write one
1. **Cast** — name the actors and give each a goal (a patron wants work done; a recruit is busy).
2. **Premise** — the guild's charter / starting state.
3. **Beats** — one actor action per beat, in causal order; assert what an observer sees after.
4. **Seam** — name the cross-actor seam the story guards, and include the *negative* beats
   (the thing that must NOT happen) — that's where bugs hide.

---

## Scenario A — "The open commons"
**Seam:** self-join ↔ consented invite ↔ quest agreement ↔ payment, across four actors.
**Cast:** Ada (Architect, founder) · Bjorn (Artificer) · Cass (invited) · Quill (patron).

1. Ada founds **Atlas Guild** on the open-commons default — she's the genesis cohort.
2. Bjorn finds the open guild and **self-joins**; no approval needed → member.
3. Ada **invites** Cass. The invite alone is *not* membership (pending).
4. Cass **co-signs** → now a member. The party is Ada, Bjorn, Cass.
5. Quill posts a quest; Ada claims it for the party `[Ada, Bjorn]` → `offered`, awaiting Bjorn + the patron.
6. Bjorn and Quill co-sign the terms → `agreed`.
7. Ada delivers; Quill pays the party directly and records the settlement → `fully-paid`, `paid == total`.

## Scenario B — "The curated council"
**Seam:** a closed charter's admission rules vs. the membership engine; sovereign leave.
**Cast:** Iris · Jad · Kira (founding council) · Nadia (applicant).

1. The founders adopt a **closed** charter: no open join, members can't admit directly, admission needs a 50% vote.
2. Nadia tries to **walk in** → refused (closed).
3. Iris tries to **wave her in** directly → a bare member can't admit; even with Nadia's acceptance, the unauthorized grant doesn't admit.
4. Iris opens an **admit vote**; Iris + Jad vote yes (2/3 ≥ 50%) → Nadia is in.
5. Nadia later **resigns** — her own revocation drops her, *though a vote (not a grant) admitted her*. Departure is sovereign. ← this beat surfaced a real engine gap (vote-admitted/genesis members couldn't unilaterally leave); now fixed.

## Scenario C — "Consent is not optional"
**Seam:** the regression for the bug that started this — recruiting must never auto-enroll.
**Cast:** Mara (eager recruiter) · Otto (member) · Theo (busy, never asked to join).

1. An open guild; Mara and Otto are members.
2. Mara **invites** Theo (who never asked) → not a member.
3. Mara invites **again**, and Otto **piles on** → still not a member. Consent is the gate, not the number of inviters.
4. Theo finally **co-signs** one invite → member.
5. Theo **leaves**; the dangling invites don't re-enroll him.

---

## Backlog (scenarios worth adding)
- **Amendment by vote:** a council amends its own charter (closed → open) and the new rule
  governs the next joiner — exercises the self-amending charter path.
- **Mandate + recall:** grant a scoped `admit` mandate, the holder admits someone, then the
  guild recalls the mandate — the admitted member stays, the power is gone.
- **Disputed delivery:** patron withholds settlement; witness corroborates; reputation
  reflects the unpaid/again-paid arc (pulls in `reputation` + contracts).
- **Patron delegation:** a patron authorizes an agent to accept on their behalf.
