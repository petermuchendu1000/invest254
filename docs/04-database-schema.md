# 04 — Database Schema (Supabase / Postgres)

All tables live in `public` unless noted. Money stored as **BIGINT cents (KES)** to avoid float
errors (e.g. KES 50.00 = `5000`). Every table has `created_at timestamptz default now()`.
Row-Level Security (RLS) is ON for all player-facing tables.

## 1. Identity & roles
```sql
-- Mirrors auth.users (Supabase Auth owns phone+OTP identity)
create table profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  phone         text unique not null,
  username      text unique not null,
  full_name     text,
  date_of_birth date,                       -- age-gate ≥18
  role          text not null default 'player'
                check (role in ('player','marketer','support','finance_admin','super_admin')),
  status        text not null default 'active'
                check (status in ('active','suspended','banned')),
  kyc_status    text not null default 'basic'
                check (kyc_status in ('none','basic','full','rejected')),
  referred_by   uuid references profiles(id),   -- affiliate attribution
  created_at    timestamptz default now()
);
```

## 2. Wallet & ledger
```sql
create table wallets (
  user_id      uuid primary key references profiles(id) on delete cascade,
  real_balance bigint not null default 0,   -- withdrawable, cents
  bonus_balance bigint not null default 0,   -- restricted, cents
  currency     text not null default 'KES',
  updated_at   timestamptz default now()
);

-- Immutable double-entry ledger (source of truth for money)
create table ledger_entries (
  id          bigserial primary key,
  user_id     uuid not null references profiles(id),
  type        text not null check (type in
              ('deposit','withdrawal','stake','payout','bonus','affiliate_commission',
               'adjustment','refund','withdrawal_reversal')),
  amount      bigint not null,              -- signed cents (+credit / -debit)
  balance_kind text not null default 'real' check (balance_kind in ('real','bonus')),
  ref_table   text,                          -- e.g. 'positions','transactions'
  ref_id      text,
  meta        jsonb default '{}',
  created_at  timestamptz default now()
);
create index on ledger_entries(user_id, created_at);
```

## 3. Game
```sql
create table game_config (
  id                 int primary key default 1 check (id = 1), -- singleton
  house_edge         numeric not null default 0.75,
  max_multiplier     numeric not null default 5.0,
  min_stake          bigint  not null default 25000,  -- KES 250.00
  max_stake          bigint  not null default 5000000,
  default_duration_s int     not null default 10,
  tick_rate_ms       int     not null default 150,
  drift_bias         numeric not null default 0.02,
  volatility         numeric not null default 1.0,
  updated_by         uuid references profiles(id),
  updated_at         timestamptz default now()
);

create table game_days (              -- provably-fair seed rotation
  id               bigserial primary key,
  trade_date       date not null unique,
  server_seed      text,              -- null until revealed
  server_seed_hash text not null,     -- published in advance
  revealed_at      timestamptz
);

create table positions (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references profiles(id),
  game_day_id   bigint references game_days(id),
  direction     text not null check (direction in ('buy','sell')),
  stake         bigint not null,        -- cents
  entry_rate    numeric not null,
  exit_rate     numeric,
  multiplier    numeric,                -- final, 1.0–5.0
  payout        bigint,                 -- cents
  pnl           bigint,                 -- payout - stake
  result        text check (result in ('win','loss','void')),
  duration_s    int not null,
  status        text not null default 'open' check (status in ('open','settled','void')),
  nonce         bigint not null,
  opened_at     timestamptz default now(),
  settled_at    timestamptz
);
create index on positions(user_id, opened_at);
create index on positions(status);
```

## 4. Payments
```sql
create table transactions (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references profiles(id),
  kind          text not null check (kind in ('deposit','withdrawal')),
  amount        bigint not null,        -- cents
  status        text not null default 'pending'
                check (status in ('pending','processing','success','failed','reversed')),
  provider      text not null default 'mpesa',
  phone         text not null,
  -- M-Pesa specifics
  merchant_request_id text,
  checkout_request_id text,              -- STK push
  mpesa_receipt       text,
  conversation_id     text,              -- B2C
  result_code         int,
  result_desc         text,
  approved_by   uuid references profiles(id),   -- withdrawals
  raw_callback  jsonb,
  created_at    timestamptz default now(),
  updated_at    timestamptz default now()
);
create index on transactions(user_id, created_at);
create index on transactions(checkout_request_id);
```

