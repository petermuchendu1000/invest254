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
import { useWithdrawals, useWithdrawalAction } from '@/lib/admin/hooks';
import type { AdminWithdrawalRow } from '@/lib/admin/types';

const STATUS_OPTIONS = [
  { value: 'requested', label: 'Requested' },
  { value: 'approved', label: 'Approved' },
  { value: 'paid', label: 'Paid' },
  { value: 'rejected', label: 'Rejected' },
  { value: '', label: 'All' },
];

const ACTIONABLE = new Set(['requested', 'pending']);

export default function WithdrawalsPage() {
  const [status, setStatus] = useState('requested');
  const q = useWithdrawals(status || undefined);
  const rows = useMemo(() => q.data?.pages.flatMap((p) => p.items) ?? [], [q.data]);

  return (
    <>
      <PageHeader
        title="Withdrawals"
        subtitle="Review and action player withdrawal requests. Approval dispatches M-Pesa; rejection reverses the hold."
        actions={
          <Toolbar>
            <FilterSelect label="Status" value={status} onChange={setStatus} options={STATUS_OPTIONS} />
          </Toolbar>
        }
      />

      {q.isLoading ? (
        <Skeleton className="h-40 w-full" />
      ) : q.isError ? (
        <Empty title="Couldn't load withdrawals" description="Try again shortly." />
      ) : rows.length === 0 ? (
        <Empty title="Nothing here" description={status === 'requested' ? 'No withdrawals awaiting review.' : 'No withdrawals match this filter.'} />
      ) : (
        <>
          <TableWrap>
            <thead>
              <tr className="border-b border-border">
                <Th>Player</Th>
                <Th>Amount</Th>
                <Th>Phone</Th>
                <Th>Status</Th>
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

function Row({ r }: { r: AdminWithdrawalRow }) {
  const action = useWithdrawalAction();
  const toast = useToast();
  const canAct = ACTIONABLE.has(r.status.toLowerCase());

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
    <tr className="border-b border-border last:border-0">
      <Td className="font-mono text-xs text-muted">{r.userId.slice(0, 8)}…</Td>
      <Td className="font-medium tabular-nums">
        <Money cents={r.amountCents} />
      </Td>
      <Td className="tabular-nums">{r.phone}</Td>
      <Td>
        <StatusBadge status={r.status} />
      </Td>
      <Td className="whitespace-nowrap text-xs text-muted">{formatRelativeTime(r.createdAtMs)} ago</Td>
      <Td className="text-right">
        {canAct ? (
          <span className="inline-flex items-center justify-end gap-1.5">
            <ConfirmButton
              label="Approve"
              confirmLabel="Pay out"
              variant="primary"
              busy={action.isPending}
              onConfirm={() => run('approve')}
            />
            <ConfirmButton
              label="Reject"
              confirmLabel="Reject"
              variant="outline"
              busy={action.isPending}
              onConfirm={() => run('reject')}
            />
          </span>
        ) : (
          <span className="text-xs text-muted">—</span>
        )}
      </Td>
    </tr>
  );
}
