-- 0025_admin_set_user_role.sql — Superadmin user-role management.
-- A single guarded, SECURITY DEFINER RPC that promotes/demotes a user between the consolidated
-- roles (player < marketer < admin < superadmin). Mirrors the 0021 admin pattern: superadmin-only,
-- no self-action, target must exist, immutable admin_actions audit row. Idempotent.
--
-- Note: effective authorization is carried in the user's JWT, so a role change takes full effect
-- the next time the target logs in (their existing token keeps its old role until refresh).

create or replace function public.fn_admin_set_user_role(p_actor uuid, p_actor_role text, p_target uuid, p_role text)
 returns table(user_id uuid, role text)
 language plpgsql security definer set search_path to 'public'
as $fn$
declare v_old text;
begin
  if p_actor_role <> 'superadmin' then raise exception 'NOT_AUTHORIZED'; end if;
  if p_role not in ('player','marketer','admin','superadmin') then raise exception 'INVALID_ROLE'; end if;
  if p_actor = p_target then raise exception 'NO_SELF_ACTION'; end if;
  select pr.role into v_old from public.profiles pr where pr.id = p_target for update;
  if not found then raise exception 'USER_NOT_FOUND'; end if;

  update public.profiles pr set role = p_role where pr.id = p_target;
  insert into public.admin_actions(actor_id, actor_role, action, target_type, target_id, detail)
    values (p_actor, p_actor_role, 'user.role', 'user', p_target::text,
            jsonb_build_object('from', v_old, 'to', p_role));
  return query select p_target, p_role;
end;
$fn$;
