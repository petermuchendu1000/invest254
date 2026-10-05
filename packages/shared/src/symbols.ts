import { type MarketSymbol } from "./candles.js";

/**
 * The tradable symbol catalogue: forex majors, metals, crypto and indices.
 *
 * Three things decide what a symbol LOOKS like, and only three, because the engine's curve is
 * unitless and everything else is presentation:
 *
 *   digits    decimal places, and therefore the tick size (10^-digits). These are market
 *             conventions, not opinions: a major quotes to five places, a yen pair to three, gold
 *             to two. No licence is needed to know that, which is why this file is hand-authored
 *             rather than fetched (see docs/mt5/11-market-data-sources.md: there is no free,
 *             licence-clean source of redistributable intraday FX or metals prices, and we do not
 *             need one, because the prices here are the engine's own).
 *   anchor    the level the series starts the genesis day at. A STARTING LEVEL chosen so the chart
 *             reads like the instrument it is named after. It is not a quote, it is not claimed to
 *             be one, and nothing reads it back as market data.
 *   dayRange  how far the instrument typically travels in a day, as a fraction of its own price.
 *             Gold moves less than Bitcoin; a major moves less than either. This is what makes a
 *             crypto chart look like crypto instead of like a forex pair with a bigger number on
 *             the axis.
 *
 * `scale` is DERIVED from the last two rather than hand-picked per symbol, which is the whole point:
 * adding a symbol means stating what it is, not tuning a magic number until the chart looks right.
 * See `scaleFor`.
 *
 * None of this touches settlement. The curve is unitless and the engine scores it unitless; these
 * numbers decide only what the chart and the ticket print. See docs/mt5/12-multi-symbol-scope.md.
 */

/** MetaTrader groups symbols in a tree, and the Symbols dialog shows it rooted at the broker. */
export type SymbolGroup = "Forex\\Majors" | "Metals" | "Crypto" | "Indices";

export interface SymbolDef {
  symbol: string;
  /** What MetaTrader prints beside the symbol in the Specification dialog's blue header. */
  description: string;
  group: SymbolGroup;
  digits: number;
  /** Starting level for the genesis day. Not a quote. */
  anchor: number;
  /** Typical daily travel as a fraction of price: 0.008 is eight tenths of a per cent. */
  dayRange: number;
  /**
   * An explicit scale, overriding the derivation.
   *
   * Exactly one symbol uses this, and only because it predates the rule: XAUUSD shipped with a
   * hand-tuned 85, and 2650 * 0.008 / 0.25 is 84.8. Changing it would move every price the live
   * brand has ever drawn, including the execution prices stamped onto settled positions by
   * migration 0180, so the shipped number is recorded here rather than rounded back into existence.
   * A new symbol must not use this: state what the instrument IS and let the rule do the rest.
   */
  scale?: number;
}

/**
 * Price units per unit of curve value.
 *
 * The curve's value wanders over roughly a quarter of its range in a day, so a symbol that should
 * travel `dayRange` of its own price needs `anchor * dayRange / 0.25` price units per unit of value.
 *
 * That constant is back-solved from the one symbol that already existed and was tuned by eye, XAUUSD
 * at anchor 2650 and scale 85: 2650 * 0.008 / 0.25 = 84.8, within a fifth of a unit of the 85 that
 * shipped. Gold therefore keeps its shipped scale explicitly (see `SymbolDef.scale`) and every other
 * symbol is derived.
 *
 * The result is NOT rounded. Rounding to an integer looked tidier and silently destroyed every FX
 * major: EURUSD derives a scale of 0.026, which `Math.round` turns into 0, pinning the chart to a
 * flat line. A scale is a multiplier, not a price, and has no business being whole.
 */
export const CURVE_DAY_TRAVEL = 0.25;

export const scaleFor = (anchor: number, dayRange: number): number =>
  (anchor * dayRange) / CURVE_DAY_TRAVEL;

/**
 * The catalogue.
 *
 * Index names differ between MetaTrader brokers (US30 is DJ30 elsewhere, USTEC is NAS100, GER40 is
 * DE40). The names here are the ones MetaQuotes' own demo server uses; a brand that wants a
 * broker's naming can alias them later without touching the curve, because the seed domain is the
 * symbol string and renaming one would be a different instrument.
 */
