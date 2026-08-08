import { GameSocketProvider } from '@/lib/game/GameSocketProvider';
import { PriceHeader } from '@/components/game/PriceHeader';
import { TickerStrip } from '@/components/game/TickerStrip';
import { GameCurve } from '@/components/game/GameCurve';
import { BetPanel } from '@/components/game/BetPanel';

export default function GamePage() {
  return (
    <GameSocketProvider>
      <section className="flex flex-col gap-3 pb-[21rem] md:pb-0">
        <PriceHeader />
        <TickerStrip />
        <GameCurve />
        {/*
          On mobile, dock the trade controls to the bottom of the screen so BUY/SELL
          is always visible. The dock is `fixed` (out of normal flow); on md+ the
          wrapper collapses to `display:contents`, restoring the inline stacked layout.
        */}
        <div
          data-testid="bet-panel-dock"
          className="fixed inset-x-0 bottom-[calc(4rem+env(safe-area-inset-bottom))] z-20 border-t border-border bg-bg pt-2 md:contents"
        >
          <div className="mx-auto flex w-full max-w-app flex-col gap-3 px-4 md:contents md:px-0">
            <BetPanel />
          </div>
        </div>
      </section>
    </GameSocketProvider>
  );
}
