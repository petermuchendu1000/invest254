# 51 — DEMO-3: the Real/Demo switch, and why the Demo account has no way out

**Status:** UI landed. The database (`0123`, `0169`) and API halves already existed; this closes the
two gaps that made them invisible or contradicted them on screen.

## 1. What was already true

The money model has been correct since migration `0123` and hardened by `0169`:

| Layer | Guard |
|---|---|
| DB | `fn_create_withdrawal` reads `account_mode` **under the wallet's `FOR UPDATE` lock** and raises `DEMO_ACCOUNT` — a switch to demo cannot race past it |
| DB | `fn_account_is_demo` routes every stake/payout to `wallets.demo_balance`; `positions.demo` is stamped **at open**, so settlement can never pay a demo trade into real |
| API | `POST /withdrawals` refuses with 409 `DEMO_ACCOUNT` before any money path runs |

Demo funds have never been withdrawable, and never converted to real.

## 2. The two gaps this fixes

### Gap A — the UI still offered the way out

Every withdrawal entry point rendered unconditionally while in demo mode: the account popover's
**Withdraw** button, the top bar's **Withdraw** nav item and drawer entry, the profile menu's
**Withdraw**, the `/wallet` page button, and the wallet sheet's **Withdraw** tab. Tapping the balance
opened the Withdraw tab *by design*.

Clicking any of them reached a screen showing the real balance behind a **"Switch to Real"** button —
so cashing out read as one tap away from play money. That is the impression a demo account must never
give, whatever the server does afterwards.

Worse, `/wallet` labelled the row **"Withdrawable (real cash)"** against `wallet.real`, which is the
**demo** balance in demo mode. The page told a demo player their play money was cashable.

### Gap B — 13 of 15 brands could not reach the Demo account at all

The switcher only ever shipped on the `digits` trade surface (`DigitsAccount.tsx`). Production runs
`trade_ui = 'classic'` on **13 of 15 brands** (`invest254`, `madolar`, `33traders`, … ) and `digits`
on 2 (`mpesapap`, `muchwins`). On the classic shell `TopBar` rendered a plain `BalancePill` with no
account control — so the mode existed in the database and the API, and a player simply had no way to
switch into it. Production bears this out: **1 wallet in demo out of 2,886**.

## 3. The model now — one gate, asked everywhere

`walletFigures().canWithdraw` is the single question every surface asks before rendering **any** way
out — button, tab, menu item or tap target:

```
canWithdraw = wallet is known  AND  not (demo and not marketer)
```

- **False while the wallet is unknown.** Which account is active decides whether money can leave, so
  nothing is offered before the answer is in. A Withdraw button that appears and then vanishes is
  itself the hint this removes.
- **True for a demo-locked marketer.** Marketers are demo by design and their payout *is* the
  demo→M-Pesa transfer, so their behaviour is unchanged.
- **Absent, never disabled.** A greyed-out Withdraw still says "this could work" — so in demo mode the
  control is not rendered at all, and the wallet sheet drops its whole tab strip (Deposit is the only
  action left). `WithdrawForm` returns `null` rather than a "Switch to Real" screen, and `WalletModal`
  coerces a stale `withdraw` intent to Deposit, so no deep link or in-flight mode change can land on
  a withdrawal surface.

Deposit stays available in demo — it funds the **Real** account, which is the point.

Surfaces gated: `DigitsAccount` (popover), `DigitsTopBar` (desktop nav + drawer), `ProfileMenu`,
`AccountSwitcher`, `/wallet`, `WalletModal`, `WithdrawForm`, `WalletWidget`.

## 4. The classic shell gets the switcher

`components/wallet/AccountSwitcher.tsx` replaces `BalancePill` in `TopBar`: the active account's badge
(R/D), its balance, and a popover with Real and Demo rows, their balances, "Refresh demo balance" (in
demo), and the money actions under the same `canWithdraw` gate. It keeps `id="balance-pill"` so the
payout/welcome-bonus "money flying into balance" animations still find it.

`BalancePill.tsx` is deleted — its behaviour (tap → Withdraw) is precisely what this change removes,
and leaving it in the tree invites it back.

Switching is refused by the server while a contract is open (`OPEN_POSITIONS`); the classic shell
surfaces that error rather than pre-empting it, because the open-trade stores are specific to each
trade surface.

