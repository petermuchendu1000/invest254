# 17 — Frontend Build Plan (Player Web App)

> **Status:** Planning doc for the player web app (`apps/web`). Companion to
> [13 — Frontend Spec](13-frontend-spec.md) (the *what* — screens/components/UX) and the
> backend contracts in [03 — Realtime Protocol](03-realtime-protocol.md),
> [05 — API Reference](05-api-reference.md), [06 — Auth & KYC](06-auth-kyc.md).
> This doc is the *how* and *in what order* — a phase-by-phase, mobile-first build plan with
> acceptance criteria.

## 0. How to use this document
Each phase is independently shippable, has explicit dependencies, deliverables, and acceptance
criteria, and ends in a green typecheck + tests on `main`. Build phases in order; do not start a
phase until its dependencies' acceptance criteria pass. Every phase is **mobile-first**: the 360px
layout is built and verified first, then progressively enhanced for tablet/desktop.

### ⚠️ Two reconciliations to confirm before coding
1. **Auth is phone + PASSWORD, not OTP.** Docs 13 & 16 say "phone + OTP"; the *implemented*
   backend ([06](06-auth-kyc.md)) is self-managed **phone + password** (scrypt + self-issued
   HS256 JWT, no Supabase Auth, no OTP, no refresh token — re-login to renew). **This plan follows
   the implemented reality.** Docs 13/16 should be amended.
2. **Milestone numbering.** The repo roadmap ([16](16-roadmap.md)) lists M4 = player web app,
   M6 = admin, M7 = hardening. The current request frames this as "M6 → M7" front-end work. Before
   coding, confirm which numbering governs. This plan uses neutral **FE0–FE7** phase labels that can
   be mapped onto whichever milestone scheme is authoritative.

---

## 1. Guiding principles
- **Mobile-first, always.** Kenyan players are overwhelmingly on mobile. Design and verify at
  **360×640** first; enhance upward. No layout may require horizontal scrolling on a phone.
- **The client only renders; it never decides outcomes or money.** Curve, P&L, and settlement are
  authoritative on the engine. The UI shows server truth and applies optimistic states that are
  always reconciled by a server event.
- **One source of truth per datum.** WS for live game state (ticks, position, pushed balance);
  REST for everything durable (auth, wallet, history, payments, affiliate). Never duplicate
  ownership.
- **Money is integer cents (KES).** Never use floats for money. Format only at the view edge.
- **Fail visible, fail safe.** Every async surface has explicit loading / empty / error states.
  Money actions are idempotent-friendly and confirm before large stakes.
- **Responsible gaming is first-class**, not an afterthought — visible balance, age-gate
  enforcement, self-exclusion/limit entry points, licence copy.

---

## 2. Tech stack & key decisions
| Concern | Decision | Rationale |
|---|---|---|
| Framework | **Next.js 14 (App Router) + TypeScript** | Matches docs 01/13; SSR for marketing/referral routes, CSR for the game. |
| Styling | **Tailwind CSS** + CSS variables for theme tokens | Matches spec; fast, consistent, dark-first. |
| Workspace | New npm workspace **`apps/web`**; consumes **`@invest254/shared`** for types/money/config | Single source of truth for money math, config shape, and event/DTO types. |
| Server state | **TanStack Query (React Query)** | Cursor pagination, caching, retries, invalidation for REST. |
| Client/UI state | **Zustand** (auth/session, socket store, bet-panel draft) | Minimal, hook-friendly, no boilerplate. |
| Realtime | Native **WebSocket** wrapped in `useGameSocket()` | Authoritative engine per doc 03; no extra lib needed. |
| Charting | **Custom `<canvas>` Catmull-Rom smooth-wave renderer** | Spec requires glassy smooth waves + green bias; `requestAnimationFrame` decoupled from tick rate. |
| Forms/validation | **react-hook-form + zod** (zod schemas shared where possible) | Client validation mirrors server error codes. |
| Auth transport | `Authorization: Bearer <jwt>` on REST; `auth` message on WS | Per docs 05/06. |
| Token storage | In-memory + `localStorage` mirror, attached via client interceptor | No refresh token; 7-day JWT, re-login on 401. |
| i18n / format | KES currency formatter, EAT timezone, English (MVP) | Audience is Kenya. |
| PWA | Installable PWA (manifest + service worker) in FE7 | Mobile "app-like" install without native apps (out of MVP scope per doc 00). |
| Testing | Vitest + React Testing Library (unit/component), Playwright (E2E, mobile viewport) | Mobile viewport is a first-class test target. |

