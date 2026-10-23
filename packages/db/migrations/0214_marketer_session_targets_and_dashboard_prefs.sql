-- 0214_marketer_session_targets_and_dashboard_prefs.sql
--
-- Two things a platform admin agrees with ONE marketer, and neither of them moves money.
--
-- 1. A SESSION TARGET — "5 live sessions, KES 1,500". 0191 built the sessions and said plainly that
--    per-session pay would be "a separate, deliberate change to the money path — not a side effect
--    of a reporting table". This is NOT that change either: the target is a COUNTER and a FIGURE the
--    marketer and the admin both read. Reaching 5/5 credits nothing, reserves nothing and writes to
--    no money table; payment goes through the payout/advance path that already exists and already
--    has an approval step. If automatic crediting is ever wanted, it is its own decision, with its
--    own guarded RPC — a balance must never move on a counter the beneficiary increments themselves
--    by pressing a button.
--
-- 2. DASHBOARD VISIBILITY — which blocks of /dashboard this marketer sees. A marketer paid a fixed
--    fee per session has no commission to read, and showing them one invites an argument about pay
--    they were never on. So the admin can hide it, and the target progress takes its place.
--
-- WHY PER MARKETER AND NOT PER BRAND. Both are the terms of an individual agreement: two marketers
-- on the same brand can be on entirely different deals. A brand-wide default would have to be
-- overridden per marketer in practice every time, so the override IS the model.
--
-- THE COUNTING RULE, AND WHY IT HAS A FLOOR. A session today costs nothing to create: `end()` is
-- `set ended_at = now()` with no duration check (livesessions.pg.ts), and production already holds a
-- ZERO-minute session. Counting raw presses would let a marketer tap Start/End five times in under a
-- minute and read "5/5 · KES 1,500". `qualify_minutes` is the floor that makes a session mean the
-- work it is meant to stand for. It is stored ON THE TARGET, not read from settings, so changing the
-- rule later cannot silently restate a target already in progress — the same reason 0191 copies
-- `margin_minutes` onto each session.
--
-- RESET. Starting a new target closes the open one; progress counts only sessions that ENDED at or
-- after the open target's `started_at`. There is no calendar period: the admin opens a cycle when
-- the agreement says so.
--
-- Money-neutral: no money table is referenced, and nothing here can affect a balance.
begin;

-- ── 1. The target a marketer is working against. ────────────────────────────────────────────────
create table if not exists public.marketer_session_targets (
  id              uuid primary key default gen_random_uuid(),
  site_id         uuid        not null references public.sites(id)    on delete cascade,
  -- The MARKETER-ROLE profile (profiles.id), exactly as marketer_live_sessions.marketer_id. NOT
  -- `marketers.id`: those are a different identity space entirely and share no ids with profiles.
  marketer_id     uuid        not null references public.profiles(id) on delete cascade,
  target_sessions int         not null check (target_sessions between 1 and 100),
  -- What the admin agreed to pay for completing the target, in KES cents. Display only.
  amount_cents    bigint      not null check (amount_cents >= 0),
  -- A session shorter than this does not count. See THE COUNTING RULE above.
  qualify_minutes int         not null default 30 check (qualify_minutes between 1 and 1440),
  started_at      timestamptz not null default now(),
  -- Null while this is the target in force. Set when the admin starts the next one, or closes it.
  closed_at       timestamptz,
  created_by      uuid references public.profiles(id) on delete set null,
  created_at      timestamptz not null default now()
);
alter table public.marketer_session_targets enable row level security;
grant select, insert, update on public.marketer_session_targets to service_role;

create index if not exists ix_session_targets_marketer
  on public.marketer_session_targets(site_id, marketer_id, started_at desc);

-- One OPEN target per marketer per brand. A partial unique index says it in the database rather than
-- trusting two concurrent "Start new target" presses to serialise themselves.
create unique index if not exists uq_session_target_open
  on public.marketer_session_targets(site_id, marketer_id)
  where closed_at is null;

comment on table public.marketer_session_targets is
  'An agreed "N live sessions for KES X" target. REPORTING ONLY: completing one credits nothing.';

-- ── 2. What this marketer sees on /dashboard. ───────────────────────────────────────────────────
-- Every switch defaults TRUE and a marketer with NO ROW sees everything, so this table changes
-- nothing for the marketers who already exist until an admin deliberately turns something off.
--
-- These are PRESENTATION, not access control. The endpoints behind them stay open and the data is
-- the marketer's own, so a hidden block is "we do not put this in front of you", never "you cannot
-- reach this". Anything that must be unreachable has to be gated server-side instead.
create table if not exists public.marketer_dashboard_prefs (
  site_id        uuid not null references public.sites(id)    on delete cascade,
  marketer_id    uuid not null references public.profiles(id) on delete cascade,
  -- The agreement switch: Available-to-withdraw + Request payout, the money tables, the per-deposit
  -- commission lines, and the running session's earned/deposit figures. Off = a marketer on a fixed
  -- per-session deal is not shown commission they are not paid on.
  show_earnings  boolean not null default true,
  show_live      boolean not null default true,   -- the Go live panel
  show_audience  boolean not null default true,   -- referrals / active / clicks
  show_advance   boolean not null default true,   -- the advance request form
  show_activity  boolean not null default true,   -- the Expenses / Referrals / Advances ledger tabs
  updated_at     timestamptz not null default now(),
  updated_by     uuid references public.profiles(id) on delete set null,
  primary key (site_id, marketer_id)
);
alter table public.marketer_dashboard_prefs enable row level security;
grant select, insert, update on public.marketer_dashboard_prefs to service_role;

comment on table public.marketer_dashboard_prefs is
  'Per-marketer /dashboard visibility. PRESENTATION ONLY — never an access control; no row = all on.';

commit;
