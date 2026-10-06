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
  /** The protective levels the engine actually took, which may differ from what was asked. */
  slPrice?: number | null;
  tpPrice?: number | null;
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
  /** The side the position was opened on, so a close can be reported by side without the client
   *  having to still hold the position. Optional for servers that predate it. */
  direction?: Direction;
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
  /**
   * MetaTrader's protective levels, as chart PRICES, armed with the order itself.
   *
   * Sent to the engine rather than watched here. A stop that only this tab knows about is not a
   * stop: close the tab and it is gone. The engine holds these and fires them on a tick.
   */
  slPrice?: number | null;
  tpPrice?: number | null;
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
  /**
   * The protective levels the ENGINE is holding for this position, as chart prices.
   *
   * Not the ticket's working copy in `levelsStore`, which is what the trader drags around before an
   * order exists. Once a position is open these are the ones that will actually fire, so they come
   * from the engine's `position_opened` / `levels_set` / `open_positions` frames and are the only
   * levels the open-position surfaces should show. Null means none set.
   */
  slPrice: number | null;
  tpPrice: number | null;
}
