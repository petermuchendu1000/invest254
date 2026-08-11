import { create } from 'zustand';

/** Dispatched (window event) when the flying payout chip reaches the balance pill. */
export const BALANCE_BUMP_EVENT = 'pp-balance-bump';

/** Outcome headline computed by the engine's engagement layer (presentOutcome). */
export type OutcomeHeadline = 'big_win' | 'win' | 'small_win' | 'near_miss' | 'loss';

/** A settled position ready to be celebrated / acknowledged by the FX layer. */
export interface OutcomeFx {
  /** Monotonic id so the overlay re-fires even for identical consecutive results. */
  id: number;
  result: 'win' | 'loss';
  headline: OutcomeHeadline;
  nearMiss: boolean;
  lossDisguisedAsWin: boolean;
  lockedMultiplier: number;
  /** Gross amount returned to the wallet (cents). */
  payoutCents: number;
  /** Net profit/loss vs stake (cents). Positive on any win, negative on a loss. */
  pnlCents: number;
  stakeCents: number;
  mode: 'auto' | 'manual';
}

interface OutcomeFxState {
  current: OutcomeFx | null;
  /** Fire an outcome celebration/acknowledgement. */
  show: (fx: Omit<OutcomeFx, 'id'>) => void;
  /** Dismiss the current outcome. */
  clear: () => void;
}

/**
 * Global outcome-FX bus. The game socket pushes settled outcomes here; the
 * OutcomeOverlay consumes them and orchestrates the celebratory / honest
 * feedback. Kept separate from the toast system so the overlay can own the
 * screen briefly without competing with transient notifications.
 */
export const useOutcomeFx = create<OutcomeFxState>((set) => ({
  current: null,
  show: (fx) => set({ current: { ...fx, id: Date.now() } }),
  clear: () => set({ current: null }),
}));
