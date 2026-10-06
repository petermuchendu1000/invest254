'use client';

import { useEffect, useRef } from 'react';
import type { Direction } from '@invest254/shared';
// Relative, not aliased: `@/` does not resolve under the repo's node:test runner, and this
// module's pure half is unit-tested.
import { logJournal } from './journal.js';
import { priceOfPoints, type Levels } from './levels.js';
import type { ActivePosition } from './betting.js';

/**
 * MetaTrader's Take Profit, firing at the PRICE the trader set it at.
 *
 * ── Why this replaces a money target ─────────────────────────────────────────────────────────────
 *
 * There were two different "take profit" concepts in this app and they disagreed. The phone's
 * advanced dialog held MetaTrader's real thing: a signed distance in points from an anchor price,
 * drawn and dragged on the chart. The desktop ticket, the Toolbox row and the Modify dialog held
 * something else entirely, a target floating PROFIT in cents, and a watcher that closed the
 * contract when the P/L reached it. Neither knew about the other, so a level set on the chart was
 * invisible to the ticket and the ticket's target was invisible to the chart.
 *
 * The money target's own argument for existing was that "closing at a price level would pay an
 * amount unrelated to that level", and that is true of the PAYOUT: this contract's payout rises
 * with elapsed time rather than with the distance to a level. But it is not what MetaTrader's T/P
 * promises. MetaTrader's T/P promises to CLOSE THERE; what the close is worth is a separate
 * question, and the dialog already says so in as many words. So a price trigger is both honest and
 * MetaTrader's actual semantics, and it is what this does.
 *
 * ── What it is allowed to do ─────────────────────────────────────────────────────────────────────
 *
 * Nothing but the ordinary manual close, through the same `sell` the Close button calls, under the
 * same two conditions the engine already imposes: the brand allows a manual close at all, and this
 * contract was decided a win (`sellable`). It prices nothing and settles nothing.
 *
 * ── And why there is no stop-loss trigger here ───────────────────────────────────────────────────
 *
 * A stop can never fire in this engine, and that is a fact about the engine rather than an omission
 * here: `sell` refuses a losing position outright ("NOT_SELLABLE: losing positions settle at
 * expiry"). A contract whose price has crossed its stop is a losing one by definition, so a trigger
 * would do nothing but produce a refusal the trader never asked for. The dialog states that instead,
 * which is the honest version.
 */

/** The price a level sits at, or null when it is not set. */
export function levelPrice(
  levels: Levels, ref: number | null, field: 'sl' | 'tp', digits: number,
): number | null {
  const points = field === 'sl' ? levels.slPoints : levels.tpPoints;
  if (points === null || ref === null) return null;
  return priceOfPoints(ref, points, digits);
}

/**
 * Has the price reached the target?
 *
 * MetaTrader's own rule, and the direction is the POSITION's rather than the level's shape: a buy
 * takes profit above where it opened and a sell below it, whatever side of the anchor the level was
 * dragged to. Inclusive, because a price that lands exactly on the level has reached it.
 */
export function targetReached(
  { direction, target, price }: { direction: Direction; target: number | null; price: number | null },
): boolean {
  if (target === null || price === null) return false;
  return direction === 'buy' ? price >= target : price <= target;
}

/**
 * Close the open contract when the price reaches its Take Profit level.
 *
 * Fires at most once per position: `sell` is not instantaneous, and a second call against a position
 * already closing is an error the trader would see.
 */
export function useTakeProfitLevelWatch(
  { position, price, target, sell, enabled, digits }: {
    position: ActivePosition | null;
    /** The live price on the instrument's own axis, not the engine's raw rate. */
    price: number | null;
    /** The Take Profit level as a price, from `levelPrice`. */
    target: number | null;
    sell: () => void;
    /** The engine's own answer to "can a manual close succeed on this brand at all". */
    enabled: boolean;
    digits: number;
  },
): void {
  const firedRef = useRef<string | null>(null);
  const sellRef = useRef(sell);
  sellRef.current = sell;

  const positionId = position?.positionId ?? null;
  const sellable = position?.sellable ?? false;
  const direction = position?.direction ?? 'buy';

  // A new contract re-arms the trigger. The level itself is deliberately kept, the way a ticket
  // setting persists between orders in MetaTrader.
  useEffect(() => { if (!positionId) firedRef.current = null; }, [positionId]);

  useEffect(() => {
    if (!enabled || !positionId || !sellable) return;
    if (firedRef.current === positionId) return;
    if (!targetReached({ direction, target, price })) return;
    firedRef.current = positionId;
    logJournal(
      'ok', 'Trade',
      `#${positionId.slice(0, 8)} take profit reached at ${(price ?? 0).toFixed(digits)}, closing`,
    );
    sellRef.current();
  }, [enabled, positionId, sellable, direction, target, price, digits]);
}
