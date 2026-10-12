'use client';

import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api/endpoints';
import type { BrandActivityDto } from '@/lib/api/types';
import { useBrand } from '@/lib/brand/BrandProvider';
import { useDisplayMoney } from '@/lib/money';
import { cn } from '@/lib/cn';
import { selectCards } from '@/lib/game/activityCards';

/**
 * The floating "someone just won" card that pops over the chart.
 *
 * Shown by the CANDLESTICK and WAVE shells. Not by the broker terminal, which is MetaTrader and has
 * no social-proof surface, and never to a MARKETER, whose whole skin exists to remove the financial
 * tells this card is made of.
 *
 * WHERE THE EVENTS COME FROM. The same place the Chat tab's system lines come from, and nowhere
 * else: `GET /api/v1/site/activity` (`api.siteActivity`), on the same query key, the same limit and
 * the same 20s poll as `ChatPane`. That is deliberate on two counts.
 *
 *  1. React Query dedupes it. Two components asking `['siteActivity', slug]` for 40 rows share one
 *     cache entry and one request, so this card costs the screen no extra traffic — it is a second
 *     *view* of the feed the rail already holds, not a second feed.
 *  2. It inherits the server's gate for free. `activity.pg.ts` is the thing that decides what may
 *     appear here: settled deposits, paid withdrawals and winning positions, plus whatever rows the
 *     product owner seeded into `activity_seed` (0193) FOR THIS BRAND. A future reader will wonder
 *     whether a card this promotional needed its own "is this brand allowed social proof?" check —
 *     it does not. A brand with no real activity and no seeds gets an empty list and this renders
 *     nothing. There is no client-side generator here, and there must never be one: every name and
 *     every figure on the card below came off the wire.
 *
 * It is a notification, not a dialog, in exactly the sense `MT5CloseNotice` is one: it takes no
 * focus, it never swallows a pointer event, and the chart and the ticket stay live underneath it.
 * A card that could eat a tap on Higher/Lower would cost the player a trade.
 */
