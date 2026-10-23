# 69 — Marketer agreements: session targets and dashboard visibility

Migration `0214`. Two things a platform admin agrees with **one** marketer. Neither moves money.

## The two marketers, first

This feature is keyed to `profiles` rows with `role='marketer'` — the people who earn
`deposit_commissions` and read `/dashboard`. **Not** `public.marketers`, which is the field-agent
till app with its own PIN login and its own wallet.

```
marketers=25   also_a_profile=0   profiles_role_marketer=28
```

Zero overlap, verified against production. The console's "Marketer wallets" panel lists the first
set; before this, the 28 accounts in the second set had **no operator screen at all**.

## 1. Session target

`marketer_session_targets`: `target_sessions`, `amount_cents`, `qualify_minutes`, per
`(site_id, marketer_id)`, one open at a time (partial unique index).

**It is a count and a figure, not a payment.** Reaching 5/5 credits nothing and reserves nothing. An
admin reads the same count and pays through the payout or advance queue, which already has its
approval step. `0191` drew this line itself — *"If per-session pay ever becomes the real rule, that
is a separate, deliberate change to the money path"* — and this is not that change. Automatic
crediting would mean a balance moving on a counter the beneficiary increments by pressing a button,
which is the shape of BUGLOG #163.

### The counting rule, and why it has a floor

A session costs nothing to create: `end()` is `set ended_at = now()` with no duration check, and
production already holds a **zero-minute** session. Counting raw presses would make five taps in
under a minute worth the full amount. So a session counts only when:

| condition | why |
|---|---|
| `ended_at is not null` | a target counts work **finished**. Redundant — null arithmetic already drops an open session — and kept as the rule in words. |
| `started_at >= target.started_at` | every session has exactly **one** owner: the target open when it began. Keying on `ended_at` would credit a new target with work done under the old one. |
| `ended_at - started_at >= qualify_minutes` | the floor. `qualify_minutes` is stored **on the target**, so changing the rule later cannot restate a target already in progress. |

**Reset** = the admin starts a new target. That closes the open one; progress restarts at zero.
There is no calendar period.

## 2. Dashboard visibility

`marketer_dashboard_prefs`: five switches, each defaulting `true`. **No row means everything is
visible**, so the 28 marketers who exist today are unaffected until an admin deliberately changes
something.

| switch | hides |
|---|---|
| `show_earnings` | Available to withdraw **and Request payout**, the money tables, per-deposit commission, the live session's earned/deposit figures |
| `show_live` | the Go live panel |
| `show_audience` | referrals, active players, clicks |
| `show_advance` | the advance request form |
| `show_activity` | the Expenses / Referrals / Advances ledger tabs |

The two features are one story: hide **Earnings & deposits** and show the **target** instead. A
marketer on a fixed per-session deal sees progress toward the fee they are actually paid, rather than
commission they are not on.

> **Presentation, not access control.** The endpoints stay open and the data is still the marketer's
> own. A hidden block means "we do not put this in front of you", never "you cannot reach this".
> Anything that must be unreachable needs a server-side gate instead.

## Routes

| | |
|---|---|
| `GET /affiliate/agreement` | the marketer's own target + prefs. Unwired store ⇒ no target, all visible — a dashboard must not fail to render over an optional feature. |
| `GET /platform/sites/:id/marketers` | the brand's marketer-role profiles with terms in force |
| `POST /platform/sites/:id/marketers/:uid/target` | start (closes the previous) |
| `POST …/target/close` | close |
| `PUT …/dashboard` | set switches; only keys present are changed |

Every admin route is `scopeSiteParam`-fenced **and** re-checks the marketer belongs to that brand.
Trusting the path pair alone would let a correctly scoped admin write terms onto another brand's
marketer by pasting an id — which is F-44.

## Verification

8 pg tests against a schema generated from production's own catalog. Mutants killed: duration floor
removed, `>=`→`>` boundary, foreign marketer's sessions counted, new target not closing the old,
`done` arithmetic, open-target filter dropped, prefs defaulting to hidden on a null join, and
ownership keyed on `ended_at` (caught only after adding a session that genuinely **spans** the
boundary — without it both rules look identical).

One survivor, equivalent: removing `ended_at is not null`. Proof rather than assertion —

```sql
select (null::timestamptz - now()) >= make_interval(mins => 30) is null;  -- t
```

Full suite 2458, 0 failures.

## Known wrinkles

- With Earnings hidden, the Advance form still reads *"Cash against upcoming commission… recovered
  from earnings"* — commission that marketer can no longer see. `show_advance` turns the block off;
  the wording has not been rewritten for the fixed-fee case.
- Expenses rows carry money figures (airtime, advances) and sit under `show_activity`, so they
  survive hiding Earnings. Deliberate — separate switch — but worth knowing.
