'use client';

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { centsToKes } from '@invest254/shared/money';
import { api } from '@/lib/api/endpoints';
import type { BrandActivityDto } from '@/lib/api/types';
import { useBrand } from '@/lib/brand/BrandProvider';
import { useSession } from '@/lib/auth/session';
import { useAuthUi } from '@/lib/auth/ui';
import { useDisplayMoney } from '@/lib/money';
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
    <div className="flex h-full w-full flex-col bg-[#0a0f1c]">
      <div className="flex shrink-0 items-center justify-between border-b border-[#1f2937] bg-[#111827] px-4 py-2.5">
        <div className="flex items-center gap-2 text-sm font-bold text-white">
          <div className="h-2 w-2 animate-pulse rounded-full bg-[#22c55e]" />
          Live Chat
        </div>
        {/* The mock prints an online count here. There is no number that would be true, so this
            says what the list below actually is. */}
        <div className="text-xs text-gray-500">Recent activity</div>
      </div>

      <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto bg-[#0a0f1c] px-3 py-2">
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
              'rounded-lg px-3 py-2 text-xs leading-relaxed',
              m.authorRole === 'player' ? 'bg-[#22c55e]/10 text-white' : 'bg-[#111827] text-gray-200',
            )}
          >
            <span className="font-bold text-gray-400">{m.authorRole === 'player' ? 'You' : (m.authorName ?? 'Support')}: </span>
            {m.body}
          </div>
        ))}
      </div>

      <div className="shrink-0 border-t border-[#1f2937] bg-[#111827]">
        {token ? (
          <div className="p-2.5">
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
            className="w-full p-2.5 text-center text-xs italic text-gray-500 hover:text-white"
          >
            Login to join the chat
          </button>
        )}
      </div>
    </div>
  );
}

/** One real event, worded as the mock words its system lines. */
function ActivityLine({ item }: { item: BrandActivityDto }) {
  const { isForeign, symbol, toDisplay } = useDisplayMoney();
  const amount = isForeign
    ? `${symbol} ${toDisplay(item.amountCents).toLocaleString(undefined, { maximumFractionDigits: 2 })}`
    : `KES ${centsToKes(item.amountCents).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
  const verb =
    item.kind === 'withdrawal' ? 'has successfully withdrawn'
    : item.kind === 'deposit' ? 'has topped up'
    : 'has won';

  return (
    <div className="rounded-lg bg-[#111827] px-3 py-2 text-xs leading-relaxed">
      <span className="font-bold text-[#22c55e]">System: </span>
      <span className="text-gray-200">
        {item.name} {verb} {amount}.
      </span>{' '}
      <span className="text-gray-500">{ago(item.agoSeconds)}</span>
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
