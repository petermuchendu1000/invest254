import type { Direction } from '@invest254/shared';

/**
 * WebSocket betting contract — mirrors the engine source of truth
 * (`apps/engine/src/server.ts` + `game.ts`), which is authoritative over the
 * slightly-stale field names in docs/03. All money values are integer KES cents.
 */

/** S→C: engine ack that a position was opened (authoritative entry data). */
export interface PositionOpenedData {
  positionId: string;
  entryRate: number;
  direction: Direction;
  stakeCents: number;
  durationS: number;
  expiresAtMs: number;
}

/** S→C: per-tick live P&L for the open position. */
export interface PositionUpdateData {
  positionId: string;
  liveMultiplier: number;
  livePnlCents: number;
  secondsLeft: number;
  sellable: boolean;
}

/** S→C: final, settled outcome (manual cash-out or auto-expiry). */
export interface PositionSettledData {
  positionId: string;
  result: 'win' | 'loss';
  lockedMultiplier: number;
  payoutCents: number;
  pnlCents: number;
  balance: number; // new real balance, cents
  mode: 'auto' | 'manual';
  /** Engagement-layer presentation metadata (engine `presentOutcome`). Optional
   *  for backward-compat with servers that predate forwarding it. */
  presentation?: {
    headline: 'big_win' | 'win' | 'small_win' | 'near_miss' | 'loss';
    nearMiss: boolean;
    lossDisguisedAsWin: boolean;
  };
}

/** S→C: authoritative real-balance push (only `real` moves on the socket). */
export interface BalanceData {
  real: number;
  currency: string;
  /** Present on out-of-band pushes (deposit/withdraw/admin/bonus). Omitted on trade frames. */
  bonus?: number;
}

/** S→C: validation / engine error envelope. */
export interface WsErrorData {
  code: string;
  message?: string;
  reasons?: string[];
}

/** C→S: open a BUY/SELL position. */
export interface OpenPositionInput {
  stakeCents: number;
  direction: Direction;
  durationS: number;
}

/**
 * Lifecycle of the single in-flight position, client-side:
 *  - `pending`  optimistic — sent `open_position`, awaiting `position_opened`
 *  - `open`     acked by engine — receiving `position_update` ticks
 *  - `settling` optimistic — sent `sell`, awaiting `position_settled`
 * On `position_settled` the position leaves state and a toast renders the outcome.
 */
export type ActivePositionPhase = 'pending' | 'open' | 'settling';

export interface ActivePosition {
  /** Engine id; null while still purely optimistic (`pending`). */
  positionId: string | null;
  /** Local correlation id for the optimistic open. */
  clientId: string;
  direction: Direction;
  stakeCents: number;
  durationS: number;
  phase: ActivePositionPhase;
  entryRate: number | null;
  expiresAtMs: number | null;
  liveMultiplier: number;
  livePnlCents: number;
  secondsLeft: number;
  sellable: boolean;
}
