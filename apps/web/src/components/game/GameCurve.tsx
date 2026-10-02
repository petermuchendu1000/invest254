'use client';

import { useCallback, useMemo, useRef } from 'react';
import { useGameSocket, useGameSocketApi } from '@/lib/game/GameSocketProvider';
import { CurveCanvas, type MarketerBeat } from '@/components/game/CurveCanvas';
import { CandleChart } from '@/components/game/CandleChart';
import { useBrand } from '@/lib/brand/BrandProvider';
import { useMarketerSkin } from '@/lib/marketer/isMarketer';
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
  const { getTicks, getLastTick, requestCandles } = useGameSocketApi();
  const { activePosition, status } = useGameSocket();
  const brand = useBrand();
  // The wave follows the effective "basic" skin: a real marketer OR a player who chose Basic.
  const { isMarketer } = useMarketerSkin();
  const tvType = tradingViewTypeOf(chartStyleOf(brand.chartStyle));
  // The anticipation beat rides on the neutral wave (basic skin only).
  const beat = useMarketerBeat(isMarketer ? activePosition : null);

  return (
    <div className="relative h-full min-h-0 w-full overflow-hidden rounded-xl border border-border bg-surface">
      {/* Candlestick/OHLC brands render the TradingView view for everyone (marketers included): neutral-
          ization applies to the LINE wave (`CurveCanvas`) only. Line brands keep the single-colour wave,
          which for marketers is the neutralized version (no price axis, labels or red/green). */}
      {tvType ? (
        <CandleChart key={tvType} initialType={tvType} getLastTick={getLastTick} requestCandles={requestCandles} status={status} />
      ) : (
        <CurveCanvas getTicks={getTicks} getLastTick={getLastTick} windowMs={WINDOW_MS} marketer={isMarketer} beat={beat} />
      )}
    </div>
  );
}
