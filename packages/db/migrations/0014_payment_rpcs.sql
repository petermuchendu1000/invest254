-- 0014 atomic + idempotent M-Pesa payment RPCs (SECURITY DEFINER, service-role only)
-- Deposits: create -> attach STK ids -> complete (credit on success). Idempotent by checkout id.
-- Withdrawals: create (HOLD: debit + ledger) -> approve/reject -> complete (success keeps debit;
--   failure reverses). Idempotent by transaction id + terminal-status guards under FOR UPDATE.
-- Money columns are BIGINT cents (KES). Mirrors the 0010 game-money RPC pattern.

-- ── Deposits ────────────────────────────────────────────────────────────────
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

create or replace function public.fn_attach_stk(p_tx uuid, p_merchant text, p_checkout text)
returns boolean language plpgsql security definer set search_path = public
as $fn$
begin
  update transactions
     set merchant_request_id = p_merchant, checkout_request_id = p_checkout, status = 'processing'
   where id = p_tx and kind = 'deposit' and status = 'pending';
  return found;
end;
$fn$;

create or replace function public.fn_complete_deposit(
  p_checkout text, p_result_code int, p_result_desc text, p_receipt text, p_raw jsonb
) returns table(applied boolean, status text, new_balance bigint)
language plpgsql security definer set search_path = public
as $fn$
declare v_tx public.transactions%rowtype; v_bal bigint;
begin
  select * into v_tx from transactions where checkout_request_id = p_checkout and kind = 'deposit' for update;
  if not found then raise exception 'TX_NOT_FOUND'; end if;
  if v_tx.status in ('success','failed') then           -- idempotent: terminal already
    select real_balance into v_bal from wallets where user_id = v_tx.user_id;
    return query select false, v_tx.status, v_bal; return;
  end if;
  if p_result_code = 0 then
    update transactions set status='success', result_code=p_result_code, result_desc=p_result_desc,
           mpesa_receipt=p_receipt, raw_callback=p_raw where id = v_tx.id;
    update wallets set real_balance = real_balance + v_tx.amount where user_id = v_tx.user_id
      returning real_balance into v_bal;
    insert into ledger_entries(user_id, type, amount, balance_kind, ref_table, ref_id, meta)
      values (v_tx.user_id, 'deposit', v_tx.amount, 'real', 'transactions', v_tx.id::text,
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

-- ── Withdrawals ─────────────────────────────────────────────────────────────
create or replace function public.fn_create_withdrawal(p_user uuid, p_amount bigint, p_phone text, p_min bigint)
returns table(tx_id uuid, new_balance bigint)
language plpgsql security definer set search_path = public
as $fn$
declare v_bal bigint; v_id uuid;
begin
  if p_amount <= 0 then raise exception 'INVALID_AMOUNT'; end if;
  if p_amount < p_min then raise exception 'BELOW_MIN'; end if;
  select real_balance into v_bal from wallets where user_id = p_user for update;  -- lock
  if not found then raise exception 'WALLET_NOT_FOUND'; end if;
  if v_bal < p_amount then raise exception 'INSUFFICIENT_FUNDS'; end if;
  -- HOLD the funds immediately so they can't be double-spent while the payout is in flight
  update wallets set real_balance = real_balance - p_amount where user_id = p_user
    returning real_balance into v_bal;
  insert into transactions(user_id, kind, amount, status, provider, phone)
    values (p_user, 'withdrawal', p_amount, 'pending', 'mpesa', p_phone) returning id into v_id;
  insert into ledger_entries(user_id, type, amount, balance_kind, ref_table, ref_id)
    values (p_user, 'withdrawal', -p_amount, 'real', 'transactions', v_id::text);
  return query select v_id, v_bal;
end;
$fn$;

create or replace function public.fn_approve_withdrawal(p_tx uuid, p_admin uuid)
returns boolean language plpgsql security definer set search_path = public
as $fn$
begin
  update transactions set status='processing', approved_by=p_admin
   where id = p_tx and kind = 'withdrawal' and status = 'pending';
  return found;
end;
$fn$;

create or replace function public.fn_reject_withdrawal(p_tx uuid, p_admin uuid)
returns table(reversed boolean, new_balance bigint)
language plpgsql security definer set search_path = public
as $fn$
declare v_tx public.transactions%rowtype; v_bal bigint;
begin
  select * into v_tx from transactions where id = p_tx and kind = 'withdrawal' for update;
  if not found then raise exception 'TX_NOT_FOUND'; end if;
  if v_tx.status <> 'pending' then                       -- idempotent: only a pending hold can be rejected
    select real_balance into v_bal from wallets where user_id = v_tx.user_id;
    return query select false, v_bal; return;
  end if;
  update transactions set status='reversed', approved_by=p_admin where id = v_tx.id;
  update wallets set real_balance = real_balance + v_tx.amount where user_id = v_tx.user_id
    returning real_balance into v_bal;
  insert into ledger_entries(user_id, type, amount, balance_kind, ref_table, ref_id)
    values (v_tx.user_id, 'withdrawal_reversal', v_tx.amount, 'real', 'transactions', v_tx.id::text);
  return query select true, v_bal;
end;
$fn$;

create or replace function public.fn_complete_withdrawal(
  p_tx uuid, p_result_code int, p_conversation text, p_receipt text, p_raw jsonb
) returns table(applied boolean, status text, new_balance bigint)
language plpgsql security definer set search_path = public
as $fn$
declare v_tx public.transactions%rowtype; v_bal bigint;
begin
  select * into v_tx from transactions where id = p_tx and kind = 'withdrawal' for update;
  if not found then raise exception 'TX_NOT_FOUND'; end if;
  if v_tx.status in ('success','failed','reversed') then  -- idempotent: terminal already
    select real_balance into v_bal from wallets where user_id = v_tx.user_id;
    return query select false, v_tx.status, v_bal; return;
  end if;
  if p_result_code = 0 then
    update transactions set status='success', result_code=p_result_code, conversation_id=p_conversation,
           mpesa_receipt=p_receipt, raw_callback=p_raw where id = v_tx.id;
    select real_balance into v_bal from wallets where user_id = v_tx.user_id;  -- already debited at hold
    return query select true, 'success', v_bal; return;
  else
    update transactions set status='failed', result_code=p_result_code, conversation_id=p_conversation,
           raw_callback=p_raw where id = v_tx.id;
    update wallets set real_balance = real_balance + v_tx.amount where user_id = v_tx.user_id
      returning real_balance into v_bal;                 -- reverse the hold
    insert into ledger_entries(user_id, type, amount, balance_kind, ref_table, ref_id)
      values (v_tx.user_id, 'withdrawal_reversal', v_tx.amount, 'real', 'transactions', v_tx.id::text);
    return query select true, 'failed', v_bal; return;
  end if;
end;
$fn$;

-- ── Grants: service-role only ───────────────────────────────────────────────
do $g$
begin
  revoke all on function public.fn_create_deposit(uuid,bigint,text)              from public;
  revoke all on function public.fn_attach_stk(uuid,text,text)                    from public;
  revoke all on function public.fn_complete_deposit(text,int,text,text,jsonb)    from public;
  revoke all on function public.fn_create_withdrawal(uuid,bigint,text,bigint)    from public;
  revoke all on function public.fn_approve_withdrawal(uuid,uuid)                 from public;
  revoke all on function public.fn_reject_withdrawal(uuid,uuid)                  from public;
  revoke all on function public.fn_complete_withdrawal(uuid,int,text,text,jsonb) from public;
  grant execute on function public.fn_create_deposit(uuid,bigint,text)              to service_role;
  grant execute on function public.fn_attach_stk(uuid,text,text)                    to service_role;
  grant execute on function public.fn_complete_deposit(text,int,text,text,jsonb)    to service_role;
  grant execute on function public.fn_create_withdrawal(uuid,bigint,text,bigint)    to service_role;
  grant execute on function public.fn_approve_withdrawal(uuid,uuid)                 to service_role;
  grant execute on function public.fn_reject_withdrawal(uuid,uuid)                  to service_role;
  grant execute on function public.fn_complete_withdrawal(uuid,int,text,text,jsonb) to service_role;
end
$g$;
