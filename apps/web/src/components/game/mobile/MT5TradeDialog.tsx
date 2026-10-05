'use client';

import { useState } from 'react';
import { symbolDef } from '@invest254/shared/symbols';
import { useDisplayMoney } from '@/lib/money';
import { useWallet } from '@/lib/wallet/hooks';
import { useOrderEntry, durationLabel } from '@/lib/game/useOrderEntry';
import {
  LEVEL_UNITS, priceOfPoints, pointsOfPrice, swapForSide, sidesEnabled, applyRatioLock,
  type LevelUnit, type Levels,
} from '@/lib/game/levels';
import { useLevelsStore, useRestoreLevels } from '@/lib/game/levelsStore';
import { MT5Price } from '@/components/game/MT5Price';
import { cn } from '@/lib/cn';

/**
 * MetaTrader's ADVANCED trading dialog, the one its chart opens.
 *
 * Its field order is its own, and near-identical on both platforms (docs/mt5/04-mobile-app.md
 * section 5b, from `android/en/open_market_extended.png`):
 *
 *    1  a drag grabber
 *    2  SYMBOL with its description, Bid and Ask on the right
 *    3  a horizontally scrollable order-type tab strip
 *    4  Volume: the value with a stepper, and a unit selector reading `Lots`
 *    5  a volume slider
 *    6  `Margin = ...` on the left, `Free: ...` on the right
 *    7  a `Price | Pips | Currency` segmented control
 *    8  a red `SL` chip and a green `TP` chip, each with a value and a stepper
 *    9  the money value of each level beneath it
 *   10  `Fill policy: Fill or Kill`
 *   11  `Comment: Add comment`
 *   12  `Sell` and `Buy`, full-width filled, side by side
 *
 * This is where MetaTrader's real Stop Loss and Take Profit live, and it is the piece this phone
 * shell did not have.
 *
 * ── What these levels do here, said once and plainly ─────────────────────────────────────────────
 *
 * They are MetaTrader's controls, working as MetaTrader's controls: price levels, in price, points
 * or money, defaulting buy-shaped, swapping when you tap Sell, held in ratio by the lock, red and
 * dead when they contradict themselves. All of that is in lib/game/levels and unit-tested there.
 *
 * What the ENGINE will act on is a different question with a blunt answer, and the dialog says it
 * rather than implying otherwise:
 *
 *   `sell()` refuses a losing position ("NOT_SELLABLE: losing positions settle at expiry") and
 *   refuses every manual close on a pool brand ("SELL_DISABLED"). A position is sellable only when
 *   its outcome was decided a WIN at open.
 *
 * So the stop cannot fire, ever, and the target fires only on a trade already decided a winner, on
 * a brand with early close on. Row 9, where MetaTrader prints each level's money value, is where
 * this is stated: the stop's value is the stake, because that is the most this contract can lose
 * whatever the price does, and the target's is what the contract pays, which rises with elapsed
 * time rather than with distance.
 */
const ORDER_TYPES = ['Market Execution', 'Buy Limit', 'Sell Limit', 'Buy Stop', 'Sell Stop'] as const;

