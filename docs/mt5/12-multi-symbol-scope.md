# Multi-symbol support: scope

What it would take to go from one tradable symbol to many, on the terminal (candlestick) shell.

Written after reading the engine rather than from the outside, so every claim below cites the code
that supports it. Nothing here is built yet.

---

## 0. Where we are today

**One symbol per brand, and the protocol has no concept of a second one.**

| Fact | Evidence |
|---|---|
| One `MarketSymbol` exists | `packages/shared/src/candles.ts` — `export const XAUUSD: MarketSymbol = { symbol: "XAUUSD", digits: 2, anchor: 2650, scale: 85 }` and nothing else |
| One price series per site | `apps/engine/src/siteregistry.ts` builds a single `new MarketHistory(...)` per site, passing no `instrument`, so it defaults to `XAUUSD` |
| The socket carries one instrument | `GameSocketProvider` — `getMarket: () => { instrument: MarketSymbol; anchor } \| null`. There is no symbol list in the protocol |
| A position does not record its symbol | `packages/db/migrations/0180_position_execution_price.sql` adds an execution price; no column names a symbol |

The eleven Volatility indices are **not** a counter-example: they live in the digits shell
(`components/game/digits/`), not the terminal.

---

## 1. The thing that makes this cheap: the mechanism already exists

The digits shell already runs **independent per-instrument price series off one day seed**, in
production. `packages/shared/src/instrumentfeed.ts`:

```ts
constructor(private readonly daySeed: string, readonly instrument: Instrument, K = 5) {
  const rng = new SeededRng(daySeed, `inst:${instrument.id}`);
```

The per-instrument **domain separator** (`inst:${id}`) is what makes each instrument's series
independent while staying deterministic from the one day seed. The engine caches them per
`(seed, instrumentId)`:

```ts
private feedFor(seed: string, instrumentId: string): InstrumentFeed {
  const key = `${seed}:${instrumentId}`;
```

The terminal's curve does **not** do this yet. `packages/shared/src/curve.ts` uses a fixed domain:

```ts
const rng = new SeedKeystream(serverSeed, "curve", 1 + 3 * WALK_POINTS);
```

Changing `"curve"` to `` `curve:${symbol}` `` is the entire mechanism for per-symbol curves. Keeping
the literal `"curve"` for XAUUSD makes it backwards compatible, so every historical day and every
settled position reconstructs exactly as before.

---

## 2. Does this touch the win/loss engine? Two paths, two answers

This is the question that decides whether the work is allowed at all, and the two paths differ.

### Pool path — the curve is already cosmetic

`apps/engine/src/game.ts`, verbatim comment:

> *"the shared curve entry/exit rate remain as cosmetic backdrop; the win/loss/amount come from the
> pool controller."*

The outcome comes from `pool.controller.decideReserve({ ... targetRtp, targetWinRate ... })`. The
curve supplies `entryRate`/`exitRate` for the record and the chart, and decides nothing.

**All production brands run pool mode**, so for them per-symbol curves cannot affect an outcome at
all.

### Statistical path — the curve DOES decide

`packages/shared/src/settle.ts`:

```ts
settle(stakeCents, dir, entryT): Outcome {
  const move = this.signedMove(dir, entryT);   // reads this.curve
  if (move >= p.tau) { ...win... }
  return { result: "loss", ... };
}
```

So with pool mode off (and for marketers), the curve's own movement decides win or loss.

**It still does not change the engine, and here is why.** Every per-symbol curve is *the same
stochastic process with a different seed* — identical `GameConfig`, identical generator, identical
distribution. The calibration that pins `targetWinRate` and RTP (`tau`, `gain`) is a property of
that distribution, not of any particular seed. A second symbol is another sample from the same
process, so the calibrated win rate holds on it unchanged.

That is a claim worth testing rather than asserting, and it is cheap to test: run the existing
calibration test (`packages/shared/src/settle.calibration.test.ts`) across N symbol seeds and assert
the realised win rate stays inside its tolerance for each. **That test is a precondition of shipping
this, not a nice-to-have.**

---

## 3. Real market data cannot drive settlement

