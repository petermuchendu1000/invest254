'use client';

import { useCallback, useMemo, useRef } from 'react';
import { useGameSocket, useGameSocketApi } from '@/lib/game/GameSocketProvider';
import { CurveCanvas, type MarketerBeat } from '@/components/game/CurveCanvas';
import { CandleChart } from '@/components/game/CandleChart';
import { useBrand } from '@/lib/brand/BrandProvider';
import { useMarketerSkin } from '@/lib/marketer/isMarketer';
import { InterfaceModeToggle } from '@/components/game/InterfaceModeToggle';
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
  /**
   * The interface gear lives in the chart's own top-right corner, where every charting app keeps its
   * chart settings — and where this one has empty space, because the wave's value axis is drawn down
   * the LEFT edge. It used to sit in a row of its own above the chart: a full 60px band of a
   * viewport-locked phone screen spent on one 32px icon, which is 60px the chart was not getting.
   *
   * On a candlestick brand the same control is already in the chart toolbar (CandleChart), so this
   * is the line/wave half of one rule rather than a second placement.
   *
   * It used to be hidden from a marketer by ROLE, because a marketer was pinned to the basic skin and
   * a settings gear would have given the disguise away. Marketers now get the player interface
   * exactly (see the policy note in lib/marketer/isMarketer), so withholding the gear would be the
   * one thing left making their screen a different screen — and CandleChart never withheld it in the
   * first place, so the two halves of the rule disagreed.
   */
  const gearHere = !tvType;

  return (
    <div className="relative h-full min-h-0 w-full overflow-hidden rounded-xl border border-border bg-surface">
      {/* Candlestick/OHLC brands render the TradingView view; line brands render the wave. The wave's
          neutralized form (no price axis, labels or red/green) is now reached only by a player who
          chose Basic — a marketer sees the same wave a player does. */}
      {tvType ? (
        <CandleChart key={tvType} initialType={tvType} getLastTick={getLastTick} requestCandles={requestCandles} status={status} />
      ) : (
        <CurveCanvas getTicks={getTicks} getLastTick={getLastTick} windowMs={WINDOW_MS} marketer={isMarketer} beat={beat} />
      )}
      {gearHere ? <div className="absolute right-2 top-2 z-20"><InterfaceModeToggle /></div> : null}
    </div>
  );
}
