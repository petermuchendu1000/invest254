-- 0203_pool_default_daily_total.sql — every platform starts with a daily pool fund (KES 50,000).
--
-- Owner request (2026-10-13): "for those platforms missing the daily poolfund, set 50000 as default
-- — so, whenever a platform is created, it should have a poolfund of 50K until the platform admin
-- adjusts it."
--
-- WHY THIS MATTERS MORE THAN IT LOOKS. Real players are paid from the POOL (docs/25): `pool_mode` is
-- on for every brand, so the withdrawal pool is what actually funds a win. `pool_auto_settings`
-- holds each platform's daily total, and the column was nullable with no default. A platform whose
-- total is NULL has nothing to split, so the daily distributor
-- (scripts/pool_distribute_daily.mts -> PoolOps.runAuto) stops with exactly this message, which is
-- what was found in the live table:
--
--     "Nothing to split yet: no daily total is set and the brands have no budget.
--      Set a daily total to start."
--
-- Its brands then carry no budget at all, and a brand with no budget cannot pay a winner. Measured
-- on 2026-10-13: two of three platforms (MUGO, NDUATI) had never had a total set, so six live brands
-- — dakafx, fxhacks, paidpesa, peakpesa, shikafx, surewinfx — had no `withdrawal_pool` row for the
-- day. The symptom at the table was a real player who simply never won.
--
-- WHAT THIS DOES.
--   1. The column gains a DEFAULT of 5,000,000 cents (KES 50,000), so a row inserted without one
--      starts funded rather than dormant.
--   2. Every existing platform that has no settings row gets one.
--   3. A total that was never set by a human (`updated_by is null`) is filled in. A NULL an admin
--      chose deliberately is LEFT ALONE — this is a starting value, not a floor, and the request is
--      "until the platform admin adjusts it".
--   4. A trigger gives every platform created from now on its own settings row, so a new platform
--      can never be born dormant again. This is the part that stops the problem recurring; the
--      backfill only clears today's.
--
-- Money is BIGINT cents (KES) per the migrations README: KES 50,000 = 5,000,000.
-- Idempotent: safe to re-run.

alter table public.pool_auto_settings
  alter column daily_total_cents set default 5000000;

-- Every platform gets a settings row. `mode` and `lookback_days` keep their own column defaults
-- ('dynamic', 14), so a backfilled platform behaves exactly like one configured by hand.
insert into public.pool_auto_settings (platform_id)
  select p.id from public.platforms p
  where not exists (select 1 from public.pool_auto_settings s where s.platform_id = p.id)
  on conflict (platform_id) do nothing;

-- Fill a total nobody ever set. `updated_by is null` is what distinguishes "never configured" from
-- "an admin deliberately cleared it"; the second is their decision and is not overwritten.
update public.pool_auto_settings
   set daily_total_cents = 5000000, updated_at = now()
 where daily_total_cents is null
   and updated_by is null;

create or replace function public.fn_pool_auto_settings_seed()
returns trigger language plpgsql security definer set search_path = public
as $fn$
begin
  -- A new platform is funded from its first day. ON CONFLICT keeps this harmless if a caller has
  -- already written settings for the platform in the same transaction.
  insert into public.pool_auto_settings (platform_id)
    values (new.id)
    on conflict (platform_id) do nothing;
  return new;
end;
$fn$;

drop trigger if exists trg_platform_pool_defaults on public.platforms;
create trigger trg_platform_pool_defaults
  after insert on public.platforms
  for each row execute function public.fn_pool_auto_settings_seed();

do $g$
begin
  revoke all on function public.fn_pool_auto_settings_seed() from public, anon, authenticated;
end
$g$;
