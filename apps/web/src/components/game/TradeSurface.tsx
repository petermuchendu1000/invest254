'use client';

import { useBrand } from '@/lib/brand/BrandProvider';
import { useMarketerSkin } from '@/lib/marketer/isMarketer';
import { PriceHeader } from '@/components/game/PriceHeader';
import { TickerStrip } from '@/components/game/TickerStrip';
import { GameCurve } from '@/components/game/GameCurve';
import { BetPanel } from '@/components/game/BetPanel';
import { MT5Toolbox } from '@/components/game/MT5Toolbox';
import { MarketWatch } from '@/components/game/MarketWatch';
import { MT5OrderTicket } from '@/components/game/MT5OrderTicket';
import { MT5Chrome } from '@/components/game/MT5Chrome';
import { cn } from '@/lib/cn';
import { DigitsTradeScreen } from '@/components/game/digits/DigitsTradeScreen';
import { CandlestickTradeScreen } from '@/components/game/candlestick/CandlestickTradeScreen';
import { chartStyleOf, tradingViewTypeOf } from '@invest254/shared/chart';
import { isBrokerTerminalBrand } from '@/lib/ui/terminalScreen';
import { resolveTradeUi, useTradeUiOverride } from '@/lib/ui/tradeUi';
import { useRestoreSymbolSet } from '@/lib/game/symbolSet';
import { useRestoreChartSymbol, useQuoteSubscription } from '@/lib/game/chartSymbol';
import { MT5MobileShell } from '@/components/game/mobile/MT5MobileShell';
import { useIsPhone } from '@/lib/ui/useIsPhone';
import { useOrderEntry } from '@/lib/game/useOrderEntry';
import { useGameSocket } from '@/lib/game/GameSocketProvider';

/**
 * Chooses the trade layout for the current brand:
 *  - 'classic' (default): the rise/fall curve terminal (PriceHeader + ticker + chart + BetPanel).
 *  - 'digits': the Deriv-style binary/digits broker screen.
 *  - 'broker': the MetaTrader-style terminal. A TradingView chart_style selects it too, which is how
 *    it was reached before it had a name of its own; naming it lets a brand wear the terminal
 *    without that being a side effect of which chart it bought.
 *  - 'candlestick': the single-screen layout — chart, trading panel, and a chat/top/tours rail.
 *
 * The brand value (`brand.tradeUi`) is the source of truth once the per-client toggle is wired in
 * the platform console. A `?ui=digits` / `?ui=classic` query param (persisted to localStorage) is a
 * safe preview override so the layout can be trialled on any brand before flipping the real flag.
 */
