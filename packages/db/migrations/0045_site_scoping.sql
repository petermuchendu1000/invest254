-- 0045_site_scoping.sql — Thread `site_id` through every tenant-owned table.
--
-- Turns the single-tenant schema into a multi-tenant one. Every money/identity/affiliate
-- row gains a `site_id` foreign key to public.sites, backfilled to the DEFAULT site
-- (00000000-0000-0000-0000-000000000001) created in 0044 so existing Invest254 data becomes
-- "site #1" with zero loss. Uniqueness that used to be global becomes PER-SITE:
--   * profiles: unique(site_id, phone), unique(site_id, username)   ← a person on 2 brands = 2 accounts
--   * game_days: unique(site_id, trade_date)                        ← each brand its own fairness lineage
--
-- Design decisions locked for this template (see docs/20):
--   * player identity  = PER-SITE  (separate wallet per brand)
--   * marketer identity = PER-SITE (affiliate row is per brand; cross-brand rollups are reporting-only)
--
-- NOTE: This migration is the AUTHORITATIVE schema plan. Apply + verify against a fresh
-- Supabase project (see docs/22 conversion checklist). The money RPCs (fn_open_position,
-- fn_settle_position, fn_create_deposit, fn_register_user, fn_affiliate_*, admin fns) must be
-- extended to accept/stamp p_site_id — that RPC work is tracked task-by-task in docs/22.
--
-- Idempotent, single-statement DO block.

do $$
declare
  default_site constant uuid := '00000000-0000-0000-0000-000000000001';
  t text;
  tenant_tables text[] := array[
    'profiles','wallets','positions','transactions','ledger_entries','game_days',
    'affiliates','referrals','affiliate_commissions','affiliate_payouts',
    'user_overrides','bonuses','promo_codes','activity_feed','chat_messages',
    'audit_log','admin_actions','user_notifications'
  ];
begin
  -- ── 1. Add site_id (nullable first) to every tenant table that exists, backfill, enforce ──
  foreach t in array tenant_tables loop
    if to_regclass('public.' || t) is not null then
      execute format('alter table public.%I add column if not exists site_id uuid', t);
      execute format('update public.%I set site_id = %L where site_id is null', t, default_site);
      -- FK + not-null + default so future inserts are safe even before every RPC is updated.
      begin
        execute format('alter table public.%I add constraint %I foreign key (site_id) references public.sites(id)',
                       t, t || '_site_fk');
      exception when duplicate_object then null; end;
      execute format('alter table public.%I alter column site_id set default %L', t, default_site);
      execute format('alter table public.%I alter column site_id set not null', t);
      execute format('create index if not exists %I on public.%I(site_id)', 'idx_' || t || '_site', t);
    end if;
  end loop;

  -- ── 2. Per-site uniqueness on identity (drop old global uniques, add composite) ──────────
  alter table public.profiles drop constraint if exists profiles_phone_key;
  alter table public.profiles drop constraint if exists profiles_username_key;
  create unique index if not exists uq_profiles_site_phone    on public.profiles(site_id, phone);
  create unique index if not exists uq_profiles_site_username on public.profiles(site_id, username);

  -- ── 3. Per-site fairness lineage ─────────────────────────────────────────────────────────
  if to_regclass('public.game_days') is not null then
    alter table public.game_days drop constraint if exists game_days_trade_date_key;
    create unique index if not exists uq_game_days_site_date on public.game_days(site_id, trade_date);
  end if;

  -- referral_code stays GLOBALLY unique (a code resolves to exactly one site+marketer),
  -- so no change to affiliates.referral_code is needed.
end $$;
