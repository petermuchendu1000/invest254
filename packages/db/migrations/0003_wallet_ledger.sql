do $mig$
begin
  create table if not exists public.wallets (
    user_id       uuid primary key references public.profiles(id) on delete cascade,
    real_balance  bigint not null default 0 check (real_balance  >= 0),
    bonus_balance bigint not null default 0 check (bonus_balance >= 0),
    currency      text   not null default 'KES',
    updated_at    timestamptz not null default now()
  );
  drop trigger if exists trg_wallets_updated on public.wallets;
  create trigger trg_wallets_updated before update on public.wallets
    for each row execute function public.set_updated_at();

  create table if not exists public.ledger_entries (
    id           bigserial primary key,
    user_id      uuid not null references public.profiles(id),
    type         text not null check (type in
                 ('deposit','withdrawal','stake','payout','bonus','affiliate_commission',
                  'adjustment','refund','withdrawal_reversal')),
    amount       bigint not null,
    balance_kind text not null default 'real' check (balance_kind in ('real','bonus')),
    ref_table    text,
    ref_id       text,
    meta         jsonb default '{}'::jsonb,
    created_at   timestamptz not null default now()
  );
  create index if not exists idx_ledger_user_created on public.ledger_entries(user_id, created_at);
end
$mig$;

