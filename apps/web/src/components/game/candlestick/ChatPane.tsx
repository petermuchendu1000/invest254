'use client';

import { useSession } from '@/lib/auth/session';
import { useAuthUi } from '@/lib/auth/ui';
import { usePlayerChat, useSendChat, useMarkChatRead } from '@/lib/chat/liveChat';
import { ChatComposer, ChatMessages } from '@/components/chat/ChatParts';

/**
 * The rail's Chat tab.
 *
 * The mock's chat is a PUBLIC room carrying a feed of "System: <name> has successfully withdrawn
 * KES 14,650" lines. This app has no public room, and the feed on the page this copies is generated
 * (`/api/chat/simulate` on it) rather than reported — which is to say those withdrawals did not
 * happen. Manufacturing testimonials to sit above a deposit button is not something to port, so the
 * tab keeps the mock's chrome and carries the REAL chat this product already has: the player and
 * customer care, the same thread the support launcher opens.
 *
 * The online counter the mock prints beside the title is dropped for the same reason: there is no
 * number to put there that would be true.
 */
export function ChatPane() {
  const token = useSession((s) => s.token);
  const openAuth = useAuthUi((s) => s.openAuth);
  const { data } = usePlayerChat(true, 3_000);
  const send = useSendChat();
  const markRead = useMarkChatRead();

  const messages = data?.messages ?? [];

  return (
    <div className="flex h-full w-full flex-col bg-[#0a0f1c]">
      <div className="flex shrink-0 items-center justify-between border-b border-[#1f2937] bg-[#111827] px-4 py-2.5">
        <div className="flex items-center gap-2 text-sm font-bold text-white">
          <div className="h-2 w-2 animate-pulse rounded-full bg-[#22c55e]" />
          Live Chat
        </div>
        <div className="text-xs text-gray-500">Customer care</div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto bg-[#0a0f1c] px-3 py-2">
        {token ? (
          <ChatMessages messages={messages} mine={(m) => m.authorRole === 'player'} />
        ) : (
          <p className="px-2 py-6 text-center text-xs italic text-gray-500">Log in to start a conversation.</p>
        )}
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
