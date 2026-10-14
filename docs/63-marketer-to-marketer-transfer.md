# 63 — Marketer-to-marketer funny-money transfer

**No migration (this screen).** API: `apps/api/src/app.marketers.ts` ·
App: `petermuchendu1000/mpesa_2` · **BUGLOG:** #140 ·
**Tests:** `app.marketers.recipientlookup.test.ts`, `MsisdnTest.kt`

> **Status: SCREEN 1 OF 2.** This covers the Send Money screen and the recipient lookup it needs.
> The Confirm step, and the transfer RPC that actually moves the money, are not built yet — see §6.

---

## 1. Why

A marketer's till app runs on simulated money (docs/27 — "they play the game on funny money… NONE
of it is real money"). When one runs out, the only ways to get more were an admin or platform admin
crediting them (`POST /admin/marketers/:id/credit`) or the self top-up to a fixed policy cap
(`POST /marketers/me/demo-topup`, docs/BUGLOG #102). Both put a ceiling or a person in the way of
something no real cash passes through.

The owner's ask: **a marketer should be able to ring a colleague and be sent some.** This is the
screen the colleague sends it from.

## 2. What was decided

| | |
|---|---|
| **Which money** | `marketer_wallets.balance_cents` — the balance the till app shows. **Not** `wallets.demo_balance`, which is the marketer's *game* bucket on the website (docs/27, migration 0084). The two are different wallets and this feature touches only the first. |
| **Who may receive** | An **active marketer on the sender's own brand**. Funny money only exists inside a marketer wallet, so there is nowhere else for it to go. |
| **Cross-brand** | **Refused.** A marketer of brand A cannot send to, or even resolve, a marketer of brand B. This is the same fence migration 0199 put in the database for the admin RPCs (docs/60), applied to the one read the app needs. |
| **How the recipient is identified** | The sender types the number their colleague gave them; the server resolves the **registered name** from `marketers` and the app shows it before the send. No directory, no picker, no list. |
| **Theme** | The app's existing **light** palette. The reference screenshots are the real M-PESA app in dark mode; the layout is theirs, the colours are this app's, because a dark screen reached from this app's light Home would be the only dark surface in the product. |

## 3. The recipient lookup

```
POST /api/v1/marketers/recipients/lookup   { phone }  ->  { name, self }
```

Gated by `requireAuth` + `requireMarketer` + a per-marketer rate limit.

**It is a name oracle keyed on a phone number**, and most of its design is about bounding that:

- **Brand scope is not a parameter.** The site id comes from the authenticated marketer's own
  profile, so there is nothing in the request to tamper with.
- **One refusal for every failure.** `RECIPIENT_NOT_FOUND` covers "nobody holds this number",
  "they are on another brand", "they are suspended" and "they are not a marketer". A test asserts
  the cross-brand refusal and the no-such-number refusal are byte-identical — otherwise the route
  becomes a way to map which numbers belong to which brand.
- **The response carries the name and nothing else.** Not the phone, the id, the balance, the
  status or the brand. A test asserts on the raw body that the recipient's digits appear nowhere,
  because this route is the obvious place for docs/58 to regress.
- **`by: "user"`, not `by: "ip"`** (20/min, `RATE_LIMIT_RECIPIENT_LOOKUP_PER_MIN`). Every marketer
  is behind Kenyan carrier-grade NAT, so an IP budget is shared by thousands of unrelated handsets:
  it would throttle honest users and barely inconvenience one account walking `07xx`. The per-user
  budget binds the attacker, who has to *be* an authenticated active marketer of the brand being
  swept.
- **POST, although it reads.** The number is the thing being protected, and a query string travels
  into edge access logs, browser history and `Referer` headers in a way a body does not. The API's
  own logger records `url.pathname` only (`http.ts`), but the hosting edge is not ours to promise
  about.

### `self` is load-bearing, not a convenience

`GET /marketers/me` masks the marketer's **own** number (docs/58 — `0798****061`), so the app holds
a masked string and **cannot** compare a typed number against it. Without a server-side `self` flag
the client could not detect a send-to-self at all. The one party holding both numbers answers it.

### What this does NOT reverse

docs/58 stands. The app still never receives anyone's full number from the server — including the
recipient's. It receives a **name**, for a number the user already had and typed in themselves.

## 4. The screen (mpesa_2)

`ui/screens/SendMoneyScreen.kt`, reached from `Routes.SEND_MONEY` / `Routes.SEND_POCHI`.
`Routes.forAction` intercepts the `send_money` and `pochi` catalogue tiles, so all four places that
render those tiles (Quick Actions, Frequents, All Services, Life) pick the new screen up at once —
routing them one by one is how three of them would have kept the old generic form.

- **Two tabs, one transfer.** "Mobile number" and "Pochi la Biashara" move the same money between
  the same two wallets. Pochi is the lighter form — no QR, no withdrawal-charge tick, no Do More —
  as the reference shows, because a Pochi payment is a payment to a trader's till rather than cash
  to a person: there is nothing to withdraw and nothing to scan.
- **The number is checked before Continue lights up**, not after. A send that was going to fail
  should fail while the sender is still looking at the number they typed.
- **Four distinct outcomes under the field**, never collapsed: the resolved name, "you can't send to
  yourself", "no marketer is registered on this number", and "couldn't check". The last two must
  not share a sentence — one means retype, the other means retry.
- **Lookups are debounced 350ms and keyed on the normalised number**, so a number typed straight
  through costs one request, and re-typing the same person in another format costs none.
- **Favourites are stored on the handset and nowhere else** (`data/Favourites.kt`). A favourite is a
  name plus a full number; syncing them would quietly build the shared directory docs/58 exists to
  prevent. They are cleared on logout.
- **"Add withdrawal charges"** is a simulation of Safaricom's agent-withdrawal tariff, so the
  recipient nets the round number. No fee is charged anywhere and no funny money is destroyed — the
  tick simply increases the amount transferred. **Tariff checked 2026-10-14:** the KSh 11 band for
  KSh 50–100 is confirmed on Safaricom's own M-PESA rates page and is the band the reference
  screenshot shows; **the bands above KSh 100 are reported by independent Kenyan tariff trackers and
  are NOT confirmed against Safaricom's own published table** — treat them as reported, not verified.
- **Shiriki Pay** is drawn because the reference has it, and says plainly that it isn't linked to
  this account rather than pretending to be a second wallet.

`Msisdn.normalize` is a digit-for-digit copy of the server's `normalizeMsisdn`
(`packages/shared/payments.ts`) and `MsisdnTest.kt` pins it to that module's own test table. They
have to agree: the app uses it to decide **when** to ask who a number belongs to, and the server
uses its copy to decide **who**. A looser rule fires lookups the server always refuses; a stricter
one refuses to look up numbers the server would have resolved.

## 5. Rejected

| Option | Why not |
|---|---|
| **A picker listing the brand's marketers (names + numbers)** | The most convenient reading of the ask, and the one that hands every marketer the full roster of their brand and everyone's phone number. That is exactly what docs/58 removed. Offered to the owner and declined. |
| **A picker with names only** | Still a roster: it tells any marketer who else is on the brand, and makes "is X a marketer here?" answerable without knowing a number. The typed-number lookup needs the number first, which is the whole point. |
| **Raising the self top-up cap instead** | Does not answer the ask. The cap is not the complaint — needing someone else to act is, and a self top-up is still the marketer topping up *themselves*. |
| **Sending to any phone number, M-PESA style** | There is no wallet to credit. It would have to fail at the Confirm step, after the sender had entered an amount. |
| **Letting the app compare numbers to block self-sends** | It cannot: `/me` is masked (docs/58). |
| **GET for the lookup** | Puts the number in a URL. See §3. |

## 6. Not built yet (screen 2)

The Confirm step and the transfer itself. It will need, at minimum:

- a **single DB RPC** that debits the sender and credits the recipient **in one transaction**, with
  the same brand fence the other marketer RPCs carry (0199), refusing self-transfer, non-positive
  amounts and overdraft;
- **idempotency** on a client-supplied ref, so a retried request cannot send twice;
- a **ledger row on both sides** so each wallet's statement and the M-PESA confirmation feed
  (`ledgerToTxDto`) read correctly;
- the sender's **PIN** (the app already has `PinEntryScreen`);
- a **per-marketer daily transfer cap**, because the funny-money supply is a policy number and
  peer-to-peer transfer is a new way to concentrate it.

**Until that lands, this screen collects and validates only — it debits nobody.** `SendFlow` is
handed to a Confirm route that is currently a no-op.
