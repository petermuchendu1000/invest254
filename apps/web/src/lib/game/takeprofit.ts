'use client';

import { useEffect, useRef } from 'react';
import { create } from 'zustand';
import { logJournal } from '@/lib/game/journal';
import type { ActivePosition } from '@/lib/game/betting';

/**
 * Take profit, shared by the order ticket and the Toolbox row.
 *
 * MetaTrader carries S/L and T/P on the ticket AND lets you modify them on an open position, so the
 * target cannot live inside either component — both read and write this one value.
 *
 * It is an AMOUNT, not a price. Once a contract is open its payout rises with elapsed time rather
 * than with price (see the engine's `liveWinMultiplier`), so closing at a price level would pay an
 * amount unrelated to that level. A profit target is the same intent expressed in the terms this
 * contract actually has.
 *
 * Nothing here prices or settles anything: it closes through the ordinary manual-sell path, which
 * the engine already refuses on a losing contract.
 */

interface TakeProfitState {
  /** Target floating profit in KES cents, or null for none. */
  targetCents: number | null;
  set: (cents: number | null) => void;
}

export const useTakeProfitStore = create<TakeProfitState>()((set) => ({
  targetCents: null,
  set: (targetCents) => set({ targetCents }),
}));

/**
 * Close the open contract once its floating profit reaches the target.
 *
 * Fires at most once per position: `sell` is not instantaneous, and a second call against a
 * position already closing is an error the player would see.
 */
export function useTakeProfitWatch(position: ActivePosition | null, sell: () => void, fmt: (cents: number) => string): void {
  const firedRef = useRef<string | null>(null);
  const sellRef = useRef(sell);
  sellRef.current = sell;

  const positionId = position?.positionId ?? null;
  const pnl = position?.livePnlCents ?? 0;
  const sellable = position?.sellable ?? false;
  const target = useTakeProfitStore((s) => s.targetCents);

  // A new contract re-arms the trigger; the target itself is deliberately kept, the way a ticket
  // setting persists between orders in MetaTrader.
  useEffect(() => {
    if (positionId && firedRef.current !== positionId) return;
    if (!positionId) firedRef.current = null;
  }, [positionId]);

  useEffect(() => {
    if (!positionId || target === null || !sellable) return;
    if (pnl < target) return;
    if (firedRef.current === positionId) return;
    firedRef.current = positionId;
    logJournal('ok', 'Trade', `#${positionId.slice(0, 8)} take-profit hit at ${fmt(pnl)} — closing`);
    sellRef.current();
  }, [positionId, pnl, sellable, target, fmt]);
}
