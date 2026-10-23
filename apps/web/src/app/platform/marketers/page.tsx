'use client';

import { useMemo, useState } from 'react';
import { PageHeader, Section } from '@/components/admin/ui';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Skeleton } from '@/components/ui/Skeleton';
import { formatKes } from '@invest254/shared/money';
import { useFailToast } from '@/lib/toast/useFailToast';
import { useToast } from '@/lib/toast/ToastProvider';
import {
  usePlatformSites, useSiteMarketers, useStartMarketerTarget, useCloseMarketerTarget, useSetMarketerDashboard,
} from '@/lib/platform/hooks';
import type { AdminMarketerRowDto, MarketerDashboardPrefsDto } from '@/lib/api/types';

/**
 * Marketer agreements (migration 0214) — the terms a platform admin sets with ONE marketer.
 *
 * These people have never had an operator screen. The console's "Marketer wallets" panel lists
 * `public.marketers`, the till app's own identity space; the marketers who earn commission and read
 * /dashboard are `profiles` rows with role='marketer', and the two share no ids at all. This is the
 * first screen that shows them.
 *
 * Two things per marketer, and NEITHER of them moves money:
 *   - a SESSION TARGET ("5 sessions, KES 1,500"). Completing it credits nothing — an admin reads the
 *     count and pays through the payout/advance path, which already has its approval step.
 *   - DASHBOARD VISIBILITY. Presentation only: the endpoints stay open and the data is still the
 *     marketer's own. If something must be unreachable it needs a server-side gate, not a switch.
 */

/** The five switches, in the order they appear down the marketer's own dashboard. */
const SWITCHES: { key: keyof MarketerDashboardPrefsDto; label: string; desc: string }[] = [
  {
    key: 'showEarnings',
    label: 'Earnings & deposits',
    // The one the agreement usually turns on or off, and the one with a consequence worth stating.
    desc: 'Available to withdraw, the money tables, per-deposit commission and the live session’s earnings. Off also hides Request payout.',
  },
  { key: 'showLive', label: 'Go live panel', desc: 'Start Live / End Live and the session timer.' },
  { key: 'showAudience', label: 'Audience', desc: 'Referrals, active players, clicks.' },
  { key: 'showAdvance', label: 'Advance requests', desc: 'The form for requesting cash against commission.' },
  { key: 'showActivity', label: 'Other activity', desc: 'The Expenses, Referrals and Advances ledger tabs.' },
];

const ALL_ON: MarketerDashboardPrefsDto = {
  showEarnings: true, showLive: true, showAudience: true, showAdvance: true, showActivity: true,
};
const ALL_OFF: MarketerDashboardPrefsDto = {
  showEarnings: false, showLive: false, showAudience: false, showAdvance: false, showActivity: false,
};

export default function MarketerAgreementsPage() {
  const sitesQ = usePlatformSites();
  const sites = useMemo(
    () => (sitesQ.data?.sites ?? []).filter((s) => s.status === 'active'),
    [sitesQ.data],
  );
  const [siteId, setSiteId] = useState<string | null>(null);
  const active = siteId ?? sites[0]?.siteId ?? null;
  const q = useSiteMarketers(active);
  const rows = q.data?.items ?? [];

  return (
    <>
      <PageHeader
        title="Marketer agreements"
        subtitle="A session target and what each marketer sees. Neither moves money."
      />
      <Section>
        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor="brand" className="text-xs font-medium text-muted">Brand</label>
          <select
            id="brand"
            value={active ?? ''}
            onChange={(e) => setSiteId(e.target.value)}
            className="rounded-lg border border-border bg-surface px-3 py-2 text-sm text-fg outline-none focus:border-accent"
          >
            {sites.map((s) => <option key={s.siteId} value={s.siteId}>{s.name}</option>)}
          </select>
          <span className="text-xs text-muted">
            {q.isPending ? '' : `${rows.length} marketer${rows.length === 1 ? '' : 's'}`}
          </span>
        </div>
      </Section>

      <Section>
        {q.isPending ? (
          <div className="flex flex-col gap-3"><Skeleton className="h-40" /><Skeleton className="h-40" /></div>
        ) : rows.length === 0 ? (
          <Card><p className="text-sm text-muted">This brand has no marketer accounts.</p></Card>
        ) : (
          <div className="flex flex-col gap-4">
            {rows.map((m) => <MarketerCard key={m.marketerId} m={m} siteId={active!} />)}
          </div>
        )}
      </Section>
    </>
  );
}

