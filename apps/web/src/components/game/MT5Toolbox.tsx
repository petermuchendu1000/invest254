'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { valueOfRate } from '@invest254/shared/candles';
import { accountSummary, lotsOfStake } from '@invest254/shared/account';
import { useGameSocket, useGameSocketApi, type NewsItemDto, type DayAnchor } from '@/lib/game/GameSocketProvider';
import { useWallet } from '@/lib/wallet/hooks';
import { useDisplayMoney } from '@/lib/money';
import { useSession } from '@/lib/auth/session';
import { useMyNotifications } from '@/lib/notifications/hooks';
import { useJournal, logJournal } from '@/lib/game/journal';
import { useAlertsStore, usePriceAlertWatch, type PriceAlert } from '@/lib/game/alerts';
import { useTakeProfitStore, useTakeProfitWatch } from '@/lib/game/takeprofit';
import { useToast } from '@/lib/toast/ToastProvider';
import { api } from '@/lib/api/endpoints';
import type { PositionDto } from '@/lib/api/types';
import { EXECUTION_PRICE, tradeDateOf } from '@/lib/history/mt5history';
import { cn } from '@/lib/cn';

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

type Tab = 'trade' | 'history' | 'news' | 'mailbox' | 'alerts' | 'journal';

const TABS: ReadonlyArray<{ id: Tab; label: string }> = [
  { id: 'trade', label: 'Trade' },
  { id: 'history', label: 'History' },
  { id: 'news', label: 'News' },
  { id: 'mailbox', label: 'Mailbox' },
  { id: 'alerts', label: 'Alerts' },
  { id: 'journal', label: 'Journal' },
];

