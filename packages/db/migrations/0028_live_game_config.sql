-- 0028_live_game_config.sql — Make `game_config` the single source of truth for the engine.
--
-- WHY: until now the admin panel wrote `public.game_config`, but neither the WS engine
-- (`apps/engine/src/server.ts`) nor the HTTP API (`apps/api/src/server.ts`) ever read it —
-- both booted from the hardcoded `DEFAULT_CONFIG` in `packages/shared/src/config.ts`. Saving
-- in the admin UI therefore changed a row nobody consumed. This migration supplies the three
-- things the code needs to consume config safely at runtime:
--
--   1. `target_win_rate` — the last engine knob that had no column at all (hardcoded 0.125).
--   2. `version` + `game_config_versions` — a monotonic, immutable snapshot per change, so a
--      position can record exactly which parameter set determined its outcome. Crash recovery
--      recomputes outcomes from (seed, config); without a version, an admin edit made while a
--      position is in flight would silently re-price that position on restart.
--   3. A feasibility CHECK + `pg_notify` — invalid economics are rejected at write time rather
--      than crashing the engine at load time, and valid changes are pushed to the engine
--      instantly instead of waiting for a redeploy.
--
-- Feasibility (mirrors `assertFeasible` in packages/shared/src/config.ts): the required mean
-- winning multiplier is RTP / targetWinRate, and it must sit in (1, maxMultiplier]. The
-- constraint makes it impossible to persist a config the settlement calibrator cannot solve.
--
-- Idempotent: safe to re-apply.

-- ── 1. New columns on the singleton ───────────────────────────────────────────────────────
do $mig$
begin
  alter table public.game_config add column if not exists target_win_rate numeric;
  alter table public.game_config add column if not exists version         bigint;

  -- Seed target_win_rate per existing row WITHOUT overriding any operator-set value:
  -- pick the documented 0.125 default, clamped into the feasible band for this row's
  -- (house_edge, max_multiplier). Band: rtp/maxMult <= twr < rtp, with margin at both ends
  -- so the calibrator solves for a finite gain instead of saturating at the cap.
  update public.game_config
     set target_win_rate = least(
           greatest(0.125, ((1 - house_edge) / max_multiplier) * 1.25),
           (1 - house_edge) * 0.9
         )
   where target_win_rate is null;

  update public.game_config set version = 1 where version is null;

  alter table public.game_config alter column target_win_rate set default 0.125;
  alter table public.game_config alter column target_win_rate set not null;
  alter table public.game_config alter column version set default 1;
  alter table public.game_config alter column version set not null;
end
$mig$;

-- ── 2. Economic feasibility guard ─────────────────────────────────────────────────────────
-- Enforced on the table so no write path (admin RPC, service_role, psql) can persist a config
-- the SettlementEngine cannot calibrate.
do $mig$
begin
  alter table public.game_config drop constraint if exists chk_game_config_feasible;
  alter table public.game_config add constraint chk_game_config_feasible check (
        house_edge >= 0 and house_edge < 1
    and max_multiplier > 1
    and target_win_rate > 0 and target_win_rate <= 1
    and (1 - house_edge) / target_win_rate >  1
    and (1 - house_edge) / target_win_rate <= max_multiplier
  );

  -- drift_bias had no bounds at all; tanh saturates well before |1|, so anything outside
  -- [-1, 1] is a pinned, non-moving curve rather than a "biased" one.
  alter table public.game_config drop constraint if exists chk_game_config_drift_bias;
  alter table public.game_config add constraint chk_game_config_drift_bias
    check (drift_bias >= -1 and drift_bias <= 1);

  -- Guard the tick loop: sub-50ms ticks are a broadcast DoS on every connected socket.
  alter table public.game_config drop constraint if exists chk_game_config_tick_rate;
  alter table public.game_config add constraint chk_game_config_tick_rate
    check (tick_rate_ms >= 50 and tick_rate_ms <= 60000);

  alter table public.game_config drop constraint if exists chk_game_config_duration;
  alter table public.game_config add constraint chk_game_config_duration
    check (default_duration_s >= 1 and default_duration_s <= 3600);
