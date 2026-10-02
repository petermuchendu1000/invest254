import { CURVE_AMPLITUDE, CURVE_BASE_RATE } from "./config.js";
import type { Candle } from "./chart.js";

/**
 * OHLC candle history for the `market` (candlestick) brands.
 *
 * The engine's curve is a bounded signal in (-1,1) that restarts from a seeded level every UTC day.
 * A trading chart needs the opposite: an unbounded PRICE that runs continuously across days, so that
 * D1/W1/MN1 show a real instrument's drift instead of a flat band. This module is the bridge.
 *
 * The map is deliberately AFFINE within a day:
 *
 *     price_d(t) = base_d + SCALE * (value_d(t) - value_d(0))
 *
 * so a move the player sees on the chart is the same move settlement reads, to a constant factor —
 * "what you see is what you get" holds exactly. Days are then chained by carrying each day's close
 * into the next day's base, which makes the series continuous and its daily increments a martingale,
 * exactly like the intraday process.
 *
 * Nothing here can affect an outcome. SettlementEngine reads `value` differences inside one day; the
 * base and the scale are display quantities applied afterwards.
 */

/** MT5's complete timeframe set. Values are bucket lengths in seconds; W1/MN1 are calendar-aligned. */
export const TIMEFRAMES = {
  M1: 60, M2: 120, M3: 180, M4: 240, M5: 300, M6: 360, M10: 600, M12: 720,
  M15: 900, M20: 1200, M30: 1800,
  H1: 3600, H2: 7200, H3: 10_800, H4: 14_400, H6: 21_600, H8: 28_800, H12: 43_200,
  D1: 86_400, W1: 604_800, MN1: 0,
} as const;

export type Timeframe = keyof typeof TIMEFRAMES;

export const TIMEFRAME_KEYS = Object.keys(TIMEFRAMES) as Timeframe[];

export const isTimeframe = (s: string): s is Timeframe => Object.hasOwn(TIMEFRAMES, s);

export const DAY_S = 86_400;

/** Bars are the same shape the live tick aggregator produces (chart.ts), so a chart can splice a
 *  forming candle onto fetched history without converting anything. `time` is in epoch SECONDS. */
export type { Candle };

/**
 * The displayed instrument. The engine curve is unitless, so these three numbers decide what the
 * chart reads as. `scale` is chosen to put a day's range near 0.8% of `anchor`, which is what gold
 * actually does; `digits` then makes a round's move a few hundred ticks rather than a few.
 */
export interface MarketSymbol {
  symbol: string;
  /** Decimal places shown, and the tick size (10^-digits). */
  digits: number;
  /** Price the series is anchored at on the genesis day. */
  anchor: number;
  /** Price units per unit of curve `value`. */
  scale: number;
}

export const XAUUSD: MarketSymbol = { symbol: "XAUUSD", digits: 2, anchor: 2650, scale: 85 };

/**
 * Pull of the chained base back toward the anchor, applied once per day.
 *
 * A pure carry-forward is a random walk, so over enough years it wanders arbitrarily far (and
 * eventually below zero). This retains 99.9% of each day's deviation, which bounds the series at
 * roughly anchor ± 1300 while moving a single rollover by well under a point — smaller than a real
 * instrument's overnight gap, and untradeable regardless, since no position spans a day.
 */
export const BASE_RETENTION = 0.999;

/** Curve `value` recovered from a displayed rate — the inverse of CurveGenerator.rate(). */
export const valueOfRate = (rate: number): number => (rate - CURVE_BASE_RATE) / CURVE_AMPLITUDE;

/** Price for a point on a day whose base and opening value are known. */
export const priceOf = (inst: MarketSymbol, base: number, dayOpenValue: number, value: number): number =>
  base + inst.scale * (value - dayOpenValue);

