'use client';

import { useMemo, useState } from 'react';
import { Skeleton } from '@/components/ui/Skeleton';
import { Button } from '@/components/ui/Button';
import { Money } from '@/components/ui/Money';
import { StatusBadge } from '@/components/ui/Badge';
import { ApiError } from '@/lib/api/client';
import { useToast } from '@/lib/toast/ToastProvider';
import { formatRelativeTime } from '@/lib/format';
import { PageHeader, TableWrap, Th, Td, Empty, Toolbar, FilterSelect, ConfirmButton } from '@/components/admin/ui';
import { useAffiliatePayouts, usePayoutAction } from '@/lib/admin/hooks';
import type { AdminPayoutRow } from '@/lib/admin/types';

const STATUS_OPTIONS = [
  { value: 'requested', label: 'Requested' },
  { value: 'approved', label: 'Approved' },
  { value: 'paid', label: 'Paid' },
  { value: 'rejected', label: 'Rejected' },
  { value: '', label: 'All' },
];

// Approve/reject act on payouts that haven't yet been dispatched.
const ACTIONABLE = new Set(['requested']);

export default function AffiliatesPage() {
  const [status, setStatus] = useState('requested');
  const q = useAffiliatePayouts(status || undefined);
  const rows = useMemo(() => q.data?.pages.flatMap((p) => p.items) ?? [], [q.data]);

  return (
    <>
      <PageHeader
        title="Affiliate payouts"
        subtitle="Review marketer commission payout requests. Approval dispatches the M-Pesa B2C transfer; rejection releases the hold."
        actions={
          <Toolbar>
            <FilterSelect label="Status" value={status} onChange={setStatus} options={STATUS_OPTIONS} />
          </Toolbar>
        }
      />

      {q.isLoading ? (
        <Skeleton className="h-40 w-full" />
      ) : q.isError ? (
        <Empty title="Couldn't load payouts" description="Try again shortly." />
      ) : rows.length === 0 ? (
        <Empty title="Nothing here" description={status === 'requested' ? 'No payouts awaiting review.' : 'No payouts match this filter.'} />
      ) : (
        <>
          <TableWrap>
            <thead>
              <tr className="border-b border-border">
                <Th>Marketer</Th>
                <Th>Amount</Th>
                <Th>Phone</Th>
                <Th>Status</Th>
                <Th>Approved by</Th>
                <Th>Requested</Th>
                <Th className="text-right">Action</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <Row key={r.payoutId} r={r} />
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

function Row({ r }: { r: AdminPayoutRow }) {
  const action = usePayoutAction();
  const toast = useToast();
  const canAct = ACTIONABLE.has(r.status.toLowerCase());

  function run(act: 'approve' | 'reject') {
    action.mutate(
      { id: r.payoutId, action: act },
      {
        onSuccess: () =>
          toast.push({
            tone: 'success',
            title: act === 'approve' ? 'Payout approved' : 'Payout rejected',
            description: act === 'approve' ? 'M-Pesa transfer dispatched.' : 'Commission hold released.',
          }),
        onError: (e) =>
          toast.push({ tone: 'error', title: 'Action failed', description: e instanceof ApiError ? e.message : 'Try again.' }),
      },
    );
  }

  return (
    <tr className="border-b border-border last:border-0">
      <Td>
        <span className="font-medium">@{r.username}</span>
        <span className="ml-2 font-mono text-xs text-muted">{r.affiliateId.slice(0, 8)}…</span>
      </Td>
      <Td className="font-medium tabular-nums">
        <Money cents={r.amountCents} />
      </Td>
      <Td className="tabular-nums">{r.phone}</Td>
      <Td>
        <StatusBadge status={r.status} />
      </Td>
      <Td className="font-mono text-xs text-muted">{r.approvedBy ? `${r.approvedBy.slice(0, 8)}…` : '—'}</Td>
      <Td className="whitespace-nowrap text-xs text-muted">{formatRelativeTime(r.createdAtMs)} ago</Td>
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
