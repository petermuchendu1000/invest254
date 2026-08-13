-- 0048_site_payment_fairness_rpcs.sql — Site-aware deposits, withdrawals, and game-day fairness.
--
-- Continues 0047. Two rules, same as before:
--   * CREATION RPCs take p_site_id and stamp it on the row they insert (transactions, ledger, game_days).
--   * COMPLETION/REVERSAL RPCs DERIVE the site from the row they act on (v_tx.site_id) so a payout /
--     reversal / deposit-credit ledger row can never default to the wrong brand.
--
-- Also fixes a latent break: 0045 dropped the global unique on game_days.trade_date, so the old
-- fn_ensure_game_day `on conflict (trade_date)` would now error. It becomes per-site
-- `on conflict (site_id, trade_date)`, and fn_reveal_game_day is scoped to a single brand.
--
-- SECURITY DEFINER, service-role only. Applied + e2e-tested on local Postgres (two isolated sites).

-- ── Deposits ─────────────────────────────────────────────────────────────────────────────────
drop function if exists public.fn_create_deposit(uuid,bigint,text);
create or replace function public.fn_create_deposit(p_user uuid, p_amount bigint, p_phone text, p_site_id uuid)
returns uuid language plpgsql security definer set search_path = public
as $fn$
declare v_id uuid;
begin
  if p_amount <= 0 then raise exception 'INVALID_AMOUNT'; end if;
  if not exists (select 1 from wallets where user_id = p_user and site_id = p_site_id) then raise exception 'WALLET_NOT_FOUND'; end if;
  insert into transactions(user_id, site_id, kind, amount, status, provider, phone)
    values (p_user, p_site_id, 'deposit', p_amount, 'pending', 'mpesa', p_phone)
    returning id into v_id;
  return v_id;
end;
$fn$;

-- completion: derive site from the transaction row; stamp the deposit ledger with it
create or replace function public.fn_complete_deposit(
  p_checkout text, p_result_code int, p_result_desc text, p_receipt text, p_raw jsonb
) returns table(applied boolean, status text, new_balance bigint)
language plpgsql security definer set search_path = public
as $fn$
declare v_tx public.transactions%rowtype; v_bal bigint;
begin
  select * into v_tx from transactions where checkout_request_id = p_checkout and kind = 'deposit' for update;
  if not found then raise exception 'TX_NOT_FOUND'; end if;
  if v_tx.status in ('success','failed') then
    select real_balance into v_bal from wallets where user_id = v_tx.user_id;
    return query select false, v_tx.status, v_bal; return;
  end if;
  if p_result_code = 0 then
    update transactions set status='success', result_code=p_result_code, result_desc=p_result_desc,
           mpesa_receipt=p_receipt, raw_callback=p_raw where id = v_tx.id;
    update wallets set real_balance = real_balance + v_tx.amount where user_id = v_tx.user_id
      returning real_balance into v_bal;
    insert into ledger_entries(user_id, site_id, type, amount, balance_kind, ref_table, ref_id, meta)
      values (v_tx.user_id, v_tx.site_id, 'deposit', v_tx.amount, 'real', 'transactions', v_tx.id::text,
              jsonb_build_object('receipt', p_receipt));
    return query select true, 'success', v_bal; return;
  else
    update transactions set status='failed', result_code=p_result_code, result_desc=p_result_desc,
           raw_callback=p_raw where id = v_tx.id;
    select real_balance into v_bal from wallets where user_id = v_tx.user_id;
    return query select true, 'failed', v_bal; return;
  end if;
end;
$fn$;

-- ── Withdrawals ──────────────────────────────────────────────────────────────────────────────
drop function if exists public.fn_create_withdrawal(uuid,bigint,text,bigint);
create or replace function public.fn_create_withdrawal(p_user uuid, p_amount bigint, p_phone text, p_min bigint, p_site_id uuid)
returns table(tx_id uuid, new_balance bigint)
language plpgsql security definer set search_path = public
as $fn$
declare v_bal bigint; v_id uuid;
begin
  if p_amount <= 0 then raise exception 'INVALID_AMOUNT'; end if;
  if p_amount < p_min then raise exception 'BELOW_MIN'; end if;
  select real_balance into v_bal from wallets where user_id = p_user and site_id = p_site_id for update;
  if not found then raise exception 'WALLET_NOT_FOUND'; end if;
  if v_bal < p_amount then raise exception 'INSUFFICIENT_FUNDS'; end if;
  update wallets set real_balance = real_balance - p_amount where user_id = p_user
    returning real_balance into v_bal;
  insert into transactions(user_id, site_id, kind, amount, status, provider, phone)
    values (p_user, p_site_id, 'withdrawal', p_amount, 'pending', 'mpesa', p_phone) returning id into v_id;
  insert into ledger_entries(user_id, site_id, type, amount, balance_kind, ref_table, ref_id)
    values (p_user, p_site_id, 'withdrawal', -p_amount, 'real', 'transactions', v_id::text);
  return query select v_id, v_bal;
