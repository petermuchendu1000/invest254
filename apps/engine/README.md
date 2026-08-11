# @invest254/engine — Authoritative Game Engine (prototype)

Real-time, server-authoritative engine for the Invest254 shared-curve game.

## Run
```bash
npm install
# from repo root:
PORT=8080 SERVER_SEED=<daily-hex-seed> npm run engine
# tests:
npm test
```
On boot the engine calibrates per-direction settlement (~3s) and serves WebSocket on `PORT`.

## What it does
- **Shared smooth curve** (`@invest254/shared` `CurveGenerator`): band-limited Fourier synthesis →
  C∞ smooth (no pointed peaks), deterministic from the daily server seed, green-dominant.
- **Curve-determined settlement** (`SettlementEngine`): `win ⇔ direction's net move ≥ τ_dir`;
  multiplier scales with the move, capped ×5. `(τ, gain)` are calibrated **per direction** so
  hold-to-expiry **RTP = 25% (house edge 75%)** exactly — verified by Monte-Carlo (measured 75.2%).
- **Atomic wallet** (`WalletStore`): stake debited on open, payout credited once on settle
  (idempotent). In-memory for the prototype; the Postgres adapter performs the same ops inside a
  `SELECT … FOR UPDATE` ledger transaction (docs/07).
- **WebSocket protocol** (docs/03): `hello`, `tick`, `position_opened`, `position_update`,
  `position_settled`, `balance`, `online`, `error`.

## WebSocket message flow
```
client → auth {userId}                  (PROTOTYPE: real build verifies a Supabase JWT)
server → hello {serverSeedHash, gameConfig} , online , balance
client → open_position {stakeCents, direction, durationS}
server → position_opened , balance(debited) , position_update* , position_settled , balance
client → sell {positionId}              (winners only)
```

## ⚠️ Design decision requiring sign-off (impossibility result)
*One shared curve* + *honest loss-cutting manual cashout* + *exact 75% edge* are **mutually
exclusive** (a cashout-invariant P&L must be a martingale, whose mean cannot be both 0 at open and
−0.75·stake at expiry). We therefore **gate losses to expiry**:
- Outcome is committed at open from the seeded curve (provably fair).
- A winning position's Live P&L rises monotonically (C² smoothstep) to its committed multiplier;
  **manual SELL locks the current value (≤ final)**.
- **Losing positions cannot be cashed out** — the loss is realised at the auto-sell timer.

This keeps the edge exact and non-gameable. If you instead want **SELL-anytime including losers**,
the edge becomes behaviour-dependent (and realistically far below 75%); say so and the
`SettlementEngine` swaps to that model.

## Provable fairness
`value(t)` and `τ_dir` derive from the committed daily `SERVER_SEED`; publish `sha256(SERVER_SEED)`
in advance and reveal the seed later so anyone can recompute every outcome (docs/02 §4).

## Persistence & auth (implemented)
- **`GameRepository`** abstraction with two implementations:
  - `PgGameRepository` — calls the atomic RPCs `fn_open_position` / `fn_settle_position`
    (migration 0010) via `pg`; used when `DATABASE_URL` is set.
  - `InMemoryGameRepository` — dev/test, mirrors the same contract.
- **JWT auth** on the socket via `jose`: HS256 (`SUPABASE_JWT_SECRET`) or asymmetric JWKS
  (`SUPABASE_JWKS_URL`); user derived from verified `sub`. Fails closed when `DATABASE_URL` is set.

## Not yet (next steps)
Redis fan-out for multi-instance tick broadcast, chat/activity-feed channels, daily seed rotation +
fairness reveal endpoint, persisting live position state for crash recovery, calibration caching to
avoid the ~3s boot recalibration.
