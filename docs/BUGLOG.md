# Bug Log

Running log of bugs caught (new or pre-existing) while working through issues, with status. Each
entry: what, evidence, root cause, impact, and resolution.

---

## #1 — Bonus subsystem was dormant in the live money RPCs — FIXED (issue 1 / migration 0094)
- **What:** `bonus_balance` was frozen platform-wide — it could never be staked, wagered, or converted.
- **Evidence:** Live `fn_open_position` (10-arg) and `fn_settle_position` only moved `real`/`demo`
  balances; the `bonuses` table was empty across all 9 brands.
- **Root cause:** the original 0037 bonus mechanics were dropped when the RPCs were rewritten for
  site-scoping (0047) and demo isolation (0084). Deposit-bonus *granting* was also removed at 0077/0078.
- **Impact:** any credit to `bonus_balance` would have been permanently unusable and non-withdrawable.
- **Resolution:** migration 0094 restores bonus-first staking, wagering accrual, and FIFO conversion in
  the site-scoped/demo-aware RPCs (additive; verified no-op for existing zero-bonus accounts). See docs/31.

## #2 — DepositForm advertises a deposit bonus the backend no longer grants — OPEN (needs a decision)
- **What:** `apps/web/src/components/wallet/DepositForm.tsx` shows a live "+KES X bonus (50%/25%/15%)…
  credited instantly as bonus balance" preview on the deposit screen.
- **Evidence:** `bonusPctForDeposit` + the preview block render for any deposit ≥ KES 1,000, but the live
  `fn_complete_deposit` (0078) does **not** grant any deposit bonus (removed at 0077/0078); the `bonuses`
  table has zero `type='deposit'` rows in production.
- **Impact:** users are promised an instant deposit bonus they never receive — a trust/compliance risk.
- **Options:** (a) re-enable deposit-bonus granting in `fn_complete_deposit` (the 0094 wagering engine
  now supports it) — an economic change across all brands, needs sign-off; or (b) remove/hide the
  DepositForm bonus preview until (a) ships.
- **Status:** documented, NOT changed under issue 1 (out of scope — separate economic decision). Flagged
  for the next issue.

## #3 — Admin "day" finance report is timezone-fragile (fails 00:00–03:00 EAT) — OPEN (pre-existing)
- **What:** `app.admin.isolation.e2e.test.ts` → "finance reports (daily/day/users) are brand-scoped"
  fails: `day report: brand A only` expects 40000, gets 0.
- **Evidence:** Reproduced on a clean `main` (pre-existing; independent of issue 1). The test derives
  `today` via `Africa/Nairobi` (`toLocaleDateString('en-CA', { timeZone: 'Africa/Nairobi' })`) while the
  deposit rows are grouped by their stored (UTC) date. When the run happens in the window where the
  Nairobi calendar date is already ahead of UTC (00:00–03:00 EAT), the requested day and the stored day
  disagree and the report returns 0.
- **Impact:** the `/admin/reports/day` aggregation and/or the test are not timezone-consistent; the
  report can under-count near the UTC/EAT day boundary. Test is flaky by wall-clock (green during Nairobi
  daytime).
- **Status:** documented, NOT fixed under issue 1 (unrelated to the welcome bonus; changing day-report
  timezone handling on a live financial report warrants its own scoped fix + decision on the canonical
  reporting timezone).
