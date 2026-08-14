# Invest254 Platform Template — Multi-Brand Operator Platform

> A **template** for running many branded real-money trade-prediction websites from **one
> central brain** (one database + one backend + one multiplexed game engine), with a single
> **platform superadmin** who controls every site, every marketer, and every player override.
>
> This repo starts from the proven single-tenant Invest254 codebase and adds the multi-tenant
> foundation. Read the docs below in order — they demystify the whole thing to the basics.

---

## The model (locked decisions)

You chose the **multi-tenant** architecture. In plain terms: it's a franchise with many
storefronts wired to one head office. Each website looks different (its own logo, name,
colours, domain) but every sale lands in one central ledger tagged with **which site** it
belongs to — so "which marketer brought which client, who paid on which site" is a single
database query, and you get one central admin over everything.

| Decision | Choice | What it means |
|---|---|---|
| Architecture | **Multi-tenant, one central DB** | All brands share one database + backend; each brand is a `sites` row. |
| Player identity | **Per-site** | The same person on Brand A and Brand B has two accounts/wallets. |
| Marketer identity | **Per-site** | A marketer's affiliate row is per brand; cross-brand totals are reporting rollups. |
| Win-rate override | **Statistical** | Superadmin raises an individual user's win rate (+ lowers their house edge to keep the math valid). |
| Engine | **Multiplexed** | One engine process runs every brand's curve; a per-site change refreshes only that brand. |

---

## Documentation (read in this order)

| Doc | What it covers |
|---|---|
| [docs/20 — Multi-tenant Architecture](docs/20-multitenant-architecture.md) | The whole design: `sites`, `site_id`, engine multiplexing, roles, attribution, the override console, fairness & money per brand. **Start here.** |
| [docs/21 — Brand Onboarding](docs/21-brand-onboarding.md) | Step-by-step "launch website #7", plus the full reference of every brand variable and where it lives. |
| [docs/22 — Conversion Checklist](docs/22-conversion-checklist.md) | The exact, ordered engineering tasks to finish (RPCs, services, engine, RLS, web) with file pointers + acceptance criteria. |
| [docs/00–19](docs/) | The inherited single-tenant Invest254 design (game math, payments, affiliate, admin, hosting). Still accurate for the per-site behaviour. |

---

## What is already in this template

- **Full working single-tenant app** (web + API + WS engine + DB migrations + shared core) — it
  runs today as "site #1" exactly like Invest254.
- **Multi-tenant foundation (new):**
  - `packages/db/migrations/0044_sites.sql` — the `sites` (brand) registry; seeds a default site.
  - `packages/db/migrations/0045_site_scoping.sql` — threads `site_id` through tenant tables, backfills the default site, makes identity unique **per site**.
  - `packages/db/migrations/0046_site_game_config.sql` — per-site game config + versioning + a per-site change-notify the engine listens on.
  - `packages/shared/src/site.ts` — per-site provably-fair seed derivation + brand types.
  - `apps/web/src/lib/brand/brand.ts` — host → brand resolution + instant CSS-variable theming.

## What is staged (see docs/22)

The **site_id wiring** through the money RPCs, engine multiplexing, RLS, and the platform
superadmin UI is specified task-by-task in **docs/22**. This is deliberate: threading a
real-money core must be applied and tested against a live Supabase project, not pushed blind.
Each task lists the file(s) to touch and how to verify it.

---

## Quickstart (local, single brand)

```bash
npm install
npx tsc -b packages/shared apps/engine apps/api          # typecheck backend
node --import tsx --test packages/**/*.test.ts apps/**/*.test.ts   # run tests

# Engine (WS)  — in-memory when DATABASE_URL is unset (dev)
npm -w @invest254/engine start
# REST API     — requires DATABASE_URL + SUPABASE_JWT_SECRET
npm -w @invest254/api start
# Web (Next.js)
npm -w @invest254/web run dev
```

## Deploy shape (inherited)

- **Web** → Cloudflare Pages (many custom domains → this one project).
- **API** → Fly.io app (`/api/v1`).
- **Engine** → Fly.io app (WSS), multiplexed across all sites.
- **DB** → one Supabase Postgres (the central brain).

See [HOSTING.md](HOSTING.md) for the proven single-tenant hosting runbook, and
[docs/21](docs/21-brand-onboarding.md) for the multi-brand domain/secret wiring.

> ⚠️ Real-money gambling product. Operate under a valid gaming licence and your counsel's
> direction (KYC/AML, responsible gaming, tax, advertising). The per-user win-rate override is
> powerful and legally sensitive — it is audit-logged and superadmin-gated by design.
