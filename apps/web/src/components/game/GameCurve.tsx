'use client';

import { useGameSocket } from '@/lib/game/GameSocketProvider';
import { CurveCanvas } from '@/components/game/CurveCanvas';

const WINDOW_MS = 60_000;

export function GameCurve() {
  const { getTicks, getLastTick } = useGameSocket();

  return (
    <div className="relative h-full min-h-0 w-full overflow-hidden rounded-xl border border-border bg-surface">
      <CurveCanvas getTicks={getTicks} getLastTick={getLastTick} windowMs={WINDOW_MS} />
    </div>
  );
}
