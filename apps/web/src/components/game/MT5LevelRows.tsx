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
export function MT5LevelRows({ price, digits, stakeCents, earlyCloseEnabled, durationLabel }: {
  /** The live price, which a first level is anchored against. Null before the first quote. */
  price: number | null;
  digits: number;
  /** What this contract risks, which is what the stop is worth. */
  stakeCents: number;
  /** Whether the engine will honour a manual close on this brand at all. */
  earlyCloseEnabled: boolean;
  /** How this contract settles if nothing closes it, e.g. "1m". */
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
   * `currency` is its third mode, "an approximate money amount". The stop's is exact and fixed, the
   * stake, because that is the most this contract can lose whatever the price does. The target's
   * cannot be stated: the payout is a multiplier the engine assigns at open and it rises with
   * elapsed time, so no level determines it, and printing a figure would be inventing one.
   */
  const text = (field: 'sl' | 'tp'): string => {
    const points = field === 'sl' ? levels.slPoints : levels.tpPoints;
    if (!settable) return 'waiting';
    if (points === null) return 'not set';
    if (unit === 'points') return String(points);
    if (unit === 'price') return priceOfPoints(ref, points, digits).toFixed(digits);
    return field === 'sl' ? money.fmt(stakeCents) : 'varies';
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
      {/* MetaTrader's unit control, and its ratio lock at the end of the same row. */}
      <div className="flex items-center gap-1.5">
        <span className={rowLabel}>Levels in</span>
        <div className="flex min-w-0 flex-1 overflow-hidden rounded border border-[#2b3543]">
          {LEVEL_UNITS.map((u) => (
            <button
              key={u.id}
              type="button"
              onClick={() => setUnit(u.id)}
              aria-pressed={unit === u.id}
              className={cn(
                'min-w-0 flex-1 px-1 py-1 text-[11px] font-semibold transition',
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

      {/* MetaTrader prints the money value of each level under them. What these say is argued in
          lib/game/levelWatch.ts; the short of it is that the stop cannot fire and the target now
          can, at the price it is set to. */}
      <p className="text-[11px] leading-snug text-[#8fa2b8]">
        <span style={{ color: '#DD5B4E' }}>Stop</span> risks {money.fmt(stakeCents)}, the stake, and
        cannot fire: this engine settles a losing contract at expiry and refuses an early close on
        one.{' '}
        <span style={{ color: '#0EB52E' }}>Target</span>{' '}
        {earlyCloseEnabled
          ? 'closes the contract when the price reaches it. What that pays rises with elapsed time rather than with the distance to the level.'
          : `cannot close one early on this brand, so every contract settles at ${durationLabel}.`}
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
