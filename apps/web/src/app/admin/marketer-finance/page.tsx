'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { kesToCents } from '@invest254/shared/money';
import { PageHeader, StatCard, Section, TableWrap, Th, Td, Toolbar, FilterSelect, Empty } from '@/components/admin/ui';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Money } from '@/components/ui/Money';
import { cn } from '@/lib/cn';
import {
  useAffiliatePayouts,
  usePayoutAction,
  useBulkPayouts,
  useCommissionPayouts,
  useCommissionPayoutAction,
  useMarketers,
  useMarketerStatement,
  useMarketerCredit,
  useMarketerWithdraw,
  useMarketerExpenses,
  useAddMarketerExpense,
} from '@/lib/admin/hooks';
import type { AdminPayoutRow, AdminCommissionPayoutRow, AdminMarketerRow } from '@/lib/admin/types';

/*
 * Marketer & Affiliate Finance — the single, dedicated home for every money flow touching
 * marketers/affiliates. Consolidates the two independent payout queues (GGR affiliate commissions
 * and deposit-referral commissions), marketer wallet float + credit/withdraw, and the expense
 * ledger. Layout follows the analytics-console pattern used across the app: a KPI strip, a
 * segmented tab control, and filterable tables with status pills + inline row actions. Every write
 * maps 1:1 to an existing admin endpoint (front/back in sync).
 */

type Tab = 'affiliate' | 'referral' | 'wallets' | 'expenses';

const TABS: { id: Tab; label: string }[] = [
  { id: 'affiliate', label: 'Affiliate payouts' },
  { id: 'referral', label: 'Referral payouts' },
  { id: 'wallets', label: 'Marketer wallets' },
  { id: 'expenses', label: 'Expenses' },
];

const PAYOUT_STATUSES = [
  { value: 'requested', label: 'Requested' },
  { value: 'approved', label: 'Approved' },
  { value: 'paid', label: 'Paid' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'all', label: 'All' },
];

function fmtDate(ms: number | null | undefined): string {
  if (!ms) return '—';
  return new Date(ms).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

function StatusPill({ status }: { status: string }) {
  const tone =
    status === 'paid'
      ? 'bg-up/15 text-up'
      : status === 'approved'
        ? 'bg-accent/15 text-accent'
        : status === 'requested'
          ? 'bg-warn/15 text-warn'
          : status === 'rejected'
            ? 'bg-down/15 text-down'
            : 'bg-surface-2 text-muted';
  return <span className={cn('inline-flex rounded-full px-2 py-0.5 text-xs font-semibold capitalize', tone)}>{status}</span>;
}

/** Money-amount text input (KES) → returns integer cents via onCents. */
function KesInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <Input
      name="amount"
      inputMode="decimal"
      placeholder={placeholder ?? 'Amount (KES)'}
      value={value}
      onChange={(e) => onChange(e.target.value.replace(/[^\d.]/g, ''))}
      className="w-32"
    />
  );
}

