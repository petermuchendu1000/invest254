'use client';

import { useState } from 'react';
import { symbolDef } from '@invest254/shared/symbols';
import { useDisplayMoney } from '@/lib/money';
import { useOrderEntry, durationLabel } from '@/lib/game/useOrderEntry';
import { useOrderResult } from '@/lib/game/useOrderResult';
import { MT5OrderResult } from '@/components/game/mobile/MT5OrderResult';
import { useGameSocketApi } from '@/lib/game/GameSocketProvider';
import { CurveCanvas } from '@/components/game/CurveCanvas';
import { useLevelsStore, useRestoreLevels } from '@/lib/game/levelsStore';
import { levelPrice } from '@/lib/game/levelWatch';
import { volumeSteps, volClampReason } from '@/lib/game/volumeSteps';
import { MT5Price } from '@/components/game/MT5Price';
import { cn } from '@/lib/cn';

/**
 * MetaTrader's PHONE order ticket, which is not its desktop dialog in a full-screen frame.
 *
 * This screen used to be exactly that: the docked desktop ticket, card border and all, pushed over
 * the shell. MetaTrader's phone ticket is a different screen, and its field order is its own
 * (docs/mt5/04-mobile-app.md section 5a, read off `android/en/open_market.png`):
 *
 *    1  back  |  SYMBOL bold + description subtitle
 *    2  the order type, full width, centred, with a triangle at the right edge
 *    3  a SEVEN-cell volume stepper: -0.5 -0.1 -0.01 [value] +0.01 +0.1 +0.5, tap the value to type
 *    4  Bid and Ask, large, side by side
 *    5  `- SL +` under an ORANGE underline, `- TP +` under a GREEN one
 *    6  `Fill policy` ..... `Fill or Kill`
 *    7  a tick chart
 *    8  a warning line
 *    9  the buttons, at the very bottom: TEXT ONLY, two lines each, `SELL` / `BY MARKET` in red and
 *       `BUY` / `BY MARKET` in blue, with a thin divider between them
 *
 * Nine is the one most easily got wrong, and this screen had it wrong: two filled rectangles with
 * "Sell by Market" on them is iOS's treatment of this screen, not Android's, and Android is the
 * build the rest of this phone shell follows. Android's buttons carry no fill at all.
 *
 * ── Where this instrument differs, and why ───────────────────────────────────────────────────────
 *
 *   ONE price, not Bid and Ask. A contract opens and settles on the same seeded number; there is no
 *   spread for two prices to sit either side of. Printing two would say the player buys at one and
 *   sells at the other.
 *
 *   The order type cannot be changed. MetaTrader's row is a selector over Market Execution and four
 *   pending types; every contract here is market execution, so the row is present, shows what it
 *   is, and says why it will not open.
 *
 *   No tick chart. This feed is served as bars from M1 up, so there is no tick series to draw. The
 *   Specification dialog says the same thing about its Ticks tab.
 *
 *   An EXPIRY row, which MetaTrader has no equivalent of: its positions run until closed, these
 *   settle on a timer the trader picks. It is the single most important fact about the trade, so it
 *   is stated rather than hidden to keep the screen looking more like the original.
 */
