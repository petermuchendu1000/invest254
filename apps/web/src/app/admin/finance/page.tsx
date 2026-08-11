'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Skeleton } from '@/components/ui/Skeleton';
import { Button } from '@/components/ui/Button';
import { Money } from '@/components/ui/Money';
import { StatusBadge } from '@/components/ui/Badge';
import { formatExact, formatRelativeTime } from '@/lib/format';
import { PageHeader, StatCard, Section, TableWrap, Th, Td, Empty, Toolbar, FilterSelect } from '@/components/admin/ui';
import { useDeposits, useDepositsReconcile, useTransactions, useOverview } from '@/lib/admin/hooks';
import type { AdminDepositRow, AdminTransactionRow } from '@/lib/admin/types';

const STATUS_OPTIONS = [
  { value: '', label: 'All statuses' },
  { value: 'pending', label: 'Pending' },
  { value: 'processing', label: 'Processing' },
  { value: 'success', label: 'Success' },
  { value: 'failed', label: 'Failed' },
];

const KIND_OPTIONS = [
  { value: '', label: 'Deposits & withdrawals' },
  { value: 'deposit', label: 'Deposits only' },
  { value: 'withdrawal', label: 'Withdrawals only' },
];

const STALE_OPTIONS = [
  { value: '15', label: 'Stale > 15 min' },
  { value: '30', label: 'Stale > 30 min' },
  { value: '60', label: 'Stale > 60 min' },
];

/** Per-status tone for reconciliation tiles. */
function bucketTone(status: string): 'default' | 'up' | 'down' | 'warn' {
  const s = status.toLowerCase();
  if (s === 'success') return 'up';
  if (s === 'failed') return 'down';
  if (s === 'pending' || s === 'processing') return 'warn';
  return 'default';
}

/** Clickable player identity cell → user detail. */
function UserCell({ userId, username }: { userId: string; username: string }) {
  return (
    <Link href={`/admin/users/${userId}`} className="group inline-flex flex-col leading-tight">
      <span className="font-medium text-accent group-hover:underline">@{username || 'unknown'}</span>
      <span className="font-mono text-[10px] text-muted">{userId.slice(0, 8)}…</span>
    </Link>
  );
}

/** A phone number that dials on tap (mobile) and is copy-friendly on desktop. */
function PhoneCell({ phone }: { phone: string | null }) {
  if (!phone) return <span className="text-muted">—</span>;
  return (
    <a href={`tel:${phone}`} className="tabular-nums text-fg hover:text-accent hover:underline">
      {phone}
    </a>
  );
}

/** Exact timestamp (to the second) with a relative label underneath. */
function TimeCell({ ms }: { ms: number }) {
  return (
    <span className="flex flex-col leading-tight">
      <span className="whitespace-nowrap text-xs font-medium text-fg" title={formatExact(ms)}>
        {formatExact(ms)}
      </span>
      <span className="text-[10px] text-muted">{formatRelativeTime(ms)} ago</span>
    </span>
  );
}

