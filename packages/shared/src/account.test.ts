import { test } from "node:test";
import assert from "node:assert/strict";
import { accountSummary, exposureRows, lotsOfStake, LOT_STAKE_CENTS } from "./account.js";

test("a flat account: equity is the balance and there is no margin level", () => {
  const a = accountSummary({ balanceCents: 500_000, openStakeCents: 0, floatingPnlCents: 0 });
  assert.equal(a.equityCents, 500_000);
  assert.equal(a.marginCents, 0);
  assert.equal(a.freeMarginCents, 500_000);
  // Not 0 and not Infinity: with nothing open the ratio is undefined, and printing a number here
  // would read as a margin call on an account that holds no position at all.
  assert.equal(a.marginLevelPct, null);
});

test("a winning position lifts equity and free margin, leaving the balance alone", () => {
  // Balance is the SETTLED wallet, so it must not move until the contract settles.
  const a = accountSummary({ balanceCents: 500_000, openStakeCents: 100_000, floatingPnlCents: 40_000 });
  assert.equal(a.balanceCents, 500_000, "balance moves only on settlement");
  assert.equal(a.equityCents, 540_000);
  assert.equal(a.marginCents, 100_000);
  assert.equal(a.freeMarginCents, 440_000);
  assert.equal(a.marginLevelPct, 540);
});

test("a losing position lowers equity by exactly the engine's floating loss", () => {
  const a = accountSummary({ balanceCents: 500_000, openStakeCents: 100_000, floatingPnlCents: -100_000 });
  assert.equal(a.equityCents, 400_000);
  assert.equal(a.freeMarginCents, 300_000);
  assert.equal(a.marginLevelPct, 400);
});

test("margin level is Equity/Margin x 100 — MetaTrader's formula, not an approximation", () => {
  for (const [balance, stake, floating] of [[250_000, 50_000, 0], [1_000_000, 300_000, -120_000], [75_000, 25_000, 60_000]] as const) {
    const a = accountSummary({ balanceCents: balance, openStakeCents: stake, floatingPnlCents: floating });
    assert.equal(a.marginLevelPct, (a.equityCents / a.marginCents) * 100);
  }
});

test("equity can fall below the stake without going negative on a total loss", () => {
  // The worst a contract can do is lose its whole stake, so equity bottoms out at balance - stake.
  const a = accountSummary({ balanceCents: 120_000, openStakeCents: 120_000, floatingPnlCents: -120_000 });
  assert.equal(a.equityCents, 0);
  assert.equal(a.freeMarginCents, -120_000);
  assert.equal(a.marginLevelPct, 0);
});

test("volume: a stake renders as lots at the documented contract size", () => {
  assert.equal(lotsOfStake(LOT_STAKE_CENTS), "1.00");
  assert.equal(lotsOfStake(LOT_STAKE_CENTS / 2), "0.50");
  assert.equal(lotsOfStake(25_000), "0.03");       // the KES 250 minimum stake
  assert.equal(lotsOfStake(5_000_000), "5.00");    // the KES 50,000 maximum stake
  // Presentation only: it must never round a stake to zero and so imply a free trade.
  assert.notEqual(lotsOfStake(25_000), "0.00");
});

test("exposure nets opposite contracts on one symbol, as MetaTrader's Exposure does", () => {
  // A buy is positive and a sell negative, so one of each in the same size is flat in volume.
  const rows = exposureRows([
    { symbol: "XAUUSD", direction: "buy", stakeCents: LOT_STAKE_CENTS },
    { symbol: "XAUUSD", direction: "sell", stakeCents: LOT_STAKE_CENTS },
  ]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.netLots, 0);
  // But the money committed is NOT flat: both stakes are still at risk.
  assert.equal(rows[0]!.valueCents, 2 * LOT_STAKE_CENTS);
  assert.equal(rows[0]!.share, 1);
});

test("exposure reports each symbol once, largest first", () => {
  const rows = exposureRows([
    { symbol: "EURUSD", direction: "buy", stakeCents: 100_000 },
    { symbol: "XAUUSD", direction: "buy", stakeCents: 300_000 },
    { symbol: "EURUSD", direction: "buy", stakeCents: 100_000 },
  ]);
  assert.deepEqual(rows.map((r) => r.symbol), ["XAUUSD", "EURUSD"]);
  assert.equal(rows[0]!.valueCents, 300_000);
  assert.equal(rows[1]!.valueCents, 200_000);
  // The shares are the bar MetaTrader draws, and they account for the whole account.
  assert.equal(rows[0]!.share + rows[1]!.share, 1);
  assert.ok(Math.abs(rows[0]!.share - 0.6) < 1e-9);
});

test("a short position is a negative volume and a positive value", () => {
  const rows = exposureRows([
    { symbol: "XAUUSD", direction: "sell", stakeCents: 2 * LOT_STAKE_CENTS },
  ]);
  assert.equal(rows[0]!.netLots, -2);
  // Money at risk has no direction.
  assert.equal(rows[0]!.valueCents, 2 * LOT_STAKE_CENTS);
});

test("a flat account has no exposure rows, as MetaTrader shows none", () => {
  assert.deepEqual(exposureRows([]), []);
});
