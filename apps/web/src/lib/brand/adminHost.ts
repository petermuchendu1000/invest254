/**
 * Which hosts serve the OPERATOR CONSOLE instead of a player brand.
 *
 * One definition, shared by `middleware.ts` (which redirects `/` to `/console` on these hosts) and
 * by `currentBrand()` (which must not ask the API for a brand that cannot exist). It lived only in
 * the middleware, so the brand path had no idea the admin domain was special and treated it as an
 * unresolvable player host on every single request.
 *
 * Edge-safe: plain string work, no Node APIs, because the middleware runs in the edge runtime.
 *
 * `ADMIN_HOST` is a comma-separated list. It is currently set in NO deployment config, so the
 * literal default below is what production actually runs on.
 */
export const ADMIN_HOSTS: readonly string[] = (process.env.ADMIN_HOST || 'triocodes.com')
  .split(',')
  .map((h) => h.trim().toLowerCase())
  .filter(Boolean);

/**
 * Is this request's Host an operator host?
 *
 * Accepts a raw Host header: the port is stripped and `www.` is matched, which is what the
 * middleware already did and what the brand path now needs to agree with exactly. Two different
 * answers to this question would be worse than one wrong one.
 */
export function isAdminHost(host: string | null | undefined): boolean {
  const h = (host ?? '').split(':')[0]?.trim().toLowerCase() ?? '';
  if (!h) return false;
  return ADMIN_HOSTS.some((a) => h === a || h === `www.${a}`);
}
