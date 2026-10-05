'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Candle } from '@invest254/shared/candles';
import { LOT_STAKE_CENTS } from '@invest254/shared/account';
import {
  useGameSocket, useGameSocketApi, type SymbolRow,
} from '@/lib/game/GameSocketProvider';
import { useDisplayMoney } from '@/lib/money';
import { MT5Price } from '@/components/game/MT5Price';
import { logJournal } from '@/lib/game/journal';
import { quoteTone, QUOTE_TONE_COLOUR } from '@/lib/game/quoteTone';
import { useStakeLimits } from '@/lib/game/useStakeLimits';
import {
  MT5Specification, MT5MarketWatchMenu, marketWatchMenu,
} from '@/components/game/MT5Specification';
import { MT5SymbolsDialog } from '@/components/game/MT5SymbolsDialog';
import { useRestoreSymbolSet, useSymbolSetStore, MAX_WATCHED } from '@/lib/game/symbolSet';
import { DURATION_OPTIONS, durationLabel } from '@/components/game/MT5OrderTicket';
import { cn } from '@/lib/cn';

/**
 * MetaTrader's Market Watch — the symbol list and its detail, docked left on a desktop terminal.
 *
 * The list is the trader's own set, as MetaTrader's is: the brand offers a catalogue of ninety-odd
 * instruments and the window shows the dozen the trader picked, curated through the Symbols dialog
 * (Ctrl+U) and the context menu's Hide / Hide All / Show All. The set is stored per device; see
 * lib/game/symbolSet.
 *
 * MetaTrader quotes BID and ASK here. This product has neither: a contract settles on one seeded
 * price with no spread, so printing a bid and an ask would say the player buys at one and sells at
 * the other, which is not what happens. The column is Last, and the detail carries the session's
 * real open/high/low/close from the same candle feed the chart draws.
 *
 * Hidden below `lg`, where there is no room for it — the phone layout puts the quote in the price
 * strip above the chart instead, which is what MetaTrader's own mobile app does.
 */

/**
 * MetaTrader's four Market Watch tabs, along the bottom edge in this order. Its own Hot Keys page
 * names all four verbatim when describing Space/Tab, which is the second source for the set.
 */
type Tab = 'symbols' | 'details' | 'trading' | 'ticks';

const TABS: ReadonlyArray<{ id: Tab; label: string; unavailable?: string }> = [
  { id: 'symbols', label: 'Symbols' },
  { id: 'details', label: 'Details' },
  {
    id: 'trading',
    label: 'Trading',
    unavailable: 'MetaTrader’s Trading tab is its one-click Buy and Sell pair per symbol. The order ticket here is always on screen, and it is the same two buttons.',
  },
  {
    id: 'ticks',
    label: 'Ticks',
    unavailable: 'A tick chart. This feed is served as bars from M1 up, so there is no tick series to draw.',
  },
];

