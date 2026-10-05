'use client';

import { useMyNotifications } from '@/lib/notifications/hooks';
import { useSession } from '@/lib/auth/session';
import { cn } from '@/lib/cn';

/**
 * MetaTrader mobile's Messages tab.
 *
 * "Everything appears as chats, distinguished by avatar", under six documented categories in this
 * order: Chat (MQL5.community users) · Broker · Terminal · Community · Virtual hosting · Other
 * (docs/mt5/04-mobile-app.md section 7).
 *
 * Five of those six are MQL5.community and MetaQuotes services — a social network, a VPS rental
 * business and a code marketplace — that have no counterpart here and never will. Drawing five
 * empty chat rows for them would be a menu of features this product does not have. So one category
 * is rendered, the one that exists:
 *
 *   Broker  "messages from your broker", which is exactly what this account's notifications are:
 *           the deposit confirmations, bonus awards and account notices the banner system raises.
 *
 * MetaTrader's unread count and its blue new-message circle are NOT here, and the reason is in the
 * category header below: this API gives a notification no read state, so both would be decoration.
 */
export function MT5MobileMessages() {
  const token = useSession((s) => s.token);
  const notifications = useMyNotifications();
  const items = notifications.data?.items ?? [];

  return (
    <div className="flex h-full min-h-0 flex-col bg-[#0f1720] text-white">
      <div className="flex shrink-0 items-center gap-2 border-b border-[#2b3543] px-3 py-2">
        <span className="text-[14px] font-semibold text-white">Messages</span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {!token ? (
          <p className="px-3 py-6 text-center text-[11px] text-[#8fa2b8]">Sign in to read your messages.</p>
        ) : (
          <>
            {/* The category title, with its unread count beside it, as MetaTrader prints one. */}
            <div className="flex items-center gap-2 border-b border-[#2b3543] bg-[#202933] px-3 py-1.5">
              <span className="text-[11px] font-semibold text-white">Broker</span>
              {/* MetaTrader prints the unread count beside the category title, and puts a blue circle
                  on a chat that has new messages. Neither is here: a notification carries no read
                  state in this API, so a count would be the total dressed up as unread and the
                  circle would be on every row for ever. The count belongs with a read flag. */}
              <span className="ml-auto font-mono text-[10px] text-[#8fa2b8] tabular-nums">{items.length}</span>
            </div>
            {items.length === 0 ? (
              <p className="px-3 py-6 text-center text-[11px] text-[#8fa2b8]">No messages.</p>
            ) : (
              <ul className="divide-y divide-[#2b3543]">
                {items.map((n) => (
                  <li key={n.id} className="flex items-start gap-2.5 px-3 py-2.5">
                    {/* MetaTrader distinguishes a chat by its avatar; the broker's is the one
                        avatar in this list, so the level dot carries the message's own tone
                        instead of repeating the same face on every row. */}
                    <span
                      aria-hidden
                      className={cn(
                        'mt-1.5 h-2 w-2 shrink-0 rounded-full',
                        n.level === 'error' ? 'bg-[#f23645]'
                          : n.level === 'warning' ? 'bg-[#f0b90b]'
                            : n.level === 'success' ? 'bg-[#41be56]' : 'bg-[#3183ff]',
                      )}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline gap-2">
                        <span className="truncate text-[12px] font-semibold text-white">{n.title}</span>
                        <span className="ml-auto shrink-0 font-mono text-[10px] text-[#8fa2b8] tabular-nums">
                          {clock(n.createdAtMs)}
                        </span>
                      </div>
                      <p className="pt-0.5 text-[11px] leading-snug text-[#8fa2b8]">{n.body}</p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </div>
  );
}

const pad = (n: number) => String(n).padStart(2, '0');
const clock = (ms: number): string => {
  const d = new Date(ms);
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
