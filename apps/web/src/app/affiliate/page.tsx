'use client';

import { useEffect, useMemo, useState } from 'react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Skeleton } from '@/components/ui/Skeleton';
import { EmptyState } from '@/components/ui/EmptyState';
import { StatusBadge } from '@/components/ui/Badge';
import { Money } from '@/components/ui/Money';
import { ApiError } from '@/lib/api/client';
import type { AffiliateSummary, CommissionRecord } from '@/lib/api/types';
import { formatKes } from '@invest254/shared/money';
import { useSession } from '@/lib/auth/session';
import { useAuthUi } from '@/lib/auth/ui';
import { useAuthActions } from '@/lib/auth/useAuthActions';
import { useHydrated } from '@/lib/useHydrated';
import { useToast } from '@/lib/toast/ToastProvider';
import { formatDateTime } from '@/lib/format';
import {
  useAffiliateCommissions,
  useAffiliateEnroll,
  useAffiliatePayout,
  useAffiliateReferrals,
  useAffiliateSummary,
} from '@/lib/affiliate/hooks';

/** Mask a player handle so the affiliate never sees full PII (operator-only data). */
function maskHandle(username: string): string {
  const u = username.replace(/^@/, '');
  if (u.length <= 2) return `@${u[0] ?? ''}•••`;
  return `@${u.slice(0, 2)}•••`;
}

export default function AffiliatePage() {
  const hydrated = useHydrated();
  const token = useSession((s) => s.token);
  const user = useSession((s) => s.user);
  const openAuth = useAuthUi((s) => s.openAuth);

  if (!hydrated) return <Skeleton className="h-48 w-full" />;

  if (!token) {
    return (
      <EmptyState
        title="Earn with Invest254"
        description="Log in to apply for the affiliate programme and earn 20% revenue share from players you refer."
        action={<Button onClick={() => openAuth('login')}>Log in</Button>}
      />
    );
  }
  if (!user) return <Skeleton className="h-48 w-full" />;

  const isMarketer = user.role === 'marketer' || user.role === 'admin' || user.role === 'superadmin';

  return (
    <section className="flex flex-col gap-4">
      <header className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold tracking-tight">Affiliate programme</h1>
        <p className="text-sm text-muted">Refer players, earn 20% of the net revenue they generate.</p>
      </header>
      {isMarketer ? <MarketerView /> : <ApplyCard />}
    </section>
  );
}

/* ─────────────────────────── Apply / pending / status ─────────────────────────── */

function ApplyCard() {
  const token = useSession((s) => s.token);
  const { refresh } = useAuthActions();
  const toast = useToast();
  const enroll = useAffiliateEnroll();
  const [pending, setPending] = useState(false);

  async function onApply() {
    try {
      const res = await enroll.mutateAsync();
      if (res.status && res.status !== 'active') {
        // Approval model (with the admin console): application awaits review.
        setPending(true);
        return;
      }
      const fresh = res.token ?? token;
      if (fresh) await refresh(fresh);
      toast.push({ tone: 'success', title: "You're in", description: 'Share your link to start earning.' });
    } catch (e) {
      toast.push({
        tone: 'error',
        title: 'Could not submit',
        description: e instanceof ApiError ? e.message : 'Please try again.',
      });
    }
  }

  if (pending) return <PendingCard />;

  return (
    <Card className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 className="text-base font-semibold">Join the affiliate programme</h2>
        <p className="text-sm leading-relaxed text-muted">
          Get a personal referral link and earn <strong className="text-fg">20%</strong> of the net
          revenue from every player you bring to Invest254 — accrued daily, paid to your M-Pesa. You
          keep your full player account and can carry on trading as normal.
        </p>
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <Perk title="20% revenue share" body="Lifetime, accrued daily." />
        <Perk title="Live dashboard" body="Referrals, earnings, payouts." />
        <Perk title="M-Pesa payouts" body="Request anytime you have a balance." />
      </div>
      <div className="rounded-xl border border-border bg-surface-2 p-3 text-xs leading-relaxed text-muted">
        Applications are reviewed before approval. By applying you agree to promote Invest254
        responsibly and lawfully — 18+ audiences only, no misleading or non-compliant gambling ads,
        and no self-referrals. See{' '}
        <a href="/legal#terms" className="text-accent hover:underline">
          Terms
        </a>
        .
      </div>
      <Button onClick={onApply} disabled={enroll.isPending} fullWidth>
        {enroll.isPending ? 'Submitting…' : 'Apply to the programme'}
      </Button>
    </Card>
  );
}

