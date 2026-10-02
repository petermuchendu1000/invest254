'use client';

import { useCallback, useEffect, useState } from 'react';
import { valueOfRate, type Candle } from '@invest254/shared/candles';
import { LOT_STAKE_CENTS } from '@invest254/shared/account';
import { useGameSocket, useGameSocketApi } from '@/lib/game/GameSocketProvider';
import { useDisplayMoney } from '@/lib/money';
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

type Tab = 'symbols' | 'details';

export function MarketWatch({ className }: { className?: string }) {
  const { getLastTick, getMarket, requestCandles } = useGameSocketApi();
  const { status } = useGameSocket();
  const money = useDisplayMoney();
  const [tab, setTab] = useState<Tab>('symbols');
  const [day, setDay] = useState<Candle | null>(null);
  const [, force] = useState(0);

  // Quote updates come off the tick stream, which does not re-render React on its own.
  useEffect(() => {
    const id = setInterval(() => force((n) => (n + 1) % 1_000_000), 300);
    return () => clearInterval(id);
  }, []);

  // The session figures are the current D1 bar — the same bar the chart's D1 period shows.
  useEffect(() => {
    let cancelled = false;
    const load = () => {
      requestCandles('D1', 1)
        .then((r) => { if (!cancelled && r.bars.length) setDay(r.bars[r.bars.length - 1]!); })
        .catch(() => { /* the panel shows dashes until a reply lands */ });
    };
    load();
    const id = setInterval(load, 60_000);
    return () => { cancelled = true; clearInterval(id); };
  }, [requestCandles]);

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
  // Change against the session open, which is what a terminal's change column means.
  const open = market?.anchor.base ?? null;
  const changePct = last !== null && open ? ((last - open) / open) * 100 : null;
  const up = (changePct ?? 0) >= 0;
  const show = (n: number | null | undefined) => (n === null || n === undefined ? '—' : n.toFixed(digits));

  return (
    <aside className={cn('flex flex-col overflow-hidden rounded-xl border border-[#2a2e39] bg-[#1b2029] text-[#d1d4dc]', className)}>
      <div className="flex items-center gap-2 border-b border-[#2a2e39] px-3 py-2">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-[#787b86]">Market Watch</span>
        <span
          className={cn('ml-auto h-1.5 w-1.5 rounded-full', status === 'open' ? 'bg-[#089981]' : status === 'connecting' ? 'bg-[#f0b90b]' : 'bg-[#f23645]')}
          title={status === 'open' ? 'Live' : status === 'connecting' ? 'Syncing' : 'Offline'}
        />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {tab === 'symbols' ? (
          <table className="w-full border-collapse text-left font-mono text-[11px] tabular-nums">
            <thead>
              <tr className="text-[#787b86]">
                <th className="px-2 py-1 font-normal">Symbol</th>
                <th className="px-2 py-1 text-right font-normal">Last</th>
                <th className="px-2 py-1 text-right font-normal">Chg %</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-t border-[#2a2e39]/60">
                <td className="px-2 py-1 font-semibold text-white">{symbol}</td>
                <td className={cn('px-2 py-1 text-right font-semibold', up ? 'text-[#089981]' : 'text-[#f23645]')}>{show(last)}</td>
                <td className={cn('px-2 py-1 text-right', up ? 'text-[#089981]' : 'text-[#f23645]')}>
                  {changePct === null ? '—' : `${up ? '+' : ''}${changePct.toFixed(2)}`}
                </td>
              </tr>
            </tbody>
          </table>
        ) : (
          <dl className="divide-y divide-[#2a2e39]/50 text-[11px]">
            <Detail label="Symbol" value={symbol} />
            <Detail label="Last" value={show(last)} />
            <Detail label="Session open" value={show(day?.open ?? null)} />
            <Detail label="Session high" value={show(day?.high ?? null)} />
            <Detail label="Session low" value={show(day?.low ?? null)} />
            <Detail label="Digits" value={String(digits)} />
            {/* The contract size behind the Volume column, stated rather than implied. */}
            <Detail label="Contract size" value={`${money.fmt(LOT_STAKE_CENTS)} / lot`} />
            <Detail label="Session" value="00:00–24:00 UTC" />
          </dl>
        )}
      </div>

      {/* MetaTrader's Market Watch tabs sit along the bottom of the panel, as the Toolbox's do. */}
      <div className="flex gap-0.5 border-t border-[#2a2e39] bg-[#171b24] px-1 py-1">
        {(['symbols', 'details'] as Tab[]).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            aria-pressed={tab === t}
            className={cn('rounded px-2 py-0.5 text-[11px] font-semibold capitalize transition', tab === t ? 'bg-[#2a2e39] text-white' : 'text-[#787b86] hover:text-white')}
          >
            {t}
          </button>
        ))}
      </div>
    </aside>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2 px-3 py-1.5">
      <dt className="text-[#787b86]">{label}</dt>
      <dd className="font-mono tabular-nums text-[#d1d4dc]">{value}</dd>
    </div>
  );
}
