'use client';

import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/cn';
import { ApiError } from '@/lib/api/client';
import { useSession } from '@/lib/auth/session';
import { useDisplayMoney } from '@/lib/money';
import { useWallet, useSetAccountMode, useTopupDemo } from '@/lib/wallet/hooks';
import { useDepositUi } from '@/lib/wallet/depositUi';
import { useToast } from '@/lib/toast/ToastProvider';
import { useMarketerSkin } from '@/lib/marketer/isMarketer';
import { MK } from '@/lib/marketer/labels';
// The ONE Real/Demo panel the rest of the app already hangs off its balance trigger. The candlestick
// header gets the same card rather than a second one, so the three shells can never disagree about
// what switching accounts offers (top-up on demo, no Withdraw on demo — DEMO-3).
import { AccountMenu } from '@/components/wallet/AccountMenu';
import { useCandlestickUi } from '@/components/game/candlestick/ui';

/**
 * The candlestick header's mode badge, now the screen's account switch.
 *
 * It used to be a static word, because this screen was built before anything here could reach the
 * demo wallet. The demo account is not new — `useSetAccountMode` (DEMO-1) and the shared
 * `AccountMenu` have carried it for the classic and digits shells all along — so this is a trigger
 * wired to that mechanism, not a new money path. Nothing about the switch is decided here: the
 * server moves the account and returns the new wallet, and every balance on the screen already
 * renders `wallet.real + wallet.bonus`, which IS the active account's spendable figure.
 *
 * Signed out there is nothing to switch between, so the badge stays the plain word it was.
 *
 * Note on the in-play guard: the digits pill refuses a switch while a contract is open by reading
 * `useGameSocket()`. This header is mounted OUTSIDE `GameSocketProvider` (AppShell), so it cannot
 * ask. The server refuses the switch itself in that case and `useSetAccountMode`'s fail toast says
 * so — the one outcome that must never pass silently.
 */
export function CandlestickModeBadge() {
  const token = useSession((s) => s.token);
  const { data: wallet } = useWallet();
  const { fmt } = useDisplayMoney();
  const setMode = useSetAccountMode();
  const tradeOpen = useCandlestickUi((st) => st.tradeOpen);
  const topup = useTopupDemo();
  const openDeposit = useDepositUi((s) => s.openDeposit);
  const openWithdraw = useDepositUi((s) => s.openWithdraw);
  const toast = useToast();
  const { isMarketer: skin } = useMarketerSkin();
  const [open, setOpen] = useState(false);
  const ref = useDismiss(open, () => setOpen(false));

  // A MARKETER's active tab is their `marketerPractice` flag — account_mode stays 'demo' server-side
  // — so the badge must follow the PRESENTED tab, not `mode`, or it would read Demo on their real
  // (funny) money. Same derivation as the digits pill and the shared panel.
  const active: 'real' | 'demo' = wallet?.modeLocked
    ? (wallet.marketerPractice ? 'demo' : 'real')
    : (wallet?.mode === 'demo' ? 'demo' : 'real');
  const demo = active === 'demo';
  // MARKETER: game vocabulary (Coins/Practice), never real-money words.
  const label = demo ? (skin ? MK.practiceTab : 'Demo') : (skin ? MK.realTab : 'Real');

  // The badge as the mock draws it. Demo wears the warn hue instead of the accent, because the ONE
  // thing a trader must not be wrong about is which money a tap spends.
  const badge = cn(
    'flex h-5 shrink-0 items-center gap-1 whitespace-nowrap rounded-full border px-2 text-[10px] font-bold uppercase tracking-wide',
    demo
      ? 'border-warn/40 bg-warn/10 text-warn'
      : 'border-accent/40 bg-accent/10 text-accent',
  );

  if (!token || !wallet) return <span className={badge}>{label}</span>;

  const switchTo = (mode: 'real' | 'demo') => {
    if (mode === active || setMode.isPending) return;
    /**
     * Refuse while a contract is in flight, and SAY SO.
     *
     * The server refuses this too, so money was never at risk — but its refusal arrives as a
     * generic failure. The trade screen publishes `tradeOpen` precisely so the player is told the
     * actual reason. See the note in game/candlestick/ui.ts for why the header cannot read the
     * socket itself.
     */
    if (tradeOpen) {
      setOpen(false);
      toast.push({ tone: 'error', title: 'Trade open', description: 'Close your trade before switching account.' });
      return;
    }
    setMode.mutate(mode, {
      onSuccess: (r) => {
        setOpen(false);
        toast.push({ tone: 'success', title: r.mode === 'demo' ? 'Demo' : 'Real', description: fmt(r.wallet.real + r.wallet.bonus) });
      },
      onError: (e) => toast.push({ tone: 'error', title: 'Could not switch', description: e instanceof ApiError ? e.message : 'Try again.' }),
    });
  };

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`${label} account, ${fmt((wallet.real ?? 0) + (wallet.bonus ?? 0))}. Switch account`}
        className={cn(badge, 'transition-colors', demo ? 'hover:bg-warn/20' : 'hover:bg-accent/20')}
      >
        {label}
        <svg viewBox="0 0 20 20" className="h-2.5 w-2.5" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
          <path d="m5.5 8 4.5 4.5L14.5 8" />
        </svg>
      </button>
      {open ? (
        // The shared panel paints itself from the `--pp-*` tokens, and so does this header now — the
        // bar, the badge and the card all read the same brand theme, so the card can never wear a
        // different palette from the bar it hangs off. This wrapper used to re-point those
        // tokens at the mock's own hex palette, which was the one thing that made every brand's
        // account card look identical; it inherits them instead.
        <div className="contents">
          <AccountMenu
            wallet={wallet}
            fmt={fmt}
            // The badge sits at the LEFT edge of the header, so the 280px card opens rightwards or it
            // runs off a 320px screen.
            align="left"
            switching={setMode.isPending}
            toppingUp={topup.isPending}
            onSwitch={switchTo}
            onDeposit={() => { setOpen(false); openDeposit(); }}
            onWithdraw={() => { setOpen(false); openWithdraw(); }}
            onTopupDemo={() => topup.mutate(undefined, {
              onSuccess: (r) => toast.push({ tone: 'success', title: 'Demo balance topped up', description: fmt(r.demoBalance) }),
              onError: (e) => toast.push({ tone: 'error', title: 'Could not top up', description: e instanceof ApiError ? e.message : 'Try again.' }),
            })}
          />
        </div>
      ) : null}
    </div>
  );
}

/**
 * Close the popover on an outside tap or Escape.
 *
 * `pointerdown`, not `mousedown`: on a touch screen the synthetic mouse event only arrives once the
 * tap completes, which makes the card feel slow to dismiss. Copied from the digits pill, where the
 * same hook is file-local rather than exported.
 */
function useDismiss(open: boolean, close: () => void) {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) close(); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('pointerdown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open, close]);
  return ref;
}
