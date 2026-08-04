'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Skeleton } from '@/components/ui/Skeleton';
import { Money } from '@/components/ui/Money';
import { StatusBadge } from '@/components/ui/Badge';
import { cn } from '@/lib/cn';
import { ApiError } from '@/lib/api/client';
import { useToast } from '@/lib/toast/ToastProvider';
import { formatDateTime, formatRelativeTime } from '@/lib/format';
import { useSession } from '@/lib/auth/session';
import { PageHeader, StatCard, Section, Empty, ConfirmButton, TableWrap, Th, Td, Toolbar, FilterSelect } from '@/components/admin/ui';
import { useUser, useUserActivity, useSetUserStatus, useAdjustBalance, useSetCommissionRate, useSetUserRole, useUserNotifications, useSendNotification, useResolveNotification } from '@/lib/admin/hooks';
import type { AdminUserActivityRow, AdminNotificationRow, NotificationLevel } from '@/lib/admin/types';

const ROLES = ['player', 'marketer', 'admin'] as const;

export default function UserDetailPage({ params }: { params: { id: string } }) {
  const id = params.id;
  const q = useUser(id);

  return (
    <>
      <div className="flex items-center gap-2 text-sm">
        <Link href="/admin/users" className="text-accent hover:underline">
          ← Users
        </Link>
      </div>

      {q.isLoading ? (
        <Skeleton className="h-64 w-full" />
      ) : q.isError || !q.data ? (
        <Empty title="User not found" description="This account may have been removed." />
      ) : (
        <>
          <PageHeader
            title={`@${q.data.username}`}
            subtitle={`${q.data.role} · joined ${formatDateTime(q.data.createdAtMs)}`}
            actions={<StatusBadge status={q.data.status} />}
          />

          <Section title="Balances">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <StatCard label="Real balance" money={q.data.realBalanceCents} />
              <StatCard label="Bonus balance" money={q.data.bonusBalanceCents} />
              <StatCard label="Turnover" money={q.data.turnoverCents} />
              <StatCard label="Net revenue (GGR)" money={q.data.ggrCents} tone="up" />
            </div>
          </Section>

          <Section title="Profile">
            <Card className="flex flex-col gap-2 text-sm">
              <Row label="User ID" value={q.data.userId} mono />
              <Row label="Phone" value={q.data.phone || '—'} />
              <Row label="Referred by" value={q.data.referredBy ? `${q.data.referredBy.slice(0, 8)}…` : '—'} mono />
            </Card>
          </Section>

          <ActivityTimeline id={id} />

          {q.data.role === 'superadmin' ? (
            <Section title="System owner">
              <Card className="flex flex-col gap-1">
                <span className="text-sm font-medium text-fg">Protected account</span>
                <span className="text-sm text-muted">
                  This is the system owner (superadmin). Their role and status are locked and their wallet can&apos;t be adjusted — no
                  account can demote, suspend, ban, or modify the owner.
                </span>
              </Card>
            </Section>
          ) : (
            <>
              <StatusActions id={id} status={q.data.status} />
              <RoleManage id={id} current={q.data.role} />
              <BalanceAdjust id={id} />
              <NotificationSend id={id} />
              {q.data.role === 'marketer' ? <CommissionRate id={id} /> : null}
            </>
          )}
        </>
      )}
    </>
  );
}

const ACTIVITY_KINDS = [
  { value: '', label: 'All activity' },
  { value: 'deposit', label: 'Deposits' },
  { value: 'withdrawal', label: 'Withdrawals' },
  { value: 'bet', label: 'Bets' },
];
const KIND_LABEL: Record<string, string> = { deposit: 'Deposit', withdrawal: 'Withdrawal', bet: 'Bet' };

