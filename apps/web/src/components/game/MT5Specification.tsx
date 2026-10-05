'use client';

import { useEffect, useRef } from 'react';
import {
  SPEC_GLYPH, SPEC_SESSION_DAYS, SPEC_SESSION_SPAN, specRows, type SpecInput,
} from '@/lib/game/symbolSpec';
import { cn } from '@/lib/cn';

/**
 * MetaTrader's Specification dialog, from `contract_specification.png`.
 *
 * Titled just `Specification`, with a yellow badge. A blue header line carries the symbol and its
 * description ("EURUSD, Euro vs US Dollar"), then a two-column list with a type glyph against each
 * row, the label left and the value right-aligned, then the Sessions block, then a single `Close`
 * button. See docs/mt5/02-toolbox-and-panels.md section 5h.
 *
 * Which rows appear is decided in lib/game/symbolSpec, where each omission is argued. MetaQuotes
 * states that "which fields appear depends on instrument type and broker", so a row that has no
 * meaning for this instrument is left out rather than printed empty, which is MetaTrader's own
 * behaviour and the reason there are no swap rows on a contract that expires in seconds.
 */
export function MT5Specification({ spec, onDismiss }: { spec: SpecInput; onDismiss: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onDismiss(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onDismiss]);

  const rows = specRows(spec);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Specification"
      className="fixed inset-0 z-[85] flex flex-col bg-[#0f1720] text-white sm:items-center sm:justify-center sm:bg-black/60 sm:p-4"
    >
      <div className="flex min-h-0 w-full flex-1 flex-col bg-[#0f1720] sm:h-[72vh] sm:max-w-[420px] sm:flex-none sm:rounded-sm sm:border sm:border-[#2b3543]">
        <div className="flex items-center gap-2 border-b border-[#2b3543] px-3 py-2.5">
          <span aria-hidden className="grid h-4 w-4 shrink-0 place-items-center rounded-[2px] bg-[#f0b90b] text-[10px] font-black text-[#0f1720]">$</span>
          <span className="flex-1 truncate text-[15px] font-semibold leading-tight">Specification</span>
          <button type="button" onClick={onDismiss} aria-label="Close" className="shrink-0 px-1 text-[18px] leading-none text-[#8fa2b8] transition hover:text-white">×</button>
        </div>

        {/* MetaTrader's blue header line: the symbol, then its description. */}
        <div className="shrink-0 bg-[#3183ff] px-3 py-1.5 text-[12px] font-semibold text-white">
          {spec.symbol}, {spec.description}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          <dl className="text-[11px]">
            {rows.map((r) => (
              <div key={r.label} className="flex items-baseline gap-2 border-b border-[#2b3543]/60 px-3 py-1.5">
                <span aria-hidden className="w-5 shrink-0 font-mono text-[9px] text-[#8fa2b8]">{SPEC_GLYPH[r.kind]}</span>
                <dt className="min-w-0 flex-1 truncate text-[#8fa2b8]">{r.label}</dt>
                <dd className="shrink-0 text-right font-mono tabular-nums text-white">{r.value}</dd>
              </div>
            ))}
          </dl>

          {/* MetaTrader's Sessions block: a Quotes column and a Trade column, one row per weekday. */}
          <div className="mt-2 px-3 pb-3">
            <div className="mb-1 flex gap-2 border-b border-[#2b3543] pb-1 text-[9px] font-semibold uppercase tracking-wider text-muted">
              <span className="flex-1">Sessions</span>
              <span className="w-24 text-right">Quotes</span>
              <span className="w-24 text-right">Trade</span>
            </div>
            {SPEC_SESSION_DAYS.map((d) => (
              <div key={d} className="flex gap-2 py-0.5 text-[11px]">
                <span className="flex-1 text-[#8fa2b8]">{d}</span>
                <span className="w-24 text-right font-mono tabular-nums">{SPEC_SESSION_SPAN}</span>
                <span className="w-24 text-right font-mono tabular-nums">{SPEC_SESSION_SPAN}</span>
              </div>
            ))}
            <p className="mt-2 text-[10px] leading-snug text-[#8fa2b8]">
              This market never closes, so quotes and trading run every day.
            </p>
          </div>
        </div>

        {/* One button, as MetaTrader has. */}
        <div className="flex shrink-0 items-center justify-end border-t border-[#2b3543] px-3 py-2.5">
          <button
            type="button"
            onClick={onDismiss}
            className="h-8 rounded-sm bg-[#3183ff] px-6 text-[11px] font-semibold text-white transition hover:brightness-110"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * MetaTrader's Market Watch context menu, verbatim, including its capital O in "Depth Of Market"
 * and the shortcuts it prints.
 *
 * MetaQuotes ships TWO versions of this menu on the same help page. The older one carries
 * `Use System Colors`; the newer one drops it entirely and inserts `Subscribe to Realtime Datafeed`
 * and `Fundamental Data` after `Specification`. This is the NEWER one, and the prose on that same
 * page still tells you to enable a checkbox the dialog no longer has.
 *
 * `Options Board` is greyed in MetaTrader's own screenshot, so it is greyed here too. `Auto Arrange`
 * is UNCHECKED here, unlike in every Toolbox tab, which is also MetaTrader's own state. The rest are
 * disabled where this platform genuinely cannot do them, each with its reason: this brand quotes one
 * symbol, so hiding it or sorting a list of one does nothing, and there is no order book behind
 * Depth Of Market at all.
 */
export interface MarketWatchMenuItem {
  label: string;
  shortcut?: string;
  unavailable?: string;
  separatorBefore?: boolean;
  checked?: boolean;
  onPick?: () => void;
}

const ONE_SYMBOL =
  'This brand quotes one symbol, so there is no list to change.';
const NO_BOOK =
  'Depth of Market needs an order book. Contracts here are struck against the brand, not matched against other orders, so there is no book to show.';

export function marketWatchMenu(opts: {
  onSpecification: () => void;
  onNewOrder?: (() => void) | undefined;
}): MarketWatchMenuItem[] {
  return [
    { label: 'New Order', ...(opts.onNewOrder ? { onPick: opts.onNewOrder } : { unavailable: 'The order ticket is already on screen.' }) },
    { label: 'Chart Window', unavailable: 'The chart for this symbol is already on screen.' },
    { label: 'Tick Chart', unavailable: 'This feed is served as bars from M1 up, so there is no tick series to chart.' },
    { label: 'Depth Of Market', shortcut: 'Alt+B', unavailable: NO_BOOK },
    // Greyed in MetaTrader's own screenshot.
    { label: 'Options Board', unavailable: 'Greyed in MetaTrader too: there are no options on this instrument.' },
    { label: 'Specification', onPick: opts.onSpecification },
    { label: 'Subscribe to Realtime Datafeed', unavailable: 'The quote here is already the live feed; there is no delayed one to upgrade from.' },
    { label: 'Fundamental Data', unavailable: 'MetaTrader links out to twelve financial-news sites from here. This platform links to none.' },
    { label: 'Popup Prices', shortcut: 'F10', unavailable: ONE_SYMBOL },
    { label: 'Hide', shortcut: 'Delete', separatorBefore: true, unavailable: ONE_SYMBOL },
    { label: 'Hide All', unavailable: ONE_SYMBOL },
    { label: 'Show All', unavailable: ONE_SYMBOL },
    { label: 'Symbols', shortcut: 'Ctrl+U', unavailable: ONE_SYMBOL },
    { label: 'Sets', unavailable: ONE_SYMBOL },
    { label: 'Sort', unavailable: ONE_SYMBOL },
    { label: 'Export', unavailable: 'Quote export is not built on this platform.' },
    // The newer menu has no `Use System Colors`.
    { label: 'Show Milliseconds', separatorBefore: true, unavailable: 'This feed is not quoted to the millisecond.' },
    { label: 'Auto Remove Expired', checked: true, unavailable: 'Nothing expires out of a one-symbol list.' },
    { label: 'Auto Arrange', unavailable: ONE_SYMBOL },
    { label: 'Grid', checked: true, unavailable: ONE_SYMBOL },
    { label: 'Columns', separatorBefore: true, unavailable: ONE_SYMBOL },
  ];
}

export function MT5MarketWatchMenu({ at, items, onDismiss }: {
  at: { x: number; y: number };
  items: readonly MarketWatchMenuItem[];
  onDismiss: () => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    /**
     * Only a mousedown OUTSIDE the menu closes it.
     *
     * Dismissing on any mousedown looked equivalent and was not: a click is mousedown then mouseup,
     * so the menu unmounted on the way down and the item's own onClick never ran. Every entry in
     * this menu was therefore dead.
     */
    const away = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) onDismiss(); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onDismiss(); };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', away);
      document.removeEventListener('keydown', esc);
    };
  }, [onDismiss]);

  return (
    <div
      ref={box}
      role="menu"
      aria-label="Market Watch"
      className="fixed z-[90] min-w-52 rounded-sm border border-[#2b3543] bg-[#202933] py-1 text-[11px] shadow-xl"
      style={{ left: at.x, top: at.y }}
    >
      {items.map((it) => (
        <div key={it.label}>
          {it.separatorBefore ? <div className="my-1 h-px bg-[#2b3543]" /> : null}
          <button
            type="button"
            role="menuitem"
            title={it.unavailable}
            disabled={it.unavailable !== undefined}
            onClick={() => { it.onPick?.(); onDismiss(); }}
            className={cn(
              'flex w-full items-center gap-2 px-3 py-1.5 text-left transition',
              it.unavailable ? 'cursor-not-allowed text-[#4a5666]' : 'text-white hover:bg-[#3183ff]',
            )}
          >
            <span aria-hidden className="w-3 shrink-0 text-[#41be56]">{it.checked ? '✓' : ''}</span>
            <span className="flex-1">{it.label}</span>
            {it.shortcut ? <span className="shrink-0 text-[10px] text-[#8fa2b8]">{it.shortcut}</span> : null}
          </button>
        </div>
      ))}
    </div>
  );
}
