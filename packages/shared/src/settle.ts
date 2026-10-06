import { CurveGenerator } from "./curve.js";
import { SeededRng } from "./prng.js";
import { type GameConfig, assertFeasible, rtp } from "./config.js";
import { mulCents } from "./money.js";
import { winMultiplier, DEFAULT_WIN_SPREAD, type WinSpread } from "./engagement.js";
import type { Direction, Outcome } from "./types.js";

interface DirParams { tau: number; gain: number; }

/**
 * Entry-time span the calibrator samples over. It MUST cover the curve's slowest timescale, or the
 * sampled move distribution is not representative of the trading day and the realized win-rate/RTP
 * drift off target.
 *
 * This is a full UTC day because the `market` curve profile carries structure all the way out to a
 * ~1-day period. Measured on the day-scale curve with a 1-hour window the error was real — win-rate
 * 0.668 vs 0.650 and RTP 0.977 vs 0.950; with a full-day window, 0.644 / 0.941 (both in tolerance).
 * Widening the window costs nothing: `nSamples` is unchanged, only the range entry times are drawn
 * from. See curve.ts PROFILES.market.
 */
export const CALIBRATION_WINDOW_S = 86_400;

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
    private readonly calibrationSeed = "calibration",
    private readonly durationS = cfg.defaultDurationS,
    private readonly sampleWindowS = CALIBRATION_WINDOW_S,
    private readonly nSamples = 200_000,
  ) {
    assertFeasible(cfg);
    this.params = {
      buy: this.calibrate("buy", calibrationSeed, sampleWindowS, nSamples),
      sell: this.calibrate("sell", calibrationSeed, sampleWindowS, nSamples),
    };
  }

  private signedMove(dir: Direction, entryT: number): number {
    return this.moveAt(dir, entryT, this.durationS);
  }

  /**
   * The favourable move this contract has made after `elapsedS` seconds.
   *
   * The same quantity `signedMove` settles on, read at an arbitrary moment rather than only at
   * expiry. It is what lets the floating P/L follow the price instead of a timer: at
   * `elapsedS = durationS` the two are the same number, so the live path and the settlement cannot
   * disagree about where the contract ends up.
   *
   * Public because the game server needs it every tick; the curve it reads is this day's, so a
   * caller holding a position from an earlier day must not use it (see `livePriceMultiplier`).
   */
  moveAt(dir: Direction, entryT: number, elapsedS: number): number {
    const d = dir === "buy" ? 1 : -1;
    return d * (this.curve.value(entryT + elapsedS) - this.curve.value(entryT));
  }

  /** The calibrated move-to-multiplier gain for a direction, which the live path scales with. */
  gainFor(dir: Direction): number { return this.params[dir].gain; }

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
   * The CONTINUOUS payout's two parameters, per direction.
   *
   * See docs/mt5/20-real-sl-tp.md for the measurements behind this. In short: the step payout above
   * (nothing until `tau`, then a jump straight to 1 + gain*tau = 1.70x) is what makes a real stop
   * impossible. A take profit set below `tau` closes the contract on the zero side of the step and
   * pays the trader NOTHING for being right but modest (measured RTP 0.00%); a target at or above
   * `tau` leaks a third of the house edge (25% RTP becoming 33%). A step payout and a continuous
   * target cannot both be sane.
   *
   * The continuous form is a line through a cost:
   *
   *     payout = clamp(1 + gain * (move - cost), 0, maxMultiplier)
   *
   * `cost` is economically the SPREAD: the move a trader must make to break even, and the whole
   * house edge. `gain` is inherited from the step calibration unchanged, so the payout keeps the
   * spread the operator already tuned, and only the threshold becomes a cost.
   *
   * Measured over 40,000 trades per rule on three seeds: RTP holds at 24.4-25.4% against a 25%
   * target for every sane stopping rule (held to horizon, tight stops, wide stops, target only,
   * stop only), where the step payout leaked to 33%. No stopping rule beats the house.
   */
  private continuous: Record<Direction, { cost: number; gain: number }> | null = null;

  /**
   * Solve `cost` so a contract held to the horizon returns exactly the configured RTP.
   *
   * Monotone decreasing in cost (a bigger cost can only lower every payout), so a bisection is
   * exact to the bit. Sampled from the same process and window the step calibration uses, so the
   * two are comparable and a brand that switches between them keeps its economics.
   */
  private calibrateContinuous(dir: Direction, seed: string, windowS: number, n: number): { cost: number; gain: number } {
    const rng = new SeededRng(seed, `cont:${dir}`);
    const moves: number[] = new Array(n);
    for (let i = 0; i < n; i++) moves[i] = this.signedMove(dir, rng.range(0, windowS));
    const gain = this.params[dir].gain;
    const target = rtp(this.cfg);
    const meanPayout = (cost: number): number => {
      let s = 0;
      for (const m of moves) s += Math.max(0, Math.min(1 + gain * (m - cost), this.cfg.maxMultiplier));
      return s / moves.length;
    };
    // The payout is 0 everywhere once cost exceeds the largest move, so the bracket is finite.
    let lo = 0, hi = 1 / gain + Math.max(...moves) + 1e-9;
    for (let i = 0; i < 80; i++) {
      const mid = (lo + hi) / 2;
      if (meanPayout(mid) > target) lo = mid; else hi = mid;
    }
    return { cost: (lo + hi) / 2, gain };
  }

  /** The continuous parameters, calibrated on first use and cached. */
  continuousParams(dir: Direction): { cost: number; gain: number } {
    if (!this.continuous) {
      this.continuous = {
        buy: this.calibrateContinuous("buy", this.calibrationSeed, this.sampleWindowS, this.nSamples),
        sell: this.calibrateContinuous("sell", this.calibrationSeed, this.sampleWindowS, this.nSamples),
      };
    }
    return this.continuous[dir];
  }

  /**
   * What a contract is worth after `elapsedS` seconds, on the continuous payout.
   *
   * This is BOTH the live value and the settlement: closing at any moment pays what this says,
   * which is the property that makes a stop and a target mean something. There is no committed
   * endpoint to converge to and no cap that depends on a decision already taken, because under this
   * model nothing is decided at open except the cost the trader has to overcome.
   */
  valueAt(dir: Direction, entryT: number, elapsedS: number): number {
    const { cost, gain } = this.continuousParams(dir);
    const move = this.moveAt(dir, entryT, elapsedS);
    return Math.max(0, Math.min(1 + gain * (move - cost), this.cfg.maxMultiplier));
  }

  /**
   * Settle on the continuous payout at an arbitrary holding time.
   *
   * `result` is DERIVED from the payout rather than decided in advance: a contract that returns
   * more than its stake is a win, anything else a loss. That is what lets a stop loss close a
   * position at a partial loss, which the step model had no way to express.
   */
  settleContinuous(stakeCents: number, dir: Direction, entryT: number, elapsedS: number): Outcome {
    const multiplier = this.valueAt(dir, entryT, elapsedS);
    const entryRate = this.curve.rate(entryT);
    const exitRate = this.curve.rate(entryT + elapsedS);
    const payoutCents = mulCents(stakeCents, multiplier);
    return {
      result: payoutCents > stakeCents ? "win" : "loss",
      multiplier, payoutCents, pnlCents: payoutCents - stakeCents,
      entryRate, exitRate, signedMove: this.moveAt(dir, entryT, elapsedS),
    };
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
