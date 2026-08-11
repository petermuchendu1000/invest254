import { create } from 'zustand';
import type { Direction } from '@invest254/shared';

export type WalletMode = 'deposit' | 'withdraw';

/** A trade the user tried to place but couldn't fund yet; resumed after the deposit lands. */
export interface PendingTrade { direction: Direction; stakeCents: number; }

interface WalletUiState {
  open: boolean;
  /** Which side of the wallet sheet is showing. */
  mode: WalletMode;
  /** Amount to seed the deposit field with (cents), e.g. enough to cover an intended stake. */
  prefillAmountCents: number | null;
  /** Trade to resume once the wallet is funded. Survives closing the sheet. */
  pending: PendingTrade | null;
  /**
   * Set when a logged-out user starts a deposit and we route them to sign up/login first.
   * AuthModal reads this after a successful auth to reopen the deposit sheet automatically.
   */
  resumeAfterAuth: boolean;
  /** Open on the Deposit tab (optionally seeded to fund a specific trade). */
  openDeposit: (opts?: { amountCents?: number; pending?: PendingTrade | null }) => void;
  /** Open on the Withdraw tab. */
  openWithdraw: () => void;
  /** Switch tabs while the sheet stays open. */
  setMode: (mode: WalletMode) => void;
  close: () => void;
  clearPending: () => void;
  /**
   * Logged-out deposit: stash the entered amount, close the sheet, and flag a resume so the
   * BUY/SELL -> deposit -> sign up/login chain can pick up exactly where it left off.
   */
  deferToAuth: (amountCents?: number) => void;
  /** Reopen the deposit sheet after auth, preserving the seeded amount + pending trade. */
  resumeDeposit: () => void;
}

/**
 * Global wallet-sheet state. Any surface (top-bar balance, wallet page, bet panel) can open
 * the unified Deposit/Withdraw modal and choose which tab to land on. The store keeps the
 * legacy `useDepositUi` name + `openDeposit` signature so existing callers keep working.
 */
export const useDepositUi = create<WalletUiState>((set) => ({
  open: false,
  mode: 'deposit',
  prefillAmountCents: null,
  pending: null,
  resumeAfterAuth: false,
  openDeposit: (opts = {}) =>
    set({
      open: true,
      mode: 'deposit',
      prefillAmountCents: opts.amountCents ?? null,
      pending: opts.pending ?? null,
      resumeAfterAuth: false,
    }),
  openWithdraw: () => set({ open: true, mode: 'withdraw', prefillAmountCents: null, resumeAfterAuth: false }),
  setMode: (mode) => set({ mode }),
  close: () => set({ open: false, resumeAfterAuth: false }),
  clearPending: () => set({ pending: null }),
  deferToAuth: (amountCents) =>
    set((s) => ({
      open: false,
      resumeAfterAuth: true,
      prefillAmountCents: amountCents ?? s.prefillAmountCents,
    })),
  resumeDeposit: () => set({ open: true, mode: 'deposit', resumeAfterAuth: false }),
}));
