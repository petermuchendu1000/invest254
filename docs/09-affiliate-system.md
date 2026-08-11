# 09 — Affiliate / Marketer System

Marketers are players who also **refer others and earn 20% revenue-share**. They can both play and earn.

## 1. Becoming a marketer ✅ (I1)
- Any player calls `POST /affiliate/enroll` → creates an `affiliates` row with a unique
  `referral_code` (and `commission_rate = 0.20`) and sets `profiles.role = 'marketer'`.
- They get a shareable link: `https://invest254.../r/<referral_code>`.
- **Implemented (I1):** enrollment is **idempotent** — repeat calls return the existing stable
  code and never re-mint or downgrade a privileged role. The code uses a Crockford-style
  alphabet (no `0/O/1/I/L`). Logic lives in the `fn_affiliate_enroll` RPC (service-role only,
  migration 0017); the API returns `{ referralCode, commissionRate, status, role, referralPath }`.

## 2. Attribution ✅ (I1)
- A new user arriving via `/r/<code>` carries the code through signup (`POST /auth/register` with
  an optional `referral_code` — auth is self-managed phone+password, no OTP). On account creation:
  `profiles.referred_by = affiliate_id` and a `referrals` row is inserted (one referral per user,
  **first-touch, permanent**).
- **Implemented (I1):** attribution is written **atomically inside `fn_register_user`** (migration
  0017), so it can never be lost or double-applied (`referrals.referred_user` is `UNIQUE`). Codes
  are matched case-insensitively; an **unknown or suspended** code is silently ignored so a stale
  link never blocks a signup, while a **malformed** code is rejected up front (`INVALID_REFERRAL_CODE`).
  Self-referral is structurally impossible (phone is unique, so a brand-new account can never be
  the referring affiliate).

## 3. Commission model — 20% revenue-share on net loss (GGR) ✅ (I2)
- **GGR (net loss)** of a referred player over a period = `Σ stakes − Σ payouts` (only positive
  contributes; winning days don't create negative commission for the affiliate — carried/zero-floored).
- **Commission** = `GGR × 0.20`, accrued **daily** into `affiliate_commissions` (`status='accrued'`).
- Worked example: referred player stakes KES 10,000 in a day, wins back KES 2,500 →
  GGR = 7,500 → affiliate earns `7,500 × 0.20 = KES 1,500`.
- Because RTP = 25%, expected GGR ≈ 75% of stakes, so affiliates earn ≈ **15% of referred turnover**
  on average — strong incentive.

> Alternative models (CPA, deposit-%, hybrid) are supported by the schema but **revenue-share is the
> configured MVP default**. Rate is per-affiliate editable by admin.

> **Implemented (I2):** accrual is the `fn_accrue_affiliate_commissions(period)` RPC (migration 0018),
> run once per trading day by an operator/cron via `POST /admin/affiliate/accrue` (finance_admin) or
> directly as `service_role`. It is idempotent (settled positions never change) and never re-touches
> a bucket already `paid`/`reversed`. GGR is keyed to `game_days.trade_date` (the authoritative
> trading day) and zero-floored per player-day. Commission is `floor(GGR × commission_rate)`.

## 4. Marketer dashboard (`/affiliate/*`) ✅ (I3, reads)
- Summary cards: referral link, total referrals, active players (played in last 7/30d), total turnover,
  total GGR, commission accrued, commission paid, available to withdraw.
- Tables: referrals list (joined date, status, lifetime GGR), daily commission history.
- Charts: signups over time, GGR over time.
- **Payouts:** see §5 below.

## 5. Payouts — request → approve → M-Pesa B2C result ✅ (I4)
A marketer claims their earned commission; a finance admin authorizes it; the money goes out over
M-Pesa **B2C** and the asynchronous result settles the books. This mirrors the withdrawal
hold→approve→B2C-result→complete/reverse pattern (migration 0014), adapted to commission buckets.

**Reservation model (the key idea).** Rather than recomputing "available" from a moving target, a
payout **snapshots the exact accrued buckets it covers** by stamping their
`affiliate_commissions.payout_id` at request time. So:
- `available = Σ commission WHERE status='accrued' AND payout_id IS NULL`
- `accrued` (dashboard) still counts *all* accrued buckets (reserved or not); a reserved bucket
  simply drops out of `available` while its payout is in flight.

This sidesteps any "which buckets get paid" ambiguity (e.g. backfilled accruals arriving between
request and result): the covered set is fixed at request time, and its sum **is** the payout amount.

**Lifecycle (all RPCs `SECURITY DEFINER`, service-role only, idempotent under `FOR UPDATE`):**
1. `POST /affiliate/payouts` (marketer) → `fn_affiliate_request_payout`. Sums the caller's
   unreserved accrued buckets, refuses if one is already in flight (`PAYOUT_PENDING`) or there's
   nothing to pay (`NO_AVAILABLE_COMMISSION`), inserts the `requested` payout for that exact amount,
   and reserves the covered buckets. Returns `{ payoutId, amountCents }`.
2. `POST /admin/affiliate/payouts/:id/approve` (finance_admin) → `fn_affiliate_approve_payout`.
   `requested → approved`, returns the amount + the marketer's phone; the service then dispatches
   the M-Pesa B2C payment. Re-approving a non-`requested` payout is a no-op.
3. `POST /affiliate/payouts/mpesa/result/:payoutId` (public, allowlisted) → `fn_affiliate_complete_payout`.
   `ResultCode 0` ⇒ payout `paid`, reserved buckets move `accrued → paid` (their sum equals the
   payout amount by construction). Non-zero ⇒ payout `rejected` and the reservation is **released**
   (buckets stay `accrued`, available again). Terminal payouts no-op. The payout row captures
   `paid_at`, `conversation_id`, `mpesa_receipt`, `result_code/desc`, and the raw callback.
4. `POST /admin/affiliate/payouts/:id/reject` (finance_admin) → `fn_affiliate_reject_payout`.
   Declines a **pre-dispatch** `requested` payout and releases its reservation.

**Schema (migration 0019):** `affiliate_payouts` gains `paid_at, conversation_id, mpesa_receipt,
result_code, result_desc, raw_callback`; `affiliate_commissions` gains the
`payout_id → affiliate_payouts(id)` reservation link (+ supporting indexes).

**Invariant:** exactly `amount` worth of commission moves `accrued → paid` on success, matching what
the marketer receives; on any failure/rejection the same amount returns to `available`.

## 6. Anti-fraud
- Self-referral blocked (can't refer your own phone/device).
- Commission accrues only on **real-balance** turnover (bonus-funded play excluded) to stop
  bonus-abuse farming.
- Multi-account/collusion detection flags clusters (shared device, M-Pesa number) for review.
- Reversals: if a referred deposit is charged back/reversed, related commission is `reversed`.

## 7. Admin controls
- View/search marketers, edit `commission_rate`, suspend abusive affiliates.
- Review & approve/reject affiliate payout requests; full audit trail (payout `result_code/desc`,
  `conversation_id`, `mpesa_receipt`, `paid_at`, raw B2C callback).
