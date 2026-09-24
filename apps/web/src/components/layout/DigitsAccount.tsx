'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { cn } from '@/lib/cn';
import { api } from '@/lib/api/endpoints';
import { ApiError } from '@/lib/api/client';
import { useBrand } from '@/lib/brand/BrandProvider';
import { useSession } from '@/lib/auth/session';
import { useAuthActions } from '@/lib/auth/useAuthActions';
import { useWallet } from '@/lib/wallet/hooks';
import { useDepositUi } from '@/lib/wallet/depositUi';
import { useAmountText } from '@/lib/game/useAmountText';
import { useDigitSession } from '@/lib/game/digitSession';
import { useSupportChat } from '@/lib/support/useSupportChat';
import { useToast } from '@/lib/toast/ToastProvider';
import { env } from '@/lib/env';
import { DIcon, type IconName } from '@/components/game/digits/icons';

/** Close a popover on outside click / Escape. */
function useDismiss(open: boolean, close: () => void) {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) close(); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open, close]);
  return ref;
}

/**
 * Balance pill (digits broker mock): account badge, "REAL" label, the spendable balance and a
 * chevron that opens the account breakdown (real cash and bonus, with Deposit / Withdraw). The
 * platform has one real account per player, so there is no demo switch here.
 * While AUTO is running, the pill shows "Auto · <side>" instead (phones have no room for both).
 */
