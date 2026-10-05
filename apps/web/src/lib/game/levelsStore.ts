'use client';

import { useEffect } from 'react';
import { create } from 'zustand';
import type { Levels } from '@/lib/game/levels';

/**
 * The Stop Loss and Take Profit levels, and the ratio lock, remembered between orders.
 *
 * Both are MetaTrader's own behaviour: "Last-used volume and SL/TP (stored in pips and converted to
 * price) are restored on the next order. Only the most recent values are kept, NOT per symbol", and
 * of the lock: "the setting persists across orders".
 *
 * Not per symbol, deliberately, because MetaTrader's is not. Levels are held in POINTS for the same
 * reason MetaTrader holds them in pips: a price restored onto the next order would be meaningless
 * once the price has moved, and a distance survives.
 */
interface LevelsState {
  levels: Levels;
  locked: boolean;
  set: (levels: Levels) => void;
  setLocked: (locked: boolean) => void;
}

const LEVELS_KEY = 'pp-order-levels';
const LOCK_KEY = 'pp-order-levels-locked';

export const useLevelsStore = create<LevelsState>()((set) => ({
  levels: { slPoints: null, tpPoints: null },
  locked: false,
  set: (levels) => {
    try { window.localStorage.setItem(LEVELS_KEY, JSON.stringify(levels)); }
    catch { /* blocked storage: the levels still hold for this session */ }
    set({ levels });
  },
  setLocked: (locked) => {
    try { window.localStorage.setItem(LOCK_KEY, locked ? '1' : '0'); }
    catch { /* ignore */ }
    set({ locked });
  },
}));

const finiteOrNull = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null;

/** Restored after mount: a store seeded from storage during the server render is a mismatch. */
export function useRestoreLevels(): void {
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(LEVELS_KEY);
      if (raw !== null) {
        const p: unknown = JSON.parse(raw);
        if (p !== null && typeof p === 'object') {
          const o = p as Record<string, unknown>;
          useLevelsStore.setState({
            levels: { slPoints: finiteOrNull(o.slPoints), tpPoints: finiteOrNull(o.tpPoints) },
          });
        }
      }
      const lock = window.localStorage.getItem(LOCK_KEY);
      if (lock !== null) useLevelsStore.setState({ locked: lock === '1' });
    } catch { /* corrupt value: no levels is a fine default */ }
  }, []);
}
