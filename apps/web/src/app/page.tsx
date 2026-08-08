import { GameSocketProvider } from '@/lib/game/GameSocketProvider';
import { PriceHeader } from '@/components/game/PriceHeader';
import { TickerStrip } from '@/components/game/TickerStrip';
import { GameCurve } from '@/components/game/GameCurve';
import { BetPanel } from '@/components/game/BetPanel';

export default function GamePage() {
  return (
    <GameSocketProvider>
      {/*
        Full-height column: header info on top, the chart stretches to fill the
        middle, and the trade controls dock to the bottom (above the tab bar on
        mobile). The chart is the only flexible element, so there is never dead
        space between the curve and the panel.
      */}
      <section className="flex min-h-[calc(100dvh-8rem)] flex-col gap-3 pb-[17rem] md:min-h-0 md:pb-0">
        <PriceHeader />
        <TickerStrip />
        <div className="min-h-[280px] flex-1 md:min-h-[420px]">
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
