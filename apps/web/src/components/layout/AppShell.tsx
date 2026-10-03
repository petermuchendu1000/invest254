'use client';

import * as React from 'react';
import { usePathname } from 'next/navigation';
import { chartStyleOf, tradingViewTypeOf } from '@invest254/shared/chart';
import { cn } from '@/lib/cn';
import { TopBar } from '@/components/layout/TopBar';
import { BottomNav } from '@/components/layout/BottomNav';
import { DigitsTopBar } from '@/components/layout/DigitsTopBar';
import { DigitsBottomNav } from '@/components/layout/DigitsBottomNav';
import { PositionsSheet } from '@/components/game/digits/PositionsSheet';
import { TransactionHistoryModal } from '@/components/game/digits/TransactionHistoryModal';
import { HowToTradeModal } from '@/components/game/digits/HowToTradeModal';
import { SoundBootstrap } from '@/components/layout/SoundToggle';
import { LiveChatPanel, LiveChatLauncher } from '@/components/chat/LiveChatPanel';
import { AccountDialogs } from '@/components/account/AccountDialogs';
import { Footer } from '@/components/layout/Footer';
import { AuthModal } from '@/components/auth/AuthModal';
import { WalletModal } from '@/components/wallet/WalletModal';
import { SessionBootstrap } from '@/components/auth/SessionBootstrap';
import { NotificationBanners } from '@/components/notifications/NotificationBanners';
import { RegisterSW } from '@/components/RegisterSW';
import { MarketerHUD } from '@/components/marketer/MarketerHUD';
import { MT5Drawer } from '@/components/layout/MT5Drawer';
import { useBrand } from '@/lib/brand/BrandProvider';
import { useMarketerSkin } from '@/lib/marketer/isMarketer';
import { isTerminalScreen, isTerminalRoute } from '@/lib/ui/terminalScreen';

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const brand = useBrand();
  const { isMarketer } = useMarketerSkin();

  // The admin console + platform console provide their own chrome (sidebar). Suppress the player
  // top bar / bottom nav / footer there, but keep session bootstrap + SW.
  if (pathname?.startsWith('/admin') || pathname?.startsWith('/platform') || pathname?.startsWith('/console')) {
    return (
      <>
        {children}
        <SessionBootstrap />
        <RegisterSW />
      </>
    );
  }

  // The trade screen is an app-like, single-viewport surface: it must never
  // page-scroll on mobile and the chart must flex-fill the space between the
  // header and the trade console. We lock the frame to the viewport height and
  // drop the marketing footer + spacer here (legal lives in Profile/Legal).
  const isTrade = pathname === '/';

  // Digits-brand trade surface (trade_ui = 'digits'): the mock's app-like shell — a digits top bar
  // (hamburger nav drawer + wordmark + balance + Deposit) and a Live Chat / AI / Positions bottom
  // nav. Scoped to digits brands only; every other brand keeps the standard TopBar/BottomNav below.
  if (isTrade && brand.tradeUi === 'digits') {
    return (
      <div className="flex h-dvh flex-col overflow-hidden">
        <DigitsTopBar />
        <NotificationBanners />
        <main className="relative flex w-full min-h-0 flex-1 flex-col px-2 pb-[calc(5.25rem+env(safe-area-inset-bottom))] pt-2 sm:px-3 lg:p-0">
          {children}
        </main>
        <DigitsBottomNav />
        <PositionsSheet />
        <TransactionHistoryModal />
        <HowToTradeModal />
        <SoundBootstrap />
        <LiveChatPanel />
        <AccountDialogs />
        <SessionBootstrap />
        <AuthModal />
        <WalletModal />
        <RegisterSW />
        {/* The covert marketer entry as a corner hotspot. Only the digits shell needs it:
            every other shell gets it overlaid on the logo by TopBar, which the digits
            wordmark cannot carry because it is hidden outright on a narrow phone. */}
        <MarketerHUD />
        <MT5Drawer />
      </div>
    );
  }

  if (isTrade) {
    // A candlestick brand is a TERMINAL: on a wide screen it fills the viewport the way MetaTrader
    // does, rather than sitting in the centred reading column the rest of the site uses. Below `lg`
    // both are the same single mobile-first column.
    const terminal = tradingViewTypeOf(chartStyleOf(brand.chartStyle)) !== null;
    return (
      <div className="flex h-dvh flex-col overflow-hidden">
        <TopBar />
        <NotificationBanners />
        <main className={cn(
          'relative flex w-full min-h-0 flex-1 flex-col pt-2',
          // A terminal brand has no bottom nav (MT5Drawer replaces it), so nothing is reserved for
          // one — and the gutters tighten, because this is the screen the chart lives on.
          terminal
            ? 'px-2 pb-[env(safe-area-inset-bottom)] md:px-4 md:pb-4 lg:px-3 xl:px-4'
            : 'mx-auto max-w-app px-3 pb-[calc(4.75rem+env(safe-area-inset-bottom))] md:px-4 md:pb-4',
        )}>
          {children}
        </main>
        <BottomNav />
        <SessionBootstrap />
        <AuthModal />
        <WalletModal />
        <RegisterSW />
        <LiveChatLauncher />
        <LiveChatPanel />
        <AccountDialogs />
        <MT5Drawer />
      </div>
    );
  }

  // A MetaTrader screen off the trade surface (History today) is still a terminal screen: it fills
  // the window edge to edge, draws its own blue title bar flush under the app bar, and ends at the
  // toolbar — so no centred reading column, no page padding, and no marketing footer under it.
  if (isTerminalScreen(tradingViewTypeOf(chartStyleOf(brand.chartStyle)) !== null, isMarketer) && isTerminalRoute(pathname)) {
    return (
      <div className="flex min-h-dvh flex-col">
        <TopBar />
        <NotificationBanners />
        <main className="flex w-full flex-1 flex-col pb-[env(safe-area-inset-bottom)] md:pb-4">
          {children}
        </main>
        <BottomNav />
        <SessionBootstrap />
        <AuthModal />
        <WalletModal />
        <RegisterSW />
        <LiveChatLauncher />
        <LiveChatPanel />
        <AccountDialogs />
        <MT5Drawer />
      </div>
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
      <LiveChatLauncher />
      <LiveChatPanel />
        <AccountDialogs />
      <MT5Drawer />
    </div>
  );
}
