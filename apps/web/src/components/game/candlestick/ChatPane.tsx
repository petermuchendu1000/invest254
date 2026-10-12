'use client';

import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api/endpoints';
import type { BrandActivityDto } from '@/lib/api/types';
import { useBrand } from '@/lib/brand/BrandProvider';
import { useSession } from '@/lib/auth/session';
import { useAuthUi } from '@/lib/auth/ui';
import { useDisplayMoney } from '@/lib/money';
import { useGameSocket } from '@/lib/game/GameSocketProvider';
import { useOnlineDisplay, isStaffRole } from '@/lib/game/onlineDisplay';
import { usePlayerChat, useSendChat, useMarkChatRead } from '@/lib/chat/liveChat';
import { ChatComposer } from '@/components/chat/ChatParts';
import { cn } from '@/lib/cn';

/**
 * The rail's Chat tab: the brand's activity feed, with the player's own conversation in it.
 *
 * The mock's version is a public room whose feed is GENERATED client-side — the page it was copied
 * from returns its rows typed `system_simulated`, naming withdrawals nobody made, and its
 * `/api/wins` is one username repeated with random amounts. Nothing is invented HERE: every row
 * rendered below came from `GET /site/activity`, which merges this brand's seeded rows with its
 * real ones server-side and will not send a row for an event that did not occur. The client's only
 * liberties are (a) which of the returned rows are on screen at a given moment and (b) the English
 * they are worded in — see ROTATION and PHRASES below. It never manufactures a row, an amount, a
 * name or an outcome, because a feed of invented payouts sitting above a deposit button is a lie
 * told to the person about to deposit, and it is also the easiest thing in the product to get sued
 * over.
 *
 * Rows carry a first name, an amount and a coarse age and nothing else — see `activity.pg.ts` for
 * what the server refuses to send. Below them sits the player's own customer-care thread, which is
 * the only conversation this product actually has.
 */