export function MT5MobileOrder({ onBack, onAdvanced }: {
  onBack: () => void;
  /** MetaTrader's top-right button: "switches to the extended/advanced dialog". */
  onAdvanced: () => void;
}) {
  const money = useDisplayMoney();
  const { getTicks, getLastTick } = useGameSocketApi();
  const {
    ready, symbol, settledSymbol, digits, price, tradeDisabled, connecting,
    lots, minLots, maxLots, volDigits, volStep, bump, setLots, volNote, stakeCents, overBalance, signedIn,
    durationS, setDurationS, durations, place, continuous, chartSettled,
    priceOfRate,
  } = useOrderEntry();

  /**
   * The SAME levels the advanced dialog and the chart use.
   *
   * This ticket held a money target and the dialog held price levels, so the phone's own two order
   * screens disagreed: set a target here and the dialog still said "not set", and nothing this
   * screen set was ever drawn on the chart.
   */
  const levels = useLevelsStore((s) => s.levels);
  const setLevels = useLevelsStore((s) => s.set);
  const levelRef = useLevelsStore((s) => s.ref);
  useRestoreLevels();
  const anchor = levelRef ?? price;
  const slPrice = levelPrice(levels, anchor, 'sl', digits);
  const tpPrice = levelPrice(levels, anchor, 'tp', digits);
  /** One point at a time, which is what MetaTrader's own stepper on these rows moves by. */
  const bumpTp = (dir: 1 | -1) => {
    if (anchor === null) return;
    const cur = levels.tpPoints;
    setLevels({ ...levels, tpPoints: cur === null ? dir * 100 : cur + dir }, price);
  };
  const bumpSl = (dir: 1 | -1) => {
    if (anchor === null) return;
    const cur = levels.slPoints;
    /**
     * The first press seeds the stop on the side of the button that was pressed.
     *
     * This read `-dir * 100`, which inverted the FIRST press only: "Lower" seeded the stop 100
     * points ABOVE the market and "Raise" seeded it below, while every press after that moved it
     * the way its label said. Internally inconsistent, which is what makes it a bug rather than a
     * convention, and on a tall portrait chart the inverted seed landed off the top of the visible
     * scale, so the level was not drawn at all and looked like a control that did nothing.
     *
     * There is no direction to infer a natural side from: a MetaTrader new-order screen carries
     * SL and TP before the trader has chosen Buy or Sell. So the button's own direction is the only
     * honest answer, and it is what Take Profit beside it has always done.
     */
    setLevels({ ...levels, slPoints: cur === null ? dir * 100 : cur + dir }, price);
  };


  /** "tap the centre value to type on the keyboard" — MetaTrader's own affordance for the volume. */
  const [typing, setTyping] = useState<string | null>(null);
  /**
   * What became of the figure that was typed, when it was not taken as written.
   *
   * MetaTrader's volume field validates keystrokes and reports; it does not quietly swap the
   * number. The phone ticket snapped silently, so typing 1 against a 0.058 ceiling put 0.058 back
   * and read as a field that ignored the keyboard.
   */
  const [volClamp, setVolClamp] = useState<string | null>(null);
  const commit = () => {
    if (typing === null) return;
    const n = Number(typing);
    setTyping(null);
    if (!Number.isFinite(n) || n <= 0) {
      setVolClamp(`"${typing}" is not a volume, so ${lots.toFixed(volDigits)} lots is kept.`);
      return;
    }
    const applied = setLots(n);
    setVolClamp(volClampReason(n, applied, { minLots, maxLots, volStep, volDigits }));
  };
  const volMessage = volClamp ?? volNote;
  const description = symbolDef(symbol)?.description ?? '';
  const steps = volumeSteps(lots, { min: minLots, max: maxLots, step: volStep });
  const refused = tradeDisabled || connecting;
  /**
   * MetaTrader's execution result, which belongs IN THIS WINDOW: "either confirmation of a
   * successful trade or a rejection with the reason specified". The form stays underneath it.
   */
  const { result, report, clear } = useOrderResult({ symbol: settledSymbol, digits, lots, volDigits, priceOf: priceOfRate });
  const send = (dir: 'buy' | 'sell') => report(dir, place(dir));

  if (!ready) return <div className="h-full animate-pulse bg-[#0f1720]" />;

  return (
    <div className="relative flex h-full min-h-0 flex-col bg-[#0f1720] text-white">
      {/* 1. Header: back, then the symbol in bold over its description. */}
      <div className="flex shrink-0 items-center gap-1 border-b border-[#2b3543] px-1 py-2">
        <button
          type="button"
          onClick={onBack}
          aria-label="Back"
          className="grid h-9 w-9 shrink-0 place-items-center rounded text-[#3183ff]"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5" aria-hidden>
            <path d="M15 5l-7 7 7 7" />
          </svg>
        </button>
        <div className="min-w-0">
          <div className="truncate text-[15px] font-bold leading-tight text-white">{symbol}</div>
          {description === '' ? null : (
            <div className="truncate text-[11px] leading-tight text-[#8fa2b8]">{description}</div>
          )}
        </div>
        {/* MetaTrader's top-right button on this screen, which "switches to the extended/advanced
            dialog" — the sheet with the order-type strip, the volume slider and the SL/TP chips. */}
        <button
          type="button"
          onClick={onAdvanced}
          aria-label="Advanced dialog"
          className="ml-auto grid h-9 w-9 shrink-0 place-items-center rounded text-[#3183ff]"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" className="h-5 w-5" aria-hidden>
            <path d="M4 7h10M18 7h2M4 12h4M12 12h8M4 17h12M20 17h0" />
            <circle cx="16" cy="7" r="2" />
            <circle cx="10" cy="12" r="2" />
            <circle cx="18" cy="17" r="2" />
          </svg>
        </button>
      </div>

      {/* `min-h-full flex-col` inside the scroller is what lets the tick chart take the slack, the
          way MetaTrader's fills the middle of this screen: on a tall phone the fields do not reach
          the buttons, and the band grows into the gap rather than leaving it black. On a short one
          the band keeps its floor and the screen scrolls. */}
      <div className="min-h-0 flex-1 overflow-y-auto">
       <div className="flex min-h-full flex-col">
        {/* 2. The order type, centred across the width, with MetaTrader's triangle at the edge. */}
        <button
          type="button"
          disabled
          title="Every contract on this platform is market execution. MetaTrader's other four order types are pending orders, and this engine has none."
          className="flex w-full items-center border-b border-[#2b3543] px-3 py-3 text-[14px] text-white disabled:cursor-not-allowed"
        >
          <span className="flex-1 text-center">Market Execution</span>
          <span aria-hidden className="text-[9px] text-[#8fa2b8]">▼</span>
        </button>

        {/* 3. The seven-cell stepper. The three sizes scale with the volume, as MetaTrader's do; the
               rule and the two screenshots it reproduces are in lib/game/volumeSteps. */}
        <div className="flex items-stretch border-b border-[#2b3543]">
          {steps.filter((s) => s.delta < 0).map((s) => (
            <StepCell key={s.label} step={s} onPick={() => { setVolClamp(null); bump(s.delta); }} bound={`Minimum volume ${minLots.toFixed(volDigits)} lots.${volNote === null ? '' : ` ${volNote}`}`} />
          ))}
          {/* The centre cell is NEVER disabled: MetaTrader's volume is a type-in and a brand whose
              minimum equals its maximum sits every stepper cell on its bound at once. */}
          {typing === null ? (
            <button
              type="button"
              onClick={() => setTyping(lots.toFixed(volDigits))}
              title={`Volume in lots. Type a value between ${minLots.toFixed(volDigits)} and ${maxLots.toFixed(volDigits)}.`}
              aria-label={`Volume ${lots.toFixed(volDigits)} lots`}
              className="flex-[1.4] px-1 py-3 text-center font-mono text-[17px] font-bold text-white tabular-nums"
            >
              {lots.toFixed(volDigits)}
            </button>
          ) : (
            <input
              autoFocus
              inputMode="decimal"
              value={typing}
              onChange={(e) => setTyping(e.target.value)}
              onBlur={commit}
              onKeyDown={(e) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setTyping(null); }}
              aria-label="Volume"
              className="w-0 flex-[1.4] bg-transparent px-1 py-3 text-center font-mono text-[17px] font-bold text-white outline-none tabular-nums"
            />
          )}
          {steps.filter((s) => s.delta > 0).map((s) => (
            <StepCell key={s.label} step={s} onPick={() => { setVolClamp(null); bump(s.delta); }} bound={`Maximum volume ${maxLots.toFixed(volDigits)} lots.${volNote === null ? '' : ` ${volNote}`}`} />
          ))}
        </div>
        {/* Both bounds, always: they are the symbol's own limits intersected with the brand's,
            which is the pair MetaTrader's contract specification states. */}
        <div className="flex items-baseline gap-2 px-3 py-1.5 text-[11px] text-[#8fa2b8]">
          <span>= {money.fmt(stakeCents)}</span>
          <span className="ml-auto">
            min {minLots.toFixed(volDigits)} / max {maxLots.toFixed(volDigits)}
          </span>
        </div>
        {volMessage === null ? null : (
          <p data-volume-note="" className="px-3 pb-1.5 text-[11px] leading-snug text-[#f0b90b]">{volMessage}</p>
        )}

        {/* 4. MetaTrader's Bid and Ask, large and side by side. One price here, so it is centred
               across the width both of them would have taken. */}
        <div className="flex items-end justify-center border-y border-[#2b3543] py-3">
          <MT5Price value={price} digits={digits} className="text-[24px] font-semibold" />
        </div>

        {/* 5. SL and TP, each under MetaTrader's own underline: orange for the stop, green for the
               target. Both colours are measured from MetaQuotes' own close-position screens. */}
        <LevelRow
          label="SL"
          underline="#FF9300"
          value={anchor === null ? 'waiting' : slPrice === null ? 'not set' : slPrice.toFixed(digits)}
          onDown={() => bumpSl(-1)}
          onUp={() => bumpSl(1)}
          downDisabled={anchor === null}
        />
        <LevelRow
          label="TP"
          underline="#0EB52E"
          value={!continuous ? 'not available' : anchor === null ? 'waiting' : tpPrice === null ? 'not set' : tpPrice.toFixed(digits)}
          {...(continuous
            ? { onDown: () => bumpTp(-1), onUp: () => bumpTp(1), downDisabled: anchor === null }
            : { note: 'This brand settles every contract at expiry, so a target cannot close one early.' })}
        />
        <p className="px-3 pb-2 text-[10px] leading-snug text-[#8fa2b8]">
          {continuous
            ? `SL and TP close the position at their price, for what it is worth there, so a stop can return part of the stake. Max loss ${money.fmt(stakeCents)}.`
            : `The stop is the stake, and neither level fires: this contract settles at ${durationLabel(durationS)} whatever the price does.`}
        </p>

        {/* 6. Fill policy, with the dotted leader the Trade screen uses. */}
        <Leader label="Fill policy" value="Fill or Kill" />

        {/* 7. MetaTrader's tick chart, and this one really is ticks: the engine streams them and
               `getTicks` is that buffer, so the band draws the same live edge the chart's last
               candle is forming from. (The Specification's Ticks tab says there is no tick SERIES
               to chart; that is about history, which is served as bars from M1 up. The live buffer
               is a different thing and it is what MetaTrader draws here.)

               Only while the ticket is on the symbol this brand settles. The tick buffer carries
               that symbol alone, so on any other one this band would draw a second instrument's
               price under the first one's name.

               `numbers={false}`: the canvas's own axis is the curve's unitless value, and a scale
               running 0.8 to -0.8 directly under a quote of 3081.42 reads as a second price that
               disagrees with the first. The shape, the red/green split and the zero line stay. */}
        {tradeDisabled ? null : (
          <div className="min-h-28 flex-1 border-y border-[#2b3543]">
            <CurveCanvas getTicks={getTicks} getLastTick={getLastTick} windowMs={60_000} numbers={false} />
          </div>
        )}

        {/*
          Expiry, and ONLY on a brand that still has one.

          MetaTrader has no expiry on a position, and docs/mt5/20-real-sl-tp.md settled that the row
          goes: "A position now ends at its stop, its target, a manual close, or the brand's
          horizon." The desktop ticket dropped it then and this one did not, so the phone, which
          13-phone-shell.md calls the primary shell, kept offering a control the engine ignores:
          `GameServer.openPosition` takes the BRAND's horizon whenever it has a price axis and
          discards whatever duration the client sent. A line brand has no axis, still commits its
          outcome at open and still runs to the duration asked for, so there the row is real.
        */}
        {continuous ? null : (
        <div className="flex items-center gap-2 px-3 py-2">
          <span className="shrink-0 text-[12px] text-[#8fa2b8]">Expiry</span>
          <div className="flex flex-1 gap-1">
            {durations.map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => setDurationS(d)}
                aria-pressed={durationS === d}
                className={cn(
                  'h-9 flex-1 rounded text-[12px] font-semibold transition',
                  durationS === d ? 'bg-[#3183ff] text-white' : 'bg-[#202933] text-[#8fa2b8]',
                )}
              >
                {durationLabel(d)}
              </button>
            ))}
          </div>
        </div>
        )}

        {/* 8. MetaTrader's warning line. Its own words are about market conditions and slippage;
               this engine fills at the next tick, so the line says the thing that is actually true
               of this contract rather than copying a sentence that is not. */}
        <p className="px-3 pb-3 pt-1 text-[10px] leading-snug text-[#8fa2b8]">
          Attention! The order fills at the next engine tick, which may differ from the price shown.
          The contract then settles {durationLabel(durationS)} later, at whatever the price is then.
        </p>

        {tradeDisabled ? (
          <p data-trade-disabled="" className="px-3 pb-3 text-center text-[11px] leading-snug text-[#f0b90b]">
            Trade disabled for {symbol}.{' '}
            <button type="button" onClick={() => { chartSettled(); onBack(); }} className="underline underline-offset-2">
              Chart {settledSymbol}
            </button>{' '}
            to place an order.
          </p>
        ) : null}
        {connecting ? <p className="px-3 pb-3 text-center text-[11px] text-[#8fa2b8]">Connecting…</p> : null}
        {overBalance && signedIn ? (
          <p className="px-3 pb-3 text-center text-[11px] text-[#f0b90b]">Not enough free margin: tap a side to top up.</p>
        ) : null}
       </div>
      </div>

      {/* 9. The buttons, pinned to the bottom. Text only, two lines each, with a thin divider:
             Android draws no fill behind either of them. */}
      <div className="flex shrink-0 items-stretch border-t border-[#2b3543] pb-[env(safe-area-inset-bottom)]">
        <SideButton
          top="SELL"
          colour="#D00000"
          disabled={refused}
          onPick={() => send('sell')}
          title={tradeDisabled ? `Trade disabled for ${symbol}.` : undefined}
        />
        <span aria-hidden className="w-px shrink-0 bg-[#2b3543]" />
        <SideButton
          top="BUY"
          colour="#0064F2"
          disabled={refused}
          onPick={() => send('buy')}
          title={tradeDisabled ? `Trade disabled for ${symbol}.` : undefined}
        />
      </div>

      {/* MetaTrader's result, over the form it was sent from. */}
      {result === null ? null : <MT5OrderResult result={result} onDismiss={clear} />}
    </div>
  );
}

