/** Best-effort, unverified decode of a JWT payload's `role` claim.
 *
 *  The token is the only role source the API authorises against, but the UI reads the live
 *  role from /auth/me. When the two diverge (e.g. after a promotion the user has not yet
 *  re-logged-in for) every role-gated call 403s while the UI shows the new role. Comparing
 *  this claim against /auth/me lets the client detect that drift and rotate the token. This
 *  is NOT a security check — it only decides whether to ask the server for a fresh token; the
 *  server remains the source of truth. */
export function roleFromToken(token: string | null | undefined): string | null {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length < 2) return null;
  try {
    const json = decodeBase64Url(parts[1]!);
    const payload = JSON.parse(json) as { role?: unknown };
    return typeof payload.role === 'string' ? payload.role : null;
  } catch {
    return null;
  }
}

function decodeBase64Url(input: string): string {
  const b64 = input.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(input.length / 4) * 4, '=');
  if (typeof atob === 'function') return atob(b64);
  // SSR / Node fallback (the helper is client-only in practice).
  return Buffer.from(b64, 'base64').toString('binary');
}
