'use client';

import { useEffect } from 'react';
import { lotsOfStake } from '@invest254/shared/account';
import { useDisplayMoney } from '@/lib/money';
import { useTakeProfitStore } from '@/lib/game/takeprofit';
import type { ActivePosition } from '@/lib/game/betting';

/**
 * MetaTrader's Modify position screen: the one that edits Stop Loss and Take Profit on a position
 * that is already open. MetaQuotes' Android help describes the menu item as "Modify position (edits
 * SL and TP)", and the mobile close screen carries "Close position" and "Modify position" as two
 * tabs of the same surface.
 *
 * Both levels are constrained here, and the screen says so rather than offering controls that
 * cannot bite:
 *
 *   Stop Loss   fixed at the stake. This engine settles a losing contract at expiry and refuses to
 *               close one early, so there is no price level at which a stop could fire; the most
 *               the position can lose is what was staked, always.
 *   Take Profit an AMOUNT, not a price. MetaTrader offers points or prices, never money, but this
 *               payout rises with elapsed time rather than with price, so a price level would pay
 *               an amount unrelated to that level.
 *
 * The target is shared with the order ticket through the same store, which is MetaTrader's own
 * behaviour: a level set on the ticket and a level set on the position are the same level.
 */
const SL_ORANGE = '#dd5b4e';
const TP_GREEN = '#0eb52e';

export function MT5ModifyPosition({
  pos, symbol, digits, openPrice, canTakeProfit, stepCents, onDismiss,
}: {
  pos: ActivePosition;
  symbol: string;
  digits: number;
  openPrice: number | null;
  /** False where the engine will not honour an early close, which makes a target unreachable. */
  canTakeProfit: boolean;
  stepCents: number;
  onDismiss: () => void;
}) {
  const money = useDisplayMoney();
  const target = useTakeProfitStore((s) => s.targetCents);
  const setTarget = useTakeProfitStore((s) => s.set);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onDismiss(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onDismiss]);

  const bump = (dir: 1 | -1) => {
    const next = (target ?? 0) + dir * stepCents;
    setTarget(next <= 0 ? null : next);
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Modify position"
      className="fixed inset-0 z-[80] flex flex-col bg-[#0f1720] text-white sm:items-center sm:justify-center sm:bg-black/60 sm:p-4"
    >
      <div className="flex min-h-0 w-full flex-1 flex-col bg-[#0f1720] sm:h-auto sm:max-w-[420px] sm:flex-none sm:rounded-sm sm:border sm:border-[#2b3543]">
        <div className="flex items-start gap-2 border-b border-[#2b3543] px-3 py-2.5">
          <button type="button" onClick={onDismiss} aria-label="Back" className="-ml-1 shrink-0 px-1 text-[20px] leading-none text-[#8fa2b8] transition hover:text-white">‹</button>
          <span className="min-w-0">
            <span className="block truncate text-[15px] font-semibold leading-tight">
              Modify position #{pos.positionId ? pos.positionId.slice(0, 8) : '…'}
            </span>
            <span className="block truncate font-mono text-[12px] leading-tight text-[#8fa2b8]">
              {pos.direction} {lotsOfStake(pos.stakeCents)} {symbol} at {openPrice === null ? '-' : openPrice.toFixed(digits)}
            </span>
          </span>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="flex items-center justify-between gap-3 border-b px-3 py-3" style={{ borderColor: SL_ORANGE }}>
            <span className="text-[12px] text-[#8fa2b8]">Stop Loss</span>
            <span className="font-mono text-[13px] tabular-nums text-[#8fa2b8]">
              {money.fmt(pos.stakeCents)} <span className="text-[11px]">(max loss)</span>
            </span>
          </div>
          <p className="px-3 py-2 text-[11px] leading-snug text-[#8fa2b8]">
            Fixed. This contract settles at expiry and cannot be closed at a loss, so the stake is
            the whole of the downside and there is no level at which a stop could fire.
          </p>

          <div className="flex items-center justify-between gap-2 border-b px-3 py-3" style={{ borderColor: TP_GREEN }}>
            <span className="text-[12px] text-[#8fa2b8]">Take Profit</span>
            <span className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => bump(-1)}
                disabled={!canTakeProfit || target === null}
                aria-label="Lower take profit"
                className="h-8 w-9 rounded border border-[#2b3543] font-mono text-[13px] transition hover:border-[#3183ff] disabled:opacity-40"
              >
                −
              </button>
              <span className="min-w-[5.5rem] text-center font-mono text-[13px] tabular-nums">
                {!canTakeProfit ? 'at expiry' : target === null ? 'not set' : money.fmt(target)}
              </span>
              <button
                type="button"
                onClick={() => bump(1)}
                disabled={!canTakeProfit}
                aria-label="Raise take profit"
                className="h-8 w-9 rounded border border-[#2b3543] font-mono text-[13px] transition hover:border-[#3183ff] disabled:opacity-40"
              >
                +
              </button>
            </span>
          </div>
          <p className="px-3 py-2 text-[11px] leading-snug text-[#8fa2b8]">
            {canTakeProfit
              ? 'An amount, not a price: this payout rises with elapsed time rather than with price, so a price level would pay an amount unrelated to that level.'
              : 'This brand settles every contract at expiry, so a profit target cannot close one early.'}
          </p>
        </div>

        <button
          type="button"
          onClick={onDismiss}
          className="w-full shrink-0 border-t border-[#2b3543] px-3 py-4 text-[14px] font-semibold text-[#4597ff] transition hover:bg-[#202933]"
        >
          Done
        </button>
      </div>
    </div>
  );
}
