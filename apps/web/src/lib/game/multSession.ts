'use client';

import { useEffect } from 'react';
import { create } from 'zustand';
import { useGameSocketApi, type MultEvent, type MultOpenedData } from '@/lib/game/GameSocketProvider';

type CloseReason = 'manual' | 'tp' | 'sl' | 'stopout' | 'cancel';

/**
 * Multipliers session (BUGLOG #98): the open position lives HERE, not in the panel, so switching to a
 * digits tab (which unmounts the panel) no longer hides a live position — coming back shows it with
 * its Close button, and a second open is impossible. The socket subscription lives in the always-
 * mounted trade screen (useMultiplierSync), so no update or close is missed while the panel is hidden.
 */
interface MultSessionState {
  position: MultOpenedData | null;
  livePnl: number;
  sessionPnl: number;
  flash: { pnl: number; reason: CloseReason } | null;
  reset: () => void;
}

export const useMultSession = create<MultSessionState>((set) => ({
  position: null, livePnl: 0, sessionPnl: 0, flash: null,
  reset: () => set({ position: null, livePnl: 0, sessionPnl: 0, flash: null }),
}));

let flashTimer: ReturnType<typeof setTimeout> | null = null;

/** Mount once (the trade screen): keeps the store in step with the engine's multiplier events. */
export function useMultiplierSync() {
  const { onMultiplier } = useGameSocketApi();
  useEffect(() => onMultiplier((e: MultEvent) => {
    const st = useMultSession.getState();
    if (e.type === 'opened') { useMultSession.setState({ position: e.data, livePnl: 0 }); return; }
    const p = st.position;
    if (!p || e.data.positionId !== p.positionId) return;
    if (e.type === 'update') { useMultSession.setState({ livePnl: e.data.pnlCents }); return; }
    useMultSession.setState({ position: null, livePnl: 0, sessionPnl: st.sessionPnl + e.data.pnlCents, flash: { pnl: e.data.pnlCents, reason: e.data.reason } });
    if (flashTimer) clearTimeout(flashTimer);
    flashTimer = setTimeout(() => useMultSession.setState({ flash: null }), 1400);
  }), [onMultiplier]);
}
