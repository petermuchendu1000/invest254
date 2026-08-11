-- 0022_admin_balance_adjust.sql — Admin manual balance adjustment (J3).
-- One guarded, SECURITY DEFINER RPC for a manual credit/debit to a user's real wallet
-- balance with a mandatory reason. Mirrors the 0010/0014 money-RPC pattern (lock wallet
-- FOR UPDATE, mutate, write ledger) and the 0021 admin pattern (role guard + immutable
-- admin_actions audit row). Signed amount: positive = credit, negative = debit. Idempotent
-- re-application is intentionally NOT provided — each call is a distinct money movement;
-- callers dedupe at the transport layer (M7 idempotency-key middleware).

create or replace function public.fn_admin_adjust_balance(
  p_actor uuid, p_actor_role text, p_target uuid, p_amount bigint, p_reason text
) returns table(user_id uuid, amount bigint, new_balance bigint)
language plpgsql security definer set search_path = public
as $fn$
declare v_bal bigint; v_new bigint; v_action bigint;
begin
  if p_actor_role not in ('admin', 'superadmin') then raise exception 'NOT_AUTHORIZED'; end if;
  if p_amount = 0 then raise exception 'INVALID_AMOUNT'; end if;
  if p_reason is null or btrim(p_reason) = '' then raise exception 'REASON_REQUIRED'; end if;
  -- atomic: lock the wallet, verify the debit does not overdraw, mutate, audit + ledger in one txn.
  -- Qualify wallets.user_id: the RETURNS TABLE out-column `user_id` would otherwise
  -- collide with the column, raising "column reference \"user_id\" is ambiguous".
  select w.real_balance into v_bal from wallets w where w.user_id = p_target for update;
  if not found then raise exception 'WALLET_NOT_FOUND'; end if;
  if v_bal + p_amount < 0 then raise exception 'INSUFFICIENT_FUNDS'; end if;
  update wallets set real_balance = wallets.real_balance + p_amount where wallets.user_id = p_target
    returning wallets.real_balance into v_new;
  insert into admin_actions(actor_id, actor_role, action, target_type, target_id, detail)
    values (p_actor, p_actor_role, 'balance.adjust', 'user', p_target::text,
            jsonb_build_object('amount', p_amount, 'reason', p_reason, 'before', v_bal, 'after', v_new))
    returning id into v_action;
  insert into ledger_entries(user_id, type, amount, balance_kind, ref_table, ref_id, meta)
    values (p_target, 'adjustment', p_amount, 'real', 'admin_actions', v_action::text,
            jsonb_build_object('reason', p_reason, 'actor', p_actor));
  return query select p_target, p_amount, v_new;
end;
$fn$;

grant execute on function public.fn_admin_adjust_balance(uuid, text, uuid, bigint, text) to authenticated, service_role;
