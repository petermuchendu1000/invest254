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
import { useCandlestickUi } from '@/components/game/candlestick/ui';

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

  /**
   * Tell the header whether a contract is in flight, so its Real/Demo switch can refuse mid-trade
   * with a reason rather than letting the player try and get a generic failure. The header sits
   * outside GameSocketProvider and cannot see this itself — see the note in ui.ts.
   */
  const setTradeOpen = useCandlestickUi((s) => s.setTradeOpen);
  useEffect(() => {
    setTradeOpen(!!activePosition);
    return () => setTradeOpen(false);
  }, [activePosition, setTradeOpen]);

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
    <div className={cn('flex h-full w-full min-w-0 flex-col bg-[#111827] p-3 sm:p-4', className)}>
      <div className="mb-4 hidden min-w-0 items-center justify-start text-sm font-bold text-white sm:flex">
        Trading Panel
        <span className="mx-1 truncate text-xs font-normal text-gray-400">({(brand.currency ?? 'KES').toUpperCase()})</span>
      </div>

      {/* The two sides. Disabled while a contract is in flight: this brand opens one at a time. */}
      <div className="mb-5 flex gap-2">
        <button
          type="button"
          disabled={connecting || !!activePosition}
          onClick={() => place('buy')}
          className="h-11 min-w-0 flex-1 rounded-lg bg-[#16a34a] text-sm font-bold tracking-wide text-white transition-colors hover:bg-[#15803d] disabled:cursor-not-allowed disabled:opacity-50"
        >
          BUY
        </button>
        <button
          type="button"
          disabled={connecting || !!activePosition}
          onClick={() => place('sell')}
          className="h-11 min-w-0 flex-1 rounded-lg bg-[#7f2d2d] text-sm font-bold tracking-wide text-white transition-colors hover:bg-[#991b1b] disabled:cursor-not-allowed disabled:opacity-50"
        >
          SELL
        </button>
      </div>

      {/*
        Two fields across, as the mock has them. The panel is only ~288px wide at 320px and 320px
        wide in the desktop rail, so each field gets ~140px: the prefix is sized to the tightest of
        those and the input's left padding clears it by a few pixels, where `pl-12` against a 16px
        prefix left almost nothing for a six-digit stake. `min-w-0` on the cells because a grid
        item's `auto` minimum would otherwise let a long value push the column past the rail.
      */}
      <div className="mb-1 grid grid-cols-2 gap-2 sm:gap-3">
        <div className="min-w-0">
          <span className="mb-2 block truncate text-xs uppercase tracking-wider text-gray-400">Trade Amount</span>
          <div className="relative">
            <div className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-xs font-bold text-gray-400">{isForeign ? symbol : 'KSh'}</div>
            <input
              inputMode="decimal"
              value={stake}
              onChange={(e) => setStake(e.target.value.replace(/[^\d.]/g, ''))}
              className={cn(
                'h-11 w-full min-w-0 rounded-lg border bg-[#0a0f1c] pl-10 pr-2.5 text-base font-bold tabular-nums text-white outline-none sm:text-sm',
                refusal ? 'border-red-500' : 'border-[#374151] focus:border-[#22c55e]',
              )}
            />
          </div>
        </div>
        <div className="min-w-0">
          <span className="mb-2 block truncate text-xs uppercase tracking-wider text-gray-400">Stop Loss</span>
          <div className="relative">
            <div className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-xs font-bold text-gray-400">{isForeign ? symbol : 'KSh'}</div>
            <input
              inputMode="decimal"
              value={stopLoss}
              disabled={!stopSupported}
              title={stopSupported ? undefined : 'This contract settles at expiry, so a stop has nothing to close early.'}
              onChange={(e) => setStopLoss(e.target.value.replace(/[^\d.]/g, ''))}
              placeholder="Optional"
              className="h-11 w-full min-w-0 rounded-lg border border-[#374151] bg-[#0a0f1c] pl-10 pr-2.5 text-base font-bold tabular-nums text-white outline-none placeholder:font-normal placeholder:text-gray-500 focus:border-[#22c55e] disabled:cursor-not-allowed disabled:opacity-60 sm:text-sm"
            />
          </div>
        </div>
      </div>

      {/*
        The brand's own range, under the fields, exactly where the mock puts it. A brand whose
        ceiling runs to seven digits makes this string longer than the 288px panel, so it is allowed
        to wrap BETWEEN the two figures and never inside one, and it reserves its line height so the
        ladder below it does not jump when the limits land.
      */}
      <div className="mb-4 flex min-h-4 flex-wrap items-center gap-x-1.5 text-xs text-gray-500">
        {limits.ready ? (
          <>
            <span className="whitespace-nowrap tabular-nums">{money(minCents)}</span>
            <span aria-hidden="true">–</span>
            <span className="whitespace-nowrap tabular-nums">{maxCents !== undefined ? money(maxCents) : '∞'}</span>
          </>
        ) : null}
      </div>

      {/*
        Four quick stakes off the brand's ladder — the mock's four columns.
        The figures are the brand's own and run to five or six digits, which does not fit four
        across a 288–320px panel WITH a currency prefix on each. So the narrowest phones get a 2x2
        grid that keeps the prefix, and from 360px up it is the mock's four columns carrying the bare
        figure — the currency is named by the panel heading, which appears at those same widths.
      */}
      <div className="mb-5 grid grid-cols-2 gap-1 xs:grid-cols-4">
        {chips.map((v) => {
          const active = Number.parseFloat(stake) === v;
          return (
            <button
              key={v}
              type="button"
              onClick={() => setStake(String(v))}
              className={cn(
                'flex h-10 min-w-0 items-center justify-center gap-1 rounded-lg border px-0.5 text-sm font-medium tracking-tight transition-colors xs:text-xs',
                active
                  ? 'border-[#22c55e] bg-[#22c55e] text-black'
                  : 'border-[#374151] bg-[#1f2937] text-white hover:border-[#4b5563]',
              )}
            >
              <span className="xs:hidden">{isForeign ? symbol : 'KSh'}</span>
              <span className="truncate tabular-nums">{v.toLocaleString()}</span>
            </button>
          );
        })}
      </div>

      {/*
        The summary block, pinned to the bottom of the panel (`mt-auto`) as the mock pins it. While a
        contract is in flight it carries that contract instead: the mock has no in-flight state, and
        inventing a second surface for it would hide the one thing a trader is watching.
      */}
      <div className="mt-auto min-w-0 space-y-2 rounded-lg bg-[#1f2937] p-3 sm:p-4">
        {activePosition ? (
          <>
            <LivePnl pos={activePosition} />
            {earlyCloseEnabled ? (
              <button
                type="button"
                disabled={!(activePosition.phase === 'open' && activePosition.sellable && activePosition.positionId)}
                onClick={() => sell()}
                className="h-11 w-full rounded-lg bg-[#374151] text-sm font-bold text-white transition-colors hover:bg-[#4b5563] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {activePosition.phase === 'settling' ? 'Closing…' : 'Close Trade'}
              </button>
            ) : null}
          </>
        ) : (
          <>
            {/* Label fixed, figure allowed to shrink: a six-figure stake is the long half of the
                row, and without `min-w-0` + `truncate` it widened the whole panel instead. */}
            <div className="flex items-baseline justify-between gap-2 text-sm">
              <span className="shrink-0 text-gray-400">Live Price</span>
              <LivePriceReadout />
            </div>
            <div className="flex items-baseline justify-between gap-2 text-sm">
              <span className="shrink-0 text-gray-400">Stake</span>
              <span className="min-w-0 truncate font-bold tabular-nums text-white">{Number.isFinite(stakeCents) ? money(stakeCents) : '—'}</span>
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
  return <span className="min-w-0 truncate font-mono text-[#22c55e]">{price === null ? '—' : price.toFixed(digits)}</span>;
}
