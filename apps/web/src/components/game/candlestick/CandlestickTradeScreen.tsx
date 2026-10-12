'use client';

import { useState } from 'react';
import { cn } from '@/lib/cn';
import { useGameSocket, useGameSocketApi } from '@/lib/game/GameSocketProvider';
import { useWallet } from '@/lib/wallet/hooks';
import { useSession } from '@/lib/auth/session';
import { useBrand } from '@/lib/brand/BrandProvider';
import { useDisplayMoney } from '@/lib/money';
import { valueIsStale } from '@/lib/ui/dataPhase';
import { LiveBadge } from '@/components/ui/LiveBadge';
import { CandlestickTape } from '@/components/game/candlestick/CandlestickTape';
import { TradingPanel } from '@/components/game/candlestick/TradingPanel';
import { ChatPane } from '@/components/game/candlestick/ChatPane';
import { TopTradersPane } from '@/components/game/candlestick/TopTradersPane';
import { TournamentsPane } from '@/components/game/candlestick/TournamentsPane';
import { useLivePrice } from '@/components/game/candlestick/useLivePrice';
import { CIcon } from '@/components/game/candlestick/icons';
import { ActivityNotice } from '@/components/game/ActivityNotice';

/** The rail's three tabs, and the phone's fourth. */
type RailTab = 'chat' | 'top' | 'tours';
type PhoneTab = 'trade' | RailTab;

/**
 * The candlestick trade screen (`trade_ui = 'candlestick'`).
 *
 * Two trees, not one tree at two widths, because the mock is two arrangements: a phone shows ONE of
 * four panes with a tab bar under it, and a desktop shows the chart and a 640px rail side by side
 * with three of them. They are rendered with `md:hidden` / `hidden md:flex` rather than a JS media
 * query so the server's first paint is already right on both.
 *
 * The chart, the panel and the panes are the same components in both — one `CandlestickTape`, one
 * `TradingPanel` per tree, never two live ones at once, so there is one socket and one set of state.
 */
export function CandlestickTradeScreen() {
  const [phoneTab, setPhoneTab] = useState<PhoneTab>('trade');
  const [railTab, setRailTab] = useState<RailTab>('chat');

  return (
    <div className="flex h-full min-h-0 w-full flex-col overflow-hidden bg-bg text-fg">
      {/*
        Other players' wins, floating over the chart. One element, outside both trees, because it is
        the same notification on a phone and a desktop and must not be mounted twice — two copies
        would poll the same feed into two independent queues and show every event twice. It positions
        itself against AppShell's <main>, takes no pointer events and changes nothing below it.
      */}
      <ActivityNotice />

      {/* ── Phone: one pane at a time, four tabs ───────────────────────────── */}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden md:hidden">
        <div className="relative min-h-0 flex-1 overflow-hidden">
          <div className={cn('absolute inset-0 overflow-y-auto overflow-x-hidden', phoneTab === 'trade' ? 'block' : 'hidden')}>
            <QuoteBar compact />
            <div className="relative h-[350px] w-full shrink-0 bg-bg">
              <Tape />
            </div>
            <div className="min-w-0 border-t border-border">
              <TradingPanel />
            </div>
          </div>
          <div className={cn('absolute inset-0', phoneTab === 'chat' ? 'block' : 'hidden')}><ChatPane /></div>
          <div className={cn('absolute inset-0', phoneTab === 'top' ? 'block' : 'hidden')}><TopTradersPane /></div>
          <div className={cn('absolute inset-0', phoneTab === 'tours' ? 'block' : 'hidden')}><TournamentsPane /></div>
        </div>

        {/*
          Four tabs across a 320px phone is 80px each, so the label is pinned to one line
          (`leading-none` + nowrap) and the icon is 16px: an 18px glyph plus a wrapped label did not
          clear the 48px bar. `min-w-0` lets the cells stay equal instead of the widest label
          ("tours") stretching its own.
        */}
        <div className="flex h-12 shrink-0 border-t border-border bg-surface">
          {(['trade', 'chat', 'top', 'tours'] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setPhoneTab(t)}
              className={cn(
                'flex min-w-0 flex-1 flex-col items-center justify-center gap-1 px-0.5 text-[10px] font-semibold uppercase leading-none tracking-wider transition-colors',
                phoneTab === t ? 'border-t-2 border-accent text-accent' : 'text-muted',
              )}
            >
              <CIcon name={t} className="h-4 w-4" />
              <span className="max-w-full truncate">{t}</span>
            </button>
          ))}
        </div>
      </div>

      {/* ── Desktop: chart left, 640px rail right ──────────────────────────── */}
      <div className="hidden min-h-0 flex-1 flex-row overflow-hidden md:flex">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-bg">
          <QuoteBar />
          <div className="relative min-h-0 w-full flex-1 overflow-hidden">
            <Tape />
          </div>
        </div>

        <div className="flex w-[320px] shrink-0 flex-col overflow-hidden border-l border-border min-h-0 lg:w-[640px] lg:flex-row">
          <div className="min-w-0 flex-1 overflow-y-auto border-b border-border lg:w-[320px] lg:flex-none lg:border-b-0 lg:border-r">
            <TradingPanel />
          </div>

          <div className="flex min-w-0 flex-1 flex-col overflow-hidden lg:w-[320px] lg:flex-none">
            <div className="flex shrink-0 border-b border-border">
              {(['chat', 'top', 'tours'] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setRailTab(t)}
                  className={cn(
                    'flex min-h-10 min-w-0 flex-1 items-center justify-center gap-1.5 px-1 py-2.5 text-[10px] font-bold uppercase tracking-widest transition-colors',
                    railTab === t ? 'border-b-2 border-accent text-accent' : 'text-muted hover:text-fg',
                  )}
                >
                  <CIcon name={t} className="h-3.5 w-3.5" />
                  <span className="truncate">{t}</span>
                </button>
              ))}
            </div>
            <div className="min-h-0 flex-1 overflow-hidden">
              {railTab === 'chat' ? <ChatPane /> : railTab === 'top' ? <TopTradersPane /> : <TournamentsPane />}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/** The chart, wired to the socket. One definition, used by both trees. */
