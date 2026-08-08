# 13 — Frontend Spec (Player Web App)

> **Implementation note:** This is the high-level *what* (screens / components / UX). The detailed,
> phase-by-phase, mobile-first build plan is **[17 — Frontend Build Plan](17-frontend-build-plan.md)**
> (phases FE0–FE7). This app corresponds to milestone **M4**, which is the current focus
> (see [16 — Roadmap](16-roadmap.md)).
>
> **Auth correction:** the implemented backend uses **phone + password** (self-managed, scrypt +
> self-issued JWT, **no OTP** — see [06 — Auth & KYC](06-auth-kyc.md)). Any "OTP" wording below is
> superseded by phone + password.

Stack: Next.js 14 + TypeScript + Tailwind. Dark theme matching the screenshot (near-black bg, neon
green/red curve, cyan accents).

## 1. Layout (desktop, matches screenshot)
- **Top bar:** logo "Invest254", headline `BTC/KES` rate + 24H high/low + online count, Login/Sign Up,
  theme toggle.
- **Ticker strip:** decorative crypto list (ETH, BNB, SOL, …) — display-only.
- **Left rail:** Live Activity feed + chat input.
- **Center:** the live smooth curve with timeframe toggles (30s/1m/2m/5m) and "Rate" badge.
- **Right panel:** Stake amount + quick chips (250/500/750/1,000), Auto-sell timer (default 10s),
  Live P&L, **BUY** (green) / **SELL** (red) buttons.
- **Footer:** licence line.

## 2. Key components
| Component | Responsibility |
|-----------|----------------|
| `CurveCanvas` | render ticks as a glassy smooth wave (Catmull-Rom spline), green fill above baseline / red below, glow; animates at tick rate |
| `BetPanel` | stake input + chips, direction buttons, duration, validation (≥50, ≤balance) |
| `LivePnl` | shows live multiplier & P&L from `position_update` |
| `PositionToast` | open/settled outcome notifications |
| `ActivityFeed` | streamed `activity` items |
| `Chat` | streamed `chat`, input with rate-limit + filter UX |
| `WalletWidget` | real/bonus balance, deposit/withdraw entry |
| `AuthModals` | **phone + password** signup/login (no OTP — see doc 06) |

## 3. State & data
- `useGameSocket()` hook manages WS connect/auth/reconnect, exposes ticks, position, balance.
- REST via typed client (auth, wallet, payments, history, affiliate).
- Optimistic UI on open/sell, reconciled by `position_settled`.

## 4. Smooth-curve rendering (requirement)
- Maintain a rolling buffer of ticks; interpolate with cubic spline; redraw on `requestAnimationFrame`.
- Bias styling so **green highs are taller & more frequent** (matches engine `drift_bias`); animated
  gradient fill + soft glow for the "waves" aesthetic.
- 60fps target; decouple render loop from network tick rate via interpolation.

## 5. Screens / routes
`/` game · `/wallet` deposit/withdraw/history · `/account` profile+KYC · `/affiliate` marketer
dashboard · `/r/:code` referral landing · auth modals overlaid.

## 6. Responsive (mobile-first — see doc 17 §4)
- **Mobile-first:** build & verify the 360px layout first — curve top, **bet panel sticky bottom**,
  feed/chat in tabs — then enhance upward.
- Tablet (`md`): two columns. Desktop (`lg`+): the 3-column layout above.

## 7. Accessibility & UX
- Clear win/loss feedback, responsible-gaming links, balance always visible, confirm on large stakes,
  disabled BUY/SELL when unauthenticated/insufficient balance with a helpful prompt.


---

## Addendum — Trade-screen design replica (FE8)

The canonical player trade screen follows the supplied mobile reference. The single
`/` screen, top → bottom:

1. **Top bar** — indigo "P" brand mark + Invest254 wordmark; `Login` (outline) +
   `Sign Up` (brand); balance pill.
2. **Price header** — `BTC/KES` signed curve value + % pill (value×100); 24H
   high/low (window extremes); live online count. (Synthetic curve value, not a
   real BTC price.)
3. **Asset ticker** — decorative marquee of placeholder symbols (no real data).
4. **Curve toolbar** — timeframe chips (30s/1m/2m/5m) + `Rate:` readout.
5. **Curve** — green-above / red-below zero-axis split, gradient fill, axis
   labels, live dot.
6. **Activity ticker** — single line, rotates recent events. **No chat here.**
7. **Bet panel** — KES input, 50/100/200/500 chips, circular auto-sell duration,
   idle Live P&L, always-visible BUY/SELL.
8. **Bottom nav** — TRADE / DEPOSIT / HISTORY / PROFILE.

Branding remains **Invest254**. Palette and component breakdown:
[17 — Frontend Build Plan](17-frontend-build-plan.md) §13.
