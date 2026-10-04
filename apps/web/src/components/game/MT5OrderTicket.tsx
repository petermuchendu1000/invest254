'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { Direction } from '@invest254/shared';
import { valueOfRate } from '@invest254/shared/candles';
import { LOT_STAKE_CENTS } from '@invest254/shared/account';
import { useGameSocket, useGameSocketApi } from '@/lib/game/GameSocketProvider';
import { useStakeLimits } from '@/lib/game/useStakeLimits';
import { useDisplayMoney } from '@/lib/money';
import { useSession } from '@/lib/auth/session';
import { useWallet } from '@/lib/wallet/hooks';
import { useDepositUi } from '@/lib/wallet/depositUi';
import { useHydrated } from '@/lib/useHydrated';
import { useBrand } from '@/lib/brand/BrandProvider';
import { api } from '@/lib/api/endpoints';
import { MT5LivePosition } from '@/components/game/MT5LivePosition';
import { useTakeProfitStore } from '@/lib/game/takeprofit';
import { MT5Price } from '@/components/game/MT5Price';
import { cn } from '@/lib/cn';

/**
 * MetaTrader's order ticket, for the candlestick terminal.
 *
 * Modelled on the real thing: volume on a `− value + +` stepper, the execution mode stated, and two
 * full-width quote buttons — SELL on the left in RED, BUY on the right in BLUE. The blue/red pair is
 * MetaTrader's, not a styling choice: every MT5 screen uses blue for the buy side, and the green/red
 * the rest of this app uses would read as a different product entirely.
 *
 * WHAT IS NOT MetaTrader, and why:
 *
 *  - ONE price, on both buttons. MetaTrader puts the bid on SELL and the ask on BUY. There is no
 *    spread here — a contract settles on one seeded price — so printing two different numbers would
 *    tell the player they buy at one and sell at the other, which is false.
 *  - An EXPIRY row. MetaTrader positions run until closed; these contracts settle at a fixed
 *    duration, so the control exists and is labelled for what it is.
 *
 * Volume is the brand's stake in lots. The stake, the limits, the deposit routing and the open call
 * are the existing ones — this is the same order the old panel placed, wearing MetaTrader's controls.
 */

const DURATION_OPTIONS = [10, 30, 60, 120];
/** MetaTrader's own volume increments, offered as the two "+" buttons. */
const VOLUME_STEPS = [0.01, 0.1] as const;

