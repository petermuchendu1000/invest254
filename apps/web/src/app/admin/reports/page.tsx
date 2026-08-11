'use client';

import { useMemo, useState } from 'react';
import { Skeleton } from '@/components/ui/Skeleton';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Money } from '@/components/ui/Money';
import { PageHeader, Section, TableWrap, Th, Td, Empty, Toolbar } from '@/components/admin/ui';
import { useReportDaily, useReportUsers } from '@/lib/admin/hooks';
import type { DailyReportRow, UserReportRow } from '@/lib/admin/types';

function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

type Tab = 'daily' | 'users';

/** Build + trigger a client-side CSV download. */
function downloadCsv(filename: string, header: string[], rows: (string | number)[][]) {
  const esc = (v: string | number) => {
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = [header, ...rows].map((r) => r.map(esc).join(',')).join('\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function ReportsPage() {
  const [tab, setTab] = useState<Tab>('daily');
  const [from, setFrom] = useState(isoDaysAgo(30));
  const [to, setTo] = useState(isoDaysAgo(0));

  const range = { from, to };
  const daily = useReportDaily(range);
  const users = useReportUsers(range);

  const dailyRows = useMemo(() => daily.data?.items ?? [], [daily.data]);
  const userRows = useMemo(() => users.data?.items ?? [], [users.data]);

  function exportCsv() {
    if (tab === 'daily') {
      downloadCsv(
        `daily-report_${from}_${to}.csv`,
        ['date', 'deposits_cents', 'withdrawals_cents', 'turnover_cents', 'ggr_cents'],
        dailyRows.map((r) => [r.date, r.depositsCents, r.withdrawalsCents, r.turnoverCents, r.ggrCents]),
      );
    } else {
      downloadCsv(
        `user-report_${from}_${to}.csv`,
        ['user_id', 'username', 'deposits_cents', 'withdrawals_cents', 'turnover_cents', 'ggr_cents'],
        userRows.map((r) => [r.userId, r.username, r.depositsCents, r.withdrawalsCents, r.turnoverCents, r.ggrCents]),
      );
    }
  }

  const active = tab === 'daily' ? daily : users;
  const hasRows = tab === 'daily' ? dailyRows.length > 0 : userRows.length > 0;

  return (
    <>
      <PageHeader
        title="Reports"
        subtitle="Financial activity by day and by player. Use the date range to scope, then export to CSV for accounting."
        actions={
          <Toolbar>
            <div className="w-36">
              <Input type="date" label="From" value={from} onChange={(e) => setFrom(e.target.value)} />
            </div>
            <div className="w-36">
              <Input type="date" label="To" value={to} onChange={(e) => setTo(e.target.value)} />
            </div>
          </Toolbar>
        }
      />

      <div className="flex items-center justify-between gap-2">
        <div className="inline-flex rounded-xl border border-border bg-surface p-0.5">
          {(['daily', 'users'] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={
                tab === t
                  ? 'rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-accent-fg'
                  : 'rounded-lg px-3 py-1.5 text-sm font-medium text-muted hover:text-fg'
              }
            >
              {t === 'daily' ? 'Daily' : 'Top players'}
            </button>
          ))}
        </div>
        <Button variant="outline" size="sm" onClick={exportCsv} disabled={!hasRows}>
          Export CSV
        </Button>
      </div>

      <Section>
        {active.isLoading ? (
          <Skeleton className="h-40 w-full" />
        ) : active.isError ? (
          <Empty title="Couldn't load report" description="Try again shortly." />
        ) : !hasRows ? (
          <Empty title="No data in range" description="Adjust the date range to see activity." />
        ) : tab === 'daily' ? (
          <DailyTable rows={dailyRows} />
        ) : (
          <UsersTable rows={userRows} />
        )}
      </Section>
    </>
  );
}

function DailyTable({ rows }: { rows: DailyReportRow[] }) {
  return (
    <TableWrap>
      <thead>
        <tr className="border-b border-border">
          <Th>Date</Th>
          <Th className="text-right">Deposits</Th>
          <Th className="text-right">Withdrawals</Th>
          <Th className="text-right">Turnover</Th>
          <Th className="text-right">GGR</Th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.date} className="border-b border-border last:border-0">
            <Td className="whitespace-nowrap font-medium">{r.date}</Td>
            <Td className="text-right tabular-nums"><Money cents={r.depositsCents} /></Td>
            <Td className="text-right tabular-nums"><Money cents={r.withdrawalsCents} /></Td>
            <Td className="text-right tabular-nums"><Money cents={r.turnoverCents} /></Td>
            <Td className="text-right tabular-nums"><Money cents={r.ggrCents} /></Td>
          </tr>
        ))}
      </tbody>
    </TableWrap>
  );
}

function UsersTable({ rows }: { rows: UserReportRow[] }) {
  return (
    <TableWrap>
      <thead>
        <tr className="border-b border-border">
          <Th>Player</Th>
          <Th className="text-right">Deposits</Th>
          <Th className="text-right">Withdrawals</Th>
          <Th className="text-right">Turnover</Th>
          <Th className="text-right">GGR</Th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.userId} className="border-b border-border last:border-0">
            <Td>
              <span className="font-medium">@{r.username}</span>
              <span className="ml-2 font-mono text-xs text-muted">{r.userId.slice(0, 8)}…</span>
            </Td>
            <Td className="text-right tabular-nums"><Money cents={r.depositsCents} /></Td>
            <Td className="text-right tabular-nums"><Money cents={r.withdrawalsCents} /></Td>
            <Td className="text-right tabular-nums"><Money cents={r.turnoverCents} /></Td>
            <Td className="text-right tabular-nums"><Money cents={r.ggrCents} /></Td>
          </tr>
        ))}
      </tbody>
    </TableWrap>
  );
}
