# 16 — MVP Roadmap & Acceptance Criteria

> ## ⚠️ Read this first — actual build status & numbering
> Milestones were **not** built strictly in numeric order. The current real state of `main` is:
>
> | Milestone | Title | Status |
> |---|---|---|
> | M0 | Foundations | ✅ done |
> | M1 | Auth & wallet | ✅ done (phone + **password**, not OTP — see [06](06-auth-kyc.md)) |
> | M2 | Payments | ✅ done |
> | M3 | Game engine | ✅ done |
> | **M4** | **Player web app (front-end)** | ⬜ **NOT built — deferred; THIS IS THE CURRENT FOCUS** |
> | M5 | Affiliate | ✅ done (API/engine) |
> | M6 | Admin back office | ✅ done (API — see doc 05 §9 "J-series") |
> | M7 | Hardening & compliance | ⬜ pending |
>
> **What this means:** there is a complete back end + admin API but **no player front-end yet**
> (`apps/` has only `api` and `engine`; there is no `apps/web`). M7 (hardening) cannot be
> meaningfully completed until the player app (M4) exists, because half of M7 — responsible-gaming
> UX, legal/licence copy, the play-loop security review — lives in that app.
>
> **→ The active work is building the player web app.** Its detailed, phase-by-phase, mobile-first
> implementation plan is **[17 — Frontend Build Plan](17-frontend-build-plan.md) (phases FE0–FE7)**.
> Use the `FE0–FE7` labels for front-end work to avoid clashing with these M-numbers.

## Milestones
### M0 — Foundations — ✅ done
- Monorepo, CI, Supabase project, schema + RLS migrations, seed (`game_config`, super-admin).
- **Done when:** migrations apply cleanly; super-admin can log in to admin shell.

### M1 — Auth & wallet — ✅ done
- Phone + **password** signup/login (self-managed, scrypt + self-issued HS256 JWT, **no OTP** — see
  [06 — Auth & KYC](06-auth-kyc.md)), basic KYC (name + DOB age-gate), wallet + immutable ledger.
- **Done when:** a user signs up, has a 0/0 wallet, age-gate blocks <18.

### M2 — Payments — ✅ done
- M-Pesa STK deposits (sandbox) crediting real_balance; withdrawals with admin approval + B2C + reversal.
- **Done when:** deposit reflects after callback; withdrawal debits, approval pays, rejection reverses.

### M3 — Game engine — ✅ done
- Authoritative smooth green-biased curve over WS; open BUY/SELL; live P&L; manual + auto sell;
  ×5 cap; RTP calibrated to 75% edge; provably-fair seed commit/reveal.
- **Done when:** Monte-Carlo test shows realised RTP ≈ 25% (±tolerance); settlement is atomic/idempotent.

### M4 — Player web app — ⬜ NOT built (current focus)
- Full screen per [Frontend Spec](13-frontend-spec.md): curve, bet panel, wallet, history, activity, chat.
- **Was deferred** while M5/M6 (affiliate + admin) were built; it is now the active milestone.
- **Build it via [17 — Frontend Build Plan](17-frontend-build-plan.md)** (phases FE0–FE7, mobile-first).
- **Done when:** end-to-end play loop works against the engine.

### M5 — Affiliate — ✅ done (API/engine)
- Enroll, referral links/attribution, 20% rev-share accrual, marketer dashboard, payout requests.
- **Done when:** a referred player's net loss accrues correct commission; payout flows to admin.

### M6 — Admin back office — ✅ done (API; see doc 05 §9)
- User mgmt, withdrawal queue, manual adjustments, game config, reports, affiliate mgmt, bonuses,
  activity simulator, chat moderation, audit log.
- **Done when:** all access-matrix actions work and are audited.

### M7 — Hardening & compliance — ⬜ pending (blocked on M4)
- Rate limits, fraud controls, responsible-gaming limits, reconciliation jobs, monitoring,
  legal/licence review of copy & flows.
- **Note:** the player-facing parts (responsible-gaming UX, licence copy, play-loop review) require
  the M4 app to exist — see FE7 in [17](17-frontend-build-plan.md).
- **Done when:** security checklist + reconciliation + responsible-gaming features pass review.

## Cross-cutting acceptance criteria
- No client can alter an outcome or balance; all money paths atomic, idempotent, audited.
- Realised RTP tracked vs 25% target with alerting.
- Every admin action and money movement appears in `audit_log`.
- All player tables protected by RLS; secrets never in repo.

## Actual build sequence (corrected)
Planned: `M0 → (M1 ∥ schema) → M2 ∥ M3 → M4 → M5 ∥ M6 → M7`.

**What actually happened:** `M0 → M1 → M2 → M3 → M5 → M6` (back end + admin API), with **M4 (player
web app) skipped**. Remaining: **M4 now (front-end, FE0–FE7 in doc 17) → M7 (hardening)**.


### M4 update — trade-screen design replica (FE8)
The player trade screen was reskinned to a supplied "High Trade"-style mobile
reference (layout & visual only; branding stays **Invest254**). Chat was dropped
from the trade view in favour of a single-line activity ticker, and a decorative
asset ticker was added. Bug fixes: duplicate activity, missing BUY/SELL buttons,
and live tick connectivity. Details: [17 — Frontend Build Plan](17-frontend-build-plan.md) §13 (FE8).
