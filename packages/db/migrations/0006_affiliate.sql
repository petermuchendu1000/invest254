do $mig$
begin
  create table if not exists public.affiliates (
    user_id         uuid primary key references public.profiles(id),
    referral_code   text unique not null,
    commission_rate numeric not null default 0.20 check (commission_rate >= 0 and commission_rate <= 1),
    status          text not null default 'active' check (status in ('active','suspended')),
    created_at      timestamptz not null default now()
  );
  create table if not exists public.referrals (
    id            bigserial primary key,
    affiliate_id  uuid not null references public.affiliates(user_id),
    referred_user uuid not null unique references public.profiles(id),
    created_at    timestamptz not null default now()
  );
  create table if not exists public.affiliate_commissions (
    id            bigserial primary key,
    affiliate_id  uuid not null references public.affiliates(user_id),
    referred_user uuid not null references public.profiles(id),
    period        date not null,
    ggr           bigint not null,
    commission    bigint not null,
    status        text not null default 'accrued' check (status in ('accrued','paid','reversed')),
    created_at    timestamptz not null default now()
  );
  create unique index if not exists uq_commission_bucket
    on public.affiliate_commissions(affiliate_id, referred_user, period);
  create table if not exists public.affiliate_payouts (
    id           uuid primary key default gen_random_uuid(),
    affiliate_id uuid not null references public.affiliates(user_id),
    amount       bigint not null check (amount > 0),
    status       text not null default 'requested'
                 check (status in ('requested','approved','paid','rejected')),
    approved_by  uuid references public.profiles(id),
    created_at   timestamptz not null default now()
  );
end
$mig$;

