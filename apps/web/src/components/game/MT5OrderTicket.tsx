'use client';

import { useState } from 'react';
import { useDisplayMoney } from '@/lib/money';
import { useOrderEntry, DURATION_OPTIONS, durationLabel } from '@/lib/game/useOrderEntry';
import { useOrderResult } from '@/lib/game/useOrderResult';
import { MT5OrderResult } from '@/components/game/mobile/MT5OrderResult';
import { MT5LivePosition } from '@/components/game/MT5LivePosition';
import { useRestoreLevels } from '@/lib/game/levelsStore';
import { MT5LevelRows } from '@/components/game/MT5LevelRows';
import { MT5Price } from '@/components/game/MT5Price';
import { volClampReason } from '@/lib/game/volumeSteps';
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
/**
 * The increments the "+"/"−" cells offer: the symbol's own step and ten of it.
 *
 * MetaTrader's volume step is per symbol, hundredths on a major and tenths on an index, and its
 * cells SCALE with the volume. A fixed `[0.01, 0.1]` offered a hundredth of an index lot, which is
 * not a volume on one, and offered the same two figures at 0.03 lots and at 30 — which is a large
 * part of why the amount control read as broken: reaching 1.00 lot from a 0.025 minimum took ten
 * taps, and anything above it dozens.
 */
const volumeStepsOf = (step: number): readonly number[] => [step, step * 10];