export default function MarketerFinancePage() {
  const [tab, setTab] = useState<Tab>('affiliate');

  // KPI queries (dedicated 'requested' windows, independent of a tab's own status filter).
  const kpiAffiliate = useAffiliatePayouts('requested');
  const kpiReferral = useCommissionPayouts('requested');
  const marketers = useMarketers();

  const affPending = (kpiAffiliate.data?.pages ?? []).flatMap((p) => p.items as AdminPayoutRow[]);
  const refPending = (kpiReferral.data?.items ?? []).filter((r) => r.status === 'requested');
  const marketerRows = marketers.data ?? [];
  const float = marketerRows.reduce((s, m) => s + m.balance_cents, 0);

  return (
    <>
      <PageHeader
        title="Marketer & affiliate finance"
        subtitle="Payout queues, marketer wallets, and the expense ledger — every marketer money flow in one place."
      />

      {/* KPI strip */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Affiliate payouts · pending" value={`${affPending.length}`} hint="requested — awaiting decision" tone="warn" />
        <StatCard label="Affiliate pending · amount" money={affPending.reduce((s, p) => s + p.amountCents, 0)} tone="warn" />
        <StatCard label="Referral payouts · pending" value={`${refPending.length}`} hint="requested — awaiting decision" tone="warn" />
        <StatCard label="Marketer wallet float" money={float} hint={`${marketerRows.length} marketer${marketerRows.length === 1 ? '' : 's'}`} />
      </div>

      {/* Segmented tabs */}
      <div className="flex gap-1 rounded-xl border border-border bg-surface p-1">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={cn(
              'flex-1 rounded-lg px-3 py-2 text-sm font-medium transition',
              tab === t.id ? 'bg-accent text-accent-fg' : 'text-muted hover:bg-surface-2 hover:text-fg',
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'affiliate' && <AffiliatePayouts />}
      {tab === 'referral' && <ReferralPayouts />}
      {tab === 'wallets' && <MarketerWallets marketers={marketerRows} loading={marketers.isLoading} />}
      {tab === 'expenses' && <Expenses marketers={marketerRows} />}
    </>
  );
}

/* ── Affiliate (GGR) commission payouts ─────────────────────────────────────────────────────── */
function AffiliatePayouts() {
  const [status, setStatus] = useState('requested');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const q = useAffiliatePayouts(status);
  const action = usePayoutAction();
  const bulk = useBulkPayouts();

  const rows = (q.data?.pages ?? []).flatMap((p) => p.items as AdminPayoutRow[]);
  const pendingIds = rows.filter((r) => r.status === 'requested').map((r) => r.payoutId);
  const allSelected = pendingIds.length > 0 && pendingIds.every((id) => selected.has(id));
  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(pendingIds));
  const runBulk = (a: 'approve' | 'reject') => {
    const ids = [...selected];
    if (ids.length === 0) return;
    if (a === 'reject' && !confirm(`Reject ${ids.length} payout(s)?`)) return;
    bulk.mutate({ action: a, payoutIds: ids }, { onSuccess: () => setSelected(new Set()) });
  };

  return (
    <Section title="Affiliate commission payouts (GGR)">
      <Toolbar>
        <FilterSelect label="Status" value={status} onChange={(v) => { setStatus(v); setSelected(new Set()); }} options={PAYOUT_STATUSES} />
        <span className="text-xs text-muted">{rows.length} shown</span>
        {selected.size > 0 ? (
          <span className="ml-auto flex items-center gap-2">
            <span className="text-xs text-muted">{selected.size} selected</span>
            <Button size="sm" variant="up" disabled={bulk.isPending} onClick={() => runBulk('approve')}>Approve (M-Pesa)</Button>
            <Button size="sm" variant="down" disabled={bulk.isPending} onClick={() => runBulk('reject')}>Reject</Button>
          </span>
        ) : null}
      </Toolbar>
      <TableWrap>
        <thead>
          <tr>
            <Th><input type="checkbox" checked={allSelected} onChange={toggleAll} aria-label="Select all pending" disabled={pendingIds.length === 0} /></Th>
            <Th>Marketer</Th>
            <Th>Phone</Th>
            <Th className="text-right">Amount</Th>
            <Th>Status</Th>
            <Th>Requested</Th>
            <Th className="text-right">Actions</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.payoutId} className="border-t border-border">
              <Td>{r.status === 'requested' ? <input type="checkbox" checked={selected.has(r.payoutId)} onChange={() => toggle(r.payoutId)} aria-label={`Select ${r.username}`} /> : null}</Td>
              <Td><span className="font-medium text-fg">{r.username}</span></Td>
              <Td className="text-muted">{r.phone}</Td>
              <Td className="text-right"><Money cents={r.amountCents} /></Td>
              <Td><StatusPill status={r.status} /></Td>
              <Td className="text-muted">{fmtDate(r.createdAtMs)}</Td>
              <Td className="text-right">
                {r.status === 'requested' ? (
                  <span className="flex justify-end gap-1.5">
                    <Button size="sm" variant="up" disabled={action.isPending} onClick={() => action.mutate({ id: r.payoutId, action: 'approve' })}>Approve</Button>
                    <Button size="sm" variant="down" disabled={action.isPending} onClick={() => confirm('Reject this payout?') && action.mutate({ id: r.payoutId, action: 'reject' })}>Reject</Button>
                  </span>
                ) : (
                  <span className="text-xs text-muted">—</span>
                )}
              </Td>
            </tr>
          ))}
          {rows.length === 0 ? <tr><Td className="text-muted">{q.isLoading ? 'Loading…' : 'No payouts for this status.'}</Td></tr> : null}
        </tbody>
      </TableWrap>
      {q.hasNextPage ? (
        <Button variant="outline" size="sm" onClick={() => q.fetchNextPage()} disabled={q.isFetchingNextPage} className="self-start">
          {q.isFetchingNextPage ? 'Loading…' : 'Load more'}
        </Button>
      ) : null}
    </Section>
  );
}

