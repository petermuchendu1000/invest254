import type { Cents } from "./money.js";

/**
 * Deposit-bonus tier rules. Pure and dependency-free (no Node imports) so the
 * browser bundle can use them — engagement.ts pulls in node:crypto via prng.ts
 * and must stay server-side.
 */
export interface BonusTier { minCents: Cents; maxCents: Cents | null; pct: number; }

export const DEFAULT_BONUS_TIERS: BonusTier[] = [
  { minCents: 100_000, maxCents: 500_000, pct: 0.5 },   // KES 1,000–5,000 -> 50%
  { minCents: 500_001, maxCents: 1_000_000, pct: 0.25 }, // >5,000–10,000  -> 25%
  { minCents: 1_000_001, maxCents: null, pct: 0.15 },    // >10,000         -> 15%
];

/** Wagering-tier helper shared by API + tests: bonus pct for a deposit amount. */
export function bonusPctForDeposit(amountCents: Cents, tiers: BonusTier[] = DEFAULT_BONUS_TIERS): number {
  for (const t of tiers) {
    if (amountCents >= t.minCents && (t.maxCents === null || amountCents <= t.maxCents)) return t.pct;
  }
  return 0;
}
