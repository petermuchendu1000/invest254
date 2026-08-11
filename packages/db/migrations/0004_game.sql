do $mig$
begin
  create table if not exists public.game_config (
    id                 int primary key default 1 check (id = 1),
    house_edge         numeric not null default 0.75 check (house_edge >= 0 and house_edge < 1),
    max_multiplier     numeric not null default 5.0  check (max_multiplier > 1),
    min_stake          bigint  not null default 5000 check (min_stake > 0),
    max_stake          bigint  not null default 5000000 check (max_stake >= min_stake),
    default_duration_s int     not null default 10   check (default_duration_s > 0),
    tick_rate_ms       int     not null default 150  check (tick_rate_ms > 0),
    drift_bias         numeric not null default 0.02,
    volatility         numeric not null default 1.0  check (volatility > 0),
    updated_by         uuid references public.profiles(id),
    updated_at         timestamptz not null default now()
  );
  drop trigger if exists trg_game_config_updated on public.game_config;
  create trigger trg_game_config_updated before update on public.game_config
    for each row execute function public.set_updated_at();

  create table if not exists public.game_days (
    id               bigserial primary key,
    trade_date       date not null unique,
    server_seed      text,
    server_seed_hash text not null,
    revealed_at      timestamptz
  );

  create table if not exists public.positions (
    id          uuid primary key default gen_random_uuid(),
    user_id     uuid not null references public.profiles(id),
    game_day_id bigint references public.game_days(id),
    direction   text not null check (direction in ('buy','sell')),
    stake       bigint not null check (stake > 0),
    entry_rate  numeric not null,
    exit_rate   numeric,
    multiplier  numeric check (multiplier is null or multiplier >= 0),
    payout      bigint  check (payout is null or payout >= 0),
    pnl         bigint,
    result      text check (result in ('win','loss','void')),
    duration_s  int not null check (duration_s > 0),
    status      text not null default 'open' check (status in ('open','settled','void')),
    nonce       bigint not null,
    opened_at   timestamptz not null default now(),
    settled_at  timestamptz
  );
  create index if not exists idx_positions_user_opened on public.positions(user_id, opened_at);
  create index if not exists idx_positions_status on public.positions(status);
end
$mig$;