/* ── Deposit-referral commission payouts ────────────────────────────────────────────────────── */
function ReferralPayouts() {
  const [status, setStatus] = useState('requested');
  const q = useCommissionPayouts(status);
  const action = useCommissionPayoutAction();
  const rows: AdminCommissionPayoutRow[] = q.data?.items ?? [];

  const markPaid = (r: AdminCommissionPayoutRow) => {
    const input = window.prompt('M-Pesa / bank reference for this payment (optional):');
    const ref = input && input.trim() ? input.trim() : undefined;
    action.mutate({ id: r.id, action: 'paid', ...(ref ? { ref } : {}) });
  };
  const reject = (r: AdminCommissionPayoutRow) => {
    const input = window.prompt('Reason for rejection (optional):');
    const reason = input && input.trim() ? input.trim() : undefined;
    if (confirm('Reject this commission payout?')) action.mutate({ id: r.id, action: 'reject', ...(reason ? { reason } : {}) });
  };

  return (
    <Section title="Deposit-referral commission payouts">
      <Toolbar>
        <FilterSelect label="Status" value={status} onChange={setStatus} options={PAYOUT_STATUSES} />
        <span className="text-xs text-muted">{rows.length} shown</span>
      </Toolbar>
      <TableWrap>
        <thead>
          <tr>
            <Th>Marketer</Th>
            <Th>Phone</Th>
            <Th className="text-right">Amount</Th>
            <Th>Status</Th>
            <Th>Requested</Th>
            <Th>Paid ref</Th>
            <Th className="text-right">Actions</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-t border-border">
              <Td><span className="font-medium text-fg">{r.username ?? r.beneficiaryUser.slice(0, 8)}</span></Td>
              <Td className="text-muted">{r.phone ?? '—'}</Td>
              <Td className="text-right"><Money cents={r.amountCents} /></Td>
              <Td><StatusPill status={r.status} /></Td>
              <Td className="text-muted">{fmtDate(r.requestedAtMs)}</Td>
              <Td className="text-muted">{r.paidRef ?? '—'}</Td>
              <Td className="text-right">
                <span className="flex justify-end gap-1.5">
                  {r.status === 'requested' ? (
                    <>
                      <Button size="sm" variant="up" disabled={action.isPending} onClick={() => action.mutate({ id: r.id, action: 'approve' })}>Approve</Button>
                      <Button size="sm" variant="down" disabled={action.isPending} onClick={() => reject(r)}>Reject</Button>
                    </>
                  ) : r.status === 'approved' ? (
                    <>
                      <Button size="sm" variant="up" disabled={action.isPending} onClick={() => markPaid(r)}>Mark paid</Button>
                      <Button size="sm" variant="down" disabled={action.isPending} onClick={() => reject(r)}>Reject</Button>
                    </>
                  ) : (
                    <span className="text-xs text-muted">—</span>
                  )}
                </span>
              </Td>
            </tr>
          ))}
          {rows.length === 0 ? <tr><Td className="text-muted">{q.isLoading ? 'Loading…' : 'No commission payouts for this status.'}</Td></tr> : null}
        </tbody>
      </TableWrap>
    </Section>
  );
}

