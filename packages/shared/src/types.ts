export type Direction = "buy" | "sell";
export type PositionStatus = "open" | "settled" | "void";
export type PositionResult = "win" | "loss" | "void";

export interface Tick { t: number; rate: number; delta: number; }

export interface OpenPositionInput {
  userId: string;
  stakeCents: number;
  direction: Direction;
  durationS: number;
  openedAtMs: number;
}

export interface Outcome {
  result: Extract<PositionResult, "win" | "loss">;
  multiplier: number;   // 1.0 on loss-base; >1..=max on win
  payoutCents: number;  // stake*multiplier on win, else 0
  pnlCents: number;     // payout - stake
  entryRate: number;
  exitRate: number;
  signedMove: number;
}
