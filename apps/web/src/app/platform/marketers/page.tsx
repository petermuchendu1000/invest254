'use client';

import { useMemo, useState } from 'react';
import { PageHeader, StatCard, Section, TableWrap, Th, Td } from '@/components/admin/ui';
import { usePlatformMarketerEarnings, usePlatformMarketerRollup } from '@/lib/platform/hooks';
import type { MarketerEarningsRow, MarketerRollupGroup } from '@/lib/platform/endpoints';

const money = (cents: number, cur = 'KES') => `${cur} ${(cents / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const pct = (r: number) => `${(r * 100).toFixed(1)}%`;

type NumKey =
  | 'commissionRate' | 'totalClients' | 'depositsCents' | 'ggrCents' | 'commissionCents'
  | 'paidCents' | 'pendingCents' | 'expensesCents' | 'balanceDueCents';

interface Col { key: NumKey; label: string; }
const COLS: Col[] = [
  { key: 'commissionRate', label: 'Rate' },
  { key: 'totalClients', label: 'Clients' },
  { key: 'depositsCents', label: 'Deposits' },
  { key: 'ggrCents', label: 'GGR' },
  { key: 'commissionCents', label: 'Commission' },
  { key: 'paidCents', label: 'Paid' },
  { key: 'pendingCents', label: 'Pending' },
  { key: 'expensesCents', label: 'Expenses' },
  { key: 'balanceDueCents', label: 'Balance due' },
];

function StatusPill({ status }: { status: string }) {
  const tone = status === 'active' ? 'bg-up/15 text-up' : status === 'suspended' ? 'bg-warn/15 text-warn' : 'bg-down/15 text-down';
  return <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${tone}`}>{status}</span>;
}

/**
 * Platform earnings console — one comprehensive row per marketer per brand. Every figure is
 * scoped to that brand (server-side, fn_platform_marketer_earnings). Sortable, with KPI tiles and
 * a totals footer. Modeled on dense finance dashboards (Stripe/Tremor), styled with the app tokens.
 */
