import { headers, cookies } from 'next/headers';
import { resolveBrand, type Brand } from './brand.js';
import { env } from '@/lib/env';

/**
 * The brand for the current REQUEST, server-side.
 *
 * It lived inside the root layout, which is where it is needed most and the only place that could
 * reach it. A second server surface then needed it (the legal page's `<title>`, which follows the
 * brand's register) and copying four functions to get at it would have been two resolutions that
 * could disagree. It is here so every server component asks the same question the same way.
 */

/** The incoming host (proxy-aware) — drives which brand this request renders. */
export function requestHost(): string {
  const h = headers();
  return (h.get('x-forwarded-host') ?? h.get('host') ?? '').split(',')[0]!.trim();
}

/**
 * #10 geo-currency: the visitor's ISO country from the CDN edge (Cloudflare `cf-ipcountry`, with a
 * Vercel fallback for preview deploys). Sentinels like 'XX'/'T1' are left as-is — the API ignores an
 * unmapped country and keeps the brand currency. Empty string when the header is absent (local dev).
 */
export function requestCountry(): string {
  const h = headers();
  return (h.get('cf-ipcountry') ?? h.get('x-vercel-ip-country') ?? '').trim();
}

/**
 * #10: the user's chosen display currency, read from the `pp-currency` cookie so it survives into SSR
 * (the bearer token lives only in localStorage, invisible to the server). The switcher sets this
 * cookie, and a signed-in user's saved server preference is synced into it after login.
 */
export function preferredCurrency(): string {
  return cookies().get('pp-currency')?.value?.trim() ?? '';
}

/** Resolve the brand for the current request (host → API `sites` row, cached briefly upstream). */
export async function currentBrand(): Promise<Brand> {
  return resolveBrand(env.apiBaseUrl, requestHost(), { country: requestCountry(), currency: preferredCurrency() });
}
