'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { centsToKes, kesToCents } from '@invest254/shared/money';
import type { Direction } from '@invest254/shared';
import { cn } from '@/lib/cn';
import { api } from '@/lib/api/endpoints';
import { useBrand } from '@/lib/brand/BrandProvider';
import { useSession } from '@/lib/auth/session';
import { useWallet } from '@/lib/wallet/hooks';
import { useDepositUi } from '@/lib/wallet/depositUi';
import { useHydrated } from '@/lib/useHydrated';
import { useDisplayMoney } from '@/lib/money';
import { useStakeLimits } from '@/lib/game/useStakeLimits';
import { useGameSocket } from '@/lib/game/GameSocketProvider';
import { isContinuousBrand } from '@/lib/game/levelWatch';
import { LivePnl } from '@/components/game/LivePnl';
import { useLivePrice } from '@/components/game/candlestick/useLivePrice';

/**
 * The candlestick screen's order entry, laid out exactly as the mock lays it out: the two sides,
 * an amount and a stop beside each other, the brand's range under them, four quick stakes, a
 * summary block, and the refusal line.
 *
 * It is NOT a restyled `BetPanel` and not MetaTrader's ticket. The three are different arrangements
 * of the same trade, and the rules that decide what a tap DOES are the ones `BetPanel` carries,
 * copied here deliberately rather than shared through a hook: a logged-out tap is buying intent and
 * opens the deposit sheet seeded with the stake; a short balance does the same; one tap is one
 * trade. Those three rules are the money path, so they are written where they can be read.
 *
 * The contract is the brand's own: stake, direction and the brand's default duration. The mock has
 * no expiry control and neither does this, which is why the duration is read from `/game/config`
 * rather than offered — a screen that silently changed the contract would not be a UI change.
 */