export default function MarketersPage() {
  const earnings = usePlatformMarketerEarnings();
  const rollup = usePlatformMarketerRollup();
  const rows: MarketerEarningsRow[] = useMemo(() => earnings.data?.rows ?? [], [earnings.data]);

  const [sortKey, setSortKey] = useState<NumKey>('balanceDueCents');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const sorted = useMemo(() => {
    const s = [...rows];
    s.sort((a, b) => (sortDir === 'asc' ? a[sortKey] - b[sortKey] : b[sortKey] - a[sortKey]));
    return s;
  }, [rows, sortKey, sortDir]);

  const totals = useMemo(() => rows.reduce((acc, r) => ({
    clients: acc.clients + r.totalClients,
    active: acc.active + r.activeClients,
    deposits: acc.deposits + r.depositsCents,
    ggr: acc.ggr + r.ggrCents,
    commission: acc.commission + r.commissionCents,
    paid: acc.paid + r.paidCents,
    pending: acc.pending + r.pendingCents,
    expenses: acc.expenses + r.expensesCents,
    balance: acc.balance + r.balanceDueCents,
  }), { clients: 0, active: 0, deposits: 0, ggr: 0, commission: 0, paid: 0, pending: 0, expenses: 0, balance: 0 }), [rows]);

  const onSort = (key: NumKey) => {
    if (key === sortKey) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortKey(key); setSortDir('desc'); }
  };
  const SortTh = ({ col }: { col: Col }) => (
    <Th className="text-right cursor-pointer select-none whitespace-nowrap">
      <button type="button" onClick={() => onSort(col.key)} className="inline-flex items-center gap-1 hover:text-fg">
        {col.label}{sortKey === col.key ? <span>{sortDir === 'asc' ? '▲' : '▼'}</span> : null}
      </button>
    </Th>
  );

  const groups: MarketerRollupGroup[] = rollup.data?.marketers ?? [];

  return (
    <>
      <PageHeader title="Marketer earnings" subtitle="Per marketer, per brand — clients, deposits, GGR, commission, payouts, expenses and the balance still owed. Every figure is scoped to its brand." />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <StatCard label="Marketers" value={rows.length} />
        <StatCard label="Clients" value={`${totals.active.toLocaleString()} / ${totals.clients.toLocaleString()}`} hint="active / total" />
        <StatCard label="GGR" money={totals.ggr} />
        <StatCard label="Commission" money={totals.commission} tone="up" />
        <StatCard label="Paid out" money={totals.paid} />
        <StatCard label="Balance due" money={totals.balance} tone={totals.balance > 0 ? 'warn' : 'default'} />
      </div>

      <Section title="Earnings by marketer & brand">
        <TableWrap>
          <thead>
            <tr>
              <Th>Marketer</Th>
              <Th>Brand</Th>
              {COLS.map((c) => <SortTh key={c.key} col={c} />)}
            </tr>
          </thead>
          <tbody>
            {sorted.map((r) => (
              <tr key={`${r.affiliateUserId}-${r.siteId}`} className="border-t border-border">
                <Td>
                  <div className="flex flex-col">
                    <span className="font-semibold text-fg">{r.username ?? r.label ?? r.affiliateUserId.slice(0, 8)}</span>
                    <span className="text-xs text-muted">{r.phone ?? '—'} · <StatusPill status={r.affiliateStatus} /></span>
                  </div>
                </Td>
                <Td>{r.siteName} <span className="text-muted">· {r.siteSlug}</span></Td>
                <Td className="text-right tabular-nums">{pct(r.commissionRate)}</Td>
                <Td className="text-right tabular-nums">{r.activeClients}/{r.totalClients}</Td>
                <Td className="text-right tabular-nums">{money(r.depositsCents)}</Td>
                <Td className="text-right tabular-nums">{money(r.ggrCents)}</Td>
                <Td className="text-right tabular-nums text-up">{money(r.commissionCents)}</Td>
                <Td className="text-right tabular-nums">{money(r.paidCents)}</Td>
                <Td className="text-right tabular-nums">{money(r.pendingCents)}</Td>
                <Td className="text-right tabular-nums text-muted">{money(r.expensesCents)}</Td>
                <Td className={`text-right tabular-nums font-semibold ${r.balanceDueCents > 0 ? 'text-warn' : 'text-fg'}`}>{money(r.balanceDueCents)}</Td>
              </tr>
            ))}
            {rows.length > 0 ? (
              <tr className="border-t border-border bg-surface-2">
                <Td className="font-semibold text-fg">Totals</Td>
                <Td className="text-muted">{rows.length} rows</Td>
                <Td className="text-right text-muted">—</Td>
                <Td className="text-right font-semibold tabular-nums">{totals.active}/{totals.clients}</Td>
                <Td className="text-right font-semibold tabular-nums">{money(totals.deposits)}</Td>
                <Td className="text-right font-semibold tabular-nums">{money(totals.ggr)}</Td>
                <Td className="text-right font-semibold tabular-nums text-up">{money(totals.commission)}</Td>
                <Td className="text-right font-semibold tabular-nums">{money(totals.paid)}</Td>
                <Td className="text-right font-semibold tabular-nums">{money(totals.pending)}</Td>
                <Td className="text-right font-semibold tabular-nums text-muted">{money(totals.expenses)}</Td>
                <Td className={`text-right font-semibold tabular-nums ${totals.balance > 0 ? 'text-warn' : 'text-fg'}`}>{money(totals.balance)}</Td>
              </tr>
            ) : null}
            {rows.length === 0 ? <tr><Td className="text-muted">{earnings.isLoading ? 'Loading…' : 'No marketer earnings yet.'}</Td></tr> : null}
          </tbody>
        </TableWrap>
      </Section>

      <Section title="Cross-brand rollup (linked identities)">
        <TableWrap>
          <thead>
            <tr><Th>Marketer</Th><Th>Brand</Th><Th className="text-right">Clients</Th><Th className="text-right">GGR</Th><Th className="text-right">Commission</Th></tr>
          </thead>
          <tbody>
            {groups.map((g) => {
              const key = g.marketerGlobalId ?? g.sites[0]?.affiliateUserId ?? 'unknown';
              const heading = g.label ?? `Unlinked · ${g.sites[0]?.affiliateUserId ?? ''}`;
              return [
                ...g.sites.map((s, i) => (
                  <tr key={`${key}-${s.siteId}-${s.affiliateUserId}`} className="border-t border-border">
                    <Td>{i === 0 ? <span className="font-semibold text-fg">{heading}</span> : <span className="text-muted">↳</span>}</Td>
                    <Td>{s.siteName} <span className="text-muted">· {s.siteSlug}</span></Td>
                    <Td className="text-right tabular-nums">{s.clients.toLocaleString()}</Td>
                    <Td className="text-right tabular-nums">{money(s.ggrCents)}</Td>
                    <Td className="text-right tabular-nums">{money(s.commissionCents)}</Td>
                  </tr>
                )),
                g.sites.length > 1 ? (
                  <tr key={`${key}-total`} className="border-t border-border bg-surface-2">
                    <Td className="font-semibold text-fg">Total</Td>
                    <Td className="text-muted">{g.sites.length} brands</Td>
                    <Td className="text-right font-semibold text-fg tabular-nums">{g.totals.clients.toLocaleString()}</Td>
                    <Td className="text-right font-semibold text-fg tabular-nums">{money(g.totals.ggrCents)}</Td>
                    <Td className="text-right font-semibold text-fg tabular-nums">{money(g.totals.commissionCents)}</Td>
                  </tr>
                ) : null,
              ];
            })}
            {groups.length === 0 ? <tr><Td className="text-muted">{rollup.isLoading ? 'Loading…' : 'No linked marketers yet.'}</Td></tr> : null}
          </tbody>
        </TableWrap>
      </Section>
    </>
  );
}
