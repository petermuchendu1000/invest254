import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { isAdminHost } from '@/lib/brand/adminHost';

/**
 * Dedicated admin/operator domain routing (Issue 1).
 *
 * On an admin host (ADMIN_HOST, default triocodes.com) the ROOT must be the operator console, not the
 * player app. We REDIRECT `/` -> `/console` (not a rewrite) so the browser URL actually becomes
 * `/console`; the app chrome keys off the pathname, so this is what stops the player top-bar
 * (brand + Login/Sign Up) from ever rendering on the admin domain.
 */
export function middleware(req: NextRequest) {
  // The host list moved to lib/brand/adminHost so the BRAND path can read the same answer — see
  // the note there for why it had to.
  if (isAdminHost(req.headers.get('host')) && req.nextUrl.pathname === '/') {
    const url = req.nextUrl.clone();
    url.pathname = '/console';
    return NextResponse.redirect(url, 307);
  }
  return NextResponse.next();
}

// Only run on the root — cheap, and all other admin paths already render bare.
export const config = { matcher: ['/'] };