/* ── Marketer wallets ───────────────────────────────────────────────────────────────────────── */
function MarketerWallets({ marketers, loading }: { marketers: AdminMarketerRow[]; loading: boolean }) {
  const [q, setQ] = useState('');
  const [selected, setSelected] = useState<AdminMarketerRow | null>(null);
  const filtered = marketers.filter((m) => `${m.name} ${m.phone}`.toLowerCase().includes(q.toLowerCase()));

  return (
    <Section title="Marketer wallets">
      <Toolbar>
        <Input name="search" placeholder="Search name or phone…" value={q} onChange={(e) => setQ(e.target.value)} className="w-56 max-w-full" />
        <span className="text-xs text-muted">{filtered.length} of {marketers.length}</span>
        <Link href="/admin/marketers" className="ml-auto text-xs font-medium text-accent hover:underline">Full marketer management →</Link>
      </Toolbar>
      <TableWrap>
        <thead>
          <tr>
            <Th>Marketer</Th>
            <Th>Phone</Th>
            <Th className="text-right">Balance</Th>
            <Th className="text-right">Fuliza</Th>
            <Th className="text-right">Airtime</Th>
            <Th>Status</Th>
            <Th className="text-right">Actions</Th>
          </tr>
        </thead>
        <tbody>
          {filtered.map((m) => (
            <tr key={m.id} className={cn('border-t border-border transition hover:bg-surface-2', selected?.id === m.id && 'bg-surface-2')}>
              <Td><span className="font-medium text-fg">{m.name}</span></Td>
              <Td className="text-muted">{m.phone}</Td>
              <Td className="text-right"><Money cents={m.balance_cents} /></Td>
              <Td className="text-right text-muted"><Money cents={m.available_fuliza_cents} /></Td>
              <Td className="text-right text-muted"><Money cents={m.airtime_balance_cents} /></Td>
              <Td><StatusPill status={m.status} /></Td>
              <Td className="text-right">
                <Button size="sm" variant="outline" onClick={() => setSelected((s) => (s?.id === m.id ? null : m))}>
                  {selected?.id === m.id ? 'Close' : 'Manage'}
                </Button>
              </Td>
            </tr>
          ))}
          {filtered.length === 0 ? <tr><Td className="text-muted">{loading ? 'Loading…' : 'No marketers.'}</Td></tr> : null}
        </tbody>
      </TableWrap>
      {selected ? <MarketerDetail key={selected.id} marketer={selected} /> : null}
    </Section>
  );
}

function MarketerDetail({ marketer }: { marketer: AdminMarketerRow }) {
  const [credit, setCredit] = useState('');
  const [withdraw, setWithdraw] = useState('');
  const [ref, setRef] = useState('');
  const doCredit = useMarketerCredit(marketer.id);
  const doWithdraw = useMarketerWithdraw(marketer.id);
  const statement = useMarketerStatement(marketer.id);

  return (
    <div className="flex flex-col gap-4 rounded-2xl border border-border bg-surface p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-fg">{marketer.name} <span className="text-muted">· {marketer.phone}</span></p>
          <p className="text-xs text-muted">Balance <Money cents={marketer.balance_cents} className="text-fg" /></p>
        </div>
        <Link href="/admin/marketers" className="text-xs font-medium text-accent hover:underline">Fuliza / airtime / PIN →</Link>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <form
          className="flex flex-col gap-2 rounded-xl border border-border p-3"
          onSubmit={(e) => { e.preventDefault(); const c = kesToCents(Number(credit)); if (c > 0) doCredit.mutate({ amountCents: c, ...(ref ? { ref } : {}) }, { onSuccess: () => setCredit('') }); }}
        >
          <span className="text-xs font-semibold uppercase tracking-wide text-up">Credit wallet</span>
          <div className="flex items-center gap-2">
            <KesInput value={credit} onChange={setCredit} />
            <Button type="submit" size="sm" variant="up" disabled={doCredit.isPending || !credit}>Credit</Button>
          </div>
        </form>
        <form
          className="flex flex-col gap-2 rounded-xl border border-border p-3"
          onSubmit={(e) => { e.preventDefault(); const c = kesToCents(Number(withdraw)); if (c > 0 && confirm(`Withdraw KES ${withdraw} from ${marketer.name}?`)) doWithdraw.mutate({ amountCents: c, ...(ref ? { ref } : {}) }, { onSuccess: () => setWithdraw('') }); }}
        >
          <span className="text-xs font-semibold uppercase tracking-wide text-down">Withdraw</span>
          <div className="flex items-center gap-2">
            <KesInput value={withdraw} onChange={setWithdraw} />
            <Button type="submit" size="sm" variant="down" disabled={doWithdraw.isPending || !withdraw}>Withdraw</Button>
          </div>
        </form>
      </div>
      <Input name="ref" placeholder="Reference (optional) — attached to the ledger entry" value={ref} onChange={(e) => setRef(e.target.value)} />

      <div>
        <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">Statement</p>
        <TableWrap>
          <thead><tr><Th>Type</Th><Th className="text-right">Amount</Th><Th className="text-right">Balance</Th><Th>Ref</Th><Th>When</Th></tr></thead>
          <tbody>
            {(statement.data ?? []).map((e) => (
              <tr key={e.id} className="border-t border-border">
                <Td className="capitalize">{e.entry_type}</Td>
                <Td className={cn('text-right', e.amount_cents >= 0 ? 'text-up' : 'text-down')}><Money cents={e.amount_cents} /></Td>
                <Td className="text-right text-muted"><Money cents={e.balance_after_cents} /></Td>
                <Td className="text-muted">{e.ref ?? '—'}</Td>
                <Td className="text-muted">{fmtDate(new Date(e.created_at).getTime())}</Td>
              </tr>
            ))}
            {(statement.data ?? []).length === 0 ? <tr><Td className="text-muted">{statement.isLoading ? 'Loading…' : 'No entries.'}</Td></tr> : null}
          </tbody>
        </TableWrap>
      </div>
    </div>
  );
}

