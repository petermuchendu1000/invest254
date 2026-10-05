'use client';

import Link from 'next/link';
import { cn } from '@/lib/cn';

/**
 * The pieces every MetaTrader screen off the trade surface is built from.
 *
 * History, Settings and Funds each need the same three things — a title bar flush under the app bar,
 * a figure summary with MetaTrader's dotted leader, and a two-line list row. They were written twice
 * before this file existed; a third copy is where a set of screens stops looking like one product,
 * so they live here once.
 *
 * Colours are the sampled MT5 dark theme (lib/ui/mt5.ts), written as literals because Tailwind needs
 * them at build time.
 */

/**
 * MetaTrader's title bar: the screen name, optionally over a second line, with the screen's own
 * controls on the right. Sticky under the app bar (h-14) so it behaves as one blue band.
 */
export function MT5TitleBar({
  title, subtitle, actions, children, embedded = false,
}: {
  title: string;
  subtitle?: string | undefined;
  actions?: React.ReactNode;
  /** Tabs, which MetaTrader draws inside the bar rather than under it. */
  children?: React.ReactNode;
  /**
   * The bar is inside a scroller of its own rather than on a page that scrolls under the app bar.
   *
   * On a ROUTE the whole page scrolls beneath a 56px fixed app bar, so the bar sticks 56px down.
   * Inside the phone shell's tab the screen has its own scroll container that already starts below
   * the app bar, and the same offset pushed the blue band down by a 56px strip of empty black on
   * first paint — a sticky element whose natural position is above its threshold is shifted to it
   * immediately, before any scrolling happens.
   */
  embedded?: boolean;
}) {
  return (
    <div className={cn('sticky z-20 bg-[#3183ff]', embedded ? 'top-0' : 'top-14')}>
      <div className={cn('flex items-center gap-3 px-3', subtitle ? 'pb-1 pt-2' : 'py-2.5')}>
        <div className="min-w-0">
          {subtitle ? <div className="text-[11px] leading-tight text-white/75">{title}</div> : null}
          <div className={cn('truncate font-semibold leading-tight', subtitle ? 'text-[15px]' : 'text-[15px]')}>
            {subtitle ?? title}
          </div>
        </div>
        {actions ? <div className="relative ml-auto flex items-center gap-1">{actions}</div> : null}
      </div>
      {children}
    </div>
  );
}

/**
 * A figure in MetaTrader's summary block: the label, a dotted leader, the value in blue.
 *
 * The leader is what stops the block reading as a plain table, and it is capped on a wide window —
 * stretched across a desktop it stops reading as a leader at all.
 */
export function MT5SummaryLine({ label, value, tone }: { label: string; value: string; tone?: 'bad' | undefined }) {
  return (
    <div className="flex items-baseline gap-2 py-0.5">
      <span className="shrink-0 text-[13px] font-semibold">{label}:</span>
      <span aria-hidden className="min-w-4 flex-1 translate-y-[-3px] border-b border-dotted border-[#2b3543]" />
      <span className={cn('shrink-0 font-mono text-[13px] font-semibold tabular-nums', tone === 'bad' ? 'text-[#f23645]' : 'text-[#4597ff]')}>
        {value}
      </span>
    </div>
  );
}

/** The container those figures sit in. */
export function MT5Summary({ children }: { children: React.ReactNode }) {
  return <div className="border-b border-[#2b3543] px-3 py-2 lg:max-w-md">{children}</div>;
}

/** A group heading on a settings-style list. */
export function MT5Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="border-t border-[#2b3543] px-3 pb-1.5 pt-4 text-[12px] font-bold uppercase tracking-wide text-white">
        {title}
      </h2>
      <div className="border-t border-[#2b3543]">{children}</div>
    </section>
  );
}

/**
 * One list row: the label, the current state under it, and at most one thing on the right —
 * MetaTrader's checkbox, a value, or a chevron.
 *
 * The sub-label WRAPS rather than clipping. On MetaTrader's own screens it carries the setting's
 * current state, so it is the one part of the row that must not be cut short.
 */
