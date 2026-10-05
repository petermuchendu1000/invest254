'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { valueOfRate, type Candle } from '@invest254/shared/candles';
import { LOT_STAKE_CENTS } from '@invest254/shared/account';
import { useGameSocket, useGameSocketApi } from '@/lib/game/GameSocketProvider';
import { useDisplayMoney } from '@/lib/money';
import { MT5Price } from '@/components/game/MT5Price';
import { logJournal } from '@/lib/game/journal';
import { quoteTone, QUOTE_TONE_COLOUR } from '@/lib/game/quoteTone';
import { useStakeLimits } from '@/lib/game/useStakeLimits';
import {
  MT5Specification, MT5MarketWatchMenu, marketWatchMenu,
} from '@/components/game/MT5Specification';
import { DURATION_OPTIONS, durationLabel } from '@/components/game/MT5OrderTicket';
import { cn } from '@/lib/cn';

/**
 * MetaTrader's Market Watch — the symbol list and its detail, docked left on a desktop terminal.
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
    unavailable: 'MetaTrader\u2019s Trading tab is its one-click Buy and Sell pair per symbol. The order ticket here is always on screen, and it is the same two buttons.',
  },
  {
    id: 'ticks',
    label: 'Ticks',
    unavailable: 'A tick chart. This feed is served as bars from M1 up, so there is no tick series to draw.',
  },
];

export function MarketWatch({ className }: { className?: string }) {
  const { getLastTick, getMarket, requestCandles } = useGameSocketApi();
  const { status } = useGameSocket();
  const money = useDisplayMoney();
  const [tab, setTab] = useState<Tab>('symbols');
  /** MetaTrader reaches the Specification dialog from the Market Watch context menu. */
  const [menuAt, setMenuAt] = useState<{ x: number; y: number } | null>(null);
  const [specOpen, setSpecOpen] = useState(false);
  const limits = useStakeLimits();

  /**
   * Ctrl+M, verbatim from MetaQuotes' hot-keys page: "Open/close the 'Market Watch' window." This
   * panel is docked rather than floating, so the shortcut moves focus to it by selecting its first
   * tab instead of toggling a window that cannot be closed.
   */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el !== null && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
      if ((e.ctrlKey || e.metaKey) && (e.key === 'm' || e.key === 'M')) {
        e.preventDefault();
        setTab('symbols');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  const [day, setDay] = useState<Candle | null>(null);
  const [, force] = useState(0);
  /**
   * Direction of the last price CHANGE, and WHEN it changed, which is what colours a MetaTrader
   * quote row. See lib/game/quoteTone for MetaQuotes' rule verbatim: blue up, red down, and grey
   * once the price has not changed for fifteen seconds.
   *
   * The timestamp is the part that used to be missing. The colour was held for ever, so a feed that
   * had stopped sending looked exactly like a live one that had ticked up.
   */
  const tickUpRef = useRef<boolean | null>(null);
  const changedAtRef = useRef<number | null>(null);
  const lastSeenRef = useRef<number | null>(null);

  // Quote updates come off the tick stream, which does not re-render React on its own.
  useEffect(() => {
    const id = setInterval(() => force((n) => (n + 1) % 1_000_000), 300);
    return () => clearInterval(id);
  }, []);

  /**
   * The session figures are the latest closed D1 bar — the same bar the chart's D1 period shows.
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
      requestCandles('D1', 1)
        .then((r) => { if (!cancelled && r.bars.length) setDay(r.bars[r.bars.length - 1]!); })
        // A failure is worth seeing rather than swallowing: the session line simply shows dashes,
        // and the Journal says why.
        .catch((e: Error) => { if (!cancelled) logJournal('warn', 'Quotes', `session figures unavailable (${e.message})`); });
    };
    load();
    const id = setInterval(load, 60_000);
    return () => { cancelled = true; clearInterval(id); };
  }, [requestCandles, status]);

  const market = getMarket();
  const digits = market?.instrument.digits ?? 2;
  const symbol = market?.instrument.symbol ?? 'XAUUSD';

  const priceNow = useCallback((): number | null => {
    const t = getLastTick();
    const m = getMarket();
    if (!t || !m) return null;
    return m.anchor.base + m.instrument.scale * (valueOfRate(t.rate) - m.anchor.openValue);
  }, [getLastTick, getMarket]);

  const last = priceNow();
  if (last !== null) {
    const prev = lastSeenRef.current;
    if (prev !== null && last !== prev) {
      tickUpRef.current = last > prev;
      changedAtRef.current = Date.now();
    }
    lastSeenRef.current = last;
  }
  // MetaTrader colours the row from the LAST traded price where a symbol has one, and only falls
  // back to Bid where it does not. This symbol quotes one price, which is that last price.
  const tone = quoteTone({ up: tickUpRef.current, changedAt: changedAtRef.current, now: Date.now() });
  const quoteColour = tone === null ? '#ffffff' : QUOTE_TONE_COLOUR[tone];
  // Change against the session open, which is what a terminal's change column means.
  const open = market?.anchor.base ?? null;
  const changePct = last !== null && open ? ((last - open) / open) * 100 : null;
  const up = (changePct ?? 0) >= 0;
  const show = (n: number | null | undefined) => (n === null || n === undefined ? '-' : n.toFixed(digits));

  return (
    <aside className={cn('flex flex-col overflow-hidden rounded-xl border border-[#2b3543] bg-[#0f1720] text-[#ffffff]', className)}>
      <div className="flex items-center gap-2 border-b border-[#2b3543] px-3 py-2">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-[#8fa2b8]">Market Watch</span>
        <span
          className={cn('ml-auto h-1.5 w-1.5 rounded-full', status === 'open' ? 'bg-[#41be56]' : status === 'connecting' ? 'bg-[#f0b90b]' : 'bg-[#f23645]')}
          title={status === 'open' ? 'Live' : status === 'connecting' ? 'Syncing' : 'Offline'}
        />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {tab === 'symbols' ? (
          /* MetaTrader's Quotes row: the symbol and its session line on the left, the quote on the
             right in its own typography, coloured by the last tick's direction.

             MetaTrader shows BID and ASK here. There is no spread on this instrument — a contract
             settles on one seeded price — so one quote is printed rather than two numbers implying
             the player buys at one and sells at the other. For the same reason the Spread column
             MetaTrader puts under the symbol is absent instead of showing a made-up figure. */
          <div
            data-quote-row=""
            className="border-b border-[#2b3543]/60 px-2 py-2"
            onContextMenu={(e) => { e.preventDefault(); setMenuAt({ x: e.clientX, y: e.clientY }); }}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="text-[12px] font-bold text-white">{symbol}</div>
                <div className="font-mono text-[10px] text-[#8fa2b8]">
                  {changePct === null ? '-' : `${up ? '+' : ''}${changePct.toFixed(2)}%`} today
                </div>
              </div>
              <MT5Price value={last} digits={digits} className="text-[12px]" style={{ color: quoteColour }} />
            </div>
            <div className="mt-1 flex gap-3 font-mono text-[10px] text-[#8fa2b8]">
              <span>Low: <span className="text-[#8fa2b8]">{show(day?.low ?? null)}</span></span>
              <span>High: <span className="text-[#8fa2b8]">{show(day?.high ?? null)}</span></span>
            </div>
          </div>
        ) : tab === 'trading' || tab === 'ticks' ? (
          <div className="px-3 py-4 text-center text-[11px] leading-snug text-[#8fa2b8]">
            {TABS.find((t) => t.id === tab)?.unavailable}
          </div>
        ) : (
          <dl className="divide-y divide-[#2b3543]/50 text-[11px]">
            <Detail label="Symbol" value={symbol} />
            <Detail label="Last" value={show(last)} />
            <Detail label="Session open" value={show(day?.open ?? null)} />
            <Detail label="Session high" value={show(day?.high ?? null)} />
            <Detail label="Session low" value={show(day?.low ?? null)} />
            <Detail label="Digits" value={String(digits)} />
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

      {menuAt ? (
        <MT5MarketWatchMenu
          at={menuAt}
          items={marketWatchMenu({ onSpecification: () => setSpecOpen(true) })}
          onDismiss={() => setMenuAt(null)}
        />
      ) : null}

      {specOpen ? (
        <MT5Specification
          spec={{
            symbol,
            // MetaTrader prints the instrument's description beside the symbol in its blue header.
            description: 'Gold vs US Dollar',
            digits,
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
