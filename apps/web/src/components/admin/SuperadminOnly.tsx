'use client';

import * as React from 'react';
import { useSession } from '@/lib/auth/session';

/** Gate for owner-only governance pages. Renders children only for the superadmin (system owner);
 *  any other admin sees a clear authority notice. The API enforces this too — this is UX clarity. */
export function SuperadminOnly({ children }: { children: React.ReactNode }) {
  const role = useSession((s) => s.user?.role);
  if (role !== 'superadmin') {
    return (
      <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-warn/50 bg-warn/5 p-8 text-center">
        <span className="text-2xl">★</span>
        <p className="text-sm font-semibold text-fg">Owner-only area</p>
        <p className="max-w-md text-sm text-muted">
          This is a system-governance setting reserved for the superadmin (system owner). Operators don&apos;t have access —
          contact the owner if a change is required here.
        </p>
      </div>
    );
  }
  return <>{children}</>;
}