export const SYMBOLS: readonly SymbolDef[] = [
  // ── Forex majors: the seven that carry USD on one side ──
  { symbol: "EURUSD", description: "Euro vs US Dollar", group: "Forex\\Majors", digits: 5, anchor: 1.085, dayRange: 0.006 },
  { symbol: "GBPUSD", description: "Great Britain Pound vs US Dollar", group: "Forex\\Majors", digits: 5, anchor: 1.27, dayRange: 0.007 },
  // Yen pairs quote to three places, not five. The convention, not a typo.
  { symbol: "USDJPY", description: "US Dollar vs Japanese Yen", group: "Forex\\Majors", digits: 3, anchor: 151.5, dayRange: 0.006 },
  { symbol: "USDCHF", description: "US Dollar vs Swiss Franc", group: "Forex\\Majors", digits: 5, anchor: 0.885, dayRange: 0.005 },
  { symbol: "AUDUSD", description: "Australian Dollar vs US Dollar", group: "Forex\\Majors", digits: 5, anchor: 0.655, dayRange: 0.007 },
  { symbol: "USDCAD", description: "US Dollar vs Canadian Dollar", group: "Forex\\Majors", digits: 5, anchor: 1.365, dayRange: 0.005 },
  { symbol: "NZDUSD", description: "New Zealand Dollar vs US Dollar", group: "Forex\\Majors", digits: 5, anchor: 0.605, dayRange: 0.007 },

  // ── Metals ──
  // XAUUSD keeps the anchor and day range that produce the scale this platform already shipped.
  { symbol: "XAUUSD", description: "Gold vs US Dollar", group: "Metals", digits: 2, anchor: 2650, dayRange: 0.008, scale: 85 },
  { symbol: "XAGUSD", description: "Silver vs US Dollar", group: "Metals", digits: 3, anchor: 31.2, dayRange: 0.018 },
  { symbol: "XPTUSD", description: "Platinum vs US Dollar", group: "Metals", digits: 2, anchor: 985, dayRange: 0.013 },
  { symbol: "XPDUSD", description: "Palladium vs US Dollar", group: "Metals", digits: 2, anchor: 1030, dayRange: 0.02 },

  // ── Crypto: the volatility is the point, so the day range is several times a major's ──
  { symbol: "BTCUSD", description: "Bitcoin vs US Dollar", group: "Crypto", digits: 2, anchor: 62_000, dayRange: 0.035 },
  { symbol: "ETHUSD", description: "Ethereum vs US Dollar", group: "Crypto", digits: 2, anchor: 2450, dayRange: 0.042 },
  { symbol: "LTCUSD", description: "Litecoin vs US Dollar", group: "Crypto", digits: 2, anchor: 72, dayRange: 0.045 },
  { symbol: "BCHUSD", description: "Bitcoin Cash vs US Dollar", group: "Crypto", digits: 2, anchor: 340, dayRange: 0.05 },
  { symbol: "XRPUSD", description: "Ripple vs US Dollar", group: "Crypto", digits: 5, anchor: 0.52, dayRange: 0.05 },

  // ── Indices ──
  { symbol: "US30", description: "Dow Jones Industrial Average Index", group: "Indices", digits: 2, anchor: 42_000, dayRange: 0.009 },
  { symbol: "US500", description: "S&P 500 Index", group: "Indices", digits: 2, anchor: 5700, dayRange: 0.009 },
  { symbol: "USTEC", description: "US Tech 100 Index", group: "Indices", digits: 2, anchor: 19_800, dayRange: 0.012 },
  { symbol: "GER40", description: "DAX 40 Index", group: "Indices", digits: 2, anchor: 19_200, dayRange: 0.011 },
  { symbol: "UK100", description: "FTSE 100 Index", group: "Indices", digits: 2, anchor: 8250, dayRange: 0.008 },
  { symbol: "JP225", description: "Nikkei 225 Index", group: "Indices", digits: 2, anchor: 38_500, dayRange: 0.013 },
];

/** The catalogue as the engine's own instrument type, with `scale` derived. */
export const marketSymbolOf = (d: SymbolDef): MarketSymbol => ({
  symbol: d.symbol,
  digits: d.digits,
  anchor: d.anchor,
  scale: d.scale ?? scaleFor(d.anchor, d.dayRange),
});

const BY_SYMBOL: ReadonlyMap<string, SymbolDef> = new Map(SYMBOLS.map((d) => [d.symbol, d]));

export const symbolDef = (symbol: string): SymbolDef | undefined => BY_SYMBOL.get(symbol);

export function instrumentFor(symbol: string): MarketSymbol | undefined {
  const d = BY_SYMBOL.get(symbol);
  return d ? marketSymbolOf(d) : undefined;
}

export const SYMBOL_GROUPS: readonly SymbolGroup[] = ["Forex\\Majors", "Metals", "Crypto", "Indices"];

export const symbolsInGroup = (g: SymbolGroup): readonly SymbolDef[] =>
  SYMBOLS.filter((s) => s.group === g);

/** The default symbol: the one this platform shipped with, and the one that keeps the bare seed. */
export const DEFAULT_SYMBOL = "XAUUSD";