function Perk({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-xl border border-border bg-surface-2 p-3">
      <p className="text-sm font-semibold text-fg">{title}</p>
      <p className="text-xs text-muted">{body}</p>
    </div>
  );
}

function PendingCard() {
  return (
    <Card className="flex flex-col items-center gap-3 py-8 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-warn/15 text-warn">
        <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="12" r="9" />
          <path d="M12 7v5l3 2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
      <h2 className="text-base font-semibold">Application under review</h2>
      <p className="max-w-sm text-sm leading-relaxed text-muted">
        Thanks for applying. Our team reviews affiliate applications to keep the programme compliant.
        You&apos;ll be notified once approved, and your dashboard will unlock here.
      </p>
    </Card>
  );
}

function StatusCard({ status }: { status: string }) {
  return (
    <EmptyState
      title={status === 'rejected' ? 'Application not approved' : 'Account paused'}
      description={
        status === 'rejected'
          ? 'Your affiliate application was not approved. Contact support@invest254.co.ke if you believe this is a mistake.'
          : 'Your affiliate account is currently paused. Contact support@invest254.co.ke to restore it.'
      }
    />
  );
}

/* ─────────────────────────────── Marketer dashboard ─────────────────────────────── */

function MarketerView() {
  const summaryQ = useAffiliateSummary(true);

  if (summaryQ.isLoading) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }
  if (summaryQ.isError) {
    // 404 NOT_AFFILIATE → role is privileged (admin) but not enrolled → offer to apply.
    return summaryQ.error instanceof ApiError && summaryQ.error.status === 404 ? (
      <ApplyCard />
    ) : (
      <EmptyState title="Couldn't load your dashboard" description="Something went wrong. Try again shortly." />
    );
  }

  const s = summaryQ.data!;
  if (s.status !== 'active') return <StatusCard status={s.status} />;

  return (
    <div className="flex flex-col gap-4">
      <EarningsHero summary={s} />
      <ReferralLinkCard summary={s} />
      <Funnel summary={s} />
      <EarningsTrend />
      <ReferralsList />
      <CommissionsList />
    </div>
  );
}

function EarningsHero({ summary }: { summary: AffiliateSummary }) {
  const payout = useAffiliatePayout();
  const toast = useToast();
  const canRequest = summary.availableCents > 0;
  const inReview = Math.max(0, summary.commissionAccruedCents - summary.availableCents);
  const lifetime = summary.commissionAccruedCents + summary.commissionPaidCents;

  async function request() {
    try {
      await payout.mutateAsync();
      toast.push({ tone: 'success', title: 'Payout requested', description: 'An admin will review and pay it to your M-Pesa.' });
    } catch (e) {
      toast.push({ tone: 'error', title: 'Payout failed', description: e instanceof ApiError ? e.message : 'Please try again.' });
    }
  }

  return (
    <Card className="flex flex-col gap-4 bg-gradient-to-br from-accent/10 to-transparent">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col">
          <span className="text-xs uppercase tracking-wide text-muted">Commission available</span>
          <span className="text-3xl font-bold tabular-nums text-fg">
            <Money cents={summary.availableCents} />
          </span>
        </div>
        <span className="rounded-full bg-accent/15 px-2.5 py-1 text-xs font-medium text-accent">
          {Math.round(summary.commissionRate * 100)}% revenue share
        </span>
      </div>
      <div className="grid grid-cols-3 gap-2 text-center">
        <MiniStat label="In review" cents={inReview} />
        <MiniStat label="Paid out" cents={summary.commissionPaidCents} />
        <MiniStat label="Lifetime" cents={lifetime} />
      </div>
      <Button onClick={request} disabled={!canRequest || payout.isPending} fullWidth>
        {payout.isPending ? 'Requesting…' : canRequest ? 'Request payout' : 'Nothing to withdraw yet'}
      </Button>
      <p className="text-[11px] leading-relaxed text-muted">
        Affiliate earnings, paid to your M-Pesa — <strong className="text-fg">separate</strong> from
        your playing balance. You can still{' '}
        <a href="/wallet" className="text-accent hover:underline">
          deposit &amp; trade
        </a>{' '}
        as a player; your own play never earns you commission.
      </p>
    </Card>
  );
}

