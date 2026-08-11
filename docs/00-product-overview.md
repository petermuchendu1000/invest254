# 00 — Product Overview

## 1. Vision
Invest254 is a fast, social, real-money prediction game. A single live price curve (styled as
`BTC/KES`) streams to all players simultaneously. Players stake KES and predict whether the rate
will go **UP (BUY)** or **DOWN (SELL)** over a short trade window, cashing out for up to **×5.0**.
The experience blends the look of a trading terminal with the pace and social proof of a casino
crash game.

## 2. Who uses the system

| Role | Description | Primary surface |
|------|-------------|-----------------|
| **Player** | Deposits via M-Pesa, places BUY/SELL positions, withdraws winnings. | Player web app |
| **Marketer (Affiliate)** | A player who also refers others and earns 20% revenue-share. Can both play and earn. | Player app + Affiliate dashboard |
| **Support Agent** | Handles tickets, views (not edits) finances, assists KYC. | Admin (scoped) |
| **Finance Admin** | Approves withdrawals, reconciles M-Pesa, manages affiliate payouts. | Admin |
| **Super Admin** | Full control: users, game config (RTP/edge), bonuses, roles. | Admin |

## 3. Core value loop
1. Sign up (phone + OTP) → 2. Deposit (M-Pesa STK push) → 3. Play rounds (BUY/SELL) →
4. Win/lose against the live curve → 5. Withdraw (M-Pesa B2C) → 6. Invite friends (affiliate).

## 4. MVP scope (in)
- Phone+OTP signup/login, basic KYC (name, DOB age-gate ≥18).
- Wallet with real KES balance + bonus balance, full ledger.
- M-Pesa deposits (STK push) & withdrawals (B2C), with admin approval.
- Single shared game: live smooth curve, BUY/SELL, 10s auto-sell, manual sell, ×5 cap, 75% house edge.
- Provably-fair (simple server-seed) round records.
- Affiliate program: referral links, 20% revenue-share, dashboard, payout requests.
- Admin back office (user mgmt, finance, game config, reports, bonuses, affiliate mgmt).
- Live Activity feed (real + simulated) and basic chat.
- Welcome bonus + promo codes.

## 5. MVP scope (out / later)
- Multiple concurrent game rooms / multiple assets.
- Full document-upload KYC + third-party verification.
- Native mobile apps.
- Advanced anti-fraud ML, advanced CRM, tournaments/leaderboards.

## 6. Glossary
- **Round / Position / Trade** — a single player bet with an entry rate, direction, duration and outcome.
- **Tick** — one price point in the streaming curve (~5–10 per second).
- **Auto-sell timer** — trade duration after which the position closes automatically.
- **Multiplier** — payout factor applied to stake (1.0×–5.0×).
- **RTP** — Return To Player = 1 − house edge. MVP = 25%.
- **Net loss / GGR** — Gross Gaming Revenue = stakes − payouts; basis for affiliate rev-share.