export function ActivityNotice({ className }: {
  /**
   * Where the card sits, as positioning classes on the live region.
   *
   * It is a prop because the two shells that show it have different furniture above the chart: the
   * candlestick screen has one quote band of a known height, the wave has a price strip and a
   * ticker whose heights vary with the viewport. The default is the candlestick placement; the
   * wave passes an offset measured from the chart's own box instead of from the top of the screen.
   */
  className?: string;
} = {}) {
  const brand = useBrand();

  /**
   * Same key/limit/intervals as `ChatPane`'s query — see the note above. If either side changes
   * these, the two stop sharing a cache entry and the screen quietly starts polling twice.
   */
  const { data: activity } = useQuery({
    queryKey: ['siteActivity', brand.slug],
    queryFn: () => api.siteActivity(brand.slug, 40),
    refetchInterval: 20_000,
    staleTime: 15_000,
  });

  const items = activity?.items ?? [];

  const [queue, setQueue] = useState<BrandActivityDto[]>([]);
  const [current, setCurrent] = useState<BrandActivityDto | null>(null);
  const [visible, setVisible] = useState(false);
  const [shown, setShown] = useState(0);
  // Keys of every item already queued, so a row that is still in the server's 40-row window on the
  // next poll is not surfaced again. `seen` is state rather than a ref only because the enqueue
  // effect has to read and write it in the same pass.
  const [seen, setSeen] = useState<ReadonlySet<string>>(() => new Set());
  const [primed, setPrimed] = useState(false);
  /**
   * The names the last few cards carried. A ref, not state: it is read and written inside the
   * enqueue effect and must not retrigger it.
   */
  const lastNamesRef = useRef<string[]>([]);

  // ── What gets queued ────────────────────────────────────────────────────────
  useEffect(() => {
    if (items.length === 0) return;

    /**
     * FIRST LOAD. The window can hold forty rows, every one of them unseen, and firing forty cards
     * at a player who just opened the screen is the behaviour this component is most likely to be
     * hated for. So the backlog is capped; from the next poll on only what the server has newly
     * accepted is fresh, so each event gets at most one card and the screen stops when the brand
     * does.
     *
     * The selection rules themselves — feed ORDER, one card per trader, what counts as seen — live
     * in `lib/game/activityCards` and are unit-tested there. They used to be written inline here,
     * which is how a comment asserting the WRONG feed order survived long enough to put the same
     * trader's fortnight-old wins on every card.
     */
    const { take, seenKeys } = selectCards(
      items, seen, lastNamesRef.current, primed ? Number.POSITIVE_INFINITY : INITIAL_BURST,
    );
    if (seenKeys.length === 0) return;

    setSeen((prev) => {
      const next = new Set(prev);
      for (const k of seenKeys) next.add(k);
      return next;
    });
    if (take.length > 0) {
      // Remembered across batches, so one trader cannot open consecutive cards 20s apart either.
      lastNamesRef.current = [...lastNamesRef.current, ...take.map((t) => t.name.trim().toLowerCase())]
        .slice(-RECENT_NAME_MEMORY);
      setQueue((q) => [...q, ...take]);
    }
    if (!primed) setPrimed(true);
  }, [items, seen, primed]);

  /**
   * ── Take the next card off the queue ──────────────────────────────────────
   *
   * Nothing but bookkeeping happens here. The TIMERS deliberately live in their own effect below,
   * and splitting the two is a bug fix rather than tidying:
   *
   * this effect writes `current` and `queue`, which were also its own dependencies. So React tore
   * the effect down the instant it ran — running the cleanup, which cleared the hide and drop
   * timeouts — and re-ran it, where `if (current)` now returned early and armed nothing. The card
   * was shown and then never hidden: measured in a real browser, it sat at `opacity: 1` for every
   * sample across twelve seconds, which is what "it should only last a few seconds" was describing.
   * `SHOW_MS` had nothing to do with it; no value of it would have helped.
   */
  useEffect(() => {
    if (current || queue.length === 0) return;
    setCurrent(queue[0]!);
    setQueue((q) => q.slice(1));
    setShown((n) => n + 1);
  }, [current, queue]);

  /**
   * ── The life of the card that is up ───────────────────────────────────────
   *
   * Keyed on `current` ALONE, which changes exactly twice per card (null → card → null), so the
   * timers below are armed once and survive every other render. That is the whole fix.
   */
  useEffect(() => {
    if (!current) return;
    // Painted hidden for one frame so the transition has a state to move FROM; under
    // `prefers-reduced-motion` the transition is off and this frame is simply invisible.
    const raf = requestAnimationFrame(() => setVisible(true));
    const hide = setTimeout(() => setVisible(false), SHOW_MS);
    // Dropped only after the exit has run, plus a gap — back-to-back cards with no gap read as one
    // card flickering rather than as two separate events.
    const drop = setTimeout(() => { setVisible(false); setCurrent(null); }, SHOW_MS + EXIT_MS + GAP_MS);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(hide);
      clearTimeout(drop);
    };
  }, [current]);

  if (!current) return null;

  /**
   * A screen reader hears the first few and then nothing. The card is ambient social proof: a
   * polite live region that re-announces every eight seconds for as long as the player keeps the
   * screen open is not information, it is an obstruction, and there is nothing here the player
   * needs — the rail's Chat tab carries the same rows as readable text. After the cap the card is
   * `aria-hidden` and purely decorative.
   */
  const announce = shown <= MAX_ANNOUNCEMENTS;

  return (
    <div
      /**
       * `absolute`, not `fixed`: `AppShell`'s `<main>` is the positioned ancestor, so this is placed
       * against the trade area itself and needs no arithmetic on the top bar — which varies in
       * height and sits above a `NotificationBanners` strip of no fixed height at all.
       *
       * The offsets clear the QuoteBar (h-10 phone / h-16 desktop) and nothing else, which puts the
       * card in empty chart space. On desktop it is pinned LEFT on purpose: the trading panel and
       * its Higher/Lower buttons live in the right-hand rail, and the left of the chart is the one
       * region of this screen with nothing to cover.
       */
      className={cn(
        'pointer-events-none absolute inset-x-0 z-30 flex justify-center px-3 md:justify-start md:px-6',
        className ?? 'top-11 md:top-[72px]',
      )}
      role="status"
      aria-live="polite"
      aria-atomic="true"
    >
      <div
        aria-hidden={announce ? undefined : true}
        className={cn(
          // `max-w-[18rem]` plus the wrapper's `px-3` leaves a real gutter at 320px.
          'relative w-full max-w-[18rem] rounded-xl border border-border bg-surface px-3 py-2.5 shadow-[0_8px_24px_rgba(0,0,0,0.55)]',
          // Never `pointer-events-auto`, unlike MT5CloseNotice: this card has nothing to press, so
          // it has no reason to be in the way. It dismisses itself.
          'transition-all duration-300 ease-out motion-reduce:transition-none',
          visible ? 'translate-y-0 opacity-100' : '-translate-y-2 opacity-0',
        )}
      >
        {/* The mock's sparkle, top-right. Decorative, and offset outside the corner radius. */}
        <Sparkle className="absolute -right-1 -top-1 h-3.5 w-3.5 text-warn" />

        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-warn/15 ring-1 ring-warn/40">
            <Coin className="h-5 w-5 text-warn" />
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-baseline gap-1.5">
              <span className="truncate text-xs font-semibold text-fg">{current.name}</span>
              <span className="shrink-0 text-[10px] text-muted">{VERB[current.kind]}</span>
            </div>
            <div className="truncate text-base font-bold leading-tight tabular-nums text-up">
              <Amount cents={current.amountCents} />
            </div>
            <div className="flex min-w-0 items-center gap-1 text-[10px] text-muted">
              <Check className="h-2.5 w-2.5 shrink-0 text-accent" />
              <span className="truncate">{PROOF[current.kind]}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/** The amount in the brand's own wallet formatter, so a foreign or marketer brand is not told KES. */
function Amount({ cents }: { cents: number }) {
  const { fmt } = useDisplayMoney();
  return <>+{fmt(cents)}</>;
}

/** The first line's verb. */
const VERB: Record<BrandActivityDto['kind'], string> = {
  win: 'won',
  withdrawal: 'withdrew',
  deposit: 'deposited',
};

/**
 * The third line, and the one thing on this card that could become a lie.
 *
 * The mock prints "Verified withdrawal · Mpesa Cash" under every row, including the wins. That is
 * two separate inventions: a won trade is not a withdrawal, and a won trade has not been paid out
 * to anything — it credited a trading balance that the player still has to withdraw. So the label
 * is derived from `kind` and says only what that kind supports.
 *
 * The rail is named "M-Pesa", which is the codebase's own wording and not a borrowed brand: the
 * server labels every STK rail that way regardless of which gateway moved the money, and the
 * gateway's own brand is never shown to a player (docs/35, `DepositPanel`). "Mpesa Cash" is the
 * mock's product, not a thing this one has.
 */
const PROOF: Record<BrandActivityDto['kind'], string> = {
  win: 'Settled trade · Paid to balance',
  withdrawal: 'Verified withdrawal · M-Pesa',
  deposit: 'Confirmed deposit · M-Pesa',
};

/** How many of the rows already in the feed may surface when the screen first opens. */
const INITIAL_BURST = 3;
/** How many cards a screen reader hears before the region goes quiet. */
const MAX_ANNOUNCEMENTS = 3;
/**
 * Three seconds on screen, as specified.
 *
 * It is enough to read a name and a figure — which is all the card carries — and short enough that
 * a card arriving while the player is choosing a stake is gone before it becomes an irritation.
 * The exit is excluded: `EXIT_MS` runs after this, so the card is legible for the full three.
 */
/** How many recently-shown traders are remembered when enforcing one card each. */
const RECENT_NAME_MEMORY = 4;
const SHOW_MS = 3_000;
const EXIT_MS = 300;
const GAP_MS = 2_500;

/* The three glyphs the card needs. Inline rather than in `icons.tsx`, which is the tab-bar set and
   draws to a different weight; these are solid marks at 10–20px. */

function Coin({ className }: { className: string }) {
  return (
    <svg viewBox="0 0 24 24" className={cn('shrink-0', className)} aria-hidden="true" focusable="false" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="8.5" />
      <path d="M14.5 9.2a3 3 0 0 0-2.5-1.2c-1.5 0-2.5.8-2.5 1.9 0 1.2 1 1.7 2.5 2s2.6.8 2.6 2.1-1.1 2-2.6 2a3 3 0 0 1-2.6-1.3M12 6.3v1.7M12 16v1.7" />
    </svg>
  );
}

function Check({ className }: { className: string }) {
  return (
    <svg viewBox="0 0 24 24" className={cn('shrink-0', className)} aria-hidden="true" focusable="false" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m4 12.5 5.5 5.5L20 6" />
    </svg>
  );
}

function Sparkle({ className }: { className: string }) {
  return (
    <svg viewBox="0 0 24 24" className={cn('shrink-0', className)} aria-hidden="true" focusable="false" fill="currentColor">
      <path d="M12 2.5l1.9 5.6 5.6 1.9-5.6 1.9L12 17.5l-1.9-5.6L4.5 10l5.6-1.9L12 2.5Z" />
    </svg>
  );
}
