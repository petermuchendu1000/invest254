/**
 * Candlestick aggregation for the live price stream.
 *
 * The engine emits a continuous tick stream (`{ t, rate }`, t = epoch ms, rate = price). The line
 * chart draws those ticks directly; a candlestick chart instead groups them into fixed-width OHLC
 * buckets. This module is PURE and deterministic (no DOM, no charting lib) so it can be unit-tested
 * and shared by any renderer (TradingView Lightweight Charts on the web today).
 *
 * Time is expressed in whole SECONDS (the UTCTimestamp unit Lightweight Charts expects). Because a
 * chart library requires candle times to be strictly ascending and unique, `bucketMs` MUST be a
 * positive multiple of 1000 — otherwise two buckets could collapse to the same integer second.
 */

/** One OHLC bar. `time` is a UNIX timestamp in SECONDS (bucket start). */
export interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

/** Minimal tick shape this module needs (a superset `Tick` also satisfies it). */
export interface PriceTick {
  t: number;
  rate: number;
}

/** Validate + normalise a bucket width, guaranteeing unique per-second buckets. */
export function normalizeBucketMs(bucketMs: number): number {
  if (!Number.isFinite(bucketMs) || bucketMs < 1000 || bucketMs % 1000 !== 0) {
    throw new RangeError(`bucketMs must be a positive multiple of 1000, got ${bucketMs}`);
  }
  return bucketMs;
}

/** Epoch-ms → the start (also ms) of the bucket it falls in. */
export function bucketStartMs(tMs: number, bucketMs: number): number {
  return Math.floor(tMs / bucketMs) * bucketMs;
}

/**
 * Fold an ordered tick series into OHLC candles. Ticks are assumed ascending in `t` (the engine's
 * ring buffer is). Each new bucket opens at its first tick's rate; high/low track extremes; close is
 * the latest rate in the bucket. Returns candles ascending by `time` (chart-ready).
 */
export function aggregateCandles(ticks: readonly PriceTick[], bucketMs: number): Candle[] {
  normalizeBucketMs(bucketMs);
  const out: Candle[] = [];
  let cur: Candle | null = null;
  let curBucketMs = -1;
  for (const tk of ticks) {
    if (!Number.isFinite(tk.t) || !Number.isFinite(tk.rate)) continue;
    const b = bucketStartMs(tk.t, bucketMs);
    if (cur === null || b !== curBucketMs) {
      if (cur) out.push(cur);
      curBucketMs = b;
      cur = { time: Math.floor(b / 1000), open: tk.rate, high: tk.rate, low: tk.rate, close: tk.rate };
    } else {
      if (tk.rate > cur.high) cur.high = tk.rate;
      if (tk.rate < cur.low) cur.low = tk.rate;
      cur.close = tk.rate;
    }
  }
  if (cur) out.push(cur);
  return out;
}

/**
 * Real-time update: fold ONE new tick into an existing (mutable) candle array and return the single
 * candle a chart should `update()` with. If the tick belongs to the current (last) bucket it extends
 * it in place; otherwise it appends a new candle that OPENS at the previous candle's close (so the
 * series is visually continuous — no gaps between bars). Mutates `candles` in place.
 */
export function upsertCandle(candles: Candle[], tick: PriceTick, bucketMs: number): Candle {
  normalizeBucketMs(bucketMs);
  const time = Math.floor(bucketStartMs(tick.t, bucketMs) / 1000);
  const last = candles.length > 0 ? candles[candles.length - 1]! : null;
  if (last && last.time === time) {
    if (tick.rate > last.high) last.high = tick.rate;
    if (tick.rate < last.low) last.low = tick.rate;
    last.close = tick.rate;
    return last;
  }
  const open = last ? last.close : tick.rate;
  const candle: Candle = { time, open, high: Math.max(open, tick.rate), low: Math.min(open, tick.rate), close: tick.rate };
  candles.push(candle);
  return candle;
}

/**
 * Simple moving average of the closes ending AT each index (null until `period` bars exist).
 * Pure/O(n·1) with a rolling sum. Returned array is index-aligned with `candles`.
 */
