'use client';

import { cn } from '@/lib/cn';

/**
 * Deriv-style last-digit statistics: the frequency (%) of each digit 0-9 across the recent tick
 * window, rendered as the outlined-circle row from the digits-broker design.
 *
 *  - Every digit is an outlined circle with its frequency % underneath.
 *  - The CURRENT (latest) digit gets an accent ring + an amber pointer triangle beneath it.
 *  - The HOTTEST digit reads accent-green, the COLDEST reads red (with a red top-right arc).
 *  - When `selectable` the circles act as a digit picker (Matches/Differs & Over/Under barrier),
 *    and the picked digit fills solid accent.
 *
 * Purely presentational + a picker; all colours come from brand tokens so it re-skins per client.
 */
export function DigitHeatmap({
  freqs,
  current,
  selected = null,
  selectable = false,
  onSelect,
}: {
  freqs: number[];
  current: number | null;
  selected?: number | null;
  selectable?: boolean;
  onSelect?: (digit: number) => void;
}) {
  const max = Math.max(...freqs);
  const min = Math.min(...freqs);
  return (
    <div className="flex items-start justify-between gap-1">
      {freqs.map((f, d) => {
        const isMax = max > 0 && f === max;
        const isMin = f === min && max !== min;
        const isCurrent = current === d;
        const isSelected = selectable && selected === d;
        return (
          <button
            key={d}
            type="button"
            disabled={!selectable}
            onClick={() => onSelect?.(d)}
            aria-pressed={isSelected}
            aria-label={`Digit ${d}, ${f.toFixed(1)}%`}
            className={cn(
              'relative flex flex-1 flex-col items-center gap-1.5 pb-2 transition',
              selectable ? 'cursor-pointer' : 'cursor-default',
            )}
          >
            {/* the circle */}
            <span
              className={cn(
                'relative flex h-11 w-11 items-center justify-center rounded-full border-[1.5px] text-[17px] font-bold leading-none tabular-nums',
                // base
                'border-border bg-surface text-fg',
                // hottest / coldest tint the ring subtly
                isMax && !isCurrent && !isSelected ? 'border-up/70' : '',
                isMin && !isCurrent && !isSelected ? 'border-down/70' : '',
                // current digit — accent ring halo
                isCurrent && !isSelected ? 'border-accent text-fg ring-[3px] ring-accent/25' : '',
                // picked digit — solid accent
                isSelected ? 'border-accent bg-accent/20 text-fg' : '',
                selectable && !isSelected ? 'hover:border-accent/70' : '',
              )}
            >
              {d}
              {/* coldest digit: red top-right arc, mirroring the reference indicator */}
              {isMin && !isCurrent && !isSelected ? (
                <span
                  aria-hidden
                  className="pointer-events-none absolute -inset-[1.5px] rounded-full"
                  style={{
                    background:
                      'conic-gradient(from -55deg, var(--pp-down) 0 34%, transparent 34% 100%)',
                    WebkitMask: 'radial-gradient(farthest-side, transparent calc(100% - 3px), #000 calc(100% - 3px))',
                    mask: 'radial-gradient(farthest-side, transparent calc(100% - 3px), #000 calc(100% - 3px))',
                  }}
                />
              ) : null}
            </span>

            {/* frequency % */}
            <span
              className={cn(
                'text-[11px] font-semibold leading-none tabular-nums',
                isMax ? 'text-up' : isMin ? 'text-down' : 'text-muted',
              )}
            >
              {f.toFixed(1)}%
            </span>

            {/* current-digit pointer (amber triangle), mirrors the Deriv-style pointer */}
            {isCurrent ? (
              <span
                aria-hidden
                className="absolute -bottom-0.5 h-0 w-0 border-x-[5px] border-t-[7px] border-x-transparent"
                style={{ borderTopColor: 'var(--pp-warn)' }}
              />
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
