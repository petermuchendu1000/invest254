'use client';

import { useEffect } from 'react';
import { lotsOfStake } from '@invest254/shared/account';
import { useVolumeDigits } from '@/lib/game/volumeDigits';
import { useLevelsStore } from '@/lib/game/levelsStore';
import { levelPrice, isContinuousBrand } from '@/lib/game/levelWatch';
import { useBrand } from '@/lib/brand/BrandProvider';
import { useGameSocket } from '@/lib/game/GameSocketProvider';
import { ticketLabel, type ActivePosition } from '@/lib/game/betting';

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
  const brand = useBrand();
  // Volume to the SYMBOL's own volume digits, so every surface states one lot size for one position
  // (docs/mt5/09-toolbox.md 300, rows at 313-318).
  const volumeDigits = useVolumeDigits(symbol);
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
   * Move one level, by `delta` POINTS, and tell the engine.
   *
   * Both rows go through here, which is the fix as much as the stepper itself: the Stop Loss row was
   * a read-only `<span>` and `bump` only ever wrote `tpPoints`, so a screen titled "Modify position"
   * could not modify the stop at all. MetaTrader's own dialog gives BOTH rows two bound spinners
   * (docs/mt5/01-order-and-close-dialogs.md 212-218), and the stop is the half that protects money.
   *
   * The first press seeds the level 100 points on the side that makes it a stop or a target for THIS
   * position's direction, rather than on the side of the button that was pressed: a stop above a buy
   * is not a stop.
   *
   * The move goes to the ENGINE as well as to the local store. The level that will actually fire
   * lives on the server, so a Modify that did not reach it would be a dialog quietly lying about
   * what it had done.
   */
  const move = (field: 'sl' | 'tp', delta: number) => {
    if (anchor === null) return;
    const cur = field === 'sl' ? levels.slPoints : levels.tpPoints;
    // A stop sits below a buy and above a sell; a target is the mirror of that.
    const away = pos.direction === 'buy' ? -1 : 1;
    const seed = (field === 'sl' ? away : -away) * 100;
    const next = { ...levels, [field === 'sl' ? 'slPoints' : 'tpPoints']: cur === null ? seed : cur + delta };
    setLevels(next, openPrice);
    pushLevels(
      levelPrice(next, openPrice, 'sl', digits),
      levelPrice(next, openPrice, 'tp', digits),
    );
  };
  /** Clear a level, which is MetaTrader's empty field rather than a zero. */
  const clear = (field: 'sl' | 'tp') => {
    const next = { ...levels, [field === 'sl' ? 'slPoints' : 'tpPoints']: null };
    setLevels(next, openPrice);
    pushLevels(levelPrice(next, openPrice, 'sl', digits), levelPrice(next, openPrice, 'tp', digits));
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
              Modify position #{ticketLabel(pos)}
            </span>
            <span className="block truncate font-mono text-[12px] leading-tight text-[#8fa2b8]">
              {pos.direction} {lotsOfStake(pos.stakeCents, volumeDigits)} {symbol} at {openPrice === null ? '-' : openPrice.toFixed(digits)}
            </span>
          </span>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          <LevelRow
            label="Stop Loss"
            accent={SL_ORANGE}
            price={slPrice}
            points={levels.slPoints}
            digits={digits}
            disabled={!continuous || anchor === null}
            onMove={(d) => move('sl', d)}
            onClear={() => clear('sl')}
          />
          <p className="px-3 py-2 text-[11px] leading-snug text-[#8fa2b8]">
            {continuous
              ? 'The stop closes the position at this price, for what it is worth there, so part of the stake can come back. Stops processing is performed on the server side.'
              : 'The level is the trader’s, and it cannot fire: this contract settles at expiry and cannot be closed at a loss, so the stake is the whole of the downside.'}
          </p>

          <LevelRow
            label="Take Profit"
            accent={TP_GREEN}
            price={tpPrice}
            points={levels.tpPoints}
            digits={digits}
            disabled={!continuous || anchor === null}
            onMove={(d) => move('tp', d)}
            onClear={() => clear('tp')}
          />
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

/**
 * One of MetaTrader's two Modify rows: the level as a PRICE and as a DISTANCE IN POINTS, each with
 * its own spinner, bound to the same stored level.
 *
 * Measured from MetaQuotes' own modify_position.png and recorded at
 * docs/mt5/01-order-and-close-dialogs.md 212-218:
 *
 *     Stop Loss:   [ 214.531 ⇅ ]   [ 1860 ⇅ ] points
 *     Take Profit: [ 219.526 ⇅ ]   [  135 ⇅ ] points
 *
 * "The left spinner is the absolute price, the right spinner the distance in points from the
 * position's open price; they are bound bidirectionally. The literal word `points` is the suffix
 * label on both rows." Both spinners move the same stored value, so the binding is the storage
 * rather than two fields kept in step: a price step is one point, and a points step is one point.
 */
function LevelRow({ label, accent, price, points, digits, disabled, onMove, onClear }: {
  label: string;
  accent: string;
  price: number | null;
  points: number | null;
  digits: number;
  disabled: boolean;
  onMove: (deltaPoints: number) => void;
  onClear: () => void;
}) {
  const step = 'h-8 w-8 shrink-0 rounded border border-[#2b3543] font-mono text-[13px] text-[#3183ff] transition hover:border-[#3183ff] disabled:opacity-40';
  return (
    <div className="border-b px-3 py-2.5" style={{ borderColor: accent }}>
      <div className="flex items-center gap-2">
        <span className="w-20 shrink-0 text-[12px]" style={{ color: accent }}>{label}</span>
        <button type="button" onClick={() => onMove(-1)} disabled={disabled} aria-label={`Lower ${label}`} className={step}>−</button>
        <span className="min-w-[4.5rem] flex-1 text-center font-mono text-[13px] tabular-nums">
          {price === null ? 'not set' : price.toFixed(digits)}
        </span>
        <button type="button" onClick={() => onMove(1)} disabled={disabled} aria-label={`Raise ${label}`} className={step}>+</button>
      </div>
      <div className="mt-1.5 flex items-center gap-2">
        <span className="w-20 shrink-0" />
        <button type="button" onClick={() => onMove(-10)} disabled={disabled} aria-label={`Lower ${label} by ten points`} className={step}>−</button>
        <span className="min-w-[4.5rem] flex-1 text-center font-mono text-[13px] tabular-nums text-[#8fa2b8]">
          {points === null ? '-' : Math.round(points)} <span className="text-[11px]">points</span>
        </span>
        <button type="button" onClick={() => onMove(10)} disabled={disabled} aria-label={`Raise ${label} by ten points`} className={step}>+</button>
        {price === null ? null : (
          <button type="button" onClick={onClear} aria-label={`Clear ${label}`} className="shrink-0 px-1 text-[11px] text-[#3183ff]">clear</button>
        )}
      </div>
    </div>
  );
}
