'use client';

import { AuthButtons } from '@/components/auth/AuthButtons';
import { AccountSwitcher } from '@/components/wallet/AccountSwitcher';
import { Logo } from '@/components/layout/Logo';
import { useBrand } from '@/lib/brand/BrandProvider';
import { useMarketerSkin } from '@/lib/marketer/isMarketer';
import { chartStyleOf, tradingViewTypeOf } from '@invest254/shared/chart';
import { cn } from '@/lib/cn';

export function TopBar() {
  const brand = useBrand();
  const { isMarketer } = useMarketerSkin();
  /**
   * MetaTrader's window title bar is a solid BLUE band — the one piece of colour on an otherwise
   * grey terminal, and the first thing that identifies the app. A translucent surface strip with a
   * marketing lockup was the least MetaTrader thing left above the chart.
   *
   * Scoped to candlestick brands, and never on a marketer screen, where a trading-terminal title bar
   * would undo the neutralisation. Every other shell keeps the standard header.
   */
  const terminal = tradingViewTypeOf(chartStyleOf(brand.chartStyle)) !== null && !isMarketer;

  return (
    <header
      className={cn(
        'sticky top-0 z-30 border-b',
        terminal ? 'border-[#2b3543] bg-[#3183ff]' : 'border-border bg-surface/90 backdrop-blur',
      )}
    >
      <div
        className={cn(
          'flex h-14 w-full items-center gap-1.5 px-3 sm:gap-2 sm:px-4',
          // The terminal fills the width, like the surface below it; every other page keeps the
          // centred reading column.
          terminal ? '' : 'mx-auto max-w-app',
        )}
      >
        {/*
          The brand lockup STAYS. MetaTrader has no wordmark because MetaTrader is the brand; here the
          operator is, and a title bar that names nobody would be a worse screen, not a more faithful
          one. On the blue band it renders in white, as MetaTrader's own title text does.
        */}
        <div className={cn(terminal && '[&_*]:!text-white')}>
          <Logo />
        </div>
        {/* MetaTrader titles its chart window "SYMBOL,PERIOD". The symbol lives in the chart toolbar
            directly below, so repeating it here would say the same thing twice on a phone. */}

        <div className={cn('ml-auto flex items-center gap-1.5 sm:gap-2', terminal && 'text-white')}>
          {/* DEMO-3: the balance is now the Real/Demo switcher (it used to open the Withdraw tab,
              which on a Demo account offered a way out of play money). */}
          <AccountSwitcher />
          <AuthButtons />
        </div>
      </div>
    </header>
  );
}
