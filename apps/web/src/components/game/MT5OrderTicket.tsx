'use client';

import { useDisplayMoney } from '@/lib/money';
import { useStakeLimits } from '@/lib/game/useStakeLimits';
import { useOrderEntry, DURATION_OPTIONS, durationLabel } from '@/lib/game/useOrderEntry';
import { useOrderResult } from '@/lib/game/useOrderResult';
import { MT5OrderResult } from '@/components/game/mobile/MT5OrderResult';
import { MT5LivePosition } from '@/components/game/MT5LivePosition';
import { useRestoreTakeProfit, useTakeProfitStore } from '@/lib/game/takeprofit';
import { MT5Price } from '@/components/game/MT5Price';
import { cn } from '@/lib/cn';

/**
 * MetaTrader's order ticket, for the candlestick terminal.
 *
 * Modelled on the real thing: volume on a `− value + +` stepper, the execution mode stated, and two
 * full-width quote buttons — SELL on the left in RED, BUY on the right in BLUE. The blue/red pair is
 * MetaTrader's, not a styling choice: every MT5 screen uses blue for the buy side, and the green/red
 * the rest of this app uses would read as a different product entirely.
 *
 * WHAT IS NOT MetaTrader, and why:
 *
 *  - ONE price, on both buttons. MetaTrader puts the bid on SELL and the ask on BUY. There is no
 *    spread here — a contract settles on one seeded price — so printing two different numbers would
 *    tell the player they buy at one and sell at the other, which is false.
 *  - An EXPIRY row. MetaTrader positions run until closed; these contracts settle at a fixed
 *    duration, so the control exists and is labelled for what it is.
 *
 * Volume is the brand's stake in lots. The stake, the limits, the deposit routing and the open call
 * are the existing ones — this is the same order the old panel placed, wearing MetaTrader's controls.
 */

/**
 * The contract terms and their labels now live with the order logic, in lib/game/useOrderEntry,
 * because the one-click panel offers the same terms. Re-exported here because the Specification
 * dialog and Market Watch already import them from this module: none of MetaTrader's four
 * expiration values describes a contract that runs on a timer the trader picks, so the timers
 * themselves are what its Expiration row states.
 */
export { DURATION_OPTIONS, durationLabel };
/** MetaTrader's own volume increments, offered as the two "+" buttons. */
const VOLUME_STEPS = [0.01, 0.1] as const;

