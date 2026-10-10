'use client';

/**
 * The rail's Tours tab: the mock's tournaments list.
 *
 * Like the leaderboard beside it, there is nothing behind this yet — no tournament table, no entry,
 * no prize ledger — and a tournament a player could "join" that does not exist would be worse than
 * an empty tab. The mock's surface is here; the state it shows is the true one.
 */
export function TournamentsPane() {
  const tournaments: { id: string; name: string; prize: string; ends: string }[] = [];

  return (
    <div className="flex h-full flex-col space-y-3 bg-[#080d18] p-4">
      <div className="shrink-0 text-xs font-bold uppercase tracking-widest text-white">Tournaments</div>
      {tournaments.length === 0 ? (
        <p className="px-2 py-8 text-center text-xs italic text-gray-500">No tournaments running right now.</p>
      ) : (
        tournaments.map((t) => (
          <div key={t.id} className="rounded-xl bg-[#0d1525] p-4">
            <div className="text-sm font-bold text-white">{t.name}</div>
            <div className="mt-1 text-xs text-gray-400">Prize {t.prize} · ends {t.ends}</div>
          </div>
        ))
      )}
    </div>
  );
}
