'use client';

import { useEffect, useRef, useState } from 'react';
import { formatKes } from '@invest254/shared/money';
import { useSession } from '@/lib/auth/session';
import {
  useMarketerLiveSummary,
  useAffiliateReferrals,
  useAffiliateCommissions,
  useAffiliateExpenses,
  useAffiliatePayout,
} from '@/lib/affiliate/hooks';

/**
 * Hidden, marketer-only dashboard.
 *
 * Entry is covert (requirement): NO visible button a watching player could notice — only an
 * invisible ~650ms long-press hotspot in the top-left corner opens it. Renders nothing for
 * non-marketers, so a player on their own device has no entry point.
 *
 * The panel itself is a full, professional marketer portal (patterned on partner/affiliate
 * dashboards): live KPIs, a payout request, earnings + referrals history, and a fully transparent
 * expenses ledger (every cost an admin logs against the marketer — promo, data bundles, advances).
 */
export function MarketerHUD() {
  const role = useSession((s) => s.user?.role);
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isMarketer = role === 'marketer';

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  if (!isMarketer) return null;

  const startPress = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setOpen(true), 650);
  };
  const cancelPress = () => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
  };

  return (
    <>
      {/* Invisible long-press hotspot — top-left corner, above the header. No visual footprint. */}
      <div
        onPointerDown={startPress}
        onPointerUp={cancelPress}
        onPointerLeave={cancelPress}
        onPointerCancel={cancelPress}
        onContextMenu={(e) => e.preventDefault()}
        aria-hidden
        className="fixed left-0 top-0 z-[60] h-11 w-11"
        style={{ WebkitTapHighlightColor: 'transparent', touchAction: 'none' }}
      />
      {open ? <MarketerDashboard onClose={() => setOpen(false)} /> : null}
    </>
  );
}

// ── Category presentation ──────────────────────────────────────────────────────────────────────
const CATEGORY_META: Record<string, { label: string; glyph: string }> = {
  tiktok_promo: { label: 'TikTok promo', glyph: '🎵' },
  data_bundles: { label: 'Data bundles', glyph: '📶' },
  advance: { label: 'Advance payment', glyph: '💵' },
  airtime: { label: 'Airtime', glyph: '📱' },
  transport: { label: 'Transport', glyph: '🚕' },
  other: { label: 'Other', glyph: '🧾' },
};
function catMeta(c: string) {
  return CATEGORY_META[c] ?? { label: c.replace(/_/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase()), glyph: '🧾' };
}