/**
 * The base price for the day AFTER one whose base, opening value and closing value are given.
 *
 * Chaining this from a genesis day reproduces the whole series; the engine caches one number per
 * day, so extending history costs one curve rebuild per new day.
 */
export function nextBase(inst: MarketSymbol, base: number, dayOpenValue: number, dayCloseValue: number): number {
  const close = base + inst.scale * (dayCloseValue - dayOpenValue);
  return inst.anchor + (close - inst.anchor) * BASE_RETENTION;
}

/** Round to the instrument's tick so the client never renders more precision than the symbol has. */
export const toTick = (inst: MarketSymbol, price: number): number => {
  const f = 10 ** inst.digits;
  return Math.round(price * f) / f;
};

// ───────────────────────────────── bucketing ─────────────────────────────────

/**
 * Start of the bucket containing `ts` (epoch seconds), for `tf`.
 *
 * Minute/hour/day buckets align to the UTC epoch, which also makes D1 align to UTC midnight — the
 * same boundary the engine reseeds on, so a D1 candle is exactly one seed's day. W1 aligns to
 * Monday (MT5's week) and MN1 to the first of the calendar month.
 */
export function bucketStartS(ts: number, tf: Timeframe): number {
  if (tf === "MN1") {
    const d = new Date(ts * 1000);
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1) / 1000;
  }
  if (tf === "W1") {
    const d = new Date(ts * 1000);
    const dayStart = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) / 1000;
    // getUTCDay(): 0 = Sunday. Shift so Monday is 0.
    return dayStart - ((d.getUTCDay() + 6) % 7) * DAY_S;
  }
  const s = TIMEFRAMES[tf];
  return Math.floor(ts / s) * s;
}

/** Start of the bucket that follows the one beginning at `start`. */
export function nextBucketS(start: number, tf: Timeframe): number {
  if (tf === "MN1") {
    const d = new Date(start * 1000);
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1) / 1000;
  }
  return start + TIMEFRAMES[tf];
}

// ───────────────────────────────── aggregation ─────────────────────────────────

/**
 * Fold already-ordered bars into a coarser timeframe. Source bars must be ordered and no longer than
 * the target bucket; the engine builds M1 once per day and derives every higher timeframe from it,
 * which is both cheaper and guarantees the timeframes agree with each other.
 */
export function aggregate(src: readonly Candle[], tf: Timeframe): Candle[] {
  const out: Candle[] = [];
  let cur: Candle | null = null;
  let curEnd = 0;
  for (const b of src) {
    if (cur === null || b.time >= curEnd) {
      if (cur) out.push(cur);
      const start = bucketStartS(b.time, tf);
      curEnd = nextBucketS(start, tf);
      cur = { time: start, open: b.open, high: b.high, low: b.low, close: b.close };
    } else {
      if (b.high > cur.high) cur.high = b.high;
      if (b.low < cur.low) cur.low = b.low;
      cur.close = b.close;
    }
  }
  if (cur) out.push(cur);
  return out;
}

/**
 * M1 bars for one UTC day, sampled from the day's curve.
 *
 * `value` is the day's curve sampled in seconds-since-midnight. Each minute is sampled at 1 Hz —
 * the walk's own resolution, so the high and low are the true extremes of the generated path rather
 * than an approximation of it.
 */
export function minuteBars(
  inst: MarketSymbol,
  dayStartS: number,
  base: number,
  value: (tSeconds: number) => number,
): Candle[] {
  const open0 = value(0);
  const px = (t: number) => toTick(inst, priceOf(inst, base, open0, value(t)));
  const out: Candle[] = new Array(1440);
  for (let m = 0; m < 1440; m++) {
    const s = m * 60;
    const open = px(s);
    let high = open, low = open, close = open;
    for (let k = 1; k <= 60; k++) {
      const v = px(s + k);
      if (v > high) high = v;
      if (v < low) low = v;
      close = v;
    }
    out[m] = { time: dayStartS + s, open, high, low, close };
  }
  return out;
}
