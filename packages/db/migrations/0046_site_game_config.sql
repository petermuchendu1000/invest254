-- 0046_site_game_config.sql — Per-site game configuration + versioning + change notify.
--
-- Single-tenant Invest254 had ONE `game_config` singleton (id = 1). Multi-tenant needs one
-- config per brand so each site tunes its own economics (RTP/house edge, stakes, ×cap, tick
-- rate, drift/volatility, win rate) independently. This adds `site_game_config` keyed by
-- site_id, seeded for the DEFAULT site from the existing singleton, plus an immutable
-- version history and a pg_notify the MULTIPLEXED engine LISTENs on — the payload carries the
-- site_id so the engine rebuilds only that brand's curve/settlement, never the others'.
--
-- Feasibility CHECK mirrors packages/shared checkFeasible(): RTP / targetWinRate ∈ (1, maxMult].
--
-- Idempotent, single-statement DO block.

do $$
declare
  default_site constant uuid := '00000000-0000-0000-0000-000000000001';
begin
  create table if not exists public.site_game_config (
    site_id            uuid primary key references public.sites(id) on delete cascade,
    house_edge         numeric not null default 0.75,
    max_multiplier     numeric not null default 5.0,
    min_stake          bigint  not null default 25000,   -- KES 250.00 (cents)
    max_stake          bigint  not null default 5000000,
    min_withdrawal     bigint  not null default 25000,
    default_duration_s int     not null default 10,
    tick_rate_ms       int     not null default 150,
    drift_bias         numeric not null default 0.30,
    volatility         numeric not null default 1.0,
    target_win_rate    numeric not null default 0.125,
    version            bigint  not null default 1,
    updated_by         uuid,
    updated_at         timestamptz not null default now(),
    -- feasibility: winners must profit and the cap must be reachable (mirrors assertFeasible)
    constraint site_cfg_feasible check (
      house_edge >= 0 and house_edge < 1
      and max_multiplier > 1
      and target_win_rate > 0 and target_win_rate <= 1
      and volatility > 0
      and drift_bias >= -1 and drift_bias <= 1
      and tick_rate_ms between 50 and 60000
      and default_duration_s between 1 and 3600
      and ((1 - house_edge) / target_win_rate) > 1
      and ((1 - house_edge) / target_win_rate) <= max_multiplier
    )
  );

  -- Immutable per-site version snapshot (crash recovery re-prices under the version that was
  -- live when a position opened — positions.config_version already exists from 0028).
  create table if not exists public.site_game_config_versions (
    site_id            uuid not null references public.sites(id) on delete cascade,
    version            bigint not null,
    house_edge         numeric not null,
    max_multiplier     numeric not null,
    min_stake          bigint  not null,
    max_stake          bigint  not null,
    min_withdrawal     bigint  not null,
    default_duration_s int     not null,
    tick_rate_ms       int     not null,
    drift_bias         numeric not null,
    volatility         numeric not null,
    target_win_rate    numeric not null,
    created_at         timestamptz not null default now(),
    primary key (site_id, version)
  );

  -- Seed the DEFAULT site's config from the existing singleton if present, else from defaults.
  insert into public.site_game_config (
    site_id, house_edge, max_multiplier, min_stake, max_stake, min_withdrawal,
    default_duration_s, tick_rate_ms, drift_bias, volatility, target_win_rate, version)
  select default_site,
         coalesce(g.house_edge, 0.75), coalesce(g.max_multiplier, 5.0),
         coalesce(g.min_stake, 25000), coalesce(g.max_stake, 5000000),
         coalesce(g.min_withdrawal, 25000), coalesce(g.default_duration_s, 10),
         coalesce(g.tick_rate_ms, 150), coalesce(g.drift_bias, 0.30),
         coalesce(g.volatility, 1.0), coalesce(g.target_win_rate, 0.125),
         coalesce(g.version, 1)
    from (select * from public.game_config where id = 1) g
  on conflict (site_id) do nothing;

  -- Guarantee a row for the default site even if the singleton was missing.
  insert into public.site_game_config (site_id) values (default_site)
  on conflict (site_id) do nothing;

  insert into public.site_game_config_versions (
    site_id, version, house_edge, max_multiplier, min_stake, max_stake, min_withdrawal,
    default_duration_s, tick_rate_ms, drift_bias, volatility, target_win_rate)
  select site_id, version, house_edge, max_multiplier, min_stake, max_stake, min_withdrawal,
         default_duration_s, tick_rate_ms, drift_bias, volatility, target_win_rate
    from public.site_game_config
  on conflict (site_id, version) do nothing;

  -- Bump version + snapshot + notify on every write. Payload = site_id so the multiplexed
  -- engine refreshes exactly one brand's pricing context.
  create or replace function public.fn_site_game_config_after_write() returns trigger
  language plpgsql as $fn$
  begin
    if tg_op = 'UPDATE' then
      if row(new.house_edge,new.max_multiplier,new.min_stake,new.max_stake,new.min_withdrawal,
              new.default_duration_s,new.tick_rate_ms,new.drift_bias,new.volatility,new.target_win_rate)
         is distinct from
         row(old.house_edge,old.max_multiplier,old.min_stake,old.max_stake,old.min_withdrawal,
              old.default_duration_s,old.tick_rate_ms,old.drift_bias,old.volatility,old.target_win_rate)
      then
        new.version := old.version + 1;
        new.updated_at := now();
      end if;
    end if;
    insert into public.site_game_config_versions (
      site_id, version, house_edge, max_multiplier, min_stake, max_stake, min_withdrawal,
      default_duration_s, tick_rate_ms, drift_bias, volatility, target_win_rate)
    values (new.site_id, new.version, new.house_edge, new.max_multiplier, new.min_stake,
            new.max_stake, new.min_withdrawal, new.default_duration_s, new.tick_rate_ms,
            new.drift_bias, new.volatility, new.target_win_rate)
    on conflict (site_id, version) do nothing;
    perform pg_notify('site_game_config_changed', new.site_id::text);
    return new;
  end $fn$;

  drop trigger if exists trg_site_game_config_write on public.site_game_config;
  create trigger trg_site_game_config_write
    before update or insert on public.site_game_config
    for each row execute function public.fn_site_game_config_after_write();
end $$;