/**
 * One cell of the seven. Disabled rather than dropped where it would leave the brand's range, and
 * it carries WHICH bound stopped it: MetaTrader states a symbol's volume limits rather than
 * offering a cell that does nothing and says nothing.
 */
function StepCell({ step, onPick, bound }: { step: { label: string; delta: number; enabled: boolean }; onPick: () => void; bound: string }) {
  return (
    <button
      type="button"
      onClick={onPick}
      disabled={!step.enabled}
      title={step.enabled ? undefined : bound}
      aria-label={`${step.delta < 0 ? 'Decrease' : 'Increase'} volume by ${Math.abs(step.delta)}`}
      className="min-w-0 flex-1 px-0.5 py-3 text-center font-mono text-[12px] font-semibold text-[#3183ff] tabular-nums transition active:bg-[#202933] disabled:text-[#8fa2b8] disabled:opacity-40"
    >
      {step.label}
    </button>
  );
}

/**
 * MetaTrader's `− SL +` and `− TP +` rows.
 *
 * The underline is the whole visual identity of these two: an orange rule under the stop and a
 * green one under the target, which is how a trader tells them apart at a glance without reading
 * the two-letter label. Where a side has no steppers the row keeps its underline and states what
 * the level actually is, rather than drawing dead `−` and `+` buttons.
 */
