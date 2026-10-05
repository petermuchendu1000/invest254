/**
 * MetaTrader's adaptive volume steps, for the phone order ticket's seven-cell stepper.
 *
 * Its row is `-0.5  -0.1  -0.01  0.61  +0.01  +0.1  +0.5` in MetaQuotes' own Android screenshot
 * (`android/en/open_market.png`), and the spec records that the "steps are adaptive to the current
 * value": the iOS ticket at a volume of 7.00 shows `-5  -1  7.00  +1  +5` instead.
 *
 * MetaQuotes documents no formula, so this is derived from those two screenshots, and the
 * derivation is worth writing down because it reproduces both exactly:
 *
 *   Take the decade of the current volume, `D = 10^floor(log10(value))`.
 *   The three steps are `D/10`, `D`, `5D`.
 *
 *     0.61  →  D = 0.1  →  0.01, 0.1, 0.5     which is Android's row, cell for cell
 *     7.00  →  D = 1    →  0.1,  1,   5       which is iOS's two cells, plus the third Android has
 *
 * One clamp, for a reason the screenshots cannot show: `D/10` must never be finer than the
 * instrument's own volume step, or the smallest cell would offer a volume the broker will not
 * accept. At this brand's 0.025 minimum the raw decade is 0.01 and `D/10` would be 0.001, which is
 * a tenth of a step; the clamp lifts the whole row back to `0.01, 0.1, 0.5` — MetaTrader's own.
 *
 * A step is OFFERED even when it would overshoot the brand's limits, and marked disabled instead of
 * being dropped. MetaTrader does exactly this on its Close position screen: "The + steps are greyed
 * out/disabled because you cannot close more than the open volume." A row that changed its cells as
 * the volume moved would be a moving target under the thumb.
 */
export interface VolumeStep {
  /** Signed: negative cells decrease. */
  delta: number;
  /** What the cell prints, e.g. "−0.01" or "+0.5". */
  label: string;
  /** False where applying it would leave the brand's volume range. */
  enabled: boolean;
}

export function volumeSteps(
  value: number,
  { min, max, step }: { min: number; max: number; step: number },
): VolumeStep[] {
  const decade = 10 ** Math.floor(Math.log10(Math.max(value, step)));
  // `D/10` is the finest cell, so the decade cannot sit below ten times the instrument's own step.
  const d = Math.max(decade, step * 10);
  const sizes = [d / 10, d, d * 5].map((n) => Number(n.toPrecision(6)));

  const cell = (delta: number): VolumeStep => {
    const next = Number((value + delta).toFixed(6));
    return {
      delta,
      // MetaTrader prints a true minus on the decrease cells, not a hyphen.
      label: `${delta < 0 ? '−' : '+'}${trim(Math.abs(delta))}`,
      enabled: delta < 0 ? next >= min - 1e-9 : next <= max + 1e-9,
    };
  };

  return [
    ...sizes.slice().reverse().map((s) => cell(-s)),
    ...sizes.map((s) => cell(s)),
  ];
}

/** `0.50` prints as `0.5` and `1.00` as `1`, which is how MetaTrader labels these cells. */
const trim = (n: number): string => String(Number(n.toFixed(6)));
