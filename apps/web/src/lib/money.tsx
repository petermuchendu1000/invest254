'use client';

import { useMemo } from 'react';
import { formatMoney, formatKes, isForeignDisplay, displayToKesCents, kesCentsToDisplay, type Cents } from '@invest254/shared/money';
import { useBrand } from '@/lib/brand/BrandProvider';
import { cn } from '@/lib/cn';

/**
 * Brand-aware money display for the PLAYER app.
 *
 * The money of record is always integer KES cents. A brand whose `currency` is not 'KES' RENDERS
 * those amounts in its display currency at the live `fxRateFromKes` the API resolved. This hook is
 * the single place the player UI reads that config, so every price/balance/stake is consistent.
 *
 * NOTE: intentionally NOT used by the admin/finance/marketer surfaces — operators reconcile against
 * M-Pesa in KES, so those keep the raw `formatKes`/`<Money>` (KES) path.
 */
/** Compact currency symbol ("$", "₦", …) for a foreign display currency; falls back to the code. */
function currencySymbol(currency: string, locale: string): string {
  try {
    const parts = new Intl.NumberFormat(locale, { style: 'currency', currency, currencyDisplay: 'narrowSymbol' }).formatToParts(0);
    return parts.find((p) => p.type === 'currency')?.value ?? currency;
  } catch {
    return currency;
  }
}

export function useDisplayMoney() {
  const brand = useBrand();
  const currency = brand.currency || 'KES';
  const locale = brand.locale || 'en-KE';
  const fxRateFromKes = brand.fxRateFromKes ?? 1;
  // Memoised on the brand's currency config so the returned formatter has a STABLE identity across
  // renders — safe to list in useMemo/useEffect dependency arrays.
  return useMemo(() => {
    const opts = { currency, locale, fxRateFromKes };
    const foreign = isForeignDisplay(opts);
    return {
      /** Format KES cents in the brand's display currency (KES fallback when no FX). */
      fmt: (cents: Cents) => formatMoney(cents, opts),
      currency,
      locale,
      fxRateFromKes,
      /** True when a non-KES currency with a usable rate is active. */
      isForeign: foreign,
      /** Compact label for inputs/chips: "$" for USD etc.; KES brands keep the familiar "KES" text. */
      symbol: foreign ? currencySymbol(currency, locale) : 'KES',
      /**
       * Display amount WITH its KES equivalent for foreign brands — "$15.46 (KES 2,000)" — so the
       * player always knows the real KES figure that M-Pesa moves. Plain KES for KES brands.
       */
      both: (cents: Cents) => (foreign ? `${formatMoney(cents, opts)} (${formatKes(cents)})` : formatKes(cents)),
      /** KES cents -> display-currency major units (for prefilling inputs). */
      toDisplay: (cents: Cents) => kesCentsToDisplay(cents, foreign ? fxRateFromKes : 1),
      /** User-entered display-currency major units -> authoritative KES cents. */
      toKesCents: (amount: number) => displayToKesCents(amount, foreign ? fxRateFromKes : 1),
    } as const;
  }, [currency, locale, fxRateFromKes]);
}

/** Inline amount in the brand's display currency (player app). Mirrors `<Money>` but currency-aware. */
export function DisplayMoney({ cents, className }: { cents: Cents; className?: string }) {
  const { fmt } = useDisplayMoney();
  return <span className={cn('font-mono tabular-nums', className)}>{fmt(cents)}</span>;
}
