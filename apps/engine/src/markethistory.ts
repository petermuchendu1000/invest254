import {
  CurveGenerator, XAUUSD, DAY_S, TIMEFRAMES, aggregate, minuteBars, nextBase, nextBucketS,
  dateKeyUTC, dayStartMs, type Candle, type DayAnchor, type MarketSymbol, type PriceAxis,
  type Timeframe, type VersionedGameConfig,
} from "@invest254/shared";

/**
 * Candle history for one brand.
 *
 * The chart needs a continuous price series, but the engine reseeds the curve every UTC day, so the
 * days have to be chained: each day's base price is carried from the previous day's close (see
 * candles.ts). That makes history a walk FORWARD from a fixed genesis day, and this class owns that
 * walk — building each day's curve once, keeping the two numbers the chain needs, and caching the
 * minute bars for the days a chart is actually looking at.
 *
 * It is deliberately independent of SeedManager. SeedManager exists to price LIVE rounds: it caches
 * per (day, config) because a position must settle under the config it opened with, it commits seed
 * hashes to the database, and it holds at most a handful of days. History is the opposite workload —
 * hundreds of past days, read-only, display-only, and priced by whatever config is current because
 * nothing about a historical candle settles anything.
 */

/** Days before today that history reaches back to. 400 covers the full year a chart offers. */
export const HISTORY_DAYS = 400;
/** Largest window a single request may ask for, in bars. Clients page backwards for more. */
export const MAX_BARS = 5000;
/**
 * Largest number of day anchors one request may ask for.
 *
 * A page of trade history spans a handful of days in practice; the cap is what stops a client
 * asking the engine to walk and hold the whole year in one call.
 */
export const MAX_ANCHORS = 64;

export interface MarketHistoryOptions {
  /** Instrument the prices are expressed in. Defaults to XAUUSD. */
  instrument?: MarketSymbol;
  /** Cap on days of minute bars held in memory (~46KB each). */
  maxCachedDays?: number;
  now?: () => number;
}

/** What the chain needs from a day, and what a chart needs to draw it. */
interface DaySlice {
  dateKey: string;
  dayStartS: number;
  /** Base price at this day's open — the previous day's close, pulled slightly toward the anchor. */
  base: number;
  /** The NEXT day's base, i.e. this day's close after the anchor pull. Carries the chain forward. */
  nextBase: number;
  /**
   * The curve's value at this day's open — the second half of the day's price anchor, since
   * price = base + scale * (value(t) - openValue). It falls out of the chaining pass for free, and
   * keeping it is what lets an OLD day's anchor be served without rebuilding that day's curve.
   */
  openValue: number;
  /**
   * The day's 24 H1 bars, kept for the life of the chain (~1KB a day).
   *
   * Every timeframe from H1 up is a whole number of hours, so all of them — including D1, W1 and
   * MN1 — fold from these exactly. Keeping them is what makes scrolling a year of dailies instant:
   * they fall out of the same sampling pass that computes the day's open and close, so the chain
   * pays for them once and never rebuilds that day again.
   */
  h1: Candle[];
  /** The day's 1440 M1 bars. Only the sub-hour timeframes need these, so they are evictable. */
  m1?: Candle[];
}

export class MarketHistory {
  private readonly inst: MarketSymbol;
  private readonly now: () => number;
  private readonly maxCachedDays: number;
  /** dateKey -> slice, for the contiguous run of days from `genesisKey` forward. */
  private readonly days = new Map<string, DaySlice>();
  /** Insertion order of dateKeys whose `bars` are populated, for eviction. */
  private readonly barOrder: string[] = [];
  private chainedTo: string | null = null;

  constructor(
    private readonly seedFor: (dateKey: string) => string,
    private readonly cfg: () => VersionedGameConfig,
    opts: MarketHistoryOptions = {},
  ) {
    this.inst = opts.instrument ?? XAUUSD;
    this.now = opts.now ?? (() => Date.now());
    this.maxCachedDays = opts.maxCachedDays ?? 16;
  }

  get instrument(): MarketSymbol { return this.inst; }

  private curveFor(dateKey: string): CurveGenerator {
    return new CurveGenerator(this.seedFor(dateKey), this.cfg(), "market");
  }

  /** The first day history offers — HISTORY_DAYS before today, in UTC. */
  private genesisKey(): string {
    return dateKeyUTC(this.now() - HISTORY_DAYS * DAY_S * 1000);
  }

  /**
   * Extend the chain forward until `through` has a base price, building each missing day's curve
   * once. Days are walked in order because each base depends on the previous day's close.
   *
   * The genesis day moves forward as real time passes, so the chain is rebuilt from a new start when
   * that happens. That re-anchors the series at the instrument's anchor price rather than letting it
   * drift with no floor, and it is invisible in practice: a chart only ever shows a window.
   */
  private chainThrough(through: string): void {
    const genesis = this.genesisKey();
    if (this.chainedTo === null || !this.days.has(genesis)) {
      this.days.clear();
      this.barOrder.length = 0;
      this.chainedTo = null;
    }
    let key = this.chainedTo === null ? genesis : nextKey(this.chainedTo);
    let base = this.chainedTo === null ? this.inst.anchor : this.days.get(this.chainedTo)!.nextBase;
    while (key <= through) {
      const curve = this.curveFor(key);
      const dayStartS = dayStartMs(key) / 1000;
      // One sampling pass gives the chain its close AND the day's hourly bars. Minute bars come from
      // the same curve but are built only if a sub-hour timeframe actually asks for them.
      const h1 = aggregate(minuteBars(this.inst, dayStartS, base, (t) => curve.value(t)), "H1");
      const openValue = curve.value(0);
      const slice: DaySlice = {
        dateKey: key, dayStartS, base, h1, openValue,
        nextBase: nextBase(this.inst, base, openValue, curve.value(DAY_S)),
      };
      this.days.set(key, slice);
      base = slice.nextBase;
      this.chainedTo = key;
      key = nextKey(key);
    }
  }

