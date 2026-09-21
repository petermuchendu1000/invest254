# 39 — Security: authorisation & tenant-isolation audit (2026-09-21)

> Findings from a read-only audit of the PRODUCTION database, its PostgREST surface and the API's
> guard layer, plus the fixes. All four findings were present on `main` at `b7c78be`.
> **No evidence of exploitation** was found for findings 01/02; finding 03 WAS being exercised by a
> legitimate account (see §3).

## 1. The tier model, restated

```
SYSTEM   platform_superadmin  -> every platform        (zrinok)
  PLATFORM platform_admin     -> sites in ONE platform (scoped by profiles.platform_id)
    SITE   admin              -> exactly one brand     (scoped by profiles.site_id)
      marketer / player
```

Two enforcement layers exist, and it matters which one is authoritative:

- **The API connects as the table owner (`postgres`)**, so **RLS does not apply to it**. The API's
  guards + the `SECURITY DEFINER` RPCs are the real gate.
- RLS + the anon/authenticated PostgREST path is **defence in depth** for the public keys.

## 2. Finding 01 (P1) — the public anon key could execute 47+ privileged RPCs

**Symptom.** With the PUBLIC browser anon key, `POST /rest/v1/rpc/fn_admin_set_user_role` responded
with RPC business logic rather than a permission error.

**Cause.** Supabase grants `EXECUTE` on every function created in `public` to `anon`/`authenticated`
by DEFAULT PRIVILEGE (`pg_default_acl`, `defaclobjtype='f'`). `0010`–`0047` revoked this per
function, but each later `CREATE OR REPLACE`, and each new overload, is a **new function** that
silently returns to the default ACL. Because the exposed functions are `SECURITY DEFINER`, RLS does
not apply to them: a caller-supplied role string was sufficient to escalate a role or move money.

**Fix — `0151_function_execute_lockdown.sql`.**

- `SECURITY DEFINER` ⇒ `service_role` + owner only.
- plain (invoker) functions keep `EXECUTE` for `anon`/`authenticated`, because **RLS policies call
  them** (`is_site_admin`, `current_site`, `current_platform`) — a blanket revoke would break RLS.
- the implicit `PUBLIC` grant is removed from every function.
- a `lock_definer_execute` **event trigger** re-applies the rule to every function created from now
  on. `ALTER DEFAULT PRIVILEGES` was measured and **does not** suppress the implicit `PUBLIC` grant
  on functions, so it is not a durable control.

**Evidence** (`packages/db/_testkit/e2e_function_acl.py`, which emulates the Supabase posture):

| stage | SECURITY DEFINER fns anon/authenticated-executable |
|---|---|
| migrations ≤ 0150 | **47** |
| after 0151 | **0** |
| a function created after 0151 | **0** (auto-locked) |
| owner (the API's role) can still execute every definer RPC | **yes** |

## 3. Finding 03 (P1) — platform scope failed OPEN on a missing claim

**Symptom, from `admin_actions`.** `thegenius` — a `platform_admin` scoped to platform `nduati`
(one brand) — impersonated brand admins **outside its platform**:

```
2026-09-21 17:25:54  platform.impersonate  Tamu Traders   <- platform MUCHENDU
2026-09-21 17:27:10  platform.impersonate  Invest254      <- platform MUCHENDU
2026-09-21 17:28:43  platform.impersonate  Tamu Traders   <- platform MUCHENDU
2026-09-21 17:03:00  platform.impersonate  ShikaFX        <- platform NDUATI (in scope)
```

**Cause.** `adminScopePlatform()` returned `ctx.claims.platform ?? null`, and `null` is the sentinel
the module reserves for the system owner (**unrestricted**). A platform_admin whose token lacked the
`platform` claim was therefore promoted to system-wide: `scopeSiteParam` returned early,
`assertTargetPlatformInScope` skipped its check, and `listSites(null)` resolved to
`where ($1::uuid is null or …)` = **every brand**. The same class of bug existed for the site tier:
`adminScopeSite()` returned `ctx.claims.site ?? null`, so a site admin with no `site` claim was
unrestricted in the back office.

**Fix — `apps/api/src/http.ts`.** A missing or unresolvable scope key is now **refused**
(`PLATFORM_SCOPE_REQUIRED` / `SITE_SCOPE_REQUIRED`, 403) and the "tolerant" branches in
`assertTargetPlatformInScope` / `assertTargetSiteInScope` now fail closed instead of deferring.

**Regression pinned** in `apps/api/src/http.scope.failclosed.test.ts` (8 tests) — including the
`@thegenius` case: a platform_admin with no `platform` claim must throw, not return `null`.

## 4. Finding 02 (P1, staged) — privileged RPCs trust a caller-supplied role string

Every `fn_*(p_actor uuid, p_actor_role text, …)` validates the **string** and never reads the
actor's real role from `profiles` — nor even checks that the actor exists. This is what turned
finding 01 from a leak into total control.

**Status: contained, not yet rewritten.** 0151 removes the reachability that made this exploitable
(the API is the only remaining caller, and it derives the role from a verified JWT). A correct fix
touches ~60 function bodies plus 14 e2e harnesses that pass synthetic actor UUIDs — a blast radius
that must be staged and measured rather than landed blind on a live money system.

**Planned fix.** Add `fn_actor_rank(text)` / `fn_assert_actor(uuid, text)` and inject
`perform public.fn_assert_actor(p_actor, p_actor_role)` at the head of each `p_actor_role` routine,
rejecting any supplied role that outranks the actor's real role. Legitimate calls are unaffected
(the API's token role never exceeds the DB role, including under impersonation, where the token role
is *lower*). The 14 harnesses that pass a synthetic actor must be switched to a real profile row.

## 5. Finding 04 (design review) — impersonation mints an elevated token

`POST /platform/sites/:id/impersonate` issues `issueToken(actorId, "superadmin" | "admin", siteId)`
— i.e. for the **actor**, elevated. With finding 03 fixed the brand is now genuinely bounded to the
actor's platform, so this is no longer a cross-tenant hole; but the elevation itself, and the
absence of an expiry, deserve an explicit decision.

## 6. Verified clean

- RLS enabled on **84/84** `public` tables; 54 have RLS and no policy ⇒ default-deny.
- anon read of `profiles` returns `[]` (RLS filtered correctly).
- Exactly one `platform_superadmin` exists; no rogue owner account.
- Every `admin_actions` actor is a real, known user — no anonymous actor ids.
- The `fn_platform_*` / `fn_addon_*` families are correctly revoked (the pattern 0151 generalises).

## 7. Test evidence

- DB e2e: **25 suites** applied clean. All suites pass except `e2e_marketer_login_phone.py`
  (9 failures), which **also fails on the pre-fix migration set** — pre-existing, unrelated to 0151.
- New: `e2e_function_acl.py` (6 checks) — reproduces the exposure, proves it closed.
- TS: `npm run typecheck` clean; the scope suites pass 14/14.

## 8. Out of scope / follow-ups

- `fn_admin_get_mpesa_config` takes **only** a role string and was anon-reachable; it was not called
  during the audit (a success would have pulled live payment credentials). 0151 closes it.
- `apps/api/src/app.platform.ts` impersonation token TTL (see §5).
- Environment mismatches noted while auditing: `mitasafi89.com` is not a zone in the Cloudflare
  account the supplied token belongs to, and `0135` is used by two different migration filenames.
