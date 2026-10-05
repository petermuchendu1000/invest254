import {
  DEFAULT_SYMBOL, SYMBOLS, instrumentFor, type VersionedGameConfig,
} from "@invest254/shared";
import { MarketHistory, type MarketHistoryOptions } from "./markethistory.js";

/**
 * One brand's candle history, per symbol.
 *
 * `MarketHistory` is built for exactly one instrument: it walks a chain of days forward from
 * genesis, carrying each day's close into the next day's base, and that chain is only valid for the
 * symbol whose curve produced it. Multi-symbol therefore means one history object per symbol, not
 * one history answering for many — and this class owns the set.
 *
 * ## Why there is a cap
 *
 * A resident history is not free. The chain keeps every day's 24 hourly bars for the life of the
 * brand (~1KB a day, so ~400KB over the 400-day window) and caches minute bars for the days a chart
 * is actually looking at (~46KB a day, 16 days by default). Call it 1.1MB per symbol per brand.
 * The catalogue carries ninety-odd symbols and one engine process runs every brand, so holding all
 * of them for all brands is hundreds of megabytes of bars nobody is looking at.
 *
 * So histories are built on first use and evicted least-recently-used beyond `maxResident`. Evicting
 * one costs nothing but CPU on the next request: the chain is deterministic from the day seeds, so a
 * rebuilt history produces bit-for-bit the same bars. That is the whole reason this is safe to
 * evict and a live position is not.
 *
 * The DEFAULT symbol is pinned and never evicted. It is the one the brand's price axis stamps
 * execution prices against, so a cold rebuild of it would sit in the path of a trade rather than a
 * chart request.
 */
export interface SymbolHistoriesOptions {
  /** Day-seed derivation for this brand, shared by every symbol — the symbol separates inside the curve. */
  seedFor: (dateKey: string) => string;
  cfg: () => VersionedGameConfig;
  now?: () => number;
  /**
   * The symbols this brand offers, in the order its Market Watch should list them.
   *
   * Defaults to the whole catalogue. Per-brand subsets are a database question (see
   * docs/mt5/12-multi-symbol-scope.md item 7); this is the seam they will arrive through.
   */
  symbols?: readonly string[];
  /** How many symbols' histories to hold resident at once, excluding the pinned default. */
  maxResident?: number;
  /** Passed to every history this brand builds. See `MarketHistoryOptions.historyDays`. */
  historyDays?: number;
}

export const DEFAULT_MAX_RESIDENT = 12;

export class SymbolHistories {
  private readonly offered: readonly string[];
  private readonly built = new Map<string, MarketHistory>();
  /** Least-recently-used first, and never contains the pinned default. */
  private readonly lru: string[] = [];
  private readonly maxResident: number;

  constructor(private readonly opts: SymbolHistoriesOptions) {
    const offered = opts.symbols ?? SYMBOLS.map((s) => s.symbol);
    // A brand that offers nothing still has to chart something, and the price axis needs the
    // default resident regardless, so the default is always offered.
    this.offered = offered.includes(DEFAULT_SYMBOL) ? offered : [DEFAULT_SYMBOL, ...offered];
    this.maxResident = Math.max(1, opts.maxResident ?? DEFAULT_MAX_RESIDENT);
    // Built eagerly, because the brand's price axis is this one and a trade must not wait on it.
    this.built.set(DEFAULT_SYMBOL, this.build(DEFAULT_SYMBOL)!);
  }

  /** The symbols this brand offers, in listing order. */
  get symbols(): readonly string[] { return this.offered; }

  /** Whether this brand offers the symbol at all. An unoffered symbol is a client error. */
  has(symbol: string): boolean { return this.offered.includes(symbol); }

  /** The default symbol's history: the brand's price axis, always resident. */
  get primary(): MarketHistory { return this.built.get(DEFAULT_SYMBOL)!; }

  /** Which symbols are resident right now. Exposed for tests and metrics, not for callers. */
  get resident(): readonly string[] { return [...this.built.keys()]; }

  /**
   * This brand's history for one symbol, built on demand.
   *
   * Returns undefined for a symbol the brand does not offer, rather than silently falling back to
   * the default — a typo must not quietly chart a different instrument.
   */
  for(symbol: string): MarketHistory | undefined {
    if (!this.has(symbol)) return undefined;
    const existing = this.built.get(symbol);
    if (existing) {
      this.touch(symbol);
      return existing;
    }
    const made = this.build(symbol);
    if (!made) return undefined;
    this.built.set(symbol, made);
    this.touch(symbol);
    this.evictBeyondCap();
    return made;
  }

  private touch(symbol: string): void {
    if (symbol === DEFAULT_SYMBOL) return;
    const at = this.lru.indexOf(symbol);
    if (at >= 0) this.lru.splice(at, 1);
    this.lru.push(symbol);
  }

  private evictBeyondCap(): void {
    while (this.lru.length > this.maxResident) {
      const evict = this.lru.shift()!;
      this.built.delete(evict);
    }
  }

  private build(symbol: string): MarketHistory | undefined {
    const instrument = instrumentFor(symbol);
    if (!instrument) return undefined;
    const o: MarketHistoryOptions = {
      instrument,
      ...(this.opts.now ? { now: this.opts.now } : {}),
      ...(this.opts.historyDays !== undefined ? { historyDays: this.opts.historyDays } : {}),
    };
    return new MarketHistory(this.opts.seedFor, this.opts.cfg, o);
  }
}
