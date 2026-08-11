do $mig$
begin
  create table if not exists public.activity_feed (
    id           bigserial primary key,
    kind         text not null check (kind in ('withdrawal','win','bonus','signup')),
    username     text not null,
    amount       bigint,
    is_simulated boolean not null default false,
    message      text not null,
    created_at   timestamptz not null default now()
  );
  create index if not exists idx_activity_created on public.activity_feed(created_at desc);

  create table if not exists public.chat_messages (
    id         bigserial primary key,
    user_id    uuid references public.profiles(id),
    username   text not null,
    message    text not null,
    is_hidden  boolean not null default false,
    created_at timestamptz not null default now()
  );
  create index if not exists idx_chat_created on public.chat_messages(created_at desc);

  create table if not exists public.bonuses (
    id         uuid primary key default gen_random_uuid(),
    user_id    uuid references public.profiles(id),
    code       text,
    type       text not null check (type in ('welcome','promo','manual')),
    amount     bigint not null check (amount >= 0),
    wagering_x numeric not null default 1.0 check (wagering_x >= 0),
    wagered    bigint not null default 0 check (wagered >= 0),
    status     text not null default 'active' check (status in ('active','cleared','expired','void')),
    expires_at timestamptz,
    created_at timestamptz not null default now()
  );

  create table if not exists public.promo_codes (
    code       text primary key,
    type       text not null default 'deposit_match',
    value      numeric not null,
    max_amount bigint,
    wagering_x numeric not null default 1.0,
    uses_left  int,
    expires_at timestamptz,
    active     boolean not null default true
  );

  create table if not exists public.audit_log (
    id        bigserial primary key,
    actor_id  uuid references public.profiles(id),
    action    text not null,
    entity    text,
    entity_id text,
    before    jsonb,
    after     jsonb,
    created_at timestamptz not null default now()
  );
  create index if not exists idx_audit_actor on public.audit_log(actor_id, created_at);
end
$mig$;

