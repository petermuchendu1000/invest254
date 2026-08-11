-- 0043_game_config_min_withdrawal.sql — Make the minimum withdrawal a live, admin-editable knob.
--
-- WHY: the smallest cash-out a player could request was the hardcoded `MIN_WITHDRAWAL_CENTS`
-- (KES 250) baked into `packages/shared/src/payments.ts` and frozen into `PaymentService` at
-- boot. Operators had no way to raise or lower it without a redeploy, and the player withdraw
-- form showed a constant that could drift from what the server actually enforced. This migration
-- moves the floor into `game_config` — the same singleton the engine and API already hot-reload —
-- so an edit in the admin panel gates the very next withdrawal and is surfaced to the UI via the
-- existing GET /game/config, with no code change or redeploy.
--
-- Mirrors the 0028 machinery: the value is snapshotted into `game_config_versions` on every write
-- and a positive-value CHECK makes an invalid floor impossible to persist.
--
-- Idempotent: safe to re-apply.

-- ── 1. New column on the singleton + its immutable version history ──────────────────────────
do $mig$
begin
  -- KES 250 default keeps parity with the previous hardcoded MIN_WITHDRAWAL_CENTS.
  alter table public.game_config           add column if not exists min_withdrawal bigint not null default 25000;
  alter table public.game_config_versions  add column if not exists min_withdrawal bigint not null default 25000;

  -- The floor must be a positive amount; a zero/negative minimum would disable the guard entirely.
  alter table public.game_config drop constraint if exists chk_game_config_min_withdrawal;
  alter table public.game_config add constraint chk_game_config_min_withdrawal
    check (min_withdrawal > 0);
end
$mig$;

-- ── 2. Snapshot the new column on every config write ────────────────────────────────────────
-- Recreate the 0028 snapshot trigger function so each new version records its min_withdrawal
-- (rather than silently inheriting the column default).
create or replace function public.fn_game_config_snapshot()
returns trigger language plpgsql security definer set search_path to 'public' as $fn$
begin
  insert into public.game_config_versions(
    version, house_edge, max_multiplier, min_stake, max_stake, min_withdrawal,
    default_duration_s, tick_rate_ms, drift_bias, volatility, target_win_rate, updated_by
  ) values (
    new.version, new.house_edge, new.max_multiplier, new.min_stake, new.max_stake, new.min_withdrawal,
    new.default_duration_s, new.tick_rate_ms, new.drift_bias, new.volatility,
    new.target_win_rate, new.updated_by
  )
  on conflict (version) do nothing;

  -- Push, don't poll: the engine LISTENs on this channel and hot-swaps within a tick.
  perform pg_notify('game_config_changed', new.version::text);
  return null;
end;
$fn$;

-- Backfill the current version's snapshot row with the live floor (the trigger only fires on
-- future writes, so the row that exists today would otherwise keep the column default).
update public.game_config_versions v
   set min_withdrawal = g.min_withdrawal
  from public.game_config g
 where v.version = g.version;

-- ── 3. Admin update RPC learns minWithdrawalCents ───────────────────────────────────────────
-- Return type changes (adds min_withdrawal), so drop-and-recreate rather than replace.
drop function if exists public.fn_admin_update_game_config(uuid, text, jsonb);

create or replace function public.fn_admin_update_game_config(p_actor uuid, p_actor_role text, p_patch jsonb)
 returns table(house_edge numeric, max_multiplier numeric, min_stake bigint, max_stake bigint,
               min_withdrawal bigint, default_duration_s int, tick_rate_ms int, drift_bias numeric,
               volatility numeric, target_win_rate numeric, version bigint, updated_by uuid, updated_at timestamptz)
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
      house_edge         = coalesce((p_patch->>'houseEdge')::numeric,          game_config.house_edge),
      max_multiplier     = coalesce((p_patch->>'maxMultiplier')::numeric,      game_config.max_multiplier),
      min_stake          = coalesce((p_patch->>'minStakeCents')::bigint,       game_config.min_stake),
      max_stake          = coalesce((p_patch->>'maxStakeCents')::bigint,       game_config.max_stake),
      min_withdrawal     = coalesce((p_patch->>'minWithdrawalCents')::bigint,  game_config.min_withdrawal),
      default_duration_s = coalesce((p_patch->>'defaultDurationS')::int,       game_config.default_duration_s),
      tick_rate_ms       = coalesce((p_patch->>'tickRateMs')::int,             game_config.tick_rate_ms),
      drift_bias         = coalesce((p_patch->>'driftBias')::numeric,          game_config.drift_bias),
      volatility         = coalesce((p_patch->>'volatility')::numeric,         game_config.volatility),
      target_win_rate    = coalesce((p_patch->>'targetWinRate')::numeric,      game_config.target_win_rate),
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
                      v_after.min_withdrawal, v_after.default_duration_s, v_after.tick_rate_ms, v_after.drift_bias,
                      v_after.volatility, v_after.target_win_rate, v_after.version, v_after.updated_by, v_after.updated_at;
end;
$fn$;

do $mig$
begin
  grant execute on function public.fn_admin_update_game_config(uuid, text, jsonb) to authenticated, service_role;
end
$mig$;
