-- 0012 fn_open_position now accepts p_opened_at (engine-authoritative open time, deterministic recovery)

drop function if exists public.fn_open_position(uuid,bigint,text,numeric,int,bigint,bigint);

create or replace function public.fn_open_position(
  p_user uuid, p_stake bigint, p_direction text, p_entry_rate numeric,
  p_duration_s int, p_game_day bigint, p_nonce bigint, p_opened_at timestamptz
) returns table(position_id uuid, new_balance bigint)
language plpgsql security definer set search_path = public
as $fn$
declare v_bal bigint; v_id uuid;
begin
  if p_stake <= 0 then raise exception 'INVALID_STAKE'; end if;
  if p_direction not in ('buy','sell') then raise exception 'INVALID_DIRECTION'; end if;
  select real_balance into v_bal from wallets where user_id = p_user for update;
  if not found then raise exception 'WALLET_NOT_FOUND'; end if;
  if v_bal < p_stake then raise exception 'INSUFFICIENT_FUNDS'; end if;
  update wallets set real_balance = real_balance - p_stake where user_id = p_user
    returning real_balance into v_bal;
  v_id := gen_random_uuid();
  insert into positions(id, user_id, game_day_id, direction, stake, entry_rate, duration_s, status, nonce, opened_at)
    values (v_id, p_user, p_game_day, p_direction, p_stake, p_entry_rate, p_duration_s, 'open', p_nonce, p_opened_at);
  insert into ledger_entries(user_id, type, amount, balance_kind, ref_table, ref_id)
    values (p_user, 'stake', -p_stake, 'real', 'positions', v_id::text);
  return query select v_id, v_bal;
end;
$fn$;

do $g$
begin
  revoke all on function public.fn_open_position(uuid,bigint,text,numeric,int,bigint,bigint,timestamptz) from public;
  grant execute on function public.fn_open_position(uuid,bigint,text,numeric,int,bigint,bigint,timestamptz) to service_role;
end
$g$;
