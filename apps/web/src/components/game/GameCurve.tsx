
'use client';

import { useEffect, useState } from 'react';
import { CURVE_AMPLITUDE, CURVE_BASE_RATE } from '@invest254/shared/config';
import { useGameSocket } from '@/lib/game/GameSocketProvider';
import { CurveCanvas } from '@/components/game/CurveCanvas';

const WINDOW_MS = 60_000;
const toValue = (rate: number) => (rate - CURVE_BASE_RATE) / CURVE_AMPLITUDE;

export function GameCurve() {
  const { getTicks, getLastTick } = useGameSocket();

  // Keep the live "Rate:" readout ticking without re-rendering the canvas loop.
  const [, force] = useState(0);
  useEffect(() => {
    const id = setInterval(() => force((n) => (n + 1) % 1_000_000), 300);
    return () => clearInterval(id);
  }, []);

  const last = getLastTick();
  const rateLabel = last ? toValue(last.rate).toFixed(4) : '—';

  return (
    <div className="relative h-full min-h-0 w-full overflow-hidden rounded-xl border border-border bg-surface">
      {/* Floating live-rate chip over the chart (top-right), exchange-style. */}
      <span className="absolute right-2.5 top-2.5 z-10 rounded-md border border-accent/50 bg-bg/80 px-2.5 py-1 text-[11px] font-semibold tabular-nums text-accent backdrop-blur-sm">
        Rate: {rateLabel}
      </span>
      <CurveCanvas getTicks={getTicks} getLastTick={getLastTick} windowMs={WINDOW_MS} />
    </div>
  );
}
