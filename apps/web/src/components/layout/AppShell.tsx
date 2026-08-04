'use client';

import * as React from 'react';
import { usePathname } from 'next/navigation';
import { TopBar } from '@/components/layout/TopBar';
import { BottomNav } from '@/components/layout/BottomNav';
import { Footer } from '@/components/layout/Footer';
import { AuthModal } from '@/components/auth/AuthModal';
import { WalletModal } from '@/components/wallet/WalletModal';
import { SessionBootstrap } from '@/components/auth/SessionBootstrap';
import { NotificationBanners } from '@/components/notifications/NotificationBanners';
import { RegisterSW } from '@/components/RegisterSW';

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  // The admin console provides its own chrome (sidebar). Suppress the player
  // top bar / bottom nav / footer there, but keep session bootstrap + SW.
  if (pathname?.startsWith('/admin')) {
    return (
      <>
        {children}
        <SessionBootstrap />
        <RegisterSW />
      </>
    );
  }

  return (
    <div className="flex min-h-dvh flex-col">
      <TopBar />
      <NotificationBanners />
      <main className="mx-auto w-full max-w-app flex-1 px-4 py-4">{children}</main>
      <Footer />
      {/* Spacer so the fixed mobile BottomNav never covers footer content. */}
      <div aria-hidden className="h-20 md:hidden" />
      <BottomNav />
      <SessionBootstrap />
      <AuthModal />
      <WalletModal />
      <RegisterSW />
    </div>
  );
}
