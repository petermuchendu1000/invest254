'use client';

import { useEffect, useState } from 'react';
import { useBrand } from '@/lib/brand/BrandProvider';
import { useMarketerSkin, useIsMarketer } from '@/lib/marketer/isMarketer';
import { PriceHeader } from '@/components/game/PriceHeader';
import { TickerStrip } from '@/components/game/TickerStrip';
import { GameCurve } from '@/components/game/GameCurve';
import { BetPanel } from '@/components/game/BetPanel';
import { InterfaceModeToggle } from '@/components/game/InterfaceModeToggle';
import { DigitsTradeScreen } from '@/components/game/digits/DigitsTradeScreen';

/**
 * Chooses the trade layout for the current brand:
 *  - 'classic' (default): the rise/fall curve terminal (PriceHeader + ticker + chart + BetPanel).
 *  - 'digits': the Deriv-style binary/digits broker screen.
 *
 * The brand value (`brand.tradeUi`) is the source of truth once the per-client toggle is wired in
 * the platform console. A `?ui=digits` / `?ui=classic` query param (persisted to localStorage) is a
 * safe preview override so the layout can be trialled on any brand before flipping the real flag.
 */
export function TradeSurface() {
  const brand = useBrand();
  const { isMarketer } = useMarketerSkin();
  // Real role (not the skin): marketers are always disguised and must NOT see the interface toggle
  // (a settings gear would itself be a TikTok tell). Players — including those currently on Basic —
  // keep the gear so they can switch back.
  const { isMarketer: isMarketerRole } = useIsMarketer();
  const [override, setOverride] = useState<string | null>(null);

  useEffect(() => {
    try {
      const q = new URLSearchParams(window.location.search).get('ui');
      if (q) window.localStorage.setItem('pp:tradeUi', q);
      setOverride(q ?? window.localStorage.getItem('pp:tradeUi'));
    } catch {
      /* SSR / no window — fall back to the brand value */
    }
  }, []);

  const ui = override ?? brand.tradeUi ?? 'classic';

  if (ui === 'digits') return <DigitsTradeScreen />;

  return (
    <section className="flex h-full min-h-0 flex-col gap-2 md:gap-3">
      {/* Interface gear — players switch Classic ↔ Basic here. Stays visible in both modes so a
          Basic-mode player can switch back; hidden for real marketers (always disguised). */}
      {isMarketerRole ? null : (
        <div className="flex items-center justify-end">
          <InterfaceModeToggle />
        </div>
      )}
      {/* MARKETER: the BTC/KES price strip and the scrolling crypto ticker are the two loudest
          "this is a trading terminal" signals — both are removed for marketers (Phase 1). */}
      {isMarketer ? null : <PriceHeader />}
      {isMarketer ? null : (
        // short phones (SE): the decorative marquee gives its row to the chart
        <div className="[@media(max-height:640px)]:hidden"><TickerStrip /></div>
      )}
      <div className="min-h-[160px] flex-1">
        <GameCurve />
      </div>
      <BetPanel />
    </section>
  );
}
