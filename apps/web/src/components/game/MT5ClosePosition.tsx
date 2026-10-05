'use client';

import { useEffect } from 'react';
import { lotsOfStake } from '@invest254/shared/account';
import { useDisplayMoney } from '@/lib/money';
import { useTakeProfitStore } from '@/lib/game/takeprofit';
import { cn } from '@/lib/cn';
import type { ActivePosition } from '@/lib/game/betting';

/**
 * MetaTrader's Close position screen.
 *
 * This replaces a button that was invented. MT5 has a real form for closing a position, and it was
 * measured off MetaQuotes' own screenshots rather than remembered: see docs/mt5/01-order-and-close-dialogs.md.
 *
 * The model here is the ANDROID close screen, because this product is phone first and the Android
 * screen is the closest original:
 *
 *   title     "Close position #57040054558"
 *   subtitle  "buy 0.61 GBPUSD at 1.33629"
 *   body      volume stepper, prices, S/L and T/P rows, fill policy, the Attention warning
 *   action    TEXT, not a filled button: "CLOSE WITH PROFIT 334.89", the words in orange
 *             (#FF9300 measured) and the amount in blue
 *
 * The desktop variant is a different thing again: the same Order window retitled
 * "Position: #328906 buy 0.01 EURUSD 1.16082" with a pale cream button reading
 * "Close #328906 buy 0.01 EURUSD 1.16082 by Market". That one needs the Order window itself, which
 * is the next piece of work, so it is deliberately not faked here.
 *
 * Where this contract differs from a MetaTrader position, the form says so rather than rendering a
 * control that cannot work:
 *   - Volume is a VALUE, not a stepper. MT5 closes part of a position by typing a smaller volume;
 *     this engine settles a contract whole, so a stepper here would be a lie.
 *   - S/L is the stake. A losing contract is never sellable, so the most it can lose is fixed.
 *   - This screen only ever opens on a position that CAN be closed, which here means one in profit,
 *     so "CLOSE WITH PROFIT" is always the truthful label.
 */
const ORANGE = '#ff9300'; // measured from MetaQuotes' own Android close_position.png
const SL_ORANGE = '#dd5b4e'; // the S/L chip red/orange from the mobile order form
const TP_GREEN = '#0eb52e'; // the T/P chip green from the mobile order form

