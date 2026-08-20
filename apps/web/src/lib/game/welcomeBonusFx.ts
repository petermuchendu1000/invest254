import { create } from 'zustand';

/** A welcome bonus to celebrate after a successful signup (Task 2). */
export interface WelcomeBonusFx {
  /** Monotonic id so the overlay re-fires reliably. */
  id: number;
  /** Bonus amount (cents) — the 200 KES real credit granted at registration. */
  amountCents: number;
}

interface WelcomeBonusFxState {
  current: WelcomeBonusFx | null;
  /** Fire the welcome celebration for `amountCents`. */
  show: (amountCents: number) => void;
  /** Dismiss the celebration. */
  clear: () => void;
}

/**
 * Global welcome-bonus FX bus. The register action pushes the granted amount here after a
 * successful signup; WelcomeBonusOverlay consumes it and celebrates with the same visual language
 * as a game win (confetti + count-up), then nudges the first deposit. Kept separate from the
 * game outcome bus so it never competes with in-play feedback.
 */
export const useWelcomeBonusFx = create<WelcomeBonusFxState>((set) => ({
  current: null,
  show: (amountCents) => set({ current: { id: Date.now(), amountCents } }),
  clear: () => set({ current: null }),
}));
