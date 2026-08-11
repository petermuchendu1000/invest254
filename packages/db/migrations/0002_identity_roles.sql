do $mig$
begin
  create table if not exists public.profiles (
    id            uuid primary key references auth.users(id) on delete cascade,
    phone         text unique not null,
    username      text unique not null,
    full_name     text,
    date_of_birth date,
    role          text not null default 'player'
                  check (role in ('player','marketer','support','finance_admin','super_admin')),
    status        text not null default 'active'
                  check (status in ('active','suspended','banned')),
    kyc_status    text not null default 'basic'
                  check (kyc_status in ('none','basic','full','rejected')),
    referred_by   uuid references public.profiles(id),
    created_at    timestamptz not null default now()
  );
  create index if not exists idx_profiles_referred_by on public.profiles(referred_by);
end
$mig$;

