'use client';

import { useCallback, useMemo, useRef } from 'react';
import { useGameSocket, useGameSocketApi } from '@/lib/game/GameSocketProvider';
import { CurveCanvas, type MarketerBeat } from '@/components/game/CurveCanvas';
import { CandleChart } from '@/components/game/CandleChart';
import { useBrand } from '@/lib/brand/BrandProvider';
import { useIsMarketer } from '@/lib/marketer/isMarketer';
import { useOutcomeFx } from '@/lib/game/outcomeFx';
import type { ActivePosition } from '@/lib/game/betting';
import { chartStyleOf, tradingViewTypeOf } from '@invest254/shared/chart';

const WINDOW_MS = 60_000;

/**
 * MARKETER anticipation beat: expose the live contract's elapsed fraction (0→1) and the latest real
 * settlement to the neutral wave, so it can show a "round is about to resolve" charge meter + payoff.
 * Progress is read from the authoritative `expiresAtMs`/`durationS` on each animation frame (smooth,
 * not tied to React renders). Null while nothing is live, so the beat only ever reflects a REAL round.
 */
function useMarketerBeat(active: ActivePosition | null): MarketerBeat {
  const activeRef = useRef(active);
  activeRef.current = active;
  const getProgress = useCallback((): number | null => {
    const a = activeRef.current;
    if (!a || a.phase === 'settling' || !a.expiresAtMs || a.durationS <= 0) return null;
    const totalMs = a.durationS * 1000;
    const elapsed = 1 - Math.max(0, a.expiresAtMs - Date.now()) / totalMs;
    return Math.min(1, Math.max(0, elapsed));
  }, []);
  const outcome = useOutcomeFx((s) => s.current);
  const resolve = useMemo(
    () => (outcome ? { id: outcome.id, won: outcome.result === 'win' } : null),
    [outcome],
  );
  return useMemo(() => ({ getProgress, resolve }), [getProgress, resolve]);
}

/**
 * Live price view. Per-brand (`sites.chart_style`, 0111/0147) it renders the classic line curve (`CurveCanvas`,
 * the free default) or, for every paid chart system (area, candlestick, bars, baseline), the TradingView view
 * (`CandleChart`) opening on THAT series type. ADDON-1: area/bars/baseline used to fall back to the line curve,
 * so brands paid for a chart their players never saw. Both views share the authoritative tick stream.
 */
export function GameCurve() {
  const { getTicks, getLastTick } = useGameSocketApi();
  const { activePosition } = useGameSocket();
  const brand = useBrand();
  const { isMarketer } = useIsMarketer();
  const tvType = tradingViewTypeOf(chartStyleOf(brand.chartStyle));
  // Only compute the beat for marketers; players never receive it.
  const beat = useMarketerBeat(isMarketer ? activePosition : null);

  return (
    <div className="relative h-full min-h-0 w-full overflow-hidden rounded-xl border border-border bg-surface">
      {/* MARKETER: never the TradingView candlestick/bars view — always the neutral single-colour wave
          (no price axis, grid, labels or red/green), so the chart doesn't read as a trading terminal. */}
      {tvType && !isMarketer ? (
        <CandleChart key={tvType} initialType={tvType} getTicks={getTicks} getLastTick={getLastTick} windowMs={WINDOW_MS} symbol={`BTC/${brand.currency || 'KES'}`} />
      ) : (
        <CurveCanvas getTicks={getTicks} getLastTick={getLastTick} windowMs={WINDOW_MS} marketer={isMarketer} beat={beat} />
      )}
    </div>
  );
}
