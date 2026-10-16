-- 0211_seed_entitlements_on_platform_insert.sql — every NEW platform gets the free default add-ons,
-- the PLATFORM analogue of 0148's trigger on `sites`.
--
-- THE GAP THIS CLOSES. 0172 moved add-on ownership up to the platform (brands inherit) and credited
-- existing ownership with a one-time `insert … select` over `brand_entitlements`. That backfill ran
-- once, on 2026-09-28 15:06:42. Nothing seeds a platform created afterwards, so such a platform
-- starts with ZERO `platform_entitlements` rows and stays that way — which is the very "the
-- grandfather backfill ran once" defect 0172 was written to fix, reproduced one level up. 0148 had
-- already learned this lesson for brands and installed a trigger; platforms never got one.
--
-- WHAT IT COST. Platform `mugo` (created 2026-10-09 16:09:45, 11 days after the backfill) had no
-- entitlement rows at all. Its brand `dakafx` therefore resolved to `{mpesa}` — the free union term
-- below — while the only globally enabled rail is `megapay`, so the intersection in
-- listDepositProviders was empty. On 2026-10-16 08:46:28 its operator activated the platform's own
-- payment scope, which moves a brand off `global` and past the `if (!rails.length)` fail-open in
-- paymentservice.ts, and `dakafx` served "Deposits are temporarily unavailable" to its first player
-- for 5h45m. `surewinfx` lost deposits the same way in September; that is what 0172 describes.
--
-- WHAT THIS DOES. An AFTER INSERT trigger on `platforms` seeds the `is_default` catalog entries
-- (chart/line, trade_ui/classic, payment_gateway/mpesa) for the new platform, whatever the creation
-- path, marked `grandfathered` because a free default is an endowment and never a purchase. The
-- billing trigger (`trg_billing_platform_addon_charge`, 0172) already returns early on both
-- `grandfathered` and `is_default`, so this can raise no `billing_charges` row. Idempotent
-- (`on conflict do nothing`), additive, and it revokes nothing from anyone.
--
-- HONEST LIMIT — READ BEFORE TRUSTING THIS TO PREVENT A REPEAT. Seeding the FREE defaults does not
-- by itself keep a new platform's brands depositing. `fn_site_entitled_gateways` already unions
-- 'mpesa' in unconditionally, so a platform holding only the defaults resolves exactly as `mugo`
-- did. A PURCHASED gateway (megapay / payhero / paynicorn / paystack / binance / stripe) is a
-- billing decision and is deliberately NOT seeded here; it is still granted per platform by
-- `fn_platform_addon_grant`. What this migration buys is that `platform_entitlements` is a complete,
-- explicit ownership record for every platform instead of silently empty for some, so the missing
-- purchased gateway is visible rather than inferred from an absent row.
--
-- THE REMAINING HOLE, NAMED SO IT IS NOT FORGOTTEN. `PaymentScopes.activate()` gates on
-- `depositsReady` only — it never consults entitlement — so an operator can configure, probe and go
-- live on a gateway their platform does not own, and the brand is left with no deposit rail at all.
-- That mismatch is what turned a missing row into an outage, and it is NOT fixed here (it changes a
-- money path and belongs in its own reviewed change). Two further notes for whoever picks that up:
-- `fn_platform_addon_grant` / `fn_platform_addon_revoke` have no API caller at all, so a superadmin
-- can only grant a platform gateway by hand in SQL; and only `category = 'payment_gateway'` is ever
-- read from this table today (by `fn_site_entitled_gateways`) — the chart and trade_ui rows seeded
-- here are inert, kept for parity with 0148 and as a truthful record.
--
-- Undo: drop the trigger, then the function. The seeded rows are free defaults and safe to leave.

begin;

create or replace function public.fn_seed_default_platform_entitlements() returns trigger
language plpgsql security definer set search_path = public as $fn$
begin
  insert into public.platform_entitlements(platform_id, category, key, grandfathered)
    select new.id, c.category, c.key, true
      from public.addon_catalog c
     where c.is_default
       -- platform_entitlements has a CHECK on category; a future catalog category that is default
       -- but not platform-ownable must not abort the INSERT that created the platform.
       and c.category in ('chart','trade_ui','payment_gateway')
    on conflict (platform_id, category, key) do nothing;
  return new;
end;
$fn$;

drop trigger if exists trg_seed_default_platform_entitlements on public.platforms;
create trigger trg_seed_default_platform_entitlements after insert on public.platforms
  for each row execute function public.fn_seed_default_platform_entitlements();

-- 0151 / 0204 convention: Postgres grants EXECUTE to PUBLIC on every newly created function, so each
-- migration revokes it again. A trigger function does not need EXECUTE to fire — the trigger runs as
-- the table owner — so revoking it cannot stop the seeding.
revoke all on function public.fn_seed_default_platform_entitlements() from public;
revoke all on function public.fn_seed_default_platform_entitlements() from anon;
revoke all on function public.fn_seed_default_platform_entitlements() from authenticated;

comment on function public.fn_seed_default_platform_entitlements() is
  'AFTER INSERT on platforms: seed the is_default addon_catalog entries as grandfathered '
  'platform_entitlements, so a platform created after 0172''s one-time backfill is never left with '
  'no ownership record. Free defaults only — a purchased gateway still needs fn_platform_addon_grant.';

-- Backfill every platform that predates this trigger, including any created after 0172's one-time
-- insert and therefore holding nothing at all. Free defaults only, grandfathered, so no platform
-- gains a paid add-on and no billing_charges row can be raised.
insert into public.platform_entitlements (platform_id, category, key, grandfathered)
  select pl.id, c.category, c.key, true
    from public.platforms pl
    cross join public.addon_catalog c
   where c.is_default
     and c.category in ('chart','trade_ui','payment_gateway')
on conflict (platform_id, category, key) do nothing;

commit;