export function ChatPane() {
  const brand = useBrand();
  const token = useSession((s) => s.token);
  const role = useSession((s) => s.user?.role);
  const openAuth = useAuthUi((s) => s.openAuth);
  /**
   * The engine's OWN connected-socket count for this brand, broadcast on every connect and close
   * (`online` in multiengine.ts). This pane is only ever mounted inside the candlestick screen's
   * <GameSocketProvider>, so the socket is already open for the chart and this costs no connection.
   */
  const { online, status } = useGameSocket();
  /**
   * The figure printed in the header is the shared one — staff see the engine's true count, every
   * other viewer sees the synthetic crowd figure the product owner specified. It lives in
   * `lib/game/onlineDisplay.ts` (and is used identically by PriceHeader) precisely so there is ONE
   * place where that claim is made and documented; a second implementation here would be a second
   * number to keep honest, and the two would eventually disagree on the same screen.
   */
  const displayOnline = useOnlineDisplay(online, role);
  const { data } = usePlayerChat(true, 3_000);
  const send = useSendChat();
  const markRead = useMarkChatRead();

  /**
   * Polled rather than streamed: the feed is ambient, and a socket for it would be a second live
   * connection beside the price one for something nobody is waiting on. 20s is slower than the
   * chat's own 3s for the same reason.
   */
  const { data: activity } = useQuery({
    queryKey: ['siteActivity', brand.slug],
    // The server caps at 40 and the query has no time filter, so asking for the cap is simply "as
    // full as this brand's history allows". Asking for the full 40 also gives the rotation below
    // something to rotate: a window of 10 drawn from 40 can keep producing lines the viewer has
    // not seen for minutes, where a window of 10 drawn from 10 cannot.
    queryFn: () => api.siteActivity(brand.slug, 40),
    refetchInterval: 20_000,
    staleTime: 15_000,
  });

  /**
   * The poll's rows, prepared once per response and sorted NEWEST FIRST.
   *
   * `receivedAt` is the wall clock at which this response's `agoSeconds` were true. Ages are then
   * derived at render time as `agoSeconds + elapsed`, so a line that landed saying "just now" is
   * saying "1m ago" a minute later without waiting for the next poll — otherwise every age on
   * screen would sit frozen for a full 20s and then jump, which is exactly the tell we are trying
   * not to produce. (Deliberately impure inside useMemo: the value wanted IS "when did this arrive",
   * and the memo runs exactly once per response.)
   */
  const pool = useMemo<Row[]>(() => {
    const rows = activity?.items ?? [];
    const receivedAt = Date.now();
    // React keys must survive a rotation, so they are derived from the ROW's content rather than
    // its position: a line that stays on screen across a roll keeps its key, keeps its DOM node and
    // does not replay its entry animation. The `#n` suffix disambiguates two genuinely identical
    // rows (same name, same amount, same age), which the server is allowed to return.
    const seen = new Map<string, number>();
    const prepared = rows.map((item) => {
      const base = `${item.kind}:${item.name}:${item.amountCents}:${item.agoSeconds}`;
      const n = (seen.get(base) ?? 0) + 1;
      seen.set(base, n);
      return { item, key: `${base}#${n}`, receivedAt };
    });
    return prepared.sort((a, b) => a.item.agoSeconds - b.item.agoSeconds);
  }, [activity]);

  /**
   * ROTATION — which of the pool's rows are on screen right now.
   *
   * The feed should read as a room that keeps saying things, not as a list that is replaced four
   * times a minute, so every 5–10s a fresh window is drawn from the pool.
   *
   * The trap in reordering an aged feed is that the ages give it away: a column reading
   * "2m ago / just now / 1h ago" is instantly broken, and a feed that looks broken cannot be
   * believed. The scheme avoids that without constraining the draw, because of one property: ANY
   * subset of a recency-sorted list, rendered in that same order, has its ages in order. The
   * viewer cannot see which rows were skipped — only that what is shown runs oldest to newest, as
   * a chat log does. So the draw is free to be random; it is the RENDER order that is fixed
   * (`pickWindow` sorts its result oldest-first, matching the column's newest-at-the-bottom
   * reading direction).
   *
   * The newest ROTATE_PINNED rows are always kept, so the bottom of the column — where the eye
   * lands and where the composer is — always shows the freshest thing that happened rather than
   * drifting into an hour-old slice.
   */
  const [shown, setShown] = useState<Row[]>([]);
  useEffect(() => {
    const roll = () => setShown(pickWindow(pool));
    roll();
    let id: ReturnType<typeof setTimeout>;
    const schedule = () => {
      // Jittered rather than fixed: a change that lands on a metronome is a change the viewer
      // starts to anticipate, and anticipating it is noticing it.
      const ms = ROTATE_MIN_MS + Math.random() * (ROTATE_MAX_MS - ROTATE_MIN_MS);
      id = setTimeout(() => {
        roll();
        schedule();
      }, ms);
    };
    schedule();
    return () => clearTimeout(id);
    // Runs on every response, which also re-seeds the window from the new rows. Note the timer is
    // NOT skipped when the pool is too short to rotate: a brand with eight rows shows all eight
    // every time, but the re-render is still what keeps their ages advancing.
  }, [pool]);

  const messages = data?.messages ?? [];
  // Staff are shown the real count, and a count we are not currently being told is not a count —
  // so for them the figure hides while the socket is down and the label says what the list is
  // instead. The synthetic figure needs no socket, but reads 0 until it is seeded after mount.
  const showOnline = displayOnline > 0 && (!isStaffRole(role) || status === 'open');

  return (
    <div className="flex h-full w-full min-w-0 flex-col bg-bg">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border bg-surface px-3 py-2.5 sm:px-4">
        <div className="flex min-w-0 items-center gap-2 text-sm font-bold text-fg">
          <div className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-accent" />
          <span className="truncate">Live Chat</span>
        </div>
        {showOnline ? (
          <div className="shrink-0 whitespace-nowrap text-xs text-muted">
            <span className="tabular-nums text-fg">{displayOnline.toLocaleString()}</span> Online
          </div>
        ) : (
          <div className="shrink-0 whitespace-nowrap text-xs text-muted">Recent activity</div>
        )}
      </div>

      <div className="min-h-0 w-full min-w-0 flex-1 space-y-2 overflow-y-auto bg-bg px-3 py-2">
        {pool.length === 0 && messages.length === 0 ? (
          <p className="px-2 py-6 text-center text-xs italic text-muted">Nothing has happened here yet today.</p>
        ) : null}

        {shown.map((row) => (
          <ActivityLine key={row.key} row={row} />
        ))}

        {messages.map((m) => (
          <div
            key={m.id}
            className={cn(
              // `break-words`: a pasted URL or a long unspaced run has no break opportunity, and a
              // 320px pane is narrow enough for one to push the whole column sideways.
              // Same card shape as the system bubbles above so the two halves read as one column.
              'min-w-0 break-words rounded-xl px-3 py-2.5 text-xs leading-relaxed',
              m.authorRole === 'player' ? 'bg-accent/10 text-fg' : 'bg-surface text-fg',
            )}
          >
            <span className="font-bold text-muted">{m.authorRole === 'player' ? 'You' : (m.authorName ?? 'Support')}: </span>
            {m.body}
          </div>
        ))}
      </div>

      <div className="w-full min-w-0 shrink-0 border-t border-border bg-surface">
        {token ? (
          <div className="min-w-0 p-2.5">
            <ChatComposer
              busy={send.isPending}
              placeholder="Say something…"
              onSend={async (v) => {
                await send.mutateAsync({ body: v.body, file: v.file ?? null });
                markRead.mutate();
              }}
            />
          </div>
        ) : (
          <button
            type="button"
            onClick={() => openAuth('login')}
            className="min-h-11 w-full px-3 py-2.5 text-center text-xs italic text-muted hover:text-fg"
          >
            Login to join the chat
          </button>
        )}
      </div>
    </div>
  );
}

