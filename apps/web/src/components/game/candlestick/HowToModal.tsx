'use client';

import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api/endpoints';
import { useBrand } from '@/lib/brand/BrandProvider';
import { useDisplayMoney } from '@/lib/money';
import { useStakeLimits } from '@/lib/game/useStakeLimits';
import { useCandlestickUi } from '@/components/game/candlestick/ui';

/**
 * The top bar's "How to Trade" sheet.
 *
 * It describes THIS product's contract, not the mock's: an amount, a side, and a fixed time after
 * which the engine settles it. The digits screen has its own version for its own contracts; sharing
 * one would mean a screen explaining rules it does not run.
 *
 * The figures are read from the brand's own config rather than written into the copy, because a
 * help sheet quoting a stake floor the brand does not use is worse than no help sheet.
 */
export function HowToModal() {
  const open = useCandlestickUi((s) => s.howToOpen);
  const setOpen = useCandlestickUi((s) => s.setHowTo);
  const brand = useBrand();
  const limits = useStakeLimits();
  const { both } = useDisplayMoney();
  const { data: config } = useQuery({
    queryKey: ['gameConfig', brand.slug],
    queryFn: () => api.gameConfig(brand.slug),
    staleTime: 5 * 60_000,
  });

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, setOpen]);

  if (!open) return null;

  const seconds = config?.defaultDurationS ?? 10;
  const sections = [
    { title: 'Placing a trade', body: `Type an amount, or tap one of the quick amounts, then choose a side. BUY wins if the price is higher when the trade closes; SELL wins if it is lower.` },
    { title: 'When it closes', body: `A trade closes on its own ${seconds} seconds after it opens. You do not have to watch it — the result is applied to your balance either way.` },
    { title: 'Your stake', body: `The amount is taken from your balance when the trade opens${limits.ready ? `, and must be between ${both(limits.minCents)} and ${limits.maxCents !== undefined ? both(limits.maxCents) : 'the brand maximum'}` : ''}. If the trade wins, the stake and the profit are credited back; if it loses, the stake is gone.` },
    { title: 'The chart', body: 'Each candle covers one minute: the body runs from the opening price to the closing price, and the thin wick shows the highest and lowest the price reached inside that minute. Green means it closed above where it opened, red below.' },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-0 sm:items-center sm:p-4" onClick={() => setOpen(false)}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="How to trade"
        className="max-h-[85dvh] w-full max-w-lg overflow-y-auto rounded-t-2xl border border-[#1f2937] bg-[#111827] sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 flex items-center justify-between border-b border-[#1f2937] bg-[#111827] px-4 py-3">
          <div className="text-sm font-bold text-white">How to Trade</div>
          <button type="button" onClick={() => setOpen(false)} aria-label="Close" className="h-8 w-8 rounded text-gray-400 hover:bg-[#1f2937] hover:text-white">×</button>
        </div>
        <div className="space-y-4 p-4">
          {sections.map((s) => (
            <div key={s.title}>
              <div className="mb-1 text-xs font-bold uppercase tracking-wider text-[#22c55e]">{s.title}</div>
              <p className="text-sm leading-relaxed text-gray-300">{s.body}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