**Env (`apps/web/.env`):** `NEXT_PUBLIC_API_BASE_URL`, `NEXT_PUBLIC_WS_URL`. No secrets in the
client bundle — only public base URLs.

---

## 3. Information architecture & routes
| Route | Auth | Purpose |
|---|---|---|
| `/` | public (play requires auth) | Game: curve, bet panel, activity, chat. The home screen. |
| `/wallet` | player | Balances, deposit (STK), withdraw, transactions + ledger history. |
| `/account` | player | Profile, basic KYC (name + DOB age-gate), responsible-gaming, logout. |
| `/affiliate` | marketer | Referral link, referrals, commissions, payout requests. |
| `/r/:code` | public | Referral landing → stores code → routes into register with `referral_code`. |
| `/legal/*` | public | Terms, responsible gaming, licence copy (footer links). |
| Auth | overlay modals over `/` | Register / login (phone + password). Deep-linkable via query param. |

---

## 4. Mobile-first responsive system
**Breakpoints (Tailwind):** base = mobile (≤639px), `sm` ≥640, `md` ≥768, `lg` ≥1024, `xl` ≥1280.

**Game screen layouts**
- **Mobile (base):** vertical stack — slim top bar (logo, BTC/KES rate, balance, menu) → `CurveCanvas`
  (full-width, ~40vh) with timeframe chips → **sticky bottom `BetPanel`** (stake chips, duration,
  BUY/SELL, live P&L) → Activity / Chat as a **segmented tab** below the fold. One-handed reach:
  primary actions (BUY/SELL, stake chips) sit in the bottom third.
- **Tablet (`md`):** two columns — curve + bet panel left, activity/chat right rail. Bet panel
  un-sticks into the column.
- **Desktop (`lg`+):** the 3-column spec layout — left activity/chat rail, center curve, right bet
  panel; top bar gains 24h high/low + online count.

**Rules**
- No fixed pixel widths on layout containers; use `w-full` + grid/flex + `gap-*`.
- Tap targets ≥ 44×44px; bottom-sticky controls respect safe-area insets
  (`env(safe-area-inset-bottom)`).
- Tables (history/ledger) become **stacked cards** on mobile, real tables at `md`.
- Curve canvas resizes via `ResizeObserver` + devicePixelRatio scaling; render loop independent of
  network tick rate (interpolate between ticks at 60fps).
- Modals are full-screen sheets on mobile, centered dialogs at `md`.

---

## 5. Design system
- **Theme:** dark-first (near-black bg `#0A0B0E`), neon green (up) / red (down) curve, cyan accents;
  light theme optional via toggle. All colors expressed as CSS variables with `dark:` parity.
- **Tokens:** color, spacing, radius, shadow/glow, typography scale, z-index layers (canvas < panels
  < sticky bar < modal < toast).
- **Core components** (build in `apps/web/src/components/ui` + feature components):
  `Button`, `Input`, `NumberStepper`, `Chip`, `Sheet/Modal`, `Tabs`, `Toast`, `Skeleton`,
  `EmptyState`, `ErrorState`, `Money`, `Badge`, `Avatar`, plus feature components from doc 13:
  `CurveCanvas`, `BetPanel`, `LivePnl`, `PositionToast`, `ActivityFeed`, `Chat`, `WalletWidget`,
  `AuthModals`.

---

## 6. Data layer (shared across phases)
**Typed REST client** (`apps/web/src/lib/api`): one function per endpoint, returns typed DTOs,
injects bearer token, normalizes the `{ error: { code, message } }` envelope into a typed error,
handles cursor pagination (`{ items, nextCursor }`). Endpoints to cover (from doc 05):
- Auth/profile: `POST /auth/register`, `POST /auth/login`, `GET/PATCH /auth/me`.
- Wallet/history: `GET /wallet`, `GET /wallet/ledger`, `GET /positions`, `GET /positions/:id`,
  `GET /transactions`.
- Payments: `POST /deposits`, `POST /withdrawals`.
- Game companion: `GET /game/config`, `GET /game/ticks`, `GET /game/fairness/:gameDayId`,
  `GET /activity`.
- Engagement: `GET /chat`, `POST /chat`, `POST /promo/redeem` (when available).
- Affiliate: `POST /affiliate/enroll`, `GET /affiliate/summary`, `GET /affiliate/referrals`,
  `GET /affiliate/commissions`, `POST /affiliate/payouts`.