export function MT5Toolbox() {
  const { activePosition, status } = useGameSocket();
  const { getLastTick, getMarket, sell } = useGameSocketApi();
  const { data: wallet } = useWallet();
  const money = useDisplayMoney();
  const token = useSession((s) => s.token);
  const toast = useToast();

  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>('trade');
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
    if (rate === null || rate === undefined) return '—';
    const p = priceOfRate(rate);
    return p === null ? '—' : p.toFixed(digits);
  };
  /**
   * The price a rate had on ITS OWN day.
   *
   * `priceOfRate` maps through the CURRENT day's anchor, which is right for a live position and
   * wrong for anything settled earlier: the engine re-anchors the axis at every UTC midnight, so an
   * old trade rendered that way printed a price that never happened — quietly, and plausibly enough
   * that nobody would spot it. Each trade is priced from the anchor of the day it was made on,
   * fetched from the engine (see `useDayAnchors`). Until that day's anchor has arrived — or if it
   * falls outside the history the engine retains — the cell says what is true of every contract
   * here, as the History screen does, rather than guessing.
   */
  const pxOn = (rate: number | null | undefined, atMs: number | null | undefined): string => {
    if (rate === null || rate === undefined || atMs === null || atMs === undefined) return '—';
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
      description: `${a.above ? 'rose to' : 'fell to'} ${a.price} — now ${price.toFixed(digits)}`,
    });
  });

  // An optimistic open has no engine id yet; its stake is already committed, so it counts.
  const live = activePosition && activePosition.phase !== 'settling' ? activePosition : null;
  const floatingCents = live ? live.livePnlCents : 0;
  const { balanceCents, equityCents, marginCents, freeMarginCents, marginLevelPct } = accountSummary({
    balanceCents: (wallet?.real ?? 0) + (wallet?.bonus ?? 0),
    openStakeCents: live ? live.stakeCents : 0,
    floatingPnlCents: floatingCents,
  });

  // ── Take profit ────────────────────────────────────────────────────────────────────────────────
  // The target lives in the shared store because MetaTrader carries T/P on the ticket AND lets you
  // modify it on an open position; both surfaces read and write the one value.
  const tpTarget = useTakeProfitStore((st) => st.targetCents);
  const setTp = useTakeProfitStore((st) => st.set);
  useTakeProfitWatch(live, sell, money.fmt);

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

  const notifications = useMyNotifications();
  const journal = useJournal();
  const alerts = useAlertsStore((s) => s.alerts);

  return (
    <div className="flex shrink-0 flex-col overflow-hidden rounded-xl border border-[#2b3543] bg-[#0f1720] text-[#ffffff]">
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
            'min-w-0 flex-1 gap-x-4 gap-y-1',
            open
              ? 'grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5'
              : 'flex items-center gap-3 overflow-x-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
          )}
        >
          <Figure label="Balance" value={money.fmt(balanceCents)} />
          <Figure label="Equity" value={money.fmt(equityCents)} tone={floatingCents === 0 ? undefined : floatingCents > 0 ? 'up' : 'down'} />
          {open ? <Figure label="Margin" value={money.fmt(marginCents)} /> : null}
          <Figure label="Free margin" value={money.fmt(freeMarginCents)} />
          <Figure label="Margin level" value={marginLevelPct === null ? '—' : `${marginLevelPct.toFixed(2)}%`} />
        </span>
        <span className="flex shrink-0 items-center gap-2 pl-1">
          {live ? <span className="rounded bg-[#3183ff]/20 px-1.5 py-0.5 text-[10px] font-semibold text-[#3183ff]">1 open</span> : null}
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
          <div className="fixed inset-x-2 bottom-[calc(4.75rem+env(safe-area-inset-bottom))] z-40 flex max-h-[62vh] flex-col overflow-hidden rounded-xl border border-[#2b3543] bg-[#0f1720] shadow-2xl sm:static sm:z-auto sm:max-h-none sm:rounded-none sm:border-0 sm:border-t sm:shadow-none">
          <div className="min-h-0 flex-1 overflow-auto sm:border-t sm:border-[#2b3543]" style={{ maxHeight: 'min(46vh, 22rem)' }}>
            {/* MetaTrader shows a position as a two-line entry on a phone and as a wide table on a
                desktop, because ten columns cannot be read on a 430px screen. Both are rendered from
                the same values and swapped at `sm`, rather than the table being squeezed. */}
            {tab === 'trade' ? (
              live ? (
                <>
                  <PositionRow
                    className="sm:hidden"
                    symbol={symbol}
                    direction={live.direction}
                    lots={lotsOfStake(live.stakeCents)}
                    from={px(live.entryRate)}
                    to={px(getLastTick()?.rate ?? null)}
                    profit={money.fmt(live.livePnlCents)}
                    profitCents={live.livePnlCents}
                    note={tpTarget === null ? null : `T/P ${money.fmt(tpTarget)}`}
                  />
                  <div className="hidden sm:block">
                    <Table head={['Symbol', 'Ticket', 'Time', 'Type', 'Volume', 'Price', 'S / L', 'T / P', 'Price', 'Profit']}>
                      <tr className="border-t border-[#2b3543]/60">
                        <Td>{symbol}</Td>
                        <Td>{live.positionId ? live.positionId.slice(0, 8) : '…'}</Td>
                        <Td>{live.expiresAtMs ? clock(live.expiresAtMs - live.durationS * 1000) : '—'}</Td>
                        <Td className={live.direction === 'buy' ? 'text-[#3183ff]' : 'text-[#f23645]'}>{live.direction}</Td>
                        <Td>{lotsOfStake(live.stakeCents)}</Td>
                        <Td>{px(live.entryRate)}</Td>
                        <Td>
                          {/* Present, disabled, and honest about why. The engine refuses to close a
                              losing contract early, so a stop is not implementable; the most this
                              contract can lose is its stake, always. */}
                          <span
                            className="cursor-not-allowed text-[#8fa2b8]/50"
                            title="No stop loss: this contract settles at expiry and the most it can lose is the stake."
                          >
                            —
                          </span>
                        </Td>
                        <Td>
                          {/* MetaTrader's "− value +", the same control the ticket carries. */}
                          <span className="flex items-center gap-1">
                            <button type="button" onClick={() => setTp(tpTarget === null ? null : Math.max(0, tpTarget - 10_000) || null)} disabled={tpTarget === null} className="px-1 text-[#8fa2b8] hover:text-white disabled:opacity-40" aria-label="Lower take profit">−</button>
                            <span className="min-w-14 text-center">{tpTarget === null ? 'none' : money.fmt(tpTarget)}</span>
                            <button type="button" onClick={() => setTp((tpTarget ?? 0) + 10_000)} className="px-1 text-[#8fa2b8] hover:text-white" aria-label="Raise take profit">+</button>
                          </span>
                        </Td>
                        <Td>{px(getLastTick()?.rate ?? null)}</Td>
                        <Td className={cn('font-semibold', live.livePnlCents > 0 ? 'text-[#3183ff]' : live.livePnlCents < 0 ? 'text-[#f23645]' : '')}>
                          {money.fmt(live.livePnlCents)}
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
                      from={pxOn(p.entryRate, p.openedAt)}
                      to={pxOn(p.exitRate, p.settledAt ?? p.openedAt)}
                      profit={p.pnlCents === null ? '—' : money.fmt(p.pnlCents)}
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
                      <Td>{pxOn(p.entryRate, p.openedAt)}</Td>
                      <Td>{pxOn(p.exitRate, p.settledAt ?? p.openedAt)}</Td>
                      <Td className={cn('font-semibold', (p.pnlCents ?? 0) > 0 ? 'text-[#3183ff]' : (p.pnlCents ?? 0) < 0 ? 'text-[#f23645]' : '')}>
                        {p.pnlCents === null ? '—' : money.fmt(p.pnlCents)}
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

          {/* MetaTrader puts the Toolbox tabs along the BOTTOM edge of the panel. */}
          <div className="flex items-center gap-0.5 overflow-x-auto border-t border-[#2b3543] bg-[#202933] px-1 py-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                aria-pressed={tab === t.id}
                className={cn(
                  'shrink-0 rounded px-2.5 py-1 text-[11px] font-semibold transition',
                  tab === t.id ? 'bg-[#2b3543] text-white' : 'text-[#8fa2b8] hover:text-white',
                )}
              >
                {t.label}
                {t.id === 'mailbox' && (notifications.data?.items?.length ?? 0) > 0
                  ? <span className="ml-1 text-[#3183ff]">({notifications.data?.items?.length ?? 0})</span>
                  : null}
                {t.id === 'alerts' && alerts.length > 0 ? <span className="ml-1 text-[#8fa2b8]">({alerts.length})</span> : null}
              </button>
            ))}
            <span className="ml-auto shrink-0 pr-1 text-[10px] text-[#8fa2b8]">
              {status === 'open' ? 'Live' : status === 'connecting' ? 'Syncing' : 'Offline'}
            </span>
          </div>
          </div>
        </>
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
  symbol, direction, lots, from, to, profit, profitCents, note, className,
}: {
  symbol: string; direction: string; lots: string; from: string; to: string;
  profit: string; profitCents: number; note: string | null; className?: string;
}) {
  const buy = direction === 'buy';
  return (
    <div className={cn('flex items-start justify-between gap-2 border-b border-[#2b3543]/60 px-3 py-2', className)}>
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
    </div>
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
      <span className="text-[10px] uppercase tracking-wide text-[#8fa2b8]">{label}</span>
      <span className={cn('font-mono text-[12px] font-semibold tabular-nums', tone === 'up' ? 'text-[#41be56]' : tone === 'down' ? 'text-[#f23645]' : 'text-[#ffffff]')}>{value}</span>
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
  return <div className="px-3 py-4 text-center text-[11px] text-[#8fa2b8]">{children}</div>;
}
