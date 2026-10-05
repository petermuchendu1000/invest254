'use client';

import { useEffect, useState } from 'react';
import { lotsOfStake } from '@invest254/shared/account';
import { useDisplayMoney } from '@/lib/money';
import { useGameSocket } from '@/lib/game/GameSocketProvider';
import { cn } from '@/lib/cn';
import type { ActivePosition } from '@/lib/game/betting';

/**
 * The open position, as MetaTrader shows one.
 *
 * The MT5 order ticket used to hand this job to `LivePnl` — the classic shell's card, with its
 * rounded pill, its "Live P&L" heading and its coloured progress bar. On a terminal that is the one
 * panel still speaking the old product's language, directly under a MetaTrader ticket.
 *
 * MetaTrader states a position as a line of identity (symbol, side, volume) over label/value rows,
 * with the profit as the one large figure, and it uses blue for a buy and red for a sell rather than
 * green/red for up/down. The expiry countdown has no MetaTrader equivalent — nothing in MT5 closes
 * itself on a timer — so it is stated plainly as a row rather than dressed as a progress bar.
 */
export function MT5LivePosition({ pos, symbol }: { pos: ActivePosition; symbol: string }) {
  const money = useDisplayMoney();
  const { sell, earlyCloseEnabled } = useGameSocket();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(id);
  }, []);

  const totalMs = pos.durationS * 1000;
  const remainingMs = pos.expiresAtMs ? Math.max(0, pos.expiresAtMs - now) : totalMs;
  const progress = totalMs > 0 ? Math.min(1, Math.max(0, 1 - remainingMs / totalMs)) : 0;
  const secs = Math.ceil(remainingMs / 1000);
  const isBuy = pos.direction === 'buy';
  const side = isBuy ? '#3183ff' : '#f23645';
  const pnl = pos.livePnlCents;
  // MetaTrader paints a profit BLUE and a loss RED. Not green: green in MT5 belongs to a rising
  // candle, and using it for money made the one figure a trader reads say "casino win" rather than
  // "position in profit". The Trade tab, the Toolbox and this card now agree.
  const pnlTone = pnl > 0 ? 'text-[#3183ff]' : pnl < 0 ? 'text-[#f23645]' : 'text-white';

  const state =
    pos.phase === 'pending' ? 'Opening…' : pos.phase === 'settling' ? 'Closing…' : `${secs}s`;

  // MetaTrader closes a position from the position itself, so the control belongs here. It is shown
  // only where the engine will honour it (see `earlyCloseEnabled`), and it says why it cannot be
  // pressed rather than sitting there greyed and silent.
  const closable = pos.phase === 'open' && pos.sellable && !!pos.positionId;
  const closeWhy = pos.phase === 'settling'
    ? 'Closing…'
    : !pos.sellable
      ? 'Closes at expiry'
      : 'Close position';

  return (
    <div className="flex flex-col gap-2">
      {/* Identity, the way MetaTrader heads a position: symbol, then side and volume in the side's
          own colour. */}
      <div className="flex items-baseline justify-between gap-2">
        <span className="truncate text-[13px] font-bold text-white">{symbol}</span>
        <span className="shrink-0 font-mono text-[12px] font-semibold uppercase" style={{ color: side }}>
          {pos.direction} {lotsOfStake(pos.stakeCents)}
        </span>
      </div>

      {/* The profit, which is the number a trader is actually watching. */}
      <div className="flex items-end justify-between gap-2">
        <span className="text-[10px] uppercase tracking-wide text-[#8fa2b8]">Profit</span>
        <span className={cn('font-mono text-[22px] font-semibold leading-none tabular-nums', pnlTone)}>
          {pnl > 0 ? '+' : ''}{money.fmt(pnl)}
        </span>
      </div>

      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 font-mono text-[11px] tabular-nums">
        <Row label="Volume" value={lotsOfStake(pos.stakeCents)} />
        <Row label="Stake" value={money.fmt(pos.stakeCents)} />
        <Row label="Multiplier" value={`×${pos.liveMultiplier.toFixed(2)}`} />
        <Row label="Expires in" value={state} />
      </dl>

      {/* A one-pixel rule rather than a coloured bar: it is chrome telling the time, and MetaTrader
          does not decorate a position with a progress meter. */}
      <div className="h-px w-full bg-[#2b3543]">
        <div
          className="h-px transition-[width] duration-100 ease-linear"
          style={{ width: `${progress * 100}%`, background: side }}
        />
      </div>
      {earlyCloseEnabled ? (
        <button
          type="button"
          onClick={sell}
          disabled={!closable}
          title={pos.sellable ? 'Close this position at the current price' : 'This contract settles at expiry'}
          className="h-9 w-full rounded-sm border border-[#2b3543] bg-[#202933] text-[12px] font-semibold text-white transition hover:border-[#3183ff] disabled:cursor-not-allowed disabled:opacity-40"
        >
          {closeWhy}
        </button>
      ) : null}
      <p className="text-[10px] text-[#8fa2b8]">
        {earlyCloseEnabled
          ? 'Market execution. Left alone, it closes itself at expiry.'
          : 'Closes automatically at expiry: market execution.'}
      </p>
      {/* MetaTrader's S/L, stated rather than offered. The engine settles a losing contract at
          expiry and will not close one early, so the stop is fixed at the stake: that is the most
          this position can lose, whatever happens to the price. */}
      <p className="text-[10px] text-[#8fa2b8]">
        Max loss {money.fmt(pos.stakeCents)} (the stake). This contract cannot lose more.
      </p>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt className="text-[#8fa2b8]">{label}</dt>
      <dd className="text-right text-white">{value}</dd>
    </>
  );
}