export function MT5OrderTicket() {
  const hydrated = useHydrated();
  const brand = useBrand();
  const token = useSession((s) => s.token);
  const openDeposit = useDepositUi((s) => s.openDeposit);
  const money = useDisplayMoney();
  const limits = useStakeLimits();
  const { data: wallet } = useWallet();
  const { status, activePosition, openPosition } = useGameSocket();
  const { getLastTick, getMarket } = useGameSocketApi();
  const { data: config } = useQuery({
    queryKey: ['gameConfig', brand.slug],
    queryFn: () => api.gameConfig(brand.slug),
    staleTime: 5 * 60_000,
  });

  const defaultDurationS = config?.defaultDurationS ?? 10;
  const [durationS, setDurationS] = useState<number>(defaultDurationS);
  useEffect(() => { setDurationS(defaultDurationS); }, [defaultDurationS]);

  // Quote updates ride the tick stream, which does not re-render React on its own.
  const [, force] = useState(0);
  useEffect(() => {
    const id = setInterval(() => force((n) => (n + 1) % 1_000_000), 250);
    return () => clearInterval(id);
  }, []);

  const market = getMarket();
  const digits = market?.instrument.digits ?? 2;
  const symbol = market?.instrument.symbol ?? 'XAUUSD';
  const tick = getLastTick();
  const price = market && tick
    ? market.anchor.base + market.instrument.scale * (valueOfRate(tick.rate) - market.anchor.openValue)
    : null;

  // ── Volume ─────────────────────────────────────────────────────────────────────────────────────
  // Lots are the stake divided by the contract size. The brand's MINIMUM is the floor, so the
  // smallest selectable volume is whatever that minimum is worth — exactly how MetaTrader derives a
  // symbol's minimum volume — rather than a round number that would sit under it.
  const minLots = limits.minCents / LOT_STAKE_CENTS;
  // A brand may set no ceiling; the wallet is then the only limit, so volume is left open.
  const maxLots = (limits.maxCents ?? Number.MAX_SAFE_INTEGER) / LOT_STAKE_CENTS;
  // If the minimum is not a whole number of 0.01 lots, show the extra decimal rather than print a
  // rounded volume that does not match the stake actually sent.
  const volDigits = Math.abs(minLots * 100 - Math.round(minLots * 100)) < 1e-9 ? 2 : 3;
  const [lots, setLots] = useState<number>(minLots);
  const seeded = useRef(false);
  useEffect(() => {
    if (seeded.current || !limits.ready) return;
    seeded.current = true;
    setLots(minLots);
  }, [limits.ready, minLots]);

  const clampLots = (v: number): number => {
    const snapped = Number(v.toFixed(volDigits));
    return Math.min(maxLots, Math.max(minLots, snapped));
  };
  const bump = (delta: number) => setLots((v) => clampLots(v + delta));

  const stakeCents = Math.round(lots * LOT_STAKE_CENTS);
  const spendable = (wallet?.real ?? 0) + (wallet?.bonus ?? 0);
  const overBalance = !!token && stakeCents > spendable;
  const connecting = status !== 'open';
  // S/L and T/P sit on the ticket in MetaTrader, so they sit here. The target is shared with the
  // Toolbox row, which modifies it on an open contract exactly as MetaTrader does.
  const tpTarget = useTakeProfitStore((st) => st.targetCents);
  const setTp = useTakeProfitStore((st) => st.set);
  const tpStepCents = Math.max(10_000, Math.round(limits.minCents / 2)); // half the minimum stake
  const bumpTp = (dir: 1 | -1) => {
    const next = (tpTarget ?? 0) + dir * tpStepCents;
    setTp(next <= 0 ? null : next);
  };

  const durations = useMemo(
    () => Array.from(new Set([...DURATION_OPTIONS, defaultDurationS])).sort((a, b) => a - b),
    [defaultDurationS],
  );

  function place(dir: Direction) {
    if (connecting) return;
    // A logged-out or short-funded tap is real buying intent: route it to the deposit sheet seeded
    // with this stake, which then resumes the trade. Same behaviour as the classic panel.
    if (!token || overBalance) {
      openDeposit({ amountCents: stakeCents, pending: { direction: dir, stakeCents } });
      return;
    }
    openPosition({ stakeCents, direction: dir, durationS });
  }

  if (!hydrated) {
    return <div className="h-40 animate-pulse rounded-xl border border-[#2b3543] bg-[#0f1720]" />;
  }

  if (activePosition) {
    return (
      <div className="flex flex-col gap-2 rounded border border-[#2b3543] bg-[#0f1720] p-3 text-[#ffffff]">
        <MT5LivePosition pos={activePosition} symbol={symbol} />
      </div>
    );
  }

  const rowLabel = 'w-16 shrink-0 text-[11px] uppercase tracking-wide text-[#8fa2b8] lg:w-auto lg:basis-full';
  const stepBtn = 'h-8 min-w-11 lg:min-w-0 shrink-0 rounded border border-[#2b3543] bg-[#0f1720] px-2 font-mono text-[12px] font-semibold text-[#ffffff] transition hover:border-[#3183ff] disabled:opacity-40';

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-[#2b3543] bg-[#0f1720] p-3 text-[#ffffff]">
      <div className="flex items-baseline gap-2">
        <span className="text-[13px] font-bold text-white">{symbol}</span>
        {/* MetaTrader states the execution mode on the ticket. Ours fills at the next engine tick. */}
        <span className="text-[11px] text-[#8fa2b8]">Market Execution</span>
      </div>

      {/* Volume — MetaTrader's stepper row. */}
      <div className="flex flex-wrap items-center gap-1.5">
        <span className={rowLabel}>Volume</span>
        <button type="button" onClick={() => bump(-VOLUME_STEPS[0])} disabled={lots <= minLots} className={stepBtn} aria-label="Decrease volume">−0.01</button>
        <span className="flex h-8 min-w-[4rem] flex-1 basis-16 items-center justify-center rounded border border-[#2b3543] bg-[#0f1720] font-mono text-[14px] font-bold text-white tabular-nums">
          {lots.toFixed(volDigits)}
        </span>
        {VOLUME_STEPS.map((s) => (
          <button key={s} type="button" onClick={() => bump(s)} disabled={lots >= maxLots} className={stepBtn} aria-label={`Increase volume by ${s}`}>
            +{s}
          </button>
        ))}
      </div>
      <div className="flex items-baseline gap-2 pl-[4.25rem] text-[11px] text-[#8fa2b8] lg:pl-0">
        <span>= {money.fmt(stakeCents)}</span>
        <span className="ml-auto">min {minLots.toFixed(volDigits)}{limits.maxCents === undefined ? '' : ` / max ${maxLots.toFixed(volDigits)}`}</span>
      </div>

      {/* S/L and T/P, as MetaTrader's "− value +" rows rather than free-text fields. */}
      <div className="flex flex-wrap items-center gap-1.5">
        <span className={rowLabel}>S / L</span>
        {/* Present and visibly disabled. The engine refuses to close a losing contract early by
            design, so a stop is not implementable without changing the money path — and the most
            this contract can lose is its stake, always. A control that silently did nothing would
            be worse than one that explains itself. */}
        <span
          className="flex h-8 flex-1 cursor-not-allowed items-center justify-center rounded border border-[#2b3543] bg-[#0f1720]/60 text-[11px] text-[#8fa2b8]/50"
          title="No stop loss: this contract settles at expiry and the most it can lose is the stake."
        >
          not available — max loss is the stake
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className={rowLabel}>T / P</span>
        <button type="button" onClick={() => bumpTp(-1)} disabled={tpTarget === null} className={stepBtn} aria-label="Lower take profit">−</button>
        <span className="flex h-8 min-w-[4.5rem] flex-1 items-center justify-center rounded border border-[#2b3543] bg-[#0f1720] font-mono text-[12px] font-semibold text-[#ffffff] tabular-nums">
          {tpTarget === null ? 'none' : money.fmt(tpTarget)}
        </span>
        <button type="button" onClick={() => bumpTp(1)} className={stepBtn} aria-label="Raise take profit">+</button>
      </div>
      <p className="pl-[4.25rem] text-[11px] text-[#8fa2b8] lg:pl-0">
        Closes on PROFIT reaching this amount — not a price, because an open contract&apos;s payout rises with time.
      </p>

      {/* Expiry — not a MetaTrader control, because a MetaTrader position has no expiry. Ours does. */}
      <div className="flex flex-wrap items-center gap-1.5">
        <span className={rowLabel}>Expiry</span>
        <div className="flex flex-1 gap-1">
          {durations.map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => setDurationS(d)}
              aria-pressed={durationS === d}
              className={cn(
                'h-8 flex-1 rounded border text-[12px] font-semibold transition',
                durationS === d ? 'border-[#3183ff] bg-[#3183ff]/15 text-white' : 'border-[#2b3543] bg-[#0f1720] text-[#8fa2b8] hover:text-white',
              )}
            >
              {d < 60 ? `${d}s` : `${d / 60}m`}
            </button>
          ))}
        </div>
      </div>

      {/* The quote buttons. SELL red, BUY blue — MetaTrader's pairing. */}
      <div className="mt-0.5 grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => place('sell')}
          disabled={connecting}
          className="flex h-16 flex-col items-center justify-center rounded-md bg-[#e8403a] text-white transition active:brightness-90 disabled:opacity-50"
        >
          <span className="text-[11px] font-semibold uppercase tracking-wider opacity-90">Sell</span>
          <MT5Price value={price} digits={digits} tone="sell" className="text-[13px]" />
        </button>
        <button
          type="button"
          onClick={() => place('buy')}
          disabled={connecting}
          className="flex h-16 flex-col items-center justify-center rounded-md bg-[#3183ff] text-white transition active:brightness-90 disabled:opacity-50"
        >
          <span className="text-[11px] font-semibold uppercase tracking-wider opacity-90">Buy</span>
          <MT5Price value={price} digits={digits} tone="buy" className="text-[13px]" />
        </button>
      </div>

      {connecting ? <p className="text-center text-[11px] text-[#8fa2b8]">Connecting…</p> : null}
      {overBalance && token ? (
        <p className="text-center text-[11px] text-[#f0b90b]">Not enough free margin — tap a side to top up.</p>
      ) : null}
    </div>
  );
}
