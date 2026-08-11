# 08 — M-Pesa Payments (Daraja)

> Status: money state machine **implemented & verified live** — migration 0014 RPCs
> (`fn_create_deposit`/`fn_attach_stk`/`fn_complete_deposit`,
> `fn_create_withdrawal`/`fn_approve_withdrawal`/`fn_reject_withdrawal`/`fn_complete_withdrawal`),
> engine `PaymentRepository` + `PaymentService` + Daraja provider (`StubDarajaClient` for dev/tests,
> `HttpDarajaClient` for production). **Remaining:** the HTTP transport (`apps/api`) that binds these
> methods to REST routes and the Daraja callbacks (deposits/withdrawals complete via server→server
> HTTP callbacks, which need a public URL + live credentials).

Provider: **Safaricom Daraja API**. MVP uses **Daraja defaults / sandbox** credentials, swappable
to production. Deposits via **STK Push (Lipa na M-Pesa Online, Paybill)**; withdrawals via **B2C**.

## 1. Configuration (env / admin secrets)
```
MPESA_ENV=sandbox|production
MPESA_CONSUMER_KEY=...
MPESA_CONSUMER_SECRET=...
MPESA_SHORTCODE=...            # Paybill / business shortcode
MPESA_PASSKEY=...              # STK push passkey
MPESA_STK_CALLBACK_URL=https://api.invest254.../api/v1/deposits/mpesa/callback
MPESA_B2C_INITIATOR=...        # for withdrawals
MPESA_B2C_SECURITY_CREDENTIAL=...
MPESA_B2C_RESULT_URL=https://api.invest254.../api/v1/withdrawals/mpesa/result
MPESA_B2C_TIMEOUT_URL=...
```
Access token is fetched from `/oauth/v1/generate?grant_type=client_credentials` and cached ~55 min.

## 2. Deposit flow (STK Push)
```
1. Player: POST /deposits { amount, phone }
2. API: create transactions row (kind=deposit, status=pending)
3. API → Daraja POST /mpesa/stkpush/v1/processrequest
     { BusinessShortCode, Password=base64(shortcode+passkey+timestamp), Timestamp,
       TransactionType=CustomerPayBillOnline, Amount, PartyA=phone, PartyB=shortcode,
       PhoneNumber=phone, CallBackURL, AccountReference='Invest254', TransactionDesc='Deposit' }
4. Daraja returns CheckoutRequestID → store on transaction; player gets STK prompt on phone
5. Player enters M-Pesa PIN
6. Daraja → POST /deposits/mpesa/callback with ResultCode
     - ResultCode 0 (success): parse MpesaReceiptNumber, Amount → mark success,
       credit real_balance atomically, write ledger 'deposit', push balance over WS,
       trigger deposit-based bonus/promo if applicable
     - non-zero: mark failed (no credit)
7. (Safety) Poll /stkpushquery for stuck transactions; reconcile.
```
Idempotency: callback keyed by `CheckoutRequestID`; duplicate callbacks are ignored after success.

## 3. Withdrawal flow (B2C)
```
1. Player: POST /withdrawals { amount }
   - checks: KYC ok, amount ≤ real_balance, ≥ min, no unmet wagering, within daily limit
   - create transactions row (kind=withdrawal, status=pending); place HOLD (debit real_balance,
     ledger 'withdrawal' negative) so funds can't be double-spent
2. Admin (finance_admin) reviews queue → approve/reject
   - reject: reverse hold (re-credit), status=reversed
   - approve: API → Daraja B2C /mpesa/b2c/v1/paymentrequest
       { InitiatorName, SecurityCredential, CommandID=BusinessPayment, Amount,
         PartyA=shortcode, PartyB=phone, ResultURL, QueueTimeOutURL }
3. Daraja → POST /withdrawals/mpesa/result
     - success: status=success, store ConversationID/receipt
     - failure/timeout: status=failed → reverse hold (re-credit real_balance)
```
> MVP keeps **manual approval** for withdrawals (fraud control). Auto-approval under a threshold can
> be enabled later in admin config.

## 4. Reconciliation
- Daily job pulls M-Pesa statement (or uses transaction queries) and matches receipts to ledger.
- Mismatches flagged to finance_admin; nothing auto-adjusts money without an audited action.

## 5. Security
- Callback endpoints IP-allowlisted to Safaricom ranges + validate payload shape.
- Secrets in a vault, never in code; B2C SecurityCredential encrypted with Safaricom cert.
- All payment events audited; amounts validated server-side against the originating request.

## 6. Implementation map (current)
| Concern | Where | Notes |
|---|---|---|
| Atomic money state machine | `packages/db/migrations/0014` RPCs | SECURITY DEFINER, service-role only; idempotent via terminal-status guards under `FOR UPDATE`; **verified live with rollback** |
| Deposit credit | `fn_complete_deposit` (keyed by `checkout_request_id`) | duplicate callbacks after success/failed are no-ops |
| Withdrawal hold/reversal | `fn_create_withdrawal` (hold), `fn_reject_withdrawal`, `fn_complete_withdrawal` | success keeps the debit; reject/B2C-failure writes `withdrawal_reversal` and re-credits |
| Repository | `apps/engine/src/payments.ts` (`PgPaymentRepository` / `InMemoryPaymentRepository`) | same contract; in-memory mirrors RPCs for tests |
| Provider | `apps/engine/src/daraja.ts` | `StubDarajaClient` (dev/tests), `HttpDarajaClient` (OAuth cache, STK Push, B2C); `makeDarajaClient()` selects by env |
| Orchestration | `apps/engine/src/paymentservice.ts` | validation, MSISDN normalization, provider calls, `onWithdrawalSuccess` → masked activity event |
| Validation helpers | `packages/shared/src/payments.ts` | `normalizeMsisdn`, `validateDeposit`, `validateWithdrawal` |
| HTTP transport (REST + callbacks) | **pending** (`apps/api`) | binds `PaymentService` methods; needs public callback URL + live creds |
