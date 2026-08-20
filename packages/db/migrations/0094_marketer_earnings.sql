-- 0094_marketer_earnings.sql
-- Comprehensive per-(marketer, site) earnings for the platform (superadmin) console.
--
-- The existing fn_platform_marketer_rollup (0053) gives clients/GGR/commission but (a) does NOT
-- scope its commission/referral aggregates by site and (b) omits rate, identity, deposits, payouts,
-- expenses and the resulting balance due. This adds an ADDITIVE, non-breaking function that returns
-- a full earnings row per affiliate (one marketer per site, per the current model), every aggregate
-- correctly scoped to that affiliate's site. The old rollup is left untouched for its consumers.
--
-- Money is integer cents (KES). Gated to platform_superadmin; service-role execute only.

create or replace function public.fn_platform_marketer_earnings(p_actor_role text)
returns table(
  marketer_global_id uuid,
  label              text,
  affiliate_user_id  uuid,
  username           text,
  phone              text,
  site_id            uuid,
  site_slug          text,
  site_name          text,
  site_status        text,
  affiliate_status   text,
  commission_rate    numeric,
  total_clients      bigint,
  active_clients     bigint,
  deposits_cents     bigint,
  ggr_cents          bigint,
  commission_cents   bigint,   -- accrued (lifetime) commission
  paid_cents         bigint,   -- commission_payouts in status 'paid'
  pending_cents      bigint,   -- commission_payouts in status 'requested'/'approved'
  expenses_cents     bigint,   -- logged marketer expenses
  balance_due_cents  bigint,   -- commission - paid - pending - expenses
  first_referral_at  timestamptz,
  last_commission_period date
)
language plpgsql security definer set search_path = public
as $fn$
declare
  v_default constant uuid := '00000000-0000-0000-0000-000000000001';
begin
  if p_actor_role <> 'platform_superadmin' then raise exception 'NOT_AUTHORIZED'; end if;

  return query
    select
      a.marketer_global_id,
      mg.label,
      a.user_id,
      p.username,
      p.phone,
      s.id, s.slug, s.name, s.status,
      a.status,
      a.commission_rate,
      coalesce(rc.total, 0)::bigint,
      coalesce(rc.active, 0)::bigint,
      coalesce(dep.deposits, 0)::bigint,
      coalesce(cc.ggr, 0)::bigint,
      coalesce(cc.commission, 0)::bigint,
      coalesce(pay.paid, 0)::bigint,
      coalesce(pay.pending, 0)::bigint,
      coalesce(exp.spent, 0)::bigint,
      (coalesce(cc.commission,0) - coalesce(pay.paid,0) - coalesce(pay.pending,0) - coalesce(exp.spent,0))::bigint,
      rc.first_at,
      cc.last_period
    from public.affiliates a
    left join public.marketer_globals mg on mg.id = a.marketer_global_id
    left join public.profiles p on p.id = a.user_id
    join public.sites s on s.id = coalesce(a.site_id, v_default)
    -- Referral counts (total + active), scoped to THIS affiliate's site, plus first referral time.
    left join lateral (
      select count(*)                                            as total,
             count(*) filter (where rp.status = 'active')        as active,
             min(r.created_at)                                   as first_at
        from public.referrals r
        left join public.profiles rp on rp.id = r.referred_user
       where r.affiliate_id = a.user_id
         and coalesce(r.site_id, v_default) = coalesce(a.site_id, v_default)
    ) rc on true
    -- Deposits made by this marketer's referred clients (successful only), same site.
    left join lateral (
      select coalesce(sum(t.amount), 0) as deposits
        from public.referrals r
        join public.transactions t on t.user_id = r.referred_user
       where r.affiliate_id = a.user_id
         and coalesce(r.site_id, v_default) = coalesce(a.site_id, v_default)
         and t.kind = 'deposit' and t.status = 'success'
         and coalesce(t.site_id, v_default) = coalesce(a.site_id, v_default)
    ) dep on true
    -- Accrued commission + GGR, scoped to this affiliate's site, plus latest commission period.
    left join lateral (
      select coalesce(sum(ac.ggr), 0)        as ggr,
             coalesce(sum(ac.commission), 0) as commission,
             max(ac.period)                  as last_period
        from public.affiliate_commissions ac
       where ac.affiliate_id = a.user_id
         and coalesce(ac.site_id, v_default) = coalesce(a.site_id, v_default)
    ) cc on true
    -- Payouts: 'paid' vs still-pending ('requested'/'approved'), scoped to this site.
    left join lateral (
      select coalesce(sum(amount_cents) filter (where status = 'paid'), 0)                        as paid,
             coalesce(sum(amount_cents) filter (where status in ('requested','approved')), 0)      as pending
        from public.commission_payouts cp
       where cp.beneficiary_user = a.user_id
         and coalesce(cp.site_id, v_default) = coalesce(a.site_id, v_default)
    ) pay on true
    -- Logged marketer expenses, scoped to this site.
    left join lateral (
      select coalesce(sum(amount_cents), 0) as spent
        from public.marketer_expenses me
       where me.marketer_user_id = a.user_id
         and coalesce(me.site_id, v_default) = coalesce(a.site_id, v_default)
    ) exp on true
    order by a.marketer_global_id nulls last, s.created_at asc, a.user_id asc;
end;
$fn$;

-- Grants: service-role only (the engine holds the connection); never anon/authenticated.
do $g$
begin
  revoke all on function public.fn_platform_marketer_earnings(text) from public, anon, authenticated;
  grant execute on function public.fn_platform_marketer_earnings(text) to service_role;
end
$g$;
