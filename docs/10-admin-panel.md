# 10 — Admin Back Office

A separate Next.js app at `admin.invest254...`, REST-only, role-gated. Every mutating action is
written to `audit_log` (actor, before/after).

## 1. Modules
### 1.1 Dashboard
- KPIs: deposits, withdrawals, GGR, active users, online now, realised RTP vs target (75% edge),
  pending withdrawals, pending affiliate payouts.

### 1.2 User management
- Search/filter by phone, username, status, role, KYC.
- User detail: profile, wallet (real/bonus), positions history, transactions, bonuses, referrals.
- Actions: edit profile/role (super_admin), **suspend / ban / reactivate**, reset session,
  trigger KYC review.

### 1.3 Finance
- **Withdrawal queue:** approve (→ B2C) / reject (→ reverse hold). Shows KYC & risk flags.
- **Manual balance adjustment:** credit/debit with mandatory reason (finance_admin; audited).
- **Deposits monitor:** STK statuses, reconcile against M-Pesa.
- **Reports:** revenue (GGR), turnover, deposits/withdrawals, per-day, per-user, CSV export.

### 1.4 Game configuration (super_admin)
- Edit `house_edge` (default 0.75), `max_multiplier` (5.0), `min_stake` (50), `max_stake`,
  `default_duration_s` (10), `tick_rate_ms`, `drift_bias`, `volatility`.
- **RTP monitor:** realised vs target over rolling windows; alerts on drift.
- Provably-fair: view current `server_seed_hash`, force seed rotation, view revealed seeds.

### 1.5 Affiliates
- List/search marketers, edit commission rate, suspend.
- Approve/reject affiliate payout requests.

### 1.6 Engagement
- **Activity feed simulator:** configure simulated message templates, name pool, amount ranges,
  frequency (mixed with real events).
- **Chat moderation:** hide messages, mute/ban users, profanity list.

### 1.7 Bonuses & promos (super_admin)
- Create/expire promo codes (deposit-match / fixed), set wagering multiple & caps.
- Issue manual bonuses to users.

### 1.8 Audit log
- Full searchable trail of every admin action and money movement.

## 2. Access matrix
| Module | support | finance_admin | super_admin |
|--------|:---:|:---:|:---:|
| Dashboard (read) | ✓ | ✓ | ✓ |
| User mgmt view | ✓ | ✓ | ✓ |
| Suspend/ban | ✓ | ✓ | ✓ |
| Edit role/profile | — | — | ✓ |
| Withdrawal approve | — | ✓ | ✓ |
| Manual adjust | — | ✓ | ✓ |
| Game config | — | — | ✓ |
| Affiliate payouts | — | ✓ | ✓ |
| Promos/bonuses | — | — | ✓ |
| Audit log | — | view | ✓ |


## 3. Implementation status (J2–J4)

The REST surface in `apps/api` ships the first admin slice (admin-gated; superadmin satisfies admin):

| Endpoint | Module | Notes |
|----------|--------|-------|
| `GET /admin/overview` | 1.1 Dashboard | KPI aggregates (users, finance, affiliate, game). |
| `GET /admin/users` · `GET /admin/users/:id` | 1.2 User mgmt | search/filter (`role`,`status`,`q`); detail adds wallet + turnover/GGR. |
| `POST /admin/users/:id/{suspend\|ban\|reactivate}` | 1.2 User mgmt | `fn_admin_set_user_status` (0021); admin->players, superadmin->admins, no self-action; audited. |
| `PATCH /admin/affiliates/:id/rate` | 1.5 Affiliates | `fn_admin_set_commission_rate` (0021); 0..1; audited. |
| `GET /admin/withdrawals` | 1.3 Finance | withdrawal-queue read (`status` filter). |
| `POST /admin/wallets/:id/adjust` | 1.3 Finance | **J3** manual credit/debit; `fn_admin_adjust_balance` (0022); mandatory reason, no overdraw; ledger + audited. |
| `GET /admin/deposits` | 1.3 Finance | **J3** deposits monitor — STK statuses + receipt/checkout id (`status` filter). |
| `GET /admin/deposits/reconcile` | 1.3 Finance | **J3** reconcile read — per-status totals + stale non-terminal pushes (`staleMinutes`). |
| `GET /admin/reports/daily` | 1.6 Reports | **J4** per-day revenue/turnover/deposits/withdrawals (`from`,`to`); `format=csv` exports. |
| `GET /admin/reports/users` | 1.6 Reports | **J4** per-user revenue/turnover/deposits/withdrawals (`from`,`to`), GGR-ranked; `format=csv` exports. |
| `GET /admin/audit` | 1.8 Audit log | `admin_actions` trail, newest-first. |
| `GET /admin/game-config` | 1.4 Game config | **J5** current `game_config` singleton (+ derived `rtpTarget`). |
| `PATCH /admin/game-config` | 1.4 Game config | **J5** superadmin partial edit; `fn_admin_update_game_config` (0023); range-validated; audited. |
| `GET /admin/rtp` | 1.4 Game config | **J5** realised RTP vs target over 7d/30d/all-time rolling windows + drift `alert`. |
| `GET /admin/seeds` | 1.4 Game config | **J5** provably-fair days: commitment hash, seed version, reveal state. |
| `POST /admin/seeds/rotate` | 1.4 Game config | **J5** superadmin force seed rotation (today-or-future, unrevealed); `fn_admin_rotate_seed` (0023); audited. |
| `GET /admin/affiliate/payouts` | 1.5 Affiliates | **J6** payout approve/reject **queue** (`status` filter); decisions live at `…/payouts/:id/{approve,reject}` (I4, now audited). |
| `GET /admin/chat` | 1.6 Engagement | **J6** chat moderation list (`includeHidden`). |
| `POST /admin/chat/:id/{hide\|unhide}` | 1.6 Engagement | **J6** hide/restore a message; audited. |

Every mutation writes an immutable `admin_actions` row (actor, role, before/after). Still to come:
bonuses/promos (K1).

> **J5 game-config / seed-rotation runtime note.** Both the WS engine and the REST API load the
> game config statically at boot (`DEFAULT_CONFIG`) and the engine derives day seeds from the
> engine-only `MASTER_SEED`. A config edit / forced rotation is persisted and audited immediately;
> the engine applies a config change on its next boot and a forced rotation when it next *builds*
> that day's context (future days, or the current day after a restart) — it never re-seeds a day
> already live under open positions. A future hardening task can add a live config/seed reload
> signal to the engine.