**WS hook** (`useGameSocket`): connect → send `auth {token}` → handle `hello`, `tick`, `tick_batch`,
`online`, `fairness`, `position_opened`, `position_update`, `position_settled`, `balance`,
`activity`, `activity_batch`, `chat`, `chat_batch`, `error`. Sends `open_position`, `sell`,
`subscribe_chat`, `send_chat`, `ping` (15s heartbeat). Auto-reconnect with backoff; on reconnect
re-auth and reconcile from `hello` + `*_batch` + replayed `position_settled`.

**Error-code map:** translate doc-05 codes (`AGE_NOT_VERIFIED`, `INSUFFICIENT_FUNDS`,
`RATE_LIMITED`, `REJECTED`, `INVALID_CREDENTIALS`, `PHONE_TAKEN`, …) to friendly,
action-oriented UI messages.

---

## 7. Cross-cutting concerns
- **Auth guard:** route wrapper redirects unauthenticated users to login modal; preserves intended
  destination. WS `AUTH_INVALID` / REST 401 → clear token, prompt re-login.
- **Age-gate UX:** BUY/SELL and deposit are blocked client-side when `ageVerified` is false, with a
  prompt to complete `/account` KYC; server remains the un-bypassable enforcer (`AGE_NOT_VERIFIED`).
- **Optimistic + reconcile:** open/sell update UI immediately, always corrected by
  `position_opened`/`position_settled`/`balance`.
- **Accessibility:** keyboard operable, focus traps in modals, ARIA live regions for P&L/toasts,
  color-independent win/loss cues (icon + text, not color alone), reduced-motion support for the
  curve.
- **Responsible gaming:** balance always visible, large-stake confirm, links to limits/self-exclusion
  and licence copy in footer.
- **Observability:** client error boundary + lightweight analytics/event hooks (FE7).

---

## 8. The phased build plan

### FE0 — Foundations & scaffolding
**Goal:** an `apps/web` Next.js app that builds, typechecks, and renders an empty responsive shell.
**Scope/deliverables:** workspace + Next 14 App Router + TS + Tailwind; design tokens & theme
(dark-first); base UI components (`Button`, `Input`, `Money`, `Sheet`, `Tabs`, `Toast`, `Skeleton`,
`EmptyState`, `ErrorState`); typed REST client skeleton + error envelope; `@invest254/shared`
wired in; env config; app shell (top bar + bottom nav on mobile) + routing stubs for all routes;
CI typecheck.
**Depends on:** none.
**Acceptance:** `npm -w @invest254/web build` + `tsc -b` pass; shell renders correctly at 360px and
desktop; theme toggle works; lint/typecheck green on `main`.

### FE1 — Auth & onboarding (phone + password)
**Goal:** a user can register, log in, complete the age-gate, and manage their profile.
**Scope:** `AuthModals` (register: phone/username/password [+ captured `referral_code`]; login:
phone/password) wired to `POST /auth/register` & `/auth/login`; token store + interceptor + 401
handling; auth context/guard; `/account` profile from `GET /auth/me`; basic KYC via `PATCH /auth/me`
(DOB ≥18, immutable-once-set UX); client validation mirroring `PASSWORD_*`/`USERNAME_*`/`INVALID_PHONE`/
`AGE_RESTRICTED`/`PHONE_TAKEN`; logout.
**Depends on:** FE0.
**Acceptance:** register → logged in with token; under-18 DOB rejected with clear message; refresh
keeps session; 401 forces clean re-login; full-screen mobile auth sheet, dialog at `md`.

### FE2 — Wallet & payments
**Goal:** see balances, deposit via M-Pesa STK, withdraw, and view money history.
**Scope:** `WalletWidget` (real/bonus from `GET /wallet`); deposit flow `POST /deposits`
(`{amount, phone}` → pending state, awaits callback-driven balance update); withdraw flow
`POST /withdrawals` (HOLD → pending) with balance/limit validation; transactions list
`GET /transactions` and ledger `GET /wallet/ledger` with cursor pagination (stacked cards on mobile,
tables at `md`); age-gate guard on deposit (`AGE_NOT_VERIFIED`); `INSUFFICIENT_FUNDS` handling.
**Depends on:** FE1.
**Acceptance:** deposit shows pending then reflects credited balance; withdraw debits/holds and shows
pending; history paginates correctly; all states (loading/empty/error) present; mobile-first verified.

