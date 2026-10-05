'use client';

import { useEffect, useState } from 'react';
import { useBrand } from '@/lib/brand/BrandProvider';
import { useMarketerSkin } from '@/lib/marketer/isMarketer';
import { PriceHeader } from '@/components/game/PriceHeader';
import { TickerStrip } from '@/components/game/TickerStrip';
import { GameCurve } from '@/components/game/GameCurve';
import { BetPanel } from '@/components/game/BetPanel';
import { MT5Toolbox } from '@/components/game/MT5Toolbox';
import { MarketWatch } from '@/components/game/MarketWatch';
import { MT5OrderTicket } from '@/components/game/MT5OrderTicket';
import { cn } from '@/lib/cn';
import { DigitsTradeScreen } from '@/components/game/digits/DigitsTradeScreen';
import { chartStyleOf, tradingViewTypeOf } from '@invest254/shared/chart';
import { useRestoreSymbolSet } from '@/lib/game/symbolSet';
import { useRestoreChartSymbol, useQuoteSubscription } from '@/lib/game/chartSymbol';

/**
 * Chooses the trade layout for the current brand:
 *  - 'classic' (default): the rise/fall curve terminal (PriceHeader + ticker + chart + BetPanel).
 *  - 'digits': the Deriv-style binary/digits broker screen.
 *
 * The brand value (`brand.tradeUi`) is the source of truth once the per-client toggle is wired in
 * the platform console. A `?ui=digits` / `?ui=classic` query param (persisted to localStorage) is a
 * safe preview override so the layout can be trialled on any brand before flipping the real flag.
 */
export function TradeSurface() {
  const brand = useBrand();
  const { isMarketer } = useMarketerSkin();
  const [override, setOverride] = useState<string | null>(null);

  useEffect(() => {
    try {
      const q = new URLSearchParams(window.location.search).get('ui');
      if (q) window.localStorage.setItem('pp:tradeUi', q);
      setOverride(q ?? window.localStorage.getItem('pp:tradeUi'));
    } catch {
      /* SSR / no window — fall back to the brand value */
    }
  }, []);

  const ui = override ?? brand.tradeUi ?? 'classic';
  // The interface gear lives inside the chart on BOTH shells now — the candlestick toolbar
  // (CandleChart) and the wave's top-right corner (GameCurve) — so this screen no longer spends a
  // row of a viewport-locked phone layout on it.
  const isTerminalBrand = tradingViewTypeOf(chartStyleOf(brand.chartStyle)) !== null;

  /**
   * The symbol preferences, restored and subscribed in ONE place for the whole screen.
   *
   * The engine's quote subscription is a set per socket, so two components each sending their own
   * would take turns clobbering each other: opening a chart would stop the watch list quoting, and
   * the next change to the list would stop the chart. Market Watch and the chart only write to
   * their stores; this screen is what talks to the socket.
   */
  useRestoreSymbolSet();
  useRestoreChartSymbol();
  useQuoteSubscription(isTerminalBrand && !isMarketer);

  if (ui === 'digits') return <DigitsTradeScreen />;

  const terminal = isTerminalBrand && !isMarketer;

  return (
    /**
     * Mobile first: one column — quote, chart, toolbox, order ticket — and that is the whole
     * layout below `lg`.
     *
     * From `lg` the same three pieces become MetaTrader's desktop arrangement without being
     * duplicated: Market Watch docked left, chart with the Toolbox under it filling the middle, the
     * order ticket docked right. Flex direction does the work, so there is exactly one BetPanel and
     * one chart in the tree — rendering a second copy per breakpoint would mean two live sockets
     * and two sets of state.
     */
    <section className={cn('flex h-full min-h-0 flex-col gap-2 md:gap-3', terminal && 'lg:flex-row lg:gap-3')}>
      {terminal ? <MarketWatch className="hidden lg:flex lg:w-56 lg:shrink-0 xl:w-64" /> : null}

      {/* `min-w-0` is load-bearing on the desktop row: without it this column refuses to shrink
          below the chart toolbar's min-content width, the row grows past the viewport and the order
          ticket docked to its right is clipped off the screen. A flex child's default
          `min-width: auto` is the whole reason. */}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-2 md:gap-3">
        {/* MARKETER: the BTC/KES price strip and the scrolling crypto ticker are the two loudest
            "this is a trading terminal" signals — both are removed for marketers (Phase 1).
            TERMINAL: both go too, for the opposite reason. MetaTrader has no scrolling crypto
            marquee and no separate quote strip above the chart — the chart's own toolbar carries the
            symbol, the period and the price, and Market Watch carries the quote on a desktop. Two
            rows of chrome the real thing does not have were the least MT5 part of this screen. */}
        {isMarketer || terminal ? null : <PriceHeader />}
        {isMarketer || terminal ? null : (
          // short phones (SE): the decorative marquee gives its row to the chart
          <div className="[@media(max-height:640px)]:hidden"><TickerStrip /></div>
        )}
        <div className="min-h-[160px] flex-1">
          <GameCurve />
        </div>
        {/* MetaTrader's Toolbox: account summary, the open position's live P/L, closed trades, the
            newswire, messages, alerts and the journal. Candlestick brands only — the line shell is
            the simple one — and never on a marketer screen, where an equity/margin table would be
            the loudest possible "this is trading" tell. */}
        {terminal ? <MT5Toolbox /> : null}
      </div>

      <div className={cn(terminal && 'lg:w-72 lg:shrink-0 lg:overflow-y-auto xl:w-80')}>
        {/* A terminal brand gets MetaTrader's ticket; every other shell keeps the classic panel. */}
        {terminal ? <MT5OrderTicket /> : <BetPanel />}
      </div>
    </section>
  );
}