function MarketerCard({ m, siteId }: { m: AdminMarketerRowDto; siteId: string }) {
  const start = useStartMarketerTarget(siteId);
  const close = useCloseMarketerTarget(siteId);
  const setPrefs = useSetMarketerDashboard(siteId);
  const toast = useToast();
  const failToast = useFailToast();

  const t = m.target;
  // Pre-filled from the running target so "Start new" is usually one click — the common case is the
  // same terms again for the next cycle, not different ones.
  const [sessions, setSessions] = useState(String(t?.targetSessions ?? 5));
  const [amount, setAmount] = useState(t ? String(Math.round(t.amountCents / 100)) : '1500');
  const [qualify, setQualify] = useState(String(t?.qualifyMinutes ?? 30));
  const [confirmNew, setConfirmNew] = useState(false);

  const startTarget = () => {
    const targetSessions = Number(sessions), kes = Number(amount), qualifyMinutes = Number(qualify);
    if (!Number.isInteger(targetSessions) || targetSessions < 1 || targetSessions > 100) {
      toast.push({ tone: 'error', title: 'Sessions must be a whole number from 1 to 100' }); return;
    }
    if (!Number.isFinite(kes) || kes < 0) { toast.push({ tone: 'error', title: 'Enter a valid amount in KES' }); return; }
    if (!Number.isInteger(qualifyMinutes) || qualifyMinutes < 1 || qualifyMinutes > 1440) {
      toast.push({ tone: 'error', title: 'Minimum minutes must be a whole number from 1 to 1440' }); return;
    }
    start.mutate(
      { uid: m.marketerId, targetSessions, amountCents: Math.round(kes * 100), qualifyMinutes },
      {
        onSuccess: () => { setConfirmNew(false); toast.push({ tone: 'success', title: `Target set for ${m.username ?? 'marketer'}` }); },
        onError: (e) => failToast(e),
      },
    );
  };

  const flip = (key: keyof MarketerDashboardPrefsDto, next: boolean) =>
    setPrefs.mutate({ uid: m.marketerId, patch: { [key]: next } }, { onError: (e) => failToast(e) });

  const setAll = (prefs: MarketerDashboardPrefsDto) =>
    setPrefs.mutate({ uid: m.marketerId, patch: prefs }, {
      onSuccess: () => toast.push({ tone: 'success', title: 'Dashboard updated' }),
      onError: (e) => failToast(e),
    });

  const allOff = SWITCHES.every((s) => !m.prefs[s.key]);

  return (
    <Card className="flex flex-col gap-4">
      {/* Who */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-fg">{m.username ?? '(no username)'}</div>
          <div className="truncate text-[11px] text-muted">{m.phone ?? '—'} · {m.status ?? 'unknown'}</div>
        </div>
        {t ? (
          <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${t.done ? 'bg-up/15 text-up' : 'bg-accent/15 text-accent'}`}>
            {t.completed}/{t.targetSessions} · {formatKes(t.amountCents)}
          </span>
        ) : (
          <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[10px] font-semibold uppercase text-muted">No target</span>
        )}
      </div>

      {/* Target */}
      <div className="rounded-xl border border-border bg-surface-2 p-3">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs font-semibold text-fg">Session target</span>
          {t ? (
            <span className="text-[11px] text-muted">
              Running since {new Date(t.startedAt).toLocaleDateString([], { day: 'numeric', month: 'short' })}
              {' · '}counts sessions of {t.qualifyMinutes}m or more
            </span>
          ) : null}
        </div>

        <div className="flex flex-wrap items-end gap-2">
          <Field label="Sessions" value={sessions} onChange={setSessions} width="5rem" />
          <Field label="Amount (KES)" value={amount} onChange={setAmount} width="8rem" />
          <Field label="Min minutes" value={qualify} onChange={setQualify} width="7rem" />
          {/* Starting a new target RESETS progress, so the destructive direction asks and the safe
              one does not — the same asymmetry the bonuses kill switch uses. */}
          {t && !confirmNew ? (
            <Button onClick={() => setConfirmNew(true)} disabled={start.isPending}>Start new target…</Button>
          ) : t && confirmNew ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[11px] text-down">Resets {m.username ?? 'this marketer'} to 0/{sessions || '?'}.</span>
              <Button onClick={startTarget} disabled={start.isPending}>{start.isPending ? 'Starting…' : 'Confirm'}</Button>
              <Button variant="ghost" onClick={() => setConfirmNew(false)}>Cancel</Button>
            </div>
          ) : (
            <Button onClick={startTarget} disabled={start.isPending}>{start.isPending ? 'Starting…' : 'Set target'}</Button>
          )}
          {t ? (
            <Button
              variant="ghost"
              onClick={() => close.mutate(m.marketerId, {
                onSuccess: () => toast.push({ tone: 'success', title: 'Target closed' }),
                onError: (e) => failToast(e),
              })}
              disabled={close.isPending}
            >
              Close
            </Button>
          ) : null}
        </div>

        <p className="mt-2 text-[11px] leading-relaxed text-muted">
          Reaching the target pays nothing automatically — it is a count you read, then pay through
          the payout or advance queue. A session counts only once it has run the minimum minutes.
        </p>
      </div>

      {/* Visibility */}
      <div className="rounded-xl border border-border bg-surface-2 p-3">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs font-semibold text-fg">What they see on their dashboard</span>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => setAll(ALL_OFF)} disabled={setPrefs.isPending || allOff}>Hide all</Button>
            <Button variant="ghost" onClick={() => setAll(ALL_ON)} disabled={setPrefs.isPending}>Show all</Button>
          </div>
        </div>
        <ul className="flex flex-col gap-2">
          {SWITCHES.map((sw) => (
            <li key={sw.key} className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-xs font-medium text-fg">{sw.label}</div>
                <div className="text-[11px] leading-snug text-muted">{sw.desc}</div>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={m.prefs[sw.key]}
                aria-label={sw.label}
                onClick={() => flip(sw.key, !m.prefs[sw.key])}
                disabled={setPrefs.isPending}
                className={`mt-0.5 h-6 w-11 shrink-0 rounded-full p-0.5 transition disabled:opacity-50 ${m.prefs[sw.key] ? 'bg-up' : 'bg-surface'}`}
              >
                <span className={`block h-5 w-5 rounded-full bg-white transition ${m.prefs[sw.key] ? 'translate-x-5' : ''}`} />
              </button>
            </li>
          ))}
        </ul>
        {allOff ? (
          <p className="mt-2 text-[11px] text-warn">
            Every block is hidden. {m.username ?? 'This marketer'} will see only their referral link
            {t ? ' and their session target' : ''}.
          </p>
        ) : null}
        <p className="mt-2 text-[11px] leading-relaxed text-muted">
          Presentation only. Hiding a block does not close the endpoint behind it — the data is still
          theirs and still reachable outside the app.
        </p>
      </div>
    </Card>
  );
}

function Field({ label, value, onChange, width }: { label: string; value: string; onChange: (v: string) => void; width: string }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] font-medium text-muted">{label}</span>
      <Input
        inputMode="numeric"
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/[^0-9]/g, ''))}
        style={{ width }}
        className="tabular-nums"
      />
    </label>
  );
}
