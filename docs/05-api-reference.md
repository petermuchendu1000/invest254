# 05 — REST API Reference

Base: `/api/v1`. Auth: `Authorization: Bearer <supabase_jwt>` unless marked public.
All money fields are **cents (KES)**. Standard error: `{ "error": { "code", "message" } }`.

> **Legend:** ✅ = implemented and tested in `apps/api`. Unmarked rows are the planned
> surface (see [§9 Implementation status](#9-implementation-status)). `apps/api` is a
> dependency-free Node `http` service that binds the engine services (`PaymentService`,
> `ChatService`, repositories over the migration-0010–0014 RPCs) to REST. When no JWT
> verifier is configured the service runs in **DEV auth** mode, trusting `X-User-Id` /
> `X-User-Role` headers (never for production).

## 1. Auth & profile
| Method | Path | Auth | Body / notes |
|--------|------|------|--------------|
| POST | `/auth/register` | public | ✅ `{ phone, username, password, referral_code? }` → `{ token, userId, role }` (201); atomically creates profile+wallet+credentials. Optional `referral_code` attributes the account to an affiliate (first-touch & permanent; unknown/suspended code ignored, malformed → `INVALID_REFERRAL_CODE` 400) |
| POST | `/auth/login` | public | ✅ `{ phone, password }` → `{ token, userId, role }`; generic `INVALID_CREDENTIALS`, active-status gated |
| GET  | `/auth/me` | player | ✅ `{ userId, role, username, fullName, dateOfBirth, kycStatus, ageVerified }` |
| PATCH| `/auth/me` | player | ✅ `{ full_name, date_of_birth }` → basic KYC (age-gate ≥18; DOB immutable once set) |

## 2. Wallet & history
| Method | Path | Auth | Notes |
|--------|------|------|------|
| GET | `/wallet` | player | ✅ `{ real, bonus, currency }` |
| GET | `/wallet/ledger?limit&cursor` | player | ✅ cursor-paginated ledger → `{ items, nextCursor }` (newest-first) |
| GET | `/positions?status&limit&cursor` | player | ✅ bet history (optional `status` filter) → `{ items, nextCursor }` |
| GET | `/positions/:id` | player | ✅ single owned position incl. fairness (`:id` must be a UUID; 404 if not found/owned) |

## 3. Payments (M-Pesa)
| Method | Path | Auth | Notes |
|--------|------|------|------|
| POST | `/deposits` | player | ✅ `{ amount, phone }` → STK push; returns `{ transactionId, checkoutRequestId }` (202) |
| POST | `/deposits/mpesa/callback` | public (Daraja IP-allowlisted) | ✅ STK result callback; acks `{ ResultCode: 0, ResultDesc: "Accepted" }` |
| POST | `/withdrawals` | player | ✅ `{ amount, phone }` → HOLDs funds; returns `{ transactionId, newBalance }` (202) |
| POST | `/withdrawals/mpesa/result/:txId` | public (allowlisted) | ✅ B2C result callback. **`:txId` is in the path** — `fn_approve_withdrawal` does not persist `conversation_id`, so the per-payout ResultURL carries the txId; acks like the STK callback |
| GET  | `/transactions?kind&status` | player | ✅ cursor-paginated deposit/withdrawal history → `{ items, nextCursor }` |

> **Age gate:** `/deposits` and opening a position require an age-verified adult (a stored
> `date_of_birth` ≥ 18 years). The check is enforced at the `SECURITY DEFINER` money RPCs
> (`fn_create_deposit` / `fn_open_position`, migration 0016) and is un-bypassable; unverified
> callers get `AGE_NOT_VERIFIED` (403). Complete basic KYC via `PATCH /auth/me` first.

> **Deviations from the original spec (implemented as above):** `/withdrawals` requires
> `phone` (no profile-MSISDN lookup yet), and the B2C result path is `…/result/:txId`
> rather than `…/result`. Both follow directly from the migration-0014 RPC contracts.

## 4. Game (REST companion to WS)
| Method | Path | Auth | Notes |
|--------|------|------|------|
| GET | `/health` | public | ✅ `{ status: "ok", time }` liveness probe |
| GET | `/game/config` | public | ✅ `{ currency, minStakeCents, maxStakeCents, maxMultiplier, defaultDurationS, tickRateMs, rtp, timeframesS }` |
| GET | `/game/ticks?from` | public | historical ticks for chart backfill |
| GET | `/game/fairness/:gameDayId` | public | ✅ commitment always; `serverSeed` only after rotation/reveal (leak-safe `v_fairness`) |
> Opening/selling positions happens over **WebSocket** (see [03](03-realtime-protocol.md)); a REST
> fallback `POST /game/positions` and `POST /game/positions/:id/sell` exists for resilience.

## 5. Affiliate
| Method | Path | Auth | Notes |
|--------|------|------|------|
| POST | `/affiliate/enroll` | player | ✅ become a marketer → `{ referralCode, commissionRate, status, role, referralPath }` (200); idempotent (stable code, returns the existing row on repeat) |
| GET  | `/affiliate/summary` | marketer | ✅ referral link, total/active(7/30d) referrals, turnover, GGR, commission accrued/paid, available |
| GET  | `/affiliate/referrals?cursor` | marketer | ✅ referred users (username, joinedAt, lifetime GGR); cursor-paginated |
| GET  | `/affiliate/commissions?cursor` | marketer | ✅ daily commission history (period, GGR, commission, status); cursor-paginated |
| POST | `/affiliate/payouts` | marketer | ✅ request payout of all available commission → `{ payoutId, amountCents }` (201). Reserves the covered accrued buckets (snapshot via `payout_id`); `NO_AVAILABLE_COMMISSION` (409) if nothing available, `PAYOUT_PENDING` (409) if one is already in flight |
| POST | `/admin/affiliate/payouts/:id/approve` | admin | ✅ requested → approved + dispatches M-Pesa **B2C** to the affiliate → `{ approved, conversationId? }`; idempotent (`approved:false` if not 'requested') |
| POST | `/admin/affiliate/payouts/:id/reject` | admin | ✅ requested → rejected (pre-dispatch), releases the reservation → `{ rejected }`; idempotent |
| POST | `/affiliate/payouts/mpesa/result/:payoutId` | public (allowlisted) | ✅ Daraja B2C result callback. `:payoutId` is in the path (the per-payout ResultURL). Success ⇒ payout `paid` + reserved buckets accrued→paid; failure ⇒ `rejected` + reservation released. Acks like the STK/withdrawal callbacks |

## 6. Engagement
| Method | Path | Auth | Notes |
|--------|------|------|------|
| GET | `/activity?limit` | public | ✅ live activity feed (newest first; `limit` ≤ 100, default 30) |
| GET | `/chat` | player | ✅ recent chat (server `recentLimit`) |
| POST | `/chat` | player | ✅ `{ message }` → 201 `{ message, reasons }`; rate-limited (429), sanitized/profanity-filtered (422 on reject); handle is server-resolved |
| POST | `/promo/redeem` | player | `{ code }` |

## 7. Admin (`/admin/*`, role-gated)
| Method | Path | Min role | Notes |
|--------|------|----------|------|
| GET | `/admin/users?q&status&role` | support | search/list users |
| GET | `/admin/users/:id` | support | full profile, wallet, history |
| GET | `/admin/users/:id/activity` | support | merged deposit/withdrawal/bet timeline (`?kind=`, keyset-paginated) |
| PATCH | `/admin/users/:id` | super_admin | edit role/status |
| POST | `/admin/users/:id/suspend` `/ban` | support | moderation |
| POST | `/admin/wallets/:id/adjust` | finance_admin | `{ amount, reason }` manual credit/debit (audited) |
| GET | `/admin/withdrawals?status` | finance_admin | queue |
| POST | `/admin/withdrawals/:id/approve` `/reject` | finance_admin | ✅ triggers B2C / reversal |
| GET | `/admin/game/config` · PUT same | super_admin | edit house_edge, max_mult, etc. |
| GET | `/admin/reports/revenue?from&to` | finance_admin | GGR, deposits, withdrawals, RTP |
| GET | `/admin/affiliates` · `/admin/affiliates/:id` | finance_admin | manage marketers |
| POST | `/admin/affiliate-payouts/:id/approve` `/reject` | finance_admin | pay commissions |
| GET/POST | `/admin/promos` | super_admin | manage promo codes |
| POST | `/admin/bonuses` | super_admin | issue manual bonus |
| GET | `/admin/activity/simulator` | super_admin | configure simulated feed |
| GET | `/admin/audit-log?actor&entity` | super_admin | audit trail |

## 8. Conventions
- Idempotency: deposits are idempotent by Daraja `CheckoutRequestID`; withdrawal results by
  transaction id (both enforced in the 0014 RPCs under `FOR UPDATE` + terminal-status guards).
  Other money-moving POSTs accept an `Idempotency-Key` header (planned).
- Pagination: cursor-based (`?cursor=&limit=`, max 100, default 30). List responses are
  `{ items, nextCursor }`, newest-first; pass `nextCursor` back as `cursor` for the next page
  (`nextCursor: null` ends the list). Cursors are opaque — do not parse them.
- Rate limits: chat 1/2s (per user, server-enforced); deposits 5/min. Register/login throttling
  is an edge concern; login is constant-time and returns a generic error (no user enumeration).
- Roles (hierarchical, higher satisfies lower): `player` < `marketer` < `admin` < `superadmin`.
  `admin` covers day-to-day operations; `superadmin` adds role management, game config, manual
  wallet adjustments, and the audit trail. A `marketer` is also a `player`.
- Error codes used by the implemented surface: `AUTH_REQUIRED`/`AUTH_INVALID`/`INVALID_CREDENTIALS` (401),
  `FORBIDDEN`/`ACCOUNT_SUSPENDED`/`ACCOUNT_BANNED`/`AGE_RESTRICTED`/`AGE_NOT_VERIFIED` (403),
  `NOT_FOUND`/`USER_NOT_FOUND` (404), `METHOD_NOT_ALLOWED` (405),
  `VALIDATION`/`BAD_JSON`/`INVALID_ID`/`INVALID_LIMIT`/`BAD_CALLBACK`/`INVALID_AMOUNT`/`BELOW_MIN`/
  `INVALID_PHONE`/`INVALID_DOB`/`INVALID_REFERRAL_CODE`/`PASSWORD_*`/`USERNAME_*`/`NAME_*`/`DOB_*` (400),
  `PHONE_TAKEN`/`USERNAME_TAKEN`/`REGISTRATION_CONFLICT`/`DOB_IMMUTABLE` (409),
  `RATE_LIMITED` (429), `REJECTED` (422), `INSUFFICIENT_FUNDS` (402), `PAYLOAD_TOO_LARGE` (413),
  `INTERNAL` (500). Daraja callbacks always ack `{ ResultCode: 0, ResultDesc: "Accepted" }`.

## 9. Implementation status
`apps/api` (Node `http`, default `PORT=8081`) currently ships:
- **Public (E1):** `/health`, `/game/config`, `/game/fairness/:gameDayId`, `/activity`.
- **Auth (G):** `/auth/register`, `/auth/login` (self-managed phone+password, no OTP; scrypt +
  self-issued HS256 JWT), `/auth/me` (GET profile+KYC, PATCH basic KYC). See
  [06 — Authentication & KYC](06-auth-kyc.md).
- **Age gate (H1):** real-money deposit/play requires an age-verified adult (≥18), enforced at
  the money RPCs (`fn_create_deposit` / `fn_open_position`, migration 0016).
- **Affiliate enroll + attribution (I1):** `POST /affiliate/enroll` (idempotent marketer
  enrollment + stable referral code) and first-touch, permanent referral attribution carried
  through `POST /auth/register` via optional `referral_code`. Both invariants live in the
  migration-0017 RPCs (`fn_affiliate_enroll`, extended `fn_register_user`). See
  [09 — Affiliate System](09-affiliate-system.md).
- **Affiliate commission accrual (I2):** `POST /admin/affiliate/accrue` (admin) runs the
  idempotent daily 20%-of-GGR revenue-share accrual (`fn_accrue_affiliate_commissions`, migration
  0018) into `affiliate_commissions`.
- **Marketer dashboard (I3):** `GET /affiliate/summary` (referral link, total/active referrals,
  turnover, GGR, commission accrued/paid, available), `GET /affiliate/referrals` and
  `GET /affiliate/commissions` (cursor-paginated) — marketer-gated, leak-safe aggregations over
  `affiliates`/`referrals`/`affiliate_commissions`/`positions`.
- **Affiliate payouts (I4):** `POST /affiliate/payouts` (marketer request),
  `POST /admin/affiliate/payouts/:id/approve|reject` (admin), and the public
  `POST /affiliate/payouts/mpesa/result/:payoutId` B2C callback. A payout reserves the covered
  accrued commission buckets via `affiliate_commissions.payout_id` (available = accrued AND
  `payout_id IS NULL`); approve dispatches M-Pesa B2C, the result marks the payout `paid`
  (buckets accrued→paid) or `rejected` (reservation released). Migration-0019 RPCs
  (`fn_affiliate_request_payout` / `_approve_payout` / `_complete_payout` / `_reject_payout`),
  all idempotent under `FOR UPDATE`.
- **Admin back office (J2):** admin-gated (superadmin satisfies admin). `GET /admin/overview`
  (KPIs: users by status/role, deposits/withdrawals, wallet liability, affiliate accrued/paid +
  pending payouts, settled turnover/GGR), `GET /admin/users?role&status&q` and `GET /admin/users/:id`
  (profile + wallet + turnover/GGR), `POST /admin/users/:id/{suspend|ban|reactivate}` and
  `PATCH /admin/affiliates/:id/rate` (guarded mutations via the migration-0021 RPCs
  `fn_admin_set_user_status` / `fn_admin_set_commission_rate` — admin acts on players, only
  superadmin acts on another admin, no self-action; both audited to `admin_actions`),
  `GET /admin/withdrawals?status` (queue read) and `GET /admin/audit` (audit trail). All lists
  cursor-paginated, newest-first.
- **Admin finance — adjustments + deposits monitor (J3):** admin-gated. `POST /admin/wallets/:id/adjust`
  (`{ amountCents | amount, direction?, reason }` — manual credit/debit of the real wallet via the
  migration-0022 RPC `fn_admin_adjust_balance`: mandatory reason, non-zero signed cents, no overdraw;
  writes a `ledger_entries` `adjustment` row and an audited `admin_actions` `balance.adjust` row),
  `GET /admin/deposits?status` (deposits monitor — STK statuses with `mpesaReceipt`/`checkoutRequestId`)
  and `GET /admin/deposits/reconcile?staleMinutes` (per-status totals + the non-terminal STK pushes
  older than the window — the reconcile-against-M-Pesa candidates).
- **Admin reports (J4):** admin-gated, read-only aggregates over `transactions` (successful cash) and
  settled `positions` (turnover/GGR) — no new schema. `GET /admin/reports/daily?from&to` (one row per
  calendar day: `depositsCents`, `withdrawalsCents`, `turnoverCents`, `ggrCents`; cash keyed by
  transaction date, game facts by the position's game-day trade date; oldest day first) and
  `GET /admin/reports/users?from&to` (the same metrics per user, ordered by GGR desc). `from`/`to` are
  inclusive `YYYY-MM-DD` bounds (validated). Add `format=csv` to either to download a CSV attachment
  (`text/csv`) instead of the JSON `{ items }` envelope.
- **Player + payments + admin (E2):** `/wallet`, `/chat` (GET/POST), `/deposits` +
  `/deposits/mpesa/callback`, `/withdrawals` + `/withdrawals/mpesa/result/:txId`,
  `/admin/withdrawals/:id/approve|reject`.
- **Player history (F):** `/wallet/ledger`, `/positions`, `/positions/:id`, `/transactions`
  (cursor-paginated, per-user isolated, backed by keyset reads over `ledger_entries` /
  `positions` ⋈ `v_fairness` / `transactions`).

Not yet implemented (no backing service, or owned elsewhere): full KYC (document upload),
`/game/ticks`, REST position open/sell, promos/bonuses, admin
report/CSV-export + game-config endpoints. Daraja IP allow-listing is an edge/infra concern, not
enforced in-app.
