# 18 — Implementation Status & Forward Roadmap (Guiding Doc)

> **Status:** authoritative. This document supersedes the optimistic status claims in
> [16 — Roadmap](16-roadmap.md) and [17 — Frontend Build Plan](17-frontend-build-plan.md) where
> they conflict. It is an **evidence-based** audit of `main` as of this writing, produced by
> reading the actual source tree — not the planning docs. Every status claim below cites the file(s)
> that prove it. Keep this doc updated as the single source of truth for "what is done, what is
> partial, what is not started, and what to do next."

---

## 0. Method & how to read this

- **Done ✅** — implemented in code, has tests (where the layer is tested), wired end-to-end.
- **Partial 🟡** — exists but incomplete, untested, not wired to a UI, or missing acceptance items.
- **Not started ⬜** — no meaningful code exists.

Evidence was gathered from: `apps/{api,engine,web}`, `packages/{db,shared}`, `docs/*`,
`.github/workflows/ci.yml`. File/test counts: `api` 9 src + 6 tests, `engine` 19 src + 12 tests,
`shared` 12 src + 8 tests, **`web` 73 src + 0 tests**, `db` 24 SQL migrations.

### Correction to a thing you may have seen
A screen rendering **"Affiliate — FE6 — Coming soon"** is the old `PageStub` component. It was
**removed** (commit `e6e3999`) and `/affiliate` + `/r/[code]` now ship real implementations. If you
still see "Coming soon", you are looking at a **stale build/deployment**, not `main`. Rebuild/redeploy
the web app. This does **not** change the fact that real gaps exist — they are catalogued below.

---

## 1. Executive summary

Invest254 is **back-end-heavy and front-end-light, with two whole product surfaces missing**:

| Layer | Status | One-line reality |
|---|---|---|
| DB schema + RPCs (`packages/db`) | ✅ Done | 24 migrations; money/fairness/affiliate/admin logic lives in SQL RPCs. |
| Engine (`apps/engine`) | ✅ Done | Authoritative WS curve, settlement, services; 12 test files. |
| REST API (`apps/api`) | ✅ Done | Full player + admin + affiliate surface; 6 test files. |
| Shared (`packages/shared`) | ✅ Done | Money math, validation, fairness, chat filter; 8 test files. |
| **Player web app (`apps/web`)** | 🟡 Partial | All screens render & call real APIs, but **0 automated tests**, no a11y/perf audit, no promo UI. |
| **Admin web app** | ⬜ **Not started** | ~22 admin REST endpoints exist; **no UI consumes any of them.** |
| **Bonuses / promotions** | ⬜ **Not started** | No backend (K1) and no UI; doc 12 is unimplemented. |
| **M7 hardening & compliance** | 🟡 Partial | Some rate limits + RG *copy*; no enforced limits, fraud controls, monitoring, or KYC. |
| **Deployment / DevOps** | 🟡 Partial | CI (typecheck/build/test) only. No Docker, no infra, no hosting, no env in prod. |

**The two biggest gaps, in priority order, are (1) the Admin web app — completely absent despite a
complete admin API — and (2) the test/compliance hardening of the player app before it can touch
real money.**

---

## 2. Component-by-component status (with evidence)

### 2.1 Database — `packages/db` — ✅ Done
- 24 sequential migrations `0001…0023`, incl. money RPCs (`0010`), fairness (`0011`), payment RPCs
  (`0014`), affiliate enroll/accrual/payouts (`0017–0019`), admin actions/balance-adjust/config
  (`0021–0023`), RLS (`0008`), seed (`0009`).
- Notable history: `0016_age_verification.sql` was **reverted** by `0018_remove_age_kyc.sql`
  (see §4.4 — compliance risk).
- **Gap:** no migration for bonuses/promos; no migration for responsible-gaming limits
  (deposit/loss limits, enforced self-exclusion).

### 2.2 Engine — `apps/engine` — ✅ Done
- Services: `game`, `wallet`, `payments`/`paymentservice`, `affiliateservice`, `adminservice`,
  `authservice`, `activityservice`, `chatservice`, `daycontext`, `recovery`, `daraja`.
- Real WS server (`server.ts`, `ws` lib): broadcasts `tick`, `activity`, `fairness`, `online`,
  `chat`; handles auth, open/sell, chat. The player app connects to this (`GameSocketProvider`).