export function MT5ClosePosition({
  pos, symbol, digits, price, openPrice, onDismiss, onConfirm, busy,
}: {
  pos: ActivePosition;
  symbol: string;
  digits: number;
  /** The live price, already mapped through the day anchor. */
  price: number | null;
  /**
   * The OPEN price, mapped the same way. MetaTrader quotes this in the symbol's digits on the
   * subtitle line; the raw engine rate is a 0..1 curve value and must never reach the screen.
   */
  openPrice: number | null;
  onDismiss: () => void;
  onConfirm: () => void;
  busy: boolean;
}) {
  const money = useDisplayMoney();
  const tpTarget = useTakeProfitStore((s) => s.targetCents);
  const lots = lotsOfStake(pos.stakeCents);

  // Escape closes the screen, as every MetaTrader dialog does.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onDismiss(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onDismiss]);

  const px = (v: number | null) => (v === null ? '-' : v.toFixed(digits));

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Close position ${ticketOf(pos)}`}
      className="fixed inset-0 z-[80] flex flex-col bg-[#0f1720] text-white sm:items-center sm:justify-center sm:bg-black/60 sm:p-4"
    >
      <div className="flex min-h-0 w-full flex-1 flex-col bg-[#0f1720] sm:h-auto sm:max-w-[420px] sm:flex-none sm:rounded-sm sm:border sm:border-[#2b3543]">
        {/* Title block: MetaTrader names the ticket on the first line and the deal on the second. */}
        <div className="flex items-start gap-2 border-b border-[#2b3543] px-3 py-2.5">
          <button
            type="button"
            onClick={onDismiss}
            aria-label="Back"
            className="-ml-1 shrink-0 px-1 text-[20px] leading-none text-[#8fa2b8] transition hover:text-white"
          >
            ‹
          </button>
          <span className="min-w-0">
            <span className="block truncate text-[15px] font-semibold leading-tight">
              Close position #{ticketOf(pos)}
            </span>
            <span className="block truncate font-mono text-[12px] leading-tight text-[#8fa2b8]">
              {pos.direction} {lots} {symbol} at {px(openPrice)}
            </span>
          </span>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {/* Volume. A value, not a stepper: see the note at the top of this file. */}
          <Row label="Volume">
            <span className="font-mono text-[14px] font-semibold tabular-nums">{lots}</span>
          </Row>
          <p className="px-3 pb-2 text-[11px] leading-snug text-[#8fa2b8]">
            This contract closes in full. Partial close is a MetaTrader position feature that a
            fixed-term contract does not have.
          </p>

          {/* The price, large, as the mobile form shows it. One price, not two: this feed quotes a
              single rate, and rendering a fabricated bid/ask spread would be the exact kind of
              invention this screen exists to undo. */}
          <div className="flex items-end justify-center gap-2 border-y border-[#2b3543] px-3 py-4">
            <span className="font-mono text-[32px] font-semibold leading-none tabular-nums">
              {px(price)}
            </span>
          </div>

          {/* MetaTrader's S/L is a PRICE. This contract has no price-level stop at all: it settles
              at expiry and cannot lose more than its stake. So the row states the amount and says
              which it is, rather than putting money where a price belongs. */}
          <Row label="S / L" accent={SL_ORANGE}>
            <span className="font-mono text-[13px] tabular-nums text-[#8fa2b8]">
              {money.fmt(pos.stakeCents)} <span className="text-[11px]">(max loss)</span>
            </span>
          </Row>
          <Row label="T / P" accent={TP_GREEN}>
            <span className="font-mono text-[13px] tabular-nums text-[#8fa2b8]">
              {tpTarget === null ? 'not set' : money.fmt(tpTarget)}
            </span>
          </Row>
          <Row label="Fill policy">
            <span className="font-mono text-[13px] text-[#8fa2b8]">Fill or Kill</span>
          </Row>

          {/* MetaTrader's own warning, verbatim from the Android close screen. */}
          <p className="px-3 py-3 text-[11px] leading-snug text-[#8fa2b8]">
            Attention! The trade will be executed at market conditions, difference with requested
            price may be significant!
          </p>
        </div>

        {/* The action. MetaTrader's Android close screen makes this TEXT, not a filled button:
            the words in orange and the amount in blue. */}
        <button
          type="button"
          onClick={onConfirm}
          disabled={busy}
          className="flex w-full shrink-0 items-center justify-center gap-2 border-t border-[#2b3543] px-3 py-4 text-[14px] font-bold uppercase tracking-wide transition disabled:opacity-50"
        >
          <span style={{ color: ORANGE }}>{busy ? 'Closing…' : 'Close with profit'}</span>
          {busy ? null : (
            <span className="font-mono tabular-nums text-[#3183ff]">{money.fmt(pos.livePnlCents)}</span>
          )}
        </button>
      </div>
    </div>
  );
}

function Row({ label, children, accent }: { label: string; children: React.ReactNode; accent?: string }) {
  return (
    <div
      className={cn('flex items-center justify-between gap-3 border-b px-3 py-2.5')}
      style={{ borderColor: accent ?? '#2b3543' }}
    >
      <span className="text-[12px] uppercase tracking-wide text-[#8fa2b8]">{label}</span>
      {children}
    </div>
  );
}

/** MetaTrader shows a ticket, and so do we: the engine's position id, shortened as the tables do. */
function ticketOf(pos: ActivePosition): string {
  return pos.positionId ? pos.positionId.slice(0, 8) : '…';
}