end
$mig$;

-- ── 3. Immutable version history ──────────────────────────────────────────────────────────
-- One row per applied config. Positions reference it, so a settled round can always be
-- re-derived against the exact parameters that priced it.
create table if not exists public.game_config_versions (
  version            bigint primary key,
  house_edge         numeric     not null,
  max_multiplier     numeric     not null,
  min_stake          bigint      not null,
  max_stake          bigint      not null,
  default_duration_s int         not null,
  tick_rate_ms       int         not null,
  drift_bias         numeric     not null,
  volatility         numeric     not null,
  target_win_rate    numeric     not null,
  updated_by         uuid,
  created_at         timestamptz not null default now()
);

-- ── 4. Auto-version + snapshot + notify ───────────────────────────────────────────────────
create or replace function public.fn_game_config_version_bump()
returns trigger language plpgsql as $fn$
begin
  new.version := coalesce(old.version, 0) + 1;
  return new;
end;
$fn$;

create or replace function public.fn_game_config_snapshot()
returns trigger language plpgsql security definer set search_path to 'public' as $fn$
begin
  insert into public.game_config_versions(
    version, house_edge, max_multiplier, min_stake, max_stake,
    default_duration_s, tick_rate_ms, drift_bias, volatility, target_win_rate, updated_by
  ) values (
    new.version, new.house_edge, new.max_multiplier, new.min_stake, new.max_stake,
    new.default_duration_s, new.tick_rate_ms, new.drift_bias, new.volatility,
    new.target_win_rate, new.updated_by
  )
  on conflict (version) do nothing;

  -- Push, don't poll: the engine LISTENs on this channel and hot-swaps within a tick.
  -- (Engines also poll as a fallback, so a dropped notification is self-healing.)
  perform pg_notify('game_config_changed', new.version::text);
  return null;
end;
$fn$;

do $mig$
begin
  drop trigger if exists trg_game_config_version on public.game_config;
  create trigger trg_game_config_version before update on public.game_config
    for each row execute function public.fn_game_config_version_bump();

  drop trigger if exists trg_game_config_snapshot on public.game_config;
  create trigger trg_game_config_snapshot after insert or update on public.game_config
    for each row execute function public.fn_game_config_snapshot();
end
$mig$;

-- Backfill the snapshot for the row as it stands today (trigger only fires on future writes).
insert into public.game_config_versions(
  version, house_edge, max_multiplier, min_stake, max_stake,
  default_duration_s, tick_rate_ms, drift_bias, volatility, target_win_rate, updated_by
)
select version, house_edge, max_multiplier, min_stake, max_stake,
       default_duration_s, tick_rate_ms, drift_bias, volatility, target_win_rate, updated_by
  from public.game_config
on conflict (version) do nothing;

-- ── 5. Positions record the config that priced them ───────────────────────────────────────
do $mig$
begin
  alter table public.positions add column if not exists config_version bigint;
  alter table public.positions drop constraint if exists positions_config_version_fkey;
  alter table public.positions add constraint positions_config_version_fkey
    foreign key (config_version) references public.game_config_versions(version);
  create index if not exists idx_positions_config_version on public.positions(config_version);
end
$mig$;

-- ── 6. fn_open_position carries the config version ────────────────────────────────────────
-- New 9-arg overload. The 8-arg form from 0012 is dropped so there is exactly one open path
-- and no caller can silently write a position with an unknown parameter set.
drop function if exists public.fn_open_position(uuid,bigint,text,numeric,int,bigint,bigint,timestamptz);

