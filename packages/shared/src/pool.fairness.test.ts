import { test } from "node:test";
import assert from "node:assert/strict";
import { decidePoolOutcomeFixed, DEFAULT_POOL_KNOBS, type PoolKnobs, type PlayerSession, type PoolState } from "./pool.js";
import { digitReturnCents } from "./contracts.js";

/**
 * Fairness regression for the pool-book retune (docs/25). The min-withdrawal "near-miss" lever
 * (letThroughProb) previously defaulted to 0.15, flipping ~85% of a player's would-be wins to losses
 * once they neared the withdrawal line — so realized RTP sat far below the target and players lost
 * ~100% near cash-out. The engine now runs the controller with letThroughProb=1 (near-miss disabled),
 * so realized RTP converges to the target the pacing loop aims for. The EDGE INVARIANT is preserved:
 * win propensity stays capped at base = targetRtp/meanMultiplier, so realized RTP <= 1 - house_edge.
 */

// Mirror the engine's decideReserveFixed knob construction for an Even/Odd digit contract.
function evenOddKnobs(letThroughProb: number, targetRtp: number, stake: number, payout: number): PoolKnobs {
  const m = payout / stake;
  return { ...DEFAULT_POOL_KNOBS, letThroughProb, maxMultiplier: m, targetSessionRtp: targetRtp, meanMultiplier: m, pCap: targetRtp / m };
}

function simulate(opts: { letThroughProb: number; aboveLine: boolean; N?: number }) {
  const targetRtp = 0.95;                 // house_edge 0.05
  const stake = 25000;
  const payout = digitReturnCents(stake, "even", 0, 0.95); // 47500 -> m = 1.9
  const k = evenOddKnobs(opts.letThroughProb, targetRtp, stake, payout);
  const W = 200000;                        // min withdrawal
  const balAfter = opts.aboveLine ? 200000 : 0; // above-line: every win crosses W -> near-miss applies
  // Huge pool so the cash + per-player-share caps never bind (we isolate the near-miss lever).
  const pool: PoolState = { amountCents: 10_000_000_000, paidCents: 0, reservedCents: 0, turnoverCents: 0 };
  const session: PlayerSession = { userId: "u", trades: 0, wins: 0, lossStreak: 0, returnedCents: 0, stakedCents: 0 } as any;
  const N = opts.N ?? 8000;
  let wins = 0;
  for (let i = 0; i < N; i++) {
    pool.turnoverCents = (pool.turnoverCents ?? 0) + stake;
    const d = decidePoolOutcomeFixed({
      stakeCents: stake, payoutCents: payout, pool, dayFraction: 0.5, knobs: k,
      serverSeed: "fair", nonce: i, session, balanceAfterStakeCents: balAfter, minWithdrawalCents: W,
    });
    if (d.result === "win") { wins++; session.wins++; session.lossStreak = 0; session.returnedCents += d.payoutCents; pool.paidCents += d.payoutCents; }
    else session.lossStreak++;
    session.trades++; session.stakedCents += stake;
  }
  return { winRate: wins / N, realizedRtp: pool.paidCents / (pool.turnoverCents || 1) };
}

test("RETUNE: above-the-line players now win toward the target RTP (letThroughProb=1)", () => {
  const r = simulate({ letThroughProb: 1, aboveLine: true });
  assert.ok(r.winRate > 0.4, `healthy win rate, got ${r.winRate.toFixed(3)}`);
  assert.ok(r.realizedRtp >= 0.85, `realized RTP converges toward target 0.95, got ${r.realizedRtp.toFixed(3)}`);
});

test("EDGE INVARIANT preserved: realized RTP never exceeds 1 - house_edge", () => {
  const r = simulate({ letThroughProb: 1, aboveLine: true });
  assert.ok(r.realizedRtp <= 0.95 + 0.02, `RTP must stay <= target (0.95), got ${r.realizedRtp.toFixed(3)}`);
});

test("BUG DOCUMENTED: old letThroughProb=0.15 suppressed above-line wins far below target", () => {
  const r = simulate({ letThroughProb: 0.15, aboveLine: true });
  assert.ok(r.realizedRtp < 0.35, `old near-miss crushed RTP well below target, got ${r.realizedRtp.toFixed(3)}`);
});

test("near-miss only ever hit players NEAR the line: below-line RTP was already fair", () => {
  const r = simulate({ letThroughProb: 0.15, aboveLine: false });
  assert.ok(r.realizedRtp >= 0.85, `below-line players always won toward target, got ${r.realizedRtp.toFixed(3)}`);
});
