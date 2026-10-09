# 53 — Paynicorn deposit rail (hosted cashier)

**Migration:** `0186_paynicorn_provider.sql` · **Client:** `apps/engine/src/paynicorn.ts`

## What it is
Paynicorn (paynicorn.com) is a hosted cashier: we create an order, Paynicorn returns a cashier URL, the
player pays there, and the browser comes back to the brand's `/wallet`. It is a **System-owner (global
scope) rail only** — a brand on its own payment accounts (docs/43) is refused with
`GATEWAY_NOT_CONFIGURED`, never routed to the System's Paynicorn account.

## Wire contract (paynicorn.com/docs, verified 2026-10)
- Every call: `POST https://api.paynicorn.com/trade/v3/transaction/<op>` with
  `{ content: base64(JSON(bizReq)), sign: md5(content + merchantSecret), appKey }`.
  Responses carry `responseCode` (`000000` = ok) plus a `content`/`sign` pair we verify the same way.
  The official test vector is a unit test (`paynicorn.test.ts`).
- `pay`: `{amount, countryCode:"KE", currency:"KES", orderId, orderDescription, cpFrontPage}` → `webUrl`.
  **KES has no decimals on Paynicorn**: amounts cross as whole shillings, and the API refuses a deposit
  that is not a whole number of shillings (`INVALID_AMOUNT`).
- `query`: `{orderId, txnType:"payment"}` → `status` `1` paid / `-1` processing / `0` failed.
- Postback to the app's callback address: `{content, sign}`; we must answer HTTP 200 + `success_{txnId}`
  (plain text) or Paynicorn retries up to 7 times (10 → 320 min).
- Test vs Production is the app's status in the Paynicorn console — same host, same keys. A test app
  only offers the MOCK payment method. Switching to Production requires one successful test order with
  a successful callback in the last 30 days.

## Money safety
- Our `transactions.id` is the Paynicorn `orderId` and the `checkout_request_id`, so the postback, the
  query and the reconcile sweep all key on it.
- A postback credits nothing by itself: the signature must verify with **our** merchant secret, a signed
  amount that disagrees with the order is refused (`409`, left for review), and the status that settles
  is the one from our own signed `query` call. Settlement runs through the shared idempotent
  `fn_complete_deposit`, so retries never double-credit.
- `reconcilePaynicornDeposits` runs on the reconcile interval for postbacks that never arrived.
- A signed postback for an order we don't hold is acknowledged and ignored (console address checks).

## Endpoints
| Route | Who | Purpose |
|---|---|---|
| `POST /api/v1/deposits/paynicorn` `{amount}` | player | 202 `{transactionId, checkoutUrl}` |
| `POST /api/v1/deposits/paynicorn/callback` (+ `/s/:slug/…`) | Paynicorn | postback (JSON or form body) |
| `GET  /api/v1/deposits/paynicorn/callback` | anyone | reachability for the console's CheckAddress |

Optional `PAYNICORN_CALLBACK_ALLOWED_CIDRS` locks the callback to Paynicorn's IPs.

## Turning it on
1. Deploy (migration 0186 registers `paynicorn` OFF for every brand, unbilled).
2. `/platform/payments` → Gateway configuration → **Paynicorn**: App key (APIKEY), Merchant secret,
   optional Return page → Save → **Test connection** (a signed query; moves no money).
3. Entitle the brand to the `paynicorn` add-on and switch the gateway on for it. The player's deposit
   sheet then shows an **Online checkout** tab (the gateway brand is never named, docs/35).
4. Paynicorn console → the app's **Callback address**:
   `https://invest254-api.fly.dev/api/v1/s/<slug>/deposits/paynicorn/callback`.