end;
$fn$;

-- reject: reverse the hold; reversal ledger stamped with the tx's site
create or replace function public.fn_reject_withdrawal(p_tx uuid, p_admin uuid)
returns table(reversed boolean, new_balance bigint)
language plpgsql security definer set search_path = public
as $fn$
declare v_tx public.transactions%rowtype; v_bal bigint;
begin
  select * into v_tx from transactions where id = p_tx and kind = 'withdrawal' for update;
  if not found then raise exception 'TX_NOT_FOUND'; end if;
  if v_tx.status <> 'pending' then
    select real_balance into v_bal from wallets where user_id = v_tx.user_id;
    return query select false, v_bal; return;
  end if;
  update transactions set status='reversed', approved_by=p_admin where id = v_tx.id;
  update wallets set real_balance = real_balance + v_tx.amount where user_id = v_tx.user_id
    returning real_balance into v_bal;
  insert into ledger_entries(user_id, site_id, type, amount, balance_kind, ref_table, ref_id)
    values (v_tx.user_id, v_tx.site_id, 'withdrawal_reversal', v_tx.amount, 'real', 'transactions', v_tx.id::text);
  return query select true, v_bal;
end;
$fn$;

-- complete: success keeps the debit; failure reverses (reversal ledger stamped with the tx's site)
create or replace function public.fn_complete_withdrawal(
  p_tx uuid, p_result_code int, p_conversation text, p_receipt text, p_raw jsonb
) returns table(applied boolean, status text, new_balance bigint)
language plpgsql security definer set search_path = public
as $fn$
declare v_tx public.transactions%rowtype; v_bal bigint;
begin
  select * into v_tx from transactions where id = p_tx and kind = 'withdrawal' for update;
  if not found then raise exception 'TX_NOT_FOUND'; end if;
  if v_tx.status in ('success','failed','reversed') then
    select real_balance into v_bal from wallets where user_id = v_tx.user_id;
    return query select false, v_tx.status, v_bal; return;
  end if;
  if p_result_code = 0 then
    update transactions set status='success', result_code=p_result_code, conversation_id=p_conversation,
           mpesa_receipt=p_receipt, raw_callback=p_raw where id = v_tx.id;
    select real_balance into v_bal from wallets where user_id = v_tx.user_id;
    return query select true, 'success', v_bal; return;
  else
    update transactions set status='failed', result_code=p_result_code, conversation_id=p_conversation,
           raw_callback=p_raw where id = v_tx.id;
    update wallets set real_balance = real_balance + v_tx.amount where user_id = v_tx.user_id
      returning real_balance into v_bal;
    insert into ledger_entries(user_id, site_id, type, amount, balance_kind, ref_table, ref_id)
      values (v_tx.user_id, v_tx.site_id, 'withdrawal_reversal', v_tx.amount, 'real', 'transactions', v_tx.id::text);
    return query select true, 'failed', v_bal; return;
  end if;
end;
$fn$;

-- ── Fairness: per-site game days ───────────────────────────────────────────────────────────────
drop function if exists public.fn_ensure_game_day(date,text);
create or replace function public.fn_ensure_game_day(p_date date, p_hash text, p_site_id uuid)
returns bigint language plpgsql security definer set search_path = public
as $fn$
declare v_id bigint;
begin
  insert into game_days(trade_date, server_seed_hash, site_id) values (p_date, p_hash, p_site_id)
    on conflict (site_id, trade_date) do nothing;
  select id into v_id from game_days where trade_date = p_date and site_id = p_site_id;
  return v_id;
end;
$fn$;

drop function if exists public.fn_reveal_game_day(date,text);
create or replace function public.fn_reveal_game_day(p_date date, p_seed text, p_site_id uuid)
returns boolean language plpgsql security definer set search_path = public, extensions
as $fn$
begin
  update game_days
     set server_seed = p_seed, revealed_at = now()
   where trade_date = p_date
     and site_id = p_site_id
     and revealed_at is null
     and p_date < current_date
     and server_seed_hash = encode(digest(p_seed, 'sha256'), 'hex');
  return found;
end;
$fn$;

-- ── Grants (service-role only) ──────────────────────────────────────────────────────────────────
revoke all on function public.fn_create_deposit(uuid,bigint,text,uuid)               from public;
grant  execute on function public.fn_create_deposit(uuid,bigint,text,uuid)            to service_role;
revoke all on function public.fn_create_withdrawal(uuid,bigint,text,bigint,uuid)      from public;
grant  execute on function public.fn_create_withdrawal(uuid,bigint,text,bigint,uuid)  to service_role;
revoke all on function public.fn_ensure_game_day(date,text,uuid)                      from public;
grant  execute on function public.fn_ensure_game_day(date,text,uuid)                  to service_role;
revoke all on function public.fn_reveal_game_day(date,text,uuid)                      from public;
grant  execute on function public.fn_reveal_game_day(date,text,uuid)                  to service_role;
