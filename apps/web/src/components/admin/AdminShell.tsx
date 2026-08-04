'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/cn';
import { Button } from '@/components/ui/Button';
import { Skeleton } from '@/components/ui/Skeleton';
import { useSession } from '@/lib/auth/session';
import { useAuthUi } from '@/lib/auth/ui';
import { useAuthActions } from '@/lib/auth/useAuthActions';
import { useHydrated } from '@/lib/useHydrated';
import { LogoMark } from '@/components/layout/Logo';

type NavItem = { href: string; label: string; icon: React.ReactNode };
type NavSection = { title: string; items: NavItem[]; superadmin?: boolean };

function Icon({ d }: { d: string }) {
  return (
    <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d={d} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// Two tiers: Operations (any admin) and Governance (superadmin/owner only — the powers a plain
// admin does not have: roles, game economy, payment rails, fairness seeds).
const SECTIONS: NavSection[] = [
  {
    title: 'Operations',
    items: [
      { href: '/admin', label: 'Overview', icon: <Icon d="M3 13h8V3H3zM13 21h8V3h-8zM3 21h8v-6H3z" /> },
      { href: '/admin/withdrawals', label: 'Withdrawals', icon: <Icon d="M12 3v12m0 0l-4-4m4 4l4-4M5 21h14" /> },
      { href: '/admin/users', label: 'Users', icon: <Icon d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM3 21a7 7 0 0118 0" /> },
      { href: '/admin/finance', label: 'Finance', icon: <Icon d="M3 6h18M3 12h18M3 18h18M7 3v18" /> },
      { href: '/admin/affiliates', label: 'Affiliates', icon: <Icon d="M17 20h5v-2a4 4 0 00-3-3.87M9 20H4v-2a4 4 0 013-3.87m6-1.13a4 4 0 10-4 0m8-4a3 3 0 10-3-3" /> },
      { href: '/admin/marketers', label: 'Marketers', icon: <Icon d="M12 8c-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4-1.79-4-4-4zm9 4h-2m-14 0H3m9-9V1m0 22v-2" /> },
      { href: '/admin/chat', label: 'Chat moderation', icon: <Icon d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" /> },
      { href: '/admin/reports', label: 'Reports', icon: <Icon d="M9 17v-6m4 6V7m4 10v-4M5 21h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v14a2 2 0 002 2z" /> },
      { href: '/admin/audit', label: 'Audit log', icon: <Icon d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /> },
    ],
  },
  {
    title: 'Governance',
    superadmin: true,
    items: [
      { href: '/admin/game', label: 'Game config', icon: <Icon d="M12 15a3 3 0 100-6 3 3 0 000 6zM19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-2.82 1.17V21a2 2 0 11-4 0v-.09A1.65 1.65 0 007 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06A1.65 1.65 0 004.6 14H4a2 2 0 110-4h.09A1.65 1.65 0 006 7.6l-.06-.06a2 2 0 112.83-2.83l.06.06A1.65 1.65 0 0011 4.6V4a2 2 0 114 0v.09a1.65 1.65 0 002.82 1.17l.06.06a2 2 0 112.83 2.83l.06.06A1.65 1.65 0 0019.4 10H21a2 2 0 110 4h-.09a1.65 1.65 0 00-1.51 1z" /> },
      { href: '/admin/mpesa', label: 'M-Pesa', icon: <Icon d="M5 7h14M5 7a2 2 0 00-2 2v6a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2M5 7V5a2 2 0 012-2h10a2 2 0 012 2v2M12 14a2 2 0 100-4 2 2 0 000 4z" /> },
    ],
  },
];

export function AdminShell({ children }: { children: React.ReactNode }) {
  const hydrated = useHydrated();
  const pathname = usePathname();
  const { status, user, token } = useSession();
  const { open: openAuth } = useAuthUi();
  const { logout } = useAuthActions();

  const isSuper = user?.role === 'superadmin' || user?.role === 'owner';
  const sections = SECTIONS.filter((s) => !s.superadmin || isSuper);
  const active = (href: string) => (href === '/admin' ? pathname === '/admin' : pathname?.startsWith(href));

  if (!hydrated || status === 'loading') {
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <Skeleton className="h-8 w-40" />
      </div>
    );
  }

  if (!token) {
    return (
      <Gate
        title="Admin sign in required"
        body="Sign in with an admin account to access the control panel."
        action={
          <Button onClick={() => openAuth('login')}>Sign in</Button>
        }
      />
    );
  }

  if (user?.role !== 'admin' && !isSuper) {
    return (
      <Gate
        title="No admin access"
        body="This account doesn't have admin privileges."
        action={<Button variant="outline" onClick={logout}>Log out</Button>}
      />
    );
  }

  return (
    <div className="flex min-h-dvh">
      <aside className="flex w-56 shrink-0 flex-col gap-4 border-r border-border bg-surface px-3 py-4">
        <Link href="/" className="flex items-center gap-2 px-1">
          <LogoMark className="h-7 w-7" />
          <span className="text-sm font-semibold tracking-tight">Invest254 Admin</span>
        </Link>

        <nav className="flex flex-1 flex-col gap-3 overflow-y-auto">
          {sections.map((s) => (
            <div key={s.title} className="flex flex-col gap-0.5">
              <span className="px-2 pb-1 text-[11px] font-medium uppercase tracking-wide text-muted">{s.title}</span>
              {s.items.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    'flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm transition',
                    active(item.href) ? 'bg-accent/15 font-medium text-accent' : 'text-muted hover:bg-surface-2 hover:text-fg',
                  )}
                >
                  {item.icon}
                  {item.label}
                </Link>
              ))}
            </div>
          ))}
        </nav>

        <div className="flex flex-col gap-2 border-t border-border pt-3">
          <div className="flex items-center gap-2 px-1">
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-surface-2 text-xs font-semibold">
              {user?.username?.slice(0, 2).toUpperCase() ?? '??'}
            </span>
            <span className="min-w-0 flex-1 truncate text-xs font-medium">{user?.username}</span>
            <span
              className={cn(
                'rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase',
                isSuper ? 'bg-warn/15 text-warn' : 'bg-surface-2 text-muted',
              )}
            >
              {isSuper ? '★ System owner' : 'Operator'}
            </span>
          </div>
          <Button variant="secondary" size="sm" onClick={logout}>
            Log out
          </Button>
        </div>
      </aside>

      <main className="min-w-0 flex-1 px-4 py-5 md:px-6">
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-5">{children}</div>
      </main>
    </div>
  );
}

function Gate({ title, body, action }: { title: string; body: string; action: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-3 px-4 text-center">
      <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
      <p className="max-w-sm text-sm text-muted">{body}</p>
      {action}
    </div>
  );
}
