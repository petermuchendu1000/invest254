# 47 — Billing: invoices, payments, dunning and revenue (BILL-1)

Owner request (2026-09-23): *"We need a really serious /billing page (especially from both platform and system
admins). Very professional, comprehensive, thorough, and rigorous … Implement, research, and design the best UI
and backends — fully wired and tested e2e."*

Owner decisions (same day):
- **Bill-to:** the **platform**. One consolidated invoice per platform covers the plan and every brand's add-ons, and each line names the brand.
- **Add-on pricing:** set per add-on. Each is free, one-off or monthly, with an optional one-off setup fee.
- **Payment:** **M-Pesa "Pay now"** sends an STK prompt, and the money lands in the System account. The owner can also record payments by hand (bank, cash, other).

## 1. What existed (docs/39)

- `platform_subscriptions` held a plan, a status and dates.
- A daily cron moved trial or active → past_due → grace → suspended purely on dates.
- A "payment" was the owner pressing *Mark paid*.
- There were no invoices and no payment collection. Add-on prices were never billed: approval only wrote an `addon.charge` audit row, yet the brand page said "It is billed at KES X".
- The owner's page listed the platform's status (active/archived), not its subscription status.

## 2. Model (reference: the Stripe Billing lifecycle, adapted to invoices you send and M-Pesa)

| Object | Purpose |
|---|---|
| `billing_settings` (singleton) | Seller details printed on invoices; invoice prefix and next number; payment terms (days until due); tax (rate in basis points, label); manual payment instructions; whether M-Pesa Pay now is offered |
| `subscription_plans` (existing) | Price and limits per plan. The owner can now edit plans and add new ones. |
| `platform_subscriptions` (existing) | Plan, custom price, status, service period. New: `billing_exempt`. The System's own default platform is exempt. |
| `addon_catalog` (+) | `billing_type` (`free` \| `one_off` \| `monthly`) and `setup_fee_cents`. `price_cents` is the one-off price or the monthly price. |
| `billing_charges` | Items waiting to be invoiced: add-on one-off and setup fees, adjustments, credits (negative). They go onto the next invoice. |
| `invoices` | `draft`→`open`→`paid` \| `void` \| `uncollectible`. Numbered `{PREFIX}-{YYYY}-{00001}`. Fields: service period, issue date, due date, subtotal / tax / total / paid / due, and a reminder stage. |
| `invoice_lines` | Plan, monthly add-on (per brand), one-off add-on, setup fee, adjustment, credit. |
| `invoice_payments` | M-Pesa STK (pending → succeeded \| failed, with checkout id and receipt) or manual (bank / cash / other). Partial payments are allowed. |

## 3. Lifecycle (`fn_billing_run`, daily; also "Run billing now")

1. **Renewal (bill in advance).**
   - When a subscription reaches its anchor, the next period is invoiced for the plan price, plus every monthly add-on of the platform's active brands, plus any pending charges. The anchor is `trial_ends_at` for a trial and `current_period_end` otherwise. The invoice is due after the payment terms (default 7 days).
   - The service period advances. A trial becomes `active`, with its first invoice open.
   - Missed runs catch up, up to 12 periods.
   - A zero-total invoice is marked paid automatically.
2. **Dunning (on the oldest unpaid invoice).**
   - Due date passed: `active` → `past_due`.
   - `past_due_days` after the due date: `grace_period`, with `grace_ends_at` set to now + `grace_days`.
   - Grace period over: `suspended`. The brands go offline (0138 enforcement).
3. **Reminders.** Platform admins get in-app notices in category `billing`, one per stage: invoice issued → due in ≤ 3 days → overdue → grace (with the suspension date) → suspended.
4. **Payment.** When an invoice is fully paid and no other overdue invoice remains, a `past_due`, `grace_period` or `suspended` subscription returns to `active`. The platform admins and the owner are notified.

## 4. Money safety

- **Pay now.**
  - The engine sends an STK push from the **System** M-Pesa account (never a platform's own account) with `AccountReference` = the invoice number.
  - The amount is the balance due, in whole shillings.
  - The shared STK callback URL is routed to billing when the checkout id belongs to an invoice payment.
  - The result is **verified with STKPushQuery** before anything is marked paid. A forged callback cannot pay an invoice.
  - A 2-minute sweep settles payments whose callback never arrived.
- **Settlement is idempotent.** Only `pending` can change to `succeeded` or `failed`, and a payment is applied to its invoice exactly once.
- **Only the System owner can move money records.** That covers recording payments, voiding, write-offs, charges, credits and plans. A platform admin reads only its own platform's invoices and can pay only those.
- **Audit.** Every action writes to `admin_actions` and, where the status changes, to `subscription_events`.

## 5. Screens

- **System owner, `/platform/billing`:**
  - **Overview:** MRR, ARR, outstanding, overdue, collected this month, an aging bar (current / 1–30 / 31–60 / 61–90 / 90+), a "Needs attention" list, upcoming renewals and recent payments.
  - **Invoices:** filter by status, platform and number.
  - **Subscriptions:** per platform: plan, price, status, next invoice, balance. Actions: change plan, charge or credit, create invoice, status changes, exempt.
  - **Plans:** edit and add plans.
  - **Settings:** seller details, prefix, terms, tax, Pay now, dunning durations.
- **Platform admin, `/platform/billing`:**
  - Plan and status in plain words, next invoice and estimate, usage meters.
  - A balance-due banner with **Pay now**.
  - Invoices and payment history.
  - Plan comparison.
  - How to pay by hand.
- **Invoice page, `/platform/billing/invoices/[id]`:** a printable invoice (seller, bill-to, number, dates, lines by brand, totals, payments) with the actions allowed to the viewer.