function MiniStat({ label, cents }: { label: string; cents: number }) {
  return (
    <div className="rounded-xl border border-border bg-surface-2/60 p-2">
      <div className="text-sm font-semibold tabular-nums">
        <Money cents={cents} />
      </div>
      <div className="text-[11px] text-muted">{label}</div>
    </div>
  );
}

function ReferralLinkCard({ summary }: { summary: AffiliateSummary }) {
  const [origin, setOrigin] = useState('');
  const toast = useToast();
  useEffect(() => setOrigin(window.location.origin), []);
  const link = origin ? `${origin}${summary.referralPath}` : summary.referralPath;

  async function copy() {
    try {
      await navigator.clipboard.writeText(link);
      toast.push({ tone: 'success', title: 'Link copied' });
    } catch {
      toast.push({ tone: 'error', title: 'Copy failed', description: 'Copy it manually.' });
    }
  }

  return (
    <Card className="flex flex-col gap-3">
      <h2 className="text-sm font-semibold">Your referral link</h2>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <code className="min-w-0 flex-1 truncate rounded-xl border border-border bg-surface-2 px-3 py-2.5 text-sm">
          {link}
        </code>
        <Button onClick={copy} variant="secondary" className="sm:w-auto" fullWidth>
          Copy link
        </Button>
      </div>
      <p className="text-xs text-muted">
        Code <span className="font-mono text-fg">{summary.referralCode}</span> · attribution is
        first-touch and permanent.
      </p>
    </Card>
  );
}

function Funnel({ summary }: { summary: AffiliateSummary }) {
  const reg = summary.totalReferrals;
  const active = summary.activePlayers30d;
  const conv = reg > 0 ? Math.round((active / reg) * 100) : 0;
  return (
    <Card className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">Your funnel</h2>
        <span className="text-xs text-muted">last 30 days active</span>
      </div>
      <div className="grid grid-cols-3 gap-2 text-center">
        <FunnelStage label="Registrations" value={String(reg)} />
        <FunnelStage label="Active players" value={String(active)} sub={`${conv}% of signups`} />
        <FunnelStage label="Net revenue" money={summary.ggrCents} sub="you earn 20%" />
      </div>
      <p className="text-[11px] leading-relaxed text-muted">
        Link clicks and first-deposit conversion are coming soon — see the affiliate roadmap. Net
        revenue (NGR) is aggregate; per-player figures stay private to players.
      </p>
    </Card>
  );
}

function FunnelStage({
  label,
  value,
  money,
  sub,
}: {
  label: string;
  value?: string;
  money?: number;
  sub?: string;
}) {
  return (
    <div className="flex flex-col gap-0.5 rounded-xl border border-border bg-surface-2/60 p-3">
      <span className="text-lg font-bold tabular-nums">
        {money !== undefined ? <Money cents={money} /> : value}
      </span>
      <span className="text-xs font-medium text-fg">{label}</span>
      {sub ? <span className="text-[11px] text-muted">{sub}</span> : null}
    </div>
  );
}