export function MT5TradeDialog({ onDismiss }: { onDismiss: () => void }) {
  const money = useDisplayMoney();
  const { data: wallet } = useWallet();
  const {
    ready, symbol, settledSymbol, digits, price, tradeDisabled, connecting,
    lots, minLots, maxLots, volDigits, bump, setLots, stakeCents, overBalance, signedIn,
    durationS, place, earlyCloseEnabled, chartSettled,
  } = useOrderEntry();

  const levels = useLevelsStore((s) => s.levels);
  const setLevels = useLevelsStore((s) => s.set);
  const levelRef = useLevelsStore((s) => s.ref);
  const locked = useLevelsStore((s) => s.locked);
  const setLocked = useLevelsStore((s) => s.setLocked);
  useRestoreLevels();

  const [unit, setUnit] = useState<LevelUnit>('price');
  const [typing, setTyping] = useState<null | { field: 'volume' | 'sl' | 'tp'; text: string }>(null);

  if (!ready) return <div className="h-full animate-pulse bg-[#0f1720]" />;

  const description = symbolDef(symbol)?.description ?? '';
  /**
   * The price the levels are measured from: the one they were ANCHORED at, not the live one.
   *
   * A level is a price and has to stay where it was put. Reading it against the live price made the
   * stop crawl with the market, and made this dialog and the chart disagree about the same level,
   * because the two sampled the price a fraction of a second apart. See levelsStore.
   */
  const anchor = levelRef ?? price;
  /**
   * Zero ONLY as the arithmetic's last resort, never as a level a trader can set against.
   *
   * With no quote yet there is no price for a distance to be measured from, and anchoring at zero
   * put a stop at 0.00050 and KEPT it there, because the store holds the first anchor it is given.
   * `levelsSettable` below is what stops that happening; this stays so the conversions are total.
   */
  const ref = anchor ?? 0;
  /** A level is a price, so there has to be a price. MetaTrader offers no trading controls without
   *  one either: it hides New order outright while the terminal is not connected. */
  const levelsSettable = anchor !== null;
  const sides = sidesEnabled(levels);
  const refused = tradeDisabled || connecting;

  /** One point in the unit currently selected, so the stepper moves by a sensible amount in each. */
  const edit = (field: 'sl' | 'tp', points: number | null) => {
    // Clearing a level needs no anchor; setting one does, and there is none before the first quote.
    if (!levelsSettable && points !== null) return;
    const next: Levels = field === 'sl' ? { ...levels, slPoints: points } : { ...levels, tpPoints: points };
    // The live price is offered as the anchor; the store keeps the first one it is given.
    setLevels(locked ? applyRatioLock(levels, next, field) : next, price);
  };
  const step = (field: 'sl' | 'tp', dir: 1 | -1) => {
    const cur = field === 'sl' ? levels.slPoints : levels.tpPoints;
    // Nothing set yet: the first tap puts the level where MetaTrader's default would be, on the
    // side that field belongs on for a buy, rather than one point from the price.
    if (cur === null) { edit(field, field === 'sl' ? -DEFAULT_POINTS : DEFAULT_POINTS); return; }
    edit(field, cur + dir);
  };

  /**
   * How a level reads in the selected unit. MetaTrader's control changes the VALUE shown, not the
   * level itself, which is why everything is stored in points and converted here.
   *
   * `currency` is MetaTrader's third mode, "an approximate money amount". On this contract the
   * money a level is worth does NOT follow from its distance. The stop's is exact and fixed: the
   * stake, always, because that is the most this contract can lose whatever the price does. The
   * target's cannot be stated at all before the trade opens, since the payout is a multiplier the
   * engine assigns then and it rises with elapsed time. Printing a figure there would be inventing
   * one, so the mode says `varies` and the note underneath says why.
   */
  const levelText = (field: 'sl' | 'tp', points: number | null): string => {
    if (points === null) return 'not set';
    if (unit === 'points') return String(points);
    if (unit === 'price') return priceOfPoints(ref, points, digits).toFixed(digits);
    // The stop's money value is exact and knowable: the stake, always. The target's is not, and
    // printing a figure would be inventing one. The payout is a multiplier the engine assigns when
    // the contract opens and it rises with elapsed time, so no level determines it.
    return field === 'sl' ? money.fmt(stakeCents) : 'varies';
  };
  const commitLevel = (field: 'sl' | 'tp', text: string) => {
    const n = Number(text);
    if (!Number.isFinite(n)) { setTyping(null); return; }
    edit(field, unit === 'points' ? Math.round(n) : pointsOfPrice(ref, n, digits));
    setTyping(null);
  };

  const spendable = (wallet?.real ?? 0) + (wallet?.bonus ?? 0);

  const trade = (dir: 'buy' | 'sell') => {
    // MetaTrader swaps the levels when you tap the other side, which is a change to the ticket the
    // trader can see happen, so it is applied before the order rather than silently inside it.
    setLevels(swapForSide(levels, dir));
    place(dir);
  };

  return (
    <>
      <button type="button" aria-label="Close order dialog" onClick={onDismiss} className="fixed inset-0 z-40 bg-black/60" />
      <div
        role="dialog"
        aria-label="New order"
        className="fixed inset-x-0 bottom-0 z-50 flex max-h-[92vh] flex-col overflow-hidden rounded-t-xl border-t border-[#2b3543] bg-[#0f1720] text-white pb-[env(safe-area-inset-bottom)] shadow-2xl"
      >
        {/* 1. The grabber. MetaTrader's sheet can be dragged; this one is sized to its content, so
               the grabber is the dismiss affordance rather than a drag handle that leads nowhere. */}
        <button type="button" onClick={onDismiss} aria-label="Close" className="flex shrink-0 justify-center py-2">
          <span aria-hidden className="h-1 w-10 rounded-full bg-[#2b3543]" />
        </button>

        {/* `overflow-x-hidden` is load-bearing. The order-type strip below bleeds past this box with
            `-mx-3` so it can scroll edge to edge, which makes this scroller horizontally scrollable
            too — and once anything nudged it sideways the whole sheet sat 14px off the screen with
            the symbol, the SL chip and the money lines all clipped at the left edge. The strip
            keeps its own horizontal scrolling; this box must not have any. */}
        <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-3 pb-3">
          {/* 2. Symbol and description, with the price on the right where MetaTrader puts Bid and
                 Ask. One price here, for the reason the order ticket documents. */}
          <div className="flex items-start gap-3">
            <div className="min-w-0">
              <div className="truncate text-[15px] font-bold leading-tight">{symbol}</div>
              {description === '' ? null : <div className="truncate text-[11px] text-[#8fa2b8]">{description}</div>}
            </div>
            <div className="ml-auto shrink-0 text-right">
              <MT5Price value={price} digits={digits} className="text-[15px] font-semibold" />
            </div>
          </div>

          {/* 3. The order-type strip. Every contract here is market execution, so the other four are
                 present and refused rather than missing: a strip with one tab would not be
                 MetaTrader's, and a strip of four live tabs that open nothing would be worse. */}
          <div className="-mx-3 mt-2 flex gap-1 overflow-x-auto px-3 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {ORDER_TYPES.map((t, i) => (
              <button
                key={t}
                type="button"
                disabled={i > 0}
                title={i > 0 ? 'A pending order. Every contract on this platform is market execution.' : undefined}
                aria-pressed={i === 0}
                className={cn(
                  'h-8 shrink-0 rounded px-3 text-[12px] font-semibold transition',
                  i === 0 ? 'bg-[#2b3543] text-white' : 'text-[#8fa2b8] opacity-45',
                )}
              >
                {t}
              </button>
            ))}
          </div>

          {/* 4. Volume: the value with a stepper and the unit selector. */}
          <Row label="Volume">
            <Stepper
              onDown={() => bump(-0.01)}
              onUp={() => bump(0.01)}
              downDisabled={lots <= minLots}
              upDisabled={lots >= maxLots}
              value={lots.toFixed(volDigits)}
              ariaLabel={`Volume ${lots.toFixed(volDigits)} lots`}
              typing={typing?.field === 'volume' ? typing.text : null}
              onType={(text) => setTyping({ field: 'volume', text })}
              onStartTyping={() => setTyping({ field: 'volume', text: lots.toFixed(volDigits) })}
              onCommit={(text) => { const n = Number(text); if (Number.isFinite(n) && n > 0) setLots(n); setTyping(null); }}
            />
            {/* MetaTrader's second unit mode is Margin, "volume expressed as the approximate margin
                to be reserved". The margin on this contract IS the stake, which the row below
                already prints, so the selector states the one unit rather than offering two names
                for the same number. */}
            <span className="shrink-0 rounded bg-[#202933] px-2 py-1 text-[11px] text-[#8fa2b8]" title="MetaTrader's other unit is Margin. The margin on this contract is the stake, which is on the line below.">
              Lots
            </span>
          </Row>

          {/* 5. The volume slider, min to max. */}
          <input
            type="range"
            min={minLots}
            max={maxLots}
            step={0.01}
            value={lots}
            onChange={(e) => setLots(Number(e.target.value))}
            aria-label="Volume slider"
            className="mt-2 h-1 w-full appearance-none rounded bg-[#2b3543] accent-[#3183ff]"
          />

          {/* 6. Margin on the left, free margin on the right. */}
          <div className="mt-2 flex items-baseline text-[11px]">
            <span className="text-[#8fa2b8]">Margin = <span className="font-mono text-white tabular-nums">{money.fmt(stakeCents)}</span></span>
            <span className="ml-auto text-[#8fa2b8]">Free: <span className="font-mono tabular-nums">{money.fmt(Math.max(0, spendable - stakeCents))}</span></span>
          </div>

          {/* 7. MetaTrader's unit control for the levels, with the ratio lock at its end.
                 MetaTrader puts the lock beside the two chips. It sits here instead because the
                 chips have to hold a full price each: with a 32px button and its gaps between them
                 on a 360px screen, a level like 3080.52 was shrunk to 44px of a 52px figure and
                 ellipsized. It is still a level control, on the row that sets how levels read. */}
          <div className="mt-3 flex items-center gap-1">
           <div className="flex min-w-0 flex-1 gap-1 rounded bg-[#202933] p-0.5">
            {LEVEL_UNITS.map((u) => (
              <button
                key={u.id}
                type="button"
                onClick={() => setUnit(u.id)}
                aria-pressed={unit === u.id}
                className={cn(
                  'h-7 flex-1 rounded text-[11px] font-semibold transition',
                  unit === u.id ? 'bg-[#2b3543] text-white' : 'text-[#8fa2b8]',
                )}
              >
                {u.label}
              </button>
            ))}
           </div>
           <button
             type="button"
             onClick={() => setLocked(!locked)}
             aria-pressed={locked}
             aria-label="Lock the take profit to stop loss ratio"
             title="Fix the TP:SL ratio: adjust one level and the other follows."
             className={cn('grid h-8 w-8 shrink-0 place-items-center rounded transition', locked ? 'bg-[#2b3543] text-[#3183ff]' : 'text-[#8fa2b8]')}
           >
             <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-4 w-4" aria-hidden>
               <rect x="5" y="11" width="14" height="9" rx="2" />
               <path d={locked ? 'M8 11V8a4 4 0 018 0v3' : 'M8 11V8a4 4 0 017-2.6'} strokeLinecap="round" />
             </svg>
           </button>
          </div>

          {/* 8. The two chips, in MetaTrader's measured colours. */}
          <div className="mt-2 flex items-start gap-2">
            <LevelChip
              label="SL"
              colour="#DD5B4E"
              value={levelText('sl', levels.slPoints)}
              settable={levelsSettable}
              set={levels.slPoints !== null}
              onDown={() => step('sl', -1)}
              onUp={() => step('sl', 1)}
              onClear={() => edit('sl', null)}
              typing={typing?.field === 'sl' ? typing.text : null}
              onStartTyping={() => setTyping({ field: 'sl', text: levelText('sl', levels.slPoints) === 'not set' ? '' : levelText('sl', levels.slPoints) })}
              onType={(text) => setTyping({ field: 'sl', text })}
              onCommit={(text) => commitLevel('sl', text)}
              /* 9. Where MetaTrader prints the level's money value. */
              note={`Risk ${money.fmt(stakeCents)}`}
              detail="The stop cannot fire: this engine settles a losing contract at expiry and refuses an early close on one. The stake is the most it can lose, whatever the price does."
            />
            <LevelChip
              label="TP"
              colour="#0EB52E"
              value={levelText('tp', levels.tpPoints)}
              settable={levelsSettable}
              set={levels.tpPoints !== null}
              onDown={() => step('tp', -1)}
              onUp={() => step('tp', 1)}
              onClear={() => edit('tp', null)}
              typing={typing?.field === 'tp' ? typing.text : null}
              onStartTyping={() => setTyping({ field: 'tp', text: levelText('tp', levels.tpPoints) === 'not set' ? '' : levelText('tp', levels.tpPoints) })}
              onType={(text) => setTyping({ field: 'tp', text })}
              onCommit={(text) => commitLevel('tp', text)}
              note={earlyCloseEnabled ? `Pays at ${durationLabel(durationS)}` : `Settles at ${durationLabel(durationS)}`}
              detail={earlyCloseEnabled
                ? 'The target closes a contract already running in profit. What it pays rises with elapsed time rather than with the distance to this level.'
                : 'This brand settles every contract at expiry, so no target can close one early.'}
            />
          </div>

          {/* The pair contradicting itself is MetaTrader's red state, and it kills both buttons. */}
          {!sides.buy && !sides.sell ? (
            <p data-levels-invalid="" className="pt-2 text-center text-[11px] text-[#f23645]">
              The stop and the target are on the same side of the price. One has to be above it and
              one below.
            </p>
          ) : !sides.buy ? (
            <p className="pt-2 text-center text-[11px] text-[#8fa2b8]">
              These levels are set for a sell, so only Sell is offered.
            </p>
          ) : null}

          {/* 10 and 11. */}
          <Leader label="Fill policy" value="Fill or Kill" />
          <Leader label="Expiry" value={durationLabel(durationS)} />
          <div className="flex items-baseline gap-2 py-1.5 text-[11px]">
            <span className="text-[#8fa2b8]">Comment</span>
            <span className="ml-auto text-[#8fa2b8]" title="MetaTrader attaches a comment of up to 31 characters to an order. Nothing on this platform reads one back, so the field is not offered.">
              Not carried on this contract
            </span>
          </div>

          {tradeDisabled ? (
            <p data-trade-disabled="" className="pt-1 text-center text-[11px] leading-snug text-[#f0b90b]">
              Trade disabled for {symbol}.{' '}
              <button type="button" onClick={() => { chartSettled(); onDismiss(); }} className="underline underline-offset-2">
                Chart {settledSymbol}
              </button>{' '}
              to place an order.
            </p>
          ) : null}
          {connecting ? <p className="pt-1 text-center text-[11px] text-[#8fa2b8]">Connecting…</p> : null}
          {overBalance && signedIn ? (
            <p className="pt-1 text-center text-[11px] text-[#f0b90b]">Not enough free margin: tap a side to top up.</p>
          ) : null}
        </div>

        {/* 12. Sell and Buy, filled, side by side, in Android's measured colours. */}
        <div className="flex shrink-0 gap-2 border-t border-[#2b3543] p-3">
          <button
            type="button"
            onClick={() => trade('sell')}
            disabled={refused || !sides.sell}
            className="h-12 flex-1 rounded-md text-[14px] font-semibold text-white transition active:brightness-90 disabled:opacity-40"
            style={{ background: '#E5461E' }}
          >
            Sell
          </button>
          <button
            type="button"
            onClick={() => trade('buy')}
            disabled={refused || !sides.buy}
            className="h-12 flex-1 rounded-md text-[14px] font-semibold text-white transition active:brightness-90 disabled:opacity-40"
            style={{ background: '#1C7CDD' }}
          >
            Buy
          </button>
        </div>
      </div>
    </>
  );
}

