'use client';

import { useEffect } from 'react';
import { lotsOfStake } from '@invest254/shared/account';
import { useDisplayMoney } from '@/lib/money';
import { useLevelsStore } from '@/lib/game/levelsStore';
import { levelPrice, isContinuousBrand } from '@/lib/game/levelWatch';
import { useBrand } from '@/lib/brand/BrandProvider';
import { useGameSocket } from '@/lib/game/GameSocketProvider';
import type { ActivePosition } from '@/lib/game/betting';

/**
 * MetaTrader's Modify position screen: the one that edits Stop Loss and Take Profit on a position
 * that is already open. MetaQuotes' Android help describes the menu item as "Modify position (edits
 * SL and TP)", and the mobile close screen carries "Close position" and "Modify position" as two
 * tabs of the same surface.
 *
 * What the two rows do depends on how the engine prices this brand's positions, and the screen says
 * which it is on rather than offering a control that cannot bite:
 *
 *   CONTINUOUS      both levels are prices the engine closes the position at, checked on every tick
 *                   with the stop first, settling at what the position is worth there. A stop can
 *                   therefore return part of the stake rather than all of it.
 *   not continuous  the outcome is committed at open, `set_levels` is refused outright, and the
 *                   contract runs to its horizon. Neither level fires, so the target's stepper is
 *                   not offered.
 *
 * `isContinuousBrand` in lib/game/levelWatch.ts is the one place that tells them apart.
 *
 * The target is shared with the order ticket through the same store, which is MetaTrader's own
 * behaviour: a level set on the ticket and a level set on the position are the same level.
 */
const SL_ORANGE = '#dd5b4e';
const TP_GREEN = '#0eb52e';

export function MT5ModifyPosition({
  pos, symbol, digits, openPrice, canTakeProfit, onDismiss,
}: {
  pos: ActivePosition;
  symbol: string;
  digits: number;
  openPrice: number | null;
  /** False where the engine will not honour an early close, which makes a target unreachable. */
  canTakeProfit: boolean;
  onDismiss: () => void;
}) {
  const money = useDisplayMoney();
  const brand = useBrand();
  /**
   * Whether the engine will act on these levels at all. `canTakeProfit` is the brand's early-close
   * flag, which is one of the two facts; the other is whether the brand has a price axis.
   */
  const continuous = isContinuousBrand({ chartStyle: brand.chartStyle, earlyCloseEnabled: canTakeProfit });
  /**
   * The SAME levels the ticket and the chart use, as MetaTrader's Modify does.
   *
   * This dialog held a money target from its own store before, so modifying a position here could
   * not move the level drawn on the chart, and the chart's level was invisible here.
   */
  const levels = useLevelsStore((s) => s.levels);
  const setLevels = useLevelsStore((s) => s.set);
  const levelRef = useLevelsStore((s) => s.ref);
  const anchor = levelRef ?? openPrice;
  // The engine's own setter: what it accepts is what will fire.
  const pushLevels = useGameSocket().setLevels;
  const slPrice = levelPrice(levels, anchor, 'sl', digits);
  const tpPrice = levelPrice(levels, anchor, 'tp', digits);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onDismiss(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onDismiss]);

  /**
   * One point at a time, which is what MetaTrader's own stepper on this row moves by.
   *
   * The move goes to the ENGINE as well as to the local store. Modifying a position here used to
   * change only what this tab drew; the level that would actually fire now lives on the server, so
   * a Modify that did not reach it would be a dialog quietly lying about what it had done.
   */
  const bump = (dir: 1 | -1) => {
    if (anchor === null) return;
    const cur = levels.tpPoints;
    const next = { ...levels, tpPoints: cur === null ? dir * 100 : cur + dir };
    setLevels(next, openPrice);
    pushLevels(
      levelPrice(next, openPrice, 'sl', digits),
      levelPrice(next, openPrice, 'tp', digits),
    );
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
              {slPrice === null ? 'not set' : slPrice.toFixed(digits)}{' '}
              <span className="text-[11px]">(max loss {money.fmt(pos.stakeCents)})</span>
            </span>
          </div>
          <p className="px-3 py-2 text-[11px] leading-snug text-[#8fa2b8]">
            {continuous
              ? 'The stop closes the position at this price, for what it is worth there, so part of the stake can come back. Stops processing is performed on the server side.'
              : 'The level is the trader’s, and it cannot fire: this contract settles at expiry and cannot be closed at a loss, so the stake is the whole of the downside.'}
          </p>

          <div className="flex items-center justify-between gap-2 border-b px-3 py-3" style={{ borderColor: TP_GREEN }}>
            <span className="text-[12px] text-[#8fa2b8]">Take Profit</span>
            <span className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => bump(-1)}
                disabled={!continuous || anchor === null}
                aria-label="Lower take profit"
                className="h-8 w-9 rounded border border-[#2b3543] font-mono text-[13px] transition hover:border-[#3183ff] disabled:opacity-40"
              >
                −
              </button>
              <span className="min-w-[5.5rem] text-center font-mono text-[13px] tabular-nums">
                {!continuous ? 'not available' : tpPrice === null ? 'not set' : tpPrice.toFixed(digits)}
              </span>
              <button
                type="button"
                onClick={() => bump(1)}
                disabled={!continuous || anchor === null}
                aria-label="Raise take profit"
                className="h-8 w-9 rounded border border-[#2b3543] font-mono text-[13px] transition hover:border-[#3183ff] disabled:opacity-40"
              >
                +
              </button>
            </span>
          </div>
          <p className="px-3 py-2 text-[11px] leading-snug text-[#8fa2b8]">
            {continuous
              ? 'A PRICE, as MetaTrader\u2019s is: the position closes when the price reaches it, for what it is worth there.'
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