export function AccountPill({ compact = false }: { compact?: boolean }) {
  const { data } = useWallet();
  const amt = useAmountText();
  const auto = useDigitSession((s) => s.auto);
  const openDeposit = useDepositUi((s) => s.openDeposit);
  const openWithdraw = useDepositUi((s) => s.openWithdraw);
  const [open, setOpen] = useState(false);
  const ref = useDismiss(open, () => setOpen(false));
  if (!data) return null;
  const real = data.real ?? 0;
  const bonus = data.bonus ?? 0;

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="dialog"
        aria-expanded={open}
        className={cn('flex items-center rounded-xl border border-border bg-surface/70 py-1 pl-1 transition hover:border-accent/50', compact ? 'h-10 gap-1.5 pr-1.5' : 'h-11 gap-2 pr-2')}
      >
        <span className={cn('grid shrink-0 place-items-center rounded-full bg-down font-bold text-white', compact ? 'h-6 w-6 text-[10px]' : 'h-7 w-7 text-[11px]')}>R</span>
        {auto && compact ? (
          <span className="flex items-center gap-1.5 whitespace-nowrap rounded-full bg-bg px-2.5 py-1 text-[11px] font-semibold text-fg">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" />Auto · {auto.side.toUpperCase()}
          </span>
        ) : (
          <span className="flex flex-col items-start leading-none">
            <span className="text-[9px] font-semibold uppercase tracking-wider text-muted">Real</span>
            <span className={cn('mt-0.5 font-mono font-bold tabular-nums text-fg', compact ? 'text-[12px]' : 'text-[13px]')}>{amt.prefix}{amt.num(real + bonus)}</span>
          </span>
        )}
        <DIcon name="chevronDown" className="h-3.5 w-3.5 text-muted" />
      </button>
      {open ? (
        <div className="absolute left-0 top-[calc(100%+8px)] z-50 w-64 rounded-xl border border-border bg-surface p-2 shadow-2xl sm:left-auto sm:right-0" role="dialog" aria-label="Account balance">
          <div className="px-2 pb-2 pt-1 text-[10px] font-semibold uppercase tracking-wider text-muted">Account</div>
          <div className="rounded-lg bg-surface-2 px-3 py-2.5">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-2 text-[13px] font-semibold text-fg"><span className="h-2 w-2 rounded-full bg-accent" />Real account</span>
              <span className="text-[11px] font-semibold text-accent">Active</span>
            </div>
            <div className="mt-1 font-mono text-[13px] tabular-nums text-muted">{amt.prefix}{amt.num(real)} cash</div>
            {bonus > 0 ? <div className="font-mono text-[12px] tabular-nums text-muted">{amt.prefix}{amt.num(bonus)} bonus (play only)</div> : null}
          </div>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <button type="button" onClick={() => { setOpen(false); openDeposit(); }} className="rounded-lg bg-accent py-2 text-[12px] font-bold text-accent-fg">Deposit</button>
            <button type="button" onClick={() => { setOpen(false); openWithdraw(); }} className="rounded-lg border border-border py-2 text-[12px] font-semibold text-fg hover:border-accent/50">Withdraw</button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** Mask everything but the first two and last four characters ("25*****5678"). */
function mask(v: string): string {
  if (v.length <= 6) return v;
  return `${v.slice(0, 2)}${'*'.repeat(Math.max(3, v.length - 6))}${v.slice(-4)}`;
}

/**
 * Avatar menu (digits broker mock): who is signed in, then Profile, Change password, Referrals,
 * support and Sign out. Only items the platform actually supports are listed.
 */
export function AccountMenu() {
  const user = useSession((s) => s.user);
  const brand = useBrand();
  const { logout } = useAuthActions();
  const setSupportOpen = useSupportChat((s) => s.setOpen);
  const [open, setOpen] = useState(false);
  const [pw, setPw] = useState(false);
  const ref = useDismiss(open, () => setOpen(false));
  if (!user) return null;

  const Item = ({ icon, label, onClick, href, tone }: { icon: IconName; label: string; onClick?: () => void; href?: string; tone?: 'down' | 'up' }) => {
    const cls = cn('flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-[13px] font-medium transition hover:bg-surface-2',
      tone === 'down' ? 'text-down' : tone === 'up' ? 'text-up' : 'text-fg');
    const inner = <><DIcon name={icon} className="h-4 w-4 shrink-0 opacity-80" />{label}</>;
    return href
      ? <Link href={href} className={cls} onClick={() => setOpen(false)}>{inner}</Link>
      : <button type="button" className={cls} onClick={() => { setOpen(false); onClick?.(); }}>{inner}</button>;
  };

  return (
    <div ref={ref} className="relative">
      <button type="button" onClick={() => setOpen((v) => !v)} aria-label="Account menu" aria-expanded={open}
        className="grid h-10 w-10 place-items-center rounded-full border border-border bg-surface/70 text-fg transition hover:border-accent/50">
        <DIcon name="user" className="h-[18px] w-[18px]" />
      </button>
      {open ? (
        <div className="absolute right-0 top-[calc(100%+8px)] z-50 w-64 rounded-xl border border-border bg-surface p-1.5 shadow-2xl" role="menu">
          <div className="border-b border-border px-3 pb-3 pt-2">
            <div className="truncate text-[14px] font-semibold text-fg">@{user.username}</div>
            {user.phone ? <div className="font-mono text-[11px] text-muted">{mask(user.phone)}</div> : null}
          </div>
          <div className="py-1">
            <Item icon="user" label="Profile" href="/account" />
            <Item icon="lock" label="Change Password" onClick={() => setPw(true)} />
            <Item icon="gift" label="Referrals" href="/account" />
          </div>
          <div className="border-t border-border py-1">
            {env.supportChatEnabled ? <Item icon="chat" label="Live Chat" onClick={() => setSupportOpen(true)} tone="up" /> : null}
            {brand.supportEmail ? <Item icon="mail" label={brand.supportEmail} href={`mailto:${brand.supportEmail}`} /> : null}
            <Item icon="logout" label="Sign Out" onClick={() => { void logout(); }} tone="down" />
          </div>
        </div>
      ) : null}
      <ChangePasswordModal open={pw} onClose={() => setPw(false)} />
    </div>
  );
}

/** Change password (existing POST /auth/password/change). */
function ChangePasswordModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const token = useSession((s) => s.token);
  const toast = useToast();
  const [cur, setCur] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { if (!open) { setCur(''); setNext(''); setConfirm(''); setErr(null); } }, [open]);
  if (!open) return null;

  const problem = next && next.length < 8 ? 'Use at least 8 characters.' : confirm && confirm !== next ? 'The new passwords do not match.' : null;
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token || problem || !cur || !next) return;
    setBusy(true); setErr(null);
    try {
      await api.changePassword(token, { current_password: cur, new_password: next });
      toast.push({ tone: 'success', title: 'Password changed' });
      onClose();
    } catch (x) {
      setErr(x instanceof ApiError ? x.message : 'Could not change your password. Try again.');
    } finally { setBusy(false); }
  };
  const input = 'h-11 w-full rounded-lg border border-border bg-surface-2 px-3 text-sm text-fg outline-none focus:border-accent';
  return (
    <div className="fixed inset-0 z-[60] grid place-items-center p-4" role="dialog" aria-modal="true" aria-label="Change password">
      <button aria-label="Close" className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <form onSubmit={submit} className="relative flex w-full max-w-sm flex-col gap-3 rounded-2xl border border-border bg-surface p-5 shadow-2xl">
        <h2 className="text-base font-semibold text-fg">Change password</h2>
        <input type="password" autoComplete="current-password" placeholder="Current password" value={cur} onChange={(e) => setCur(e.target.value)} className={input} />
        <input type="password" autoComplete="new-password" placeholder="New password" value={next} onChange={(e) => setNext(e.target.value)} className={input} />
        <input type="password" autoComplete="new-password" placeholder="Repeat new password" value={confirm} onChange={(e) => setConfirm(e.target.value)} className={input} />
        {problem || err ? <p className="text-[12px] text-down">{problem ?? err}</p> : null}
        <div className="mt-1 flex gap-2">
          <button type="button" onClick={onClose} className="flex-1 rounded-lg border border-border py-2.5 text-sm font-semibold text-fg">Cancel</button>
          <button type="submit" disabled={busy || !!problem || !cur || !next || !confirm} className="flex-1 rounded-lg bg-accent py-2.5 text-sm font-bold text-accent-fg disabled:opacity-50">
            {busy ? 'Saving…' : 'Change password'}
          </button>
        </div>
      </form>
    </div>
  );
}