/**
 * Where the first tap on a level stepper puts it.
 *
 * MetaTrader restores the last distance used rather than inventing one; with nothing stored, a tap
 * on `+` would otherwise set a level one point from the price, which is not a level anyone wants
 * and takes hundreds of taps to move. A hundred points is a round first guess the trader then
 * steps or types.
 */
const DEFAULT_POINTS = 100;

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mt-3 flex items-center gap-2">
      <span className="shrink-0 text-[12px] text-[#8fa2b8]">{label}</span>
      {children}
    </div>
  );
}

function Stepper({
  value, ariaLabel, onDown, onUp, downDisabled, upDisabled, disabled, typing, onType, onStartTyping, onCommit,
}: {
  value: string;
  ariaLabel: string;
  onDown: () => void;
  onUp: () => void;
  downDisabled?: boolean;
  upDisabled?: boolean;
  /** The whole control is inert: there is nothing yet to set a value against. */
  disabled?: boolean;
  typing: string | null;
  onType: (text: string) => void;
  onStartTyping: () => void;
  onCommit: (text: string) => void;
}) {
  // No fixed width: this app gives a labelled button a 44px minimum tap target, which is right on
  // a control that sets money at risk, and fighting it only produced a stepper too narrow for the
  // figure inside it. The layout is built around the 44px instead.
  const btn = 'grid h-8 shrink-0 place-items-center rounded px-1 text-[16px] font-semibold leading-none text-[#3183ff] disabled:opacity-30';
  return (
    <span className="flex min-w-0 flex-1 items-center rounded bg-[#202933]">
      <button type="button" onClick={onDown} disabled={downDisabled === true || disabled === true} aria-label={`Decrease ${ariaLabel}`} className={btn}>−</button>
      {typing === null ? (
        <button
          type="button"
          onClick={onStartTyping}
          disabled={disabled}
          aria-label={ariaLabel}
          className="min-w-0 flex-1 whitespace-nowrap px-0.5 text-center font-mono text-[13px] font-bold tabular-nums disabled:text-[#8fa2b8]"
        >
          {value}
        </button>
      ) : (
        <input
          autoFocus
          inputMode="decimal"
          value={typing}
          onChange={(e) => onType(e.target.value)}
          onBlur={() => onCommit(typing)}
          onKeyDown={(e) => { if (e.key === 'Enter') onCommit(typing); }}
          aria-label={ariaLabel}
          className="w-0 min-w-0 flex-1 bg-transparent px-0.5 text-center font-mono text-[13px] font-bold text-white outline-none tabular-nums"
        />
      )}
      <button type="button" onClick={onUp} disabled={upDisabled === true || disabled === true} aria-label={`Increase ${ariaLabel}`} className={btn}>+</button>
    </span>
  );
}