### FE3 — Game core (realtime curve)
**Goal:** the live shared curve renders smoothly from the authoritative engine.
**Scope:** `useGameSocket` (connect/auth/reconnect/heartbeat/backfill); `GET /game/config` bootstrap;
`CurveCanvas` Catmull-Rom smooth-wave renderer (green-biased, glow, gradient fill, DPR-aware,
`ResizeObserver`, 60fps interpolation decoupled from tick rate); timeframe chips (30s/1m/2m/5m);
`online` count; `fairness` commitment display; reduced-motion fallback.
**Depends on:** FE0 (auth optional for view-only ticks; bind token when present).
**Acceptance:** ticks stream and render as a smooth wave at 60fps on a mid-range phone; reconnect
restores state via `hello`+`tick_batch`; no layout shift; CPU/battery reasonable.

### FE4 — Betting & positions
**Goal:** place and settle BUY/SELL positions with live P&L.
**Scope:** `BetPanel` (stake input + chips 50/100/200/500, direction BUY/SELL, duration/auto-sell
timer, validation ≥min & ≤balance); `open_position`/`sell` over WS; `LivePnl` from
`position_update`; `PositionToast` for `position_opened`/`position_settled`; optimistic open/sell
reconciled by server events; single-open-rule UX; `×5` cap display; position history from
`GET /positions` + detail `GET /positions/:id` (incl. fairness); auth + age-gate guards on actions.
**Depends on:** FE1, FE3.
**Acceptance:** full open→tick→settle loop works end-to-end against the engine; manual + auto sell
both settle; balance updates via pushed `balance`; disconnect mid-position still settles and replays
on reconnect; sticky bottom bet panel is one-hand operable on mobile.

### FE5 — Social & engagement
**Goal:** live activity feed and moderated chat.
**Scope:** `ActivityFeed` (`activity` stream + `activity_batch` backfill, also `GET /activity` for
SSR/first paint); `Chat` (`chat`/`chat_batch`, `subscribe_chat`, `send_chat`) with rate-limit (1/2s)
and profanity-filter UX surfacing `RATE_LIMITED`/`REJECTED` reasons; mobile segmented tabs
(Activity | Chat) below the curve, right rail at `lg`.
**Depends on:** FE3 (and FE1 for posting chat).
**Acceptance:** feed and chat stream live and backfill on connect; rate-limit and filter rejections
show inline; tab switching smooth on mobile; no jank while curve renders.

### FE6 — Affiliate / marketer
**Goal:** referral acquisition + marketer dashboard.
**Scope:** `/r/:code` landing → persist code → pass as `referral_code` into register (first-touch);
`/affiliate` dashboard: enroll (`POST /affiliate/enroll`), summary (`GET /affiliate/summary` —
link, referrals, turnover, GGR, commission accrued/paid/available), referrals & commissions lists
(cursor-paginated), payout request (`POST /affiliate/payouts`) with `NO_AVAILABLE_COMMISSION`/
`PAYOUT_PENDING` handling; copy/share referral link (native share sheet on mobile).
**Depends on:** FE1, FE2.
**Acceptance:** referral code captured end-to-end into a new registration; dashboard figures match
API; payout request transitions correctly; lists paginate; mobile share works.

### FE7 — Hardening, PWA, polish & launch
**Goal:** production-ready, installable, compliant, fast.
**Scope:** responsible-gaming UI (limits/self-exclusion entry, licence/legal pages & footer copy);
accessibility audit (keyboard, ARIA live, contrast, reduced motion); performance budgets (see §10)
+ canvas profiling; PWA (manifest, icons, service worker, offline shell, install prompt); global
error boundary + analytics/event instrumentation; empty/error-state sweep; E2E suite on mobile +
desktop viewports; promo redemption (`POST /promo/redeem`) if backend ready.
**Depends on:** FE1–FE6.
**Acceptance:** Lighthouse mobile ≥ targets (§10); installable PWA; a11y checks pass; E2E green for
the full value loop (register → deposit → play → settle → withdraw → refer); responsible-gaming &
licence copy present.

---

## 9. Testing strategy
- **Unit:** money formatting, validation schemas, error-code mapping, curve interpolation math.
- **Component:** BetPanel validation/disabled states, WalletWidget, AuthModals, ActivityFeed/Chat
  limits — all at mobile and desktop viewports.
- **Integration:** `useGameSocket` against a mock WS (open→update→settle, reconnect/backfill).
- **E2E (Playwright, mobile viewport first):** the full value loop and the age-gate block.
- Every phase ships with its tests; `node --test` / Vitest + `tsc -b` green before merge.

## 10. Performance budgets (mobile, mid-range Android, 4G)
- First contentful paint < 2.0s; Time-to-interactive < 3.5s on the game route.
- Curve render sustains ~60fps; main-thread long tasks < 50ms during streaming.
- JS payload for `/` route < 250KB gzip initial (lazy-load affiliate/wallet/history).
- No layout shift (CLS ~0) when ticks/toasts arrive.

