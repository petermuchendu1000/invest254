-- 0096_user_soft_delete.sql
-- Task 1(b) — recoverable ("soft") user deletion.
--
-- A deleted user must (a) be unable to log in, (b) be immediately locked out of all money/game
-- actions, (c) disappear from admin lists by default, yet (d) remain fully recoverable with all
-- historical financial data intact. We achieve this WITHOUT touching any money RPC:
--   * deleted_at stamps the deletion; login lookups (identity.findByPhone/findAllByPhone) exclude it.
--   * status is flipped to 'banned' on delete (prior status saved), so every existing status gate
--     (fn_open_position, fn_create_withdrawal, admin action guards, …) locks the account at once.
--   * restore reverts status to status_before_delete and clears the delete columns.
-- Both RPCs are idempotent, role-gated, self-action-guarded, superadmin-protected, and audited.

alter table public.profiles
  add column if not exists deleted_at           timestamptz,
  add column if not exists deleted_by           uuid,
  add column if not exists delete_reason        text,
  add column if not exists status_before_delete text;

-- ── fn_admin_delete_user: recoverable delete ──
create or replace function public.fn_admin_delete_user(
  p_actor uuid, p_actor_role text, p_target uuid, p_reason text
)
returns table(user_id uuid, status text, deleted_at timestamptz)
language plpgsql security definer set search_path = public
as $fn$
declare v_role text; v_status text; v_deleted timestamptz; v_site uuid;
begin
  if p_actor_role not in ('admin','superadmin','platform_superadmin') then raise exception 'NOT_AUTHORIZED'; end if;
  if p_actor = p_target then raise exception 'NO_SELF_ACTION'; end if;

  select pr.role, pr.status, pr.deleted_at, pr.site_id
    into v_role, v_status, v_deleted, v_site
    from profiles pr where pr.id = p_target for update;
  if not found then raise exception 'USER_NOT_FOUND'; end if;
  if v_role in ('superadmin','platform_superadmin') then raise exception 'SUPERADMIN_PROTECTED'; end if;
  if v_role = 'admin' and p_actor_role not in ('superadmin','platform_superadmin') then raise exception 'INSUFFICIENT_PRIVILEGE'; end if;

  -- Idempotent: already deleted -> no-op, return current state.
  if v_deleted is not null then
    return query select p_target, v_status, v_deleted; return;
  end if;

  update profiles pr
     set status_before_delete = v_status,
         status               = 'banned',   -- immediate money/action lockout via existing gates
         deleted_at           = now(),
         deleted_by           = p_actor,
         delete_reason        = p_reason
   where pr.id = p_target
   returning pr.deleted_at into v_deleted;

  insert into admin_actions(actor_id, actor_role, action, target_type, target_id, detail, site_id)
    values (p_actor, p_actor_role, 'user.delete', 'user', p_target::text,
            jsonb_build_object('reason', p_reason, 'prevStatus', v_status), coalesce(v_site,'00000000-0000-0000-0000-000000000001'));

  return query select p_target, 'banned'::text, v_deleted;
end;
$fn$;

-- ── fn_admin_restore_user: undo a soft delete ──
create or replace function public.fn_admin_restore_user(
  p_actor uuid, p_actor_role text, p_target uuid
)
returns table(user_id uuid, status text, deleted_at timestamptz)
language plpgsql security definer set search_path = public
as $fn$
declare v_role text; v_status text; v_deleted timestamptz; v_prev text; v_site uuid;
begin
  if p_actor_role not in ('admin','superadmin','platform_superadmin') then raise exception 'NOT_AUTHORIZED'; end if;

  select pr.role, pr.status, pr.deleted_at, pr.status_before_delete, pr.site_id
    into v_role, v_status, v_deleted, v_prev, v_site
    from profiles pr where pr.id = p_target for update;
  if not found then raise exception 'USER_NOT_FOUND'; end if;
  if v_role in ('superadmin','platform_superadmin') then raise exception 'SUPERADMIN_PROTECTED'; end if;
  if v_role = 'admin' and p_actor_role not in ('superadmin','platform_superadmin') then raise exception 'INSUFFICIENT_PRIVILEGE'; end if;

  -- Idempotent: not deleted -> no-op, return current state.
  if v_deleted is null then
    return query select p_target, v_status, null::timestamptz; return;
  end if;

  update profiles pr
     set status               = coalesce(v_prev, 'active'),
         deleted_at           = null,
         deleted_by           = null,
         delete_reason        = null,
         status_before_delete = null
   where pr.id = p_target;

  insert into admin_actions(actor_id, actor_role, action, target_type, target_id, detail, site_id)
    values (p_actor, p_actor_role, 'user.restore', 'user', p_target::text,
            jsonb_build_object('restoredStatus', coalesce(v_prev,'active')), coalesce(v_site,'00000000-0000-0000-0000-000000000001'));

  return query select p_target, coalesce(v_prev,'active'), null::timestamptz;
end;
$fn$;

-- Grants: service-role only (the engine holds the connection); never anon/authenticated.
do $g$
begin
  revoke all on function public.fn_admin_delete_user(uuid,text,uuid,text)  from public, anon, authenticated;
  revoke all on function public.fn_admin_restore_user(uuid,text,uuid)      from public, anon, authenticated;
  grant execute on function public.fn_admin_delete_user(uuid,text,uuid,text) to service_role;
  grant execute on function public.fn_admin_restore_user(uuid,text,uuid)     to service_role;
end
$g$;