The request was to pull prices from TradingView or another free source. Two separate problems.

### 3a. Licensing

See [11-market-data-sources.md](./11-market-data-sources.md). The short version is that TradingView
sells data access and its terms forbid redistribution; its *free* offerings (Lightweight Charts,
which this chart already uses, and the Charting Library) are **chart renderers you feed your own
data to**, not a data feed.

### 3b. The architectural problem, which is the bigger one

If settlement followed real prices, the engine would lose control of the win rate. `targetWinRate`
(0.125), `houseEdge` (0.75), the pool RTP budget and the marketer win rate are all knobs on a
*synthetic* process. Point them at a real market and they stop being knobs: the outcome becomes
whatever the market did, the house edge becomes market-dependent, and the product stops being a
fixed-odds game.

If instead the chart showed real prices while the engine settled on its own curve, the chart would
be lying about the thing it is drawn to explain. This codebase has been careful about exactly that:

> *"History bars are the same seeded curve the settlement engine scores — not a re-render of it."*
> — `CandleChart.tsx`

**So: real data for REFERENCE, synthetic for PRICES.** Open data decides what a symbol *is* — its
name, description, category, digit count, and the price level it should sit near — and the engine
generates its movement. XAUUSD near 2650 at 2 digits, EURUSD near 1.08 at 5, BTCUSD near 60000 at 2.
That is reference data, it is static, and it is the low-risk half of the licensing question.

---

## 4. Work breakdown

| # | Piece | Where | Size |
|---|---|---|---|
| 1 | Symbol catalogue: `MarketSymbol[]` with digits/anchor/scale + MT5 metadata (description, path, category) | `packages/shared/src/candles.ts` (+ a new `symbols.ts`) | S |
| 2 | Per-symbol curve domain separator, XAUUSD keeping the current literal for compatibility | `packages/shared/src/curve.ts` | **XS** |
| 3 | Calibration test across many symbol seeds | `packages/shared/src/settle.calibration.test.ts` | S |
| 4 | `MarketHistory` per symbol, cached per `(site, symbol)` | `apps/engine/src/siteregistry.ts`, `markethistory.ts` | M |
| 5 | Socket protocol: symbol list, per-symbol subscribe, symbol on the candles request | `apps/engine/src/server.ts`, `GameSocketProvider` | M |
| 6 | Position records its symbol (migration + repo + receipts) | `packages/db/migrations/0182_*`, repo | M |
| 7 | Per-brand symbol assignment, so a brand can offer a subset | DB + admin | M |
| 8 | Market Watch becomes a real list; the context menu's `Symbols`, `Sets`, `Sort`, `Hide` become live | `MarketWatch.tsx` | M |
| 9 | Chart symbol switching, with drawings and properties already stored per symbol | `CandleChart.tsx` | S (both already key off symbol) |

Items 8 and 9 are the only UI work; 1 to 7 are platform.

**Order:** 2 and 3 first. They are small, and 3 is the gate: if the win rate does not hold across
symbol seeds, the whole plan changes and nothing after it is worth building.

---

## 5. Decisions needed before building

1. **How many symbols, and which?** FX majors, metals, crypto and indices all behave differently and
   need different `digits`/`anchor`/`scale`. A catalogue of ~20 is a different job from ~200.
2. **Per brand, or global?** MT5 brokers offer per-account symbol sets. Item 7 only matters if
   brands differ.
3. **Do open positions survive a symbol switch?** MetaTrader holds positions across symbols at once.
   This engine currently tracks one open contract; multi-symbol makes "one per symbol" plausible and
   that is a product decision with a real blast radius in the Toolbox, the account summary and the
   pool budget.
4. **Historical reconstruction.** A new symbol has no past. Either its history starts today, or the
   generator backfills it from the same seeds — the latter is free, because the curve is
   deterministic from the day seed, and is what the chart already does for XAUUSD.

---

## 6. What is NOT in scope

- Real-money market exposure, or any claim that these prices are real.
- Prices sourced from a vendor whose terms forbid redistribution.
- Any change to how a win, a loss, a payout or the house edge is computed.
