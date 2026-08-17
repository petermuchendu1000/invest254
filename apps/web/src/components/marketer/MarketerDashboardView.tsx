'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { formatKes } from '@invest254/shared/money';
import { ApiError } from '@/lib/api/client';
import {
  useMarketerLiveSummary,
  useAffiliateReferrals,
  useAffiliateCommissions,
  useAffiliateExpenses,
  useAffiliatePayout,
  useAffiliateEnroll,
} from '@/lib/affiliate/hooks';

/**
 * Full-page marketer dashboard (rendered at /dashboard). Extracted from the old covert modal so
 * the marketer gets a real, shareable, back-button-friendly page instead of an overlay.
 *
 * Self-heal: a user can hold role='marketer' yet have no `affiliates` row (e.g. an admin promoted
 * them via fn_admin_set_user_role rather than the enroll flow). That makes /affiliate/summary 404
 * with NOT_AFFILIATE. Enrollment is idempotent + marketer-safe, so on that exact error we enroll
 * once (creating the row + adopting the reissued token) and let the query refetch — the dashboard
 * then loads instead of dead-ending on "Couldn't load". The server root-cause fix (auto-enroll on
 * marketer promotion) makes this path rare; this stays as a resilient safety net.
 */
export function MarketerDashboardView() {
  const q = useMarketerLiveSummary(true);
  const referrals = useAffiliateReferrals(true);
  const commissions = useAffiliateCommissions(true);
  const expenses = useAffiliateExpenses(true);
  const payout = useAffiliatePayout();
  const enroll = useAffiliateEnroll();
  const healAttempted = useRef(false);
  const [payoutMsg, setPayoutMsg] = useState<{ tone: 'up' | 'down'; text: string } | null>(null);

  const s = q.data;
  const isNotAffiliate = q.error instanceof ApiError && q.error.code === 'NOT_AFFILIATE';

  // Self-heal exactly once when the summary 404s because no affiliate row exists yet.
  useEffect(() => {
    if (healAttempted.current) return;
    if (isNotAffiliate && !enroll.isPending) {
      healAttempted.current = true;
      enroll.mutate(); // onSuccess invalidates ['affiliate'] -> summary refetches automatically.
    }
  }, [isNotAffiliate, enroll]);

  const healing = enroll.isPending || (isNotAffiliate && !enroll.isError && !s);

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

  const retry = () => {
    healAttempted.current = false;
    enroll.reset();
    void q.refetch();
  };

  return (
    <section className="flex w-full flex-col gap-5">
      {/* Header */}
      <header className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="relative flex h-2.5 w-2.5 shrink-0">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-up/70" />
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-up" />
          </span>
          <div className="min-w-0">
            <h1 className="truncate text-xl font-semibold tracking-tight text-fg">Marketer dashboard</h1>
            <p className="truncate text-[11px] text-muted">
              {s ? <>Code <span className="font-mono text-fg">{s.referralCode}</span> · {(s.commissionRate * 100).toFixed(0)}% share · <span className="capitalize">{s.status}</span></> : 'Live'}
            </p>
          </div>
        </div>
        <Link href="/" className="shrink-0 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted hover:text-fg" aria-label="Back to app">
          ← Back
        </Link>
      </header>

      {q.isLoading && !s ? (
        <div className="h-64 animate-pulse rounded-2xl bg-surface-2" />
      ) : healing ? (
        <div className="flex flex-col items-center gap-3 py-16">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-border border-t-up" />
          <p className="text-sm text-muted">Setting up your marketer dashboard…</p>
        </div>
      ) : !s ? (
        <div className="flex flex-col items-center gap-3 py-16 text-center">
          <p className="text-sm text-muted">Couldn&apos;t load your dashboard. Try again shortly.</p>
          <button onClick={retry} className="rounded-xl border border-border px-4 py-2 text-sm font-medium text-fg hover:bg-surface-2">
            Try again
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-5">
          {/* Hero: available to withdraw + payout request */}
          <section className="rounded-2xl border border-up/30 bg-gradient-to-br from-up/10 to-transparent p-4">
            <p className="text-[11px] font-medium uppercase tracking-wide text-muted">Available to withdraw</p>
            <p className="mt-1 text-3xl font-black tabular-nums text-up">{formatKes(s.availableCents)}</p>
            <button
              onClick={requestPayout}
              disabled={payout.isPending || s.availableCents <= 0}
              className="mt-3 w-full rounded-xl bg-up py-2.5 text-sm font-bold text-black transition hover:brightness-105 disabled:opacity-50 sm:w-auto sm:px-8"
            >
              {payout.isPending ? 'Requesting…' : 'Request payout'}
            </button>
            {payoutMsg ? (
              <p className={`mt-2 text-xs ${payoutMsg.tone === 'up' ? 'text-up' : 'text-down'}`}>{payoutMsg.text}</p>
            ) : (
              <p className="mt-2 text-[11px] text-muted">Paid to M-Pesa after admin approval.</p>
            )}
          </section>

          {/* KPI grid */}
          <section>
            <SectionTitle>Performance</SectionTitle>
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
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
    </section>
  );
}

// ── Category presentation ───────────────────────────────────────────────────────────────────────
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
