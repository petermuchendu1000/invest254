'use client';

import { cn } from '@/lib/cn';
import { useSupportChat } from '@/lib/support/useSupportChat';
import { useEntryScanner } from '@/lib/game/entryScannerUi';
import { useDigitSession } from '@/lib/game/digitSession';
import { env } from '@/lib/env';
import { DIcon } from '@/components/game/digits/icons';

/**
 * Digits-brand bottom navigation (digits broker mock), phones only: Live Chat · AI · Positions.
 * Live Chat opens the support widget when it is switched on (otherwise How to Trade takes its
 * place); AI opens the scanner; Positions opens the Open / Closed / History sheet.
 */
export function DigitsBottomNav() {
  const setSupportOpen = useSupportChat((s) => s.setOpen);
  const openScanner = useEntryScanner((s) => s.setOpen);
  const positionsOpen = useDigitSession((s) => s.positionsOpen);
  const setPositionsOpen = useDigitSession((s) => s.setPositionsOpen);
  const setHowToOpen = useDigitSession((s) => s.setHowToOpen);
  const openCount = useDigitSession((s) => (s.open ? 1 : 0));

  const item = 'flex w-20 flex-col items-center gap-1 rounded-xl py-1.5 text-[11px] font-semibold transition';
  return (
    <nav className="pb-safe fixed inset-x-0 bottom-0 z-30 border-t border-border bg-surface lg:hidden">
      <ul className="mx-auto flex w-full max-w-app items-end justify-around px-4 pt-1.5">
        <li>
          {env.supportChatEnabled ? (
            <button type="button" onClick={() => setSupportOpen(true)} className={cn(item, 'text-muted hover:text-fg')}>
              <DIcon name="chat" />Live Chat
            </button>
          ) : (
            <button type="button" onClick={() => setHowToOpen(true)} className={cn(item, 'text-muted hover:text-fg')}>
              <DIcon name="book" />Guide
            </button>
          )}
        </li>
        <li className="-mt-5">
          <button type="button" onClick={() => openScanner(true)} aria-label="AI" className="group flex flex-col items-center gap-1 text-[11px] font-semibold text-fg">
            <span className="grid h-14 w-14 place-items-center rounded-full bg-[linear-gradient(135deg,var(--pp-accent),color-mix(in_srgb,var(--pp-accent)_40%,#a855f7))] text-white shadow-[0_6px_22px_-6px_var(--pp-accent)] ring-4 ring-surface transition group-active:scale-95">
              <DIcon name="sparkles" className="h-6 w-6" strokeWidth={2} />
            </span>
            AI
          </button>
        </li>
        <li>
          <button type="button" onClick={() => setPositionsOpen(true)} aria-expanded={positionsOpen}
            className={cn(item, 'relative', positionsOpen ? 'text-accent' : 'text-muted hover:text-fg')}>
            <DIcon name="clock" />Positions
            {openCount ? <span className="absolute right-4 top-0.5 h-2 w-2 rounded-full bg-accent" /> : null}
          </button>
        </li>
      </ul>
    </nav>
  );
}
