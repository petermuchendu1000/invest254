-- 0026_superadmin_singleton.sql — One unchallengeable system owner.
-- Enforces a single, protected superadmin (the owner) at the schema + RPC layer:
--   • A partial UNIQUE index allows at most one row with role='superadmin'.
--   • The admin mutation RPCs refuse to (a) create another superadmin, (b) demote the owner,
--     (c) change the owner's account status, or (d) adjust the owner's wallet.
-- The owner retains full authority over everyone else (demote admins/marketers, ban players,
-- adjust balances, configure the system). Ownership transfer is an out-of-band DB operation only.
-- Idempotent (CREATE OR REPLACE + IF NOT EXISTS). Raises SUPERADMIN_PROTECTED on a blocked action.

-- ── At most one superadmin ──────────────────────────────────────────────────────────────────
create unique index if not exists uq_profiles_single_superadmin
  on public.profiles (role) where role = 'superadmin';

-- ── Status: never suspend/ban a superadmin ──────────────────────────────────────────────────
create or replace function public.fn_admin_set_user_status(p_actor uuid, p_actor_role text, p_target uuid, p_status text, p_reason text)
 returns table(user_id uuid, status text)
 language plpgsql security definer set search_path to 'public'
as $function$
declare v_old text; v_target_role text;
begin
  if p_actor_role not in ('admin', 'superadmin') then raise exception 'NOT_AUTHORIZED'; end if;
  if p_status not in ('active', 'suspended', 'banned') then raise exception 'INVALID_STATUS'; end if;
  if p_actor = p_target then raise exception 'NO_SELF_ACTION'; end if;
  select pr.status, pr.role into v_old, v_target_role from profiles pr where pr.id = p_target for update;
  if not found then raise exception 'USER_NOT_FOUND'; end if;
  if v_target_role = 'superadmin' then raise exception 'SUPERADMIN_PROTECTED'; end if;
  if v_target_role in ('admin', 'superadmin') and p_actor_role <> 'superadmin' then
    raise exception 'INSUFFICIENT_PRIVILEGE';
  end if;
  update profiles pr set status = p_status where pr.id = p_target;
  insert into admin_actions(actor_id, actor_role, action, target_type, target_id, detail)
    values (p_actor, p_actor_role, 'user.status', 'user', p_target::text,
            jsonb_build_object('from', v_old, 'to', p_status, 'reason', p_reason));
  return query select p_target, p_status;
end;
$function$;

-- ── Role: no new superadmins; owner cannot be demoted ───────────────────────────────────────
create or replace function public.fn_admin_set_user_role(p_actor uuid, p_actor_role text, p_target uuid, p_role text)
 returns table(user_id uuid, role text)
 language plpgsql security definer set search_path to 'public'
as $fn$
declare v_old text;
begin
  if p_actor_role <> 'superadmin' then raise exception 'NOT_AUTHORIZED'; end if;
  if p_role not in ('player','marketer','admin','superadmin') then raise exception 'INVALID_ROLE'; end if;
  if p_role = 'superadmin' then raise exception 'SUPERADMIN_PROTECTED'; end if;
  if p_actor = p_target then raise exception 'NO_SELF_ACTION'; end if;
  select pr.role into v_old from public.profiles pr where pr.id = p_target for update;
  if not found then raise exception 'USER_NOT_FOUND'; end if;
  if v_old = 'superadmin' then raise exception 'SUPERADMIN_PROTECTED'; end if;
  update public.profiles pr set role = p_role where pr.id = p_target;
  insert into public.admin_actions(actor_id, actor_role, action, target_type, target_id, detail)
    values (p_actor, p_actor_role, 'user.role', 'user', p_target::text,
            jsonb_build_object('from', v_old, 'to', p_role));
  return query select p_target, p_role;
end;
$fn$;

-- ── Balance: never adjust a superadmin's wallet ─────────────────────────────────────────────
create or replace function public.fn_admin_adjust_balance(
  p_actor uuid, p_actor_role text, p_target uuid, p_amount bigint, p_reason text
) returns table(user_id uuid, amount bigint, new_balance bigint)
language plpgsql security definer set search_path = public
as $fn$
declare v_bal bigint; v_new bigint; v_action bigint; v_role text;
begin
  if p_actor_role not in ('admin', 'superadmin') then raise exception 'NOT_AUTHORIZED'; end if;
  if p_amount = 0 then raise exception 'INVALID_AMOUNT'; end if;
  if p_reason is null or btrim(p_reason) = '' then raise exception 'REASON_REQUIRED'; end if;
  select role into v_role from profiles where id = p_target;
  if v_role = 'superadmin' then raise exception 'SUPERADMIN_PROTECTED'; end if;
  select real_balance into v_bal from wallets where user_id = p_target for update;
  if not found then raise exception 'WALLET_NOT_FOUND'; end if;
  if v_bal + p_amount < 0 then raise exception 'INSUFFICIENT_FUNDS'; end if;
  update wallets set real_balance = real_balance + p_amount where user_id = p_target
    returning real_balance into v_new;
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
