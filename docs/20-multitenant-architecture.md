# 20 — Multi-Tenant Architecture (the platform template)

> How one codebase + one database + one engine runs many branded websites, with one central
> superadmin over everything. This is the authoritative design for the template. Written to be
> understood from the basics up.

---

## 1. The mental model (basics first)

Think **franchise chain**:

- **Head office = the platform** (one database, one API, one game engine). This is you.
- **Storefronts = sites/brands** (each a domain with its own logo, name, colours). Customers
  only ever see a storefront.
- **The tag that ties it together = `site_id`.** Every customer, wallet, bet, deposit,
  marketer and commission row carries the id of the storefront it belongs to.

Because everything lives in **one central database** tagged by `site_id`, the questions you
care about are one query away:

- *Which marketer brought which client?* → `referrals` (has `site_id`, `affiliate_id`, `referred_user`).
- *Which client paid on which site?* → `transactions` (has `site_id`, `user_id`, `amount`).
- *A marketer's earnings on site C vs everywhere?* → filter or group by `site_id`.

No cross-database syncing, no event pipeline, no reconciliation. That is the entire reason we
chose multi-tenant over "separate clones".

---

## 2. The `sites` table — one row per website

`packages/db/migrations/0044_sites.sql`. Every brand-diverse variable lives here:

- **Brand:** `name`, `primary_domain`, `logo_url`, `favicon_url`, `color_primary/bg/accent`,
  `theme`, `wordmark_text`, `currency`, `locale`, `licence_line`, `support_email`, `legal_copy`.
- **Money (per brand):** M-Pesa `env`, `shortcode`, key/secret/passkey **by reference**
  (secret-store key names, never plaintext), B2C initiator/credential, `callback_base`.
- **Fairness (per brand):** `master_seed_ref` — each brand's own provably-fair seed lineage.
- **Ops:** `owner_user_id` (the site_superadmin), `status` (active/paused/archived).

A default site (`00000000-0000-0000-0000-000000000001`, slug `invest254`) is seeded so the
existing single-tenant data becomes "site #1" with zero loss.

**Launching a new website = inserting a row here + pointing a domain at the platform.** That's
the whole promise of the template. Full steps: [docs/21](21-brand-onboarding.md).

---

## 3. `site_id` everywhere (the threading)

`packages/db/migrations/0045_site_scoping.sql` adds `site_id` (FK → `sites`, backfilled to the
default site, `NOT NULL`, indexed) to every tenant-owned table: `profiles`, `wallets`,
`positions`, `transactions`, `ledger_entries`, `game_days`, `affiliates`, `referrals`,
`affiliate_commissions`, `affiliate_payouts`, `user_overrides`, `bonuses`, `promo_codes`,
`activity_feed`, `chat_messages`, `audit_log`/`admin_actions`, `user_notifications`.

**Identity becomes per-site** (your chosen model):

- `unique(site_id, phone)` and `unique(site_id, username)` replace the old global uniques.
  The same phone can register on two brands → two independent accounts + wallets. Correct for
  separate M-Pesa reconciliation and separate brand economics.
- `game_days` becomes `unique(site_id, trade_date)` — each brand runs its own daily curve/seed.
- `affiliates.referral_code` stays **globally unique** so one code resolves to exactly one
  (site, marketer). A marketer is per-site (their affiliate row has a `site_id`); cross-brand
  totals are reporting rollups (§7).

> The columns are added with a safe default + FK so existing rows and any not-yet-updated
> insert path never break; the money RPCs are then updated to stamp `site_id` explicitly
> (tracked in [docs/22](22-conversion-checklist.md)).

---

## 4. Per-site game configuration

`packages/db/migrations/0046_site_game_config.sql`. The old `game_config` singleton becomes
`site_game_config` (one row per site): each brand tunes its own **house edge / RTP, min/max
stake, max multiplier, tick rate, drift/volatility, target win rate**. It carries the same
feasibility CHECK as the code (`RTP / targetWinRate ∈ (1, maxMultiplier]`) so an impossible
economy can never be saved, and an immutable `site_game_config_versions` history so a
position always re-prices under the version that was live when it opened (crash recovery).

A write fires `pg_notify('site_game_config_changed', <site_id>)` — the multiplexed engine
(next section) refreshes **only that brand's** pricing context, never the others'.

---

## 5. The multiplexed engine (one process, N brands)

Single-tenant `apps/engine` builds ONE active context (curve + calibrated settlement) and
ticks it. The template runs **all brands in one engine process**:

```
engine process
 ├─ SiteRegistry: Map<site_id, SeedManager>          // one per active brand
 │    each SeedManager → ActiveContext { curve, settlement, dayStart, seed, configVersion }
 ├─ tick loop: for each site → build+broadcast that site's tick to that site's sockets
 ├─ open/sell: routed to the caller's site context (site from the JWT `site` claim)
 └─ LISTEN site_game_config_changed → rebuild only the notified site's context
```

Key points, reusing what already exists:

- **Seeds per site:** `deriveSiteDaySeed(masterSeed, siteId, dateKey, version)` in
  `packages/shared/src/site.ts` mixes the site id into the HMAC label, so brands sharing a
  platform master seed still get uncorrelated curves, and each brand can carry its own
  `master_seed_ref`. No secret at rest; deterministic crash recovery per site (unchanged
  guarantees, now per brand).
