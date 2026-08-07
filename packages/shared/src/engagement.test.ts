import { test } from "node:test";
import assert from "node:assert/strict";
import {
  variableRatioMultiplier, isNearMiss, isLossDisguisedAsWin, presentOutcome,
  bonusPctForDeposit, DEFAULT_BONUS_TIERS, DEFAULT_WIN_SPREAD,
} from "./engagement.js";
import { SeededRng } from "./prng.js";

test("variableRatioMultiplier: preserves the calibrated mean (RTP-neutral)", () => {
  const meanMult = 2.0, maxMult = 5.0;
  const N = 200_000;
  let sum = 0;
  for (let i = 0; i < N; i++) {
    const rng = new SeededRng("test-seed", `engage:${i}`);
    sum += variableRatioMultiplier(rng, meanMult, maxMult);
  }
  const empirical = sum / N;
  // symmetric spread -> mean within 2% of the calibrated value
  assert.ok(Math.abs(empirical - meanMult) / meanMult < 0.02, `mean ${empirical} drifted from ${meanMult}`);
});

test("variableRatioMultiplier: most wins are small, some are bigger (variable ratio)", () => {
  const meanMult = 2.0, maxMult = 5.0;
  const N = 100_000;
  let small = 0, big = 0;
  for (let i = 0; i < N; i++) {
    const rng = new SeededRng("s", `engage:${i}`);
    const m = variableRatioMultiplier(rng, meanMult, maxMult);
    if (m < meanMult * 0.95) small++;
    if (m > meanMult * 1.2) big++;
  }
  assert.ok(small / N > 0.5, `expected majority small wins, got ${small / N}`);
  assert.ok(big / N > 0.05, `expected a meaningful tail of bigger wins, got ${big / N}`);
});

test("variableRatioMultiplier: deterministic per (seed, nonce) and within bounds", () => {
  const a = variableRatioMultiplier(new SeededRng("seed", "engage:7"), 2, 5);
  const b = variableRatioMultiplier(new SeededRng("seed", "engage:7"), 2, 5);
  assert.equal(a, b);
  for (let i = 0; i < 1000; i++) {
    const m = variableRatioMultiplier(new SeededRng("seed", `engage:${i}`), 2, 5);
    assert.ok(m >= 1.01 && m <= 5, `out of bounds: ${m}`);
  }
});

test("variableRatioMultiplier: degenerate mean <= 1 passes through", () => {
  assert.equal(variableRatioMultiplier(new SeededRng("s", "engage:1"), 1, 5), 1);
});

test("isNearMiss: loss just below tau flagged, wins and blowouts not", () => {
  const tau = 0.1;
  assert.equal(isNearMiss(0.095, tau), true);   // within 15% band
  assert.equal(isNearMiss(0.11, tau), false);   // that's a win
  assert.equal(isNearMiss(-0.5, tau), false);   // blowout loss
  assert.equal(isNearMiss(0.084, tau), false);  // just outside band
});

test("isLossDisguisedAsWin: small multipliers flagged, real wins not", () => {
  assert.equal(isLossDisguisedAsWin(1.1), true);
  assert.equal(isLossDisguisedAsWin(1.24), true);
  assert.equal(isLossDisguisedAsWin(1.25), false);
  assert.equal(isLossDisguisedAsWin(3.0), false);
  assert.equal(isLossDisguisedAsWin(0), false);
});

test("presentOutcome: headlines are truthful about money", () => {
  assert.equal(presentOutcome({ result: "win", multiplier: 3.0, signedMove: 0.5, tau: 0.1 }).headline, "big_win");
  assert.equal(presentOutcome({ result: "win", multiplier: 1.5, signedMove: 0.5, tau: 0.1 }).headline, "win");
  assert.equal(presentOutcome({ result: "win", multiplier: 1.1, signedMove: 0.5, tau: 0.1 }).headline, "small_win");
  assert.equal(presentOutcome({ result: "loss", multiplier: 0, signedMove: 0.095, tau: 0.1 }).headline, "near_miss");
  assert.equal(presentOutcome({ result: "loss", multiplier: 0, signedMove: -0.4, tau: 0.1 }).headline, "loss");
});

test("bonusPctForDeposit: tier boundaries match the published offer", () => {
  // below KES 1,000 -> nothing
  assert.equal(bonusPctForDeposit(99_999), 0);
  // KES 1,000–5,000 -> 50%
  assert.equal(bonusPctForDeposit(100_000), 0.5);
  assert.equal(bonusPctForDeposit(500_000), 0.5);
  // >5,000–10,000 -> 25%
  assert.equal(bonusPctForDeposit(500_001), 0.25);
  assert.equal(bonusPctForDeposit(1_000_000), 0.25);
  // >10,000 -> 15%
  assert.equal(bonusPctForDeposit(1_000_001), 0.15);
  assert.equal(bonusPctForDeposit(50_000_000), 0.15);
  // custom tiers honored
  assert.equal(bonusPctForDeposit(100_000, [{ minCents: 0, maxCents: null, pct: 1 }]), 1);
  assert.ok(DEFAULT_BONUS_TIERS.length === 3);
});

test("win spread defaults: small share is the majority", () => {
  assert.ok(DEFAULT_WIN_SPREAD.smallShare >= 0.5 && DEFAULT_WIN_SPREAD.smallShare < 1);
  assert.ok(DEFAULT_WIN_SPREAD.smallBand[0] > 0 && DEFAULT_WIN_SPREAD.smallBand[1] <= 1);
});
