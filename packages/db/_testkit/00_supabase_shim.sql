-- Local test shim: emulate the Supabase objects the migrations expect, so the full
-- migration set (0001-0046) can be applied and e2e-tested against a vanilla Postgres.
-- NOT part of the product; used only by the sandbox e2e harness.

-- Roles the GRANT statements target.
do $$ begin
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role nologin bypassrls; end if;
end $$;

-- Supabase auth schema + minimal users table + uid()/jwt helpers used by RLS policies.
create schema if not exists auth;
create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  phone text,
  created_at timestamptz default now()
);

-- auth.uid(): reads a GUC we set per-connection in tests to simulate the logged-in user.
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

grant usage on schema auth to anon, authenticated, service_role;
