-- 0023_admin_config_rtp_seed.sql — Game configuration edit + forced seed rotation (J5).
-- Two guarded, SECURITY DEFINER superadmin RPCs plus the durable `seed_overrides` table that
-- records a forced seed version per trading day. Mirrors the 0021/0022 admin pattern (role guard
-- + immutable admin_actions audit row). Idempotent (safe to re-apply).
--
-- Seed model: per-day seeds are derived deterministically from the engine-only MASTER_SEED
-- (see packages/shared/src/seed.ts). A forced rotation simply bumps the day's version; the engine
-- re-derives `deriveDaySeed(master, dateKey, version)` and commits the matching hash when it builds
-- that day's context. Because version 0 keeps the canonical label, every previously committed
-- commitment stays valid. The RTP monitor (J5) reads `positions` live and needs no new schema.

-- ── seed_overrides: durable forced-rotation version per trading day ─────────────────────────────
create table if not exists public.seed_overrides (
  trade_date   date primary key,
  version      int  not null default 0 check (version >= 0),
  requested_by uuid,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- ── fn_admin_update_game_config: superadmin partial edit of the game_config singleton ───────────
-- Applies only the keys present in p_patch (COALESCE), relying on the table CHECK constraints for
-- range validity (a violation surfaces as INVALID_CONFIG). Writes a before/after audit row.
create or replace function public.fn_admin_update_game_config(p_actor uuid, p_actor_role text, p_patch jsonb)
 returns table(house_edge numeric, max_multiplier numeric, min_stake bigint, max_stake bigint,
               default_duration_s int, tick_rate_ms int, drift_bias numeric, volatility numeric,
               updated_by uuid, updated_at timestamptz)
 language plpgsql security definer set search_path to 'public'
as $fn$
declare v_before jsonb; v_after public.game_config%rowtype;
begin
  if p_actor_role <> 'superadmin' then raise exception 'NOT_AUTHORIZED'; end if;
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' then raise exception 'INVALID_CONFIG'; end if;
  select to_jsonb(g) into v_before from public.game_config g where id = 1 for update;
  if v_before is null then raise exception 'NOT_FOUND'; end if;
  begin
    update public.game_config set
      house_edge         = coalesce((p_patch->>'houseEdge')::numeric,        game_config.house_edge),
      max_multiplier     = coalesce((p_patch->>'maxMultiplier')::numeric,    game_config.max_multiplier),
      min_stake          = coalesce((p_patch->>'minStakeCents')::bigint,     game_config.min_stake),
      max_stake          = coalesce((p_patch->>'maxStakeCents')::bigint,     game_config.max_stake),
      default_duration_s = coalesce((p_patch->>'defaultDurationS')::int,     game_config.default_duration_s),
      tick_rate_ms       = coalesce((p_patch->>'tickRateMs')::int,           game_config.tick_rate_ms),
      drift_bias         = coalesce((p_patch->>'driftBias')::numeric,        game_config.drift_bias),
      volatility         = coalesce((p_patch->>'volatility')::numeric,       game_config.volatility),
      updated_by         = p_actor
    where id = 1
    returning * into v_after;
  exception
    when check_violation then raise exception 'INVALID_CONFIG';
    when invalid_text_representation or numeric_value_out_of_range then raise exception 'INVALID_CONFIG';
  end;
  insert into public.admin_actions(actor_id, actor_role, action, target_type, target_id, detail)
    values (p_actor, p_actor_role, 'game.config', 'game_config', '1',
            jsonb_build_object('patch', p_patch, 'before', v_before, 'after', to_jsonb(v_after)));
  return query select v_after.house_edge, v_after.max_multiplier, v_after.min_stake, v_after.max_stake,
                      v_after.default_duration_s, v_after.tick_rate_ms, v_after.drift_bias, v_after.volatility,
                      v_after.updated_by, v_after.updated_at;
end;
$fn$;

-- ── fn_admin_rotate_seed: superadmin forces a new seed version for a (today-or-future) day ──────
-- Refuses past or already-revealed days. Bumps the day's version and audits. The engine honors the
-- bump when it next builds that day's context (future days; the current day after a restart) — it
-- never re-seeds a day already live under open positions in this process.
create or replace function public.fn_admin_rotate_seed(p_actor uuid, p_actor_role text, p_date date)
 returns table(trade_date date, version int)
 language plpgsql security definer set search_path to 'public'
as $fn$
declare v_version int; v_revealed timestamptz;
begin
  if p_actor_role <> 'superadmin' then raise exception 'NOT_AUTHORIZED'; end if;
  if p_date < current_date then raise exception 'PAST_DATE'; end if;
  select gd.revealed_at into v_revealed from public.game_days gd where gd.trade_date = p_date;
  if v_revealed is not null then raise exception 'SEED_REVEALED'; end if;
  insert into public.seed_overrides(trade_date, version, requested_by, updated_at)
    values (p_date, 1, p_actor, now())
    on conflict (trade_date) do update set version = public.seed_overrides.version + 1,
                                           requested_by = p_actor, updated_at = now()
    returning public.seed_overrides.version into v_version;
  insert into public.admin_actions(actor_id, actor_role, action, target_type, target_id, detail)
    values (p_actor, p_actor_role, 'game.seed_rotate', 'game_day', p_date::text,
            jsonb_build_object('trade_date', p_date, 'version', v_version));
  return query select p_date, v_version;
end;
$fn$;

grant execute on function public.fn_admin_update_game_config(uuid, text, jsonb) to authenticated, service_role;
grant execute on function public.fn_admin_rotate_seed(uuid, text, date)         to authenticated, service_role;
