'use client';

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api/endpoints';
import type { BrandActivityDto } from '@/lib/api/types';
import { useBrand } from '@/lib/brand/BrandProvider';
import { useSession } from '@/lib/auth/session';
import { useAuthUi } from '@/lib/auth/ui';
import { useDisplayMoney } from '@/lib/money';
import { useGameSocket } from '@/lib/game/GameSocketProvider';
import { usePlayerChat, useSendChat, useMarkChatRead } from '@/lib/chat/liveChat';
import { ChatComposer } from '@/components/chat/ChatParts';
import { cn } from '@/lib/cn';

/**
 * The rail's Chat tab: the brand's real activity, with the player's own conversation in it.
 *
 * The mock's version is a public room whose feed is GENERATED — the page it was copied from returns
 * its rows typed `system_simulated`, naming withdrawals nobody made, and its `/api/wins` is one
 * username repeated with random amounts. That is the single thing from the mock not reproduced: a
 * feed of invented winnings sitting above a deposit button is a lie told to the person about to
 * deposit, and it is also the easiest thing in the product to get sued over.
 *
 * So the system lines are real (docs/54): deposits that settled, withdrawals that were paid, trades
 * that won, on this brand, newest last. They carry a first name and an amount and nothing else —
 * see `activity.pg.ts` for what the server refuses to send. Below them sits the player's own
 * customer-care thread, which is the only conversation this product actually has.
 */
export function ChatPane() {
  const brand = useBrand();
  const token = useSession((s) => s.token);
  const openAuth = useAuthUi((s) => s.openAuth);
  /**
   * The engine's OWN connected-socket count for this brand, broadcast on every connect and close
   * (`online` in multiengine.ts). This pane is only ever mounted inside the candlestick screen's
   * <GameSocketProvider>, so the socket is already open for the chart and this costs no connection.
   */
  const { online, status } = useGameSocket();
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
    // full as this brand's real history allows". On a quiet brand that is still the honest answer:
    // a short list of things that really happened, rather than a long list of things that did not.
    queryFn: () => api.siteActivity(brand.slug, 40),
    refetchInterval: 20_000,
    staleTime: 15_000,
  });

  const messages = data?.messages ?? [];
  const items = useMemo(() => activity?.items ?? [], [activity]);

  return (
    <div className="flex h-full w-full min-w-0 flex-col bg-[#0a0f1c]">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-[#1f2937] bg-[#111827] px-3 py-2.5 sm:px-4">
        <div className="flex min-w-0 items-center gap-2 text-sm font-bold text-white">
          <div className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-[#22c55e]" />
          <span className="truncate">Live Chat</span>
        </div>
        {/**
         * The mock prints "2,372 Online". What is printed here is the engine's real count of
         * sockets currently attached to this brand — nothing is floored, smoothed or drifted, so on
         * a quiet brand it will honestly read "3 Online". That restraint is the whole point: see
         * `lib/game/onlineDisplay.ts`, whose synthetic random walk between 150 and 1,000 is exactly
         * the kind of number that must never sit above a feed of real payouts in a licensed market.
         * Hidden while the socket is not open, because a count we are not currently being told is
         * not a count; the label then says what the list below actually is.
         */}
        {status === 'open' && online > 0 ? (
          <div className="shrink-0 whitespace-nowrap text-xs text-gray-500">
            <span className="tabular-nums text-gray-300">{online.toLocaleString()}</span> Online
          </div>
        ) : (
          <div className="shrink-0 whitespace-nowrap text-xs text-gray-500">Recent activity</div>
        )}
      </div>

      <div className="min-h-0 w-full min-w-0 flex-1 space-y-2 overflow-y-auto bg-[#0a0f1c] px-3 py-2">
        {items.length === 0 && messages.length === 0 ? (
          <p className="px-2 py-6 text-center text-xs italic text-gray-500">Nothing has happened here yet today.</p>
        ) : null}

        {items.map((it, i) => (
          <ActivityLine key={`${it.kind}-${i}-${it.agoSeconds}`} item={it} />
        ))}

        {messages.map((m) => (
          <div
            key={m.id}
            className={cn(
              // `break-words`: a pasted URL or a long unspaced run has no break opportunity, and a
              // 320px pane is narrow enough for one to push the whole column sideways.
              // Same card shape as the system bubbles above so the two halves read as one column.
              'min-w-0 break-words rounded-xl px-3 py-2.5 text-xs leading-relaxed',
              m.authorRole === 'player' ? 'bg-[#22c55e]/10 text-white' : 'bg-[#111827] text-gray-200',
            )}
          >
            <span className="font-bold text-gray-400">{m.authorRole === 'player' ? 'You' : (m.authorName ?? 'Support')}: </span>
            {m.body}
          </div>
        ))}
      </div>

      <div className="w-full min-w-0 shrink-0 border-t border-[#1f2937] bg-[#111827]">
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
            className="min-h-11 w-full px-3 py-2.5 text-center text-xs italic text-gray-500 hover:text-white"
          >
            Login to join the chat
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * The mock's three verbs with the tail it puts after the amount: "System: CyntNia has successfully
 * withdrawn KES 10,350. Congratulations! ✅".
 *
 * One tail per KIND rather than the mock's single withdrawal tail everywhere: the mock only ever
 * had withdrawals to show, but this feed carries deposits and wins too, and "Congratulations!" on
 * somebody's deposit would be congratulating them for handing money over. A deposit therefore gets
 * the neutral receipt wording it deserves, and only the two events that put money in a player's
 * hands get the celebration.
 */
const WORDING = {
  withdrawal: { verb: 'has successfully withdrawn', tail: 'Congratulations!', mark: '✅' },
  deposit: { verb: 'has topped up', tail: 'Funds received!', mark: '💰' },
  win: { verb: 'has won', tail: 'Congratulations!', mark: '🎉' },
} as const;

/** One real event, worded as the mock words its system lines. */
function ActivityLine({ item }: { item: BrandActivityDto }) {
  // `fmt` is the brand's display-currency formatter: "KES 10,350" on a KES brand, "$79.70" on a
  // foreign one. Hand-rolling the string here is how a non-KES brand ends up announcing a KES
  // payout it never made, so the shared formatter is the only path.
  const { fmt } = useDisplayMoney();
  const { verb, tail, mark } = WORDING[item.kind];

  return (
    // The mock's bubble: a dark rounded card with a small green status dot pinned at its left. The
    // dot is `mt-[0.4rem]` rather than centred so it keeps sitting on the FIRST line once a long
    // name wraps the text to two lines at 320px.
    <div className="flex min-w-0 items-start gap-2 rounded-xl bg-[#111827] px-3 py-2.5">
      <span className="mt-[0.4rem] h-1.5 w-1.5 shrink-0 rounded-full bg-[#22c55e]" aria-hidden />
      <p className="min-w-0 break-words text-xs leading-relaxed">
        <span className="font-bold text-[#22c55e]">System: </span>
        <span className="text-gray-200">
          {item.name} {verb} <span className="whitespace-nowrap font-semibold tabular-nums text-white">{fmt(item.amountCents)}</span>.{' '}
          {tail} {mark}
        </span>{' '}
        <span className="whitespace-nowrap text-gray-500">{ago(item.agoSeconds)}</span>
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
