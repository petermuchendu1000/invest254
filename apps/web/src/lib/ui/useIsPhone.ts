'use client';

import { useSyncExternalStore } from 'react';

/**
 * Whether this is a phone-sized screen, decided in JavaScript rather than with a CSS breakpoint.
 *
 * CSS would be the usual answer and is the wrong one here. The phone layout and the desktop layout
 * are different TREES, not the same tree restyled: MetaTrader's phone app is five tabs with one
 * screen visible at a time, and its desktop terminal is Market Watch, chart, Toolbox and ticket all
 * on screen together. Rendering both and hiding one with `lg:hidden` would mount two charts, two
 * quote subscriptions and two sets of chart state — which is exactly the thing the desktop layout's
 * own comment says it was built to avoid.
 *
 * The breakpoint is Tailwind's `lg` (1024px), the same one the desktop layout uses, so the two
 * cannot disagree about which is showing.
 *
 * It reports FALSE during the server render and until the client has mounted, so the first paint is
 * always the desktop tree and there is no hydration mismatch; the phone tree swaps in on mount.
 */
const QUERY = '(max-width: 1023.98px)';

const subscribe = (onChange: () => void): (() => void) => {
  if (typeof window === 'undefined' || !window.matchMedia) return () => { /* no window: nothing to watch */ };
  const mq = window.matchMedia(QUERY);
  mq.addEventListener('change', onChange);
  return () => mq.removeEventListener('change', onChange);
};

export function useIsPhone(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => (typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia(QUERY).matches),
    () => false,
  );
}