/* ── Expenses ───────────────────────────────────────────────────────────────────────────────── */
const EXPENSE_CATEGORIES = ['advance', 'airtime', 'data_bundles', 'promo', 'salary', 'bonus', 'other'];

function Expenses({ marketers }: { marketers: AdminMarketerRow[] }) {
  const [marketerId, setMarketerId] = useState('');
  const expenses = useMarketerExpenses(marketerId);
  const add = useAddMarketerExpense(marketerId);
  const [category, setCategory] = useState('advance');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const c = kesToCents(Number(amount));
    if (!marketerId || c <= 0) return;
    add.mutate({ category, amountCents: c, ...(note ? { note } : {}) }, { onSuccess: () => { setAmount(''); setNote(''); } });
  };

  return (
    <Section title="Marketer expenses">
      <Toolbar>
        <label className="flex items-center gap-1.5 text-xs text-muted">
          <span>Marketer</span>
          <select value={marketerId} onChange={(e) => setMarketerId(e.target.value)} className="h-9 rounded-lg border border-border bg-surface-2 px-2 text-sm text-fg outline-none focus:border-accent">
            <option value="">Select a marketer…</option>
            {marketers.map((m) => <option key={m.id} value={m.id}>{m.name} · {m.phone}</option>)}
          </select>
        </label>
        {marketerId ? <span className="text-xs text-muted">Total logged: <Money cents={expenses.data?.totalCents ?? 0} className="text-fg" /></span> : null}
      </Toolbar>

      {!marketerId ? (
        <Empty title="Select a marketer" description="Choose a marketer to view and log expenses against their account." />
      ) : (
        <>
          <form className="flex flex-wrap items-end gap-2 rounded-2xl border border-border bg-surface p-3" onSubmit={submit}>
            <label className="flex flex-col gap-1 text-xs text-muted">
              <span>Category</span>
              <select value={category} onChange={(e) => setCategory(e.target.value)} className="h-9 rounded-lg border border-border bg-surface-2 px-2 text-sm text-fg outline-none focus:border-accent">
                {EXPENSE_CATEGORIES.map((c) => <option key={c} value={c}>{c.replace(/_/g, ' ')}</option>)}
              </select>
            </label>
            <KesInput value={amount} onChange={setAmount} />
            <Input name="note" placeholder="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} className="w-56 max-w-full" />
            <Button type="submit" size="sm" disabled={add.isPending || !amount}>Log expense</Button>
          </form>

          <TableWrap>
            <thead><tr><Th>Category</Th><Th className="text-right">Amount</Th><Th>Note</Th><Th>When</Th></tr></thead>
            <tbody>
              {(expenses.data?.items ?? []).map((e) => (
                <tr key={e.id} className="border-t border-border">
                  <Td className="capitalize">{e.category.replace(/_/g, ' ')}</Td>
                  <Td className="text-right"><Money cents={e.amountCents} /></Td>
                  <Td className="text-muted">{e.note ?? '—'}</Td>
                  <Td className="text-muted">{fmtDate(e.createdAtMs)}</Td>
                </tr>
              ))}
              {(expenses.data?.items ?? []).length === 0 ? <tr><Td className="text-muted">{expenses.isLoading ? 'Loading…' : 'No expenses logged.'}</Td></tr> : null}
            </tbody>
          </TableWrap>
        </>
      )}
    </Section>
  );
}
