import { GameSocketProvider } from '@/lib/game/GameSocketProvider';
import { PriceHeader } from '@/components/game/PriceHeader';
import { TickerStrip } from '@/components/game/TickerStrip';
import { GameCurve } from '@/components/game/GameCurve';
import { BetPanel } from '@/components/game/BetPanel';

export default function GamePage() {
  return (
    <GameSocketProvider>
      {/*
        Trading-terminal layout: the section is a fixed-height column sized to the
        viewport (minus the sticky top bar). Header stats sit on top, the chart
        flex-fills every remaining pixel, and the trade console is docked to the
        bottom above the mobile tab bar — so there is never dead space anywhere.
        The page itself never scrolls on mobile; only the chart stretches.
      */}
      <section className="flex h-[calc(100dvh-7.5rem)] flex-col gap-2.5 md:h-auto md:min-h-[calc(100dvh-10rem)]">
        <PriceHeader />
        <TickerStrip />
        <div className="min-h-0 flex-1 md:min-h-[420px]">
          <GameCurve />
        </div>
        <div
          data-testid="bet-panel-dock"
          className="fixed inset-x-0 bottom-[calc(4rem+env(safe-area-inset-bottom))] z-20 border-t border-border bg-bg pt-2 md:static md:border-0 md:bg-transparent md:pt-0"
        >
          <div className="mx-auto w-full max-w-app px-4 md:px-0">
            <BetPanel />
          </div>
        </div>
      </section>
    </GameSocketProvider>
  );
}