function MarketerDashboard({ onClose }: { onClose: () => void }) {
  const q = useMarketerLiveSummary(true);
  const referrals = useAffiliateReferrals(true);
  const commissions = useAffiliateCommissions(true);
  const expenses = useAffiliateExpenses(true);
  const payout = useAffiliatePayout();
  const [payoutMsg, setPayoutMsg] = useState<{ tone: 'up' | 'down'; text: string } | null>(null);

  const s = q.data;
  const refRows = referrals.data?.pages.flatMap((p) => p.items) ?? [];
  const commRows = commissions.data?.pages.flatMap((p) => p.items) ?? [];
  const expRows = expenses.data?.items ?? [];
  const expTotal = expenses.data?.totalCents ?? 0;

  const earnedAllTime = s ? s.commissionAccruedCents + s.commissionPaidCents : 0;
  const netAfterExpenses = earnedAllTime - expTotal;

  const requestPayout = () => {
    setPayoutMsg(null);
    payout.mutate(undefined, {
      onSuccess: (r) => setPayoutMsg({ tone: 'up', text: `Payout of ${formatKes(r.amountCents)} requested — pending admin approval.` }),
      onError: (e) => {
        const code = e instanceof Error ? e.message : '';
        const text = /NO_AVAILABLE_COMMISSION/.test(code)
          ? 'Nothing available to withdraw yet.'
          : /PAYOUT_PENDING/.test(code)
            ? 'You already have a payout awaiting approval.'
            : 'Could not request payout. Try again shortly.';
        setPayoutMsg({ tone: 'down', text });
      },
    });
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center sm:items-center" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative flex max-h-[92vh] w-full max-w-lg flex-col overflow-hidden rounded-t-3xl border border-border bg-surface shadow-2xl sm:rounded-3xl">
        {/* Sticky header */}
        <header className="flex items-center justify-between gap-3 border-b border-border bg-surface px-5 py-4">
          <div className="flex min-w-0 items-center gap-3">
            <span className="relative flex h-2.5 w-2.5 shrink-0">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-up/70" />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-up" />
            </span>
            <div className="min-w-0">
              <h2 className="truncate text-base font-semibold text-fg">Marketer dashboard</h2>
              <p className="truncate text-[11px] text-muted">
                {s ? <>Code <span className="font-mono text-fg">{s.referralCode}</span> · {(s.commissionRate * 100).toFixed(0)}% share · <span className="capitalize">{s.status}</span></> : 'Live'}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-border text-muted hover:text-fg" aria-label="Close">✕</button>
        </header>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {q.isLoading && !s ? (
            <div className="h-64 animate-pulse rounded-2xl bg-surface-2" />
          ) : q.isError || !s ? (
            <p className="py-10 text-center text-sm text-muted">Couldn&apos;t load your dashboard. Try again shortly.</p>
          ) : (
            <div className="flex flex-col gap-5">
              {/* Hero: available to withdraw + payout request */}
              <section className="rounded-2xl border border-up/30 bg-gradient-to-br from-up/10 to-transparent p-4">
                <p className="text-[11px] font-medium uppercase tracking-wide text-muted">Available to withdraw</p>
                <p className="mt-1 text-3xl font-black tabular-nums text-up">{formatKes(s.availableCents)}</p>
                <button
                  onClick={requestPayout}
                  disabled={payout.isPending || s.availableCents <= 0}
                  className="mt-3 w-full rounded-xl bg-up py-2.5 text-sm font-bold text-black transition hover:brightness-105 disabled:opacity-50"
                >
                  {payout.isPending ? 'Requesting…' : 'Request payout'}
                </button>
                {payoutMsg ? (
                  <p className={`mt-2 text-center text-xs ${payoutMsg.tone === 'up' ? 'text-up' : 'text-down'}`}>{payoutMsg.text}</p>
                ) : (
                  <p className="mt-2 text-center text-[11px] text-muted">Paid to M-Pesa after admin approval.</p>
                )}
              </section>

              {/* KPI grid */}
              <section>
                <SectionTitle>Performance</SectionTitle>
                <div className="grid grid-cols-2 gap-2.5">
                  <Kpi label="Earnings today" value={formatKes(s.commissionTodayCents)} tone="up" />
                  <Kpi label="Earned all-time" value={formatKes(earnedAllTime)} />
                  <Kpi label="Paid out" value={formatKes(s.commissionPaidCents)} />
                  <Kpi label="Accrued (unpaid)" value={formatKes(s.commissionAccruedCents)} />
                  <Kpi label="Total referrals" value={String(s.totalReferrals)} />
                  <Kpi label="Active (7d)" value={String(s.activePlayers7d)} />
                  <Kpi label="New today" value={String(s.referralsToday)} />
                  <Kpi label="Active today" value={String(s.activePlayersToday)} />
                </div>
              </section>

              {/* Expenses — full transparency */}
              <section>
                <div className="mb-2 flex items-center justify-between">
                  <SectionTitle>Expenses &amp; advances</SectionTitle>
                  <span className="text-xs font-semibold tabular-nums text-down">−{formatKes(expTotal)}</span>
                </div>
                {expenses.isLoading ? (
                  <div className="h-16 animate-pulse rounded-xl bg-surface-2" />
                ) : expRows.length === 0 ? (
                  <p className="rounded-xl border border-border bg-surface-2 px-3 py-3 text-center text-xs text-muted">No expenses logged. Everything you earn is yours.</p>
                ) : (
                  <ul className="flex flex-col gap-1.5">
                    {expRows.map((e) => {
                      const m = catMeta(e.category);
                      return (
                        <li key={e.id} className="flex items-center gap-3 rounded-xl border border-border bg-surface-2 px-3 py-2">
                          <span className="text-lg leading-none">{m.glyph}</span>
                          <span className="flex min-w-0 flex-1 flex-col leading-tight">
                            <span className="truncate text-sm font-medium text-fg">{m.label}</span>
                            <span className="truncate text-[11px] text-muted">{e.note ?? '—'} · {new Date(e.createdAtMs).toLocaleDateString('en-KE')}</span>
                          </span>
                          <span className="shrink-0 text-sm font-semibold tabular-nums text-down">−{formatKes(e.amountCents)}</span>
                        </li>
                      );
                    })}
                  </ul>
                )}
                <div className="mt-2 flex items-center justify-between rounded-xl border border-border bg-surface-2 px-3 py-2">
                  <span className="text-xs text-muted">Net after expenses</span>
                  <span className={`text-sm font-bold tabular-nums ${netAfterExpenses >= 0 ? 'text-up' : 'text-down'}`}>{formatKes(netAfterExpenses)}</span>
                </div>
              </section>

              {/* Recent earnings */}
              <section>
                <SectionTitle>Recent earnings</SectionTitle>
                {commRows.length === 0 ? (
                  <p className="rounded-xl border border-border bg-surface-2 px-3 py-3 text-center text-xs text-muted">No commission yet.</p>
                ) : (
                  <ul className="flex flex-col gap-1.5">
                    {commRows.slice(0, 8).map((c) => (
                      <li key={`${c.period}-${c.createdAtMs}`} className="flex items-center justify-between rounded-xl border border-border bg-surface-2 px-3 py-2">
                        <span className="flex flex-col leading-tight">
                          <span className="text-sm font-medium text-fg">{c.period}</span>
                          <span className="text-[11px] text-muted capitalize">{c.status} · GGR {formatKes(c.ggrCents)}</span>
                        </span>
                        <span className="text-sm font-semibold tabular-nums text-up">+{formatKes(c.commissionCents)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              {/* Referrals */}
              <section>
                <SectionTitle>Your referrals ({s.totalReferrals})</SectionTitle>
                {refRows.length === 0 ? (
                  <p className="rounded-xl border border-border bg-surface-2 px-3 py-3 text-center text-xs text-muted">Share your code to start earning.</p>
                ) : (
                  <ul className="flex flex-col gap-1.5">
                    {refRows.slice(0, 8).map((r, i) => (
                      <li key={`${r.username}-${i}`} className="flex items-center justify-between rounded-xl border border-border bg-surface-2 px-3 py-2">
                        <span className="flex items-center gap-2 min-w-0">
                          <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-accent/15 text-[11px] font-bold text-accent">
                            {(r.username || '?').slice(0, 2).toUpperCase()}
                          </span>
                          <span className="flex min-w-0 flex-col leading-tight">
                            <span className="truncate text-sm font-medium text-fg">@{r.username}</span>
                            <span className="text-[11px] text-muted">Joined {new Date(r.joinedAtMs).toLocaleDateString('en-KE')}</span>
                          </span>
                        </span>
                        <span className="shrink-0 text-[11px] text-muted">GGR {formatKes(r.lifetimeGgrCents)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <p className="pb-1 text-center text-[11px] text-muted">Live · updates every 5s · full transparency</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted">{children}</h3>;
}

function Kpi({ label, value, tone }: { label: string; value: string; tone?: 'up' }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-2xl border border-border bg-surface-2 p-3">
      <span className="text-[10px] uppercase tracking-wide text-muted">{label}</span>
      <span className={`text-base font-bold tabular-nums ${tone === 'up' ? 'text-up' : 'text-fg'}`}>{value}</span>
    </div>
  );
}
