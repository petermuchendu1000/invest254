'use client';

import { useGameSocketApi } from '@/lib/game/GameSocketProvider';
import { CurveCanvas } from '@/components/game/CurveCanvas';
import { CandleChart } from '@/components/game/CandleChart';
import { useBrand } from '@/lib/brand/BrandProvider';
import { useIsMarketer } from '@/lib/marketer/isMarketer';
import { chartStyleOf, tradingViewTypeOf } from '@invest254/shared/chart';

const WINDOW_MS = 60_000;

/**
 * Live price view. Per-brand (`sites.chart_style`, 0111/0147) it renders the classic line curve (`CurveCanvas`,
 * the free default) or, for every paid chart system (area, candlestick, bars, baseline), the TradingView view
 * (`CandleChart`) opening on THAT series type. ADDON-1: area/bars/baseline used to fall back to the line curve,
 * so brands paid for a chart their players never saw. Both views share the authoritative tick stream.
 */
export function GameCurve() {
  const { getTicks, getLastTick } = useGameSocketApi();
  const brand = useBrand();
  const { isMarketer } = useIsMarketer();
  const tvType = tradingViewTypeOf(chartStyleOf(brand.chartStyle));

  return (
    <div className="relative h-full min-h-0 w-full overflow-hidden rounded-xl border border-border bg-surface">
      {/* MARKETER: never the TradingView candlestick/bars view — always the neutral single-colour wave
          (no price axis, grid, labels or red/green), so the chart doesn't read as a trading terminal. */}
      {tvType && !isMarketer ? (
        <CandleChart key={tvType} initialType={tvType} getTicks={getTicks} getLastTick={getLastTick} windowMs={WINDOW_MS} symbol={`BTC/${brand.currency || 'KES'}`} />
      ) : (
        <CurveCanvas getTicks={getTicks} getLastTick={getLastTick} windowMs={WINDOW_MS} marketer={isMarketer} />
      )}
    </div>
  );
}
