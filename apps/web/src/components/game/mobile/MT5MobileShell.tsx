'use client';

import { useState } from 'react';
import { GameCurve } from '@/components/game/GameCurve';
import { MarketWatch } from '@/components/game/MarketWatch';
import { MT5History } from '@/components/history/MT5History';
import { MT5MobileOrder } from '@/components/game/mobile/MT5MobileOrder';
import { MT5TradeDialog } from '@/components/game/mobile/MT5TradeDialog';
import { MT5MobileTabs } from '@/components/game/mobile/MT5MobileTabs';
import { MT5MobileTrade } from '@/components/game/mobile/MT5MobileTrade';
import { MT5MobileMessages } from '@/components/game/mobile/MT5MobileMessages';
import { MT5OneClickPanel } from '@/components/game/mobile/MT5OneClickPanel';
import { useMobileTabStore, useRestoreMobileTab } from '@/lib/game/mobileTab';
import { useOneClickStore, useRestoreOneClick } from '@/lib/game/oneClick';

/**
 * MetaTrader's phone app, as a shell.
 *
 * ── Why this exists ──────────────────────────────────────────────────────────────────────────────
 * The terminal's desktop layout — Market Watch docked left, chart and Toolbox in the middle, order
 * ticket docked right — was being rendered on a phone as one tall column. Measured at 360×800 the
 * chart got 168 of those 800 pixels, the order ticket took about 60% of the screen, and the page
 * did not scroll, so whatever did not fit was simply unreachable.
 *
 * MetaTrader's answer to a phone is not a narrower desktop. It is five tabs with ONE full-screen
 * view at a time, and that is what this is. The tab set, its labels and its order are Android's:
 * Quotes · Charts · Trade · History · Messages (docs/mt5/04-mobile-app.md section 1).
 *
 * ── One tree, not two ────────────────────────────────────────────────────────────────────────────
 * The phone shell and the desktop layout are chosen in JavaScript (`useIsPhone`), not with
 * `lg:hidden`, so only one of them is ever mounted. Rendering both and hiding one would mean two
 * charts, two quote subscriptions and two sets of chart state live at once — the thing the desktop
 * layout's own comment says it was built to avoid.
 *
 * ── Every destination still reachable ────────────────────────────────────────────────────────────
 * The five tabs cover MetaTrader's five. The app's own destinations that MetaTrader has no tab for
 * (deposit, account, legal, live chat) are in the drawer, which the chart's `☰` opens — the same
 * place a terminal brand has kept them since the app bar lost its bottom nav.
 */
export function MT5MobileShell() {
  const tab = useMobileTabStore((s) => s.tab);
  const setTab = useMobileTabStore((s) => s.set);
  useRestoreMobileTab();
  const panelShown = useOneClickStore((s) => s.shown);
  useRestoreOneClick();

  /**
   * MetaTrader's New Order screen, over whatever tab is showing.
   *
   * It is a screen rather than a tab because MetaTrader's is: it is pushed from the Trade screen's
   * `＋` and from the one-click panel when one-click firing is off, and it is dismissed back to
   * where it was opened from.
   *
   * Its ticket is `MT5MobileOrder`, which is MetaTrader's PHONE ticket rather than the desktop one
   * this screen used to carry. They place the same order — both read `useOrderEntry`, so the volume
   * set on the one-click panel is the volume this screen opens on — and they are laid out the way
   * MetaTrader lays each of them out, which is not the same way.
   */
  const [ticketOpen, setTicketOpen] = useState(false);
  /**
   * MetaTrader's ADVANCED trading dialog, which is "used from the chart".
   *
   * The two are reached from different places in MetaTrader and that is copied: the chart's
   * one-click panel opens this sheet, the Trade screen's `+` opens the classic full-screen ticket,
   * and the classic ticket's top-right button switches to this one. Both place the same order
   * through `useOrderEntry`.
   */
  const [dialogOpen, setDialogOpen] = useState(false);

  return (
    <div className="flex h-full min-h-0 flex-col bg-[#0f1720]">
      <div className="relative min-h-0 flex-1">
        {/* Charts stays MOUNTED across tab switches, hidden rather than unmounted.
            A chart that is torn down every time the trader looks at their positions refetches its
            whole history on the way back, which on a phone is a second of blank screen each time.
            MetaTrader's own tabs do not do that. The other four are cheap, so they unmount. */}
        <div
          className={tab === 'charts' ? 'flex h-full min-h-0 flex-col' : 'hidden'}
          aria-hidden={tab === 'charts' ? undefined : true}
        >
          <div className="min-h-0 flex-1">
            <GameCurve phone />
          </div>
          {/* MetaTrader's one-click panel, in its "panel at the bottom" placement. The `▭` button on
              the chart's own top bar is what shows and hides it. */}
          {panelShown ? <MT5OneClickPanel onOpenTicket={() => setDialogOpen(true)} /> : null}
        </div>

        {tab === 'quotes' ? (
          <MarketWatch
            phone
            className="h-full"
            onChart={() => setTab('charts')}
            onNewOrder={() => setTicketOpen(true)}
          />
        ) : null}
        {tab === 'trade' ? (
          <MT5MobileTrade
            onNewOrder={() => setTicketOpen(true)}
            onChart={() => setTab('charts')}
          />
        ) : null}
        {tab === 'history' ? (
          <div className="flex h-full flex-col overflow-y-auto">
            <MT5History embedded />
          </div>
        ) : null}
        {tab === 'messages' ? <MT5MobileMessages /> : null}
      </div>

      <MT5MobileTabs />

      {ticketOpen ? (
        <div className="fixed inset-0 z-50 flex flex-col bg-[#0f1720]">
          <MT5MobileOrder
            onBack={() => setTicketOpen(false)}
            onAdvanced={() => { setTicketOpen(false); setDialogOpen(true); }}
          />
        </div>
      ) : null}

      {dialogOpen ? <MT5TradeDialog onDismiss={() => setDialogOpen(false)} /> : null}
    </div>
  );
}
