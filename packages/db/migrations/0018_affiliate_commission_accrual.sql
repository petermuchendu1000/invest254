-- 0018 affiliate commission accrual (M5)
-- Daily revenue-share accrual: for each referred player, the affiliate earns
-- commission_rate * GGR, where GGR (gross gaming revenue / net loss) for a trading day is
--   greatest(0, SUM(stake - payout))  over that player's positions settled on that game-day.
-- Zero-floored per player-day (a player's winning day never creates negative commission). Tied
-- to the authoritative trading day (game_days.trade_date), not wall-clock, so it aligns with the
-- fairness/RTP day. Accrual is idempotent per (affiliate, referred_user, period): settled
-- positions never change, so re-running a day is stable, and it never overwrites a bucket that
-- has already been paid/reversed. SECURITY DEFINER, service-role only (operator/cron invoked).

create or replace function public.fn_accrue_affiliate_commissions(p_period date)
returns table(buckets integer, total_commission bigint)
language plpgsql security definer set search_path = public
as $fn$
declare v_buckets integer; v_total bigint;
begin
  with ggr as (
    select pr.referred_by as affiliate_id,
           p.user_id       as referred_user,
           greatest(0, sum(p.stake - p.payout))::bigint as ggr
      from positions p
      join profiles  pr on pr.id = p.user_id
      join game_days gd on gd.id = p.game_day_id
     where p.status = 'settled'
       and gd.trade_date = p_period
       and pr.referred_by is not null
     group by pr.referred_by, p.user_id
  ),
  upserted as (
    insert into affiliate_commissions (affiliate_id, referred_user, period, ggr, commission, status)
    select g.affiliate_id, g.referred_user, p_period, g.ggr,
           floor(g.ggr * a.commission_rate)::bigint, 'accrued'
      from ggr g
      join affiliates a on a.user_id = g.affiliate_id
     where g.ggr > 0
    on conflict (affiliate_id, referred_user, period) do update
      set ggr = excluded.ggr, commission = excluded.commission
      where affiliate_commissions.status = 'accrued'   -- never touch paid/reversed buckets
    returning commission
  )
  select count(*)::integer, coalesce(sum(commission), 0)::bigint into v_buckets, v_total from upserted;
  return query select v_buckets, v_total;
end;
$fn$;

revoke all on function public.fn_accrue_affiliate_commissions(date) from public;
revoke all on function public.fn_accrue_affiliate_commissions(date) from anon;
revoke all on function public.fn_accrue_affiliate_commissions(date) from authenticated;
grant execute on function public.fn_accrue_affiliate_commissions(date) to service_role;
