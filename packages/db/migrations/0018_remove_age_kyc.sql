-- 0018 remove age verification + basic KYC
-- Product decision: age verification and basic KYC (full name + date of birth) are removed
-- entirely. This reverses 0016: the deposit/open-position money RPCs no longer gate on an
-- age-verified DOB, the fn_set_basic_profile RPC is dropped, and the profiles columns that
-- backed KYC (full_name, date_of_birth, kyc_status) are dropped. Registration (fn_register_user)
-- is unaffected — a new account can deposit and play immediately (subject to funds/status only).

-- 1) Deposits: drop the AGE_NOT_VERIFIED gate added in 0016.
create or replace function public.fn_create_deposit(p_user uuid, p_amount bigint, p_phone text)
returns uuid language plpgsql security definer set search_path = public
as $fn$
declare v_id uuid;
begin
  if p_amount <= 0 then raise exception 'INVALID_AMOUNT'; end if;
  if not exists (select 1 from wallets where user_id = p_user) then raise exception 'WALLET_NOT_FOUND'; end if;
  insert into transactions(user_id, kind, amount, status, provider, phone)
    values (p_user, 'deposit', p_amount, 'pending', 'mpesa', p_phone)
    returning id into v_id;
  return v_id;
end;
$fn$;

-- 2) Play: drop the AGE_NOT_VERIFIED gate added in 0016.
create or replace function public.fn_open_position(p_user uuid, p_stake bigint, p_direction text, p_entry_rate numeric, p_duration_s integer, p_game_day bigint, p_nonce bigint, p_opened_at timestamp with time zone)
returns table(position_id uuid, new_balance bigint)
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

-- 3) Drop the basic-KYC RPC.
drop function if exists public.fn_set_basic_profile(uuid, text, date);

-- 4) Drop the KYC/age columns (their check constraint drops with the column).
alter table public.profiles drop column if exists kyc_status;
alter table public.profiles drop column if exists date_of_birth;
alter table public.profiles drop column if exists full_name;
