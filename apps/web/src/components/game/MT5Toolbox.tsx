'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { valueOfRate } from '@invest254/shared/candles';
import { accountSummary, accountStripFields, mtAmount, lotsOfStake } from '@invest254/shared/account';
import { useGameSocket, useGameSocketApi, type NewsItemDto, type DayAnchor } from '@/lib/game/GameSocketProvider';
import { useWallet, useTransactions } from '@/lib/wallet/hooks';
import { useDisplayMoney } from '@/lib/money';
import { useBrand } from '@/lib/brand/BrandProvider';
import { useSession } from '@/lib/auth/session';
import { useMyNotifications } from '@/lib/notifications/hooks';
import { useJournal, logJournal } from '@/lib/game/journal';
import {
  ALERT_CONDITIONS, ALERT_DEFAULTS, conditionLabel, useAlertsStore, useAlertWatch,
  type AlertCondition, type AlertDraft, type PriceAlert,
} from '@/lib/game/alerts';
import { useLevelsStore, useRestoreLevels } from '@/lib/game/levelsStore';
import { levelPrice, isContinuousBrand } from '@/lib/game/levelWatch';
import { useToast } from '@/lib/toast/ToastProvider';
import { usePositions } from '@/lib/positions/hooks';
import type { PositionDto, TransactionDto } from '@/lib/api/types';
import {
  DESKTOP_PERIODS, changeText, dealRows, historyStrip, orderRows, periodRange, positionRows,
  priceChangePct, priceText, stamp,
  type DealRow, type OrderRow, type PeriodKey, type PositionRow as ClosedRow, type Range,
} from '@/lib/history/mt5history';
import { ticketLabel } from '@/lib/game/betting';
import { useVolumeDigits } from '@/lib/game/volumeDigits';
import { cn } from '@/lib/cn';
import { PaneSplitter, usePanelHeight } from '@/components/game/PaneSplitter';
import {
  TOOLBOX_COLUMNS, VISIBLE_TOOLBOX_TABS, toolboxTab, type ToolboxTab,
} from '@/lib/game/toolboxTabs';
import { exposureRows } from '@invest254/shared/account';
import { MIN_PANEL_PX } from '@/lib/chart/paneSplit';
import { MT5PositionMenu } from '@/components/game/MT5PositionMenu';
import { MT5ClosePosition } from '@/components/game/MT5ClosePosition';
import { MT5ModifyPosition } from '@/components/game/MT5ModifyPosition';

/**
 * MetaTrader's Toolbox.
 *
 * Every tab carries real data. Where MetaTrader shows something this product genuinely cannot do,
 * the control is present and visibly disabled with the reason, rather than drawn as if it worked:
 *
 *   Trade    the open contract, its live P/L, and an editable take-profit
 *   History  settled contracts from the account's own history
 *   News     a live newswire the engine polls from public RSS feeds
 *   Mailbox  the account's notifications, the same ones the banner system raises
 *   Alerts   price alerts, armed against the live price and fired by the open terminal
 *   Journal  this session's real socket events — connect, auth, orders, server errors
 *
 * The account figures come from `accountSummary` in the shared package, which documents how MT5's
 * margin-broker vocabulary maps onto fixed-stake contracts and is unit-tested there. The floating
 * result is the engine's own live P/L — the number it will settle on — so this panel is a read-only
 * view that cannot disagree with an outcome.
 *
 * Tabs sit along the BOTTOM edge, where MetaTrader puts them.
 */

type Tab = ToolboxTab;