export function MarketWatch({ className }: { className?: string }) {
  const { getMarket, requestCandles, requestSymbols, subscribeSymbols, getSymbolQuote } = useGameSocketApi();
  const { status } = useGameSocket();
  const money = useDisplayMoney();
  const [tab, setTab] = useState<Tab>('symbols');
  /** MetaTrader reaches the Specification dialog from the Market Watch context menu. */
  const [menu, setMenu] = useState<{ x: number; y: number; symbol: string | null } | null>(null);
  const [specOpen, setSpecOpen] = useState(false);
  const [symbolsOpen, setSymbolsOpen] = useState(false);
  /** MetaTrader's `Grid` toggle, which draws or hides the row separators. */
  const [grid, setGrid] = useState(true);
  const limits = useStakeLimits();

  useRestoreSymbolSet();
  const watched = useSymbolSetStore((s) => s.watched);
  const hide = useSymbolSetStore((s) => s.hide);
  const hideAll = useSymbolSetStore((s) => s.hideAll);
  const showAll = useSymbolSetStore((s) => s.showAll);
  const sortList = useSymbolSetStore((s) => s.sort);
  const replace = useSymbolSetStore((s) => s.replace);

  /** The brand's whole catalogue, which the Symbols dialog shows as MetaTrader's group tree. */
  const [catalogue, setCatalogue] = useState<readonly SymbolRow[]>([]);
  const [defaultSymbol, setDefaultSymbol] = useState<string | null>(null);

  useEffect(() => {
    if (status !== 'open') return;
    let cancelled = false;
    requestSymbols()
      .then((r) => { if (!cancelled) { setCatalogue(r.symbols); setDefaultSymbol(r.defaultSymbol); } })
      // Worth saying rather than swallowing: without the catalogue the list falls back to the
      // stored names alone, and the Journal is where this app explains itself.
      .catch((e: Error) => { if (!cancelled) logJournal('warn', 'Quotes', `symbol list unavailable (${e.message})`); });
    return () => { cancelled = true; };
  }, [requestSymbols, status]);

  const bySymbol = useMemo(() => new Map(catalogue.map((r) => [r.symbol, r])), [catalogue]);

  /**
   * The rows actually shown: the trader's set, filtered against what the brand currently offers.
   *
   * Filtered rather than trusted, because the set outlives the catalogue. A stored symbol the brand
   * has stopped offering would otherwise sit in the window for ever, never quoting and never
   * explaining itself.
   */
  const visible = useMemo(
    () => (catalogue.length === 0 ? [...watched] : watched.filter((s) => bySymbol.has(s))),
    [watched, bySymbol, catalogue.length],
  );

  // Tell the engine which symbols to quote. Re-sent whenever the set changes; the provider re-arms
  // it after a reconnect on its own.
  const watchKey = visible.join(',');
  useEffect(() => {
    subscribeSymbols(watchKey === '' ? [] : watchKey.split(','));
  }, [subscribeSymbols, watchKey]);

  /** The row the Details tab and the Specification dialog describe. */
  const [selected, setSelected] = useState<string | null>(null);
  const active = selected !== null && visible.includes(selected)
    ? selected
    : visible.includes(defaultSymbol ?? '') ? defaultSymbol! : visible[0] ?? defaultSymbol ?? 'XAUUSD';

  /**
   * Ctrl+M, verbatim from MetaQuotes' hot-keys page: "Open/close the 'Market Watch' window." This
   * panel is docked rather than floating, so the shortcut moves focus to it by selecting its first
   * tab instead of toggling a window that cannot be closed. Ctrl+U opens the Symbols dialog, which
   * is the same page's shortcut for it.
   */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el !== null && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
      if (!(e.ctrlKey || e.metaKey)) return;
      if (e.key === 'm' || e.key === 'M') { e.preventDefault(); setTab('symbols'); }
      if (e.key === 'u' || e.key === 'U') { e.preventDefault(); setSymbolsOpen(true); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const [day, setDay] = useState<{ symbol: string; bar: Candle } | null>(null);
  const [, force] = useState(0);

  // Quote updates come off the tick stream, which does not re-render React on its own.
  useEffect(() => {
    const id = setInterval(() => force((n) => (n + 1) % 1_000_000), 300);
    return () => clearInterval(id);
  }, []);

  /**
   * The session figures are the latest closed D1 bar — the same bar the chart's D1 period shows.
   *
   * For the SELECTED symbol only. Fetching them for every row would ask the engine to build twenty
   * day chains to print two numbers each, and only one symbol's detail is on screen at a time.
   *
   * Refetched whenever the connection comes back, not only on a timer: a request made while the
   * socket is down is rejected, and waiting out the interval left the panel showing dashes for a
   * minute after every reconnect. (Found by reading this app's own Journal tab, which logged
   * "session figures unavailable (NOT_CONNECTED)" right after a reconnect.)
   */
  useEffect(() => {
    if (status !== 'open') return;
    let cancelled = false;
    const load = () => {
      requestCandles('D1', 1, undefined, active)
        .then((r) => { if (!cancelled && r.bars.length) setDay({ symbol: active, bar: r.bars[r.bars.length - 1]! }); })
        .catch((e: Error) => { if (!cancelled) logJournal('warn', 'Quotes', `session figures unavailable (${e.message})`); });
    };
    load();
    const id = setInterval(load, 60_000);
    return () => { cancelled = true; clearInterval(id); };
  }, [requestCandles, status, active]);

  const market = getMarket();
  const quoteOf = useCallback((symbol: string) => {
    const q = getSymbolQuote(symbol);
    if (q) return q;
    // Before a per-symbol quote has landed, the brand's own market axis still prices the DEFAULT
    // symbol, so that one row is never blank while the others fill in.
    if (market && market.instrument.symbol === symbol) {
      return { instrument: market.instrument, price: null, up: null, changedAt: null, anchor: market.anchor };
    }
    return null;
  }, [getSymbolQuote, market]);

  const digitsOf = (symbol: string) => bySymbol.get(symbol)?.digits ?? market?.instrument.digits ?? 2;
  const activeDigits = digitsOf(active);
  const activeDay = day !== null && day.symbol === active ? day.bar : null;
  const show = (n: number | null | undefined, digits = activeDigits) => (n === null || n === undefined ? '-' : n.toFixed(digits));
  const describe = (symbol: string) => bySymbol.get(symbol)?.description ?? '';

  const menuItems = marketWatchMenu({
    onSpecification: () => setSpecOpen(true),
    ...(catalogue.length > 0 ? { onSymbols: () => setSymbolsOpen(true) } : {}),
    ...(menu?.symbol ? { onHide: () => hide(menu.symbol!) } : {}),
    ...(visible.length > 0 ? { onHideAll: hideAll, onSort: sortList } : {}),
    // `Show All` fills the window up to the cap. MetaTrader shows everything; this feed quotes a
    // bounded number at once, so it shows as many as it can and the dialog says how many that is.
    ...(catalogue.length > 0 && visible.length < Math.min(MAX_WATCHED, catalogue.length)
      ? { onShowAll: () => showAll(catalogue.slice(0, MAX_WATCHED).map((r) => r.symbol)) }
      : {}),
    grid: { on: grid, toggle: () => setGrid((g) => !g) },
  });

  return (
    <aside className={cn('flex flex-col overflow-hidden rounded-xl border border-[#2b3543] bg-[#0f1720] text-[#ffffff]', className)}>
      <div className="flex items-center gap-2 border-b border-[#2b3543] px-3 py-2">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-[#8fa2b8]">Market Watch</span>
        <button
          type="button"
          onClick={() => setSymbolsOpen(true)}
          title="Symbols (Ctrl+U)"
          aria-label="Symbols"
          className="ml-auto rounded-sm border border-[#2b3543] px-1.5 text-[10px] font-semibold text-[#8fa2b8] transition hover:border-[#3183ff] hover:text-white"
        >
          +
        </button>
        <span
          className={cn('h-1.5 w-1.5 rounded-full', status === 'open' ? 'bg-[#41be56]' : status === 'connecting' ? 'bg-[#f0b90b]' : 'bg-[#f23645]')}
          title={status === 'open' ? 'Live' : status === 'connecting' ? 'Syncing' : 'Offline'}
        />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {tab === 'symbols' ? (
          visible.length === 0 ? (
            <div className="px-3 py-4 text-center text-[11px] leading-snug text-[#8fa2b8]">
              No symbols shown.
              <button type="button" onClick={() => setSymbolsOpen(true)} className="ml-1 text-[#3183ff] underline">
                Add some
              </button>
              .
            </div>
          ) : (
            /* MetaTrader's Quotes rows: the symbol on the left, its quote on the right in its own
               typography, coloured by the direction of that symbol's last price change.

               MetaTrader shows BID and ASK here. There is no spread on these instruments — a
               contract settles on one seeded price — so one quote is printed rather than two numbers
               implying the player buys at one and sells at the other. For the same reason the Spread
               column MetaTrader puts under the symbol is absent instead of showing a made-up figure. */
            <div data-quote-list="">
              {visible.map((symbol) => {
                const q = quoteOf(symbol);
                const digits = digitsOf(symbol);
                const tone = quoteTone({ up: q?.up ?? null, changedAt: q?.changedAt ?? null, now: Date.now() });
                const colour = tone === null ? '#ffffff' : QUOTE_TONE_COLOUR[tone];
                const open = q?.anchor.base ?? null;
                const price = q?.price ?? null;
                const changePct = price !== null && open ? ((price - open) / open) * 100 : null;
                return (
                  <button
                    key={symbol}
                    type="button"
                    data-quote-row={symbol}
                    aria-pressed={symbol === active}
                    onClick={() => { setSelected(symbol); setTab('details'); }}
                    onContextMenu={(e) => { e.preventDefault(); setSelected(symbol); setMenu({ x: e.clientX, y: e.clientY, symbol }); }}
                    className={cn(
                      'flex w-full items-center gap-2 px-2 py-1.5 text-left transition hover:bg-[#202933]',
                      grid ? 'border-b border-[#2b3543]/60' : '',
                      symbol === active ? 'bg-[#202933]' : '',
                    )}
                  >
                    <span className="w-[72px] shrink-0 truncate text-[11px] font-bold text-white">{symbol}</span>
                    <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-[#8fa2b8]">
                      {changePct === null ? '' : `${changePct >= 0 ? '+' : ''}${changePct.toFixed(2)}%`}
                    </span>
                    {price === null ? (
                      /* Not a dash: the row is subscribed and its first quote is on its way. A
                         symbol's price chain takes a moment to build the first time it is asked for. */
                      <span className="shrink-0 font-mono text-[10px] text-[#4a5666]">waiting</span>
                    ) : (
                      <MT5Price value={price} digits={digits} className="shrink-0 text-[11px]" style={{ color: colour }} />
                    )}
                  </button>
                );
              })}
            </div>
          )
        ) : tab === 'trading' || tab === 'ticks' ? (
          <div className="px-3 py-4 text-center text-[11px] leading-snug text-[#8fa2b8]">
            {TABS.find((t) => t.id === tab)?.unavailable}
          </div>
        ) : (
          <dl className="divide-y divide-[#2b3543]/50 text-[11px]">
            <Detail label="Symbol" value={active} />
            {describe(active) === '' ? null : <Detail label="Description" value={describe(active)} />}
            <Detail label="Last" value={show(quoteOf(active)?.price ?? null)} />
            <Detail label="Session open" value={show(activeDay?.open ?? null)} />
            <Detail label="Session high" value={show(activeDay?.high ?? null)} />
            <Detail label="Session low" value={show(activeDay?.low ?? null)} />
            <Detail label="Digits" value={String(activeDigits)} />
            {/* The contract size behind the Volume column, stated rather than implied. */}
            <Detail label="Contract size" value={`${money.fmt(LOT_STAKE_CENTS)} / lot`} />
            <Detail label="Session" value="00:00–24:00 UTC" />
            <div className="px-3 py-2">
              {/* MetaTrader reaches this from the context menu. A phone has no right click, so the
                  Details tab carries it too. */}
              <button
                type="button"
                onClick={() => setSpecOpen(true)}
                className="h-7 w-full rounded-sm border border-[#2b3543] bg-[#202933] text-[11px] font-semibold text-white transition hover:border-[#3183ff]"
              >
                Specification
              </button>
            </div>
          </dl>
        )}
      </div>

      {menu ? (
        <MT5MarketWatchMenu
          at={{ x: menu.x, y: menu.y }}
          items={menuItems}
          onDismiss={() => setMenu(null)}
        />
      ) : null}

      {symbolsOpen ? (
        <MT5SymbolsDialog
          catalogue={catalogue}
          watched={visible}
          onApply={replace}
          onDismiss={() => setSymbolsOpen(false)}
        />
      ) : null}

      {specOpen ? (
        <MT5Specification
          spec={{
            symbol: active,
            // MetaTrader prints the instrument's description beside the symbol in its blue header.
            description: describe(active) === '' ? active : describe(active),
            digits: activeDigits,
            contractSize: money.fmt(LOT_STAKE_CENTS),
            currency: money.currency,
            minVolume: limits.minCents / LOT_STAKE_CENTS,
            maxVolume: limits.maxCents === undefined ? null : limits.maxCents / LOT_STAKE_CENTS,
            volumeStep: 0.01,
            expiries: DURATION_OPTIONS.map(durationLabel),
            volumeDigits: 3,
          }}
          onDismiss={() => setSpecOpen(false)}
        />
      ) : null}

      {/* MetaTrader's Market Watch tabs sit along the bottom of the panel, as the Toolbox's do. */}
      <div data-mw-tabs="" className="flex gap-0.5 border-t border-[#2b3543] bg-[#202933] px-1 py-1">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            aria-pressed={tab === t.id}
            title={t.unavailable}
            className={cn(
              'rounded px-2 py-0.5 text-[11px] font-semibold transition',
              tab === t.id ? 'bg-[#2b3543] text-white' : 'text-[#8fa2b8] hover:text-white',
              t.unavailable ? 'opacity-55' : '',
            )}
          >
            {t.label}
          </button>
        ))}
      </div>
    </aside>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2 px-3 py-1.5">
      <dt className="text-[#8fa2b8]">{label}</dt>
      <dd className="font-mono tabular-nums text-[#ffffff]">{value}</dd>
    </div>
  );
}
