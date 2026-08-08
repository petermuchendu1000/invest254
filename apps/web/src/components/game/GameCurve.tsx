
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
    <div className="flex h-full flex-col gap-3">
      <div className="flex items-center justify-end">
        <span className="shrink-0 rounded-lg border border-accent/60 bg-accent/10 px-3 py-1.5 text-xs font-semibold tabular-nums text-accent">
          Rate: {rateLabel}
        </span>
      </div>

      <div className="relative min-h-0 w-full flex-1 overflow-hidden rounded-xl bg-surface">
        <CurveCanvas getTicks={getTicks} getLastTick={getLastTick} windowMs={WINDOW_MS} />
      </div>
    </div>
  );
}