- **`StubDarajaClient`** (`daraja.ts`) is used when M-Pesa creds are absent — deterministic, **no
  real STK/B2C**. The real client builds only when fully configured. Expected for dev; **a real
  M-Pesa integration test against Daraja sandbox is still owed** before launch.

### 2.3 REST API — `apps/api` — ✅ Done (player + admin + affiliate)
Full route inventory (evidence: `grep router.<verb>` across `apps/api/src`):
- **Auth:** `POST /auth/register`, `POST /auth/login`, `GET /auth/me` (phone + password, no OTP).
- **Wallet/history:** `GET /wallet`, `/wallet/ledger`, `/positions`, `/positions/:id`,
  `/transactions`.
- **Game:** `GET /game/config`, `/game/fairness/:gameDayId`, `/activity`, `GET/POST /chat`.
- **Payments:** `POST /deposits` (+ `/deposits/mpesa/callback`), `POST /withdrawals`
  (+ `/withdrawals/mpesa/result/:txId`).
- **Affiliate:** `POST /affiliate/enroll`, `GET /affiliate/{summary,referrals,commissions}`,
  `POST /affiliate/payouts` (+ `/payouts/mpesa/result/:payoutId`).
- **Admin (~22 endpoints, all admin-gated, audited):** `GET /admin/overview`, users
  (`/users`, `/users/:id`, `POST /users/:id/{suspend|ban|reactivate}`), finance
  (`/withdrawals` + approve/reject, `/wallets/:id/adjust`, `/deposits`, `/deposits/reconcile`),
  reports (`/reports/daily`, `/reports/users`, CSV export), game config
  (`GET/PATCH /game-config`, `/rtp`, `/seeds`, `POST /seeds/rotate`), affiliates
  (`PATCH /affiliates/:id/rate`, `/affiliate/payouts` queue + approve/reject, `POST /affiliate/accrue`),
  engagement (`/chat` moderation + hide/unhide), audit (`/admin/audit`).
- **Not built (API):** bonuses/promos (`K1`, e.g. `POST /promo/redeem`); responsible-gaming limit
  endpoints; live config/seed reload signal to the engine (documented limitation in doc 10 §3).

### 2.4 Shared — `packages/shared` — ✅ Done
- Money (`money.ts`, integer cents + `formatKes`), validation, fairness, activity, chat filter,
  payments MSISDN normalisation. 8 test files.

### 2.5 Player web app — `apps/web` — 🟡 Partial
Routes that exist (`apps/web/src/app/**/page.tsx`): `/`, `/wallet`, `/account`, `/affiliate`,
`/history`, `/legal`, `/offline`, `/r/[code]`, plus `error.tsx`, `global-error.tsx`, `not-found.tsx`.

Per-phase status:

| Phase | Scope | Status | Evidence / gap |
|---|---|---|---|
| FE0 | Scaffolding, design system, API/WS client | ✅ | `lib/api/*`, `components/ui/*`, tailwind tokens. |
| FE1 | Auth (phone+password), onboarding | ✅ | `AuthModal`, `useAuthActions`, `session`. KYC/age-gate intentionally removed (§4.4). |
| FE2 | Wallet & payments | ✅ | `/wallet`, deposit/withdraw forms, ledger/transactions. |
| FE3 | Game core (realtime curve) | ✅ | `GameSocketProvider` → real engine WS; canvas curve. |
| FE4 | Betting & positions | ✅ | `BetPanel`, `positions/*`, settlement via WS. |
| FE5 | Social & engagement (activity, chat) | ✅ | `Feed`, `ActivityTicker`; real WS chat. |
| FE6 | Affiliate / referral | ✅ (new) | `/affiliate` dashboard + `/r/[code]` landing, real endpoints. Fixed a stale-JWT-role bug where a just-enrolled marketer got 403 on dashboard reads until re-login — enroll now reissues a marketer token (commit on `main`). |
| FE7 | Hardening, PWA, polish, **tests**, a11y, perf | 🟡 | Legal/RG pages, footer, PWA (manifest+SW+icons), error boundaries **done**; **0 tests, no Lighthouse/a11y audit, no promo UI, no analytics**. |
| FE8 | Trade-screen design replica | ✅ | `/` matches the reference layout. |

**The hard, unmet FE7 acceptance items:**
- **Automated tests: none.** No Vitest/RTL, no Playwright, no test config in `apps/web` at all.
  The build plan (doc 17 §9) mandates unit + component + integration + mobile E2E. This is the
  single largest quality gap in the player app.