export function MT5OrderTicket() {
  /**
   * The order itself — volume, limits, duration, the live quote and `place()` — comes from
   * `useOrderEntry`, which the chart's one-click panel uses too. This component is the CONTROLS:
   * MetaTrader's stepper, its S/L and T/P rows, its fill policy and its two by-Market buttons.
   */
  const order = useOrderEntry();
  const {
    ready, symbol, settledSymbol, digits, price, tradeDisabled, connecting,
    lots, minLots, maxLots, volDigits, volStep, setLots, bump, volNote, stakeCents, overBalance, signedIn,
    durationS, setDurationS, durations, place, activePosition, continuous,
    tick, priceOfRate, market,
  } = order;
  const money = useDisplayMoney();
  const { result, report, clear } = useOrderResult({ symbol: settledSymbol, digits, lots, volDigits, priceOf: priceOfRate });
  const steps = volumeStepsOf(volStep);
  const [typingVol, setTypingVol] = useState<string | null>(null);
  /**
   * What happened to the last figure that was typed in, when it was not taken as written.
   *
   * MetaTrader's Volume is a numeric spinner that accepts keystrokes and validates them, never an
   * inert control (docs/mt5/01-order-and-close-dialogs.md 1.3 lists `Volume:` as a "numeric
   * spinner"; its advanced mobile dialog "highlights the field in red" on an invalid value rather
   * than refusing the keystroke). Snapping a typed figure in silence is what made the field look
   * broken: type 1, get 0.058 back, with no reason given.
   */
  const [volClamp, setVolClamp] = useState<string | null>(null);
  const commitVol = () => {
    if (typingVol === null) return;
    const n = Number(typingVol);
    setTypingVol(null);
    if (!Number.isFinite(n) || n <= 0) {
      setVolClamp(`"${typingVol}" is not a volume, so ${lots.toFixed(volDigits)} lots is kept.`);
      return;
    }
    // `setLots` snaps to the symbol's grid and clamps to the range, so a typed figure cannot land
    // off-grid or outside what the engine will accept. It returns what it used, which is what lets
    // the difference be reported instead of looking like the typing was ignored.
    const applied = setLots(n);
    setVolClamp(volClampReason(n, applied, { minLots, maxLots, volStep, volDigits }));
  };
  const send = (dir: 'buy' | 'sell') => report(dir, place(dir));

  /**
   * The levels are restored here too, because the desktop is a surface that shows them.
   *
   * It never called this, so a desktop session did not even read the saved pair out of storage: a
   * level set on the phone layout was invisible until the window was narrowed back.
   */
  useRestoreLevels();

  if (!ready) {
    return <div className="h-40 animate-pulse rounded-sm border border-[#2b3543] bg-[#0f1720]" />;
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

  /** What the bound IS, for the stepper that cannot move past it, and why where there is a why. */
  const atMin = `Minimum volume ${minLots.toFixed(volDigits)} lots.${volNote === null ? '' : ` ${volNote}`}`;
  const atMax = `Maximum volume ${maxLots.toFixed(volDigits)} lots.${volNote === null ? '' : ` ${volNote}`}`;
  // A clamp report is about the last keystrokes and outranks the standing note.
  const volMessage = volClamp ?? volNote;

  const rowLabel = 'w-20 shrink-0 text-[12px] text-[#8fa2b8] lg:w-auto lg:basis-full';
  const stepBtn = 'h-8 min-w-0 shrink-0 rounded border border-[#2b3543] bg-[#0f1720] px-1 font-mono text-[12px] font-semibold text-[#ffffff] transition hover:border-[#3183ff] disabled:opacity-40';

  return (
    <div className="relative flex flex-col gap-2 rounded-sm border border-[#2b3543] bg-[#0f1720] p-3 text-[#ffffff]">
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
        {/* Disabled only ON the bound, and never without saying which bound it is: MetaTrader
            carries min/max/step on the symbol and its dialogs name the constraint rather than
            leaving a dead control to be guessed at. */}
        {steps.slice().reverse().map((st) => (
          <button key={`-${st}`} type="button" onClick={() => { setVolClamp(null); bump(-st); }} disabled={lots <= minLots} title={lots <= minLots ? atMin : undefined} className={stepBtn} aria-label={`Decrease volume by ${st}`}>
            −{st.toFixed(volDigits)}
          </button>
        ))}
        {/**
          * Tap the centre value to type it, which is MetaTrader's own affordance ("tap the centre
          * value to type on the keyboard") and the thing this ticket had no version of: it was a
          * `<span>`. With a 0.025 minimum and two fixed steps, a trader who wanted 5 lots had no
          * way to get there but to hold down a button.
          *
          * It is NEVER disabled, whatever the steppers are doing. MetaTrader's `Volume:` is a
          * numeric spinner you can always type into, and a brand whose minimum equals its maximum
          * puts both steppers on their bound at once: if the field went with them the ticket would
          * have no working volume control at all, which is what the bug report describes.
          */}
        {typingVol === null ? (
          <button
            type="button"
            onClick={() => setTypingVol(lots.toFixed(volDigits))}
            title={`Volume in lots. Type a value between ${minLots.toFixed(volDigits)} and ${maxLots.toFixed(volDigits)}.`}
            aria-label={`Volume ${lots.toFixed(volDigits)} lots`}
            className="flex h-8 items-center justify-center rounded border border-[#2b3543] bg-[#0f1720] font-mono text-[14px] font-bold text-white tabular-nums transition hover:border-[#3183ff]"
          >
            {lots.toFixed(volDigits)}
          </button>
        ) : (
          <input
            autoFocus
            value={typingVol}
            inputMode="decimal"
            aria-label="Volume in lots"
            onChange={(e) => setTypingVol(e.target.value)}
            onBlur={commitVol}
            onKeyDown={(e) => { if (e.key === 'Enter') commitVol(); if (e.key === 'Escape') setTypingVol(null); }}
            className="flex h-8 w-full items-center justify-center rounded border border-[#3183ff] bg-[#0f1720] text-center font-mono text-[14px] font-bold text-white tabular-nums outline-none"
          />
        )}
        {steps.map((st) => (
          <button key={`+${st}`} type="button" onClick={() => { setVolClamp(null); bump(st); }} disabled={lots >= maxLots} title={lots >= maxLots ? atMax : undefined} className={stepBtn} aria-label={`Increase volume by ${st}`}>
            +{st.toFixed(volDigits)}
          </button>
        ))}
      </div>
      {/* Both bounds, always. They are the symbol's own min and max intersected with the brand's,
          which is the pair MetaTrader's contract specification states, so hiding the ceiling when
          the brand set none left the ticket quoting a limit it had no second half for. */}
      <div className="flex items-baseline gap-2 text-[11px] text-[#8fa2b8]">
        <span>= {money.fmt(stakeCents)}</span>
        <span className="ml-auto">min {minLots.toFixed(volDigits)} / max {maxLots.toFixed(volDigits)}</span>
      </div>
      {volMessage === null ? null : (
        <p data-volume-note="" className="text-[11px] leading-snug text-[#f0b90b]">{volMessage}</p>
      )}

      {/**
        * MetaTrader's Stop Loss and Take Profit, on the SAME model the phone uses.
        *
        * What was here: a Stop Loss that was a read-only label printing the stake, and a Take
        * Profit that was a target floating PROFIT in cents from a different store, with no unit
        * selector, no ratio lock, no side swap, and nothing drawn on the chart. The stop could not
        * be set at all and the target was a different concept wearing MetaTrader's label, so the
        * two shells disagreed about both.
        */}
      <MT5LevelRows
        price={price}
        digits={digits}
        stakeCents={stakeCents}
        continuous={continuous}
        durationLabel={durationLabel(durationS)}
      />

      {/* Fill policy. MetaTrader's ticket carries this row; under Market Execution the only option
          is "Fill or Kill", rendered as the selected word rather than a dropdown. This engine fills
          at the next tick or rejects, which is that policy exactly. */}
      <div className="flex flex-wrap items-center gap-1.5">
        <span className={rowLabel}>Fill policy</span>
        <span className="flex h-8 flex-1 items-center justify-center rounded border border-[#2b3543] bg-[#0f1720] text-[12px] text-[#8fa2b8] underline decoration-[#8fa2b8]/40 underline-offset-4">
          Fill or Kill
        </span>
      </div>

      {/*
        * Expiry is GONE, and that is the point.
        *
        * It was never a MetaTrader control: a MetaTrader position has no expiry, and this one only
        * had a term because the engine committed its outcome at open and revealed it on a timer.
        * It does not any more. A position now ends when its stop or its target is reached, when the
        * trader closes it, or at the brand's own horizon, which is a backstop rather than a choice.
        * Choosing a term alongside a stop would have been two contradictory ways to end one trade.
        *
        * The horizon stays configurable per brand (`defaultDurationS`); it is simply not the
        * trader's to pick. See docs/mt5/20-real-sl-tp.md.
        */}

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
