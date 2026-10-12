# 59 — Security audit (2026-10) and hardening

A black-hat audit of the whole system across four surfaces: information disclosure, authorization /
multi-tenant isolation, money-movement integrity, and auth / tokens / webhooks / SSRF. Overall the
platform is unusually well-hardened — no live cross-tenant or privilege-escalation exploit was
landed, every real-money payout path is password-gated and phone-locked, and the money RPCs are
`FOR UPDATE`-locked and idempotent. The findings below are the residual weaknesses, ranked, each
marked **FIXED** (done in this pass, tested), **PROPOSED** (a live money / global-auth change held
for explicit owner approval — see the PR discussion), or **NOTED** (accepted / follow-up).

## FIXED in this pass (information-disclosure + reject-malicious-only)

| # | What | Where |
|---|---|---|
| D1 | 404/405 no longer echo the attacker-supplied method/path | `apps/api/src/http.ts` dispatcher |
| D2 | Every JSON response is `Cache-Control: no-store` (bearer tokens in several) | `http.ts` `sendJson` |
| D3 | `Access-Control-Allow-Headers` no longer advertises the dev-only `X-User-Id`/`X-User-Role` | `http.ts` `applyCors` |
| D4 | Postgres economy-feasibility CHECK → curated 422, not raw pg text naming the table + constraint | `app.admin.ts`, `app.platform.ts` |
| D5 | `SITE_NOT_FOUND` no longer reflects the caller-supplied host | `app.site.ts`, `app.activity.ts` |
| D6 | `captureConsole` object args run through the key-based redactor before hitting `system_logs` | `apps/engine/src/systemlog.ts` |
| S1 | **SSRF + gateway-secret exfiltration** via the provider "test connection" `base_url`: a caller-chosen `http://169.254.169.254/…` / internal host turned the probe (which carries the decrypted provider secret) into blind SSRF + credential exfiltration. Now rejected before any fetch: https-only, no loopback/private/link-local/metadata/`.internal`. | `apps/engine/src/gatewaytest.ts` `assertSafeGatewayUrl` |
| S2 | Non-constant-time secret compares → timing side-channel on the Telegram webhook secret and the Paynicorn postback signature. Both now `timingSafeEqual`. | `app.telegram.ts`, `apps/engine/src/paynicorn.ts` |

Residual on S1: a public hostname that later DNS-rebinds to a private address is not caught (needs
resolve-and-pin); the direct-literal and internal-hostname vectors the audit demonstrated are closed.

## PROPOSED — held for owner approval (touch the LIVE deposit rail / global auth)

These are the high-severity findings. Each changes a path that, done wrong, **halts real customer
deposits or all authentication**, so they are not shipped autonomously. Proposed fixes and the one
infrastructure question are in the PR discussion.

### C-1 (CRITICAL) — forged M-Pesa C2B Pay Bill confirmation mints real balance
`POST /api/v1/deposits/c2b/confirmation` (`app.payments.ts`) is public, guarded only by the
fail-open CIDR check. Unlike every STK rail it has **no provider re-query** (Safaricom can't be
re-queried for C2B), **no amount cap**, and **no shortcode validation** — it trusts the posted
`TransID`/`TransAmount`. A forged confirmation with a fresh `TransID` + any amount is stored
(`fn_ingest_c2b`), then `POST /deposits/paybill/claim` credits it to `wallets.real_balance` (and
pays 5% referral). The rail is **live** (`paybill_config` enabled, 308 C2B payments seen). Cash-out
still passes the password-gated withdrawal approval, so this is "mint balance the business will
honour on approval + farm referral", not instant cash — but it is the single most severe hole.
*Proposed:* require the C2B CIDR lock to be configured (fail **closed**), validate `BusinessShortCode`
against `paybill_config`, and apply the deposit max-amount cap in the ingest/claim path — designed so
a legitimate Safaricom confirmation always passes.

### C-2 (CRITICAL, enables C-1) — `clientIp()` trusts caller headers
`clientIp()` (`http.ts`) prefers inbound `Fly-Client-IP`, then `X-Forwarded-For[0]`, both
client-settable, so the callback CIDR allowlist is spoofable at the app layer unless the edge
guarantees overwrite. *Proposed:* derive the client IP from a trusted source only (Fly's edge value,
never a raw `X-Forwarded-For[0]`). **Needs owner confirmation** that the Fly app is reachable only via
Fly's proxy (so `Fly-Client-IP` is authoritative), or a trusted-hop count.

### C-3 (HIGH) — STK deposit forge when `MPESA_VERIFY_CALLBACKS=false`
The escape hatch disables the Safaricom re-query, leaving a forged STK callback able to credit a
deposit (behind the same spoofable CIDR). *Proposed:* remove the hatch, or hard-require a trustworthy
IP lock whenever it is off.

### A1 (MEDIUM) — marketer money/PIN RPCs have no DB-level tenant fence
The user-money RPCs got `fn_assert_actor_site_scope` in 0156; the marketer RPCs
(`fn_marketer_credit`/`_set_pin`/…) take no actor/role/site argument and act by primary key. Tenant
isolation for crediting a marketer and resetting a marketer PIN (account takeover) rests **entirely**
on the TypeScript `marketerInScope` guard — strict and fail-closed today, so no live breach, but a
single future TS slip = cross-tenant takeover with no backstop. *Proposed:* give these RPCs the same
actor-scope fence (a migration mirroring 0156), as defense-in-depth.

### AU1 (MEDIUM) — JWT `iss`/`aud` unenforced unless configured
`makeVerifier` (`apps/engine/src/auth.ts`) only checks `iss`/`aud` when the env vars are set, so by
default any token validly signed with `SUPABASE_JWT_SECRET` (e.g. a Supabase-Auth-minted token on the
same project) is accepted as a principal. Algorithm IS pinned (no alg-confusion). *Proposed:* make
`iss`/`aud` mandatory in production, and/or honour only self-issued roles. **Needs owner confirmation**
of the production token issuer/audience values before enforcing (enforcing with wrong/absent values
rejects all logins).

## NOTED — accepted or low-priority follow-up

- **AU2 (LOW)** `/w/act` reject executes with only the HMAC link (no password, token not bound to
  amount, 72h expiry). Reject only returns funds (no attacker gain); approve is password-gated.
  Follow-up: bind the token to the amount and shorten the expiry.
- **A2 (LOW)** The F-44 scope-registry guard (`app.scope.matrix.e2e.test.ts`) filters to
  `admin|platform|tickets|addons|support`, so the admin-gated `/community/:id/{pin,close,delete}`
  routes are not matrix-tested. Safe today (they scope by the token's own `site` claim). Follow-up:
  widen the guard to every operator-gated id route (needs those handlers to 404 on a no-op first).
- **A3 (INFO)** `app.tickets.ts` / `app.addons.ts` / `app.notifications.ts` / `app.push.ts` admit a
  raw `platform_admin` via `requireRole("admin")` and defer scoping to the RPC — verified correctly
  re-fenced in each RPC, but the inverse single-point-of-failure to A1.
- Daraja/MegaPay/PayHero callbacks re-query the provider before crediting (safe even with the CIDR
  off); provider secrets are AES-256-GCM at rest; impersonation `act` claim is never read for authz.