/** A pool row: the server's event, a rotation-stable key, and when its age was measured. */
type Row = { item: BrandActivityDto; key: string; receivedAt: number };

/** How many lines are on screen at once, and how many of those are always the newest ones. */
const ROTATE_WINDOW = 10;
const ROTATE_PINNED = 3;
const ROTATE_MIN_MS = 5_000;
const ROTATE_MAX_MS = 10_000;

/**
 * Draw the on-screen window from a newest-first pool, returned OLDEST-FIRST.
 *
 * Pure and position-free so the ordering guarantee is checkable in one read: whatever is picked,
 * the returned array is sorted by descending age, so the rendered column's ages always descend.
 */
function pickWindow(pool: Row[]): Row[] {
  const byAgeDesc = (a: Row, b: Row) => b.item.agoSeconds - a.item.agoSeconds;
  // Nothing to rotate — show everything rather than hiding real rows for the sake of churn.
  if (pool.length <= ROTATE_WINDOW) return pool.slice().sort(byAgeDesc);

  const pinned = pool.slice(0, ROTATE_PINNED);
  const rest = pool.slice(ROTATE_PINNED);
  // Partial Fisher–Yates: only the first `take` positions need to be settled.
  const take = ROTATE_WINDOW - pinned.length;
  for (let i = 0; i < take; i++) {
    const j = i + Math.floor(Math.random() * (rest.length - i));
    // `!` because both indices are provably in range (i < take <= rest.length, i <= j < length),
    // which `noUncheckedIndexedAccess` cannot see.
    const a = rest[i]!;
    rest[i] = rest[j]!;
    rest[j] = a;
  }
  return pinned.concat(rest.slice(0, take)).sort(byAgeDesc);
}

/**
 * PHRASES — the official voice.
 *
 * The mock's wording was marketing copy ("has successfully withdrawn … Congratulations! ✅"), and
 * the emoji plus the exclamation read as an advert for the feed rather than a record of it. These
 * are written as a platform announcing what its ledger did: a short status label naming the event
 * class, then one flat sentence with the figure in it. No emoji, no exclamation; the accent dot
 * beside the line already carries the "this is a confirmation" signal.
 *
 * Two rules the variants exist to satisfy, and one they exist to respect.
 *
 * 1. Several per kind, in DIFFERENT SHAPES — some lead with the name, some with the amount, some
 *    with the action. A screenful of one sentence with the names swapped is the shape every
 *    generated feed has, so matching that shape would undo the credibility the wording is for.
 *    The variant is chosen by hashing the row's key, so it is stable: a line keeps its wording
 *    across rotations and polls, and does not visibly rewrite itself.
 *
 * 2. Each variant is tied to the kind the SERVER reported and claims only what that kind is. A
 *    withdrawal says money left to the player; a deposit says money arrived from them and was
 *    credited — never congratulated, because congratulating somebody for handing money over is the
 *    one thing this feed must not do; a win says a trade settled in profit. Nothing here implies a
 *    verification, a review or a check the platform did not run, nothing promises or hints at a
 *    future payout, and nothing adds urgency or scarcity. The persuasive weight is meant to come
 *    from the figures being real and the voice being flat, which is the only kind of weight a
 *    licensed real-money product is allowed to use.
 */
