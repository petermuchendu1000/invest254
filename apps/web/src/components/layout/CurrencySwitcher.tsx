'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { SUPPORTED_DISPLAY_CURRENCIES } from '@invest254/shared/geo';
import { useBrand } from '@/lib/brand/BrandProvider';
import { readCurrencyCookie, writeCurrencyCookie } from '@/lib/brand/currency';
import { useSession } from '@/lib/auth/session';
import { api } from '@/lib/api/endpoints';

/**
 * #10 geo-currency: lets the visitor choose the DISPLAY currency (presentation only — money of record
 * stays KES cents). "Auto" clears the choice and falls back to geo-detection, then the brand currency.
 * The choice is written to the `pp-currency` cookie (so SSR re-resolves the currency + live FX rate)
 * and, when signed in, saved to the account so it follows the user across devices. `router.refresh()`
 * re-runs the server layout, which is the single place that resolves the effective currency.
 */
export function CurrencySwitcher({ className = '' }: { className?: string }) {
  const router = useRouter();
  const brand = useBrand();
  const token = useSession((s) => s.token);
  // The explicit choice (cookie). '' = Auto. Read after mount to avoid a hydration mismatch.
  const [choice, setChoice] = useState('');
  useEffect(() => { setChoice(readCurrencyCookie()); }, []);

  function onChange(next: string) {
    setChoice(next);
    writeCurrencyCookie(next || null);
    // Best-effort server save so the preference follows the account to other devices; never blocks UI.
    if (token) void api.setCurrency(token, next || null).catch(() => {});
    router.refresh();
  }

  return (
    <label className={`inline-flex items-center gap-1.5 text-xs text-muted ${className}`}>
      <span className="sr-only">Display currency</span>
      <select
        value={choice}
        onChange={(e) => onChange(e.target.value)}
        aria-label="Display currency"
        className="rounded-md border border-border bg-surface px-2 py-1 text-xs text-fg"
      >
        <option value="">Auto ({brand.currency || 'KES'})</option>
        {SUPPORTED_DISPLAY_CURRENCIES.map((c) => (
          <option key={c} value={c}>{c}</option>
        ))}
      </select>
    </label>
  );
}
