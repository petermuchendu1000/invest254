'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { valueOfRate } from '@invest254/shared/candles';
import { accountSummary, accountStripFields, mtAmount, lotsOfStake } from '@invest254/shared/account';
import { useGameSocket, useGameSocketApi, type NewsItemDto, type DayAnchor } from '@/lib/game/GameSocketProvider';
import { useWallet } from '@/lib/wallet/hooks';
import { useDisplayMoney } from '@/lib/money';
import { useBrand } from '@/lib/brand/BrandProvider';
import { useSession } from '@/lib/auth/session';
import { useMyNotifications } from '@/lib/notifications/hooks';
import { useJournal, logJournal } from '@/lib/game/journal';
import { useAlertsStore, usePriceAlertWatch, type PriceAlert } from '@/lib/game/alerts';
import { useLevelsStore, useRestoreLevels } from '@/lib/game/levelsStore';
import { levelPrice, isContinuousBrand } from '@/lib/game/levelWatch';
import { useToast } from '@/lib/toast/ToastProvider';
import { api } from '@/lib/api/endpoints';
import type { PositionDto } from '@/lib/api/types';
import { EXECUTION_PRICE, tradeDateOf } from '@/lib/history/mt5history';
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
  /**
   * The price a rate had on ITS OWN day.
   *
   * `stored` wins whenever it is there: since migration 0180 the engine records the executed price
   * on the trade itself, which is the price that was shown, not a reconstruction of it — and it
   * stays right even for a trade older than the day chain the engine retains.
   *
   * Otherwise the price is rebuilt from the anchor of the day the trade was made on (see
   * `useDayAnchors`). It cannot come from the CURRENT day's anchor, which is right for a live
   * position and wrong for anything settled earlier: the engine re-anchors the axis at every UTC
   * midnight, so an old trade rendered that way printed a price that never happened — quietly, and
   * plausibly enough that nobody would spot it. Until that day's anchor has arrived, or if the day
   * is off the chain entirely, the cell says what is true of every contract here, as the History
   * screen does, rather than guessing.
   */
  const pxOn = (
    rate: number | null | undefined,
    atMs: number | null | undefined,
    stored?: number | null | undefined,
  ): string => {
    if (rate === null || rate === undefined || atMs === null || atMs === undefined) return '-';
    if (typeof stored === 'number' && Number.isFinite(stored)) return stored.toFixed(digits);
    const m = getMarket();
    const a = anchors.get(tradeDateOf(atMs));
    if (!m || !a) return EXECUTION_PRICE;
    return (a.base + m.instrument.scale * (valueOfRate(rate) - a.openValue)).toFixed(digits);
  };

  // Price alerts fire against the same price the chart draws.
  usePriceAlertWatch(livePrice, symbol, (a, price) => {
    toast.push({
      tone: 'info',
      title: `${a.symbol} alert`,
      description: `${a.above ? 'rose to' : 'fell to'} ${a.price}, now ${price.toFixed(digits)}`,
    });
  });

  // An optimistic open has no engine id yet; its stake is already committed, so it counts.
  const live = activePosition && activePosition.phase !== 'settling' ? activePosition : null;
  const floatingCents = live ? live.livePnlCents : 0;
  const summary = accountSummary({
    balanceCents: (wallet?.real ?? 0) + (wallet?.bonus ?? 0),
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

  // ── Tab data ───────────────────────────────────────────────────────────────────────────────────
  const { data: history } = useQuery({
    queryKey: ['positions', 'toolbox'],
    queryFn: () => api.positions(token!, { limit: 25 }),
    enabled: Boolean(token) && open && tab === 'history',
    staleTime: 15_000,
  });
  const rows = useMemo(() => history?.items ?? [], [history]);
  // Every UTC day the open position and the loaded history touch — the days whose anchors price them.
  const days = useMemo(() => {
    const out: string[] = [];
    if (live) out.push(tradeDateOf(live.expiresAtMs ? live.expiresAtMs - live.durationS * 1000 : Date.now()));
    for (const p of rows) {
      out.push(tradeDateOf(p.openedAt));
      if (p.settledAt !== null) out.push(tradeDateOf(p.settledAt));
    }
    return out;
  }, [rows, live]);
  const anchors = useDayAnchors(days, open);

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
                the same values and swapped at `sm`, rather than the table being squeezed. */}
            {tab === 'trade' ? (
              live ? (
                <>
                  <PositionRow
                    className="sm:hidden"
                    onOpenMenu={() => setSheet('menu')}
                    symbol={symbol}
                    direction={live.direction}
                    lots={lotsOfStake(live.stakeCents)}
                    from={px(live.entryRate)}
                    to={px(getLastTick()?.rate ?? null)}
                    profit={money.fmt(live.livePnlCents)}
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
                        <Td>{symbol}</Td>
                        <Td>{live.positionId ? live.positionId.slice(0, 8) : '…'}</Td>
                        <Td>{live.expiresAtMs ? clock(live.expiresAtMs - live.durationS * 1000) : '-'}</Td>
                        <Td className={live.direction === 'buy' ? 'text-[#3183ff]' : 'text-[#f23645]'}>{live.direction}</Td>
                        <Td>{lotsOfStake(live.stakeCents)}</Td>
                        <Td>{px(live.entryRate)}</Td>
                        <Td>
                          {/* MetaTrader's S/L column: the LEVEL, as a price, the same one the ticket
                              sets and the chart draws. It used to print the stake instead, because
                              there was no stop to show: the whole column was a sentence about the
                              engine. On a continuous brand the engine checks this level every tick
                              and closes the position there, which is what the column is for. */}
                          <span
                            className="text-[#8fa2b8]"
                            title={continuous
                              ? 'The stop closes this position at its price, for what it is worth there. Stops processing is performed on the server side.'
                              : 'This contract settles a loss at expiry, so the stop cannot fire. The level is the trader\u2019s.'}
                          >
                            {slPrice === null ? '-' : slPrice.toFixed(digits)}
                          </span>
                        </Td>
                        <Td>
                          {/* MetaTrader's T/P column: the level as a price, stepped in the
                              instrument's own points. It held a money TARGET before, which is a
                              different concept the chart could not draw and the phone never fired. */}
                          {continuous ? (
                            <span className="flex items-center gap-1">
                              <button type="button" onClick={() => stepTp(-1)} className="px-1 text-[#8fa2b8] hover:text-white disabled:opacity-40" aria-label="Lower take profit">−</button>
                              <span className="min-w-16 text-center">{tpPrice === null ? 'none' : tpPrice.toFixed(digits)}</span>
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
                            {money.fmt(live.livePnlCents)}
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
              rows.length > 0 ? (
                <>
                <div className="sm:hidden">
                  {rows.map((p: PositionDto) => (
                    <PositionRow
                      key={p.id}
                      symbol={symbol}
                      direction={p.direction}
                      lots={lotsOfStake(p.stakeCents)}
                      from={pxOn(p.entryRate, p.openedAt, p.entryPrice)}
                      to={pxOn(p.exitRate, p.settledAt ?? p.openedAt, p.exitPrice)}
                      profit={p.pnlCents === null ? '-' : money.fmt(p.pnlCents)}
                      profitCents={p.pnlCents ?? 0}
                      note={clock(p.openedAt)}
                    />
                  ))}
                </div>
                <div className="hidden sm:block">
                <Table head={['Symbol', 'Ticket', 'Time', 'Type', 'Volume', 'Price', 'Close', 'Profit']}>
                  {rows.map((p: PositionDto) => (
                    <tr key={p.id} className="border-t border-[#2b3543]/60">
                      <Td>{symbol}</Td>
                      <Td>{p.id.slice(0, 8)}</Td>
                      <Td>{clock(p.openedAt)}</Td>
                      <Td className={p.direction === 'buy' ? 'text-[#3183ff]' : 'text-[#f23645]'}>{p.direction}</Td>
                      <Td>{lotsOfStake(p.stakeCents)}</Td>
                      <Td>{pxOn(p.entryRate, p.openedAt, p.entryPrice)}</Td>
                      <Td>{pxOn(p.exitRate, p.settledAt ?? p.openedAt, p.exitPrice)}</Td>
                      <Td className={cn('font-semibold', (p.pnlCents ?? 0) > 0 ? 'text-[#3183ff]' : (p.pnlCents ?? 0) < 0 ? 'text-[#f23645]' : '')}>
                        {p.pnlCents === null ? '-' : money.fmt(p.pnlCents)}
                      </Td>
                    </tr>
                  ))}
                </Table>
                </div>
                </>
              ) : (
                <Empty>{token ? 'No closed trades yet.' : 'Sign in to see your trade history.'}</Empty>
              )
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
                        <span className="ml-auto shrink-0 font-mono text-[10px] text-[#8fa2b8]">{clock(n.createdAtMs)}</span>
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
                fmt={(cents) => money.fmt(cents)}
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
                      <span className="shrink-0 text-[#8fa2b8]">{clock(e.atMs)}</span>
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
              chart already does with twenty-one periods. On a wide screen they still fill the bar.
              A count rides as a superscript, as MetaTrader's red subscript count does. */}
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
                    'shrink-0 whitespace-nowrap px-2 py-1.5 text-[10.5px] font-semibold leading-tight transition sm:min-w-0 sm:flex-1 sm:px-0.5',
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
          title={`${symbol}, ${live.direction} ${lotsOfStake(live.stakeCents)}`}
          subtitle={`#${live.positionId ? live.positionId.slice(0, 8) : '…'} at ${px(live.entryRate)}`}
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
              <span className="shrink-0 font-mono text-[10px] text-[#8fa2b8]">{clock(n.publishedAtMs)}</span>
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

function AlertsTab({
  symbol, digits, livePrice, alerts,
}: { symbol: string; digits: number; livePrice: () => number | null; alerts: PriceAlert[] }) {
  const { add, remove, rearm } = useAlertsStore();
  const [above, setAbove] = useState(true);
  const [price, setPrice] = useState('');

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const p = Number(price);
    if (!Number.isFinite(p) || p <= 0) return;
    add(symbol, above, p);
    logJournal('info', 'Alert', `${symbol} alert set ${above ? '≥' : '≤'} ${p}`);
    setPrice('');
  };

  const now = livePrice();
  return (
    <div>
      <form onSubmit={submit} className="flex flex-wrap items-center gap-1.5 border-b border-[#2b3543] px-3 py-2">
        <span className="text-[11px] font-semibold text-white">{symbol}</span>
        <button
          type="button"
          onClick={() => setAbove((v) => !v)}
          className="rounded border border-[#2b3543] bg-[#0f1720] px-2 py-0.5 text-[11px] font-semibold text-[#ffffff]"
          title="Fire when the price rises above, or falls below, the level"
        >
          {above ? 'Bid ≥' : 'Bid ≤'}
        </button>
        <input
          value={price}
          onChange={(e) => setPrice(e.target.value)}
          inputMode="decimal"
          placeholder={now === null ? 'price' : now.toFixed(digits)}
          className="w-24 rounded border border-[#2b3543] bg-[#0f1720] px-1.5 py-0.5 text-[11px] text-[#ffffff] outline-none focus:border-[#3183ff]"
        />
        <button type="submit" className="rounded bg-[#3183ff] px-2 py-0.5 text-[11px] font-semibold text-white">Add</button>
        {/* MetaTrader runs alerts on its server, so they fire with the app closed. These live in this
            browser, so they can only fire while the terminal is open — said plainly. */}
        <span className="basis-full text-[10px] text-[#8fa2b8]">Alerts fire while this terminal is open.</span>
      </form>
      {alerts.length === 0 ? (
        <Empty>No alerts set.</Empty>
      ) : (
        <Table head={['Symbol', 'Condition', 'Price', 'Status', '']}>
          {alerts.map((a) => (
            <tr key={a.id} className="border-t border-[#2b3543]/60">
              <Td>{a.symbol}</Td>
              <Td>{a.above ? 'Bid ≥' : 'Bid ≤'}</Td>
              <Td>{a.price.toFixed(digits)}</Td>
              <Td className={a.triggeredAtMs ? 'text-[#f0b90b]' : 'text-[#41be56]'}>
                {a.triggeredAtMs ? `fired ${clock(a.triggeredAtMs)}` : 'armed'}
              </Td>
              <Td>
                <span className="flex gap-2">
                  {a.triggeredAtMs ? (
                    <button type="button" onClick={() => rearm(a.id)} className="text-[#3183ff] hover:underline">re-arm</button>
                  ) : null}
                  <button type="button" onClick={() => remove(a.id)} className="text-[#8fa2b8] hover:text-[#f23645]">delete</button>
                </span>
              </Td>
            </tr>
          ))}
        </Table>
      )}
    </div>
  );
}

/**
 * The day anchors for a page of trade history, fetched once per day and kept for the session.
 *
 * A page spans a handful of UTC days, so this is one small request, not one per row; days already
 * held are never asked for again. A failure is swallowed deliberately — the prices degrade to
 * "at market" and the rest of the tab keeps working, which is the right trade for a display field.
 */
function useDayAnchors(days: readonly string[], enabled: boolean): Map<string, DayAnchor> {
  const { requestAnchors } = useGameSocketApi();
  const { status } = useGameSocket();
  const [anchors, setAnchors] = useState<Map<string, DayAnchor>>(new Map());
  // Keyed on the SORTED JOIN rather than the array: a re-render that produces an equal list must not
  // refire the request.
  const wanted = useMemo(() => [...new Set(days)].sort().join(','), [days]);

  useEffect(() => {
    if (!enabled || status !== 'open' || wanted === '') return;
    const missing = wanted.split(',').filter((d) => !anchors.has(d));
    if (missing.length === 0) return;
    let cancelled = false;
    requestAnchors(missing)
      .then((r) => {
        if (cancelled) return;
        setAnchors((prev) => {
          const next = new Map(prev);
          for (const d of r.days) next.set(d.dateKey, d);
          return next;
        });
      })
      .catch(() => { /* prices fall back to "at market"; nothing else depends on this */ });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wanted, enabled, status]);

  // A reconnect re-anchors the series, so anything held is re-fetched rather than trusted.
  useEffect(() => { if (status !== 'open') setAnchors(new Map()); }, [status]);

  return anchors;
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

const pad = (n: number) => String(n).padStart(2, '0');
const clock = (ms: number): string => {
  const d = new Date(ms);
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
};

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

function Table({ head, children }: { head: string[]; children: React.ReactNode }) {
  return (
    <table className="w-full border-collapse text-left font-mono text-[11px] tabular-nums">
      <thead>
        <tr className="text-[#8fa2b8]">
          {head.map((h, i) => (
            <th key={`${h}:${i}`} className="whitespace-nowrap px-2 py-1 font-normal">{h}</th>
          ))}
        </tr>
      </thead>
      <tbody>{children}</tbody>
    </table>
  );
}

function Td({ children, className }: { children: React.ReactNode; className?: string }) {
  return <td className={cn('whitespace-nowrap px-2 py-1', className)}>{children}</td>;
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="px-3 py-4 text-center text-[11px] leading-snug text-[#8fa2b8]">{children}</div>;
}

/** The tabs MetaTrader has and this platform cannot fill. Company is hidden, so it is not here. */
const UNFILLABLE: readonly ToolboxTab[] = ['calendar', 'articles', 'codebase', 'experts'];

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
