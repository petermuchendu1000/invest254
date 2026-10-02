'use client';

import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { valueOfRate } from '@invest254/shared/candles';
import { accountSummary, lotsOfStake } from '@invest254/shared/account';
import { useGameSocket, useGameSocketApi } from '@/lib/game/GameSocketProvider';
import { useWallet } from '@/lib/wallet/hooks';
import { useDisplayMoney } from '@/lib/money';
import { useSession } from '@/lib/auth/session';
import { api } from '@/lib/api/endpoints';
import type { PositionDto } from '@/lib/api/types';
import { cn } from '@/lib/cn';

/**
 * MetaTrader's Toolbox: the account summary strip, the open position, and closed trades.
 *
 * The figures come from `accountSummary` in the shared package, which documents how MT5's
 * margin-broker vocabulary maps onto this game's fixed-stake contracts and is unit-tested there.
 * The floating result is the engine's own live P/L (`position_update`), the same number the engine
 * will settle on — it is not recomputed here, so the panel cannot disagree with the outcome.
 *
 * Tabs are limited to the two that carry real data. MetaTrader also shows News, Mailbox, Alerts and
 * Journal; there is nothing behind those here, and an empty tab pretending otherwise would be worse
 * than its absence.
 */

type Tab = 'trade' | 'history';

export function MT5Toolbox() {
  const { activePosition, status } = useGameSocket();
  const { getLastTick, getMarket } = useGameSocketApi();
  const { data: wallet } = useWallet();
  const money = useDisplayMoney();
  const token = useSession((s) => s.token);

  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>('trade');
  // The live row is driven by the tick stream, which does not re-render React on its own.
  const [, force] = useState(0);
  useEffect(() => {
    const id = setInterval(() => force((n) => (n + 1) % 1_000_000), 250);
    return () => clearInterval(id);
  }, []);

  const market = getMarket();
  const priceOf = (rate: number): number | null =>
    market ? market.anchor.base + market.instrument.scale * (valueOfRate(rate) - market.anchor.openValue) : null;
  const digits = market?.instrument.digits ?? 2;
  const px = (rate: number | null | undefined): string => {
    if (rate === null || rate === undefined) return '—';
    const p = priceOf(rate);
    return p === null ? '—' : p.toFixed(digits);
  };

  // An optimistic open has no engine id yet; its stake is already committed, so it counts.
  const live = activePosition && activePosition.phase !== 'settling' ? activePosition : null;
  const floatingCents = live ? live.livePnlCents : 0;
  const { balanceCents, equityCents, marginCents, freeMarginCents, marginLevelPct } = accountSummary({
    balanceCents: (wallet?.real ?? 0) + (wallet?.bonus ?? 0),
    openStakeCents: live ? live.stakeCents : 0,
    floatingPnlCents: floatingCents,
  });

  const { data: history } = useQuery({
    queryKey: ['positions', 'toolbox'],
    queryFn: () => api.positions(token!, { limit: 25 }),
    enabled: Boolean(token) && open && tab === 'history',
    staleTime: 15_000,
  });

  const rows = useMemo(() => history?.items ?? [], [history]);

  return (
    <div className="shrink-0 overflow-hidden rounded-xl border border-[#2a2e39] bg-[#1b2029] text-[#d1d4dc]">
      {/* The account line is the toggle, and it is the ONLY place these figures appear — rendering
          them again inside the open panel just said the same thing twice. Collapsed it is a single
          scrolling row so the chart keeps its height on a phone; open, it wraps to MetaTrader's
          full five. The chevron sits outside the scrolling area, or it rides off the right edge. */}
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
              ? 'grid grid-cols-2 sm:grid-cols-3'
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
          {live ? <span className="rounded bg-[#2962ff]/20 px-1.5 py-0.5 text-[10px] font-semibold text-[#2962ff]">1 open</span> : null}
          <span className={cn('text-[#787b86] transition', open && 'rotate-180')} aria-hidden>▾</span>
        </span>
      </button>

      {open ? (
        <div className="border-t border-[#2a2e39]">
          <div className="flex items-center gap-1 border-b border-[#2a2e39] px-2 py-1">
            <TabButton on={tab === 'trade'} onClick={() => setTab('trade')}>Trade</TabButton>
            <TabButton on={tab === 'history'} onClick={() => setTab('history')}>History</TabButton>
            <span className="ml-auto pr-1 text-[10px] text-[#787b86]">
              {status === 'open' ? 'Live' : status === 'connecting' ? 'Syncing' : 'Offline'}
            </span>
          </div>

          <div className="max-h-56 overflow-y-auto">
            {tab === 'trade' ? (
              live ? (
                <Table head={['Symbol', 'Ticket', 'Time', 'Type', 'Volume', 'Price', 'S / L', 'T / P', 'Price', 'Profit']}>
                  <Row
                    cells={[
                      market?.instrument.symbol ?? '—',
                      live.positionId ? live.positionId.slice(0, 8) : '…',
                      live.expiresAtMs ? clock(live.expiresAtMs - live.durationS * 1000) : '—',
                      live.direction === 'buy' ? 'buy' : 'sell',
                      lotsOfStake(live.stakeCents),
                      px(live.entryRate),
                      // Stops do not exist on a fixed-expiry contract. MetaTrader leaves them blank
                      // when unset, so a dash is the faithful rendering, not a placeholder.
                      '—',
                      '—',
                      px(getLastTick()?.rate ?? null),
                      money.fmt(live.livePnlCents),
                    ]}
                    tone={live.livePnlCents > 0 ? 'up' : live.livePnlCents < 0 ? 'down' : undefined}
                  />
                </Table>
              ) : (
                <Empty>No open positions.</Empty>
              )
            ) : rows.length > 0 ? (
              <Table head={['Symbol', 'Ticket', 'Time', 'Type', 'Volume', 'Price', 'Close', 'Profit']}>
                {rows.map((p: PositionDto) => (
                  <Row
                    key={p.id}
                    cells={[
                      market?.instrument.symbol ?? '—',
                      p.id.slice(0, 8),
                      clock(p.openedAt),
                      p.direction,
                      lotsOfStake(p.stakeCents),
                      px(p.entryRate),
                      px(p.exitRate),
                      p.pnlCents === null ? '—' : money.fmt(p.pnlCents),
                    ]}
                    tone={p.pnlCents === null ? undefined : p.pnlCents > 0 ? 'up' : p.pnlCents < 0 ? 'down' : undefined}
                  />
                ))}
              </Table>
            ) : (
              <Empty>{token ? 'No closed trades yet.' : 'Sign in to see your trade history.'}</Empty>
            )}
          </div>
        </div>
      ) : null}
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
      <span className="text-[10px] uppercase tracking-wide text-[#787b86]">{label}</span>
      <span className={cn('font-mono text-[12px] font-semibold tabular-nums', tone === 'up' ? 'text-[#089981]' : tone === 'down' ? 'text-[#f23645]' : 'text-[#d1d4dc]')}>{value}</span>
    </span>
  );
}

