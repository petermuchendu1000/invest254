-- 0010 atomic money + position RPCs (SECURITY DEFINER, service-role only)
-- fn_open_position: lock wallet, verify funds, debit stake, insert position+ledger (one txn)
-- fn_settle_position: idempotent settle, credit payout, write ledger (one txn)

create or replace function public.fn_open_position(
  p_user uuid, p_stake bigint, p_direction text, p_entry_rate numeric,
  p_duration_s int, p_game_day bigint, p_nonce bigint
) returns table(position_id uuid, new_balance bigint)
language plpgsql security definer set search_path = public
as $fn$
declare v_bal bigint; v_id uuid;
begin
  if p_stake <= 0 then raise exception 'INVALID_STAKE'; end if;
  if p_direction not in ('buy','sell') then raise exception 'INVALID_DIRECTION'; end if;
  -- atomic: lock the wallet row, verify funds, debit, record stake + position in one transaction
  select real_balance into v_bal from wallets where user_id = p_user for update;
  if not found then raise exception 'WALLET_NOT_FOUND'; end if;
  if v_bal < p_stake then raise exception 'INSUFFICIENT_FUNDS'; end if;
  update wallets set real_balance = real_balance - p_stake where user_id = p_user
    returning real_balance into v_bal;
  v_id := gen_random_uuid();
  -- NOTE: the committed outcome is intentionally NOT stored here, so a player cannot
  -- read their result (via RLS on positions) before the round resolves.
  insert into positions(id, user_id, game_day_id, direction, stake, entry_rate, duration_s, status, nonce)
    values (v_id, p_user, p_game_day, p_direction, p_stake, p_entry_rate, p_duration_s, 'open', p_nonce);
  insert into ledger_entries(user_id, type, amount, balance_kind, ref_table, ref_id)
    values (p_user, 'stake', -p_stake, 'real', 'positions', v_id::text);
  return query select v_id, v_bal;
end;
$fn$;

create or replace function public.fn_settle_position(
  p_position uuid, p_exit_rate numeric, p_result text, p_multiplier numeric, p_payout bigint
) returns table(settled boolean, new_balance bigint)
language plpgsql security definer set search_path = public
as $fn$
declare v_status text; v_user uuid; v_stake bigint; v_bal bigint;
begin
  if p_result not in ('win','loss','void') then raise exception 'INVALID_RESULT'; end if;
  if p_payout < 0 then raise exception 'INVALID_PAYOUT'; end if;
  -- atomic + idempotent: lock the position; if already settled, no-op return current balance
  select status, user_id, stake into v_status, v_user, v_stake
    from positions where id = p_position for update;
  if not found then raise exception 'POSITION_NOT_FOUND'; end if;
  if v_status <> 'open' then
    select real_balance into v_bal from wallets where user_id = v_user;
    return query select false, v_bal; return;
  end if;
  update positions set status='settled', exit_rate=p_exit_rate, result=p_result,
    multiplier = nullif(p_multiplier, 0), payout = p_payout, pnl = p_payout - v_stake, settled_at = now()
   where id = p_position;
  if p_payout > 0 then
    update wallets set real_balance = real_balance + p_payout where user_id = v_user
      returning real_balance into v_bal;
    insert into ledger_entries(user_id, type, amount, balance_kind, ref_table, ref_id)
      values (v_user, 'payout', p_payout, 'real', 'positions', p_position::text);
  else
    select real_balance into v_bal from wallets where user_id = v_user;
  end if;
  return query select true, v_bal;
end;
$fn$;

do $g$
begin
  revoke all on function public.fn_open_position(uuid,bigint,text,numeric,int,bigint,bigint) from public;
  revoke all on function public.fn_settle_position(uuid,numeric,text,numeric,bigint) from public;
  grant execute on function public.fn_open_position(uuid,bigint,text,numeric,int,bigint,bigint) to service_role;
  grant execute on function public.fn_settle_position(uuid,numeric,text,numeric,bigint) to service_role;
end
$g$;