function LevelRow({ label, underline, value, note, onDown, onUp, downDisabled }: {
  label: string;
  underline: string;
  value: string;
  note?: string | undefined;
  onDown?: (() => void) | undefined;
  onUp?: (() => void) | undefined;
  downDisabled?: boolean | undefined;
}) {
  const step = 'grid h-9 w-10 shrink-0 place-items-center text-[18px] font-semibold leading-none text-[#3183ff] disabled:opacity-30';
  return (
    <div className="px-3 pt-2">
      <div className="flex items-center" title={note}>
        {onDown ? (
          <button type="button" onClick={onDown} disabled={downDisabled} aria-label={`Lower ${label}`} className={step}>−</button>
        ) : <span className="w-10 shrink-0" />}
        <span className="flex min-w-0 flex-1 items-baseline justify-center gap-2">
          <span className="text-[12px] font-semibold text-[#8fa2b8]">{label}</span>
          <span className={cn('truncate font-mono text-[14px] font-semibold tabular-nums', onUp || onDown ? 'text-white' : 'text-[#8fa2b8]')}>
            {value}
          </span>
        </span>
        {onUp ? (
          <button type="button" onClick={onUp} aria-label={`Raise ${label}`} className={step}>+</button>
        ) : <span className="w-10 shrink-0" />}
      </div>
      <span aria-hidden data-level-underline={label} className="mt-0.5 block h-0.5 w-full rounded" style={{ background: underline }} />
    </div>
  );
}

