import type { Cents } from "./money.js";

/**
 * MetaTrader's account summary, computed from this game's own quantities.
 *
 * MT5's account line is built for a margin broker and this is not one: a contract is a fixed stake
 * with a fixed expiry, and nothing is borrowed. Rather than invent numbers to fill the labels, each
 * one is mapped onto a quantity that genuinely exists, so every figure on screen traces back to the
 * wallet or to an open contract:
 *
 *   Balance      the settled wallet
 *   Margin       stake committed to open contracts — funds reserved and unusable, which is the job
 *                margin does on a real account
 *   Equity       Balance + the floating result, i.e. what the account is worth closed right now
 *   Free margin  Equity - Margin
 *   Margin level Equity / Margin * 100 — MetaTrader's own formula
 *
 * The floating result is the engine's live P/L, the same number it will settle on. Nothing here
 * feeds settlement; this is a read-only view.
 */
export interface AccountInput {
  /** Settled wallet, in cents. */
  balanceCents: Cents;
  /** Stake committed to contracts that are still open, in cents. */
  openStakeCents: Cents;
  /** Engine-reported floating profit/loss on those contracts, in cents (negative while losing). */
  floatingPnlCents: Cents;
}

export interface AccountSummary {
  balanceCents: Cents;
  equityCents: Cents;
  marginCents: Cents;
  freeMarginCents: Cents;
  /**
   * Equity/Margin as a percentage, or null when nothing is open.
   *
   * MetaTrader shows no margin level on a flat account rather than zero or infinity, because the
   * ratio is undefined with no margin in use — null keeps that distinction instead of printing a
   * number that would read as a margin call.
   */
  marginLevelPct: number | null;
}

export function accountSummary(input: AccountInput): AccountSummary {
  const { balanceCents, openStakeCents, floatingPnlCents } = input;
  const equityCents = balanceCents + floatingPnlCents;
  return {
    balanceCents,
    equityCents,
    marginCents: openStakeCents,
    freeMarginCents: equityCents - openStakeCents,
    marginLevelPct: openStakeCents > 0 ? (equityCents / openStakeCents) * 100 : null,
  };
}

/**
 * Stake that one lot represents, in KES cents.
 *
 * MetaTrader states size in lots, so a volume column needs a contract size. This is a presentation
 * unit only: it converts a stake for display and never takes part in a stake, payout or outcome.
 */
export const LOT_STAKE_CENTS = 1_000_000; // 1.00 lot = KES 10,000 staked

/** A stake rendered as MetaTrader's volume, to two decimals. */
export const lotsOfStake = (stakeCents: Cents): string => (stakeCents / LOT_STAKE_CENTS).toFixed(2);
