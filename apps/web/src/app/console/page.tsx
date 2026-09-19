'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { AdminSignIn } from '@/components/auth/AdminSignIn';
import { Button } from '@/components/ui/Button';
import { useSession } from '@/lib/auth/session';
import { useAuthActions } from '@/lib/auth/useAuthActions';
import { useHydrated } from '@/lib/useHydrated';

/**
 * /console — the UNIFIED OPERATOR ENTRY POINT (Issue 1).
 *
 * One URL for every admin, meant to be served on a dedicated admin domain (e.g. console.<host>).
 * Logged out → the identity-based operator sign-in. Logged in → routed to the surface for the
 * account's role: System owner / Platform admin → /platform; Site admin/superadmin → /admin.
 * A non-operator who lands here is told they have no console access (and can sign out).
 */
function destinationFor(role: string | undefined | null): string | null {
  if (role === 'platform_superadmin' || role === 'platform_admin') return '/platform';
  if (role === 'admin' || role === 'superadmin') return '/admin';
  return null;
}

export default function ConsoleEntryPage() {
  const hydrated = useHydrated();
  const router = useRouter();
  const token = useSession((s) => s.token);
  const user = useSession((s) => s.user);
  const { logout } = useAuthActions();

  const dest = destinationFor(user?.role);

  React.useEffect(() => {
    if (token && dest) router.replace(dest);
  }, [token, dest, router]);

  if (!hydrated) return null;

  // Signed in as an operator → redirecting to their console.
  if (token && dest) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-bg text-sm text-muted">
        Opening your console…
      </div>
    );
  }

  // Signed in but not an operator account.
  if (token && user && !dest) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-3 bg-bg px-6 text-center">
        <h1 className="text-xl font-semibold tracking-tight text-fg">No console access</h1>
        <p className="max-w-sm text-sm text-muted">
          The account <span className="font-medium text-fg">@{user.username}</span> is not an operator account.
          If you believe this is a mistake, contact the system owner.
        </p>
        <Button variant="outline" onClick={logout}>Sign out</Button>
      </div>
    );
  }

  return <AdminSignIn />;
}