/** A label and a value with MetaTrader's dotted leader between them, as its Trade screen draws. */
function Leader({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline gap-1 px-3 py-2">
      <span className="shrink-0 text-[12px] text-[#8fa2b8]">{label}</span>
      <span
        aria-hidden
        className="min-w-4 flex-1 self-center"
        style={{
          height: '1px',
          backgroundImage: 'radial-gradient(circle, #2b3543 1px, transparent 1px)',
          backgroundSize: '4px 1px',
          backgroundRepeat: 'repeat-x',
        }}
      />
      <span className="shrink-0 font-mono text-[12px] text-[#8fa2b8]">{value}</span>
    </div>
  );
}

/**
 * One of MetaTrader's two trade buttons: `SELL` over `BY MARKET`, in colour, on no fill at all.
 *
 * The second line is the execution mode, and MetaTrader changes it with the symbol's: "Market
 * Execution → Buy by market / Sell by market", where Instant and Exchange execution read just
 * "Buy" / "Sell". Every contract here is market execution, so it is always this pair.
 */
function SideButton({ top, colour, disabled, onPick, title }: {
  top: string;
  colour: string;
  disabled: boolean;
  onPick: () => void;
  title?: string | undefined;
}) {
  return (
    <button
      type="button"
      onClick={onPick}
      disabled={disabled}
      title={title}
      aria-label={`${top} by market`}
      className="flex flex-1 flex-col items-center justify-center gap-0.5 py-3 transition active:bg-[#202933] disabled:opacity-40"
      style={{ color: colour }}
    >
      <span className="text-[17px] font-bold leading-none tracking-wide">{top}</span>
      <span className="text-[10px] font-semibold leading-none tracking-wider opacity-90">BY MARKET</span>
    </button>
  );
}