  /** The day's M1 bars, built on first use and evicted LRU-style. */
  private minutesFor(dateKey: string): Candle[] {
    const slice = this.days.get(dateKey);
    if (!slice) return [];
    if (slice.m1) return slice.m1;
    const curve = this.curveFor(dateKey);
    slice.m1 = minuteBars(this.inst, slice.dayStartS, slice.base, (t) => curve.value(t));
    this.barOrder.push(dateKey);
    while (this.barOrder.length > this.maxCachedDays) {
      const evict = this.barOrder.shift()!;
      const s = this.days.get(evict);
      if (s) delete s.m1;
    }
    return slice.m1;
  }

  /**
   * The `count` most recent CLOSED bars at or before `toS` (epoch seconds; defaults to now).
   *
   * Every timeframe is folded from one cached source — hourly bars from H1 up, minute bars below —
   * so the periods always agree with each other and with the live tick stream.
   */
  candles(tf: Timeframe, count: number, toS?: number): Candle[] {
    const want = Math.max(1, Math.min(MAX_BARS, Math.floor(count)));
    const end = Math.min(toS ?? Math.floor(this.now() / 1000), Math.floor(this.now() / 1000));
    const endKey = dateKeyUTC(end * 1000);
    this.chainThrough(endKey);

    // Days needed for `want` bars of this timeframe, with a little slack for partial buckets.
    const spanS = tf === "MN1" ? 31 * DAY_S : TIMEFRAMES[tf];
    const daysNeeded = Math.min(HISTORY_DAYS + 1, Math.ceil((want * spanS) / DAY_S) + 2);

    const genesis = this.genesisKey();
    const keys: string[] = [];
    let key = endKey;
    for (let i = 0; i < daysNeeded && key >= genesis; i++) {
      keys.unshift(key);
      key = prevKey(key);
    }

    const hourly = TIMEFRAMES[tf] >= TIMEFRAMES.H1 || tf === "MN1";
    let src: Candle[] = [];
    for (const k of keys) src = src.concat(hourly ? (this.days.get(k)?.h1 ?? []) : this.minutesFor(k));

    const unit = hourly ? TIMEFRAMES.H1 : 60;
    // A bar that has not finished yet must never be served as if it had: its high, low and close are
    // still moving. The live tick stream owns the forming bar; history stops at the last closed one.
    src = src.filter((b) => b.time + unit <= end);
    const bars = (tf === "M1" || tf === "H1") ? src : aggregate(src, tf);
    return bars.filter((b) => nextBucketS(b.time, tf) <= end).slice(-want);
  }

  /**
   * What the client needs to place LIVE ticks on the same price axis as the history: the current
   * day's base and opening curve value. price = base + scale * (value(t) - openValue).
   */
  liveAnchor(atMs?: number): { dateKey: string; base: number; openValue: number; instrument: MarketSymbol } {
    const key = dateKeyUTC(atMs ?? this.now());
    this.chainThrough(key);
    const slice = this.days.get(key);
    const base = slice?.base ?? this.inst.anchor;
    return { dateKey: key, base, openValue: slice?.openValue ?? this.curveFor(key).value(0), instrument: this.inst };
  }

  /**
   * Day anchors for a set of UTC dates, so a client can place an OLD rate on the price axis.
   *
   * The axis is re-anchored every UTC midnight, so a rate recorded on an earlier day is meaningless
   * against today's anchor — mapped through today's it yields a price that never happened. A trade
   * list showing historical prices needs the anchor of each trade's OWN day, and this is the only
   * place that knows them: they come out of the same forward chain the candles do, and now cost
   * nothing to serve because the chain already keeps them.
   *
   * Dates outside the retained window are simply absent from the reply rather than an error: a
   * client asking about a trade older than history reaches should fall back, not fail.
   */
  anchors(dateKeys: readonly string[]): Array<{ dateKey: string; base: number; openValue: number }> {
    const genesis = this.genesisKey();
    const today = dateKeyUTC(this.now());
    const out: Array<{ dateKey: string; base: number; openValue: number }> = [];
    const seen = new Set<string>();
    for (const key of dateKeys) {
      if (seen.has(key) || key < genesis || key > today) continue;
      seen.add(key);
      if (out.length >= MAX_ANCHORS) break;
      this.chainThrough(key);
      const slice = this.days.get(key);
      if (slice) out.push({ dateKey: key, base: slice.base, openValue: slice.openValue });
    }
    return out;
  }

  /** One day's anchor, or null when that date is off the chain (before genesis, or in the future). */
  anchorFor(dateKey: string): DayAnchor | null {
    const [a] = this.anchors([dateKey]);
    return a ? { base: a.base, openValue: a.openValue } : null;
  }

  /**
   * This brand's price axis, as the narrow interface the money layer stamps execution prices through.
   *
   * Handing out an object rather than `this` keeps that layer unable to reach the day chain for
   * anything else: a display price is all it may ask for.
   */
  axis(): PriceAxis {
    return { instrument: this.inst, anchorFor: (key) => this.anchorFor(key) };
  }
}

const nextKey = (dateKey: string): string => dateKeyUTC(dayStartMs(dateKey) + DAY_S * 1000);
const prevKey = (dateKey: string): string => dateKeyUTC(dayStartMs(dateKey) - DAY_S * 1000);
