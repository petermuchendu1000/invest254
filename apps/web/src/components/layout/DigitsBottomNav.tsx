'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/cn';
import { useSupportChat } from '@/lib/support/useSupportChat';
import { useEntryScanner } from '@/lib/game/entryScannerUi';

function Icon({ path, className = 'h-5 w-5' }: { path: string; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <path d={path} />
    </svg>
  );
}

/**
 * Digits-brand bottom navigation (matches the digits broker mock): Live Chat · AI · Positions.
 * Only rendered for `trade_ui = 'digits'` brands on the trade surface. Live Chat opens the existing
 * support widget; Positions links to history; AI opens the Entry Scanner (rendered inside the trade
 * screen, which owns the socket feed the scanner samples).
 */
export function DigitsBottomNav() {
  const pathname = usePathname();
  const setSupportOpen = useSupportChat((s) => s.setOpen);
  const openScanner = useEntryScanner((s) => s.setOpen);

  return (
    <nav className="pb-safe fixed inset-x-0 bottom-0 z-30 border-t border-border bg-surface">
      <ul className="mx-auto flex w-full max-w-app items-end justify-around px-4 py-1.5">
        <li>
          <button
            type="button"
            onClick={() => setSupportOpen(true)}
            className="flex flex-col items-center gap-1 rounded-xl px-3 py-1.5 text-[11px] font-semibold text-muted transition hover:text-fg"
          >
            <Icon path="M21 15a2 2 0 01-2 2H8l-5 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
            Live Chat
          </button>
        </li>

        <li className="-mt-3">
          <button
            type="button"
            onClick={() => openScanner(true)}
            aria-label="AI Entry Scanner"
            className="flex flex-col items-center gap-1 text-[11px] font-semibold text-fg"
          >
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-accent/15 text-accent shadow-[0_0_18px_-4px_var(--pp-accent)] ring-1 ring-accent/30">
              <Icon path="M12 3l1.9 4.6L18.5 9l-4.6 1.9L12 15l-1.9-4.1L5.5 9l4.6-1.4zM6 16l.9 2.1L9 19l-2.1.9L6 22l-.9-2.1L3 19l2.1-.9z" />
            </span>
            AI
          </button>
        </li>

        <li>
          <Link
            href="/history"
            aria-current={pathname.startsWith('/history') ? 'page' : undefined}
            className={cn(
              'flex flex-col items-center gap-1 rounded-xl px-3 py-1.5 text-[11px] font-semibold transition',
              pathname.startsWith('/history') ? 'text-accent' : 'text-muted hover:text-fg',
            )}
          >
            <Icon path="M12 8v4l3 2M21 12a9 9 0 11-9-9" />
            Positions
          </Link>
        </li>
      </ul>
    </nav>
  );
}
