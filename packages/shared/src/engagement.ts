import { SeededRng } from "./prng.js";
import type { Cents } from "./money.js";

/**
 * Engagement shaping — legitimate, RTP-preserving player-psychology helpers.
 *
 * These functions shape HOW outcomes are presented and distributed, never WHETHER
 * the player wins or how much the house keeps:
 *
 *  - Variable-ratio reinforcement: winning multipliers are drawn from a spread
 *    distribution (many small wins, occasional larger ones) whose MEAN is pinned
 *    to the calibrated value, so RTP is exactly preserved while win sizes stay
 *    unpredictable.
 *  - Near-miss: a loss whose signed move came within a small band of the win
 *    threshold is flagged so the UI can render "so close!" — the outcome is
 *    unchanged, only the presentation.
 *  - Loss disguised as win (LDW): a win whose payout is below the stake (e.g.
 *    multiplier 1.05x) is flagged so the UI can celebrate it like a win while
 *    still showing the net result honestly.
 *
 * Everything here is deterministic given (serverSeed, position nonce) so the
 * presentation is reproducible and auditable — same provable-fairness discipline
 * as the curve itself.
 */

/** Shape of the win-size spread: fraction of wins pushed to each end of the band. */
export interface WinSpread {
  /** Share of winning positions that land in the "small win" band. Default 0.7. */
  smallShare: number;
  /** Small-win band as a fraction of the calibrated mean multiplier. Default [0.55, 0.95]. */
  smallBand: [number, number];
}

export const DEFAULT_WIN_SPREAD: WinSpread = { smallShare: 0.7, smallBand: [0.55, 0.95] };

/**
 * Variable-ratio win sizing. Given the calibrated mean winning multiplier `meanMult`
 * (the value that makes RTP exact), draw a multiplier for THIS position such that the
 * long-run mean is preserved:
 *
 *   with prob smallShare:  uniform in smallBand * meanMult          (frequent small wins)
 *   else:                  sized so the overall mean == meanMult     (rare bigger wins)
 *
 * The big-win mean is solved analytically: bigMean = meanMult * (1 - smallShare*smallMean) / (1 - smallShare),
 * then jittered ±20% (the jitter is symmetric, so it does not shift the mean).
 * Result is clamped to [1.01, maxMultiplier]; clamping is symmetric around the solved
 * distribution in practice because bands sit well inside the cap.
 */
export function variableRatioMultiplier(
  rng: SeededRng,
  meanMult: number,
  maxMultiplier: number,
  spread: WinSpread = DEFAULT_WIN_SPREAD,
): number {
  if (meanMult <= 1) return meanMult;
  const smallMean = (spread.smallBand[0] + spread.smallBand[1]) / 2;
  const bigMean = (meanMult - spread.smallShare * smallMean * meanMult) / (1 - spread.smallShare);
  let m: number;
  if (bigMean <= 1 || bigMean <= smallMean * meanMult) {
    // Degenerate spread (mean too low to split): fall back to ±25% symmetric jitter.
    m = meanMult * rng.range(0.75, 1.25);
  } else if (rng.next() < spread.smallShare) {
    m = meanMult * rng.range(spread.smallBand[0], spread.smallBand[1]);
  } else {
    m = bigMean * rng.range(0.8, 1.2);
  }
  return Math.min(Math.max(m, 1.01), maxMultiplier);
}

/**
 * Near-miss flag: the position lost, but its signed move came within `bandPct` of the
 * win threshold `tau`. Pure presentation metadata — the loss stands.
 */
export function isNearMiss(signedMove: number, tau: number, bandPct = 0.15): boolean {
  if (signedMove >= tau) return false;                 // that's a win, not a near-miss
  const band = Math.abs(tau) * bandPct;
  return signedMove >= tau - band;
}

/**
 * Loss-disguised-as-win flag: a winning position whose payout is still below the stake
 * (multiplier < 1 is impossible on a win here, so LDW means multiplier in [1, 1.25) —
 * the player "won" but netted less than ~25% profit). The UI celebrates the win while
 * the ledger shows the honest net.
 */
export function isLossDisguisedAsWin(multiplier: number): boolean {
  return multiplier >= 1 && multiplier < 1.25;
}

/** Presentation metadata attached to a settled position for the UI/feed. */
export interface OutcomePresentation {
  nearMiss: boolean;
  lossDisguisedAsWin: boolean;
  /** Headline the feed/toast should show. Always truthful about money. */
  headline: "big_win" | "win" | "small_win" | "near_miss" | "loss";
}

export function presentOutcome(input: {
  result: "win" | "loss";
  multiplier: number;
  signedMove: number;
  tau: number;
}): OutcomePresentation {
  if (input.result === "loss") {
    const nm = isNearMiss(input.signedMove, input.tau);
    return { nearMiss: nm, lossDisguisedAsWin: false, headline: nm ? "near_miss" : "loss" };
  }
  const ldw = isLossDisguisedAsWin(input.multiplier);
  const big = input.multiplier >= 2.5;
  return {
    nearMiss: false,
    lossDisguisedAsWin: ldw,
    headline: big ? "big_win" : ldw ? "small_win" : "win",
  };
}

/** Deterministic per-position RNG for engagement shaping (seed + nonce). */
export function positionRng(serverSeed: string, nonce: number): SeededRng {
  return new SeededRng(serverSeed, `engage:${nonce}`);
}

/** Wagering-tier helpers live in ./bonus.js (dependency-free, browser-safe). */
export { DEFAULT_BONUS_TIERS, bonusPctForDeposit, type BonusTier } from "./bonus.js";