## 11. Definition of done (per phase)
Typecheck + tests green on `main`; mobile (360px) and desktop layouts verified; loading/empty/error
states present; a11y basics (focus, labels, contrast); no secrets in client; acceptance criteria met;
docs 13/16 updated if the phase changed a contract assumption.

## 12. Open decisions to confirm
1. **Milestone mapping** — how FE0–FE7 map onto the authoritative M-scheme (the "M6 → M7" framing).
2. **Auth doc fix** — confirm phone + password (no OTP) and amend docs 13/16 accordingly.
3. **State libs** — confirm TanStack Query + Zustand (vs SWR/Redux).
4. **PWA scope in MVP** — confirm PWA belongs in FE7 vs deferred (doc 00 lists native apps as
   out-of-scope; PWA is the lightweight middle ground).
5. **Light theme** — required for MVP or dark-only?
6. **`/game/ticks` + REST open/sell** — currently *not implemented* (doc 05 §9); confirm WS-only for
   MVP so FE3/FE4 don't block on the REST fallback.


---

## 13. FE8 — Trade-screen design replica (Invest254 skin)

> Added after a mobile design reference (a "High Trade"-style trade screen) was
> supplied. Branding stays **Invest254**; only the *layout & visual system* are
> replicated. Runtime target: local dev (engine + api + web together).

**Goal:** the `/` trade screen matches the reference — one mobile-first screen with
a branded top bar, price header, decorative asset ticker, live curve, a one-line
activity ticker, and the stake / BUY / SELL panel over a 4-tab bottom nav.

**Palette (extracted from the reference):** bg `#07090F`, surface `#0D1117`,
surface-2 `#161B22`, border `#21262D`, fg `#E6EDF3`, muted `#8B949E`,
up/BUY `#3FB950`, down/SELL `#E43D3F`, accent `#58A6FF`, brand-indigo `#6374E4`,
bonus-yellow `#E3B341`. Tokens live in `globals.css`; Tailwind exposes `brand` and
`warn` alongside the existing colours.

**Deliverables**
- `TopBar`: indigo "P" mark + Invest254 wordmark; `Login` (outline) + `Sign Up`
  (brand) buttons; balance pill.
- `PriceHeader`: `BTC/KES` signed curve value + % pill (value×100), 24H high/low
  (window extremes) and live online count. The number is the synthetic curve
  value, **not** a real BTC price.
- `TickerStrip`: **decorative** marquee of placeholder symbols — purely visual
  dressing, no external data, no new integration (`aria-hidden`).
- `GameCurve`: timeframe chips + `Rate:` readout; canvas keeps the
  green-above / red-below split, gradient fill, axis labels and live dot
  (re-themed via tokens).
- `ActivityTicker`: **single-line** rotating live feed (WS `activity` + REST
  `/activity` backfill). **Chat is removed from the trade screen** (revises FE5).
- `BetPanel`: KES input + 50/100/200/500 chips + circular auto-sell duration +
  idle Live P&L + **always-visible BUY/SELL** (auth / age / stake gating happens
  on tap, so the buttons never disappear).
- `BottomNav`: TRADE / DEPOSIT (`/wallet`) / HISTORY (`/history`) / PROFILE
  (`/account`) with icons and an active pill. New thin `/history` route reuses the
  wallet history tabs.

**Bug fixes shipped with this phase**
1. *Activity shown twice* — de-duplicate identical consecutive `activity`
   broadcasts in the socket provider (guards the StrictMode double-subscribe); the
   single-line ticker also shows one event at a time.
2. *No BUY/SELL buttons* — the panel previously replaced the buttons with a
   login / age gate; they are now always rendered (gating moves to the tap).
3. *No tick data* — the curve & price stream only when the **engine (WS)** is
   reachable and the **API** serves `/game/config`. Run all three locally:
   `npm -w @invest254/engine start` · `npm -w @invest254/api start` ·
   `npm -w @invest254/web dev`, with `NEXT_PUBLIC_WS_URL=ws://localhost:8080` and
   `NEXT_PUBLIC_API_BASE_URL=http://localhost:8081/api/v1`.

**Acceptance:** the ≤411px screen matches the reference; typecheck + prod build
green; BUY/SELL always visible; activity never duplicates; curve + price update
live against the engine.

**Revision to FE5:** chat is dropped from the trade screen (single-line activity
ticker only). The chat backend (engine / API) and the socket plumbing remain
available for a future dedicated surface.