export default function FinancePage() {
  const [staleMinutes, setStaleMinutes] = useState('15');
  const [txKind, setTxKind] = useState('');
  const [txStatus, setTxStatus] = useState('');
  const [depStatus, setDepStatus] = useState('');

  const overview = useOverview();
  const recon = useDepositsReconcile(Number(staleMinutes));
  const txns = useTransactions({ ...(txKind ? { kind: txKind } : {}), ...(txStatus ? { status: txStatus } : {}) });
  const deposits = useDeposits(depStatus || undefined);

  const txRows = useMemo(() => txns.data?.pages.flatMap((p) => p.items) ?? [], [txns.data]);
  const depRows = useMemo(() => deposits.data?.pages.flatMap((p) => p.items) ?? [], [deposits.data]);

  const summary = recon.data?.summary ?? [];
  const stale = recon.data?.stale ?? [];

  const fin = overview.data?.finance;
  const netCents = fin ? fin.depositsCents - fin.withdrawalsCents : 0;

  return (
    <>
      <PageHeader
        title="Finance"
        subtitle="Every deposit and withdrawal with the player, exact time, amount and status — plus M-Pesa reconciliation for stuck STK pushes."
      />

      {/* Money KPIs — the operator's at-a-glance cash position. */}
      <Section title="Cash position">
        {overview.isLoading ? (
          <Skeleton className="h-24 w-full" />
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            <StatCard label="Deposits (success)" money={fin?.depositsCents ?? 0} tone="up" />
            <StatCard label="Withdrawals (success)" money={fin?.withdrawalsCents ?? 0} tone="down" />
            <StatCard label="Net cash in" money={netCents} tone={netCents >= 0 ? 'up' : 'down'} />
            <StatCard label="Pending withdrawals" value={fin?.pendingWithdrawals ?? 0} tone="warn" hint="awaiting moderation" />
            <StatCard label="Wallet liability" money={fin?.walletLiabilityCents ?? 0} hint="owed to players" />
          </div>
        )}
      </Section>

      {/* Reconciliation summary — deposits grouped by status */}
      <Section title="Deposit reconciliation">
        <Toolbar>
          <FilterSelect label="Window" value={staleMinutes} onChange={setStaleMinutes} options={STALE_OPTIONS} />
        </Toolbar>
        {recon.isLoading ? (
          <Skeleton className="h-24 w-full" />
        ) : recon.isError ? (
          <Empty title="Couldn't load reconciliation" description="Try again shortly." />
        ) : summary.length === 0 ? (
          <Empty title="No deposits yet" description="Reconciliation appears once deposits are recorded." />
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {summary.map((b) => (
              <StatCard
                key={b.status}
                label={b.status}
                money={b.amountCents}
                hint={`${b.count} ${b.count === 1 ? 'deposit' : 'deposits'}`}
                tone={bucketTone(b.status)}
              />
            ))}
          </div>
        )}
      </Section>

      {/* Stale non-terminal deposits — the reconcile worklist */}
      <Section title={`Stale deposits${stale.length ? ` (${stale.length})` : ''}`}>
        {recon.isLoading ? (
          <Skeleton className="h-24 w-full" />
        ) : stale.length === 0 ? (
          <Empty title="No stale deposits" description={`No pending or processing STK pushes older than ${staleMinutes} minutes.`} />
        ) : (
          <div className="overflow-hidden rounded-2xl border border-warn">
            <TableWrap>
              <thead>
                <tr className="border-b border-border">
                  <Th>Player</Th>
                  <Th className="text-right">Amount</Th>
                  <Th>Phone</Th>
                  <Th>Status</Th>
                  <Th>Checkout ID</Th>
                  <Th className="text-right">Age</Th>
                </tr>
              </thead>
              <tbody>
                {stale.map((r) => (
                  <DepositRow key={r.txId} r={r} highlightAge />
                ))}
              </tbody>
            </TableWrap>
          </div>
        )}
      </Section>

      {/* Unified transactions explorer — deposits + withdrawals, deep + clickable */}
      <Section title="All transactions">
        <Toolbar>
          <FilterSelect label="Type" value={txKind} onChange={setTxKind} options={KIND_OPTIONS} />
          <FilterSelect label="Status" value={txStatus} onChange={setTxStatus} options={STATUS_OPTIONS} />
        </Toolbar>
        {txns.isLoading ? (
          <Skeleton className="h-40 w-full" />
        ) : txns.isError ? (
          <Empty title="Couldn't load transactions" description="Try again shortly." />
        ) : txRows.length === 0 ? (
          <Empty title="No transactions" description="No transactions match this filter." />
        ) : (
          <>
            <TableWrap>
              <thead>
                <tr className="border-b border-border">
                  <Th>Player</Th>
                  <Th>Type</Th>
                  <Th className="text-right">Amount</Th>
                  <Th>Status</Th>
                  <Th>Phone</Th>
                  <Th>Provider</Th>
                  <Th>Receipt / ref</Th>
                  <Th className="text-right">Time</Th>
                </tr>
              </thead>
              <tbody>
                {txRows.map((r) => (
                  <TxRow key={r.txId} r={r} />
                ))}
              </tbody>
            </TableWrap>
            {txns.hasNextPage ? (
              <Button variant="outline" size="sm" onClick={() => txns.fetchNextPage()} disabled={txns.isFetchingNextPage}>
                {txns.isFetchingNextPage ? 'Loading…' : 'Load more'}
              </Button>
            ) : null}
          </>
        )}
      </Section>

      {/* Deposit-only explorer (STK detail: receipt + checkout id) */}
      <Section title="Deposits (M-Pesa detail)">
        <Toolbar>
          <FilterSelect label="Status" value={depStatus} onChange={setDepStatus} options={STATUS_OPTIONS} />
        </Toolbar>
        {deposits.isLoading ? (
          <Skeleton className="h-40 w-full" />
        ) : deposits.isError ? (
          <Empty title="Couldn't load deposits" description="Try again shortly." />
        ) : depRows.length === 0 ? (
          <Empty title="No deposits" description="No deposits match this filter." />
        ) : (
          <>
            <TableWrap>
              <thead>
                <tr className="border-b border-border">
                  <Th>Player</Th>
                  <Th className="text-right">Amount</Th>
                  <Th>Phone</Th>
                  <Th>Status</Th>
                  <Th>M-Pesa receipt</Th>
                  <Th className="text-right">Time</Th>
                </tr>
              </thead>
              <tbody>
                {depRows.map((r) => (
                  <DepositRow key={r.txId} r={r} />
                ))}
              </tbody>
            </TableWrap>
            {deposits.hasNextPage ? (
              <Button variant="outline" size="sm" onClick={() => deposits.fetchNextPage()} disabled={deposits.isFetchingNextPage}>
                {deposits.isFetchingNextPage ? 'Loading…' : 'Load more'}
              </Button>
            ) : null}
          </>
        )}
      </Section>
    </>
  );
}