## 5. Tests

`apps/web/src/lib/wallet/figures.test.ts` — 11 cases pinning `canWithdraw` across real, demo (at every
balance including zero and a full demo bankroll), demo-locked marketer, a pre-`0123` wallet with no
`mode` field, and an unknown wallet; plus the cross-check that `withdrawable` is 0 whenever no
withdrawal may be offered, and is never the demo balance.

The server halves stay covered by `app.demo1.test.ts` ("a player in demo mode cannot withdraw; a
demo-locked marketer still can") and the `0169` lock-held check.


## 7. A marketer is presented as a normal player on their Real account (DEMO-5)

Earlier this section made a marketer's panel a neutral **Balance**-only card with no Real/Demo rows —
on the reasoning that a marketer "has no Real account". That was right about the money and wrong about
the *presentation*: it made a marketer's surface visibly different from a player's, which is the one
thing a covert social-proof account must never be.

The money layer is unchanged and remains the source of truth:

- a marketer's game money is `wallets.demo_balance` — the "funny money", **never** `real_balance`
  (`0084`, docs/27); the server pins every marketer trade to that one bucket (`fn_account_is_demo`);
- they cannot switch to real mode — `fn_set_account_mode` / `demo.pg.ts` refuse it (`MODE_LOCKED`);
- they **can** withdraw: `POST /withdrawals` detects the marketer (`requestWithdrawal → mode:'marketer'`)
  and routes to the instant game→marketer-wallet transfer, paid at once (200, `paid:true`), never the
  Daraja B2C hold path. Their earnings live in `marketer_wallets` / the marketer app at `/dashboard`.

So the funny money **is** their Real account, and the UI now says exactly that. A marketer is rendered
through the identical player path — the top-bar pill reads **R / Real** in the accent colour (its
`demo` flag is forced off for `modeLocked`), and the account panel shows one active **Real** row with
that balance, a check, and Deposit + Withdraw (the Withdraw the server routes to their transfer). No
`DEMO` pill, no greyed **Unavailable** Real row, no "Balance" euphemism, no account type named —
`AccountMenu` prints neither "marketer" nor "demo" for them, so nothing over their shoulder gives it
away.

What is **not** offered is a second, playable **Demo** practice bucket. A player's Demo is a separate
balance the server routes play to on a mode switch; a marketer has no such bucket and cannot switch, so
a Demo tab for them would be a control that cannot do what it says. Giving marketers a real practice
bucket is a money-layer change (move the funny money into `real_balance` and free `demo_balance` for
practice), deliberately **not** done here — this change is presentation-only, no money moves.

### The client was the last layer trusting the JWT role claim

`requireMarketer` resolves the marketer from the **database** — "the DB is the source of truth for
access (NOT the JWT role claim)". `MarketerHUD` and `/dashboard` still gated on `user.role`, so a
marketer whose profile reads `player` was locked out of their own app. Three accounts on `madolar`
are exactly that: `role='player'`, a `marketers` row on their brand, a funded `marketer_wallets`
balance (KES 13,700 / 30,000 / 8,000) and `demo_balance = real_balance = 0`.

`useIsMarketer()` now gates the client on `wallet.modeLocked` — the server's own
`fn_is_marketer_account`, the same predicate that routes their stakes to the demo bucket. It is a
ROUTING hint only: every marketer endpoint is still gated by `requireMarketer`, so a false positive
lands on a page whose calls 403.

### Covert by design

The dashboard entry is an invisible hotspot so that "NO visible button a watching player could
notice". The panel therefore names **no account type** — not "Marketer", not "Demo". A marketer shows
their phone to players as social proof; printing what the account is would defeat the entire surface.
Since DEMO-5 it goes further than hiding the type: it presents the funny money as a normal **Real**
account (badge, balance, Deposit + Withdraw), so the surface does not merely omit the tell — it reads
exactly like a player's.

> **Resolved (DEMO-5):** the top-bar pill used to read `DEMO` for a marketer because `mode === 'demo'`
> is true for them. Both pills (`AccountSwitcher`, `DigitsAccount`) now force the `demo` presentation
> flag off when `modeLocked`, so a marketer's pill reads **R / Real** with their funny money — matching
> a player exactly. The money layer is untouched; only what the marketer's surface *says* changed.