create or replace function public.fn_open_position(
  p_user uuid, p_stake bigint, p_direction text, p_entry_rate numeric,
  p_duration_s int, p_game_day bigint, p_nonce bigint, p_opened_at timestamptz,
  p_config_version bigint
) returns table(position_id uuid, new_balance bigint)
language plpgsql security definer set search_path = public
as $fn$
declare v_bal bigint; v_id uuid; v_min bigint; v_max bigint;
begin
  if p_stake <= 0 then raise exception 'INVALID_STAKE'; end if;
  if p_direction not in ('buy','sell') then raise exception 'INVALID_DIRECTION'; end if;

  -- Defence in depth: the engine validates stake bounds in process, but the RPC is the last
  -- gate before money moves, so it re-checks against the *live* config rather than trusting
  -- whatever snapshot the caller happens to be holding.
  select min_stake, max_stake into v_min, v_max from game_config where id = 1;
  if v_min is not null and p_stake < v_min then raise exception 'STAKE_BELOW_MIN'; end if;
  if v_max is not null and p_stake > v_max then raise exception 'STAKE_ABOVE_MAX'; end if;

  select real_balance into v_bal from wallets where user_id = p_user for update;
  if not found then raise exception 'WALLET_NOT_FOUND'; end if;
  if v_bal < p_stake then raise exception 'INSUFFICIENT_FUNDS'; end if;
  update wallets set real_balance = real_balance - p_stake where user_id = p_user
    returning real_balance into v_bal;
  v_id := gen_random_uuid();
  insert into positions(id, user_id, game_day_id, direction, stake, entry_rate, duration_s,
                        status, nonce, opened_at, config_version)
    values (v_id, p_user, p_game_day, p_direction, p_stake, p_entry_rate, p_duration_s,
            'open', p_nonce, p_opened_at, p_config_version);
  insert into ledger_entries(user_id, type, amount, balance_kind, ref_table, ref_id)
    values (p_user, 'stake', -p_stake, 'real', 'positions', v_id::text);
  return query select v_id, v_bal;
end;
$fn$;

-- ── 7. Admin update RPC: adds targetWinRate, returns the new version ──────────────────────
drop function if exists public.fn_admin_update_game_config(uuid, text, jsonb);

create or replace function public.fn_admin_update_game_config(p_actor uuid, p_actor_role text, p_patch jsonb)
 returns table(house_edge numeric, max_multiplier numeric, min_stake bigint, max_stake bigint,
               default_duration_s int, tick_rate_ms int, drift_bias numeric, volatility numeric,
               target_win_rate numeric, version bigint, updated_by uuid, updated_at timestamptz)
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
      target_win_rate    = coalesce((p_patch->>'targetWinRate')::numeric,    game_config.target_win_rate),
      updated_by         = p_actor
    where id = 1
    returning * into v_after;
  exception
    when check_violation then raise exception 'INVALID_CONFIG';
    when invalid_text_representation or numeric_value_out_of_range then raise exception 'INVALID_CONFIG';
    when division_by_zero then raise exception 'INVALID_CONFIG';
  end;
  insert into public.admin_actions(actor_id, actor_role, action, target_type, target_id, detail)
    values (p_actor, p_actor_role, 'game.config', 'game_config', '1',
            jsonb_build_object('patch', p_patch, 'before', v_before, 'after', to_jsonb(v_after)));
  return query select v_after.house_edge, v_after.max_multiplier, v_after.min_stake, v_after.max_stake,
                      v_after.default_duration_s, v_after.tick_rate_ms, v_after.drift_bias, v_after.volatility,
                      v_after.target_win_rate, v_after.version, v_after.updated_by, v_after.updated_at;
end;
$fn$;

-- ── 8. Grants ─────────────────────────────────────────────────────────────────────────────
do $mig$
begin
  revoke all on function public.fn_open_position(uuid,bigint,text,numeric,int,bigint,bigint,timestamptz,bigint) from public;
  grant execute on function public.fn_open_position(uuid,bigint,text,numeric,int,bigint,bigint,timestamptz,bigint) to service_role;
  grant execute on function public.fn_admin_update_game_config(uuid, text, jsonb) to authenticated, service_role;

  -- game_config_versions is read-only reference data for the engine; RLS on with no policy
  -- keeps anon/authenticated out entirely (service_role and the DB owner bypass RLS).
  alter table public.game_config_versions enable row level security;
end
$mig$;