function Tape() {
  const { status } = useGameSocket();
  const { requestCandles, getLastTick } = useGameSocketApi();
  const { priceOfRate } = useLivePrice();
  return (
    <CandlestickTape
      requestCandles={requestCandles}
      getLastTick={getLastTick}
      priceOfRate={priceOfRate}
      status={status}
    />
  );
}

/**
 * The band above the chart: balance and price on the left, the live dot and the market on the right.
 *
 * `compact` is the phone's version of the same band — the mock makes it 40px and sticky instead of
 * 64px, and drops the price label to a single line.
 */
function QuoteBar({ compact = false }: { compact?: boolean }) {
  const token = useSession((s) => s.token);
  const { data: wallet } = useWallet();
  const brand = useBrand();
  const { fmt } = useDisplayMoney();
  const { status } = useGameSocket();
  const { tick, priceOfRate, digits } = useLivePrice();
  const price = priceOfRate(tick?.rate);
  /* The tick buffer survives a drop, so this price is whatever arrived last. Dimmed, because a
     last-known price rendered at full strength beside an OFFLINE badge is still a half-lie. */
  const stale = valueIsStale(status);
  const currency = (brand.currency ?? 'KES').toUpperCase();
  const balance = token ? fmt((wallet?.real ?? 0) + (wallet?.bonus ?? 0)) : fmt(0);

  if (compact) {
    return (
      <div className="sticky top-0 z-10 flex h-10 shrink-0 items-center justify-between gap-2 border-b border-border bg-bg px-3">
        {/*
          The balance is the only unbounded figure in this band (a brand's wallet can run to eight
          digits), so the two readouts take the leftover width and TRUNCATE; the live dot and the
          currency chip on the right are fixed and never give way to them.
        */}
        <div className="flex min-w-0 flex-1 items-center gap-2.5">
          <div className="min-w-0">
            <div className="text-[8px] uppercase leading-none tracking-wider text-muted">Balance</div>
            <div className="truncate text-xs font-bold leading-none text-accent">{balance}</div>
          </div>
          <div className="min-w-0">
            <div className="text-[8px] uppercase leading-none tracking-wider text-muted">Price</div>
            <div className={cn('truncate font-mono text-xs leading-none text-fg', stale && 'opacity-50')}>
              {price === null ? '—' : price.toFixed(digits)}
            </div>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <LiveBadge status={status} className="gap-1" />
          <div className="flex items-center gap-1 rounded border border-border bg-surface-2 px-1.5 py-0.5 text-[10px]">
            <span className="font-bold text-fg">{currency}</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-16 shrink-0 items-center justify-between gap-4 border-b border-border px-6">
      <div className="flex min-w-0 items-center gap-8">
        <div className="min-w-0">
          <div className="text-xs uppercase tracking-wider text-muted">Balance</div>
          <div className="truncate text-lg font-bold text-fg">{balance}</div>
        </div>
        <div className="min-w-0">
          <div className="text-xs uppercase tracking-wider text-muted">Price</div>
          <div className={cn('truncate font-mono text-lg font-bold text-fg', stale && 'opacity-50')}>
            {price === null ? '—' : price.toFixed(digits)}
          </div>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-4">
        <LiveBadge status={status} className="gap-2" dotClassName="h-2 w-2" labelClassName="text-sm" />
        <div className="flex items-center gap-2 rounded border border-border bg-surface-2 px-3 py-1 text-sm">
          <span className="text-muted">Global</span>
          <span className="font-bold text-fg">{currency}</span>
        </div>
      </div>
    </div>
  );
}
