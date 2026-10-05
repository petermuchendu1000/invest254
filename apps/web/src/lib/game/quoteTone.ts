/**
 * MetaTrader's Market Watch quote colours.
 *
 * Verbatim, from MetaQuotes' own help:
 *
 *   "Prices in the 'Market Watch' window have different colors: Blue — the current price is higher
 *    than the previous one; Red — the current price is lower than the previous one; Gray — the
 *    price has not changed for the last 15 seconds. If the depth of market and the Last trade price
 *    is available for a symbol, the color is determined by the Last price. Otherwise, the color is
 *    determined by the Bid price."
 *
 * Two things in that sentence are easy to read past, and both were wrong here before:
 *
 *   Grey is STALENESS, not an unchanged tick. A quote that keeps arriving at the same number is not
 *   grey; a quote that stops arriving for fifteen seconds is. This panel used to hold its last
 *   direction colour for ever, so a dead feed looked exactly like a live one that had ticked up.
 *
 *   The colour follows the LAST price where a symbol has one, and only falls back to Bid where it
 *   does not. This platform quotes one price per symbol, which IS the last traded price, so the
 *   first branch applies and there is no bid to fall back to.
 */

/** Blue, red, or grey. `null` means no quote has arrived yet, which is not one of MetaTrader's. */
export type QuoteTone = 'up' | 'down' | 'stale';

/** MetaTrader's own timeout, in milliseconds. */
export const STALE_AFTER_MS = 15_000;

export interface QuoteToneInput {
  /** Direction of the last change, or null before any change has been seen. */
  up: boolean | null;
  /** When the quote last CHANGED, in epoch ms. Null before the first change. */
  changedAt: number | null;
  now: number;
}

export function quoteTone({ up, changedAt, now }: QuoteToneInput): QuoteTone | null {
  if (up === null || changedAt === null) return null;
  // "the price has not changed for the last 15 seconds" — measured from the last CHANGE, so a
  // repeated identical quote does not refresh it.
  if (now - changedAt >= STALE_AFTER_MS) return 'stale';
  return up ? 'up' : 'down';
}

/**
 * The colours themselves. MetaTrader's blue and red are the same pair it uses for its buy and sell
 * sides, and grey is this terminal's own muted foreground.
 */
export const QUOTE_TONE_COLOUR: Record<QuoteTone, string> = {
  up: '#3183ff',
  down: '#f23645',
  stale: '#8fa2b8',
};
