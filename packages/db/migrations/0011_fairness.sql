-- 0011 daily seed rotation + provably-fair reveal (leak-safe; view is read-only to clients)

-- 0011a: remove the public SELECT policy that would leak unrevealed server_seed
do $m$
begin
  if exists (select 1 from pg_policies where schemaname='public' and tablename='game_days' and policyname='sel_public') then
    drop policy sel_public on public.game_days;
  end if;
end
$m$;

-- 0011b: public fairness view — hash always; server_seed only after reveal
create or replace view public.v_fairness with (security_invoker = false) as
select id, trade_date, server_seed_hash,
       case when revealed_at is not null then server_seed end as server_seed,
       revealed_at
from public.game_days;

-- 0011c: view is READ-ONLY for clients (revoke inherited write grants; grant select only)
revoke all on public.v_fairness from anon, authenticated;

grant select on public.v_fairness to anon, authenticated;

-- 0011d: idempotent game-day commit (stores hash; seed stays hidden until reveal)
create or replace function public.fn_ensure_game_day(p_date date, p_hash text)
returns bigint language plpgsql security definer set search_path = public
as $fn$
declare v_id bigint;
begin
  insert into game_days(trade_date, server_seed_hash) values (p_date, p_hash)
    on conflict (trade_date) do nothing;
  select id into v_id from game_days where trade_date = p_date;
  return v_id;
end;
$fn$;

create or replace function public.fn_reveal_game_day(p_date date, p_seed text)
returns boolean language plpgsql security definer set search_path = public, extensions
as $fn$
begin
  update game_days
     set server_seed = p_seed, revealed_at = now()
   where trade_date = p_date
     and revealed_at is null
     and p_date < current_date
     and server_seed_hash = encode(digest(p_seed, 'sha256'), 'hex');
  return found;
end;
$fn$;

do $g$
begin
  revoke all on function public.fn_ensure_game_day(date,text) from public;
  revoke all on function public.fn_reveal_game_day(date,text) from public;
  grant execute on function public.fn_ensure_game_day(date,text) to service_role;
  grant execute on function public.fn_reveal_game_day(date,text) to service_role;
end
$g$;
