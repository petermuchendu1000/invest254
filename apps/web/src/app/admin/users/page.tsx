'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Skeleton } from '@/components/ui/Skeleton';
import { Button } from '@/components/ui/Button';
import { Money } from '@/components/ui/Money';
import { StatusBadge } from '@/components/ui/Badge';
import { formatExact, formatRelativeTime } from '@/lib/format';
import { PageHeader, StatCard, Section, TableWrap, Th, Td, Empty, Toolbar, FilterSelect } from '@/components/admin/ui';
import { useUsers, useOverview, type UsersFilter } from '@/lib/admin/hooks';
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

const kesToCents = (s: string): number | undefined => {
  const n = Number(s);
  return s.trim() !== '' && Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : undefined;
};
const intOrU = (s: string): number | undefined => {
  const n = Number(s);
  return s.trim() !== '' && Number.isFinite(n) && n >= 0 ? Math.round(n) : undefined;
};

export default function UsersPage() {
  const [role, setRole] = useState('');
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const [showAdv, setShowAdv] = useState(false);

  // Numeric threshold filters, held as raw KES / count strings and debounced into the query.
  const [minBal, setMinBal] = useState('');
  const [maxBal, setMaxBal] = useState('');
  const [minDep, setMinDep] = useState('');
  const [minWd, setMinWd] = useState('');
  const [minTurn, setMinTurn] = useState('');
  const [minBets, setMinBets] = useState('');

  const [applied, setApplied] = useState<UsersFilter>({});

  useEffect(() => {
    const id = setTimeout(() => {
      const next: UsersFilter = {};
      if (role) next.role = role;
      if (status) next.status = status;
      const qv = search.trim();
      if (qv) next.q = qv;
      const mb = kesToCents(minBal); if (mb !== undefined) next.minBalanceCents = mb;
      const xb = kesToCents(maxBal); if (xb !== undefined) next.maxBalanceCents = xb;
      const md = kesToCents(minDep); if (md !== undefined) next.minDepositsCents = md;
      const mw = kesToCents(minWd); if (mw !== undefined) next.minWithdrawalsCents = mw;
      const mt = kesToCents(minTurn); if (mt !== undefined) next.minTurnoverCents = mt;
      const mbet = intOrU(minBets); if (mbet !== undefined) next.minBets = mbet;
      setApplied(next);
    }, 350);
    return () => clearTimeout(id);
  }, [role, status, search, minBal, maxBal, minDep, minWd, minTurn, minBets]);

  const query = useUsers(applied);
  const overview = useOverview();
  const rows = useMemo(() => query.data?.pages.flatMap((p) => p.items) ?? [], [query.data]);

  const advValues = [minBal, maxBal, minDep, minWd, minTurn, minBets];
  const advCount = advValues.filter((s) => s.trim() !== '').length;

  function clearAll() {
    setRole('');
    setStatus('');
    setSearch('');
    setMinBal('');
    setMaxBal('');
    setMinDep('');
    setMinWd('');
    setMinTurn('');
    setMinBets('');
  }
  const anyFilter = advCount > 0 || !!role || !!status || !!search.trim();

  const u = overview.data?.users;

  return (
    <>
      <PageHeader
        title="Users"
        subtitle="Every account with its wallet balance, lifetime cash flow, game economics and last activity — filter and click any row to manage."
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

      {/* Primary filters */}
      <Toolbar>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search username or phone…"
          className="h-9 w-full max-w-xs rounded-lg border border-border bg-surface-2 px-3 text-sm text-fg outline-none focus:border-accent sm:w-72"
        />
        <FilterSelect value={role} onChange={setRole} options={ROLE_OPTS} />
        <FilterSelect value={status} onChange={setStatus} options={STATUS_OPTS} />
        <Button variant="outline" size="sm" onClick={() => setShowAdv((v) => !v)}>
          {showAdv ? 'Hide filters' : 'More filters'}
          {advCount > 0 ? (
            <span className="ml-1.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[10px] font-bold text-accent-fg">
              {advCount}
            </span>
          ) : null}
        </Button>
        {anyFilter ? (
          <Button variant="ghost" size="sm" onClick={clearAll}>
            Clear
          </Button>
        ) : null}
      </Toolbar>

      {/* Advanced numeric filters — balances, cash flow, activity */}
      {showAdv ? (
        <div className="grid grid-cols-2 gap-3 rounded-2xl border border-border bg-surface p-3 sm:grid-cols-3 lg:grid-cols-6">
          <NumberFilter label="Min balance (KES)" value={minBal} onChange={setMinBal} placeholder="e.g. 1000" />
          <NumberFilter label="Max balance (KES)" value={maxBal} onChange={setMaxBal} placeholder="e.g. 50000" />
          <NumberFilter label="Min deposits (KES)" value={minDep} onChange={setMinDep} placeholder="e.g. 5000" />
          <NumberFilter label="Min withdrawals (KES)" value={minWd} onChange={setMinWd} placeholder="e.g. 5000" />
          <NumberFilter label="Min turnover (KES)" value={minTurn} onChange={setMinTurn} placeholder="e.g. 10000" />
          <NumberFilter label="Min bets" value={minBets} onChange={setMinBets} placeholder="e.g. 10" />
        </div>
      ) : null}

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

function NumberFilter({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="flex flex-col gap-1 text-xs text-muted">
      {label}
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        inputMode="numeric"
        placeholder={placeholder}
        className="h-9 w-full rounded-lg border border-border bg-surface-2 px-3 text-sm text-fg outline-none focus:border-accent"
      />
    </label>
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
