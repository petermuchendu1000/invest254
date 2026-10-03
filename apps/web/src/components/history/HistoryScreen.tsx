'use client';

import { chartStyleOf, tradingViewTypeOf } from '@invest254/shared/chart';
import { useBrand } from '@/lib/brand/BrandProvider';
import { useMarketerSkin } from '@/lib/marketer/isMarketer';
import { HistoryTabs } from '@/components/wallet/HistoryTabs';
import { MT5History } from '@/components/history/MT5History';
import { isTerminalHistory } from '@/lib/history/terminal';

/**
 * A candlestick brand's History screen is MetaTrader's, not the site's generic tabs. Every other
 * shell — line/wave, digits — and every marketer screen keeps what it had.
 */
export function HistoryScreen() {
  const brand = useBrand();
  const { isMarketer } = useMarketerSkin();
  if (isTerminalHistory(tradingViewTypeOf(chartStyleOf(brand.chartStyle)) !== null, isMarketer)) {
    return <MT5History />;
  }
  return (
    <section className="flex flex-col gap-4">
      <h1 className="text-lg font-semibold text-fg">History</h1>
      <HistoryTabs />
    </section>
  );
}
