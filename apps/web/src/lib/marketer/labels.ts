/**
 * MARKETER-facing neutral vocabulary (Phase 1).
 *
 * One place for the game words the marketer UI shows in place of trading/gambling terms, so the
 * substitution is consistent and auditable. Player-facing copy is untouched — these are only used
 * behind `useIsMarketer()`. Keep every value free of: Buy, Sell, Trade, Stake, Payout, Bet, Profit,
 * Win(nings), P&L, Deposit, Withdraw, currency codes.
 */
export const MK = {
  /** LivePnl / result running figure (was "Live P&L"). */
  liveValue: 'Round',
  /** The amount put in to play a round (was "Stake"). */
  cost: 'Cost',
  /** The amount returned on a winning round (was "Payout"). */
  reward: 'Reward',
  /** Positive outcome headline (was "YOU WON" / "BIG WIN" / "WIN"). */
  winHeadline: 'NICE!',
  /** Near-miss / negative outcome headline (was "NO WIN" / "YOU LOST" / "SO CLOSE"). */
  loseHeadline: 'AGAIN?',
  /** Balance tab labels (were "Real" / "Demo"). */
  realTab: 'Coins',
  practiceTab: 'Practice',
  /** Single-letter balance badges (were "R" / "D"). */
  realBadge: 'C',
  practiceBadge: 'P',
} as const;
