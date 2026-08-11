import { GameSocketProvider } from '@/lib/game/GameSocketProvider';
import { PriceHeader } from '@/components/game/PriceHeader';
import { TickerStrip } from '@/components/game/TickerStrip';
import { GameCurve } from '@/components/game/GameCurve';
import { BetPanel } from '@/components/game/BetPanel';

export default function GamePage() {
  return (
    <GameSocketProvider>
      {/*
        Trading-terminal layout. The parent <main> (AppShell trade frame) is a
        locked-height flex column, so this section simply fills it: the price
        header and ticker sit on top, the chart flex-fills every remaining pixel,
        and the trade console docks at the bottom — all in normal flow. Nothing
        is position:fixed here, so the chart can never render under the panel and
        there is never dead space. The page itself does not scroll on mobile.
      */}
      <section className="flex h-full min-h-0 flex-col gap-2 md:gap-3">
        <PriceHeader />
        <TickerStrip />
        <div className="min-h-0 flex-1">
          <GameCurve />
        </div>
        <BetPanel />
      </section>
    </GameSocketProvider>
  );
}
