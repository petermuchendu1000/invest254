'use client';

import { formatKes } from '@invest254/shared/money';
import type { SessionTargetDto } from '@/lib/api/types';

/**
 * "2 / 5 sessions · KES 1,500" — the target a platform admin agreed with this marketer (0214).
 *
 * WHAT THIS IS NOT. It is not a balance, and it is not credited. Completing the target does not move
 * money: an admin reads the same count and pays through the payout/advance path, which has an
 * approval step. The card says so in its own words, because a money figure on a money screen is read
 * as money unless it tells you otherwise — the same mistake the Pay Bill claim screen made when it
 * called an already-credited payment an invalid code (BUGLOG #163 part 3).
 *
 * WHY PIPS AND NOT A BAR. Targets are small (1-100, in practice ~5). A bar at 40% is a proportion; "2
 * of 5 done, 3 to go" is a plan. Discrete marks also make the goal gradient visible — the thing that
 * actually moves behaviour late in a target is SEEING how few are left, and a bar hides that. Above
 * ten the pips would become confetti, so it falls back to a bar and a count.
 */
export function SessionTargetCard({ target }: { target: SessionTargetDto }) {
  const { targetSessions, completed, amountCents, qualifyMinutes, done } = target;
  const left = Math.max(0, targetSessions - completed);
  const pct = targetSessions > 0 ? Math.min(100, Math.round((completed / targetSessions) * 100)) : 0;

  return (
    <section
      className={`rounded-2xl border p-4 ${done ? 'border-up/40 bg-up/5' : 'border-accent/30 bg-accent/5'}`}
      aria-label="Session target"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <p className="text-[11px] font-medium uppercase tracking-wide text-muted">Session target</p>
        <p className="text-[11px] text-muted">
          {done ? 'Target met' : left === 1 ? '1 session to go' : `${left} sessions to go`}
        </p>
      </div>

      <div className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="text-3xl font-black tabular-nums text-fg">
          {completed}<span className="text-muted">/{targetSessions}</span>
        </span>
        <span className="text-base font-bold tabular-nums text-up">{formatKes(amountCents)}</span>
      </div>

      {targetSessions <= 10 ? (
        <div className="mt-3 flex gap-1.5" role="img" aria-label={`${completed} of ${targetSessions} sessions completed`}>
          {Array.from({ length: targetSessions }, (_, i) => (
            <span
              key={i}
              className={`h-2 flex-1 rounded-full ${i < completed ? (done ? 'bg-up' : 'bg-accent') : 'bg-surface-2'}`}
            />
          ))}
        </div>
      ) : (
        <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-surface-2" role="img" aria-label={`${pct}% of the target completed`}>
          <span className={`block h-full rounded-full ${done ? 'bg-up' : 'bg-accent'}`} style={{ width: `${pct}%` }} />
        </div>
      )}

      {/* The two things that stop this figure being misread, in the marketer's own terms. */}
      <p className="mt-2.5 text-[11px] leading-relaxed text-muted">
        {done
          ? 'You have completed this target. Your admin reviews and pays it — it is not added to your balance automatically.'
          : `Agreed with your admin. A live session counts once it has run ${qualifyMinutes} minutes or more.`}
      </p>
    </section>
  );
}
