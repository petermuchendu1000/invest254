-- 0213_addon_platforms_view.sql — the PLATFORM add-on matrix, so platform grants have a back office.
--
-- WHY. 0172 made add-ons platform-owned (brands inherit) and shipped fn_platform_addon_grant /
-- fn_platform_addon_revoke to manage them. Neither has ever had an API caller: every other add-on
-- surface (/addons/*) is brand-level, so the ONLY way to grant a platform a gateway has been a
-- hand-written SQL statement against production. That is why platform `mugo` ran with no
-- payment_gateway entitlement at all until 2026-10-16 and `dakafx` could not take a deposit.
--
-- This is the read those two functions were missing — the platform analogue of 0166's fn_addon_brands:
-- one row per platform with what it owns, how many brands inherit it, and whether its own payment
-- accounts are live. Writes stay in 0172's grant/revoke (superadmin-only, audited); this only reports.
--
-- `live_rails` IS THE REVOKE SAFETY NET. It is the payment gateways a platform owns that are ALSO
-- switched on globally — i.e. what actually serves deposits for its brands today. Revoking the last
-- entry while `scope_active` is true recreates the dakafx outage deliberately: the brands move to an
-- intersection of nothing and the deposit sheet goes to "temporarily unavailable". The console shows
-- this set so the owner is warned before confirming. It is an APPROXIMATION on purpose — it reads
-- payment_providers.enabled_global and does not apply per-brand overrides (site_payment_providers),
-- because a platform row cannot speak for every brand under it; it is a warning, not a gate. The
-- authoritative per-brand answer stays fn_list_effective_providers ∩ fn_site_entitled_gateways.
--
-- SCOPE. platform_superadmin sees every platform; a platform_admin sees only its own (fn_user_platform),
-- so it can read what it owns and what is missing without being able to change it. Any other role gets
-- an empty array, exactly as fn_addon_brands does.
--
-- Undo: drop function.

begin;

create or replace function public.fn_addon_platforms(p_actor uuid, p_actor_role text)
returns jsonb language sql stable security definer set search_path = public as $fn$
  with scoped as (
    select pl.*
      from public.platforms pl
     where p_actor_role in ('platform_superadmin','platform_admin')
       and (p_actor_role = 'platform_superadmin' or pl.id = public.fn_user_platform(p_actor))
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'platform_id', pl.id, 'slug', pl.slug, 'name', pl.name, 'status', pl.status,
           'plan_key',        (select ps.plan_key       from public.platform_subscriptions ps where ps.platform_id = pl.id),
           'billing_exempt',  (select coalesce(ps.billing_exempt, false)
                                 from public.platform_subscriptions ps where ps.platform_id = pl.id),
           -- brands that inherit whatever this platform owns
           'sites', (select count(*) from public.sites s where s.platform_id = pl.id and s.status <> 'archived'),
           'owned', coalesce((select jsonb_agg(e.category || ':' || e.key order by e.category, e.key)
                                from public.platform_entitlements e where e.platform_id = pl.id), '[]'::jsonb),
           -- which of those were recognised as already-owned rather than purchased (0172)
           'grandfathered', coalesce((select jsonb_agg(e.category || ':' || e.key order by e.category, e.key)
                                        from public.platform_entitlements e
                                       where e.platform_id = pl.id and e.grandfathered), '[]'::jsonb),
           -- is the platform running on its OWN payment accounts? (0160 — decides whether a revoke bites)
           'scope_active', exists (select 1 from public.payment_scopes sc
                                    where sc.scope_type = 'platform' and sc.scope_id = pl.id and sc.active),
           -- owned AND globally switched on: what serves deposits today. See the header on why this is
           -- an approximation and a warning rather than a gate.
           'live_rails', coalesce((select jsonb_agg(distinct e.key order by e.key)
                                     from public.platform_entitlements e
                                     join public.payment_providers pp on pp.code = e.key
                                    where e.platform_id = pl.id
                                      and e.category = 'payment_gateway'
                                      and pp.enabled_global), '[]'::jsonb)
         ) order by pl.name), '[]'::jsonb)
  from scoped pl;
$fn$;

-- 0151 / 0204 convention: revoke the PUBLIC grant Postgres adds to every new function.
revoke all on function public.fn_addon_platforms(uuid, text) from public;
revoke all on function public.fn_addon_platforms(uuid, text) from anon;
revoke all on function public.fn_addon_platforms(uuid, text) from authenticated;
grant execute on function public.fn_addon_platforms(uuid, text) to service_role;

comment on function public.fn_addon_platforms(uuid, text) is
  'Platform add-on matrix: what each platform owns, how many brands inherit it, whether its own payment '
  'accounts are live, and which owned gateways are globally enabled (live_rails — the revoke warning). '
  'Superadmin sees all, a platform_admin only its own. Read-only; writes are 0172 grant/revoke.';

commit;
