import { test } from "node:test";
import assert from "node:assert/strict";
import { accountSummary, lotsOfStake, LOT_STAKE_CENTS } from "./account.js";

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
