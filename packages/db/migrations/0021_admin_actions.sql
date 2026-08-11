-- 0021_admin_actions.sql — Admin back office (J2).
-- Audit trail (admin_actions) + two guarded, SECURITY DEFINER admin mutation RPCs.
-- Recreated to match the live database; idempotent (safe to re-apply). RLS for new tables
-- is governed by the global rls_auto_enable event trigger (see 0008), consistent with the
-- other operator tables; admin_actions is written only by these SECURITY DEFINER functions.

create table if not exists public.admin_actions (
  id          bigserial primary key,
  actor_id    uuid not null,
  actor_role  text not null,
  action      text not null,
  target_type text not null,
  target_id   text,
  detail      jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

create index if not exists idx_admin_actions_created on public.admin_actions(created_at desc, id desc);
create index if not exists idx_admin_actions_actor   on public.admin_actions(actor_id, created_at desc);
create index if not exists idx_admin_actions_action  on public.admin_actions(action, created_at desc);

-- Set a user's account status (active|suspended|banned) with hierarchy guards + audit.
CREATE OR REPLACE FUNCTION public.fn_admin_set_user_status(p_actor uuid, p_actor_role text, p_target uuid, p_status text, p_reason text)
 RETURNS TABLE(user_id uuid, status text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_old text; v_target_role text;
begin
  if p_actor_role not in ('admin', 'superadmin') then raise exception 'NOT_AUTHORIZED'; end if;
  if p_status not in ('active', 'suspended', 'banned') then raise exception 'INVALID_STATUS'; end if;
  if p_actor = p_target then raise exception 'NO_SELF_ACTION'; end if;
  select pr.status, pr.role into v_old, v_target_role from profiles pr where pr.id = p_target for update;
  if not found then raise exception 'USER_NOT_FOUND'; end if;
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

-- Set an affiliate's commission rate (0..1) with guards + audit.
CREATE OR REPLACE FUNCTION public.fn_admin_set_commission_rate(p_actor uuid, p_actor_role text, p_target uuid, p_rate numeric)
 RETURNS TABLE(user_id uuid, commission_rate numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_old numeric;
begin
  if p_actor_role not in ('admin', 'superadmin') then raise exception 'NOT_AUTHORIZED'; end if;
  if p_rate < 0 or p_rate > 1 then raise exception 'INVALID_RATE'; end if;
  select a.commission_rate into v_old from affiliates a where a.user_id = p_target for update;
  if not found then raise exception 'NOT_AFFILIATE'; end if;
  update affiliates a set commission_rate = p_rate where a.user_id = p_target;
  insert into admin_actions(actor_id, actor_role, action, target_type, target_id, detail)
    values (p_actor, p_actor_role, 'affiliate.rate', 'affiliate', p_target::text,
            jsonb_build_object('from', v_old, 'to', p_rate));
  return query select p_target, p_rate;
end;
$function$;

grant execute on function public.fn_admin_set_user_status(uuid, text, uuid, text, text) to authenticated, service_role;
grant execute on function public.fn_admin_set_commission_rate(uuid, text, uuid, numeric) to authenticated, service_role;
