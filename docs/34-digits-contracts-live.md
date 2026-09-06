# 34 — Deriv-style DIGIT contracts, live (Issue 1)

> Status: implemented on branch `feat/issue1-digits-live` (server-authoritative, provably fair,
> crash-safe). Multipliers are the next increment and remain preview. Supersedes the "demo-first /
> unwired" state of the Phase-2 contracts described elsewhere.

## What the "bot" is (researched)
Deriv's binary "bot" (DBot) is a **client-side auto-trader**: it repeatedly places digit contracts
(Even/Odd, Over/Under, Matches/Differs) on a chosen Volatility Index using a money-management
strategy — stake, a Martingale-style multiplier on loss, a target profit and a stop loss — and runs
in the browser. It is **not** the pricing/settlement backend. So the "bot" is **(a) the auto-trader
UI**, but it must place **real** contracts against **(b) the server-authoritative contract engine**,
which decides win/loss, moves money atomically, and is provably fair. We implemented both: the AUTO
panel is the bot; the engine is the authoritative broker it trades against.

## Architecture (how digits work now)
1. **Per-instrument authoritative feed** — `packages/shared/instrumentfeed.ts`.
   The daily-seed model is extended to each instrument. Everything a tick carries is a pure function
   of `(daySeed, instrumentId, tickIndex)`:
   - **Settlement digit** = `HMAC-SHA256(daySeed, "dg:<instrument>:<index>") mod 10` → **exactly
     uniform** over 0–9. Even/Odd = 0.5, each digit = 0.1, Over/Under exact — so the house edge equals
     the payout factor with zero distributional drift.
   - **Quote** = a smooth band-limited walk (scaled by the instrument's volatility) whose **last pip is
     set to that fair digit**, so the digit shown on the chart is the digit that settles.
   - Provably fair: once the day's seed is revealed (existing commit-then-reveal, migration 0011),
     anyone recomputes every quote and digit. Clients render **streamed** ticks (the seed stays
     server-side until reveal), exactly like the classic curve.
2. **Engine** — `apps/engine/src/game.ts`.
   `openDigitContract` records `openIndex`, `settleIndex = openIndex + ticks` (Deriv "ticks", default
   1) and persists `{kind,target,instrumentId,openIndex,settleIndex}` in `positions.contract`
   (atomic stake debit via `fn_open_contract`). `settleDueDigits(instrument, index)` settles every
   contract whose `settleIndex` has arrived; payout uses the **digit factor** (below) via
   `fn_settle_position`. Digits are pool-/override-exempt.
3. **Payout factor** — `packages/shared/config.ts` `digitPayoutFactor` (default **0.95 → 5% edge**),
   **independent of the rise/fall `houseEdge`**. (Fixes BUGLOG #18: `1 − houseEdge` = 0.25 would have
   paid 0.5× on an even/odd win.) Set 0.976 to mirror Deriv's on-screen "95.2% payout".
4. **Transport** — `apps/engine/src/multiengine.ts`.
   `subscribe_instrument` → `inst_history` (backfill) + live `inst_tick`; `open_digit` →
   `digit_opened` + `balance`; a per-`(site,instrument)` streamer ticks at the instrument cadence,
   fans ticks to watchers, and settles due contracts → `digit_settled` + `balance`. It auto-stops when
   idle (no watchers and no open contracts). Unknown instrument ids are rejected.
5. **Crash recovery** — `apps/engine/src/recovery.ts`.
   Open `kind='digit'` positions re-settle deterministically from the committed
   `{instrument, settleIndex}`, idempotently — a restart can never strand a debited stake.
6. **Web** — `GameSocketProvider` (one socket, extended) + `DigitsTradeScreen`.
   The screen streams the authoritative feed into the Deriv-style chart/heatmap and places **real**
   contracts (MANUAL and the AUTO Martingale bot). Settlement, session P/L, and balances come from
   `digit_settled` / `balance`. The old client-side simulation is gone; the UI layout is unchanged.

## Fairness & money guarantees (tested)
- Uniform digits (Monte-Carlo): each digit ≈ 10%, even/odd ≈ 50%; RTP ≈ payout factor.
- Chart digit == settled digit (WS end-to-end).
- Stake debited on open; win credits `round(stake × factor / winProb)`, loss pays 0; idempotent.
- Deterministic crash recovery (no double credit).
- Full suite **787/787**, `tsc -b` + web `tsc` clean.

## Follow-ups (not in this branch)
- Multipliers: drive TP/SL/stop-out/deal-cancellation from the instrument tick loop + recovery.
- Optional migration to make `digitPayoutFactor` a per-brand `site_game_config` column and advertise
  it to the client (today the client renders the shared default; the engine is authoritative).
- Configurable contract length (ticks 1–10) surfaced in the UI.