export function MT5Toolbox() {
  const { activePosition, status, earlyCloseEnabled, setLevels: pushLevels } = useGameSocket();
  const brand = useBrand();
  /**
   * Whether the engine acts on the S/L and T/P levels at all: a brand with a price axis, pool mode
   * off. `earlyCloseEnabled` alone is not it. See `isContinuousBrand` in lib/game/levelWatch.ts.
   */
  const continuous = isContinuousBrand({ chartStyle: brand.chartStyle, earlyCloseEnabled });
  const { getLastTick, getMarket, sell } = useGameSocketApi();
  const { data: wallet } = useWallet();
  const money = useDisplayMoney();
  const token = useSession((s) => s.token);
  const toast = useToast();

  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>('trade');

  /**
   * MetaTrader's two Toolbox shortcuts, and it has no others.
   *
   *   Ctrl+T     "Open/close the 'Toolbox' window."
   *   Ctrl+F9    "Open the 'Trade' tab in the 'Toolbox' window and switch the control focus to it."
   *
   * No other tab has one. Neither fires while a field has focus, so a dialog's own text boxes keep
   * their editing keys.
   */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el !== null && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
      if ((e.ctrlKey || e.metaKey) && (e.key === 't' || e.key === 'T')) {
        e.preventDefault();
        setOpen((v) => !v);
        return;
      }
      if (e.key === 'F9' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        setTab('trade');
        setOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  // The live row is driven by the tick stream, which does not re-render React on its own.
  const [, force] = useState(0);
  useEffect(() => {
    const id = setInterval(() => force((n) => (n + 1) % 1_000_000), 250);
    return () => clearInterval(id);
  }, []);

  const market = getMarket();
  const symbol = market?.instrument.symbol ?? 'XAUUSD';
  const digits = market?.instrument.digits ?? 2;
  /**
   * Volume prints to the SYMBOL's volume digits, which is what the order ticket offers
   * (09-toolbox.md 300, rows at 313-318). These cells printed two places whatever the symbol's step
   * was, so a position the ticket opened at 0.025 lots appeared in its own row as 0.03.
   */
  const volumeDigits = useVolumeDigits(symbol);
  const lots = (stakeCents: number) => lotsOfStake(stakeCents, volumeDigits);

  const priceOfRate = useCallback((rate: number): number | null => {
    const m = getMarket();
    return m ? m.anchor.base + m.instrument.scale * (valueOfRate(rate) - m.anchor.openValue) : null;
  }, [getMarket]);
  const livePrice = useCallback((): number | null => {
    const t = getLastTick();
    return t ? priceOfRate(t.rate) : null;
  }, [getLastTick, priceOfRate]);
  const px = (rate: number | null | undefined): string => {
    if (rate === null || rate === undefined) return '-';
    const p = priceOfRate(rate);
    return p === null ? '-' : p.toFixed(digits);
  };
  // Alerts fire against the same price the chart draws, and against the clock for `Time =`.
  useAlertWatch(livePrice, symbol, (a, price) => {
    toast.push({
      tone: 'info',
      title: `${a.symbol} alert`,
      description: a.condition === 'time='
        ? `${conditionLabel(a.condition)} ${a.timeHHMM}`
        : `${conditionLabel(a.condition)} ${a.price}${price === null ? '' : `, now ${price.toFixed(digits)}`}`,
    });
  });

  // An optimistic open has no engine id yet; its stake is already committed, so it counts.
  const live = activePosition && activePosition.phase !== 'settling' ? activePosition : null;
  const floatingCents = live ? live.livePnlCents : 0;
  const summary = accountSummary({
    walletCents: (wallet?.real ?? 0) + (wallet?.bonus ?? 0),
    openStakeCents: live ? live.stakeCents : 0,
    floatingPnlCents: floatingCents,
  });
  /**
   * The strip in MetaTrader's own format: its labels, its ordering, its space thousands separator,
   * and the currency code once after the balance.
   *
   * The figures are converted to the brand's display unit first, because the shared formatter is
   * about MetaTrader's typography and knows nothing about this platform's currencies.
   */
  const strip = accountStripFields({
    balance: money.toDisplay(summary.balanceCents),
    equity: money.toDisplay(summary.equityCents),
    margin: money.toDisplay(summary.marginCents),
    freeMargin: money.toDisplay(summary.freeMarginCents),
    marginLevelPct: summary.marginLevelPct,
    currency: money.currency,
  });

  // ── Take profit ────────────────────────────────────────────────────────────────────────────────
  // The target lives in the shared store because MetaTrader carries T/P on the ticket AND lets you
  // modify it on an open position; both surfaces read and write the one value.
  /**
   * The SAME levels the ticket and the chart use, so this row modifies one thing.
   *
   * It held a target floating PROFIT in cents before, from its own store, which no other surface
   * could see and the chart could not draw. The watcher that acted on it was armed HERE, inside the
   * desktop Toolbox, so on a phone a target could be set and nothing would ever fire it; the level
   * watcher is armed in TradeSurface instead, which is the one parent both shells hang off.
   */
  const levels = useLevelsStore((st) => st.levels);
  const setLevels = useLevelsStore((st) => st.set);
  const levelRef = useLevelsStore((st) => st.ref);
  useRestoreLevels();
  // `livePrice` is already a callback on this component, so the value is read through it.
  const nowPrice = livePrice();
  const anchor = levelRef ?? nowPrice;
  /**
   * The S/L and T/P columns show the ENGINE's levels for the open position, not the ticket's.
   *
   * These read `levelPrice(levels, ...)`, which is the working copy a trader drags around BEFORE an
   * order exists. Once a position is open that copy is no longer what will fire: the engine holds
   * the levels and settles on them. A Toolbox row printing the ticket's numbers would show a stop
   * that does not exist, and the two would drift apart the moment the ticket was touched again.
   *
   * Falls back to the ticket's copy only when nothing is open, which is when that is the only
   * meaning the row can have.
   */
  const slPrice = live?.slPrice ?? (live ? null : levelPrice(levels, anchor, 'sl', digits));
  const tpPrice = live?.tpPrice ?? (live ? null : levelPrice(levels, anchor, 'tp', digits));
  /**
   * One point at a time, which is what MetaTrader's own "− value +" on this row steps by.
   *
   * On an OPEN position this is Modify position, so it goes to the engine: stepping it only in the
   * local store would move a number on screen and leave the stop that actually fires where it was.
   */
  const stepTp = (dir: 1 | -1) => {
    const point = 1 / 10 ** digits;
    if (live && live.phase === 'open') {
      const base = live.tpPrice ?? nowPrice;
      if (base === null) return;
      pushLevels(live.slPrice, Number((base + dir * point).toFixed(digits)));
      return;
    }
    if (anchor === null) return;
    const cur = levels.tpPoints;
    setLevels({ ...levels, tpPoints: cur === null ? dir * 100 : cur + dir }, nowPrice);
  };


  // MetaTrader's Toolbox is a SIZED pane with a splitter on its top edge; the chart above simply
  // takes what is left. Keeping the size on the pane rather than on the chart is why a drag can
  // never leave a hole: there is exactly one flexible pane in the column.
  const panelRef = useRef<HTMLDivElement | null>(null);
  const panel = usePanelHeight();
  const grabPanel = useCallback((clientY: number) => {
    panel.begin(clientY, panelRef.current?.getBoundingClientRect().height ?? MIN_PANEL_PX);
  }, [panel]);

  // MetaTrader reaches the Close position form from the Trade tab's own row, through the position
  // context menu. Opening the form from a button on the ticket was our invention; this is the route
  // the terminal actually has.
  const [sheet, setSheet] = useState<null | 'menu' | 'close' | 'modify'>(null);

  const notifications = useMyNotifications();
  const journal = useJournal();
  const alerts = useAlertsStore((s) => s.alerts);

  return (
    <div className="flex shrink-0 flex-col overflow-hidden rounded-sm border border-[#2b3543] bg-[#0f1720] text-[#ffffff]">
      {/* The account line is the toggle, and the only place these figures appear. Collapsed it is a
          single scrolling row so the chart keeps its height on a phone; open, it wraps to
          MetaTrader's full five. The chevron sits outside the scrolling area, or it rides off. */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={open ? 'Hide account details' : 'Show account details'}
        className="flex w-full items-center gap-2 px-3 py-2 text-left"
      >
        <span
          className={cn(
            'min-w-0 flex-1 gap-x-5 gap-y-1',
            open
              /**
               * WRAPPING, not a fixed column count.
               *
               * A five-column grid sized its cells by the container and the figures by their text,
               * and each figure is `whitespace-nowrap shrink-0`, so "Free Margin KES 442.91" simply
               * ran over the top of "Margin Level" and rendered as "442.91ARGIN LEVEL". Wrapping
               * lets each figure keep its own width and drop to a second line when the bar runs out,
               * which cannot overlap at any width.
               */
              ? 'flex flex-wrap items-center'
              : 'flex items-center overflow-x-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
          )}
        >
          {/* MetaTrader's own five fields, in its own order, labels and number format — read off its
              screenshots in docs/mt5/09-toolbox.md section 4 rather than written from memory, which
              is how "Free margin" and "Margin level" ended up miscased here before.

              Collapsed, the row is ONE line on a phone. Carrying all five pushed Free Margin off the
              edge mid-word, which reads as broken rather than as scrollable; the two that only
              matter with a position open appear when the panel does. */}
          {strip.map((f, i) => (
            i === 2 || i === 3
              ? (open ? <Figure key={f.label} label={f.label} value={f.value} /> : null)
              : (
                <Figure
                  key={f.label}
                  label={f.label}
                  value={f.value}
                  // Equity carries the floating tone, which is the one figure that moves with a live
                  // position. MetaTrader colours the strip's trailing total the same way.
                  tone={i === 1 && floatingCents !== 0 ? (floatingCents > 0 ? 'up' : 'down') : undefined}
                />
              )
          ))}
        </span>
        <span className="flex shrink-0 items-center gap-2 pl-1">
          {/* MetaTrader ends the strip with the total floating P/L, right-aligned and with NO label.
              It is the only figure there that is not an account total, which is why it sits apart
              from the five rather than among them. Absent with nothing open, as MetaTrader's is. */}
          {live ? (
            <span className={cn('font-mono text-[12px] font-semibold tabular-nums', floatingCents > 0 ? 'text-[#3183ff]' : floatingCents < 0 ? 'text-[#f23645]' : 'text-[#ffffff]')}>
              {mtAmount(money.toDisplay(floatingCents))}
            </span>
          ) : null}
          {live ? <span className="rounded bg-[#3183ff]/20 px-1.5 py-0.5 text-[10px] font-semibold text-[#3183ff]">1 open</span> : null}
          <span className={cn('h-1.5 w-1.5 rounded-full', status === 'open' ? 'bg-[#41be56]' : status === 'connecting' ? 'bg-[#f0b90b]' : 'bg-[#f23645]')}
            title={status === 'open' ? 'Live' : status === 'connecting' ? 'Syncing' : 'Offline'} />
          <span className={cn('text-[#8fa2b8] transition', open && 'rotate-180')} aria-hidden>▾</span>
        </span>
      </button>

      {open ? (
        <>
          {/* On a phone the panel is a SHEET over the screen, not an inline block: docked inline it
              squeezed the chart down to a sliver, which is the opposite of what a terminal should do
              with its chart. From `sm` up there is room to dock it, so it docks, as MetaTrader does.
              The backdrop is mobile-only and dismisses on tap. */}
          <button
            type="button"
            aria-label="Close account details"
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-30 bg-black/60 sm:hidden"
          />
          <div
            ref={panelRef}
            className="fixed inset-x-1 bottom-[calc(0.25rem+env(safe-area-inset-bottom))] z-40 flex max-h-[68vh] flex-col overflow-hidden rounded border border-[#2b3543] bg-[#0f1720] shadow-2xl sm:static sm:z-auto sm:max-h-none sm:rounded-none sm:border-0 sm:border-t sm:shadow-none"
            style={panel.px === null ? undefined : { height: panel.px, maxHeight: 'none' }}
          >
          {/* The splitter. Drag up for more Toolbox, down for more chart; double-click hands the
              size back to the layout. On a phone the pane is bottom-anchored, so it grows upward
              under the finger, which is the same gesture as the desktop drag. */}
          <PaneSplitter onGrab={grabPanel} onMove={panel.move} onRelease={panel.end} onReset={panel.reset} />
          <div
            className="min-h-0 flex-1 overflow-auto sm:border-t sm:border-[#2b3543]"
            // Unsized, the pane keeps the height it always had. Once a trader has dragged it, the
            // pane itself carries the height and the scroller just fills it.
            style={panel.px === null ? { maxHeight: 'min(46vh, 22rem)' } : undefined}
          >
            {/* MetaTrader shows a position as a two-line entry on a phone and as a wide table on a
                desktop, because ten columns cannot be read on a 430px screen. Both are rendered from
                the same values, rather than the table being squeezed.

                The swap used to happen at `sm`, as if the viewport were the constraint. It is not:
                this pane is only the CHART column, with Market Watch docked to its left and the
                ticket to its right, so a 1024px laptop gives it 446px, which is the 430px phone
                case under another name. The ten columns measured 720px there and the `Profit`
                header, the one column a trader is actually watching and the one carrying the
                × close control, sat 274px past the right edge of the pane (at 1152 165px, at 1280
                126px, at 1366 36px; 1440 is the first width at which it lands inside). The pane
                scrolls, so none of it was clipped, but a column you have to go and find is not on
                screen. Nothing can be done to the table itself here: ten columns of prices cannot
                be truncated into 446px and still be read, and MetaTrader truncates a column rather
                than dropping one (`Currency` drawn as `Curr…`, docs/mt5/09-toolbox.md:841), so the
                order below stays exactly its order (docs/mt5/09-toolbox.md:258).

                That 446px was the real defect and it is fixed where it was caused, in
                `TradeSurface`: this panel is now docked across the whole window as MetaTrader's is
                ("at the bottom of the main window", docs/mt5/09-toolbox.md:119) rather than nested
                inside the chart column, so the pane is the window's width and the grid's own
                720-733px of content fits from 1024 up. The `sm` swap below is therefore back to
                being about the PHONE, which is what MetaTrader's two-line entry is for, instead of
                hiding the grid from every laptop. */}
            {tab === 'trade' ? (
              live ? (
                <>
                  <PositionRow
                    className="sm:hidden"
                    onOpenMenu={() => setSheet('menu')}
                    symbol={symbol}
                    direction={live.direction}
                    lots={lots(live.stakeCents)}
                    from={px(live.entryRate)}
                    to={px(getLastTick()?.rate ?? null)}
                    profit={money.mt(live.livePnlCents)}
                    profitCents={live.livePnlCents}
                    note={continuous && tpPrice !== null ? `T/P ${tpPrice.toFixed(digits)}` : `Max loss ${money.fmt(live.stakeCents)}`}
                  />
                  <div className="hidden sm:block">
                    <Table head={['Symbol', 'Ticket', 'Time', 'Type', 'Volume', 'Price', 'S / L', 'T / P', 'Price', 'Profit']}>
                      <tr
                        className="cursor-pointer border-t border-[#2b3543]/60 hover:bg-[#202933]"
                        onClick={() => setSheet('menu')}
                        title="Open the position menu"
                      >
                        <Td first>{symbol}</Td>
                        <Td>{ticketLabel(live)}</Td>
                        {/* MetaTrader's Time column: `YYYY.MM.DD HH:MM` plus the seconds its own
                            rendered values carry, in the broker's server time (09-toolbox.md
                            289-291). This read `06.10 12:25:30` from a local helper here — no year,
                            the day before the month, and the browser's zone rather than the
                            server's — while /history printed the same instant correctly. There is
                            one formatter now, `stamp`, and it says which zone the server keeps. */}
                        <Td>{live.expiresAtMs ? stamp(live.expiresAtMs - live.durationS * 1000) : '-'}</Td>
                        <Td className={live.direction === 'buy' ? 'text-[#3183ff]' : 'text-[#f23645]'}>{live.direction}</Td>
                        <Td>{lots(live.stakeCents)}</Td>
                        <Td>{px(live.entryRate)}</Td>
                        <Td>
                          {/* MetaTrader's S/L column: the LEVEL, as a price, the same one the ticket
                              sets and the chart draws. It used to print the stake instead, because
                              there was no stop to show: the whole column was a sentence about the
                              engine. On a continuous brand the engine checks this level every tick
                              and closes the position there, which is what the column is for.

                              An UNSET level leaves the cell BLANK and draws no cross: 09-toolbox.md
                              336-338, "the cell is blank and no × is drawn". It printed "-" here
                              while the live panel said "not set" and the close form said the same:
                              three answers to one question. */}
                          <span
                            className="text-[#8fa2b8]"
                            title={continuous
                              ? 'The stop closes this position at its price, for what it is worth there. Stops processing is performed on the server side.'
                              : 'This contract settles a loss at expiry, so the stop cannot fire. The level is the trader\u2019s.'}
                          >
                            {slPrice === null ? '' : slPrice.toFixed(digits)}
                          </span>
                        </Td>
                        <Td>
                          {/* MetaTrader's T/P column: the level as a price, stepped in the
                              instrument's own points. It held a money TARGET before, which is a
                              different concept the chart could not draw and the phone never fired.
                              Unset, it is blank for the same reason the S/L cell is. */}
                          {continuous ? (
                            <span className="flex items-center gap-1">
                              <button type="button" onClick={() => stepTp(-1)} className="px-1 text-[#8fa2b8] hover:text-white disabled:opacity-40" aria-label="Lower take profit">−</button>
                              <span className="min-w-16 text-center">{tpPrice === null ? '' : tpPrice.toFixed(digits)}</span>
                              <button type="button" onClick={() => stepTp(1)} className="px-1 text-[#8fa2b8] hover:text-white" aria-label="Raise take profit">+</button>
                            </span>
                          ) : (
                            // A target that can never fire is not a setting, it is a decoration.
                            <span className="text-[#8fa2b8]" title="This brand settles every contract at expiry, so a target cannot close it early.">
                              at expiry
                            </span>
                          )}
                        </Td>
                        <Td>{px(getLastTick()?.rate ?? null)}</Td>
                        <Td className={cn('font-semibold', live.livePnlCents > 0 ? 'text-[#3183ff]' : live.livePnlCents < 0 ? 'text-[#f23645]' : '')}>
                          <span className="flex items-center justify-end gap-2">
                            {money.mt(live.livePnlCents)}
                            {/* MetaTrader closes a position from its row with a small ×. Shown only
                                where the engine will honour a manual close. */}
                            {earlyCloseEnabled ? (
                              <button
                                type="button"
                                onClick={sell}
                                disabled={live.phase !== 'open' || !live.sellable || !live.positionId}
                                aria-label="Close position"
                                title={live.sellable ? 'Close this position at the current price' : 'This contract settles at expiry'}
                                className="rounded-sm border border-[#2b3543] px-1.5 text-[11px] font-normal text-[#8fa2b8] transition hover:border-[#f23645] hover:text-[#f23645] disabled:cursor-not-allowed disabled:opacity-40"
                              >
                                ×
                              </button>
                            ) : null}
                          </span>
                        </Td>
                      </tr>
                    </Table>
                  </div>
                </>
              ) : (
                <Empty>No open positions.</Empty>
              )
            ) : null}

            {tab === 'history' ? (
              <HistoryTab symbol={symbol} digits={digits} lots={lots} amount={money.mt} token={token} />
            ) : null}

            {tab === 'news' ? <NewsTab active={open} /> : null}

            {tab === 'mailbox' ? (
              !token ? (
                <Empty>Sign in to read your messages.</Empty>
              ) : (notifications.data?.items?.length ?? 0) > 0 ? (
                <ul className="divide-y divide-[#2b3543]/60">
                  {(notifications.data?.items ?? []).map((n) => (
                    <li key={n.id} className="px-3 py-2">
                      <div className="flex items-baseline gap-2">
                        <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', n.level === 'error' ? 'bg-[#f23645]' : n.level === 'warning' ? 'bg-[#f0b90b]' : n.level === 'success' ? 'bg-[#41be56]' : 'bg-[#3183ff]')} />
                        <span className="text-[11px] font-semibold text-white">{n.title}</span>
                        <span className="ml-auto shrink-0 font-mono text-[10px] text-[#8fa2b8]">{stamp(n.createdAtMs)}</span>
                      </div>
                      <p className="mt-0.5 pl-3.5 text-[11px] leading-snug text-[#8fa2b8]">{n.body}</p>
                    </li>
                  ))}
                </ul>
              ) : (
                <Empty>No messages.</Empty>
              )
            ) : null}

            {tab === 'alerts' ? <AlertsTab symbol={symbol} digits={digits} livePrice={livePrice} alerts={alerts} /> : null}

            {/* Exposure: real numbers, computed from the contracts that are open. Its fourth column
                is headed with the deposit currency's own code, as MetaTrader heads it. */}
            {tab === 'exposure' ? (
              <ExposureTab
                symbol={symbol}
                live={live}
                currency={money.currency}
                fmt={(cents) => money.mt(cents)}
              />
            ) : null}

            {/* The tabs MetaTrader fills from somewhere this platform is not connected to. The panel
                says which, rather than showing an empty grid that looks broken. */}
            {UNFILLABLE.includes(tab) ? (
              <Empty>{toolboxTab(tab)?.unavailable}</Empty>
            ) : null}

            {tab === 'journal' ? (
              journal.length > 0 ? (
                <ul className="divide-y divide-[#2b3543]/40 font-mono text-[11px]">
                  {journal.slice().reverse().map((e) => (
                    <li key={e.id} className="flex gap-2 px-3 py-1">
                      <span className="shrink-0 text-[#8fa2b8]">{stamp(e.atMs)}</span>
                      <span className="w-14 shrink-0 text-[#8fa2b8]/50">{e.tag}</span>
                      <span className={cn(e.level === 'error' ? 'text-[#f23645]' : e.level === 'warn' ? 'text-[#f0b90b]' : e.level === 'ok' ? 'text-[#41be56]' : 'text-[#8fa2b8]')}>{e.text}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <Empty>Journal is empty.</Empty>
              )
            ) : null}
          </div>

          {/* MetaTrader puts the Toolbox tabs along the BOTTOM edge of the panel, and there are
              eleven of them drawn (Company is hidden, as MetaTrader hides it). Eleven cannot share
              a 390px phone evenly — "Code Base" alone would not fit in a thirty-pixel slot — so the
              strip SCROLLS rather than crushing the labels, which is what the period row above the
              chart already does with twenty-one periods.
              A count rides as a superscript, as MetaTrader's red subscript count does.

              A LAPTOP is the same problem, which is why nothing here stretches the tabs any more.
              `sm:flex-1` used to hand all eleven an equal share of the bar, and because the chart
              column is only part of the window the share was too small to hold the label: measured
              at 1024, eight of the eleven were cut (Code Base 23px, Exposure 16px, Calendar 14px,
              Mailbox 7px, Articles 6px, Experts 6px, History 4px, Journal 3px, the strip reading
              "MailboxCalendaAlerts Article Code BExpertJourna"), and again at exactly 1280, where
              the `xl:` step widens Market Watch and the ticket and takes 80px back off this column.
              Equal shares also killed the scroll: a flex item that has already been shrunk to fit
              leaves the scroller nothing to scroll. MetaTrader never stretches them: its Toolbox
              tabs are "flat labels separated by thin vertical rules" (docs/mt5/09-toolbox.md:140),
              each its own width, and a panel tab strip with no room for them all grows
              `◀ ▶` scroll arrows at its right end (docs/mt5/10-market-watch.md:96). */}
          <div className="flex items-stretch overflow-x-auto border-t border-[#2b3543] bg-[#202933] [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {VISIBLE_TOOLBOX_TABS.map((t) => {
              const count = t.id === 'mailbox'
                ? (notifications.data?.items?.length ?? 0)
                : t.id === 'alerts' ? alerts.length : 0;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setTab(t.id)}
                  aria-pressed={tab === t.id}
                  title={t.unavailable}
                  className={cn(
                    'shrink-0 whitespace-nowrap px-2 py-1.5 text-[10.5px] font-semibold leading-tight transition',
                    tab === t.id ? 'bg-[#2b3543] text-white' : 'text-[#8fa2b8] hover:text-white',
                    t.unavailable ? 'opacity-55' : '',
                  )}
                >
                  {t.label}
                  {count > 0 ? (
                    <sup className={cn('ml-0.5 text-[9px]', t.id === 'mailbox' ? 'text-[#3183ff]' : 'text-[#8fa2b8]')}>{count}</sup>
                  ) : null}
                </button>
              );
            })}
          </div>
          </div>
        </>
      ) : null}

      {/* MetaTrader's position menu and the two forms it leads to. Rendered once, outside the
          collapsible pane, so dismissing the panel does not strand an open form. */}
      {live && sheet === 'menu' ? (
        <MT5PositionMenu
          title={`${symbol}, ${live.direction} ${lots(live.stakeCents)}`}
          subtitle={`#${ticketLabel(live)} at ${px(live.entryRate)}`}
          onDismiss={() => setSheet(null)}
          items={[
            {
              id: 'close',
              label: 'Close position',
              onPick: () => setSheet('close'),
              disabled: !earlyCloseEnabled || !live.sellable || live.phase !== 'open',
              note: !earlyCloseEnabled
                ? 'This brand settles every contract at expiry.'
                : !live.sellable
                  ? 'This contract settles at expiry and cannot be closed at a loss.'
                  : undefined,
            },
            { id: 'modify', label: 'Modify position', onPick: () => setSheet('modify') },
            {
              id: 'chart',
              label: 'Chart',
              onPick: () => { setSheet(null); setOpen(false); },
              note: 'Collapses this panel so the chart fills the screen.',
            },
          ]}
        />
      ) : null}

      {live && sheet === 'close' ? (
        <MT5ClosePosition
          pos={live}
          symbol={symbol}
          digits={digits}
          price={livePrice()}
          openPrice={live.entryRate === null ? null : priceOfRate(live.entryRate)}
          busy={live.phase === 'settling'}
          onDismiss={() => setSheet(null)}
          onConfirm={() => { sell(); setSheet(null); }}
        />
      ) : null}

      {live && sheet === 'modify' ? (
        <MT5ModifyPosition
          pos={live}
          symbol={symbol}
          digits={digits}
          openPrice={live.entryRate === null ? null : priceOfRate(live.entryRate)}
          canTakeProfit={earlyCloseEnabled}
          onDismiss={() => setSheet(null)}
        />
      ) : null}
    </div>
  );
}

/** Live newswire. Fetched when the tab is first shown, then refreshed on a slow timer. */
function NewsTab({ active }: { active: boolean }) {
  const { requestNews } = useGameSocketApi();
  const { status } = useGameSocket();
  const [items, setItems] = useState<NewsItemDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Keyed on the connection as well as the tab: a request raised while the socket is down is
  // rejected, and without this the tab would sit on its error until the next two-minute tick.
  useEffect(() => {
    if (!active || status !== 'open') return;
    let cancelled = false;
    const load = () => {
      requestNews(40)
        .then((r) => { if (!cancelled) { setItems(r.items); setError(null); } })
        .catch((e: Error) => { if (!cancelled) setError(e.message); });
    };
    load();
    const id = setInterval(load, 120_000);
    return () => { cancelled = true; clearInterval(id); };
  }, [active, status, requestNews]);

  if (error && !items) return <Empty>Newswire unavailable ({error}).</Empty>;
  if (!items) return <Empty>Loading news…</Empty>;
  if (items.length === 0) return <Empty>No news.</Empty>;
  return (
    <ul className="divide-y divide-[#2b3543]/60">
      {items.map((n) => (
        <li key={n.id}>
          {/* Opened in a new tab, and `noreferrer` so a third-party page is not told where the
              player came from. The text itself is rendered as text — never as markup. */}
          <a href={n.url} target="_blank" rel="noopener noreferrer" className="block px-3 py-2 hover:bg-[#2b3543]/40">
            <div className="flex items-baseline gap-2">
              <span className="shrink-0 font-mono text-[10px] text-[#8fa2b8]">{stamp(n.publishedAtMs)}</span>
              <span className="shrink-0 rounded bg-[#2b3543] px-1 text-[10px] text-[#8fa2b8]">{n.source}</span>
              <span className="min-w-0 text-[11px] font-semibold leading-snug text-white">{n.title}</span>
            </div>
            {n.summary ? <p className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-[#8fa2b8]">{n.summary}</p> : null}
          </a>
        </li>
      ))}
    </ul>
  );
}

/**
 * MetaTrader's Alerts tab and its Alert Editor.
 *
 * The grid is MetaTrader's own, verbatim and in order — `Symbol | Condition | Counter | Limit |
 * Timeout | Expiration | Event` (docs/mt5/09-toolbox.md 899-901), which is what
 * `TOOLBOX_COLUMNS.alerts` already held while this tab drew an inline form and four columns of its
 * own. The gutter carries MetaTrader's yellow bell for an enabled alert and its red crossed circle
 * for a disabled one (:910), and every row is created, modified, deleted and enabled from the
 * context menu with the accelerators MetaTrader lists (:912-921) — they are wired, not drawn.
 *
 * THE CONDITION LIST IS THREE, NOT NINE, AND THE TAB SAYS WHY. MetaTrader offers
 * `Bid < Bid > Ask < Ask > Last < Last > Volume < Volume > Time =` (:933-935). This platform quotes
 * one price per symbol, and docs/mt5/10-market-watch.md 417-419 is explicit about what that means:
 * a one-price platform "must delete `Bid`, `Ask` and `Spread` outright rather than fold them",
 * keeping the `Last` family. Drawing six price conditions over one number would offer a trader
 * three ways to say the same thing and two that cannot be true. Volume goes for a different reason
 * — the feed carries no volume to compare — and `Time =` stays, because it never needed a price.
 * See lib/game/alerts, which is where the rule lives and where the watcher applies it.
 *
 * The Action list keeps MetaTrader's four and offers the one this terminal can honestly perform,
 * with the other three visibly disabled and carrying their reason, which is how the rest of this
 * panel treats a control the platform cannot back.
 */
function AlertsTab({ symbol, digits, livePrice, alerts }: {
  symbol: string; digits: number; livePrice: () => number | null; alerts: PriceAlert[];
}) {
  const { add, update, remove, toggle, rearm } = useAlertsStore();
  const toast = useToast();
  const [selected, setSelected] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  /** `null` = closed; `{ id: null }` = Create; `{ id }` = Modify on that row. */
  const [editing, setEditing] = useState<{ id: string | null; draft: AlertDraft } | null>(null);

  const blank = (): AlertDraft => ({
    enabled: true,
    symbol,
    condition: 'last>',
    price: Number((livePrice() ?? 0).toFixed(digits)),
    timeHHMM: '',
    limit: ALERT_DEFAULTS.limit,
    timeoutS: ALERT_DEFAULTS.timeoutS,
    expiresAtMs: null,
  });
  const draftOf = (a: PriceAlert): AlertDraft => ({
    enabled: a.enabled, symbol: a.symbol, condition: a.condition, price: a.price,
    timeHHMM: a.timeHHMM, limit: a.limit, timeoutS: a.timeoutS, expiresAtMs: a.expiresAtMs,
  });
  const current = alerts.find((a) => a.id === selected) ?? null;

  const create = () => { setMenu(null); setEditing({ id: null, draft: blank() }); };
  const modify = () => { if (current) { setMenu(null); setEditing({ id: current.id, draft: draftOf(current) }); } };
  const drop = () => { if (current) { setMenu(null); remove(current.id); setSelected(null); } };
  const enable = () => { if (current) { setMenu(null); toggle(current.id); } };

  /**
   * MetaTrader's four accelerators, acting on the selected row (09-toolbox.md 914-917). They are
   * bound to this tab rather than to the window, so they cannot fire while a trader is typing into
   * the order ticket, and the panel's own Ctrl+T / Ctrl+F9 keep working.
   */
  const onKeyDown = (e: React.KeyboardEvent) => {
    const el = e.target as HTMLElement;
    if (el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA') return;
    if (e.key === 'Insert') { e.preventDefault(); create(); }
    else if (e.key === 'Enter' && current) { e.preventDefault(); modify(); }
    else if (e.key === 'Delete' && current) { e.preventDefault(); drop(); }
    else if (e.key === ' ' && current) { e.preventDefault(); enable(); }
  };

  return (
    <div
      tabIndex={0}
      onKeyDown={onKeyDown}
      onContextMenu={(e) => { e.preventDefault(); setMenu({ x: e.clientX, y: e.clientY }); }}
      className="outline-none"
      data-alerts-tab=""
    >
      <Table head={[...(TOOLBOX_COLUMNS.alerts ?? [])]}>
        {alerts.map((a) => (
          <tr
            key={a.id}
            onClick={() => setSelected(a.id)}
            onDoubleClick={() => { setSelected(a.id); setEditing({ id: a.id, draft: draftOf(a) }); }}
            className={cn('cursor-pointer border-t border-[#2b3543]/60', selected === a.id ? 'bg-[#2b3543]' : 'hover:bg-[#202933]')}
          >
            <Td first>
              <span className="flex items-center gap-1.5">
                <AlertBell on={a.enabled} />
                {a.symbol}
              </span>
            </Td>
            <Td>{conditionLabel(a.condition)} {a.condition === 'time=' ? a.timeHHMM : a.price.toFixed(digits)}</Td>
            <Td>{a.counter}</Td>
            <Td>{a.limit}</Td>
            {/* MetaTrader prints the timeout with its unit in the cell: "10 sec" (09-toolbox.md 906). */}
            <Td>{a.timeoutS} sec</Td>
            {/* Blank when an alert never expires, which is how MetaTrader's own rows read. */}
            <Td>{a.expiresAtMs === null ? '' : stamp(a.expiresAtMs)}</Td>
            {/* `Event` is the action that will be performed. MetaTrader's rows name a sound file or
                a mail subject there; this terminal can only raise its own notification, so that is
                what the cell says rather than naming a file that does not exist. */}
            <Td>Notification</Td>
          </tr>
        ))}
      </Table>

      {alerts.length === 0 ? <Empty>No alerts. Right-click to create one.</Empty> : null}

      {/* MetaTrader runs alerts on its server, so they fire with the app closed. These live in this
          browser, so they can only fire while the terminal is open — said plainly. */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-[#2b3543] px-3 py-1.5 text-[10px] text-[#8fa2b8]">
        <span>Alerts fire while this terminal is open.</span>
        <span>Checked against {symbol}, the open chart&apos;s symbol.</span>
        {current?.counter ? (
          <button type="button" onClick={() => rearm(current.id)} className="text-[#3183ff] hover:underline">
            Re-arm {current.symbol}
          </button>
        ) : null}
      </div>

      {menu ? (
        <>
          <button type="button" aria-label="Close menu" onClick={() => setMenu(null)} className="fixed inset-0 z-[70] cursor-default" />
          <div
            role="menu"
            data-alerts-menu=""
            className="fixed z-[71] w-48 overflow-hidden rounded-sm border border-[#2b3543] bg-[#202933] py-1 text-[12px] shadow-2xl"
            style={{ left: menu.x, top: menu.y }}
          >
            {/* Verbatim, with MetaTrader's accelerators and no ellipses (09-toolbox.md 912-922).
                Three of the four need a selected row, and are disabled without one rather than
                silently doing nothing. */}
            <AlertMenuItem label="Create" accel="Insert" onPick={create} />
            <AlertMenuItem label="Modify" accel="Enter" onPick={modify} disabled={!current} />
            <AlertMenuItem label="Delete" accel="Delete" onPick={drop} disabled={!current} />
            <AlertMenuItem label="Enable" accel="Space" onPick={enable} disabled={!current} checked={current?.enabled ?? false} />
          </div>
        </>
      ) : null}

      {editing ? (
        <AlertEditor
          draft={editing.draft}
          digits={digits}
          onChange={(d) => setEditing({ id: editing.id, draft: d })}
          onTest={(d) => {
            toast.push({
              tone: 'info',
              title: `${d.symbol} alert`,
              description: `${conditionLabel(d.condition)} ${d.condition === 'time=' ? d.timeHHMM : d.price}`,
            });
            logJournal('info', 'Alert', `${d.symbol} alert test ${conditionLabel(d.condition)} ${d.condition === 'time=' ? d.timeHHMM : d.price}`);
          }}
          onCancel={() => setEditing(null)}
          onOk={(d) => {
            if (editing.id === null) add(d); else update(editing.id, d);
            logJournal('info', 'Alert', `${d.symbol} alert ${editing.id === null ? 'created' : 'modified'}: ${conditionLabel(d.condition)} ${d.condition === 'time=' ? d.timeHHMM : d.price}`);
            setEditing(null);
          }}
        />
      ) : null}
    </div>
  );
}

/** MetaTrader's gutter glyphs: a yellow bell while armed, a red crossed circle when disabled. */
function AlertBell({ on }: { on: boolean }) {
  return on ? (
    <svg viewBox="0 0 16 16" width="11" height="11" aria-label="Enabled" role="img" className="shrink-0 text-[#f0b90b]" fill="currentColor">
      <path d="M8 1.5a1 1 0 0 1 1 1v.3a3.8 3.8 0 0 1 2.8 3.7v2.3l1 1.6H3.2l1-1.6V6.5A3.8 3.8 0 0 1 7 2.8v-.3a1 1 0 0 1 1-1Zm0 13a1.8 1.8 0 0 1-1.7-1.3h3.4A1.8 1.8 0 0 1 8 14.5Z" />
    </svg>
  ) : (
    <svg viewBox="0 0 16 16" width="11" height="11" aria-label="Disabled" role="img" className="shrink-0 text-[#f23645]" fill="none" stroke="currentColor" strokeWidth="1.8">
      <circle cx="8" cy="8" r="6" />
      <path d="M4 12 12 4" />
    </svg>
  );
}

function AlertMenuItem({ label, accel, onPick, disabled, checked }: {
  label: string; accel: string; onPick: () => void; disabled?: boolean; checked?: boolean;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onPick}
      disabled={disabled ?? false}
      className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-white hover:bg-[#2b3543] disabled:cursor-not-allowed disabled:opacity-40"
    >
      <span className="w-3 shrink-0 text-[#4597ff]" aria-hidden>{checked ? '✓' : ''}</span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <span className="shrink-0 text-[10px] text-[#8fa2b8]">{accel}</span>
    </button>
  );
}

/** A `datetime-local` value for an instant, and back. The control reads the local clock. */
const dtLocal = (ms: number | null): string =>
  ms === null ? '' : new Date(ms - new Date(ms).getTimezoneOffset() * 60_000).toISOString().slice(0, 16);

/**
 * MetaTrader's `Alert Editor` — its title, its nine fields in its order, and its three buttons
 * `OK` `Test` `Cancel` with OK focused (docs/mt5/09-toolbox.md 924-927).
 *
 * `Action:` and `Source:` are the two fields this terminal cannot fully back, so they are present
 * and visibly disabled with the reason on each option, rather than drawn as if they worked:
 * MetaTrader's Sound and File actions reach the terminal's own Sounds folder and local files, and
 * Mail goes through the terminal's SMTP settings, none of which a browser tab has. The one action
 * it can perform it performs for real, and `Test` performs it now.
 */
function AlertEditor({ draft, digits, onChange, onOk, onTest, onCancel }: {
  draft: AlertDraft;
  digits: number;
  onChange: (d: AlertDraft) => void;
  onOk: (d: AlertDraft) => void;
  onTest: (d: AlertDraft) => void;
  onCancel: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  const timeCondition = draft.condition === 'time=';
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Alert Editor"
      className="fixed inset-0 z-[80] flex flex-col bg-[#0f1720] text-white sm:items-center sm:justify-center sm:bg-black/60 sm:p-4"
    >
      <form
        onSubmit={(e) => { e.preventDefault(); onOk(draft); }}
        className="flex min-h-0 w-full flex-1 flex-col bg-[#0f1720] sm:h-auto sm:max-w-[420px] sm:flex-none sm:rounded-sm sm:border sm:border-[#2b3543]"
      >
        <div className="flex items-center gap-2 border-b border-[#2b3543] px-3 py-2.5">
          <span className="text-[15px] font-semibold leading-tight">Alert Editor</span>
        </div>

        <div className="min-h-0 flex-1 overflow-auto px-3 py-2.5 text-[12px]">
          <label className="mb-2 flex items-center gap-2">
            <input type="checkbox" checked={draft.enabled} onChange={(e) => onChange({ ...draft, enabled: e.target.checked })} />
            <span>Enable</span>
          </label>

          <Field label="Action:">
            <select
              value="notification"
              onChange={() => { /* the three others are disabled options; nothing to select */ }}
              className="w-full rounded border border-[#2b3543] bg-[#0f1720] px-1.5 py-1 text-white outline-none focus:border-[#3183ff]"
            >
              <option value="notification">Notification</option>
              <option value="sound" disabled>Sound (no sound files on this platform)</option>
              <option value="file" disabled>File (a browser cannot run one)</option>
              <option value="mail" disabled>Mail (this terminal has no mail server)</option>
            </select>
          </Field>

          <Field label="Expiration:">
            <input
              type="datetime-local"
              aria-label="Expiration"
              value={dtLocal(draft.expiresAtMs)}
              onChange={(e) => onChange({ ...draft, expiresAtMs: e.target.value ? new Date(e.target.value).getTime() : null })}
              className="w-full rounded border border-[#2b3543] bg-[#0f1720] px-1.5 py-1 text-white outline-none focus:border-[#3183ff]"
            />
          </Field>

          {/* One symbol, because the watcher runs against the open chart's price: an alert on
              anything else would sit in the list and never fire. */}
          <Field label="Symbol:">
            <input
              value={draft.symbol}
              readOnly
              aria-label="Symbol"
              title="Alerts are checked against the open chart's symbol."
              className="w-full rounded border border-[#2b3543] bg-[#202933] px-1.5 py-1 text-[#8fa2b8] outline-none"
            />
          </Field>

          <Field label="Condition:">
            <select
              value={draft.condition}
              aria-label="Condition"
              onChange={(e) => onChange({ ...draft, condition: e.target.value as AlertCondition })}
              className="w-full rounded border border-[#2b3543] bg-[#0f1720] px-1.5 py-1 text-white outline-none focus:border-[#3183ff]"
            >
              {ALERT_CONDITIONS.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
            </select>
          </Field>
          <p className="mb-2 text-[10px] leading-snug text-[#8fa2b8]">
            MetaTrader also offers Bid and Ask conditions. This platform quotes one price per symbol,
            so there is no bid, no ask and no spread to compare, and Volume is not published at all.
          </p>

          <Field label="Value:">
            {timeCondition ? (
              <input
                value={draft.timeHHMM}
                aria-label="Value"
                placeholder="15:00"
                onChange={(e) => onChange({ ...draft, timeHHMM: e.target.value })}
                className="w-full rounded border border-[#2b3543] bg-[#0f1720] px-1.5 py-1 text-white outline-none focus:border-[#3183ff]"
              />
            ) : (
              <input
                value={String(draft.price)}
                aria-label="Value"
                inputMode="decimal"
                onChange={(e) => onChange({ ...draft, price: Number(e.target.value) })}
                className="w-full rounded border border-[#2b3543] bg-[#0f1720] px-1.5 py-1 text-white outline-none focus:border-[#3183ff]"
              />
            )}
          </Field>
          {timeCondition ? (
            // MetaTrader's own wording for this field: "Specify the local computer time in the
            // format "HH:MM"" (09-toolbox.md 937-938). It is the one field on the tab that is not
            // in the server's time zone.
            <p className="mb-2 text-[10px] leading-snug text-[#8fa2b8]">Local computer time, HH:MM.</p>
          ) : (
            <p className="mb-2 text-[10px] leading-snug text-[#8fa2b8]">Price to {digits} decimal places.</p>
          )}

          <Field label="Source:">
            <span className="flex gap-1">
              <input
                value=""
                readOnly
                aria-label="Source"
                title="MetaTrader browses for a sound file or a mail template here; a browser tab has neither."
                className="w-full rounded border border-[#2b3543] bg-[#202933] px-1.5 py-1 text-[#8fa2b8] outline-none"
              />
              <button type="button" disabled title="No file to browse for on this platform." className="shrink-0 rounded border border-[#2b3543] px-2 text-[#8fa2b8] disabled:cursor-not-allowed disabled:opacity-40">...</button>
            </span>
          </Field>

          <Field label="Timeout:">
            <span className="flex items-center gap-1.5">
              <input
                type="number"
                min={1}
                aria-label="Timeout"
                value={draft.timeoutS}
                onChange={(e) => onChange({ ...draft, timeoutS: Math.max(1, Number(e.target.value) || 1) })}
                className="w-24 rounded border border-[#2b3543] bg-[#0f1720] px-1.5 py-1 text-white outline-none focus:border-[#3183ff]"
              />
              <span className="text-[#8fa2b8]">sec</span>
            </span>
          </Field>

          <Field label="Maximum iterations:">
            <input
              type="number"
              min={1}
              aria-label="Maximum iterations"
              value={draft.limit}
              onChange={(e) => onChange({ ...draft, limit: Math.max(1, Number(e.target.value) || 1) })}
              className="w-24 rounded border border-[#2b3543] bg-[#0f1720] px-1.5 py-1 text-white outline-none focus:border-[#3183ff]"
            />
          </Field>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-[#2b3543] px-3 py-2.5">
          <button type="submit" autoFocus className="rounded bg-[#3183ff] px-3 py-1 text-[12px] font-semibold text-white">OK</button>
          <button type="button" onClick={() => onTest(draft)} className="rounded border border-[#2b3543] px-3 py-1 text-[12px] text-white">Test</button>
          <button type="button" onClick={onCancel} className="rounded border border-[#2b3543] px-3 py-1 text-[12px] text-[#8fa2b8]">Cancel</button>
        </div>
      </form>
    </div>
  );
}

/** One labelled row of the Alert Editor: MetaTrader's label on the left, its control on the right. */
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="mb-2 flex items-center gap-2">
      <span className="w-32 shrink-0 text-[#8fa2b8]">{label}</span>
      <span className="min-w-0 flex-1">{children}</span>
    </label>
  );
}

/**
 * MetaTrader's mobile position entry: "SYMBOL, side volume" over "entry → current", with the result
 * on the right. The side and the result carry the colour — blue for buy and for profit, red for sell
 * and for loss — which is MetaTrader's pairing throughout.
 */
function PositionRow({
  symbol, direction, lots, from, to, profit, profitCents, note, className, onOpenMenu,
}: {
  symbol: string; direction: string; lots: string; from: string; to: string;
  profit: string; profitCents: number; note: string | null; className?: string;
  /** Present on a LIVE position only: MetaTrader opens the position menu from this row. */
  onOpenMenu?: (() => void) | undefined;
}) {
  const buy = direction === 'buy';
  const Tag = onOpenMenu ? 'button' : 'div';
  return (
    <Tag
      {...(onOpenMenu ? { type: 'button' as const, onClick: onOpenMenu, 'aria-label': `Position menu for ${symbol} ${direction} ${lots}` } : {})}
      className={cn(
        'flex w-full items-start justify-between gap-2 border-b border-[#2b3543]/60 px-3 py-2 text-left',
        onOpenMenu && 'transition hover:bg-[#202933]',
        className,
      )}
    >
      <div className="min-w-0">
        <div className="text-[12px] font-semibold text-white">
          {symbol},{' '}
          <span className={buy ? 'text-[#3183ff]' : 'text-[#f23645]'}>{direction} {lots}</span>
        </div>
        <div className="font-mono text-[11px] text-[#8fa2b8]">{from} → {to}</div>
      </div>
      <div className="shrink-0 text-right">
        <div className={cn('font-mono text-[12px] font-semibold tabular-nums', profitCents > 0 ? 'text-[#3183ff]' : profitCents < 0 ? 'text-[#f23645]' : 'text-[#ffffff]')}>{profit}</div>
        {note ? <div className="font-mono text-[10px] text-[#8fa2b8]">{note}</div> : null}
      </div>
    </Tag>
  );
}

function Figure({ label, value, tone, className }: { label: string; value: string; tone?: 'up' | 'down' | undefined; className?: string | undefined }) {
  return (
    <span className={cn('flex shrink-0 items-baseline gap-1.5 whitespace-nowrap', className)}>
      {/* No `uppercase`: MetaTrader's own casing is part of the label ("Free Margin:", not "FREE
          MARGIN"), and forcing it here would throw away the thing the screenshots were read for. */}
      <span className="text-[10px] tracking-wide text-[#8fa2b8]">{label}</span>
      {/* Equity carries this tone when the floating P/L is non-zero, so it is money, not a price:
          MetaTrader's blue for a profit, red for a loss. */}
      <span className={cn('font-mono text-[12px] font-semibold tabular-nums', tone === 'up' ? 'text-[#3183ff]' : tone === 'down' ? 'text-[#f23645]' : 'text-[#ffffff]')}>{value}</span>
    </span>
  );
}

/**
 * MetaTrader's grid alignment: `Symbol` left, everything else right, HEADER INCLUDED.
 *
 * docs/mt5/09-toolbox.md 266-268 reads it off the screenshots: "`Symbol` is left-aligned … every
 * column from `Ticket` rightwards is right-aligned, including its header", and :269 puts `Profit`
 * rightmost. It is not decoration. These columns are tickets, volumes, prices and money, and a
 * column of right-aligned figures lines its decimal points up so the eye can compare rows; left
 * aligning them is most of why this read as a web table rather than a terminal grid.
 *
 * The first column is the one exception because it holds a NAME, and names read from the left.
 */
function Table({ head, children }: { head: string[]; children: React.ReactNode }) {
  return (
    <table className="w-full border-collapse text-right font-mono text-[11px] tabular-nums">
      <thead>
        <tr className="text-[#8fa2b8]">
          {head.map((h, i) => (
            <th key={`${h}:${i}`} className={cn('whitespace-nowrap px-2 py-1 font-normal', i === 0 && 'text-left')}>{h}</th>
          ))}
        </tr>
      </thead>
      <tbody>{children}</tbody>
    </table>
  );
}

/** A cell. `first` carries the symbol, so it keeps the left alignment names need. */
function Td({ children, className, first }: { children: React.ReactNode; className?: string; first?: boolean }) {
  return <td className={cn('whitespace-nowrap px-2 py-1', first && 'text-left', className)}>{children}</td>;
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="px-3 py-4 text-center text-[11px] leading-snug text-[#8fa2b8]">{children}</div>;
}

/** The tabs MetaTrader has and this platform cannot fill. Company is hidden, so it is not here. */
const UNFILLABLE: readonly ToolboxTab[] = ['calendar', 'articles', 'codebase', 'experts'];

/**
 * MetaTrader's History tab.
 *
 * The grid is MetaTrader's own, verbatim and in its order — `Time | Symbol | Deal | Type |
 * Direction | Volume | Price | S / L | T / P | Commission | Profit | Change` (docs/mt5/09-toolbox.md
 * 610-616), which is also what `TOOLBOX_COLUMNS.history` already held while this tab drew eight
 * columns of its own with an invented `Close` among them. Time is leftmost and carries the sort
 * triangle (:618).
 *
 * The rows are the ones the /history screen already derives: `orderRows`, `dealRows` and
 * `positionRows` in lib/history/mt5history, which is where the three representations and their
 * arithmetic are documented and unit-tested. Nothing about history is computed twice.
 *
 * FOUR REPRESENTATIONS, ONE COLUMN SET. MetaTrader publishes a default visible set for Deals only
 * (:610, and :620-623 records that even that is not stable across builds), and its `Orders & Deals`
 * mode is "a tree view of all trading operations" (:665) — one grid holding both record types. So
 * all four modes render into the one documented column set, and a cell a representation has no
 * field for is left EMPTY rather than filled with something invented.
 *
 * Cells this platform cannot fill, and why:
 *
 *   S / L, T / P   The API returns no levels for a settled contract: the engine records the open,
 *                  the close and the result, and nothing else. MetaTrader draws an unset level as a
 *                  blank cell (:336-338), which is what the Trade tab above does too, so the empty
 *                  cell here says exactly what is true.
 *   Direction      "direction of the deal relative to the current position" (:631) — a DEAL field.
 *                  An order is a request and a position is a round trip; neither has one, so the
 *                  cell is empty in those two modes rather than repeating the Type.
 *   Commission     Blank on an order (nothing is charged for a request) and on a balance operation;
 *                  `0.00` on a deal, which is not a placeholder but this platform's real figure —
 *                  the house margin is inside the payout rather than charged per trade, which is
 *                  the same fact `moneySummary` documents.
 *   Change         Blank wherever no profit is locked in: an entry deal, an order, a deposit. On an
 *                  exit it is the asset price's own move over the round trip (:636) — see
 *                  `priceChangePct`, which is why a winning sell can print a negative Change.
 *   Deal           MetaTrader's deal ticket. One contract here is one engine record with one
 *                  ticket (see `positionTicket`), so the request, the two executions and the round
 *                  trip all carry the same number. That is why the Russian build's extra `Order`
 *                  column (:620-622) is not drawn beside it: it would repeat this one.
 *
 * The position's CLOSE price is not dropped either: `Price` is the open price, as it is in
 * MetaTrader's own grids and in the Trade tab above, and the close is the `out` deal's own Price in
 * Deals mode — the same records seen the other way round (:662-664).
 */
type HistoryMode = 'positions' | 'deals' | 'orders' | 'ordersdeals';

/** The four modes, in the order the context menu lists them (09-toolbox.md 648-655). */
const HISTORY_MODES: ReadonlyArray<{ key: HistoryMode; label: string }> = [
  { key: 'positions', label: 'Positions' },
  { key: 'deals', label: 'Deals' },
  { key: 'orders', label: 'Orders' },
  { key: 'ordersdeals', label: 'Orders & Deals' },
];

/** One row of the grid, whichever representation produced it. */
interface GridRow {
  id: string;
  timeMs: number;
  symbol: string;
  ticket: string;
  type: string;
  side: 'buy' | 'sell' | null;
  direction: string;
  volume: string;
  price: string;
  commission: string;
  profitCents: number | null;
  changePct: number | null;
  /** Orders & Deals is a tree: a deal hangs under the request that produced it. */
  child: boolean;
}

const dealGrid = (r: DealRow, digits: number): GridRow => ({
  id: r.id,
  timeMs: r.atMs,
  // A balance operation has no instrument: MetaTrader blanks the Symbol cell and puts the
  // operation's name in Type (09-toolbox.md 643-644).
  symbol: r.kind === 'balance' ? '' : r.symbol,
  ticket: r.ticket,
  type: r.side ?? r.label ?? '',
  side: r.side,
  direction: r.entry ?? '',
  volume: r.lots ?? '',
  price: r.lots === null ? '' : priceText(r.price, digits),
  commission: r.kind === 'trade' ? '0.00' : '',
  // "For entry trades the zero profit is shown" (09-toolbox.md 635): an `in` deal prints 0.00.
  profitCents: r.entry === 'in' ? 0 : r.amountCents,
  changePct: r.entry === 'out' ? priceChangePct(r.openPrice, r.price) : null,
  child: false,
});

const orderGrid = (r: OrderRow, digits: number): GridRow => ({
  id: r.id,
  timeMs: r.atMs,
  symbol: r.symbol,
  ticket: r.ticket,
  // A cancelled request types as "canceled buy" / "canceled sell" and its result is zeroed
  // (09-toolbox.md 632), which is how MetaTrader states a cancellation inside this column set
  // rather than through a State column the set does not have.
  type: r.state === 'CANCELED' ? `canceled ${r.side}` : r.side,
  side: r.side,
  direction: '',
  volume: r.lots,
  price: r.state === 'CANCELED' ? '' : priceText(r.price, digits),
  commission: '',
  profitCents: null,
  changePct: null,
  child: false,
});

const positionGrid = (r: ClosedRow, digits: number): GridRow => ({
  id: r.id,
  timeMs: r.atMs,
  symbol: r.kind === 'balance' ? '' : r.symbol,
  ticket: r.ticket,
  type: r.side ?? r.label ?? '',
  side: r.side,
  direction: '',
  volume: r.lots ?? '',
  price: r.lots === null ? '' : priceText(r.entryPrice, digits),
  commission: r.kind === 'trade' ? '0.00' : '',
  profitCents: r.amountCents,
  changePct: r.kind === 'trade' ? priceChangePct(r.entryPrice, r.exitPrice) : null,
  child: false,
});

function HistoryTab({ symbol, digits, lots, amount, token }: {
  symbol: string;
  digits: number;
  lots: (stakeCents: number) => string;
  /** MetaTrader's bare grid money: no currency code anywhere on this tab (09-toolbox.md 729). */
  amount: (cents: number) => string;
  token: string | null;
}) {
  // Deals, because MetaTrader opens on Deals — it is the one mode its menu ticks (09-toolbox.md 658).
  const [mode, setMode] = useState<HistoryMode>('deals');
  // All History: the period block publishes no tick (:669-674), so this is a choice, and it is the
  // one preset that cannot hide a record from a trader who came here to find one.
  const [period, setPeriod] = useState<PeriodKey>('all');
  const [custom, setCustom] = useState<{ from: string; to: string }>({ from: '', to: '' });
  // Ascending, which is the direction of the triangle on the Time header (09-toolbox.md 615, 618).
  const [ascending, setAscending] = useState(true);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);

  const range: Range = useMemo(
    () => periodRange(period, Date.now(), {
      ...(custom.from ? { fromMs: new Date(`${custom.from}T00:00:00`).getTime() } : {}),
      ...(custom.to ? { toMs: new Date(`${custom.to}T00:00:00`).getTime() + 86_400_000 } : {}),
    }),
    [period, custom.from, custom.to],
  );

  const positionsQ = usePositions('all');
  const transactionsQ = useTransactions();
  const positions: PositionDto[] = useMemo(
    () => (positionsQ.data?.pages ?? []).flatMap((p) => p.items),
    [positionsQ.data],
  );
  const transactions: TransactionDto[] = useMemo(
    () => (transactionsQ.data?.pages ?? []).flatMap((p) => p.items),
    [transactionsQ.data],
  );
  // Both feeds are newest-first and cursor-paged, so a period filter that only ever saw the first
  // page would under-report its own window. Same loop as the /history screen's.
  useAutoPage(positionsQ, positions.at(-1)?.openedAt, range.fromMs);
  useAutoPage(transactionsQ, transactions.at(-1)?.ts, range.fromMs);

  const orders = useMemo(() => orderRows(positions, range, symbol, lots), [positions, range, symbol, lots]);
  const deals = useMemo(() => dealRows(positions, transactions, range, symbol, lots), [positions, transactions, range, symbol, lots]);
  const closed = useMemo(() => positionRows(positions, transactions, range, symbol, lots), [positions, transactions, range, symbol, lots]);

  /**
   * The grid, sorted on the Time column it draws.
   *
   * `sortRows` keys on the ROUND TRIP's open and close times, which is what the mobile screen's
   * sort menu offers; the Time cell here is the record's own stamp, so an entry deal would sort by
   * its position's close time and land away from the time printed beside it.
   */
  const grid: GridRow[] = useMemo(() => {
    const dir = ascending ? 1 : -1;
    const byTime = <T extends { timeMs: number }>(rows: T[]): T[] => rows.sort((a, b) => dir * (a.timeMs - b.timeMs));
    if (mode === 'orders') return byTime(orders.map((r) => orderGrid(r, digits)));
    if (mode === 'positions') return byTime(closed.map((r) => positionGrid(r, digits)));
    if (mode === 'deals') return byTime(deals.map((r) => dealGrid(r, digits)));
    /**
     * Orders & Deals: "a tree view of all trading operations showing how the trade requests were
     * processed" (09-toolbox.md 665). Every request here is filled the instant it is placed, so the
     * tree is always exactly one level deep and never worth collapsing; it is drawn expanded, with
     * each execution indented under the request that produced it. A deposit has no request above
     * it, so it stands at the top level where MetaTrader's tree also leaves it.
     */
    const byTicket = new Map<string, DealRow[]>();
    for (const d of deals) {
      if (d.kind === 'balance') continue;
      const list = byTicket.get(d.ticket);
      if (list) list.push(d); else byTicket.set(d.ticket, [d]);
    }
    const groups: Array<{ at: number; rows: GridRow[] }> = orders.map((o) => ({
      at: o.atMs,
      rows: [
        orderGrid(o, digits),
        ...(byTicket.get(o.ticket) ?? [])
          .slice()
          .sort((a, b) => a.atMs - b.atMs)
          .map((d) => ({ ...dealGrid(d, digits), child: true })),
      ],
    }));
    for (const d of deals) if (d.kind === 'balance') groups.push({ at: d.atMs, rows: [dealGrid(d, digits)] });
    return groups.sort((a, b) => dir * (a.at - b.at)).flatMap((g) => g.rows);
  }, [mode, ascending, orders, deals, closed, digits]);

  /**
   * The summary strip is the ACCOUNT's history over the period, not the current mode's rows, which
   * is why it is computed from the deals in every mode: the deals are the money that moved.
   *
   * Its Profit and the Profit column's own total are two different quantities and are allowed to
   * disagree — they disagree in MetaTrader's own screenshot too (09-toolbox.md 732-733, flagged
   * there as unexplained): the strip is the account's result, the total is the sum of the cells
   * above it, which in Deals mode also carries every deposit and withdrawal.
   */
  const strip = historyStrip(deals);
  const profitTotal = grid.reduce((n, r) => n + (r.profitCents ?? 0), 0);
  const head = [...(TOOLBOX_COLUMNS.history ?? [])];

  const openMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    setMenu({ x: e.clientX, y: e.clientY });
  };

  if (!token) return <Empty>Sign in to see your trade history.</Empty>;

  return (
    <div onContextMenu={openMenu} data-history-mode={mode}>
      {/* MetaTrader shows history as a wide grid on a desktop and as two-line entries on a phone.
          Twelve columns cannot be read at 390px, which is what the Trade tab above says about ten. */}
      <div className="sm:hidden">
        {grid.map((r) => (
          <div key={r.id} className="flex items-start justify-between gap-2 border-b border-[#2b3543]/60 px-3 py-2">
            <div className="min-w-0">
              <div className="text-[12px] font-semibold text-white">
                {r.symbol ? `${r.symbol}, ` : ''}
                <span className={r.side === 'buy' ? 'text-[#3183ff]' : r.side === 'sell' ? 'text-[#f23645]' : ''}>
                  {r.type} {r.volume}
                </span>
                {r.direction ? <span className="text-[#8fa2b8]"> {r.direction}</span> : null}
              </div>
              <div className="font-mono text-[11px] text-[#8fa2b8]">{stamp(r.timeMs)} {r.price}</div>
            </div>
            <div className="shrink-0 text-right">
              <div className={cn('font-mono text-[12px] font-semibold tabular-nums', toneClass(r.profitCents))}>
                {r.profitCents === null ? '' : amount(r.profitCents)}
              </div>
              <div className={cn('font-mono text-[10px]', toneClass(r.changePct))}>{changeText(r.changePct)}</div>
            </div>
          </div>
        ))}
      </div>

      <div className="hidden sm:block">
        <Table head={head}>
          {grid.map((r) => (
            <tr key={r.id} className="border-t border-[#2b3543]/60">
              <Td first className={r.child ? 'pl-6' : ''}>{stamp(r.timeMs)}</Td>
              <Td>{r.symbol}</Td>
              <Td>{r.ticket}</Td>
              <Td className={r.side === 'buy' ? 'text-[#3183ff]' : r.side === 'sell' ? 'text-[#f23645]' : ''}>{r.type}</Td>
              <Td>{r.direction}</Td>
              <Td>{r.volume}</Td>
              <Td>{r.price}</Td>
              {/* S / L and T / P: no level is recorded against a settled contract, and an unset
                  level is a blank cell in MetaTrader (09-toolbox.md 336-338). */}
              <Td>{''}</Td>
              <Td>{''}</Td>
              <Td>{r.commission}</Td>
              <Td className={cn('font-semibold', toneClass(r.profitCents))}>
                {r.profitCents === null ? '' : amount(r.profitCents)}
              </Td>
              {/* Blue for positive and red for negative, as MetaTrader colours this column
                  (09-toolbox.md 636). */}
              <Td className={toneClass(r.changePct)}>{changeText(r.changePct)}</Td>
            </tr>
          ))}
          {/* MetaTrader's summary strip, with its two right-aligned column totals sitting under
              Commission and Profit and nothing under Change (09-toolbox.md 722-733). Drawn as the
              grid's last row so the two totals land under their own columns, which is the whole
              point of putting them on the strip. No currency code anywhere on this line, "not even
              after Balance" (:729). */}
          <tr className="border-t border-[#2b3543] bg-[#202933]">
            <td colSpan={9} className="whitespace-nowrap px-2 py-1 text-left text-[11px]" data-history-strip="">
              <span className="flex flex-wrap items-center gap-x-4 gap-y-0.5">
                <StripField label="Profit:" value={amount(strip.profitCents)} />
                <StripField label="Credit:" value={amount(strip.creditCents)} />
                <StripField label="Deposit:" value={amount(strip.depositCents)} />
                <StripField label="Withdrawal:" value={amount(strip.withdrawalCents)} />
                <StripField label="Balance:" value={amount(strip.balanceCents)} />
              </span>
            </td>
            <td className="whitespace-nowrap px-2 py-1 font-semibold">{amount(0)}</td>
            <td className={cn('whitespace-nowrap px-2 py-1 font-semibold', toneClass(profitTotal))}>{amount(profitTotal)}</td>
            <td />
          </tr>
        </Table>
      </div>

      {grid.length === 0 ? (
        <Empty>
          {positionsQ.isLoading || transactionsQ.isLoading
            ? 'Loading history…'
            : `No ${mode === 'orders' ? 'orders' : mode === 'positions' ? 'positions' : 'deals'} in this period.`}
        </Empty>
      ) : null}

      {/* The whole switch lives in the context menu: "There is no toolbar, no segmented control and
          no dropdown" (09-toolbox.md 657). The two blocks drawn are the two this platform can act
          on. MetaTrader's menu carries five more — New Order, Symbols ▸ and Volumes ▸, Report ▸ and
          Show on Charts ▸, Register as Signal — which are a second order ticket, a filter over one
          quoted instrument, a lots/units toggle for a platform that has no units, an HTML report
          generator and MQL5 signal registration; none of them exists here, and a menu item that
          does nothing is worse than an absent one. */}
      {menu ? (
        <>
          <button type="button" aria-label="Close menu" onClick={() => setMenu(null)} className="fixed inset-0 z-[70] cursor-default" />
          <div
            role="menu"
            data-history-menu=""
            className="fixed z-[71] w-52 overflow-hidden rounded-sm border border-[#2b3543] bg-[#202933] py-1 text-[12px] shadow-2xl"
            style={{ left: Math.min(menu.x, 1200), top: menu.y }}
          >
            {HISTORY_MODES.map((m) => (
              <MenuItem key={m.key} checked={mode === m.key} label={m.label} onPick={() => { setMode(m.key); setMenu(null); }} />
            ))}
            <div className="my-1 border-t border-[#2b3543]" />
            {DESKTOP_PERIODS.map((p) => (
              <MenuItem
                key={p.key}
                checked={period === p.key}
                label={p.label}
                // The gear MetaTrader puts on Custom Period, which is the only item that opens
                // anything (09-toolbox.md 673-676).
                glyph={p.key === 'custom' ? '⚙' : undefined}
                onPick={() => { setPeriod(p.key); if (p.key !== 'custom') setMenu(null); }}
              />
            ))}
            {period === 'custom' ? (
              <div className="flex flex-col gap-1.5 border-t border-[#2b3543] px-3 py-2">
                <label className="flex items-center gap-2 text-[11px] text-[#8fa2b8]">
                  From
                  <input
                    type="date"
                    aria-label="Custom period from"
                    value={custom.from}
                    onChange={(e) => setCustom({ ...custom, from: e.target.value })}
                    className="flex-1 rounded border border-[#2b3543] bg-[#0f1720] px-1.5 py-1 text-[11px] text-white outline-none focus:border-[#3183ff]"
                  />
                </label>
                <label className="flex items-center gap-2 text-[11px] text-[#8fa2b8]">
                  To
                  <input
                    type="date"
                    aria-label="Custom period to"
                    value={custom.to}
                    onChange={(e) => setCustom({ ...custom, to: e.target.value })}
                    className="flex-1 rounded border border-[#2b3543] bg-[#0f1720] px-1.5 py-1 text-[11px] text-white outline-none focus:border-[#3183ff]"
                  />
                </label>
                <button type="button" onClick={() => setMenu(null)} className="self-end rounded bg-[#3183ff] px-2 py-0.5 text-[11px] font-semibold text-white">Apply</button>
              </div>
            ) : null}
            <div className="my-1 border-t border-[#2b3543]" />
            <MenuItem
              checked={false}
              label={ascending ? 'Sort: Time ▲' : 'Sort: Time ▼'}
              onPick={() => { setAscending((v) => !v); setMenu(null); }}
            />
          </div>
        </>
      ) : null}
    </div>
  );
}

/** Blue up, red down, nothing at zero — MetaTrader's pairing, and never green (09-toolbox.md 646). */
const toneClass = (n: number | null): string =>
  n === null || n === 0 ? '' : n > 0 ? 'text-[#3183ff]' : 'text-[#f23645]';

function StripField({ label, value }: { label: string; value: string }) {
  return (
    <span className="flex items-baseline gap-1 whitespace-nowrap">
      <span className="text-[#8fa2b8]">{label}</span>
      <span className="font-semibold tabular-nums">{value}</span>
    </span>
  );
}

function MenuItem({ checked, label, glyph, onPick }: {
  checked: boolean; label: string; glyph?: string | undefined; onPick: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onPick}
      className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-white hover:bg-[#2b3543]"
    >
      <span className="w-3 shrink-0 text-[#4597ff]" aria-hidden>{checked ? '✓' : glyph ?? ''}</span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
    </button>
  );
}

/**
 * Pull older pages until the loaded tail reaches past the start of the period, then stop.
 *
 * The same loop the /history screen runs, and deliberately a copy: it is eight lines of react-query
 * paging shape that would have to become a module of its own to be shared, and the two screens page
 * the same two feeds for the same reason.
 */
function useAutoPage(
  q: { hasNextPage: boolean; isFetchingNextPage: boolean; fetchNextPage: () => unknown; data?: { pages: unknown[] } | undefined },
  oldestMs: number | undefined,
  fromMs: number,
): void {
  const pages = q.data?.pages.length ?? 0;
  const needMore = q.hasNextPage && !q.isFetchingNextPage && pages < 20
    && (oldestMs === undefined || oldestMs >= fromMs);
  useEffect(() => {
    if (needMore) void q.fetchNextPage();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needMore]);
}

/**
 * MetaTrader's Exposure tab.
 *
 * Its columns are MetaTrader's: `Assets`, `Volume`, `Rate`, the deposit currency's own code, and
 * `Graph`. Two of them are worth a word:
 *
 *   Assets  is the INSTRUMENT here, not a money figure. MetaQuotes uses the same word for both a
 *           column header and a money field elsewhere on the same screen, and never flags it.
 *   Graph   a bar from a centre zero: "long positions are displayed with blue bars and short
 *           positions are displayed with red ones".
 *
 * The arithmetic is `exposureRows` in the shared package, which is unit-tested there: a buy and a
 * sell of equal size on one symbol are flat in volume and NOT flat in money, because both stakes
 * are still at risk.
 */
function ExposureTab({ symbol, live, currency, fmt }: {
  symbol: string;
  live: { direction: 'buy' | 'sell'; stakeCents: number } | null | undefined;
  currency: string;
  fmt: (cents: number) => string;
}) {
  const rows = exposureRows(
    live ? [{ symbol, direction: live.direction, stakeCents: live.stakeCents }] : [],
  );
  if (rows.length === 0) return <Empty>No open positions, so nothing is exposed.</Empty>;
  const headers = [...(TOOLBOX_COLUMNS.exposure ?? [])];
  headers[3] = currency;
  return (
    <table className="w-full table-fixed border-collapse text-[11px]">
      <thead className="bg-[#202933] text-[#8fa2b8]">
        <tr>
          {headers.map((h, i) => (
            <th key={i} scope="col" className="border-b border-[#2b3543] px-2 py-1.5 text-left font-semibold">{h}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => {
          const long = r.netLots >= 0;
          return (
            <tr key={r.symbol} className="border-b border-[#2b3543]">
              <td className="truncate px-2 py-1.5 font-semibold">{r.symbol}</td>
              <td className="truncate px-2 py-1.5 font-mono tabular-nums">{r.netLots.toFixed(2)}</td>
              {/* Rate is 1 because a contract is staked and settled in the deposit currency: there
                  is no conversion to make, and printing an invented FX rate would be worse. */}
              <td className="truncate px-2 py-1.5 font-mono tabular-nums text-[#8fa2b8]">1.00</td>
              <td className="truncate px-2 py-1.5 font-mono tabular-nums">{fmt(r.valueCents)}</td>
              <td className="px-2 py-1.5">
                {/* A bar from a centre zero: blue for long, red for short, as MetaTrader draws it. */}
                <span className="flex h-2 w-full items-center" aria-label={`${long ? 'Long' : 'Short'} ${(r.share * 100).toFixed(0)}%`}>
                  <span className="flex h-2 flex-1 justify-end">
                    {long ? null : <span className="h-2 rounded-l-sm" style={{ width: `${r.share * 100}%`, background: '#f23645' }} />}
                  </span>
                  <span aria-hidden className="h-3 w-px bg-[#2b3543]" />
                  <span className="flex h-2 flex-1">
                    {long ? <span className="h-2 rounded-r-sm" style={{ width: `${r.share * 100}%`, background: '#3183ff' }} /> : null}
                  </span>
                </span>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
