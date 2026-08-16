'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Skeleton } from '@/components/ui/Skeleton';
import { Button } from '@/components/ui/Button';
import { Money } from '@/components/ui/Money';
import { StatusBadge } from '@/components/ui/Badge';
import { ApiError } from '@/lib/api/client';
import { useToast } from '@/lib/toast/ToastProvider';
import { formatExact, formatRelativeTime } from '@/lib/format';
import { PageHeader, StatCard, Section, TableWrap, Th, Td, Empty, Toolbar, FilterSelect, ConfirmButton } from '@/components/admin/ui';
import { useWithdrawals, useWithdrawalAction, useWithdrawalsEnabled, useSetWithdrawalsEnabled } from '@/lib/admin/hooks';
import type { AdminWithdrawalRow } from '@/lib/admin/types';

const STATUS_OPTIONS = [
  { value: 'requested', label: 'Requested' },
  { value: 'approved', label: 'Approved' },
  { value: 'paid', label: 'Paid' },
  { value: 'rejected', label: 'Rejected' },
  { value: '', label: 'All' },
];

// A withdrawal is actionable (approve / reject) only while it is still awaiting moderation.
const ACTIONABLE = new Set(['requested', 'pending']);

/** Clickable player identity → user detail page. */
function UserCell({ userId, username }: { userId: string; username: string }) {
  return (
    <Link href={`/admin/users/${userId}`} className="group inline-flex flex-col leading-tight">
      <span className="font-medium text-accent group-hover:underline">@{username || 'unknown'}</span>
      <span className="font-mono text-[10px] text-muted">{userId.slice(0, 8)}…</span>
    </Link>
  );
}

/** Phone that dials on tap (mobile) and is copy-friendly on desktop. */
function PhoneCell({ phone, receipt }: { phone: string; receipt: string | null }) {
  return (
    <span className="flex flex-col leading-tight">
      <a href={`tel:${phone}`} className="tabular-nums text-fg hover:text-accent hover:underline">{phone}</a>
      {receipt ? <span className="font-mono text-[10px] text-muted">{receipt}</span> : null}
    </span>
  );
}

/** Exact timestamp (to the second) with a relative label underneath. */
function TimeCell({ ms }: { ms: number | null }) {
  if (ms == null) return <span className="text-muted">—</span>;
  return (
    <span className="flex flex-col leading-tight">
      <span className="whitespace-nowrap text-xs font-medium text-fg" title={formatExact(ms)}>{formatExact(ms)}</span>
      <span className="text-[10px] text-muted">{formatRelativeTime(ms)} ago</span>
    </span>
  );
}

/** Lifetime money figure with a count / context hint underneath. */
function StackCell({ cents, hint, tone }: { cents: number; hint: string; tone?: 'up' | 'down' }) {
  const color = tone === 'up' ? 'text-up' : tone === 'down' ? 'text-down' : 'text-fg';
  return (
    <span className="flex flex-col items-end leading-tight text-right">
      <span className={`text-sm font-semibold tabular-nums ${color}`}><Money cents={cents} /></span>
      <span className="text-[10px] text-muted">{hint}</span>
    </span>
  );
}

export default function WithdrawalsPage() {
  const [status, setStatus] = useState('requested');
  const q = useWithdrawals(status || undefined);
  const rows = useMemo(() => q.data?.pages.flatMap((p) => p.items) ?? [], [q.data]);

  // Summary over the rows loaded so far (labelled "loaded" so partial pages aren't mistaken for totals).
  const totals = useMemo(() => {
    const amount = rows.reduce((s, r) => s + r.amountCents, 0);
    const awaiting = rows.filter((r) => ACTIONABLE.has(r.status.toLowerCase()));
    const awaitingAmount = awaiting.reduce((s, r) => s + r.amountCents, 0);
    return { count: rows.length, amount, awaitingCount: awaiting.length, awaitingAmount };
  }, [rows]);

  return (
    <>
      <PageHeader
        title="Withdrawals"
        subtitle="Review and action player withdrawal requests with full context — identity, balance and lifetime deposit/withdrawal history. Approval dispatches the M-Pesa B2C payout; rejection reverses the hold."
        actions={
          <Toolbar>
            <FilterSelect label="Status" value={status} onChange={setStatus} options={STATUS_OPTIONS} />
          </Toolbar>
        }
      />

      <WithdrawalsSwitch />

      {q.isLoading ? (
        <Skeleton className="h-40 w-full" />
      ) : q.isError ? (
        <Empty title="Couldn't load withdrawals" description="Try again shortly." />
      ) : rows.length === 0 ? (
        <Empty title="Nothing here" description={status === 'requested' ? 'No withdrawals awaiting review.' : 'No withdrawals match this filter.'} />
      ) : (
        <>
          <Section title="Loaded on this page">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <StatCard label="Withdrawals shown" value={totals.count} />
              <StatCard label="Total value" money={totals.amount} />
              <StatCard label="Awaiting review" value={totals.awaitingCount} tone={totals.awaitingCount > 0 ? 'warn' : 'default'} />
              <StatCard label="Awaiting value" money={totals.awaitingAmount} tone={totals.awaitingCount > 0 ? 'warn' : 'default'} hint="held, pending payout" />
            </div>
          </Section>

          <TableWrap>
              <thead>
                <tr className="border-b border-border">
                  <Th>Player</Th>
                  <Th className="text-right">Amount</Th>
                  <Th>M-Pesa</Th>
                  <Th>Status</Th>
                  <Th className="text-right">Balance</Th>
                  <Th className="text-right">Deposits</Th>
                  <Th className="text-right">Withdrawals</Th>
                  <Th className="text-right">Net cash</Th>
                  <Th>Requested</Th>
                  <Th className="text-right">Action</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <Row key={r.txId} r={r} />
                ))}
              </tbody>
            </TableWrap>
          {q.hasNextPage ? (
            <Button variant="outline" size="sm" onClick={() => q.fetchNextPage()} disabled={q.isFetchingNextPage}>
              {q.isFetchingNextPage ? 'Loading…' : 'Load more'}
            </Button>
          ) : null}
        </>
      )}
    </>
  );
}