export function sma(closes: readonly number[], period: number): Array<number | null> {
  const out: Array<number | null> = new Array(closes.length).fill(null);
  if (period <= 0) return out;
  let sum = 0;
  for (let i = 0; i < closes.length; i++) {
    sum += closes[i]!;
    if (i >= period) sum -= closes[i - period]!;
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

/** Bollinger Bands (middle SMA ± mult·σ) over closes; index-aligned, null until `period` bars. */
export function bollinger(
  closes: readonly number[],
  period = 20,
  mult = 2,
): Array<{ mid: number; upper: number; lower: number } | null> {
  const out: Array<{ mid: number; upper: number; lower: number } | null> = new Array(closes.length).fill(null);
  for (let i = period - 1; i < closes.length; i++) {
    let mean = 0;
    for (let j = i - period + 1; j <= i; j++) mean += closes[j]!;
    mean /= period;
    let varSum = 0;
    for (let j = i - period + 1; j <= i; j++) { const d = closes[j]! - mean; varSum += d * d; }
    const sd = Math.sqrt(varSum / period);
    out[i] = { mid: mean, upper: mean + mult * sd, lower: mean - mult * sd };
  }
  return out;
}

/**
 * ADDON-1: the sellable price-chart systems (sites.chart_style, 0147). Every value except `line` renders on the
 * TradingView engine with that series type; `line` is the lightweight canvas curve. Unknown values fall back to
 * `line` (the free default), never to a paid system.
 */
export const CHART_STYLES = ["line", "area", "candlestick", "bars", "baseline"] as const;
export type ChartStyle = (typeof CHART_STYLES)[number];
export function chartStyleOf(v: unknown): ChartStyle {
  return (CHART_STYLES as readonly unknown[]).includes(v) ? (v as ChartStyle) : "line";
}
/** The TradingView series a chart system opens with (null = the canvas line curve). */
export function tradingViewTypeOf(style: ChartStyle): "candles" | "bars" | "area" | "baseline" | null {
  return style === "candlestick" ? "candles" : style === "line" ? null : style;
}
/**
 * The price-curve SHAPE a chart system is priced with (see CurveGenerator). The `line` brands render
 * the canvas wave, which reads best as an irregular, unpredictable `wave`; every TradingView system
 * (candles/bars/area/baseline) reads best as trending `market` fBm. Returned as a string so callers
 * that don't import the curve module (API/engine wiring) stay decoupled from it.
 */
export function curveProfileForChartStyle(style: ChartStyle): "market" | "wave" {
  return style === "line" ? "wave" : "market";
}

/**
 * Heikin Ashi bars.
 *
 * MetaTrader 5 has exactly THREE chart types on the desktop (Bar chart, Candlesticks, Line chart):
 * `ENUM_CHART_MODE` has three members and there is no API surface for a fourth. On MOBILE it has a
 * native FOURTH, Heikin Ashi, and both the Android and iPhone chart help pages spell out the
 * formula, which is the one implemented here verbatim:
 *
 *     Close = (Open + High + Low + Close) / 4
 *     Open  = [Open(previous) + Close(previous)] / 2
 *     High  = Max(High, Open, Close)
 *     Low   = Min(Low, Open, Close)
 *
 * The first bar has no previous bar to average, so it opens at (Open + Close) / 2, which is the
 * conventional seed and keeps the series continuous from its first candle.
 *
 * This is a chart MODE, not an indicator: MetaTrader draws the transformed bars in place of the
 * real ones, so the price axis and anything read off the bars is in Heikin Ashi space. That is the
 * real terminal's behaviour, not an approximation of it.
 */
export function heikinAshi(candles: readonly Candle[]): Candle[] {
  const out: Candle[] = [];
  let prev: Candle | null = null;
  for (const c of candles) {
    const bar = heikinAshiBar(c, prev);
    out.push(bar);
    prev = bar;
  }
  return out;
}

/**
 * ONE Heikin Ashi bar, from its raw bar and the Heikin Ashi bar before it.
 *
 * This is the live path. A charting library will only accept an update to the newest bar, so a
 * forming Heikin Ashi bar cannot be produced by repainting the tail: it has to be derived from the
 * single bar before it, which is exactly what the formula says anyway.
 */
export function heikinAshiBar(c: Candle, prev: Candle | null): Candle {
  const close = (c.open + c.high + c.low + c.close) / 4;
  const open = prev === null ? (c.open + c.close) / 2 : (prev.open + prev.close) / 2;
  return {
    time: c.time,
    open,
    close,
    high: Math.max(c.high, open, close),
    low: Math.min(c.low, open, close),
  };
}