function EarningsTrend() {
  const q = useAffiliateCommissions(true);
  const rows = useMemo<CommissionRecord[]>(() => q.data?.pages.flatMap((p) => p.items) ?? [], [q.data]);
  // newest-first → take latest 8, render oldest→newest left-to-right.
  const series = useMemo(() => rows.slice(0, 8).reverse(), [rows]);
  const max = Math.max(1, ...series.map((r) => r.commissionCents));

  if (q.isLoading) return <Skeleton className="h-40 w-full" />;
  if (series.length === 0) return null;

  return (
    <Card className="flex flex-col gap-3">
      <h2 className="text-sm font-semibold">Commission trend</h2>
      <div className="flex h-32 items-end justify-between gap-1.5">
        {series.map((r) => (
          <div key={r.period} className="flex min-w-0 flex-1 flex-col items-center gap-1">
            <div
              className="w-full rounded-t bg-accent/80"
              style={{ height: `${Math.max(4, (r.commissionCents / max) * 100)}%` }}
              title={`${r.period}: ${formatKes(r.commissionCents)}`}
            />
            <span className="w-full truncate text-center text-[10px] text-muted">{r.period.slice(5)}</span>
          </div>
        ))}
      </div>
    </Card>
  );
}

function ReferralsList() {
  const q = useAffiliateReferrals(true);
  const rows = useMemo(() => q.data?.pages.flatMap((p) => p.items) ?? [], [q.data]);

  return (
    <div className="flex flex-col gap-2">
      <h2 className="text-sm font-semibold">Referred players</h2>
      {q.isLoading ? (
        <Skeleton className="h-24 w-full" />
      ) : rows.length === 0 ? (
        <EmptyState title="No referrals yet" description="Share your link to bring players on board." />
      ) : (
        <Card className="flex flex-col divide-y divide-border p-0">
          {rows.map((r) => (
            <div key={`${r.username}-${r.joinedAtMs}`} className="flex items-center justify-between gap-3 p-3">
              <div className="flex min-w-0 flex-col">
                <span className="truncate text-sm font-medium">{maskHandle(r.username)}</span>
                <span className="text-xs text-muted">Joined {formatDateTime(r.joinedAtMs)}</span>
              </div>
              <span
                className={
                  'rounded-full px-2 py-0.5 text-xs font-medium ' +
                  (r.lifetimeGgrCents > 0 ? 'bg-up/15 text-up' : 'bg-surface-2 text-muted')
                }
              >
                {r.lifetimeGgrCents > 0 ? 'Active' : 'New'}
              </span>
            </div>
          ))}
        </Card>
      )}
      <LoadMore q={q} />
    </div>
  );
}

function CommissionsList() {
  const q = useAffiliateCommissions(true);
  const rows = useMemo(() => q.data?.pages.flatMap((p) => p.items) ?? [], [q.data]);

  return (
    <div className="flex flex-col gap-2">
      <h2 className="text-sm font-semibold">Commission settlements</h2>
      {q.isLoading ? (
        <Skeleton className="h-24 w-full" />
      ) : rows.length === 0 ? (
        <EmptyState title="No commission yet" description="Daily commission appears here as your referrals play." />
      ) : (
        <Card className="flex flex-col divide-y divide-border p-0">
          {rows.map((c) => (
            <div key={c.period} className="flex items-center justify-between gap-3 p-3">
              <div className="flex flex-col">
                <span className="text-sm font-medium">{c.period}</span>
                <span className="text-xs text-muted">your 20% share</span>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-sm font-medium tabular-nums">
                  <Money cents={c.commissionCents} />
                </span>
                <StatusBadge status={c.status} />
              </div>
            </div>
          ))}
        </Card>
      )}
      <LoadMore q={q} />
    </div>
  );
}

function LoadMore({
  q,
}: {
  q: { hasNextPage: boolean; isFetchingNextPage: boolean; fetchNextPage: () => void };
}) {
  if (!q.hasNextPage) return null;
  return (
    <Button variant="outline" size="sm" onClick={() => q.fetchNextPage()} disabled={q.isFetchingNextPage}>
      {q.isFetchingNextPage ? 'Loading…' : 'Load more'}
    </Button>
  );
}