/**
 * One of MetaTrader's two level chips: a coloured label and a value with a stepper. Android's are a
 * red SL and a green TP; its measured hexes are the caller's.
 *
 * MetaTrader puts the chip inline with the value, and this stacks it above instead. The reason is a
 * measurement, not a preference: this app gives every labelled button a 44px minimum tap target
 * (globals.css), which is right on the one control that sets money at risk. Two of those plus a
 * full price plus the chip is 166px, and half a 360px screen is 164. Inline, the price was shrunk
 * to 50px of the 52 it needs and ellipsized to "30…" — a level the trader cannot read on the
 * control they set it with. Stacked, the stepper gets the column's full width and the figure fits
 * at any phone size, with the chip and its money note sharing the line above.
 */
function LevelChip({
  label, colour, value, set, settable, onDown, onUp, onClear, note, detail, typing, onType, onStartTyping, onCommit,
}: {
  label: string;
  colour: string;
  value: string;
  set: boolean;
  /** False before the first quote: a level is a price, and there is no price to measure from. */
  settable: boolean;
  onDown: () => void;
  onUp: () => void;
  onClear: () => void;
  note: string;
  detail: string;
  typing: string | null;
  onType: (text: string) => void;
  onStartTyping: () => void;
  onCommit: (text: string) => void;
}) {
  return (
    <div className="min-w-0 flex-1">
      <div className="flex items-center gap-1 pb-1">
        <span
          data-level-chip={label}
          className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold text-white"
          style={{ background: colour }}
        >
          {label}
        </span>
        {/* MetaTrader's row 9: the money value of this level. What it says here is argued in the
            component's own header; the title carries the full reason. */}
        <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-[#8fa2b8] tabular-nums" title={detail}>
          {note}
        </span>
        {set ? (
          <button type="button" data-compact="" onClick={onClear} className="shrink-0 text-[10px] text-[#3183ff]">clear</button>
        ) : null}
      </div>
      <Stepper
        value={settable ? value : 'waiting'}
        ariaLabel={`${label} ${settable ? value : 'waiting'}`}
        disabled={!settable}
        onDown={onDown}
        onUp={onUp}
        typing={typing}
        onType={onType}
        onStartTyping={onStartTyping}
        onCommit={onCommit}
      />
    </div>
  );
}

function Leader({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline gap-1 py-1.5">
      <span className="shrink-0 text-[11px] text-[#8fa2b8]">{label}</span>
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
      <span className="shrink-0 font-mono text-[11px] text-[#8fa2b8]">{value}</span>
    </div>
  );
}