export function TradeSurface() {
  const brand = useBrand();
  const { isMarketer } = useMarketerSkin();
  /**
   * The override is read in ONE place now (lib/ui/tradeUi) because the shell has to resolve the same
   * answer: it was read here only, so `?ui=candlestick` drew the new screen inside the old header.
   */
  const ui = resolveTradeUi(useTradeUiOverride(), brand.tradeUi);
  // The interface gear lives inside the chart on BOTH shells now — the candlestick toolbar
  // (CandleChart) and the wave's top-right corner (GameCurve) — so this screen no longer spends a
  // row of a viewport-locked phone layout on it.
  const isTerminalBrand = isBrokerTerminalBrand(ui, tradingViewTypeOf(chartStyleOf(brand.chartStyle)) !== null);

  /**
   * The symbol preferences, restored and subscribed in ONE place for the whole screen.
   *
   * The engine's quote subscription is a set per socket, so two components each sending their own
   * would take turns clobbering each other: opening a chart would stop the watch list quoting, and
   * the next change to the list would stop the chart. Market Watch and the chart only write to
   * their stores; this screen is what talks to the socket.
   */
  const phone = useIsPhone();
  /**
   * What a contract at the current volume risks, for the chart's Stop Loss level.
   *
   * Read here rather than inside the chart because `useOrderEntry` is the one place the volume and
   * the brand's limits live, and the chart is handed figures rather than deriving them. BEFORE the
   * early returns below, because React matches hooks by call order.
   */
  const order = useOrderEntry();
  const levelStake = order.stakeCents;
  /**
   * MetaTrader's Take Profit, armed HERE because this is the one parent both shells hang off.
   *
   * The money target it replaces was armed inside the desktop Toolbox, so on a phone it never fired
   * at all: a trader could set a target on the phone ticket and nothing would ever act on it.
   *
   * The level is read as a price from the shared store, so the ticket, the chart and the Modify
   * dialog are all setting the same thing, and closing goes through the ordinary manual sell under
   * the engine's own two conditions. See lib/game/levelWatch.ts.
   */
  const { activePosition, sell, earlyCloseEnabled } = useGameSocket();
  /**
   * The browser no longer watches the target.
   *
   * `useTakeProfitLevelWatch` fired a manual sell from a React effect when the price reached the
   * level. That only ever worked while this tab was open, focused enough to receive ticks, and
   * connected: a trader who set a target and closed the laptop had no target at all. The ENGINE
   * holds the levels now and fires them on its own tick, so the hook is gone rather than kept as a
   * second, weaker copy of the same rule. See docs/mt5/20-real-sl-tp.md.
   */
  useRestoreSymbolSet();
  useRestoreChartSymbol();
  useQuoteSubscription(isTerminalBrand && !isMarketer);

  if (ui === 'digits') return <DigitsTradeScreen />;
  if (ui === 'candlestick') return <CandlestickTradeScreen />;

  const terminal = isTerminalBrand && !isMarketer;

  /**
   * A phone gets MetaTrader's phone app, not MetaTrader's desktop squeezed into one column.
   *
   * They are different TREES — five tabs with one full-screen view, against four panels on screen
   * together — which is why this is a branch rather than a set of breakpoints, and why `useIsPhone`
   * is a media query read in JavaScript. See MT5MobileShell for what the desktop column measured at
   * 360x800 before this existed.
   *
   * `useIsPhone` reports false on the server and until mount, so the first paint is always the
   * layout below and the phone shell swaps in on the client. Everything above this line still runs
   * for both: the symbol stores are restored and the socket subscription is sent in one place,
   * whichever shell renders.
   */
  if (terminal && phone) return <MT5MobileShell />;

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
    <section className="flex h-full min-h-0 flex-col gap-2 md:gap-3">
      {/*
        MetaTrader's application chrome: the menu bar and its three toolbars, flush under the brand's
        title bar. Terminal brands only, and desktop only — a phone returned MT5MobileShell above,
        and MetaTrader's phone app has no menu bar to carry (see MT5Chrome for how every row reaches
        a handler that already exists, and for the three menu titles it will not draw).

        It is here rather than in AppShell because this is the one place that already decides what a
        terminal is, and because what the toolbars act on — the chart, the rail, Market Watch, the
        Toolbox — is all inside this screen.
      */}
      {terminal ? <MT5Chrome /> : null}

      {/*
        The three DOCKED panels, side by side: Market Watch left, chart in the middle, ticket right.
        The Toolbox is deliberately NOT one of them, and sits below this row instead: see its note.
      */}
      <div className={cn('flex min-h-0 flex-1 flex-col gap-2 md:gap-3', terminal && 'lg:flex-row lg:gap-3')}>
      {/* 240 / 288 / 344px. The widest step arrives at `2xl`, where there is finally room for
          MetaTrader's full Market Watch column set (Symbol, Bid, Ask, Spread, Time, Daily Change);
          below it the grid drops columns from the right, as MetaTrader's own narrow window does. */}
      {terminal ? <MarketWatch className="hidden lg:flex lg:w-60 lg:shrink-0 xl:w-72 2xl:w-[21.5rem]" /> : null}

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
          {/* `levelStakeCents` is what a contract at the current volume risks, which is the money
              MetaTrader shows against a Stop Loss level. The desktop chart passed nothing, so even
              once the levels were drawn the stop had no figure. */}
          <GameCurve levelStakeCents={levelStake} />
        </div>
      </div>

      <div className={cn(terminal && 'lg:w-72 lg:shrink-0 lg:overflow-y-auto xl:w-80')}>
        {/* A terminal brand gets MetaTrader's ticket; every other shell keeps the classic panel. */}
        {terminal ? <MT5OrderTicket /> : <BetPanel />}
      </div>
      </div>

      {/*
        MetaTrader's Toolbox: account summary, the open position's live P/L, closed trades, the
        newswire, messages, alerts and the journal. Candlestick brands only (the line shell is the
        simple one) and never on a marketer screen, where an equity/margin table would be the
        loudest possible "this is trading" tell.

        DOCKED ACROSS THE WHOLE WINDOW, not under the chart. docs/mt5/09-toolbox.md 119 describes
        MetaTrader's docked Toolbox as sitting "at the bottom of the main window", which is to say it
        runs under Market Watch and the ticket as well as under the chart. Ours was nested inside the
        chart column, so its pane was only that column: 446px at 1024 and 700px at 1366, against a
        ten-column Trade grid whose own content is 720-733px. That is why `Profit`, MetaTrader's
        rightmost and most-read column, sat off the pane on every laptop below 1440. Spanning the
        window is both the faithful arrangement and the fix, because it gives the grid the width the
        real thing gives it.

        Only a terminal brand reaches this layout below `lg` at all: `useIsPhone` is
        `max-width: 1023.98px` and a terminal phone returns `MT5MobileShell` above, so moving the
        Toolbox out of the chart column changes nothing for any other shell.
      */}
      {terminal ? <MT5Toolbox /> : null}
    </section>
  );
}