function TabButton({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      className={cn('rounded px-2 py-1 text-[11px] font-semibold transition', on ? 'bg-[#2a2e39] text-white' : 'text-[#787b86] hover:text-white')}
    >
      {children}
    </button>
  );
}

function Table({ head, children }: { head: string[]; children: React.ReactNode }) {
  return (
    <table className="w-full border-collapse text-left font-mono text-[11px] tabular-nums">
      <thead>
        <tr className="text-[#787b86]">
          {head.map((h) => (
            <th key={h} className="whitespace-nowrap px-2 py-1 font-normal">{h}</th>
          ))}
        </tr>
      </thead>
      <tbody>{children}</tbody>
    </table>
  );
}

function Row({ cells, tone }: { cells: Array<string | number>; tone?: 'up' | 'down' | undefined }) {
  return (
    <tr className="border-t border-[#2a2e39]/60">
      {cells.map((c, i) => (
        <td
          key={i}
          className={cn(
            'whitespace-nowrap px-2 py-1',
            // The profit column is the last one, and is the only one that carries colour.
            i === cells.length - 1 && tone === 'up' && 'font-semibold text-[#089981]',
            i === cells.length - 1 && tone === 'down' && 'font-semibold text-[#f23645]',
          )}
        >
          {c}
        </td>
      ))}
    </tr>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="px-3 py-4 text-center text-[11px] text-[#787b86]">{children}</div>;
}
