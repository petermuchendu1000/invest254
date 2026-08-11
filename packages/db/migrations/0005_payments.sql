do $mig$
begin
  create table if not exists public.transactions (
    id                  uuid primary key default gen_random_uuid(),
    user_id             uuid not null references public.profiles(id),
    kind                text not null check (kind in ('deposit','withdrawal')),
    amount              bigint not null check (amount > 0),
    status              text not null default 'pending'
                        check (status in ('pending','processing','success','failed','reversed')),
    provider            text not null default 'mpesa',
    phone               text not null,
    merchant_request_id text,
    checkout_request_id text,
    mpesa_receipt       text,
    conversation_id     text,
    result_code         int,
    result_desc         text,
    approved_by         uuid references public.profiles(id),
    raw_callback        jsonb,
    created_at          timestamptz not null default now(),
    updated_at          timestamptz not null default now()
  );
  drop trigger if exists trg_tx_updated on public.transactions;
  create trigger trg_tx_updated before update on public.transactions
    for each row execute function public.set_updated_at();
  create index if not exists idx_tx_user_created on public.transactions(user_id, created_at);
  create index if not exists idx_tx_checkout on public.transactions(checkout_request_id);
end
$mig$;