/** Owner/admin kill switch: halt or resume ALL withdrawals for this brand (override). */
function WithdrawalsSwitch() {
  const q = useWithdrawalsEnabled();
  const setEnabled = useSetWithdrawalsEnabled();
  const toast = useToast();
  const enabled = q.data?.enabled ?? true;

  if (q.isLoading) return <div className="mb-4"><Skeleton className="h-16 w-full" /></div>;

  const flip = () =>
    setEnabled.mutate(!enabled, {
      onSuccess: (r) =>
        toast.push({
          tone: r.enabled ? 'success' : 'error',
          title: r.enabled ? 'Withdrawals enabled' : 'Withdrawals DISABLED',
          description: r.enabled ? 'Payouts resume for this brand.' : 'All new withdrawals (players + marketers) are halted.',
        }),
      onError: (e) => toast.push({ tone: 'error', title: "Couldn't change setting", description: e instanceof ApiError ? e.message : 'Try again.' }),
    });

  return (
    <div className={`mb-4 flex items-center justify-between gap-3 rounded-2xl border p-4 ${enabled ? 'border-up/30 bg-up/5' : 'border-down/40 bg-down/10'}`}>
      <div className="flex flex-col">
        <span className="flex items-center gap-2 text-sm font-semibold text-fg">
          <span className={`inline-flex h-2.5 w-2.5 rounded-full ${enabled ? 'bg-up' : 'bg-down'}`} />
          {enabled ? 'Withdrawals are ENABLED' : 'Withdrawals are DISABLED'}
        </span>
        <span className="mt-0.5 max-w-2xl text-xs text-muted">
          {enabled
            ? 'Payouts are processing normally. Turn OFF to immediately halt ALL withdrawals for this brand — player requests and marketer instant transfers — to override a malfunction or prevent payouts beyond the pool.'
            : 'All new withdrawals are refused for this brand (players + marketers). Existing pending requests can still be reviewed manually. Turn ON to resume payouts.'}
        </span>
      </div>
      <button
        type="button"
        onClick={flip}
        disabled={setEnabled.isPending}
        aria-pressed={enabled}
        aria-label={enabled ? 'Disable withdrawals' : 'Enable withdrawals'}
        className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition disabled:opacity-50 ${enabled ? 'bg-up' : 'bg-down'}`}
      >
        <span className={`inline-block h-5 w-5 transform rounded-full bg-white transition ${enabled ? 'translate-x-6' : 'translate-x-1'}`} />
      </button>
    </div>
  );
}

function Row({ r }: { r: AdminWithdrawalRow }) {
  const action = useWithdrawalAction();
  const toast = useToast();
  const canAct = ACTIONABLE.has(r.status.toLowerCase());
  // Net cash the house is up on this player: lifetime deposits minus lifetime paid withdrawals.
  const netCents = r.totalDepositsCents - r.totalWithdrawalsCents;

  function run(act: 'approve' | 'reject') {
    action.mutate(
      { id: r.txId, action: act },
      {
        onSuccess: () =>
          toast.push({
            tone: 'success',
            title: act === 'approve' ? 'Withdrawal approved' : 'Withdrawal rejected',
            description: act === 'approve' ? 'M-Pesa payout dispatched.' : 'Funds returned to the player.',
          }),
        onError: (e) =>
          toast.push({ tone: 'error', title: 'Action failed', description: e instanceof ApiError ? e.message : 'Try again.' }),
      },
    );
  }

  return (
    <tr className="border-b border-border last:border-0 hover:bg-surface-2/50">
      <Td><UserCell userId={r.userId} username={r.username} /></Td>
      <Td className="text-right font-semibold tabular-nums"><Money cents={r.amountCents} /></Td>
      <Td><PhoneCell phone={r.phone} receipt={r.mpesaReceipt} /></Td>
      <Td><StatusBadge status={r.status} /></Td>
      <Td className="text-right">
        <StackCell cents={r.balanceCents} hint="current" />
      </Td>
      <Td className="text-right">
        <StackCell
          cents={r.totalDepositsCents}
          tone="up"
          hint={r.depositCount === 0
            ? 'never funded'
            : `${r.depositCount} dep · since ${r.firstDepositAtMs ? formatExact(r.firstDepositAtMs).slice(0, 10) : '—'}`}
        />
      </Td>
      <Td className="text-right">
        <StackCell cents={r.totalWithdrawalsCents} tone="down" hint={`${r.withdrawalCount} paid`} />
      </Td>
      <Td className="text-right">
        <StackCell cents={netCents} tone={netCents >= 0 ? 'up' : 'down'} hint={netCents >= 0 ? 'net depositor' : 'net winner'} />
      </Td>
      <Td><TimeCell ms={r.createdAtMs} /></Td>
      <Td className="text-right">
        {canAct ? (
          <span className="inline-flex items-center justify-end gap-1.5">
            <ConfirmButton label="Approve" confirmLabel="Pay out" variant="primary" busy={action.isPending} onConfirm={() => run('approve')} />
            <ConfirmButton label="Reject" confirmLabel="Reject" variant="outline" busy={action.isPending} onConfirm={() => run('reject')} />
          </span>
        ) : (
          <span className="text-xs text-muted">—</span>
        )}
      </Td>
    </tr>
  );
}
