-- 0027_admin_mfa.sql — TOTP multi-factor auth for administrative accounts.
--
-- The back office can approve withdrawals, adjust balances and change RTP/seed config, so a
-- stolen admin password must not be sufficient on its own. This adds a per-user TOTP secret plus
-- single-use recovery codes. Enforcement is in the app (AuthService): admin/superadmin logins
-- require a code ONCE enrolled, and unenrolled admins are flagged to enrol (grace period) so a
-- rollout can never lock the operator out of their own platform.
--
-- Secrets/recovery hashes live in their own table with RLS enabled and NO policies, exactly like
-- user_credentials (0015): unreachable via anon/authenticated PostgREST, service-role only.
-- Idempotent.

do $$
begin
  create table if not exists public.user_mfa (
    user_id        uuid primary key references public.profiles(id) on delete cascade,
    -- base32 TOTP shared secret (RFC 4648). Write-only from the app's perspective.
    secret         text        not null,
    -- false until the operator proves possession of the device by confirming a live code.
    enabled        boolean     not null default false,
    confirmed_at   timestamptz,
    -- scrypt hashes of single-use recovery codes; the plaintext is shown once at enrolment.
    recovery_codes text[]      not null default '{}',
    created_at     timestamptz not null default now(),
    updated_at     timestamptz not null default now()
  );

  -- keep updated_at fresh (set_updated_at() from 0001)
  create or replace trigger trg_user_mfa_updated
    before update on public.user_mfa
    for each row execute function set_updated_at();

  -- RLS with no policies: MFA secrets are never reachable via anon/authenticated.
  alter table public.user_mfa enable row level security;
  revoke all on table public.user_mfa from anon, authenticated;
end
$$;

-- Operational view for admins: who is enrolled, without exposing any secret material.
create or replace view public.v_mfa_status as
  select p.id            as user_id,
         p.username,
         p.role,
         coalesce(m.enabled, false) as mfa_enabled,
         m.confirmed_at,
         coalesce(array_length(m.recovery_codes, 1), 0) as recovery_codes_left
    from public.profiles p
    left join public.user_mfa m on m.user_id = p.id
   where p.role in ('admin', 'superadmin');