export function MT5OrderTicket() {
  /**
   * The order itself — volume, limits, duration, the live quote and `place()` — comes from
   * `useOrderEntry`, which the chart's one-click panel uses too. This component is the CONTROLS:
   * MetaTrader's stepper, its S/L and T/P rows, its fill policy and its two by-Market buttons.
   */
  const order = useOrderEntry();
  const {
    ready, symbol, settledSymbol, digits, price, tradeDisabled, connecting,
    lots, minLots, maxLots, volDigits, bump, stakeCents, overBalance, signedIn,
    durationS, setDurationS, durations, place, activePosition, earlyCloseEnabled,
    tick, priceOfRate, market,
  } = order;
  const money = useDisplayMoney();
  const limits = useStakeLimits();
  const { result, report, clear } = useOrderResult({ symbol: settledSymbol, digits, lots, volDigits, priceOf: priceOfRate });
  const send = (dir: 'buy' | 'sell') => report(dir, place(dir));

  // S/L and T/P sit on the ticket in MetaTrader, so they sit here. The target is shared with the
  // Toolbox row, which modifies it on an open contract exactly as MetaTrader does.
  const tpTarget = useTakeProfitStore((st) => st.targetCents);
  const setTp = useTakeProfitStore((st) => st.set);
  // The saved target comes back after mount, never during the server render: a store seeded
  // differently on the two sides is a hydration mismatch.
  useRestoreTakeProfit();
  const tpStepCents = Math.max(10_000, Math.round(limits.minCents / 2)); // half the minimum stake
  const bumpTp = (dir: 1 | -1) => {
    const next = (tpTarget ?? 0) + dir * tpStepCents;
    setTp(next <= 0 ? null : next);
  };

  if (!ready) {
    return <div className="h-40 animate-pulse rounded-xl border border-[#2b3543] bg-[#0f1720]" />;
  }

  if (activePosition) {
    return (
      <div className="flex flex-col gap-2 rounded border border-[#2b3543] bg-[#0f1720] p-3 text-[#ffffff]">
        {/* An OPEN position is always on the symbol this brand settles, whatever the chart is
            showing, so it is named and priced with that one. Handing it the charted symbol would
            label a gold contract EURUSD and print its P/L against the wrong axis. */}
        <MT5LivePosition
          pos={activePosition}
          symbol={settledSymbol}
          digits={market?.instrument.digits ?? 2}
          price={tick ? priceOfRate(tick.rate) : null}
          openPrice={priceOfRate(activePosition.entryRate)}
        />
      </div>
    );
  }

  const rowLabel = 'w-20 shrink-0 text-[12px] text-[#8fa2b8] lg:w-auto lg:basis-full';
  const stepBtn = 'h-8 min-w-0 shrink-0 rounded border border-[#2b3543] bg-[#0f1720] px-1 font-mono text-[12px] font-semibold text-[#ffffff] transition hover:border-[#3183ff] disabled:opacity-40';

  return (
    <div className="relative flex flex-col gap-2 rounded-xl border border-[#2b3543] bg-[#0f1720] p-3 text-[#ffffff]">
      {/**
        * MetaTrader's execution result, in the window the order was sent from, same as the phone's.
        *
        * A CONFIRMATION is barely seen here and that is correct: this ticket is replaced by the
        * live position the moment one opens (see the early return above), and the position itself
        * is the better confirmation. A REJECTION is what this surface was missing, and it is the
        * reason the toast stands down while a window is waiting.
        */}
      {result === null ? null : <MT5OrderResult result={result} onDismiss={clear} />}
      <div className="flex items-baseline gap-2">
        <span className="text-[13px] font-bold text-white">{symbol}</span>
        {/* MetaTrader states the execution mode on the ticket. Ours fills at the next engine tick. */}
        <span className="text-[11px] text-[#8fa2b8]">Market Execution</span>
      </div>

      {/* Volume. MetaTrader's mobile stepper is a single full-width row of equal cells with NO
          inline label: the centre cell IS the volume (iOS five cells, Android seven, the increments
          scaling with magnitude). Ours had a label and an asymmetric -1/+2 arrangement that no
          MetaTrader build has, and at phone width it wrapped onto two lines. */}
      <div className="grid grid-cols-5 gap-1">
        {VOLUME_STEPS.slice().reverse().map((st) => (
          <button key={`-${st}`} type="button" onClick={() => bump(-st)} disabled={lots <= minLots} className={stepBtn} aria-label={`Decrease volume by ${st}`}>
            −{st}
          </button>
        ))}
        <span
          aria-label={`Volume ${lots.toFixed(volDigits)} lots`}
          className="flex h-8 items-center justify-center rounded border border-[#2b3543] bg-[#0f1720] font-mono text-[14px] font-bold text-white tabular-nums"
        >
          {lots.toFixed(volDigits)}
        </span>
        {VOLUME_STEPS.map((st) => (
          <button key={`+${st}`} type="button" onClick={() => bump(st)} disabled={lots >= maxLots} className={stepBtn} aria-label={`Increase volume by ${st}`}>
            +{st}
          </button>
        ))}
      </div>
      <div className="flex items-baseline gap-2 text-[11px] text-[#8fa2b8]">
        <span>= {money.fmt(stakeCents)}</span>
        <span className="ml-auto">min {minLots.toFixed(volDigits)}{limits.maxCents === undefined ? '' : ` / max ${maxLots.toFixed(volDigits)}`}</span>
      </div>

      {/* Stop Loss and Take Profit. MetaTrader's ORDER TICKET writes these out in full; "S / L"
          and "T / P" are the Toolbox column headers, which is a different surface. */}
      <div className="flex flex-wrap items-center gap-1.5">
        <span className={rowLabel}>Stop Loss</span>
        {/* MetaTrader's S/L, stated rather than offered, and now carrying the figure it stands for.
            The engine settles a losing contract at expiry and refuses to close one early, so the
            stop on this contract is fixed at the stake: that is the most it can lose, whatever the
            price does. A number a trader can read beats a greyed box that only says "no". */}
        <span
          className="flex h-8 flex-1 items-center justify-center rounded border border-[#2b3543] bg-[#0f1720] font-mono text-[12px] font-semibold text-[#8fa2b8] tabular-nums"
          title="Fixed at the stake: this contract settles at expiry and cannot lose more."
        >
          {money.fmt(stakeCents)}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className={rowLabel}>Take Profit</span>
        {/* A target that the engine can never act on is not a setting, so where early close is off
            the steppers are off with it and the row states what actually happens. */}
        <button type="button" onClick={() => bumpTp(-1)} disabled={!earlyCloseEnabled || tpTarget === null} className={stepBtn} aria-label="Lower take profit">−</button>
        <span className={cn(
          'flex h-8 min-w-[4.5rem] flex-1 items-center justify-center rounded border border-[#2b3543] bg-[#0f1720] font-mono text-[12px] font-semibold tabular-nums',
          earlyCloseEnabled ? 'text-[#ffffff]' : 'text-[#8fa2b8]',
        )}>
          {!earlyCloseEnabled ? 'at expiry' : tpTarget === null ? 'not set' : money.fmt(tpTarget)}
        </span>
        <button type="button" onClick={() => bumpTp(1)} disabled={!earlyCloseEnabled} className={stepBtn} aria-label="Raise take profit">+</button>
      </div>
      <p className="pl-[4.25rem] text-[11px] text-[#8fa2b8] lg:pl-0">
        {earlyCloseEnabled
          ? <>Closes on PROFIT reaching this amount, not a price, because an open contract&apos;s payout rises with time.</>
          : <>This brand settles every contract at expiry, so a profit target cannot close one early.</>}
      </p>

      {/* Fill policy. MetaTrader's ticket carries this row; under Market Execution the only option
          is "Fill or Kill", rendered as the selected word rather than a dropdown. This engine fills
          at the next tick or rejects, which is that policy exactly. */}
      <div className="flex flex-wrap items-center gap-1.5">
        <span className={rowLabel}>Fill policy</span>
        <span className="flex h-8 flex-1 items-center justify-center rounded border border-[#2b3543] bg-[#0f1720] text-[12px] text-[#8fa2b8] underline decoration-[#8fa2b8]/40 underline-offset-4">
          Fill or Kill
        </span>
      </div>

      {/* Expiry. NOT a MetaTrader control: a MetaTrader position has no expiry, so there is no
          original to copy. It stays because this contract genuinely has a term, and hiding it would
          hide the single most important thing about the trade. */}
      <div className="flex flex-wrap items-center gap-1.5">
        <span className={rowLabel}>Expiry</span>
        <div className="flex flex-1 gap-1">
          {durations.map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => setDurationS(d)}
              aria-pressed={durationS === d}
              className={cn(
                'h-8 flex-1 rounded border text-[12px] font-semibold transition',
                durationS === d ? 'border-[#3183ff] bg-[#3183ff]/15 text-white' : 'border-[#2b3543] bg-[#0f1720] text-[#8fa2b8] hover:text-white',
              )}
            >
              {d < 60 ? `${d}s` : `${d / 60}m`}
            </button>
          ))}
        </div>
      </div>

      {/* The quote, then the buttons.
          MetaTrader's modern order dialog puts NO price on the buttons. The price is shown
          separately, large and centred above them, and the buttons read "Sell by Market" and
          "Buy by Market" under Market Execution. Ours used to print the SAME price on both sides,
          which read as a bid and an ask that were somehow equal. This feed quotes ONE rate and has
          no spread, so one price is the truth; inventing a second would be the exact habit this
          rebuild exists to break. */}
      <div className="flex items-end justify-center pt-0.5">
        <MT5Price value={price} digits={digits} className="text-[26px] font-semibold" />
      </div>

      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => send('sell')}
          disabled={connecting || tradeDisabled}
          title={tradeDisabled ? `Trade disabled for ${symbol}.` : undefined}
          className="flex h-12 items-center justify-center rounded-md bg-[#e24242] text-[13px] font-semibold text-white transition active:brightness-90 disabled:opacity-50"
        >
          Sell by Market
        </button>
        <button
          type="button"
          onClick={() => send('buy')}
          disabled={connecting || tradeDisabled}
          title={tradeDisabled ? `Trade disabled for ${symbol}.` : undefined}
          className="flex h-12 items-center justify-center rounded-md bg-[#3e78fa] text-[13px] font-semibold text-white transition active:brightness-90 disabled:opacity-50"
        >
          Buy by Market
        </button>
      </div>

      {tradeDisabled ? (
        /* MetaTrader's own words for a symbol a broker quotes but will not accept an order on. The
           Specification dialog for this symbol says the same thing in its Trade row. */
        <p data-trade-disabled="" className="text-center text-[11px] leading-snug text-[#f0b90b]">
          Trade disabled for {symbol}.{' '}
          <button
            type="button"
            onClick={order.chartSettled}
            className="underline underline-offset-2 transition hover:text-white"
          >
            Chart {settledSymbol}
          </button>{' '}
          to place an order.
        </p>
      ) : null}
      {connecting ? <p className="text-center text-[11px] text-[#8fa2b8]">Connecting…</p> : null}
      {overBalance && signedIn ? (
        <p className="text-center text-[11px] text-[#f0b90b]">Not enough free margin: tap a side to top up.</p>
      ) : null}
    </div>
  );
}
