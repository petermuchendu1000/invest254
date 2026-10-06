'use client';

import { useState } from 'react';
import {
  LEVEL_UNITS, pointsOfPrice, priceOfPoints, applyRatioLock, shapeOf,
  type LevelUnit, type Levels,
} from '@/lib/game/levels';
import { useLevelsStore } from '@/lib/game/levelsStore';
import { useDisplayMoney } from '@/lib/money';
import { cn } from '@/lib/cn';

/**
 * MetaTrader's Stop Loss and Take Profit rows, for a DOCKED ticket.
 *
 * The phone's advanced dialog had these and the desktop ticket did not. What the desktop had
 * instead was a Stop Loss that was a read-only label printing the stake, and a Take Profit that was
 * a target floating PROFIT in cents from a different store, with no unit selector, no ratio lock,
 * no side swap and nothing drawn on the chart. So "SL/TP does not work on desktop" was accurate:
 * the stop could not be set at all, and the target was a different concept wearing MetaTrader's
 * label.
 *
 * This is the same model the phone uses, `lib/game/levels.ts`: signed distances in points from the
 * anchor the pair was placed against, which is how MetaTrader stores them and why a level stays on
 * its price instead of crawling with the market. One store, so a level set here is drawn on the
 * chart, draggable there, and still set when the phone layout takes over at a narrow width.
 *
 * ── Shaped for a docked panel, not copied from the phone ─────────────────────────────────────────
 * The phone stacks a chip above its stepper because at 360px a chip, two 44px buttons and a full
 * price did not fit on one line. A docked ticket is wider and MetaTrader's own desktop ticket puts
 * each level on one row, so that is what this is: label, stepper, clear.
 */
