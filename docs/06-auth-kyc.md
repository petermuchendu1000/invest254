# 06 — Authentication & KYC

> **Update (migration 0018):** Age verification and basic KYC (full name + date of birth)
> have been **removed**. There is no age-gate, no `kyc_status`, and no `PATCH /auth/me`
> profile completion. Registration alone (phone + username + password) grants full access to
> deposit and play. The DOB/name sections below are retained only as historical context.

## 1. Method: Phone + password (MVP, implemented)
Phone is the login identity (the audience is Kenyan and M-Pesa is phone-anchored). Auth is
**self-managed** — no OTP and no Supabase Auth/GoTrue. `profiles.id` is decoupled from
`auth.users` (migration `0015`); credentials live in a locked-down `user_credentials` table and
the engine self-issues JWTs the existing verifier already trusts.

### 1.1 Registration / login flow
```
1. User enters phone (any KE format: 07.., 01.., +254.., 254..) + username + password
2. POST /auth/register { phone, username, password }
   - Engine AuthService validates (shared password/username policy), normalizes the phone to
     MSISDN, scrypt-hashes the password, then calls fn_register_user (SECURITY DEFINER, 0015)
   - fn_register_user atomically inserts profiles (role=player, status=active) + wallets (0/0)
     + user_credentials (the salted hash); uniqueness on phone & username
   - Returns { token, userId, role }
3. POST /auth/login { phone, password }
   - Loads the credential by phone, constant-time scrypt verify, active-status gate
   - Returns { token, userId, role } (generic INVALID_CREDENTIALS on any failure)
4. Client stores the token; sends `Authorization: Bearer <token>` on REST and the WS auth message
```
- **Password hashing:** scrypt (N=2^15, r=8, p=1) with a per-user random salt; verification is
  timing-safe. Stored as a self-describing `scrypt$N$r$p$salt$hash` string so cost can be re-tuned.
- **Tokens:** HS256 JWTs signed with `SUPABASE_JWT_SECRET` (the same secret `makeVerifier` checks),
  `sub`=userId, `role` claim, default 7-day lifetime. No refresh token in the MVP — re-login to renew.
- **Anti-enumeration:** unknown phone still runs a dummy verify; failures return a single generic
  error so registered vs. unregistered phones are indistinguishable.
- Referral attribution and welcome bonus on first registration are planned (the `referred_by`
  column already exists; wire-up tracked with the affiliate milestone).

## 2. Age-gate & basic KYC (MVP, implemented)
- `PATCH /auth/me { full_name, date_of_birth }` records the profile via `fn_set_basic_profile`
  (migration 0016) and sets `kyc_status='basic'`. `date_of_birth` is **immutable once set**.
- **Age check:** DOB must be ≥18; under-18 submissions are rejected (`AGE_RESTRICTED`) and the DOB
  is never persisted. New rows default to `kyc_status='none'`.
- **Enforcement is un-bypassable:** real-money deposit and opening a position both require a stored
  DOB ≥18, checked at transaction time inside the `SECURITY DEFINER` money RPCs
  (`fn_create_deposit` / `fn_open_position`); unverified callers get `AGE_NOT_VERIFIED`. Because
  age is time-dependent it is computed at transaction time, not stored as a static flag.
- Phone is the unique login identity (one account per phone, enforced by `fn_register_user`).
  SMS proof-of-possession of the number can be layered on later without changing the credential model.

## 3. Full KYC (post-MVP)
- ID document upload (front/back) + selfie to Supabase Storage (private bucket).
- Manual or third-party verification; `kyc_status` → `full`/`rejected`.
- Required to raise withdrawal limits / for AML thresholds.

## 4. Roles & permissions
| Role | Can do |
|------|--------|
| player | play, deposit/withdraw, chat, enroll as marketer |
| marketer | player + affiliate dashboard & payouts |
| support | view users, moderate, assist KYC, view (not edit) finances |
| finance_admin | approve withdrawals/affiliate payouts, manual adjustments, reports |
| super_admin | everything incl. game config, roles, promos, bonuses |

Role is stored on `profiles.role`; API middleware + Postgres RLS both enforce it.

## 5. Security
- Passwords: scrypt hashing + timing-safe compare; `user_credentials` has RLS enabled with **no
  policies** (deny-all to `anon`/`authenticated`; only the service-role/SECURITY DEFINER path reads
  it) so hashes are never reachable via PostgREST.
- Login is constant-time with a generic `INVALID_CREDENTIALS` (no user enumeration); `suspended`/
  `banned` accounts are rejected (`ACCOUNT_SUSPENDED`/`ACCOUNT_BANNED`).
- Login brute-force throttling (per-phone/IP) is an edge concern; planned alongside a device/session
  list and a suspicious-login flag (new device + immediate withdrawal).
- All auth events written to `audit_log`.

## 6. Engine (WebSocket) authentication
Tokens are **self-issued** by the API's AuthService (HS256, `SUPABASE_JWT_SECRET`). The realtime
engine independently **verifies the JWT** on the socket `auth` message and derives the user from the
token's `sub` (never trusts a client-supplied id):
- **HS256** using the Supabase project JWT secret (`SUPABASE_JWT_SECRET`), or
- **Asymmetric (RS256/ES256)** via the project JWKS (`SUPABASE_JWKS_URL`), with optional issuer/
  audience pinning.
Verification uses the vetted `jose` library; expired/tampered/missing-`sub` tokens are rejected with
`AUTH_INVALID`. The engine **fails closed**: when `DATABASE_URL` is set (production), a verifier is
required or the engine refuses to start.