type Phrase = {
  /** Status label, e.g. "Withdrawal confirmed". */
  label: string;
  /** Text before the formatted amount. */
  pre: (name: string) => string;
  /** Text after the formatted amount. */
  post: (name: string) => string;
};

const PHRASES: Record<BrandActivityDto['kind'], readonly Phrase[]> = {
  withdrawal: [
    { label: 'Withdrawal confirmed', pre: (n) => `${n} has been paid `, post: () => '.' },
    { label: 'Payout processed', pre: () => '', post: (n) => ` released to ${n}.` },
    { label: 'Cashout settled', pre: (n) => `${n}'s withdrawal of `, post: () => ' has cleared.' },
    { label: 'Withdrawal complete', pre: (n) => `${n} withdrew `, post: () => '. Payment confirmed.' },
  ],
  deposit: [
    { label: 'Deposit confirmed', pre: (n) => `${n}'s top-up of `, post: () => ' has been credited.' },
    { label: 'Funds received', pre: () => '', post: (n) => ` credited to ${n}'s balance.` },
    { label: 'Top-up processed', pre: (n) => `${n} added `, post: () => ' to their trading balance.' },
    { label: 'Deposit cleared', pre: () => '', post: (n) => ` received from ${n} and posted to their account.` },
  ],
  win: [
    { label: 'Winning trade confirmed', pre: (n) => `${n} closed a position for `, post: () => '.' },
    { label: 'Trade settled', pre: (n) => `${n}'s trade settled in profit — `, post: () => ' won.' },
    { label: 'Payout recorded', pre: () => '', post: (n) => ` paid to ${n} on a winning trade.` },
    { label: 'Win confirmed', pre: (n) => `${n} won `, post: () => ' on a settled trade.' },
  ],
};

/** FNV-1a. Cheap, stable across reloads, and spreads short keys evenly — all that is wanted here. */
function hashKey(s: string): number {
  let h = 2_166_136_261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16_777_619);
  }
  return h >>> 0;
}

/** One real event, worded as an official confirmation. */
function ActivityLine({ row }: { row: Row }) {
  // `fmt` is the brand's display-currency formatter: "KES 10,350" on a KES brand, "$79.70" on a
  // foreign one. Hand-rolling the string here is how a non-KES brand ends up announcing a KES
  // payout it never made, so the shared formatter is the only path.
  const { fmt } = useDisplayMoney();
  const { item, key, receivedAt } = row;
  const variants = PHRASES[item.kind];
  // `!`: every PHRASES entry is a non-empty literal tuple, so the modulo always lands on a member.
  const phrase = variants[hashKey(key) % variants.length]!;
  // The server's age plus however long this response has been on screen (see `pool`).
  const seconds = item.agoSeconds + Math.max(0, (Date.now() - receivedAt) / 1000);

  return (
    // A dark rounded card with a small accent status dot pinned at its left. The dot is
    // `mt-[0.4rem]` rather than centred so it keeps sitting on the FIRST line once a long name
    // wraps the text to two lines at 320px.
    //
    // `pp-pop-in` is the app's existing 140ms entry animation (globals.css), reused rather than
    // reinvented because it already has its own `prefers-reduced-motion` opt-out — so a rotation
    // is motionless for anyone who asked for that, with no new rule to keep in sync. It plays only
    // for rows that actually MOUNT, which, given the content-derived keys above, means only the
    // lines a roll genuinely brought in.
    <div className="pp-pop-in flex min-w-0 items-start gap-2 rounded-xl bg-surface px-3 py-2.5">
      <span className="mt-[0.4rem] h-1.5 w-1.5 shrink-0 rounded-full bg-accent" aria-hidden />
      <p className="min-w-0 break-words text-xs leading-relaxed">
        <span className="font-bold text-accent">{phrase.label}: </span>
        <span className="text-fg">
          {phrase.pre(item.name)}
          <span className="whitespace-nowrap font-semibold tabular-nums text-fg">{fmt(item.amountCents)}</span>
          {phrase.post(item.name)}
        </span>{' '}
        <span className="whitespace-nowrap text-muted">{ago(seconds)}</span>
      </p>
    </div>
  );
}

/** "just now" / "4m ago" / "2h ago" — a coarse age, which is all the server sends. */
function ago(seconds: number): string {
  if (seconds < 90) return 'just now';
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`;
  if (seconds < 86_400) return `${Math.round(seconds / 3600)}h ago`;
  return `${Math.round(seconds / 86_400)}d ago`;
}
