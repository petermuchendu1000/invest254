# Invest254 — Hosting & Deployment Guide (Handoff)

> Read this end-to-end before changing anything deploy-related. It documents exactly how
> the production hosting is wired, the non-obvious gotchas, and how to operate it.
> **No secret values are in this file** — secrets live in Fly.io / Cloudflare only.

_Last verified: 2026-06-29. All endpoints below were confirmed live._

---

## 0. TL;DR — the mental model

This is an **npm-workspaces monorepo** with **three deployables on two platforms + one database**:

| Component | Code | Hosted on | Public URL |
|-----------|------|-----------|------------|
| Web frontend (Next.js 14) | `apps/web` | **Cloudflare Pages** | `https://invest254.com` (and `https://invest254.pages.dev`) |
| REST API (Node HTTP) | `apps/api` | **Fly.io** app `invest254` | `https://invest254.fly.dev/api/v1` |
| WebSocket game engine (Node `ws`) | `apps/engine` | **Fly.io** app `invest254-engine` | `wss://invest254-engine.fly.dev` |
| Postgres database | `packages/db` (migrations) | **Supabase** | pooler host, project ref `yewujhbtfxeirhknckzg` (eu-west-1) |

**The single most important fact (do not break this):**
- `invest254.com` is **ONLY the frontend** (Cloudflare Pages).
- The browser calls the **API** at `https://invest254.fly.dev/api/v1` and the **WebSocket** at `wss://invest254-engine.fly.dev`.
- ❌ There is **no** `invest254.com/api`. Do **not** repoint the API host to `invest254.com` — that will break logins (it returns 404 because it's the static frontend).

Data flow:
```
Browser (https://invest254.com, Cloudflare Pages)
   │   REST  → https://invest254.fly.dev/api/v1   (Fly app: invest254)
   │   WS    → wss://invest254-engine.fly.dev      (Fly app: invest254-engine)
   ▼
Fly.io apps (Node via tsx)  ──SQL──►  Supabase Postgres (pooler, sslmode=no-verify)
```

---

## 1. Repository layout

```
invest254/                      # npm workspaces, Node >=20, TypeScript ESM, source-first (tsx)
├── packages/
│   ├── shared/                 # @invest254/shared — PRNG, curve, settlement, money, config
│   └── db/migrations/          # 0001–0026 SQL migrations (idempotent)
├── apps/
│   ├── engine/                 # @invest254/engine — authoritative WS game server (port 8080)
│   ├── api/                    # @invest254/api — REST transport over engine services (port 8081)
│   └── web/                    # @invest254/web — Next.js 14 frontend (→ Cloudflare Pages)
├── Dockerfile                  # backend image (engine + api), used by BOTH Fly apps
├── fly.toml                    # Fly config for the API app  (app = "invest254")
├── fly.engine.toml             # Fly config for the engine app (app = "invest254-engine")
├── wrangler.toml               # Cloudflare Pages config (nodejs_compat, build output dir)
└── apps/web/wrangler.toml      # local wrangler for `wrangler pages dev` (not used by CF build)
```

Run modes are **source-first**: services run via `tsx` (no compile step). `npm start` in each
app = `node --import tsx src/server.ts`.

---

## 2. Fly.io — backend (API + engine)

### 2.1 Two apps, one Docker image
Both Fly apps build from the **same root `Dockerfile`**. Each app's `fly.*.toml` overrides the
start command via `[processes]`:
- `invest254`        → `npm -w @invest254/api start`     (REST, internal port **8081** → 443)
- `invest254-engine` → `npm -w @invest254/engine start`  (WS,   internal port **8080** → 443)

Region: **`jnb`** (Johannesburg — Fly's closest to Kenya). VM: `shared-cpu-1x`, 512 MB.

### 2.2 Why two apps (not one container with two ports)
Fly's **free shared IPv4 only routes ports 80/443**. A single app exposing the engine on a
custom port (8080) would need a **paid dedicated IPv4**. Splitting into two apps lets BOTH the
API and the WS run on port **443** (different hostnames) over the free shared IPv4. Each app's
`[http_service]` maps 443 → its internal port.

### 2.3 Public IPs (gotcha)
On first deploy the prompt *"allocate dedicated ipv4/ipv6?"* was answered **No**, which left the
API app with **no IP at all** (it was unreachable). Fixed with:
```bash
fly ips allocate-v4 --shared -a invest254   # free shared IPv4 (443 only) — this is enough
fly ips allocate-v6 -a invest254            # free dedicated IPv6
```
Current: `invest254` = shared IPv4 `66.241.124.119` + v6; `invest254-engine` = `66.241.125.119` + v6.
**Do not buy a dedicated IPv4** — not needed for 443-only traffic.

### 2.4 Secrets (set on BOTH apps via `fly secrets set -a <app> ...`)
Names only (values live in Fly):
- `DATABASE_URL` — Supabase **pooler** string, **must end with `?sslmode=no-verify`** (see §4.2)
- `SUPABASE_JWT_SECRET` — HS256 secret the API signs tokens with and both apps verify with
- `MASTER_SEED` — provably-fair daily server seed (hex)
- (API only, optional until M-Pesa go-live) `MPESA_CONSUMER_KEY/SECRET`, `MPESA_SHORTCODE`, `MPESA_PASSKEY`

> Fail-closed: when `DATABASE_URL` is set, a JWT verifier is **required** or the process throws on boot.

### 2.5 Engine boot ordering (critical gotcha)
`apps/engine/src/server.ts` does DB work **before** it opens the socket:
```
new SeedManager(...).init()      → queries DB (fn_ensure_game_day)
new RecoveryService(...).recover()→ queries DB (scan open positions)
new WebSocketServer({ port })     → only runs if the above succeed
```
So **any DB connection failure crashes the engine before it listens** (machine shows no listener
/ gets suspended). The API does NOT query the DB on boot (its `/api/v1/health` route is static),
which is why a broken DB made the API "look healthy" while the engine died. If the engine won't
stay up, **check the DB connection first** (`fly logs -a invest254-engine`).

### 2.6 Common ops
```bash
fly deploy                       # deploy API (uses ./fly.toml)
fly deploy -c fly.engine.toml    # deploy engine
fly secrets set -a invest254 KEY="value"   # set secret (auto-redeploys)
fly status  -a invest254 ; fly logs -a invest254
fly status  -a invest254-engine ; fly logs -a invest254-engine
```

---

## 3. Cloudflare Pages — frontend (`apps/web`)

### 3.1 Project build settings (monorepo)
| Setting | Value |
|---------|-------|
| Production branch | `main` |
| Framework preset | **None** |
| Build command | `npm install && npm -w @invest254/web run pages:build` |
| Build output directory | `apps/web/.vercel/output/static` |
| Root directory | `/` (repo root — required so the `@invest254/shared` workspace resolves) |

> Do **not** set Root directory to `apps/web` — that breaks the workspace install of `@invest254/shared`.
> `pages:build` runs `@cloudflare/next-on-pages` which runs `vercel build` → `next build`.

### 3.2 Environment variables (Production AND Preview)
These are `NEXT_PUBLIC_*` → **inlined at BUILD time**. They must exist *before* a build, and a
**rebuild is required** after changing them (setting them alone does nothing). If missing, the app
falls back to `http://localhost:8081` / `ws://localhost:8080` (this happened once and broke login).
```
NEXT_PUBLIC_API_BASE_URL = https://invest254.fly.dev/api/v1
NEXT_PUBLIC_WS_URL       = wss://invest254-engine.fly.dev
NODE_VERSION             = 20
```

### 3.3 Compatibility flags (via root `wrangler.toml`)
`@cloudflare/next-on-pages` requires the `nodejs_compat` flag at runtime. The dashboard UI to set
it kept throwing "An unknown error occurred", so it's set via the **root `wrangler.toml`** instead
(Cloudflare reads it at deploy because Root directory = `/`):
```toml
name = "invest254"
compatibility_date = "2024-09-23"
compatibility_flags = ["nodejs_compat"]
pages_build_output_dir = "apps/web/.vercel/output/static"
```
While `wrangler.toml` manages config, the dashboard Runtime settings become read-only (expected).

### 3.4 Redeploy
Pages → **Deployments → Retry deployment** (or push to `main`; auto-deploys are enabled).

---

## 4. Supabase — database

### 4.1 Connection
- Project ref: `yewujhbtfxeirhknckzg`, region `eu-west-1`.
- Use the **pooler** host `aws-0-eu-west-1.pooler.supabase.com`, user `postgres.<ref>`, db `postgres`.
- Session pooler **port 5432** is fine for the long-running Fly servers (6543 transaction mode also works).
- Migrations `0001–0026` are applied (21 public tables). Re-runnable (idempotent).

### 4.2 SSL gotcha (this caused the login 500)
`node-postgres` verifies the TLS CA when the string says `sslmode=require`, and Supabase's chain
fails Node's check → `Error: self-signed certificate in certificate chain`. The code calls
`new Pool({ connectionString })` with no `ssl` object, so the **connection string must use
`?sslmode=no-verify`** (encrypted, but skips CA verification). This is required on BOTH Fly apps.
- ✅ `...:5432/postgres?sslmode=no-verify`
- ❌ `...:5432/postgres?sslmode=require`  (Node throws "self-signed certificate in certificate chain")
- (psycopg2/libpq behaves differently — `require` works there but is irrelevant; the apps are Node.)
- Future hardening (optional): bundle Supabase's CA cert and use full verification (needs a code change).

### 4.3 Superadmin bootstrap
After registering through the app, promote the account:
```sql
update public.profiles set role = 'super_admin' where phone = '+2547XXXXXXXX';
```

### 4.4 PL/pgSQL "ambiguous column" gotcha
RPCs declared `RETURNS TABLE(user_id ...)` create an output variable that collides with a
`user_id` table column → `column reference "user_id" is ambiguous`. Fix by **qualifying table
columns** (e.g. `wallets.user_id`) — do NOT rename the output columns (the engine reads them by
name). `fn_admin_adjust_balance` was fixed this way; watch for the same pattern in other admin RPCs.

---

## 5. DNS & domain (`invest254.com`)

- Registered at **Namecheap**; **nameservers moved to Cloudflare** (`lauryn.ns.cloudflare.com`,
  `maciej.ns.cloudflare.com`) via Namecheap → Domain → NAMESERVERS → **Custom DNS**.
  (This is the registrar nameserver setting — NOT the "Personal DNS Server / Custom Nameservers"
  vanity-NS section, and NOT an A/CNAME record.)
- The Namecheap parking `A` + `www` CNAME were deleted; the **email-forwarding MX (eforward1–5) +
  SPF TXT were kept** so `@invest254.com` mail still works.
- `invest254.com` (apex) is attached to the Pages project as a **Custom domain** (Cloudflare auto-
  creates the record via CNAME-flattening and issues SSL).
- `www.invest254.com` is **not set up yet** (TODO — add as a second custom domain + redirect to apex).

### Client-side DNS note
Browsers cache negative (NXDOMAIN) answers. After DNS changes, Chrome may still fail while other
browsers work — fix with `chrome://net-internals/#dns` → "Clear host cache" (and `ipconfig /flushdns`).

---

## 6. CORS

`apps/api/src/http.ts` applies CORS on every request and answers preflight before routing.
`CORS_ALLOWED_ORIGINS` (comma-separated) defaults to `*` (echoes the request Origin back). Auth is a
Bearer token (not cookies), so `*` is safe. Verified: `Access-Control-Allow-Origin: https://invest254.com`
is returned. For defence-in-depth you may later set `CORS_ALLOWED_ORIGINS=https://invest254.com` on the API app.

---

## 7. Current verified status (2026-06-29)

- ✅ `https://invest254.com` serves the frontend (Cloudflare Pages); bundle calls the correct fly.dev URLs.
- ✅ `https://invest254.fly.dev/api/v1/health` → `200`; CORS allows `invest254.com`; login works against the real API.
- ✅ `wss://invest254-engine.fly.dev` engine app deployed (region jnb).
- ✅ Supabase reachable; migrations applied; `fn_admin_adjust_balance` ambiguity fixed (live + in repo).

### Outstanding / TODO
1. Add `www.invest254.com` custom domain + `www → apex` redirect.
2. (Security) Rotate the Supabase DB password (it was shared in chat) and update `DATABASE_URL` on both Fly apps.
3. (Security) Optionally tighten `CORS_ALLOWED_ORIGINS` to `https://invest254.com`.
4. (Hardening) Move DB TLS from `no-verify` to full CA verification (bundle Supabase CA; small code change).
5. Configure M-Pesa Daraja secrets on the API app before real deposits/withdrawals.
6. Engine machines can idle-suspend; confirm `auto_stop_machines="off"` keeps the game loop warm.

---

## 8. Quick reference — "where does X live?"

| Question | Answer |
|----------|--------|
| Where do users go? | `https://invest254.com` (Cloudflare Pages) |
| Where is the REST API? | `https://invest254.fly.dev/api/v1` (Fly `invest254`) |
| Where is the WebSocket? | `wss://invest254-engine.fly.dev` (Fly `invest254-engine`) |
| Where is the DB? | Supabase pooler, ref `yewujhbtfxeirhknckzg`, `?sslmode=no-verify` |
| How does the frontend know the API URL? | `NEXT_PUBLIC_API_BASE_URL` baked at Cloudflare build time |
| Why did login fail before? | (a) API had no IP, (b) frontend built with `localhost`, (c) DB used `sslmode=require` |
| Can I point the API to invest254.com? | **No.** That host is the static frontend; use `invest254.fly.dev`. |