function TxRow({ r }: { r: AdminTransactionRow }) {
  const isDeposit = r.kind === 'deposit';
  return (
    <tr className="border-b border-border last:border-0 hover:bg-surface-2/50">
      <Td>
        <UserCell userId={r.userId} username={r.username} />
      </Td>
      <Td>
        <span
          className={
            'inline-flex rounded-md px-2 py-0.5 text-xs font-medium ' +
            (isDeposit ? 'bg-up/10 text-up' : 'bg-down/10 text-down')
          }
        >
          {isDeposit ? 'Deposit' : 'Withdrawal'}
        </span>
      </Td>
      <Td className="text-right font-medium tabular-nums">
        <Money cents={r.amountCents} />
      </Td>
      <Td>
        <StatusBadge status={r.status} />
      </Td>
      <Td>
        <PhoneCell phone={r.phone} />
      </Td>
      <Td className="text-xs capitalize text-muted">{r.provider ?? '—'}</Td>
      <Td className="font-mono text-[11px] text-muted">
        {r.mpesaReceipt ?? r.checkoutRequestId ?? '—'}
        {r.resultDesc ? <span className="block text-[10px] text-muted/70">{r.resultDesc}</span> : null}
      </Td>
      <Td className="text-right">
        <TimeCell ms={r.createdAtMs} />
      </Td>
    </tr>
  );
}

function DepositRow({ r, highlightAge }: { r: AdminDepositRow; highlightAge?: boolean }) {
  return (
    <tr className="border-b border-border last:border-0 hover:bg-surface-2/50">
      <Td>
        <UserCell userId={r.userId} username={r.username} />
      </Td>
      <Td className="text-right font-medium tabular-nums">
        <Money cents={r.amountCents} />
      </Td>
      <Td>
        <PhoneCell phone={r.phone} />
      </Td>
      <Td>
        <StatusBadge status={r.status} />
      </Td>
      {highlightAge ? (
        <Td className="font-mono text-[11px] text-muted">{r.checkoutRequestId ?? '—'}</Td>
      ) : (
        <Td className="font-mono text-[11px] text-muted">{r.mpesaReceipt ?? '—'}</Td>
      )}
      <Td className="text-right">
        {highlightAge ? (
          <span className="whitespace-nowrap text-xs font-medium text-warn">{formatRelativeTime(r.createdAtMs)} ago</span>
        ) : (
          <TimeCell ms={r.createdAtMs} />
        )}
      </Td>
    </tr>
  );
}