export function MT5Row({
  label, sub, subTone, value, check, control, href, onClick, chevron, tone, disabled,
}: {
  label: React.ReactNode;
  sub?: React.ReactNode;
  subTone?: 'ok' | 'bad' | 'neutral' | undefined;
  value?: React.ReactNode;
  check?: boolean | undefined;
  control?: React.ReactNode;
  href?: string | undefined;
  onClick?: (() => void) | undefined;
  chevron?: boolean | undefined;
  tone?: 'bad' | undefined;
  disabled?: boolean | undefined;
}) {
  const body = (
    <>
      <span className="min-w-0 flex-1">
        <span className={cn('block truncate text-[15px] leading-tight', tone === 'bad' ? 'text-[#f23645]' : 'text-white')}>
          {label}
        </span>
        {sub ? (
          <span
            className={cn(
              'mt-0.5 line-clamp-2 block break-words text-[13px] leading-tight',
              subTone === 'ok' ? 'text-[#41be56]' : subTone === 'bad' ? 'text-[#f23645]' : 'text-[#8fa2b8]',
            )}
          >
            {sub}
          </span>
        ) : null}
      </span>
      {control ?? null}
      {value !== undefined && value !== null ? (
        <span className="shrink-0 font-mono text-[13px] text-[#4597ff]">{value}</span>
      ) : null}
      {check !== undefined ? <MT5Check on={check} /> : null}
      {chevron ? <span aria-hidden className="shrink-0 text-[#8fa2b8]">›</span> : null}
    </>
  );

  const className = cn(
    'flex w-full items-center gap-3 border-b border-[#2b3543] px-3 py-3 text-left',
    disabled && 'opacity-50',
  );

  if (href && !disabled) return <Link href={href} className={className}>{body}</Link>;
  // A row carrying its own control is not itself a button: the control would swallow its taps, and a
  // nested interactive element is invalid markup.
  if (onClick && !control) {
    return <button type="button" onClick={onClick} disabled={disabled} className={className}>{body}</button>;
  }
  return <div className={className}>{body}</div>;
}

/** MetaTrader's square checkbox: an outline when off, solid blue with a white tick when on. */
export function MT5Check({ on }: { on: boolean }) {
  return (
    <span
      className={cn(
        'grid h-5 w-5 shrink-0 place-items-center rounded-[2px] border',
        on ? 'border-[#3183ff] bg-[#3183ff]' : 'border-[#8fa2b8]',
      )}
    >
      {on ? (
        <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 text-white" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M5 12.5l5 5 9-10" />
        </svg>
      ) : null}
    </span>
  );
}

/**
 * The two-line entry MetaTrader lists a record as: what it is and when, over the size and the
 * result. Used for orders, deals, positions and balance operations.
 */
export function MT5Entry({
  title, time, detail, result, onOpen,
}: {
  title: React.ReactNode;
  time: string;
  detail: React.ReactNode;
  result: React.ReactNode;
  onOpen?: (() => void) | undefined;
}) {
  const Tag = onOpen ? 'button' : 'div';
  return (
    <Tag
      {...(onOpen ? { type: 'button' as const, onClick: onOpen } : {})}
      className="flex w-full items-start gap-3 border-b border-[#2b3543] px-3 py-2 text-left"
    >
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13px] font-semibold leading-tight">{title}</div>
        <div className="mt-0.5 truncate font-mono text-[12px] leading-tight text-[#8fa2b8]">{detail}</div>
      </div>
      <div className="shrink-0 text-right">
        <div className="font-mono text-[11px] leading-tight text-[#8fa2b8]">{time}</div>
        <div className="mt-0.5 font-mono text-[12px] font-semibold leading-tight tabular-nums">{result}</div>
      </div>
    </Tag>
  );
}

/** A signed amount: MetaTrader's blue for a credit, red for a debit. */
export function MT5Amount({ cents, fmt }: { cents: number | null; fmt: (cents: number) => string }) {
  if (cents === null) return <span className="text-[#8fa2b8]">-</span>;
  return <span className={cents < 0 ? 'text-[#f23645]' : 'text-[#3183ff]'}>{fmt(cents)}</span>;
}

export function MT5Empty({ children }: { children: React.ReactNode }) {
  return <div className="px-3 py-10 text-center text-[13px] text-[#8fa2b8]">{children}</div>;
}
