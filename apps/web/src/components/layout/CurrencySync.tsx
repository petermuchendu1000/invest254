'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from '@/lib/auth/session';
import { readCurrencyCookie, writeCurrencyCookie } from '@/lib/brand/currency';

/**
 * #10 geo-currency — cross-device sync. A user's saved display-currency preference arrives in the
 * profile (`/auth/me` → session.user.displayCurrency), but the SSR layout resolves currency from the
 * `pp-currency` COOKIE (it can't see the bearer token). On a device where the cookie is missing or
 * stale, adopt the saved preference into the cookie and refresh so the server re-renders in it.
 *
 * Only ever PUSHES a non-empty saved preference into the cookie (never clears an in-session choice),
 * and no-ops once they agree — so `router.refresh()` runs at most once and never loops. Renders null.
 */
export function CurrencySync() {
  const router = useRouter();
  const pref = useSession((s) => s.user?.displayCurrency ?? '');

  useEffect(() => {
    const want = (pref ?? '').trim().toUpperCase();
    if (!want) return; // no saved preference → leave the cookie (geo/brand default) as-is
    if (readCurrencyCookie() === want) return; // already in sync → nothing to do
    writeCurrencyCookie(want);
    router.refresh();
  }, [pref, router]);

  return null;
}
