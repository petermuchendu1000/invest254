'use client';

import { Button } from '@/components/ui/Button';
import { Skeleton } from '@/components/ui/Skeleton';
import { ProfileMenu } from '@/components/auth/ProfileMenu';
import { useAuthUi } from '@/lib/auth/ui';
import { useSession } from '@/lib/auth/session';
import { useHydrated } from '@/lib/useHydrated';

export function AuthButtons() {
  const hydrated = useHydrated();
  const token = useSession((s) => s.token);
  const user = useSession((s) => s.user);
  const openAuth = useAuthUi((s) => s.openAuth);

  // Match the server-rendered (logged-out) markup until mounted.
  if (!hydrated || !token) {
    return (
      <>
        <Button variant="ghost" size="sm" className="px-2.5 sm:px-3" onClick={() => openAuth('login')}>
          Login
        </Button>
        <Button
          variant="primary"
          size="sm"
          className="px-2.5 font-semibold shadow-md shadow-accent/40 sm:px-3"
          onClick={() => openAuth('register')}
        >
          Sign Up
        </Button>
      </>
    );
  }

  if (!user) return <Skeleton className="h-9 w-9 rounded-full" />;

  return <ProfileMenu user={user} />;
}
