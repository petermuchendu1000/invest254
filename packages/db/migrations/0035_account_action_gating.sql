-- 0035_account_action_gating.sql
--
-- Account status gates ACTIONS, not login. A limited account (status <> 'active',
-- i.e. suspended or banned) can still sign in and DEPOSIT, but must not be able to
-- open new trades or withdraw (cash out). This keeps deposits flowing while cutting
-- off risk exposure and cash-out for restricted accounts.
--
--   fn_open_position    -> reject non-active with ACCOUNT_NOT_ACTIVE (existing OPEN
--                          positions still settle; only OPENING is gated)
--   fn_create_withdrawal-> reject non-active with ACCOUNT_NOT_ACTIVE
--   fn_create_deposit   -> unchanged (deposits always allowed)
--
-- The login status gate in AuthService is removed in the same change, so a limited
-- account can authenticate to top up and view its balance.

CREATE OR REPLACE FUNCTION public.fn_open_position(p_user uuid, p_stake bigint, p_direction text, p_entry_rate numeric, p_duration_s integer, p_game_day bigint, p_nonce bigint, p_opened_at timestamp with time zone, p_config_version bigint)
 RETURNS TABLE(position_id uuid, new_balance bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_bal bigint; v_id uuid; v_min bigint; v_max bigint; v_status text;
begin
  -- Account-status gate: a limited/banned player cannot OPEN new trades (existing open
  -- positions still settle normally). Deposits remain allowed elsewhere.
  select status into v_status from profiles where id = p_user;
  if v_status is distinct from 'active' then raise exception 'ACCOUNT_NOT_ACTIVE'; end if;
  if p_stake <= 0 then raise exception 'INVALID_STAKE'; end if;
  if p_direction not in ('buy','sell') then raise exception 'INVALID_DIRECTION'; end if;
  select min_stake, max_stake into v_min, v_max from game_config where id = 1;
  if v_min is not null and p_stake < v_min then raise exception 'STAKE_BELOW_MIN'; end if;
  if v_max is not null and p_stake > v_max then raise exception 'STAKE_ABOVE_MAX'; end if;
  select real_balance into v_bal from wallets where user_id = p_user for update;
  if not found then raise exception 'WALLET_NOT_FOUND'; end if;
  if v_bal < p_stake then raise exception 'INSUFFICIENT_FUNDS'; end if;
  update wallets set real_balance = real_balance - p_stake where user_id = p_user
    returning real_balance into v_bal;
  v_id := gen_random_uuid();
  insert into positions(id, user_id, game_day_id, direction, stake, entry_rate, duration_s,
                        status, nonce, opened_at, config_version)
    values (v_id, p_user, p_game_day, p_direction, p_stake, p_entry_rate, p_duration_s,
            'open', p_nonce, p_opened_at, p_config_version);
  insert into ledger_entries(user_id, type, amount, balance_kind, ref_table, ref_id)
    values (p_user, 'stake', -p_stake, 'real', 'positions', v_id::text);
  return query select v_id, v_bal;
end;
$function$;

CREATE OR REPLACE FUNCTION public.fn_create_withdrawal(p_user uuid, p_amount bigint, p_phone text, p_min bigint)
 RETURNS TABLE(tx_id uuid, new_balance bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_bal bigint; v_id uuid; v_status text;
begin
  -- Account-status gate: a limited/banned player cannot WITHDRAW (cash out). Deposits stay open.
  select status into v_status from profiles where id = p_user;
  if v_status is distinct from 'active' then raise exception 'ACCOUNT_NOT_ACTIVE'; end if;
  if p_amount <= 0 then raise exception 'INVALID_AMOUNT'; end if;
  if p_amount < p_min then raise exception 'BELOW_MIN'; end if;
  select real_balance into v_bal from wallets where user_id = p_user for update;
  if not found then raise exception 'WALLET_NOT_FOUND'; end if;
  if v_bal < p_amount then raise exception 'INSUFFICIENT_FUNDS'; end if;
  update wallets set real_balance = real_balance - p_amount where user_id = p_user
    returning real_balance into v_bal;
  insert into transactions(user_id, kind, amount, status, provider, phone)
    values (p_user, 'withdrawal', p_amount, 'pending', 'mpesa', p_phone) returning id into v_id;
  insert into ledger_entries(user_id, type, amount, balance_kind, ref_table, ref_id)
    values (p_user, 'withdrawal', -p_amount, 'real', 'transactions', v_id::text);
  return query select v_id, v_bal;
end;
$function$;
