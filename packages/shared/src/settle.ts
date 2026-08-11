import { CurveGenerator } from "./curve.js";
import { SeededRng } from "./prng.js";
import { type GameConfig, assertFeasible, rtp } from "./config.js";
import { mulCents } from "./money.js";
import { winMultiplier, DEFAULT_WIN_SPREAD, type WinSpread } from "./engagement.js";
import type { Direction, Outcome } from "./types.js";

interface DirParams { tau: number; gain: number; }

function quantile(sortedAsc: number[], p: number): number {
  if (sortedAsc.length === 0) throw new Error("empty");
  const idx = Math.min(sortedAsc.length - 1, Math.max(0, Math.floor(p * (sortedAsc.length - 1))));
  return sortedAsc[idx]!;
}

/**
 * Settlement engine. Outcomes are determined by the shared, seed-derived curve:
 *   signedMove = dir * (value(entry+T) - value(entry))
 *   win  <=> signedMove >= tau_dir       (favourable move clears the threshold)
 *   mult  =  min(1 + gain_dir*signedMove, maxMultiplier)   on win, else loss (payout 0)
 *
 * (tau, gain) are calibrated PER DIRECTION at construction so that the hold-to-expiry
 * RTP equals exactly 1 - houseEdge and the win-rate equals targetWinRate. Calibrating
 * per direction neutralises the curve's visual green bias for fairness.
 *
 * Provable fairness: value() is a pure function of the committed daily server seed, so
 * given the revealed seed + public (entryTime, direction) anyone can recompute the move,
 * the threshold (published) and therefore the exact outcome.
 */
export class SettlementEngine {
  readonly params: Record<Direction, DirParams>;

  constructor(
    private readonly curve: CurveGenerator,
    private readonly cfg: GameConfig,
    calibrationSeed = "calibration",
    private readonly durationS = cfg.defaultDurationS,
    sampleWindowS = 3600,
    nSamples = 200_000,
  ) {
    assertFeasible(cfg);
    this.params = {
      buy: this.calibrate("buy", calibrationSeed, sampleWindowS, nSamples),
      sell: this.calibrate("sell", calibrationSeed, sampleWindowS, nSamples),
    };
  }

  private signedMove(dir: Direction, entryT: number): number {
    const d = dir === "buy" ? 1 : -1;
    return d * (this.curve.value(entryT + this.durationS) - this.curve.value(entryT));
  }

  private calibrate(dir: Direction, seed: string, windowS: number, n: number): DirParams {
    const rng = new SeededRng(seed, `calib:${dir}`);
    const moves: number[] = new Array(n);
    for (let i = 0; i < n; i++) moves[i] = this.signedMove(dir, rng.range(0, windowS));
    const asc = moves.slice().sort((a, b) => a - b);

    // tau: P(move >= tau) = targetWinRate  ->  tau is the (1 - winRate) quantile
    const tau = quantile(asc, 1 - this.cfg.targetWinRate);
    const winners = moves.filter((m) => m >= tau);
    const targetMeanWinMult = rtp(this.cfg) / this.cfg.targetWinRate;

    // gain: solve mean_winners( min(1 + gain*move, maxMult) ) = targetMeanWinMult  (monotone in gain)
    const meanWinMult = (gain: number): number => {
      let s = 0;
      for (const m of winners) s += Math.min(1 + gain * m, this.cfg.maxMultiplier);
      return s / winners.length;
    };
    let lo = 0, hi = 1;
    while (meanWinMult(hi) < targetMeanWinMult && hi < 1e9) hi *= 2;
    for (let i = 0; i < 60; i++) {
      const mid = (lo + hi) / 2;
      if (meanWinMult(mid) < targetMeanWinMult) lo = mid; else hi = mid;
    }
    return { tau, gain: (lo + hi) / 2 };
  }

  /** Settle a position at expiry (hold-to-expiry / auto-sell). */
  settle(stakeCents: number, dir: Direction, entryT: number): Outcome {
    const p = this.params[dir];
    const move = this.signedMove(dir, entryT);
    const entryRate = this.curve.rate(entryT);
    const exitRate = this.curve.rate(entryT + this.durationS);
    if (move >= p.tau) {
      const multiplier = Math.min(1 + p.gain * move, this.cfg.maxMultiplier);
      const payoutCents = mulCents(stakeCents, multiplier);
      return { result: "win", multiplier, payoutCents, pnlCents: payoutCents - stakeCents, entryRate, exitRate, signedMove: move };
    }
    return { result: "loss", multiplier: 0, payoutCents: 0, pnlCents: -stakeCents, entryRate, exitRate, signedMove: move };
  }

  /**
   * Variable-ratio settle: same win/loss decision and same calibrated mean winning
   * multiplier as settle(), but the individual winning multiplier is drawn from the
   * engagement spread (frequent small wins, rare larger ones) via a per-position
   * seeded RNG. RTP is preserved: the spread distribution's mean equals the
   * calibrated mean by construction. `nonce` makes the draw deterministic and
   * auditable per position.
   */
  settleVariable(stakeCents: number, dir: Direction, entryT: number, nonce: number, serverSeed: string, _spread: WinSpread = DEFAULT_WIN_SPREAD): Outcome {
    const base = this.settle(stakeCents, dir, entryT);
    if (base.result !== "win") return base;
    // Mean winning multiplier is the RTP-pinned target the calibrator solves for:
    //   E[multiplier | win] = rtp / targetWinRate.
    // The previous derivation (1 + gain * meanWinningMove, gated on `tau > 0`) collapsed to
    // 1.0 whenever the win threshold tau was <= 0 — which is the NORMAL case for any
    // targetWinRate >= ~0.5 on a near-symmetric curve (driftBias 0). That made every win pay
    // exactly x1.00 (net zero) and silently degraded RTP down to the win-rate. Pinning the
    // mean to rtp/targetWinRate directly preserves RTP for every feasible config.
    const meanMult = rtp(this.cfg) / this.cfg.targetWinRate;
    const rng = new SeededRng(serverSeed, `engage:${nonce}`);
    // Maximum-entropy draw on (1, maxMultiplier] with mean pinned to meanMult ⇒ RTP exact,
    // full configured range used (rare wins approach the cap), most-random given the mean.
    const multiplier = winMultiplier(rng, meanMult, this.cfg.maxMultiplier);
    const payoutCents = mulCents(stakeCents, multiplier);
    return { ...base, multiplier, payoutCents, pnlCents: payoutCents - stakeCents };
  }

  /**
   * Live multiplier for a WINNING position at round progress g in [0,1], rising
   * monotonically to the committed final multiplier via the C2 quintic smoothstep.
   * Manual SELL locks this value; since it is <= final and losses cannot be cashed
   * out early, early-selling can only REDUCE player payout (house edge >= target).
   */
  liveWinMultiplier(finalMultiplier: number, g: number): number {
    const x = Math.min(1, Math.max(0, g));
    const s = x * x * x * (x * (x * 6 - 15) + 10); // 6x^5-15x^4+10x^3
    return 1 + (finalMultiplier - 1) * s;
  }
}
