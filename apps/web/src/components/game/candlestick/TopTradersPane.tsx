'use client';

import { useState } from 'react';
import { cn } from '@/lib/cn';

/** The mock's four ranges, in its order. */
const PERIODS = ['Today', 'Yesterday', 'This Week', 'This Month'] as const;
type Period = (typeof PERIODS)[number];

/**
 * The rail's Top tab: the mock's leaderboard, chrome and all.
 *
 * There is no leaderboard behind it yet. This product ranks nobody — there is no endpoint, no table
 * and no decision about what "top" would even measure (profit? turnover? a streak?), and inventing
 * a board of winners would be inventing the winners. So the panel is built to the mock and says
 * plainly that it has nothing to show, which is the one honest state a ranking can be in before it
 * exists. Wire a `/leaderboard` endpoint to `rows` and the panel is finished.
 */
export function TopTradersPane() {
  const [period, setPeriod] = useState<Period>('Today');
  const rows: { rank: number; name: string; stat: string }[] = [];

  return (
    <div className="flex h-full flex-col bg-[#080d18]">
      <div className="flex shrink-0 items-center gap-2 px-4 pb-2 pt-4">
        <span className="text-xs font-bold uppercase tracking-widest text-white">Top Traders</span>
      </div>

      <div className="scrollbar-none flex shrink-0 gap-1 overflow-x-auto px-3 pb-3">
        {PERIODS.map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => setPeriod(p)}
            className={cn(
              'shrink-0 whitespace-nowrap rounded-full px-2 py-1 text-[10px] font-bold uppercase tracking-wide transition-colors',
              p === period ? 'bg-[#22c55e] text-black' : 'bg-[#1f2937] text-gray-400 hover:text-white',
            )}
          >
            {p}
          </button>
        ))}
      </div>

      <div className="scrollbar-none min-h-0 flex-1 space-y-1.5 overflow-y-auto px-3 pb-3">
        {rows.length === 0 ? (
          <p className="px-2 py-8 text-center text-xs italic text-gray-500">No rankings for {period.toLowerCase()} yet.</p>
        ) : (
          rows.map((r) => (
            <div key={r.rank} className="flex items-center gap-3 rounded-lg bg-[#0d1525] p-2.5">
              <div className="w-5 text-xs font-bold text-gray-500">{r.rank}</div>
              <div className="h-8 w-8 rounded-full bg-[#1f2937]" />
              <div className="min-w-0 flex-1 text-xs font-semibold text-white">{r.name}</div>
              <div className="text-xs font-bold text-[#22c55e]">{r.stat}</div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
