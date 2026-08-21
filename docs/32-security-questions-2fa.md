# 32 — Security-questions second factor for privileged password resets (0097)

## The vulnerability

`POST /api/v1/auth/password/reset` (engine `AuthService.resetPassword`) sets a new password from a
**phone number + new password alone** — no OTP, no possession proof. It is gated only by the
`ALLOW_UNVERIFIED_PASSWORD_RESET` environment flag. For an **admin / superadmin /
platform_superadmin** that is account takeover: anyone who knows the operator's phone number can seize
the back office (approve withdrawals, adjust balances, change RTP/seed config).

> **Live status at time of fix:** `ALLOW_UNVERIFIED_PASSWORD_RESET` is **not** set on the production
> API (Fly app `invest254-api`), so the phone-only reset currently returns `RESET_DISABLED`. The fix
> still matters: it makes privileged reset **permanently** safe (independent of the flag) and lets
> admins self-serve a reset that is genuinely protected by a knowledge factor.

Production roles (Supabase, at fix time): `player` (535), `marketer` (12), `admin` (2),
`platform_superadmin` (1). **There is no literal `superadmin` role** — the real "superadmin" is
`platform_superadmin`, so it MUST be in the privileged set or the top account goes unprotected.

## The fix (three parts)

1. **Knowledge second factor on privileged reset (fail-closed).** For any privileged account,
   `resetPassword` now **requires all three** stored security answers to verify — **independent of the
   unverified-reset flag**. If the account has not set answers yet the reset is **refused**
   (`SECURITY_QUESTIONS_NOT_SET`, 403), so the phone-only vector is shut even before setup completes.
   Player resets are unchanged (still flag-gated; answers ignored).

2. **Force-logout of all current admin sessions.** `profiles.sessions_valid_after` (nullable
   timestamptz) is a per-account force-logout epoch. The API JWT verifier is wrapped so a **privileged**
   token whose `iat` precedes this epoch is rejected (→ 401 → re-login). Only privileged tokens pay the
   DB read; high-volume player traffic is untouched. The check **fails closed** on DB error.

3. **Mandatory setup on next login.** `GET /auth/me` returns `securitySetupRequired: true` for a
   privileged account without answers. The web shows a **non-dismissible full-screen gate**
   (`SecurityQuestionsGate`) forcing the operator to set three answers before continuing. Enforcement
   is also server-side (reset fails closed), so a bypassed client cannot skip protection.

## Questions & answers

Google-style catalog lives dependency-free in `packages/shared/src/security-questions.ts` (imported by
both engine and web). A user picks **3 distinct** questions. Answers are **normalized**
(trim + collapse whitespace + lowercase, diacritics preserved) then **scrypt-hashed with the same
scheme as passwords** (`AuthService.hashPassword`) — plaintext never touches the DB. Matching is
case/whitespace-insensitive by design.

## Endpoints (all under `/api/v1`)

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET  | `/auth/security-questions/catalog` | public | The selectable question catalog `{key,label}` |
| POST | `/auth/security-questions` | bearer | Set (replace) my three answers `{answers:[{key,answer}]}` |
| POST | `/auth/password/reset-questions` | public | Step 1: `{phone,site?}` → `{keys}` (empty for non-privileged/unknown — anti-enumeration) |
| POST | `/auth/password/reset` | public | Now accepts `answers:[{key,answer}]`; required+verified for privileged accounts |
| GET  | `/auth/me` | bearer | Now returns `securitySetupRequired` |

## Schema — migration `0097_security_questions.sql`

- `public.user_security_answers(user_id, question_key, answer_hash, created_at, updated_at)`,
  PK `(user_id, question_key)`, **RLS enabled with no policies** (service-role only, mirrors
  `user_credentials`/`user_mfa`), index on `user_id`.
- `public.profiles.sessions_valid_after timestamptz` (nullable; NULL = never force-logged-out).
- Additive, idempotent, money-neutral. Revert notes in the file tail.

The migration is **structural only**. The force-logout STAMP is a deliberate, separate operational
step run at rollout (see below), so applying the migration never disrupts a live session on its own.

## Rollout order (must be followed)

1. **Apply migration 0097** (done — table/column live; ledger stamped). Harmless until code deploys.
2. **Deploy API + engine** (Fly `invest254-api`, `invest254-engine`) — verifier force-logout check,
   the new endpoints, and `/auth/me` flag. Deploy **web** (Cloudflare Pages) — the setup gate + reset
   flow. Deploying API before web only means admins briefly don't see the gate; nothing breaks.
3. **Stamp the force-logout** to invalidate every current privileged session:
   ```sql
   update public.profiles set sessions_valid_after = now()
    where role in ('admin','superadmin','platform_admin','platform_superadmin');
   ```
   Each admin is then forced to log in again and immediately hits the mandatory setup gate.

> Do step 3 only AFTER step 2 is live, so a force-logged-out admin can log back in and set answers.
> Until an admin sets answers, their reset fails closed (safe), and they can still log in normally
> (login is not blocked — only the reset path and the client gate are).

## Tests

- `packages/shared/src/security-questions.test.ts` — catalog integrity, normalization, validation.
- `apps/engine/src/authservice.security.test.ts` — fail-closed reset, all/one-wrong/missing answers,
  normalization on verify, setup validation, `securitySetupRequired` by role, reset-key disclosure,
  and force-logout (`assertSessionValid` / `isTokenSessionValid`).
- `apps/api/src/app.auth.security.test.ts` — catalog, set answers, `/auth/me` flag, reset-questions,
  reset with correct/wrong answers, fail-closed 403, anti-enumeration for players.
- Real-Postgres validation of the exact 0097 SQL (CTE upsert + prune, reads, session epoch) was run
  inside a rolled-back transaction (no data persisted). Full suite: **609 pass / 0 fail**.