export function TradingPanel({ className }: { className?: string }) {
  const hydrated = useHydrated();
  const brand = useBrand();
  const token = useSession((s) => s.token);
  const openDeposit = useDepositUi((s) => s.openDeposit);
  const { data: wallet } = useWallet();
  const { both, symbol, isForeign, toKesCents, toDisplay } = useDisplayMoney();
  const limits = useStakeLimits();
  const { status, activePosition, openPosition, sell, earlyCloseEnabled } = useGameSocket();
  const { data: config } = useQuery({
    queryKey: ['gameConfig', brand.slug],
    queryFn: () => api.gameConfig(brand.slug),
    staleTime: 5 * 60_000,
  });

  const [stake, setStake] = useState('');
  const [stopLoss, setStopLoss] = useState('');

  /**
   * Seed the amount with the brand's minimum ONCE, when the limits land.
   *
   * Re-seeding whenever the field is empty turns "select all, type 200" into "50200" — the field is
   * briefly empty mid-edit. `BetPanel` carries the same guard for the same reported bug.
   */
  const seeded = useRef(false);
  useEffect(() => {
    if (seeded.current || !limits.ready) return;
    seeded.current = true;
    setStake((s) => (s === '' ? String(limits.min) : s));
  }, [limits.ready, limits.min]);

  const stakeCents = useMemo(() => {
    const n = Number.parseFloat(stake);
    if (!Number.isFinite(n) || n <= 0) return NaN;
    return isForeign ? toKesCents(n) : kesToCents(n);
  }, [stake, isForeign, toKesCents]);

  const minCents = limits.minCents;
  const maxCents = limits.maxCents;
  // Bonus funds are stakeable (bonus-first, migration 0094), so affordability counts real + bonus.
  const spendable = (wallet?.real ?? 0) + (wallet?.bonus ?? 0);
  const validStake = Number.isInteger(stakeCents) && stakeCents >= minCents;
  const overMax = maxCents !== undefined && Number.isFinite(stakeCents) && stakeCents > maxCents;
  const overBalance = !!token && Number.isFinite(stakeCents) && stakeCents > spendable;
  const connecting = status !== 'open';

  /**
   * Can a stop actually be honoured on this brand?
   *
   * The engine holds protective levels as PRICES and fires them on its own tick. It has no money
   * stop, and deriving a price from a shilling figure would be new game math, which this change is
   * not. So the field is drawn exactly as the mock draws it and is disabled where it would do
   * nothing, with the reason on it, rather than accepting a figure nothing would ever act on.
   */
  const stopSupported = isContinuousBrand({ chartStyle: brand.chartStyle, earlyCloseEnabled });

  const chips = limits.ladder.slice(0, 4);
  const durationS = config?.defaultDurationS ?? 10;

  const refusal = (() => {
    if (!Number.isFinite(stakeCents)) return null;
    if (!validStake) return `Minimum stake is ${both(minCents)}`;
    if (overMax && maxCents !== undefined) return `Maximum stake is ${both(maxCents)}`;
    return null;
  })();

  function place(direction: Direction) {
    if (!validStake || overMax || connecting || activePosition) return;
    // A logged-out tap is real buying intent: open the deposit sheet seeded with this stake (it
    // routes through sign-up/login and resumes), so funding leads rather than a login wall.
    if (!token || overBalance) {
      openDeposit({ amountCents: stakeCents, pending: { direction, stakeCents } });
      return;
    }
    // One tap = one trade. The stake is explicit on screen and the position is closeable, so a
    // confirmation step would only add measurable drop-off.
    openPosition({ stakeCents, direction, durationS });
  }

  const money = (cents: number) => (isForeign ? `${symbol} ${toDisplay(cents).toFixed(2)}` : `KSh ${centsToKes(cents).toFixed(2)}`);

  return (
    <div className={cn('flex h-full w-full flex-col bg-[#111827] p-4', className)}>
      <div className="mb-4 hidden items-center justify-start text-sm font-bold text-white sm:flex">
        Trading Panel
        <span className="mx-1 text-xs font-normal text-gray-400">({(brand.currency ?? 'KES').toUpperCase()})</span>
      </div>

      {/* The two sides. Disabled while a contract is in flight: this brand opens one at a time. */}
      <div className="mb-5 flex gap-2">
        <button
          type="button"
          disabled={connecting || !!activePosition}
          onClick={() => place('buy')}
          className="h-11 flex-1 rounded-lg bg-[#16a34a] text-sm font-bold tracking-wide text-white transition-colors hover:bg-[#15803d] disabled:cursor-not-allowed disabled:opacity-50"
        >
          BUY
        </button>
        <button
          type="button"
          disabled={connecting || !!activePosition}
          onClick={() => place('sell')}
          className="h-11 flex-1 rounded-lg bg-[#7f2d2d] text-sm font-bold tracking-wide text-white transition-colors hover:bg-[#991b1b] disabled:cursor-not-allowed disabled:opacity-50"
        >
          SELL
        </button>
      </div>

      <div className="mb-1 grid grid-cols-2 gap-3">
        <div>
          <span className="mb-2 block text-xs uppercase tracking-wider text-gray-400">Trade Amount</span>
          <div className="relative">
            <div className="absolute left-3 top-1/2 -translate-y-1/2 font-bold text-gray-400">{isForeign ? symbol : 'KSh'}</div>
            <input
              inputMode="decimal"
              value={stake}
              onChange={(e) => setStake(e.target.value.replace(/[^\d.]/g, ''))}
              className={cn(
                'h-11 w-full rounded-lg border bg-[#0a0f1c] pl-12 pr-3 text-sm font-bold text-white outline-none',
                refusal ? 'border-red-500' : 'border-[#374151] focus:border-[#22c55e]',
              )}
            />
          </div>
        </div>
        <div>
          <span className="mb-2 block text-xs uppercase tracking-wider text-gray-400">Stop Loss</span>
          <div className="relative">
            <div className="absolute left-3 top-1/2 -translate-y-1/2 font-bold text-gray-400">{isForeign ? symbol : 'KSh'}</div>
            <input
              inputMode="decimal"
              value={stopLoss}
              disabled={!stopSupported}
              title={stopSupported ? undefined : 'This contract settles at expiry, so a stop has nothing to close early.'}
              onChange={(e) => setStopLoss(e.target.value.replace(/[^\d.]/g, ''))}
              placeholder="Optional"
              className="h-11 w-full rounded-lg border border-[#374151] bg-[#0a0f1c] pl-12 pr-3 text-sm font-bold text-white outline-none placeholder:font-normal placeholder:text-gray-500 focus:border-[#22c55e] disabled:cursor-not-allowed disabled:opacity-60"
            />
          </div>
        </div>
      </div>

      {/* The brand's own range, under the fields, exactly where the mock puts it. */}
      <div className="mb-4 text-xs text-gray-500">
        {limits.ready ? `${money(minCents)} – ${maxCents !== undefined ? money(maxCents) : '∞'}` : ' '}
      </div>

      {/* Four quick stakes off the brand's ladder — the mock's four columns. */}
      <div className="mb-5 grid grid-cols-4 gap-1">
        {chips.map((v) => {
          const active = Number.parseFloat(stake) === v;
          return (
            <button
              key={v}
              type="button"
              onClick={() => setStake(String(v))}
              className={cn(
                'h-9 rounded-lg border text-sm font-medium transition-colors',
                active
                  ? 'border-[#22c55e] bg-[#22c55e] text-black'
                  : 'border-[#374151] bg-[#1f2937] text-white hover:border-[#4b5563]',
              )}
            >
              {isForeign ? symbol : 'KSh'} {v.toLocaleString()}
            </button>
          );
        })}
      </div>

      {/*
        The summary block, pinned to the bottom of the panel (`mt-auto`) as the mock pins it. While a
        contract is in flight it carries that contract instead: the mock has no in-flight state, and
        inventing a second surface for it would hide the one thing a trader is watching.
      */}
      <div className="mt-auto space-y-2 rounded-lg bg-[#1f2937] p-4">
        {activePosition ? (
          <>
            <LivePnl pos={activePosition} />
            {earlyCloseEnabled ? (
              <button
                type="button"
                disabled={!(activePosition.phase === 'open' && activePosition.sellable && activePosition.positionId)}
                onClick={() => sell()}
                className="h-10 w-full rounded-lg bg-[#374151] text-sm font-bold text-white transition-colors hover:bg-[#4b5563] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {activePosition.phase === 'settling' ? 'Closing…' : 'Close Trade'}
              </button>
            ) : null}
          </>
        ) : (
          <>
            <div className="flex justify-between text-sm">
              <span className="text-gray-400">Live Price</span>
              <LivePriceReadout />
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-400">Stake</span>
              <span className="font-bold text-white">{Number.isFinite(stakeCents) ? money(stakeCents) : '—'}</span>
            </div>
          </>
        )}
      </div>

      {/* The mock's refusal line. Present only when there is something to refuse. */}
      {hydrated && refusal ? (
        <div className="mt-3 rounded border border-red-900/50 bg-red-500/10 p-2.5 text-center text-xs text-red-400">
          {refusal}
        </div>
      ) : null}
    </div>
  );
}

/**
 * The live price, in its own component so a price moving several times a second re-renders one
 * `<span>` rather than the whole panel — the amount field a trader is mid-way through typing into
 * is in this tree.
 */
function LivePriceReadout() {
  const { tick, priceOfRate, digits } = useLivePrice();
  const price = priceOfRate(tick?.rate);
  return <span className="font-mono text-[#22c55e]">{price === null ? '—' : price.toFixed(digits)}</span>;
}