export function MT5LevelRows({ price, digits, stakeCents, continuous, durationLabel }: {
  /** The live price, which a first level is anchored against. Null before the first quote. */
  price: number | null;
  digits: number;
  /** The stake, which is the most this position can lose whichever model prices it. */
  stakeCents: number;
  /**
   * Whether the engine prices this brand's positions CONTINUOUSLY, so both levels really close one
   * at their price. See `isContinuousBrand` in lib/game/levelWatch.ts.
   */
  continuous: boolean;
  /** The horizon a position runs to if nothing closes it, e.g. "1m". */
  durationLabel: string;
}) {
  const money = useDisplayMoney();
  const levels = useLevelsStore((s) => s.levels);
  const setLevels = useLevelsStore((s) => s.set);
  const levelRef = useLevelsStore((s) => s.ref);
  const locked = useLevelsStore((s) => s.locked);
  const setLocked = useLevelsStore((s) => s.setLocked);
  const [unit, setUnit] = useState<LevelUnit>('price');
  const [typing, setTyping] = useState<null | { field: 'sl' | 'tp'; text: string }>(null);

  /** The anchor the distances are measured from. See levelsStore: a level is a price. */
  const anchor = levelRef ?? price;
  const ref = anchor ?? 0;
  /** A level is a price, so there has to be a price. Before the first quote there is none. */
  const settable = anchor !== null;

  /** MetaTrader's default distance for a first tap, in points. */
  const DEFAULT_POINTS = 100;

  const edit = (field: 'sl' | 'tp', points: number | null) => {
    if (!settable && points !== null) return;
    const next: Levels = field === 'sl' ? { ...levels, slPoints: points } : { ...levels, tpPoints: points };
    setLevels(locked ? applyRatioLock(levels, next, field) : next, price);
  };
  const step = (field: 'sl' | 'tp', dir: 1 | -1) => {
    const cur = field === 'sl' ? levels.slPoints : levels.tpPoints;
    // Nothing set yet: the first tap puts the level where MetaTrader's default would be, on the
    // side that field belongs on for a buy, rather than one point from the price.
    if (cur === null) { edit(field, field === 'sl' ? -DEFAULT_POINTS : DEFAULT_POINTS); return; }
    edit(field, cur + dir);
  };

  /**
   * How a level reads in the selected unit, which is what MetaTrader's segmented control changes:
   * the VALUE shown, not the level.
   *
   * `currency` is its third mode, "an approximate money amount", and what it can honestly say
   * depends on how the brand is priced. On a CONTINUOUS contract both figures follow from the
   * distance, but the engine publishes neither the gain nor the break-even cost they follow from, so
   * both read `varies` rather than an invented number. On a committed contract the stop's is exact
   * and fixed, the stake, because that is the whole of the downside; the target's still cannot be
   * stated, since the payout is a multiplier assigned at open that no level determines.
   */
  const text = (field: 'sl' | 'tp'): string => {
    const points = field === 'sl' ? levels.slPoints : levels.tpPoints;
    if (!settable) return 'waiting';
    if (points === null) return 'not set';
    if (unit === 'points') return String(points);
    if (unit === 'price') return priceOfPoints(ref, points, digits).toFixed(digits);
    return field === 'sl' && !continuous ? money.fmt(stakeCents) : 'varies';
  };
  const commit = (field: 'sl' | 'tp', raw: string) => {
    const n = Number(raw);
    if (!Number.isFinite(n)) { setTyping(null); return; }
    edit(field, unit === 'points' ? Math.round(n) : pointsOfPrice(ref, n, digits));
    setTyping(null);
  };

  const rowLabel = 'w-20 shrink-0 text-[12px] text-[#8fa2b8]';
  const stepBtn = 'h-8 w-8 shrink-0 rounded border border-[#2b3543] bg-[#0f1720] font-mono text-[14px] font-semibold text-[#3183ff] transition hover:border-[#3183ff] disabled:opacity-40';
  const shape = shapeOf(levels);

  return (
    <>
      {/*
        MetaTrader's unit control, and its ratio lock at the end of the same row.

        BARE, with no leading text: `docs/mt5/01-order-and-close-dialogs.md` 574 records the control
        as "Segmented control for stop-level units: `Price` | `Pips` | `USD`", a segmented control on
        its own. It carried a 80px "Levels in" label here, which is both an invention and the reason
        "Currency" rendered as "Currenc": the three segments shared what was left of a ~310px panel
        and the longest label overflowed its button by 4px. The name moves to the group's aria-label,
        so a screen reader still hears what the three buttons are for.
      */}
      <div className="flex items-center gap-1.5">
        <div role="group" aria-label="Stop Loss and Take Profit units" className="flex min-w-0 flex-1 overflow-hidden rounded border border-[#2b3543]">
          {LEVEL_UNITS.map((u) => (
            <button
              key={u.id}
              type="button"
              onClick={() => setUnit(u.id)}
              aria-pressed={unit === u.id}
              className={cn(
                'min-w-0 flex-1 px-2 py-1 text-[11px] font-semibold transition',
                unit === u.id ? 'bg-[#2b3543] text-white' : 'text-[#8fa2b8] hover:text-white',
              )}
            >
              {u.label}
            </button>
          ))}
        </div>
        {/* "A lock button fixes the TP:SL ratio: adjust one and the other follows." */}
        <button
          type="button"
          onClick={() => setLocked(!locked)}
          aria-pressed={locked}
          aria-label="Lock the take profit to stop loss ratio"
          title="Fix the TP:SL ratio: adjust one level and the other follows."
          className={cn('grid h-8 w-8 shrink-0 place-items-center rounded border border-[#2b3543] transition', locked ? 'bg-[#2b3543] text-[#3183ff]' : 'text-[#8fa2b8] hover:text-white')}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-4 w-4" aria-hidden>
            <rect x="5" y="11" width="14" height="9" rx="2" />
            <path d={locked ? 'M8 11V8a4 4 0 018 0v3' : 'M8 11V8a4 4 0 017-2.6'} strokeLinecap="round" />
          </svg>
        </button>
      </div>

      {(['sl', 'tp'] as const).map((field) => {
        const label = field === 'sl' ? 'Stop Loss' : 'Take Profit';
        const colour = field === 'sl' ? '#DD5B4E' : '#0EB52E';
        const value = text(field);
        const set = (field === 'sl' ? levels.slPoints : levels.tpPoints) !== null;
        return (
          <div key={field} className="flex items-center gap-1.5">
            <span className={rowLabel} style={{ color: colour }}>{label}</span>
            <button type="button" onClick={() => step(field, -1)} disabled={!settable} className={stepBtn} aria-label={`Lower ${label}`}>−</button>
            {typing?.field === field ? (
              <input
                autoFocus
                value={typing.text}
                inputMode="decimal"
                aria-label={`${label} value`}
                onChange={(e) => setTyping({ field, text: e.target.value })}
                onBlur={() => commit(field, typing.text)}
                onKeyDown={(e) => { if (e.key === 'Enter') commit(field, typing.text); if (e.key === 'Escape') setTyping(null); }}
                className="h-8 min-w-0 flex-1 rounded border border-[#3183ff] bg-[#0f1720] px-1 text-center font-mono text-[12px] font-semibold text-white tabular-nums outline-none"
              />
            ) : (
              /* Tap the value to type it, which is MetaTrader's own affordance on these fields and
                 the thing the desktop ticket had no version of: it was a span. */
              <button
                type="button"
                disabled={!settable}
                onClick={() => setTyping({ field, text: value === 'not set' || value === 'varies' || value === 'waiting' ? '' : value })}
                aria-label={`${label} ${value}`}
                className={cn(
                  'h-8 min-w-0 flex-1 rounded border border-[#2b3543] bg-[#0f1720] px-1 text-center font-mono text-[12px] font-semibold tabular-nums transition hover:border-[#3183ff]',
                  set ? 'text-white' : 'text-[#8fa2b8]',
                )}
              >
                {value}
              </button>
            )}
            <button type="button" onClick={() => step(field, 1)} disabled={!settable} className={stepBtn} aria-label={`Raise ${label}`}>+</button>
            {set ? (
              <button type="button" data-compact="" onClick={() => edit(field, null)} className="shrink-0 px-0.5 text-[10px] text-[#3183ff]" aria-label={`Clear ${label}`}>clear</button>
            ) : null}
          </div>
        );
      })}

      {/* MetaTrader prints the money value of each level under them. Which of these two the brand
          gets is argued in lib/game/levelWatch.ts: on a continuous brand the engine checks both
          levels every tick and closes at what the position is worth there, so the stop is a real
          stop; on any other brand neither level fires. */}
      <p className="text-[11px] leading-snug text-[#8fa2b8]">
        {continuous ? (
          <>
            <span style={{ color: '#DD5B4E' }}>Stop</span> and{' '}
            <span style={{ color: '#0EB52E' }}>Target</span> close the position at their price, for
            what it is worth there, so a stop can return part of the stake. Max loss{' '}
            {money.fmt(stakeCents)}. Stops processing is performed on the server side.
          </>
        ) : (
          <>
            <span style={{ color: '#DD5B4E' }}>Stop</span> risks {money.fmt(stakeCents)}, the stake.
            Neither it nor <span style={{ color: '#0EB52E' }}>Target</span> fires on this brand: the
            contract settles at {durationLabel}.
          </>
        )}
      </p>

      {shape === null && (levels.slPoints !== null || levels.tpPoints !== null) ? (
        <p data-levels-invalid="" className="text-[11px] text-[#f23645]">
          The stop and the target are on the same side of the price. One has to be above it and one
          below.
        </p>
      ) : null}
    </>
  );
}
