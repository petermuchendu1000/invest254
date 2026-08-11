-- 0016 age verification gate + basic-KYC profile completion
-- Real-money play is legally restricted to adults (>= 18). Age is time-dependent, so it cannot
-- be a static CHECK constraint: it is computed at transaction time from a stored date_of_birth.
-- The only un-bypassable chokepoints are the SECURITY DEFINER money RPCs, so the gate lives there
-- (consistent with "money correctness lives in the RPCs"). fn_set_basic_profile records the
-- adult DOB + name (DOB immutable once set) and marks kyc_status='basic'. The previous
-- kyc_status default of 'basic' was wrong (a fresh row has no name/DOB) -> default to 'none'.

-- A row is age-verified iff it has a DOB at least 18 years before today.

-- 1) Correct the kyc_status default (existing rows are untouched; check constraint already allows 'none').
alter table public.profiles alter column kyc_status set default 'none';

-- 2) Gate deposits: only an age-verified adult may create a deposit.
create or replace function public.fn_create_deposit(p_user uuid, p_amount bigint, p_phone text)
returns uuid language plpgsql security definer set search_path = public
as $fn$
declare v_id uuid;
begin
  if not exists (select 1 from profiles where id = p_user
                 and date_of_birth is not null
                 and date_of_birth <= (current_date - interval '18 years')::date) then
    raise exception 'AGE_NOT_VERIFIED';
  end if;
  if p_amount <= 0 then raise exception 'INVALID_AMOUNT'; end if;
  if not exists (select 1 from wallets where user_id = p_user) then raise exception 'WALLET_NOT_FOUND'; end if;
  insert into transactions(user_id, kind, amount, status, provider, phone)
    values (p_user, 'deposit', p_amount, 'pending', 'mpesa', p_phone)
    returning id into v_id;
  return v_id;
end;
$fn$;

-- 3) Gate play: only an age-verified adult may open a position.
create or replace function public.fn_open_position(p_user uuid, p_stake bigint, p_direction text, p_entry_rate numeric, p_duration_s integer, p_game_day bigint, p_nonce bigint, p_opened_at timestamp with time zone)
returns table(position_id uuid, new_balance bigint)
language plpgsql security definer set search_path = public
as $fn$
declare v_bal bigint; v_id uuid;
begin
  if not exists (select 1 from profiles where id = p_user
                 and date_of_birth is not null
                 and date_of_birth <= (current_date - interval '18 years')::date) then
    raise exception 'AGE_NOT_VERIFIED';
  end if;
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

-- 4) Basic-KYC profile completion: validate adulthood, set name + DOB (DOB immutable once set),
--    mark kyc_status='basic'. service-role only.
create or replace function public.fn_set_basic_profile(p_user uuid, p_full_name text, p_dob date)
returns table(user_id uuid, full_name text, date_of_birth date, kyc_status text)
language plpgsql security definer set search_path = public
as $fn$
declare v_dob date; v_name text;
begin
  v_name := nullif(btrim(p_full_name), '');
  if v_name is null or length(v_name) < 2 then raise exception 'INVALID_NAME'; end if;
  select p.date_of_birth into v_dob from profiles p where p.id = p_user;
  if not found then raise exception 'USER_NOT_FOUND'; end if;
  if v_dob is not null and v_dob is distinct from p_dob then raise exception 'DOB_IMMUTABLE'; end if;
  v_dob := coalesce(v_dob, p_dob);
  if v_dob is null or v_dob > current_date then raise exception 'INVALID_DOB'; end if;
  if v_dob > (current_date - interval '18 years')::date then raise exception 'AGE_RESTRICTED'; end if;
  update profiles set full_name = v_name, date_of_birth = v_dob, kyc_status = 'basic' where id = p_user;
  return query select p_user, v_name, v_dob, 'basic'::text;
end;
$fn$;

-- 5) Grants: fn_set_basic_profile is new -> service-role only. (CREATE OR REPLACE preserves the
--    existing service-role grants on fn_create_deposit / fn_open_position.) Plain statements --
--    a DO-block GRANT cannot resolve a freshly created function over the runtime SQL channel.
revoke all on function public.fn_set_basic_profile(uuid,text,date) from public;
revoke all on function public.fn_set_basic_profile(uuid,text,date) from anon;
revoke all on function public.fn_set_basic_profile(uuid,text,date) from authenticated;
grant execute on function public.fn_set_basic_profile(uuid,text,date) to service_role;