- **No accessibility audit** (keyboard, ARIA-live for ticks/toasts, contrast, reduced-motion sweep).
- **No performance audit** against the doc 17 §10 budgets (FCP/TTI, 60fps curve, <250KB initial).
  (Build output shows `/` at ~112KB First Load JS — promising, but unverified on a real device.)
- **No analytics/event instrumentation.**
- **Promo redemption UI**: not built (and the backend doesn't exist either — see §2.6).

### 2.6 Bonuses / promotions — ⬜ Not started (backend **and** frontend)
- doc 12 specifies bonuses/promos; doc 10 §3 lists it as "**Still to come: bonuses/promos (K1)**".
- No `promo`/`bonus` routes in `apps/api`, no engine service, no UI. Entirely greenfield.

### 2.7 **Admin web app — ⬜ Not started**
- `apps/` contains only `api`, `engine`, `web`. **There is no admin UI** (no `/admin` route in the
  player app, no separate admin app).
- The admin **API** is complete and rich (§2.3, ~22 endpoints across dashboard, users, finance,
  reports, game-config, affiliates, engagement, audit) — but **nothing renders it**. Today an
  operator can only use the admin API via raw HTTP/cURL.
- **This is the headline gap.** A real-money product cannot operate without an operator console:
  approving withdrawals, moderating chat, adjusting balances, watching RTP drift, exporting reports.

### 2.8 Testing — 🟡 Partial (backend good, frontend zero)
- Backend/shared: 26 test files total; CI runs `npm test` (`node --test`) + typecheck + web build.
- **Frontend: 0 tests.** No component, integration (mock WS), or E2E coverage. CI only *builds* web.

### 2.9 Security / compliance / M7 — 🟡 Partial
- **Present:** rate-limiting on payments (`app.payments.ts`) and chat cooldown
  (`chatservice.ts`); CORS/OPTIONS (commit `0f3f7c4`); RLS on DB; immutable ledger + `admin_actions`
  audit; provably-fair seed commit/reveal; money math in atomic SQL RPCs.
- **Missing:** global API rate-limiting/abuse controls; fraud controls; **enforced** responsible-gaming
  limits (deposit/loss limits, programmatic self-exclusion — currently *copy only*, "email us");
  reconciliation jobs/cron; monitoring + RTP-drift alerting wired to a channel; KYC/age verification
  (removed — §4.4); a documented security review of the play→settle→withdraw loop.

### 2.10 Deployment / DevOps — 🟡 Partial
- CI workflow (`.github/workflows/ci.yml`): checkout → typecheck (`tsc -b`) → web build → `npm test`.
- `.env.example` at root and `apps/web/.env.example`.
- **Missing:** Dockerfiles, infra-as-code, a hosting target for engine (long-lived WS) + api + web,
  Supabase project wiring in prod, secrets management, migration-apply step in CI/CD, health/uptime
  monitoring, a real M-Pesa (Daraja) environment.

---

## 3. Prioritised gap list (what actually blocks launch)

1. **Admin web app** — operator console for the existing admin API. *Blocks operations.* ⬜
2. **Player-app test suite** (unit + component + integration + mobile E2E). *Blocks trust in a
   money app.* ⬜
3. **Responsible-gaming enforcement + KYC/age decision** (regulatory, Kenya/BCLB). *Blocks legal
   launch.* 🟡/⬜
4. **M7 hardening** — global rate limits, fraud controls, reconciliation, monitoring/alerting. ⬜
5. **Real M-Pesa (Daraja) integration + end-to-end payment test.** 🟡
6. **Deployment pipeline** (Docker + infra + prod env + migrations). 🟡
7. **a11y + performance audit** of the player app (FE7 acceptance). ⬜
8. **Bonuses/promotions** (backend K1 + UI) — *growth feature, not launch-blocking.* ⬜

---

## 4. Forward roadmap — sequenced, with justification ("from → to")

Each step lists **why it comes here** and **definition of done**. Steps are ordered by dependency
and launch-criticality, not by ease.

### Phase A — Admin web app (`apps/admin`)  ⟵ do first
**From:** a complete admin API with no consumer → **To:** a usable operator console.
**Why first:** the API already exists, so this is the highest value-per-effort move; and no
real-money service can run without operators approving withdrawals and moderating. It unblocks
"operate the product at all". It also reuses `packages/shared` (money/types) and the web app's
patterns (typed API client, React Query, Tailwind tokens), so it is mostly assembly, not invention.
**Build order (mirror the API slices, doc 10 §3):**
1. App scaffold (Next.js, admin auth = login as admin/superadmin, role-gated shell).
2. Dashboard (`/admin/overview` KPIs) + RTP panel (`/admin/rtp` with drift alert).
3. Withdrawals queue (approve/reject) + deposits monitor + reconcile view.
4. User management (search, detail, suspend/ban/reactivate) + manual balance adjust (reason
   required).
5. Affiliates (payout queue approve/reject, commission-rate edit).
6. Game config editor (superadmin) + seeds/rotation.
7. Chat moderation + audit-log viewer + report exports (CSV).
**Done when:** every endpoint in §2.3 (admin) has a screen; all mutations confirm + surface the
audit result; role matrix (doc 10 §2) enforced in the UI; typecheck + tests green.

### Phase B — Player-app test harness  ⟵ in parallel with A
**From:** 0 frontend tests → **To:** the FE7 testing acceptance met.
**Why now:** every subsequent change to a money-handling UI is risky without a safety net; doing it
before launch (and before more features pile on) is cheapest. Independent of Phase A, so it can run
in parallel.
**Build order:** Vitest + RTL config → unit tests (money format, validation, error-code map, curve
interpolation) → component tests (BetPanel disabled/validation states, WalletWidget, AuthModal,
Feed limits) → integration test of `useGameSocket` against a mock WS (open→update→settle, reconnect)
→ Playwright mobile-viewport E2E of the value loop (register → deposit → play → settle → withdraw →
refer). Wire `npm -w @invest254/web test` into CI.
**Done when:** CI runs web unit/component/integration + E2E green on mobile + desktop viewports.

### Phase C — Compliance: RG enforcement + KYC/age decision
**From:** RG *copy* only; KYC removed → **To:** enforced limits + a deliberate, documented KYC
posture.
**Why here:** this is a **legal** gate for a Kenyan real-money product (BCLB). It needs backend work
(new endpoints + migrations), so it follows once the admin console exists to manage exclusions.
**Build order:** decide KYC posture (re-introduce age-gate/KYC or formally accept the risk with sign-off
— see §4.4); add deposit/loss-limit + self-exclusion endpoints + migrations; enforce them in the
play/deposit paths; expose limit controls in the player account page and exclusions in the admin
console.
**Done when:** a user can set limits and self-exclude in-product; the engine/API enforce them; admin
can see/override; documented review passed.

### Phase D — M7 hardening
**From:** partial rate limits → **To:** the M7 security checklist + reconciliation + monitoring.
**Why here:** depends on the surfaces above being feature-complete so hardening targets a stable
system. **Build order:** global API rate-limiting/abuse middleware; fraud heuristics; nightly
reconciliation job (ledger vs M-Pesa); RTP-drift + reconciliation alerting to a real channel;
security review of the money loop. **Done when:** doc 14 checklist passes review.

### Phase E — Real M-Pesa + deployment
**From:** StubDaraja + CI-only → **To:** Daraja sandbox→prod + deployed stack.
**Build order:** Daraja sandbox creds + STK/B2C end-to-end test; Dockerfiles for engine (WS)/api/web;
infra + Supabase prod wiring + secrets; CI/CD with migration-apply + health checks.
**Done when:** a real deposit reflects after callback and a withdrawal pays out in sandbox; the stack
deploys reproducibly.

### Phase F — a11y + performance audit (FE7 finish)
**From:** unverified → **To:** Lighthouse mobile ≥ targets, a11y checks pass. Run after the UI is
stable so the audit isn't invalidated by churn.

### Phase G — Bonuses / promotions (growth)
**From:** nothing → **To:** backend K1 (migrations + service + `POST /promo/redeem`) + player UI +
admin management. **Why last:** it is the only non-launch-blocking item; it is pure growth and can
ship post-launch.

---

## 5. Suggested immediate next step

**Start Phase A (admin web app).** It is the single highest-leverage gap: a finished API with zero
UI, and an absolute operational prerequisite for a real-money product. Phase B (player tests) should
run in parallel since it's independent. Recommend scaffolding `apps/admin` and building the
Dashboard + Withdrawals queue first (the two screens an operator touches daily).
