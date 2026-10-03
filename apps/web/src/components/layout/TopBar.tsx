'use client';

import { AuthButtons } from '@/components/auth/AuthButtons';
import { AccountSwitcher } from '@/components/wallet/AccountSwitcher';
import { Logo } from '@/components/layout/Logo';
import { useBrand } from '@/lib/brand/BrandProvider';
import { useTerminalSkin } from '@/lib/ui/useTerminalSkin';
import { useNavDrawer } from '@/lib/ui/drawer';
import { cn } from '@/lib/cn';

export function TopBar() {
  const brand = useBrand();
  /**
   * MetaTrader's window title bar: a solid BLUE band, a hamburger at the left that opens the side
   * panel, the name, and the screen's own controls at the right. The hamburger is not decoration —
   * on a terminal brand it is the whole of the app's navigation, because the bottom nav is gone
   * (see MT5Drawer, and BottomNav).
   *
   * Scoped to candlestick brands, and never on a marketer screen, where a trading-terminal title bar
   * would undo the neutralisation. Every other shell keeps the standard header.
   */
  const terminal = useTerminalSkin();
  const toggleDrawer = useNavDrawer((s) => s.toggle);

  return (
    <header
      className={cn(
        'sticky top-0 z-30 border-b',
        terminal ? 'border-[#2b3543] bg-[#3183ff]' : 'border-border bg-surface/90 backdrop-blur',
      )}
    >
      <div
        className={cn(
          'flex w-full items-center',
          // Tighter on the terminal: the bar is chrome, and every row of a phone screen it does not
          // take is a row the chart does.
          terminal ? 'h-12 gap-2 px-2' : 'mx-auto h-14 max-w-app gap-1.5 px-3 sm:gap-2 sm:px-4',
        )}
      >
        {terminal ? (
          <button
            type="button"
            onClick={toggleDrawer}
            aria-label="Open menu"
            className="-ml-0.5 grid h-10 w-10 shrink-0 place-items-center rounded text-white transition hover:bg-white/20"
          >
            <svg viewBox="0 0 24 24" className="h-[22px] w-[22px]" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
              <path d="M4 7h16M4 12h16M4 17h16" />
            </svg>
          </button>
        ) : null}

        {/*
          The brand lockup STAYS. MetaTrader has no wordmark because MetaTrader is the brand; here the
          operator is, and a title bar that names nobody would be a worse screen, not a more faithful
          one. On the blue band it renders in white, as MetaTrader's own title text does.
        */}
        <div className={cn('min-w-0', terminal && '[&_*]:!text-white')}>
          <Logo />
        </div>

        <div className={cn('ml-auto flex items-center', terminal ? 'gap-1' : 'gap-1.5 sm:gap-2', terminal && 'text-white')}>
          {/*
            DEMO-3: the balance pill is the Real/Demo switcher (it used to open the Withdraw tab,
            which on a Demo account offered a way out of play money).
            On the terminal it is NOT here: MetaTrader's title bar carries the screen, not the
            money, and at 390px a hamburger plus a wordmark plus a dark balance pill plus an avatar
            truncated the brand name to "invest254....". The balance moved to the side panel's
            header, where MetaTrader puts it, and the Real/Demo switch is one tap further on the
            account panel the header links to.
          */}
          {terminal ? null : <AccountSwitcher />}
          <AuthButtons />
        </div>
      </div>
    </header>
  );
}
