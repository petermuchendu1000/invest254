'use client';

import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/cn';
import { useDisplayMoney } from '@/lib/money';
import { useSession } from '@/lib/auth/session';
import { useHydrated } from '@/lib/useHydrated';
import { useWallet, useSetAccountMode, useTopupDemo } from '@/lib/wallet/hooks';
import { walletFigures } from '@/lib/wallet/figures';
import { useDepositUi } from '@/lib/wallet/depositUi';
import { useCountUp } from '@/lib/useCountUp';
import { BALANCE_BUMP_EVENT } from '@/lib/game/outcomeFx';
import { useToast } from '@/lib/toast/ToastProvider';
import { ApiError } from '@/lib/api/client';

/**
 * Top-bar balance + Real/Demo account switcher for the standard shell.
 *
 * WHY THIS EXISTS: the account switcher only ever shipped on the `digits` trade surface
 * (`DigitsAccount.tsx`), which 2 of 15 brands run. On the other 13 the balance pill opened the
 * Withdraw tab and there was no way to reach the Demo account at all — the mode existed in the
 * database and the API since migration 0123, but a player could not switch to it.
 *
 * DEMO-3 rules, identical to the digits pill so the two shells cannot drift:
 *  - the active account's badge (R/D), label and spendable balance;
 *  - Real and Demo rows with their own balances; the active one is marked;
 *  - a marketer is demo-locked (their Real row is disabled — the server enforces it too);
 *  - **on the Demo account there is no Withdraw** anywhere: no button, no tab, no hint. Deposit is
 *    the only money action, and it always funds the REAL account.
 *
 * Switching is refused by the server while a contract is open (OPEN_POSITIONS); the error is shown
 * rather than pre-empted, because the trade stores are specific to each trade surface.
 */
export function AccountSwitcher() {
  const hydrated = useHydrated();
  const token = useSession((s) => s.token);
  const { data } = useWallet();
  const { fmt } = useDisplayMoney();
  const openDeposit = useDepositUi((s) => s.openDeposit);
  const openWithdraw = useDepositUi((s) => s.openWithdraw);
  const setMode = useSetAccountMode();
  const topup = useTopupDemo();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  // One spendable number, not two buckets (see BalancePill's note / docs/31).
  const total = (data?.real ?? 0) + (data?.bonus ?? 0);
  const shown = useCountUp(total, 700, total);
  const [bump, setBump] = useState(false);
  const prevRef = useRef(total);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);

  useEffect(() => {
    const trigger = () => {
      setBump(false);
      requestAnimationFrame(() => setBump(true));
      setTimeout(() => setBump(false), 750);
    };
    window.addEventListener(BALANCE_BUMP_EVENT, trigger);
    return () => window.removeEventListener(BALANCE_BUMP_EVENT, trigger);
  }, []);

  useEffect(() => {
    if (total > prevRef.current) {
      setBump(true);
      const t = setTimeout(() => setBump(false), 750);
      prevRef.current = total;
      return () => clearTimeout(t);
    }
    prevRef.current = total;
  }, [total]);

  if (!hydrated || !token || !data) return null;

  const f = walletFigures(data);
  const demo = data.mode === 'demo';

  const switchTo = (mode: 'real' | 'demo') => {
    if (mode === data.mode || setMode.isPending) return;
    setMode.mutate(mode, {
      onSuccess: (r) => { setOpen(false); toast.push({ tone: 'success', title: r.mode === 'demo' ? 'Demo account' : 'Real account', description: fmt(r.wallet.real + r.wallet.bonus) }); },
      onError: (e) => toast.push({ tone: 'error', title: 'Could not switch', description: e instanceof ApiError ? e.message : 'Try again.' }),
    });
  };

  const Row = ({ mode, label, cents, dot }: { mode: 'real' | 'demo'; label: string; cents: number; dot: string }) => {
    const active = (data.mode ?? 'real') === mode;
    return (
      <button type="button" role="menuitemradio" aria-checked={active} onClick={() => switchTo(mode)}
        disabled={mode === 'real' && data.modeLocked}
        className={cn('flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-left transition disabled:opacity-50',
          active ? 'bg-surface-2' : 'hover:bg-surface-2/60')}>
        <span className="flex items-center gap-2.5">
          <span className={cn('h-2 w-2 rounded-full', dot)} />
          <span>
            <span className="block text-[13px] font-semibold text-fg">{label}</span>
            <span className="block font-mono text-[12px] tabular-nums text-muted">{fmt(cents)}</span>
          </span>
        </span>
        {active ? <span className="text-[11px] font-semibold text-accent">Active</span> : null}
      </button>
    );
  };

  return (
    <div ref={ref} className="relative">
      <button
        id="balance-pill"
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`${demo ? 'Demo' : 'Real'} account, ${fmt(total)}. Switch account`}
        className={cn(
          'inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border bg-surface py-1.5 pl-1.5 pr-3 font-mono text-sm font-semibold tabular-nums text-fg transition hover:border-accent',
          demo ? 'border-warn/50' : 'border-border',
          bump && 'pp-balance-bump',
        )}
      >
        <span className={cn('grid h-5 w-5 shrink-0 place-items-center rounded-full text-[10px] font-bold', demo ? 'bg-warn text-black' : 'bg-accent text-accent-fg')} aria-hidden>
          {demo ? 'D' : 'R'}
        </span>
        {fmt(Math.round(shown))}
      </button>

      {open ? (
        <div className="fixed inset-x-2 top-[3.5rem] z-50 rounded-xl border border-border bg-surface p-2 shadow-2xl sm:absolute sm:inset-x-auto sm:right-0 sm:top-[calc(100%+8px)] sm:w-72"
          role="dialog" aria-label="Switch account">
          <div className="px-2 pb-2 pt-1 text-[10px] font-semibold uppercase tracking-wider text-muted">Switch account</div>
          <div role="menu" className="flex flex-col gap-1">
            <Row mode="real" label="Real Account" cents={f.realTotal} dot="bg-blue-500" />
            <Row mode="demo" label="Demo Account" cents={f.demoBalance} dot="bg-warn" />
          </div>
          {!demo && (data.bonusBalance ?? 0) > 0
            ? <p className="px-3 pt-1 text-[11px] tabular-nums text-muted">incl. {fmt(data.bonusBalance ?? 0)} bonus</p>
            : null}
          {demo ? (
            <button type="button" disabled={topup.isPending}
              onClick={() => topup.mutate(undefined, {
                onSuccess: (r) => toast.push({ tone: 'success', title: 'Demo balance refilled', description: fmt(r.demoBalance ?? 0) }),
                onError: (e) => toast.push({ tone: 'error', title: 'Could not refresh', description: e instanceof ApiError ? e.message : 'Try again.' }),
              })}
              className="mt-2 w-full border-t border-border pt-2.5 text-[12px] font-medium text-muted hover:text-fg disabled:opacity-50">
              Refresh demo balance
            </button>
          ) : null}

          {/* DEMO-3: no Withdraw on the Demo account — absent, not disabled. Deposit always funds Real. */}
          <div className={cn('mt-2 grid gap-2', f.canWithdraw ? 'grid-cols-2' : 'grid-cols-1')}>
            <button type="button" onClick={() => { setOpen(false); openDeposit(); }}
              className="rounded-lg bg-accent py-2 text-[12px] font-bold text-accent-fg">Deposit</button>
            {f.canWithdraw ? (
              <button type="button" onClick={() => { setOpen(false); openWithdraw(); }}
                className="rounded-lg border border-border py-2 text-[12px] font-semibold text-fg hover:border-accent/50">Withdraw</button>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
