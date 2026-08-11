-- 0042_admin_reset_balance.sql — Reset a user's real wallet to their last funded amount (J3 ext).
--
-- "When the system has issues" (a settlement/pricing bug corrupts balances), an admin can restore
-- a user's REAL wallet to a known-good funding point: the amount of their MOST RECENT successful
-- deposit ("original last funded amount"). This sets real_balance := last_funded exactly, writing a
-- reconciling ledger entry for the delta and an immutable admin_actions audit row. SECURITY DEFINER,
-- role-guarded (admin/superadmin), superadmin target protected. Bonus wallet is untouched.

create or replace function public.fn_admin_reset_balance_to_last_funded(
  p_actor uuid, p_actor_role text, p_target uuid, p_reason text
) returns table(user_id uuid, last_funded bigint, previous_balance bigint, new_balance bigint)
language plpgsql security definer set search_path = public
as $fn$
declare v_bal bigint; v_last bigint; v_delta bigint; v_role text; v_action bigint;
begin
  if p_actor_role not in ('admin','superadmin') then raise exception 'NOT_AUTHORIZED'; end if;
  if p_reason is null or btrim(p_reason) = '' then raise exception 'REASON_REQUIRED'; end if;

  select role into v_role from profiles where id = p_target;
  if not found then raise exception 'USER_NOT_FOUND'; end if;
  if v_role = 'superadmin' then raise exception 'SUPERADMIN_PROTECTED'; end if;

  -- Original last funded amount = the most recent SUCCESSFUL deposit.
  -- Alias the table: the RETURNS TABLE out-column `user_id` would otherwise make `user_id` ambiguous.
  select tx.amount into v_last from transactions tx
    where tx.user_id = p_target and tx.kind = 'deposit' and tx.status = 'success'
    order by tx.created_at desc, tx.id desc limit 1;
  if v_last is null then raise exception 'NO_FUNDING'; end if;

  -- Lock the wallet, set real_balance to the last funded amount, reconcile via a ledger entry.
  select w.real_balance into v_bal from wallets w where w.user_id = p_target for update;
  if not found then raise exception 'WALLET_NOT_FOUND'; end if;
  v_delta := v_last - v_bal;
  update wallets set real_balance = v_last where wallets.user_id = p_target;

  insert into admin_actions(actor_id, actor_role, action, target_type, target_id, detail)
    values (p_actor, p_actor_role, 'balance.reset_last_funded', 'user', p_target::text,
            jsonb_build_object('reason', p_reason, 'before', v_bal, 'after', v_last,
                               'lastFunded', v_last, 'delta', v_delta))
    returning id into v_action;

  if v_delta <> 0 then
    insert into ledger_entries(user_id, type, amount, balance_kind, ref_table, ref_id, meta)
      values (p_target, 'adjustment', v_delta, 'real', 'admin_actions', v_action::text,
              jsonb_build_object('kind', 'reset_last_funded', 'reason', p_reason, 'actor', p_actor, 'lastFunded', v_last));
  end if;

  return query select p_target, v_last, v_bal, v_last;
end;
$fn$;

grant execute on function public.fn_admin_reset_balance_to_last_funded(uuid, text, uuid, text) to authenticated, service_role;