- **WS clients declare their site:** the login-issued JWT gains a `site` claim; the engine
  reads it on `auth`, binds the socket to that site, and fans out only that brand's `tick`,
  `online`, `fairness`, `balance`, `position_*`.
- **Recovery** scans open positions across all sites and re-arms/settles each under its own
  site context + config version — the existing `recovery.ts` logic, keyed additionally by site.

Deployment: still **one Fly engine app**; it just holds N in-memory contexts. (If a single
brand later needs isolation, it can be ejected to its own engine app pointing at the same DB —
see §9.)

---

## 6. Roles — one superadmin over everything

The inherited ladder is `player < marketer < admin < superadmin` (in `apps/api/src/http.ts`).
The template adds **one tier on top** and a **site scope**:

```
platform_superadmin   ← YOU. Every site. The central console.
  └─ site_superadmin   ← per-brand owner/operator (scoped to their site_id)
       └─ finance_admin / support   (scoped to their site_id)
            └─ marketer  (per site)
                 └─ player   (per site)
```

- A **JWT `site` claim** binds site-scoped roles to their brand; the API's `requireRole` gains
  a companion `requireSite` guard so a `site_superadmin` of Brand A can never touch Brand B.
- **`platform_superadmin`** ignores the site filter — the central console lists all sites,
  shows per-site KPIs, and can drill into any brand's finance/users/overrides.

The existing admin UI (`apps/web/src/app/admin/*` — finance, users, withdrawals, game config,
marketers, reports, audit, RTP) is reused per site, with a **site switcher** added at the top
and an **all-sites overview** above it for the platform superadmin.

---

## 7. Attribution — the exact questions you asked

Because it's one DB tagged by `site_id`, every question is a query. Worked example:

Marketer **M** promotes Brand **C** with code `MC1`. Client **X** signs up via `MC1`:

```
referrals    : (site_id=C, affiliate_id=M, referred_user=X)
profiles     : X.referred_by = M, X.site_id = C
```
X deposits KES 5,000, plays, nets a KES 3,000 loss:
```
transactions : (site_id=C, user_id=X, kind=deposit, amount=500000)   -- cents
positions    : (site_id=C, user_id=X, stake/payout ...)
```

Now:

- **Clients M brought on C** → `SELECT referred_user FROM referrals WHERE affiliate_id=M AND site_id=C`.
- **What they paid on C** → join to `transactions` on `(site_id, user_id)`.
- **M's commission on C** → `fn_accrue_affiliate_commissions` (migration 0018) with a `site_id`
  dimension: commission = `rate × GGR` of M's referred players **on C**, per day.
- **M across all brands** → same query grouped by `site_id` (per-site breakdown + a total).

**Marketer identity is per-site** (your choice): M has a separate affiliate row per brand. To
present "M everywhere", we link those rows with an optional `marketer_global_id` used **only
for reporting rollups** — money still moves per site. (This is a small reporting view, not a
schema fork; see docs/22 task R.)

---

## 8. The override console (statistical win-rate control)

You already have ~80% of this: `user_overrides` (migration 0041) + `apps/engine/src/overrides.ts`
(`userSettlement`) let an admin set a user's `winRate`, `houseEdge`, `maxWinMultiplier`,
`tradeDurationS`, and stake bounds; the engine's `settlementFor()` builds that user a personal
calibrated settlement and applies it on their **next round**.

In the template this row gains `site_id` and the control lives in the **platform-superadmin
console**, scoped to the site you're viewing. The button does:

1. **"Boost this failing player"** → set `winRate` high (e.g. 0.9). Because winners must still
   profit, the code's `checkFeasible()` requires `RTP / winRate > 1`, i.e. a high win rate
   needs a **low personal house edge**. So the button, under the hood, sets `winRate=0.9` +
   `houseEdge≈0.05` (RTP≈0.95) — a consistent, engine-valid "almost always wins" profile.
2. **"System rates aren't working" (whole brand)** → don't touch users; edit that site's
   `site_game_config` (RTP/win-rate). The engine live-reloads it (§4) on the next round for
   every player on that brand.
3. **Clear override** → delete the row; the user falls back to the brand's global economy.

**Safety (kept):** every override writes an `admin_actions` audit row (who, target user, site,
old→new). Access is `platform_superadmin` only. Infeasible combos are rejected before save by
the shared feasibility check — you cannot brick a user's pricing.

> The math truth to remember: you can make someone win *almost* always, not *literally* always,
> under the statistical model — a win must pay > stake, so win-rate 1.0 with any positive edge
> is impossible. (If you ever want *guaranteed* next-N wins, that's the separate deterministic
> "force-win" mechanism — not selected for this template; easy to add later.)

---

## 9. Isolation & the escape hatch

Multi-tenant's one downside is **blast radius**: one bug/breach touches all brands, and all
brands sit under one operator/licence. The template keeps an escape hatch: because every brand
is the same code + a `site_id`, any single brand can later be **ejected** to its own isolated
instance (own Supabase + own engine app) for legal/entity separation — a data export of that
`site_id` into a fresh single-tenant deployment. You pay that cost only when a regulator or a
licence forces it, not upfront.

---

## 10. What changes vs the inherited single-tenant docs

Docs 00–19 remain accurate for **per-site** behaviour (the game math, payments, affiliate,
admin, fairness are unchanged *within* a brand). This doc + docs 21–22 layer the tenancy on
top. Where they conflict, **this doc wins** for anything about `site_id`, brand config, the
engine's multi-context loop, roles/scope, and the central console.
