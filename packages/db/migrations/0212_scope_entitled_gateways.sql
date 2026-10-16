-- 0212_scope_entitled_gateways.sql — the entitled-gateway set for a PAYMENT SCOPE, so going live can
-- refuse a rail nobody routing through that scope owns.
--
-- WHY THIS EXISTS. `PaymentScopes.activate()` gated on readiness alone: at least one PLAYER_DEPOSIT_RAILS
-- gateway with a complete config (`depositsReady`). Entitlement was never consulted. But the read path
-- does consult it — listDepositProviders intersects the effective providers with
-- fn_site_entitled_gateways and, once a brand is on a NON-global scope, returns that intersection with
-- no M-Pesa fallback (the `if (!rails.length)` guard sits after the early return). So an operator could
-- configure a gateway, pass its connectivity probe, go live, and leave every brand on the scope with
-- ZERO deposit methods — the deposit sheet showing "Deposits are temporarily unavailable" with nothing
-- in any log to say why.
--
-- That is exactly what happened. Platform `mugo` owned no payment_gateway entitlement (see 0211), so
-- `dakafx` was entitled to `{mpesa}` while the only globally enabled rail was `megapay`. Its operator
-- configured Mega Pay, tested it green (twice), and activated the platform scope at 2026-10-16
-- 08:46:28. Readiness said yes, entitlement said no, and nothing asked entitlement. dakafx served its
-- first player "Deposits are temporarily unavailable" for 5h45m. `surewinfx` lost deposits the same way
-- in September.
--
-- WHAT THE SET IS. Every gateway ANY brand routing through this scope could surface — the union, not
-- the intersection, because one brand being able to deposit is enough to justify going live:
--   * 'mpesa'  — Daraja is free for every platform and brand (mirrors fn_site_entitled_gateways).
--   * a SITE scope      -> that one brand's entitlements (platform-inherited + brand-only).
--   * a PLATFORM scope  -> what the platform owns, plus anything granted to one of its brands alone,
--                          since that brand runs on these same accounts once the scope is active.
-- A platform with no brands yet therefore resolves to 'mpesa' + whatever the platform owns, so payments
-- can still be set up before the first brand exists.
--
-- Deliberately NOT a refusal on its own: this function only reports. activate() decides, and fails OPEN
-- if the lookup is unavailable, matching the read path it is protecting. An unknown p_scope_type yields
-- just {mpesa} rather than raising, because activate() already validated the scope by then and a bad
-- type must not be the thing that blocks a legitimate go-live.
--
-- Undo: drop function (activate()'s check then fails open and behaviour returns to readiness-only).

begin;

create or replace function public.fn_scope_entitled_gateways(p_scope_type text, p_scope_id uuid)
returns text[] language sql stable security definer set search_path = public as $fn$
  select array(
    select distinct k from (
      -- Daraja is free for every platform and brand.
      select 'mpesa' as k
      union
      -- SITE scope: that brand's own resolution (already unions platform + brand grants).
      select unnest(public.fn_site_entitled_gateways(p_scope_id))
       where p_scope_type = 'site'
      union
      -- PLATFORM scope: what the platform owns, inherited by all of its brands.
      select pe.key
        from public.platform_entitlements pe
       where p_scope_type = 'platform'
         and pe.platform_id = p_scope_id
         and pe.category = 'payment_gateway'
      union
      -- PLATFORM scope: a gateway granted to ONE of its brands still runs on these accounts.
      select be.key
        from public.brand_entitlements be
        join public.sites s on s.id = be.site_id
       where p_scope_type = 'platform'
         and s.platform_id = p_scope_id
         and be.category = 'payment_gateway'
    ) t);
$fn$;

-- 0151 / 0204 convention: Postgres grants EXECUTE to PUBLIC on every newly created function.
revoke all on function public.fn_scope_entitled_gateways(text, uuid) from public;
revoke all on function public.fn_scope_entitled_gateways(text, uuid) from anon;
revoke all on function public.fn_scope_entitled_gateways(text, uuid) from authenticated;
grant execute on function public.fn_scope_entitled_gateways(text, uuid) to service_role;

comment on function public.fn_scope_entitled_gateways(text, uuid) is
  'Deposit gateways any brand routing through a payment scope is entitled to (union; mpesa always). '
  'Read by PaymentScopes.activate() to refuse going live on a ready-but-unowned rail, which would '
  'leave every brand on the scope with no deposit method. See 0211 and docs/43.';

commit;
