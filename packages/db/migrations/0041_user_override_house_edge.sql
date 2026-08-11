-- 0041_user_override_house_edge.sql — Per-player HOUSE EDGE (RTP) override (J8 extension).
--
-- Why: a per-user win_rate override alone is only feasible while (1 - global_house_edge)/win_rate
-- stays in (1, max_multiplier]. At the default 75% house edge (RTP 0.25) that caps a usable win
-- rate at ~0.24 — so an operator setting win_rate 0.9 produced an INFEASIBLE per-user config that
-- the engine silently ignored (fell back to global). Adding a per-user house_edge lets the operator
-- raise a user's RTP so a high win rate becomes feasible and actually applies.
--
-- Idempotent: adds the column if missing and replaces the setter to thread house_edge through the
-- same NULL-preserving patch semantics (NULL = "use the global game_config value").

alter table public.user_overrides add column if not exists house_edge numeric;

create or replace function public.fn_admin_set_user_overrides(
  p_actor uuid, p_actor_role text, p_target uuid, p_patch jsonb
) returns public.user_overrides
language plpgsql security definer set search_path = public
as $fn$
declare v_row public.user_overrides; v_before jsonb;
begin
  if p_actor_role not in ('admin','superadmin') then raise exception 'NOT_AUTHORIZED'; end if;
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' then raise exception 'INVALID_PATCH'; end if;
  if not exists (select 1 from public.profiles where id = p_target) then raise exception 'USER_NOT_FOUND'; end if;

  select to_jsonb(o) into v_before from public.user_overrides o where o.user_id = p_target;

  insert into public.user_overrides as u (user_id, win_rate, house_edge, trade_duration_s, max_win_multiplier, min_stake, max_stake, notes, updated_by, updated_at)
  values (
    p_target,
    case when p_patch ? 'win_rate'           then nullif(p_patch->>'win_rate','')::numeric        else null end,
    case when p_patch ? 'house_edge'         then nullif(p_patch->>'house_edge','')::numeric      else null end,
    case when p_patch ? 'trade_duration_s'   then nullif(p_patch->>'trade_duration_s','')::int    else null end,
    case when p_patch ? 'max_win_multiplier' then nullif(p_patch->>'max_win_multiplier','')::numeric else null end,
    case when p_patch ? 'min_stake'          then nullif(p_patch->>'min_stake','')::bigint        else null end,
    case when p_patch ? 'max_stake'          then nullif(p_patch->>'max_stake','')::bigint        else null end,
    case when p_patch ? 'notes'              then nullif(p_patch->>'notes','')                    else null end,
    p_actor, now()
  )
  on conflict (user_id) do update set
    win_rate           = case when p_patch ? 'win_rate'           then nullif(p_patch->>'win_rate','')::numeric        else u.win_rate end,
    house_edge         = case when p_patch ? 'house_edge'         then nullif(p_patch->>'house_edge','')::numeric      else u.house_edge end,
    trade_duration_s   = case when p_patch ? 'trade_duration_s'   then nullif(p_patch->>'trade_duration_s','')::int    else u.trade_duration_s end,
    max_win_multiplier = case when p_patch ? 'max_win_multiplier' then nullif(p_patch->>'max_win_multiplier','')::numeric else u.max_win_multiplier end,
    min_stake          = case when p_patch ? 'min_stake'          then nullif(p_patch->>'min_stake','')::bigint        else u.min_stake end,
    max_stake          = case when p_patch ? 'max_stake'          then nullif(p_patch->>'max_stake','')::bigint        else u.max_stake end,
    notes              = case when p_patch ? 'notes'              then nullif(p_patch->>'notes','')                    else u.notes end,
    updated_by = p_actor, updated_at = now()
  returning * into v_row;

  insert into admin_actions(actor_id, actor_role, action, target_type, target_id, detail)
    values (p_actor, p_actor_role, 'user.overrides', 'user', p_target::text,
            jsonb_build_object('patch', p_patch, 'before', v_before, 'after', to_jsonb(v_row)));
  return v_row;
end;
$fn$;

do $mig$
begin
  grant execute on function public.fn_admin_set_user_overrides(uuid, text, uuid, jsonb) to authenticated, service_role;
end
$mig$;