## 5. Affiliate
```sql
create table affiliates (
  user_id        uuid primary key references profiles(id),
  referral_code  text unique not null,
  commission_rate numeric not null default 0.20,   -- 20%
  status         text not null default 'active' check (status in ('active','suspended')),
  created_at     timestamptz default now()
);

create table referrals (
  id            bigserial primary key,
  affiliate_id  uuid not null references affiliates(user_id),
  referred_user uuid not null unique references profiles(id),
  created_at    timestamptz default now()
);

create table affiliate_commissions (
  id            bigserial primary key,
  affiliate_id  uuid not null references affiliates(user_id),
  referred_user uuid not null references profiles(id),
  period        date not null,            -- daily aggregation bucket
  ggr           bigint not null,          -- referred player's net loss (cents)
  commission    bigint not null,          -- ggr * rate (cents)
  status        text not null default 'accrued'
                check (status in ('accrued','paid','reversed')),
  created_at    timestamptz default now(),
  payout_id     uuid references affiliate_payouts(id)  -- 0019: reservation link (NULL = available)
);

create table affiliate_payouts (
  id              uuid primary key default gen_random_uuid(),
  affiliate_id    uuid not null references affiliates(user_id),
  amount          bigint not null,
  status          text not null default 'requested'
                  check (status in ('requested','approved','paid','rejected')),
  approved_by     uuid references profiles(id),
  created_at      timestamptz default now(),
  -- 0019: M-Pesa B2C audit (set as the payout moves approved -> paid/rejected)
  paid_at         timestamptz,
  conversation_id text,
  mpesa_receipt   text,
  result_code     int,
  result_desc     text,
  raw_callback    jsonb
);
```

## 6. Engagement
```sql
create table activity_feed (
  id         bigserial primary key,
  kind       text not null check (kind in ('withdrawal','win','bonus','signup')),
  username   text not null,
  amount     bigint,
  is_simulated boolean not null default false,
  message    text not null,
  created_at timestamptz default now()
);

create table chat_messages (
  id         bigserial primary key,
  user_id    uuid references profiles(id),
  username   text not null,
  message    text not null,
  is_hidden  boolean default false,
  created_at timestamptz default now()
);

create table bonuses (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references profiles(id),
  code        text,
  type        text not null check (type in ('welcome','promo','manual')),
  amount      bigint not null,
  wagering_x  numeric not null default 1.0,    -- wagering requirement multiple
  wagered     bigint not null default 0,
  status      text not null default 'active' check (status in ('active','cleared','expired','void')),
  expires_at  timestamptz,
  created_at  timestamptz default now()
);

create table promo_codes (
  code        text primary key,
  type        text not null default 'deposit_match',
  value       numeric not null,        -- e.g. 1.0 = 100% match, or fixed cents
  max_amount  bigint,
  wagering_x  numeric not null default 1.0,
  uses_left   int,
  expires_at  timestamptz,
  active      boolean default true
);

create table audit_log (
  id         bigserial primary key,
  actor_id   uuid references profiles(id),
  action     text not null,
  entity     text,
  entity_id  text,
  before     jsonb,
  after      jsonb,
  created_at timestamptz default now()
);
```

## 7. RLS policy summary
- `profiles`, `wallets`, `positions`, `transactions`, `bonuses`: a user can `select` **only their own
  rows** (`auth.uid() = user_id`). Inserts/updates that move money are **service-role only** (engine/API).
- `activity_feed`, `chat_messages`: public `select`; `insert` via service role / authenticated with limits.
- Admin tables (`game_config`, `audit_log`, payouts approvals): accessible only to `support`,
  `finance_admin`, `super_admin` roles (enforced in API + RLS using `profiles.role`).
- The Game Engine & API use the **service role key** for atomic money operations (RLS bypass) inside
  transactional, idempotent functions only.