function ActivityTimeline({ id }: { id: string }) {
  const [kind, setKind] = useState('');
  const q = useUserActivity(id, kind || undefined);
  const rows = useMemo(() => q.data?.pages.flatMap((p) => p.items) ?? [], [q.data]);

  return (
    <Section title="Activity">
      <Toolbar>
        <FilterSelect label="Show" value={kind} onChange={setKind} options={ACTIVITY_KINDS} />
      </Toolbar>
      {q.isLoading ? (
        <Skeleton className="h-40 w-full" />
      ) : q.isError ? (
        <Empty title="Couldn't load activity" description="Try again shortly." />
      ) : rows.length === 0 ? (
        <Empty title="No activity yet" description="Deposits, withdrawals and bets will appear here." />
      ) : (
        <>
          <TableWrap>
            <thead>
              <tr className="border-b border-border">
                <Th>Type</Th>
                <Th>Detail</Th>
                <Th className="text-right">Amount</Th>
                <Th>Status</Th>
                <Th className="text-right">When</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <ActivityRow key={`${r.kind}:${r.id}`} r={r} />
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
    </Section>
  );
}

function ActivityRow({ r }: { r: AdminUserActivityRow }) {
  const isBet = r.kind === 'bet';
  const detail = isBet
    ? [r.direction?.toUpperCase(), r.multiplier != null ? `×${r.multiplier.toFixed(2)}` : null, r.result]
        .filter(Boolean)
        .join(' · ')
    : [r.phone, r.mpesaReceipt].filter(Boolean).join(' · ');

  return (
    <tr className="border-b border-border last:border-0">
      <Td>
        <span
          className={cn(
            'inline-flex rounded-md px-2 py-0.5 text-xs font-medium',
            r.kind === 'deposit'
              ? 'bg-up/10 text-up'
              : r.kind === 'withdrawal'
                ? 'bg-down/10 text-down'
                : 'bg-surface-2 text-fg',
          )}
        >
          {KIND_LABEL[r.kind]}
        </span>
      </Td>
      <Td className="text-xs text-muted">{detail || '—'}</Td>
      <Td className="text-right font-medium tabular-nums">
        <Money cents={r.amountCents} />
        {isBet && r.pnlCents != null ? (
          <span className={cn('ml-2 text-xs', r.pnlCents >= 0 ? 'text-up' : 'text-down')}>
            {r.pnlCents >= 0 ? '+' : ''}
            <Money cents={r.pnlCents} />
          </span>
        ) : null}
      </Td>
      <Td>
        <StatusBadge status={r.status} />
      </Td>
      <Td className="whitespace-nowrap text-right text-xs text-muted">
        <span title={formatDateTime(r.createdAtMs)}>{formatRelativeTime(r.createdAtMs)} ago</span>
      </Td>
    </tr>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-muted">{label}</span>
      <span className={'font-medium text-fg ' + (mono ? 'font-mono text-xs' : '')}>{value}</span>
    </div>
  );
}

function StatusActions({ id, status }: { id: string; status: string }) {
  const m = useSetUserStatus();
  const toast = useToast();
  const [reason, setReason] = useState('');
  const s = status.toLowerCase();

  function run(action: 'suspend' | 'ban' | 'reactivate') {
    m.mutate(
      { id, action, ...(reason.trim() ? { reason: reason.trim() } : {}) },
      {
        onSuccess: () => {
          setReason('');
          toast.push({ tone: 'success', title: `Account ${action}d` });
        },
        onError: (e) =>
          toast.push({ tone: 'error', title: 'Action failed', description: e instanceof ApiError ? e.message : 'Try again.' }),
      },
    );
  }

  return (
    <Section title="Account status">
      <Card className="flex flex-col gap-3">
        <input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Reason (recorded in the audit log)"
          className="h-10 w-full rounded-xl border border-border bg-surface-2 px-3 text-sm text-fg outline-none focus:border-accent"
        />
        <div className="flex flex-wrap gap-2">
          {s !== 'active' ? (
            <ConfirmButton label="Reactivate" variant="primary" busy={m.isPending} onConfirm={() => run('reactivate')} />
          ) : null}
          {s === 'active' ? (
            <ConfirmButton label="Suspend" variant="outline" busy={m.isPending} onConfirm={() => run('suspend')} />
          ) : null}
          {s !== 'banned' ? (
            <ConfirmButton label="Ban" variant="down" confirmLabel="Ban account" busy={m.isPending} onConfirm={() => run('ban')} />
          ) : null}
        </div>
        <p className="text-xs text-muted">Suspended users can&apos;t log in; banned is permanent. Every change is audited.</p>
      </Card>
    </Section>
  );
}

function RoleManage({ id, current }: { id: string; current: string }) {
  const m = useSetUserRole();
  const toast = useToast();
  const myRole = useSession((s) => s.user?.role);
  const [role, setRole] = useState(current);

  // Role changes are sensitive — superadmin only (the API enforces this too).
  if (myRole !== 'superadmin') return null;

  function run() {
    m.mutate(
      { id, role },
      {
        onSuccess: () => toast.push({ tone: 'success', title: 'Role updated', description: 'Takes effect on the user’s next login.' }),
        onError: (e) => toast.push({ tone: 'error', title: 'Update failed', description: e instanceof ApiError ? e.message : 'Try again.' }),
      },
    );
  }

  return (
    <Section title="Role">
      <Card className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <label className="flex flex-1 flex-col gap-1 text-sm">
          <span className="text-muted">Account role</span>
          <select
            value={role}
            onChange={(e) => setRole(e.target.value)}
            className="h-10 w-full rounded-xl border border-border bg-surface-2 px-3 text-sm text-fg outline-none focus:border-accent"
          >
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </label>
        <ConfirmButton
          label="Change role"
          confirmLabel="Confirm role change"
          size="md"
          variant={role === 'admin' || role === 'superadmin' ? 'down' : 'primary'}
          busy={m.isPending}
          disabled={role === current}
          onConfirm={run}
        />
      </Card>
      <p className="text-xs text-muted">
        Promoting to admin or superadmin grants back-office access. Changes are audited and apply on the user’s next login.
      </p>
    </Section>
  );
}

function BalanceAdjust({ id }: { id: string }) {
  const m = useAdjustBalance();
  const toast = useToast();
  const [amount, setAmount] = useState('');
  const [dir, setDir] = useState<'credit' | 'debit'>('credit');
  const [reason, setReason] = useState('');

  const cents = Math.round(Number(amount) * 100);
  const valid = Number.isFinite(cents) && cents > 0 && reason.trim().length > 0;

  function run() {
    const signed = dir === 'debit' ? -cents : cents;
    m.mutate(
      { id, amountCents: signed, reason: reason.trim() },
      {
        onSuccess: (r) => {
          setAmount('');
          setReason('');
          toast.push({ tone: 'success', title: `Balance ${r.direction}ed`, description: 'Wallet updated and audited.' });
        },
        onError: (e) =>
          toast.push({ tone: 'error', title: 'Adjustment failed', description: e instanceof ApiError ? e.message : 'Try again.' }),
      },
    );
  }

  return (
    <Section title="Manual balance adjustment">
      <Card className="flex flex-col gap-3">
        <div className="flex flex-col gap-2 sm:flex-row">
          <select
            value={dir}
            onChange={(e) => setDir(e.target.value as 'credit' | 'debit')}
            className="h-10 rounded-xl border border-border bg-surface-2 px-3 text-sm text-fg outline-none focus:border-accent"
          >
            <option value="credit">Credit (+)</option>
            <option value="debit">Debit (−)</option>
          </select>
          <input
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            inputMode="decimal"
            placeholder="Amount (KES)"
            className="h-10 w-full rounded-xl border border-border bg-surface-2 px-3 text-sm text-fg outline-none focus:border-accent"
          />
        </div>
        <input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Reason (required, audited)"
          className="h-10 w-full rounded-xl border border-border bg-surface-2 px-3 text-sm text-fg outline-none focus:border-accent"
        />
        <ConfirmButton
          label={dir === 'credit' ? 'Credit wallet' : 'Debit wallet'}
          confirmLabel="Confirm adjustment"
          variant={dir === 'credit' ? 'primary' : 'down'}
          size="md"
          busy={m.isPending}
          disabled={!valid}
          onConfirm={run}
        />
        <p className="text-xs text-muted">Adjusts the real balance with an immutable ledger entry. No overdraw on debit.</p>
      </Card>
    </Section>
  );
}

function CommissionRate({ id }: { id: string }) {
  const m = useSetCommissionRate();
  const toast = useToast();
  const [ratePct, setRatePct] = useState('20');
  const pct = Number(ratePct);
  const valid = Number.isFinite(pct) && pct >= 0 && pct <= 100;

  function run() {
    m.mutate(
      { id, rate: pct / 100 },
      {
        onSuccess: () => toast.push({ tone: 'success', title: 'Commission rate updated' }),
        onError: (e) =>
          toast.push({ tone: 'error', title: 'Update failed', description: e instanceof ApiError ? e.message : 'Try again.' }),
      },
    );
  }

  return (
    <Section title="Affiliate commission rate">
      <Card className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <label className="flex flex-1 flex-col gap-1 text-sm">
          <span className="text-muted">Rate (%)</span>
          <input
            value={ratePct}
            onChange={(e) => setRatePct(e.target.value)}
            inputMode="decimal"
            className="h-10 w-full rounded-xl border border-border bg-surface-2 px-3 text-sm text-fg outline-none focus:border-accent"
          />
        </label>
        <ConfirmButton label="Update rate" size="md" busy={m.isPending} disabled={!valid} onConfirm={run} />
      </Card>
    </Section>
  );
}

const LEVELS: { value: NotificationLevel; label: string }[] = [
  { value: 'info', label: 'Info' },
  { value: 'success', label: 'Success' },
  { value: 'warning', label: 'Warning' },
  { value: 'error', label: 'Error' },
];

// One-tap templates for the issues operators raise most (matches issue #3).
const TEMPLATES: { key: string; label: string; level: NotificationLevel; dismissible: boolean; title: string; body: string; category: string }[] = [
  { key: 'bonus', label: 'Bonus added', level: 'success', dismissible: true, title: 'Bonus added', body: 'A bonus of KES 0 has been added to your wallet.', category: 'bonus' },
  { key: 'system', label: 'System issue', level: 'warning', dismissible: true, title: 'Temporary system issue', body: 'We are resolving a temporary issue. Your balance and open trades are safe.', category: 'system' },
  { key: 'suspend', label: 'Account limited (blocking)', level: 'error', dismissible: false, title: 'Your account is limited', body: 'Some actions are unavailable. Contact support if you believe this is a mistake.', category: 'account_limited' },
];

function NotificationSend({ id }: { id: string }) {
  const listQ = useUserNotifications(id);
  const send = useSendNotification(id);
  const resolve = useResolveNotification(id);
  const toast = useToast();
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [level, setLevel] = useState<NotificationLevel>('info');
  const [dismissible, setDismissible] = useState(true);
  const [category, setCategory] = useState('');

  const valid = title.trim().length > 0 && title.trim().length <= 120;
  const active = (listQ.data?.items ?? []).filter((n) => n.dismissedAtMs === null && n.resolvedAtMs === null);

  function applyTemplate(k: string) {
    const t = TEMPLATES.find((x) => x.key === k);
    if (!t) return;
    setTitle(t.title); setBody(t.body); setLevel(t.level); setDismissible(t.dismissible); setCategory(t.category);
  }

  function run() {
    send.mutate(
      { title: title.trim(), body: body.trim(), level, dismissible, category: category.trim() || null },
      {
        onSuccess: () => {
          setTitle(''); setBody(''); setCategory(''); setLevel('info'); setDismissible(true);
          toast.push({ tone: 'success', title: 'Notification sent', description: dismissible ? 'The player can dismiss it.' : 'Blocking — stays until resolved.' });
        },
        onError: (e) => toast.push({ tone: 'error', title: 'Send failed', description: e instanceof ApiError ? e.message : 'Try again.' }),
      },
    );
  }

  function clear(nid: number) {
    resolve.mutate(nid, {
      onSuccess: () => toast.push({ tone: 'success', title: 'Notification cleared' }),
      onError: (e) => toast.push({ tone: 'error', title: 'Clear failed', description: e instanceof ApiError ? e.message : 'Try again.' }),
    });
  }

  return (
    <Section title="Send notification">
      <Card className="flex flex-col gap-3">
        <div className="flex flex-wrap gap-2">
          {TEMPLATES.map((t) => (
            <Button key={t.key} variant="ghost" size="sm" onClick={() => applyTemplate(t.key)}>{t.label}</Button>
          ))}
        </div>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Title (required)"
          maxLength={120}
          className="h-10 w-full rounded-xl border border-border bg-surface-2 px-3 text-sm text-fg outline-none focus:border-accent"
        />
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Message (optional)"
          rows={2}
          className="w-full rounded-xl border border-border bg-surface-2 px-3 py-2 text-sm text-fg outline-none focus:border-accent"
        />
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <select
            value={level}
            onChange={(e) => setLevel(e.target.value as NotificationLevel)}
            className="h-10 rounded-xl border border-border bg-surface-2 px-3 text-sm text-fg outline-none focus:border-accent"
          >
            {LEVELS.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
          </select>
          <input
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            placeholder="Category (optional, e.g. bonus)"
            className="h-10 w-full rounded-xl border border-border bg-surface-2 px-3 text-sm text-fg outline-none focus:border-accent"
          />
          <label className="flex items-center gap-2 whitespace-nowrap text-sm text-fg">
            <input type="checkbox" checked={dismissible} onChange={(e) => setDismissible(e.target.checked)} />
            Dismissible
          </label>
        </div>
        <ConfirmButton
          label={dismissible ? 'Send notification' : 'Send blocking notice'}
          confirmLabel="Confirm send"
          variant={dismissible ? 'primary' : 'down'}
          size="md"
          busy={send.isPending}
          disabled={!valid}
          onConfirm={run}
        />
        <p className="text-xs text-muted">
          Dismissible notices clear when the player taps X. Blocking notices (e.g. account limits) stay until an admin resolves them.
        </p>

        {active.length > 0 ? (
          <div className="flex flex-col gap-2 border-t border-border pt-3">
            <p className="text-xs font-semibold text-muted">Active notifications</p>
            {active.map((n: AdminNotificationRow) => (
              <div key={n.id} className="flex items-start justify-between gap-3 rounded-xl border border-border bg-surface-2 px-3 py-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-fg">{n.title}</span>
                    <span className="rounded-md bg-surface px-1.5 py-0.5 text-[10px] uppercase text-muted">{n.level}</span>
                    {!n.dismissible ? <span className="rounded-md bg-down/15 px-1.5 py-0.5 text-[10px] uppercase text-down">blocking</span> : null}
                  </div>
                  {n.body ? <p className="truncate text-xs text-muted">{n.body}</p> : null}
                </div>
                <Button variant="ghost" size="sm" disabled={resolve.isPending} onClick={() => clear(n.id)}>Clear</Button>
              </div>
            ))}
          </div>
        ) : null}
      </Card>
    </Section>
  );
}
