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

/**
 * MetaTrader's Exposure tab, computed from the contracts that are open.
 *
 * The tab answers one question: for each symbol, how much of the account is committed to it, and
 * which way. On a margin account that is a net volume and a money value; here a contract is a fixed
 * stake with a fixed expiry, so the same two quantities exist and mean the same thing:
 *
 *   volume  the stake expressed in MetaTrader's lots, signed by direction. A buy is positive and a
 *           sell negative, so two opposite contracts on one symbol net off exactly as MetaTrader's
 *           Exposure nets them.
 *   value   the stake committed, in cents. Always positive: it is money at risk, not a direction.
 *
 * `share` is each symbol's value as a fraction of the total, which is what MetaTrader draws its bar
 * from. With nothing open there are no rows, and MetaTrader shows none either.
 *
 * Nothing here can affect an outcome. It reads open contracts and reports them.
 */
export interface ExposureInput {
  symbol: string;
  direction: "buy" | "sell";
  /** Stake committed to this contract, in cents. */
  stakeCents: Cents;
}

export interface ExposureRow {
  symbol: string;
  /** Net lots, signed: positive is long, negative is short. */
  netLots: number;
  /** Money committed to the symbol, in cents. Never negative. */
  valueCents: Cents;
  /** This symbol's share of the total committed, 0 to 1. */
  share: number;
}

export function exposureRows(open: readonly ExposureInput[]): ExposureRow[] {
  const bySymbol = new Map<string, { netCents: number; valueCents: number }>();
  for (const c of open) {
    const row = bySymbol.get(c.symbol) ?? { netCents: 0, valueCents: 0 };
    row.netCents += c.direction === "buy" ? c.stakeCents : -c.stakeCents;
    row.valueCents += c.stakeCents;
    bySymbol.set(c.symbol, row);
  }
  const total = [...bySymbol.values()].reduce((sum, r) => sum + r.valueCents, 0);
  return [...bySymbol.entries()]
    .map(([symbol, r]) => ({
      symbol,
      netLots: r.netCents / LOT_STAKE_CENTS,
      valueCents: r.valueCents,
      share: total > 0 ? r.valueCents / total : 0,
    }))
    // MetaTrader lists the largest exposure first, which is the one worth looking at.
    .sort((a, b) => b.valueCents - a.valueCents || a.symbol.localeCompare(b.symbol));
}
