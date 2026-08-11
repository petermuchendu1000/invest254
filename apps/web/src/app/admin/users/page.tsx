'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Skeleton } from '@/components/ui/Skeleton';
import { Button } from '@/components/ui/Button';
import { Money } from '@/components/ui/Money';
import { StatusBadge } from '@/components/ui/Badge';
import { formatExact, formatRelativeTime } from '@/lib/format';
import { PageHeader, StatCard, Section, TableWrap, Th, Td, Empty, Toolbar, FilterSelect } from '@/components/admin/ui';
import { useUsers, useOverview } from '@/lib/admin/hooks';
import type { AdminUserRow } from '@/lib/admin/types';

const ROLE_OPTS = [
  { value: '', label: 'All roles' },
  { value: 'player', label: 'Players' },
  { value: 'marketer', label: 'Marketers' },
  { value: 'admin', label: 'Admins' },
  { value: 'superadmin', label: 'Superadmins' },
];
const STATUS_OPTS = [
  { value: '', label: 'All statuses' },
  { value: 'active', label: 'Active' },
  { value: 'suspended', label: 'Suspended' },
  { value: 'banned', label: 'Banned' },
];

export default function UsersPage() {
  const [role, setRole] = useState('');
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');

  // Debounce the search box so we don't refetch on every keystroke.
  useEffect(() => {
    const id = setTimeout(() => setQ(search.trim()), 300);
    return () => clearTimeout(id);
  }, [search]);

  const filter = useMemo(
    () => ({ ...(role ? { role } : {}), ...(status ? { status } : {}), ...(q ? { q } : {}) }),
    [role, status, q],
  );
  const query = useUsers(filter);
  const overview = useOverview();
  const rows = useMemo(() => query.data?.pages.flatMap((p) => p.items) ?? [], [query.data]);

  const u = overview.data?.users;

  return (
    <>
      <PageHeader
        title="Users"
        subtitle="Every account with its wallet balance, lifetime cash flow, game economics and last activity — click any row to manage."
      />

      {/* Population KPIs */}
      <Section title="Population">
        {overview.isLoading ? (
          <Skeleton className="h-24 w-full" />
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <StatCard label="Total" value={u?.total ?? 0} />
            <StatCard label="Active" value={u?.active ?? 0} tone="up" />
            <StatCard label="Suspended" value={u?.suspended ?? 0} tone="warn" />
            <StatCard label="Banned" value={u?.banned ?? 0} tone="down" />
            <StatCard label="Players" value={u?.players ?? 0} />
            <StatCard label="Staff" value={(u?.admins ?? 0) + (u?.marketers ?? 0)} hint={`${u?.marketers ?? 0} marketers`} />
          </div>
        )}
      </Section>

      <Toolbar>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search username or phone…"
          className="h-9 w-full max-w-xs rounded-lg border border-border bg-surface-2 px-3 text-sm text-fg outline-none focus:border-accent sm:w-72"
        />
        <FilterSelect value={role} onChange={setRole} options={ROLE_OPTS} />
        <FilterSelect value={status} onChange={setStatus} options={STATUS_OPTS} />
      </Toolbar>

      {query.isLoading ? (
        <Skeleton className="h-40 w-full" />
      ) : query.isError ? (
        <Empty title="Couldn't load users" description="Try again shortly." />
      ) : rows.length === 0 ? (
        <Empty title="No users match" description="Adjust your search or filters." />
      ) : (
        <>
          <TableWrap>
            <thead>
              <tr className="border-b border-border">
                <Th>Player</Th>
                <Th>Role</Th>
                <Th>Status</Th>
                <Th className="text-right">Real balance</Th>
                <Th className="text-right">Bonus</Th>
                <Th className="text-right">Deposits</Th>
                <Th className="text-right">Withdrawals</Th>
                <Th className="text-right">Turnover</Th>
                <Th className="text-right">Net rev (GGR)</Th>
                <Th className="text-right">Bets</Th>
                <Th>Last transaction</Th>
                <Th className="text-right">Last active</Th>
                <Th className="text-right">Joined</Th>
                <Th className="text-right">Manage</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <UserRow key={r.userId} r={r} />
              ))}
            </tbody>
          </TableWrap>
          {query.hasNextPage ? (
            <Button variant="outline" size="sm" onClick={() => query.fetchNextPage()} disabled={query.isFetchingNextPage}>
              {query.isFetchingNextPage ? 'Loading…' : 'Load more'}
            </Button>
          ) : null}
        </>
      )}
    </>
  );
}

function UserRow({ r }: { r: AdminUserRow }) {
  const href = `/admin/users/${r.userId}`;
  return (
    <tr className="border-b border-border last:border-0 hover:bg-surface-2/50">
      <Td>
        <Link href={href} className="group inline-flex flex-col leading-tight">
          <span className="font-medium text-accent group-hover:underline">@{r.username}</span>
          {r.phone ? (
            <a
              href={`tel:${r.phone}`}
              onClick={(e) => e.stopPropagation()}
              className="text-[11px] tabular-nums text-muted hover:text-accent hover:underline"
            >
              {r.phone}
            </a>
          ) : (
            <span className="font-mono text-[10px] text-muted">{r.userId.slice(0, 8)}…</span>
          )}
        </Link>
      </Td>
      <Td className="capitalize text-muted">{r.role}</Td>
      <Td>
        <StatusBadge status={r.status} />
      </Td>
      <Td className="text-right font-medium tabular-nums">
        <Money cents={r.realBalanceCents} />
      </Td>
      <Td className="text-right tabular-nums text-muted">
        <Money cents={r.bonusBalanceCents} />
      </Td>
      <Td className="text-right tabular-nums text-up">
        <Money cents={r.depositsCents} />
      </Td>
      <Td className="text-right tabular-nums text-down">
        <Money cents={r.withdrawalsCents} />
      </Td>
      <Td className="text-right tabular-nums">
        <Money cents={r.turnoverCents} />
      </Td>
      <Td className={'text-right font-medium tabular-nums ' + (r.ggrCents >= 0 ? 'text-up' : 'text-down')}>
        <Money cents={r.ggrCents} />
      </Td>
      <Td className="text-right tabular-nums text-muted">{r.betCount.toLocaleString()}</Td>
      <Td>
        {r.lastTxAtMs && r.lastTxKind ? (
          <span className="flex flex-col leading-tight">
            <span className="text-xs font-medium capitalize text-fg">
              {r.lastTxKind}
              {r.lastTxAmountCents != null ? (
                <span className="ml-1 tabular-nums text-muted">
                  <Money cents={r.lastTxAmountCents} />
                </span>
              ) : null}
            </span>
            <span className="text-[10px] text-muted" title={formatExact(r.lastTxAtMs)}>
              {r.lastTxStatus ? `${r.lastTxStatus} · ` : ''}
              {formatRelativeTime(r.lastTxAtMs)} ago
            </span>
          </span>
        ) : (
          <span className="text-xs text-muted">No transactions</span>
        )}
      </Td>
      <Td className="whitespace-nowrap text-right text-xs text-muted">
        {r.lastActiveAtMs ? (
          <span title={formatExact(r.lastActiveAtMs)}>{formatRelativeTime(r.lastActiveAtMs)} ago</span>
        ) : (
          '—'
        )}
      </Td>
      <Td className="whitespace-nowrap text-right text-xs text-muted">
        <span title={formatExact(r.createdAtMs)}>{formatRelativeTime(r.createdAtMs)} ago</span>
      </Td>
      <Td className="text-right">
        <Link href={href} className="text-sm font-medium text-accent hover:underline">
          Open
        </Link>
      </Td>
    </tr>
  );
}
