-- 0015 self-managed phone + password identity (no Supabase Auth / GoTrue, no OTP)
-- Decouples profiles.id from auth.users so identity is owned by this schema, stores a
-- salted password hash in a locked-down user_credentials table, and exposes one atomic
-- registration RPC. The engine self-issues HS256 JWTs (same secret makeVerifier checks),
-- so every already-built authenticated route/WS keeps working unchanged.
-- Security: user_credentials has RLS enabled with NO policies (deny-all to anon/authenticated;
-- service_role bypasses RLS). fn_register_user is SECURITY DEFINER, service-role only,
-- and returns a generic conflict so it can't be used to enumerate users.

-- ── Structural: decouple identity + credentials table + RLS lockdown ──────────────────
do $m$
begin
  -- decouple profiles.id from Supabase Auth (auth.users): identity is now self-managed
  if exists (
    select 1 from pg_constraint
    where conname = 'profiles_id_fkey' and conrelid = 'public.profiles'::regclass
  ) then
    alter table public.profiles drop constraint profiles_id_fkey;
  end if;

  -- credentials: salted password hash, 1:1 with profiles, cascades on profile delete
  create table if not exists public.user_credentials (
    user_id       uuid primary key references public.profiles(id) on delete cascade,
    password_hash text not null,
    updated_at    timestamptz not null default now()
  );

  -- keep updated_at fresh (set_updated_at() from 0001)
  create or replace trigger trg_user_credentials_updated
    before update on public.user_credentials
    for each row execute function set_updated_at();

  -- RLS with no policies: password hashes are never reachable via anon/authenticated (PostgREST)
  alter table public.user_credentials enable row level security;
  revoke all on table public.user_credentials from anon, authenticated;
end
$m$;

-- ── Atomic registration RPC: profile + wallet + credentials in one transaction ──────────
create or replace function public.fn_register_user(p_phone text, p_username text, p_password_hash text)
returns table(user_id uuid, role text)
language plpgsql security definer set search_path = public
as $fn$
declare v_id uuid;
begin
  if p_phone is null or length(p_phone) < 8 then raise exception 'INVALID_PHONE'; end if;
  if p_username is null or length(p_username) < 3 then raise exception 'INVALID_USERNAME'; end if;
  if p_password_hash is null or length(p_password_hash) < 20 then raise exception 'INVALID_HASH'; end if;
  if exists (select 1 from profiles where phone = p_phone) then raise exception 'PHONE_TAKEN'; end if;
  if exists (select 1 from profiles where username = p_username) then raise exception 'USERNAME_TAKEN'; end if;
  insert into profiles(phone, username) values (p_phone, p_username) returning id into v_id;
  insert into wallets(user_id) values (v_id);
  insert into user_credentials(user_id, password_hash) values (v_id, p_password_hash);
  return query select v_id, (select pr.role from profiles pr where pr.id = v_id);
exception
  when unique_violation then raise exception 'REGISTRATION_CONFLICT';
end
$fn$;

-- ── Grants: service-role only ─────────────────────────────────────────
do $g$
begin
  revoke all on function public.fn_register_user(text,text,text) from public;
  revoke all on function public.fn_register_user(text,text,text) from anon;
  revoke all on function public.fn_register_user(text,text,text) from authenticated;
  grant execute on function public.fn_register_user(text,text,text) to service_role;
end
$g$;
