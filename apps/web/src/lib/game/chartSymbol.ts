'use client';

import { useEffect, useMemo } from 'react';
import { create } from 'zustand';
import { useGameSocketApi } from '@/lib/game/GameSocketProvider';
import { useSymbolSetStore, quoteSubscription } from '@/lib/game/symbolSet';

/**
 * Which symbol the chart is drawing.
 *
 * Separate from the Market Watch list because they are different choices: MetaTrader's window lists
 * what a trader is watching, and the chart shows the one they are looking at. Hiding a symbol from
 * the list does not close its chart, and charting one does not add it to the list.
 *
 * `null` means the brand's own symbol — the one it settles on. It is stored as null rather than as
 * that symbol's name so that a brand changing its instrument does not strand every device on the
 * old one.
 */

interface ChartSymbolState {
  /** The charted symbol, or null for the brand's own. */
  symbol: string | null;
  set: (symbol: string | null) => void;
}

const STORAGE_KEY = 'pp-chart-symbol';

export const useChartSymbolStore = create<ChartSymbolState>()((set) => ({
  symbol: null,
  set: (symbol) => {
    try {
      if (symbol === null) window.localStorage.removeItem(STORAGE_KEY);
      else window.localStorage.setItem(STORAGE_KEY, symbol);
    } catch { /* blocked storage: the choice still holds for this session */ }
    set({ symbol });
  },
}));

/**
 * Read the stored chart symbol back once the client has mounted.
 *
 * Not in the store's initialiser, for the same reason the watch list is not: that runs during the
 * server render too, where there is no localStorage, and a store seeded differently on the two
 * sides is a hydration mismatch.
 */
export function useRestoreChartSymbol(): void {
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) useChartSymbolStore.setState({ symbol: raw });
    } catch { /* ignore */ }
  }, []);
}

/**
 * The one place that tells the engine which symbols to quote.
 *
 * It has to be ONE place. The subscription is a set per socket, so two components each sending
 * their own would take turns clobbering each other: opening a chart would stop the watch list
 * quoting, and the next change to the list would stop the chart. This hook takes the union, and
 * every other component only writes to a store.
 *
 * The chart's symbol goes FIRST, so when the union exceeds the cap it is the tail of the watch list
 * that is dropped rather than the instrument on screen.
 *
 * `enabled` is false on a brand that draws a line rather than candles: it has no symbols, the engine
 * says so, and asking anyway would put a refusal in the Journal on every load.
 */
export function useQuoteSubscription(enabled: boolean): void {
  const { subscribeSymbols } = useGameSocketApi();
  const watched = useSymbolSetStore((s) => s.watched);
  const charted = useChartSymbolStore((s) => s.symbol);

  const wanted = useMemo(() => quoteSubscription(charted, watched), [watched, charted]);

  const key = enabled ? wanted.join(',') : '';
  useEffect(() => {
    // A brand that draws a line has no symbols at all and the engine says so, so asking would be a
    // refusal in the Journal on every load of every line brand.
    if (!enabled) return;
    subscribeSymbols(key === '' ? [] : key.split(','));
  }, [subscribeSymbols, key, enabled]);
}
