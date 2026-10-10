'use client';

import Link from 'next/link';
import { cn } from '@/lib/cn';
import { useBrand } from '@/lib/brand/BrandProvider';
import { brandWordmark } from '@/lib/brand/brand';
import { useSession } from '@/lib/auth/session';
import { useAuthUi } from '@/lib/auth/ui';
import { useDepositUi } from '@/lib/wallet/depositUi';
import { useWallet } from '@/lib/wallet/hooks';
import { useNavDrawer } from '@/lib/ui/drawer';
import { useDisplayMoney } from '@/lib/money';
import { useCandlestickUi } from '@/components/game/candlestick/ui';

/**
 * The candlestick screen's header, as the mock draws it: the wordmark and a mode badge on the left
 * with the two section links beside them, and one bordered cluster on the right carrying the
 * account, How to, Deposit, Withdraw and the menu.
 *
 * It is a separate component from `TopBar` and `DigitsTopBar` for the same reason those two are
 * separate from each other: they are different headers, not one header with branches. This one is
 * 56/64px, sits on `#111827`, and its right-hand controls live inside a single outlined box — none
 * of which is a variant of the others.
 *
 * Every control routes to the surface that already exists: the deposit sheet, the withdraw sheet,
 * the auth modal and the nav drawer. Nothing here opens anything new except the How to sheet.
 */
export function CandlestickTopBar() {
  const brand = useBrand();
  const token = useSession((s) => s.token);
  const user = useSession((s) => s.user);
  const { data: wallet } = useWallet();
  const { fmt } = useDisplayMoney();
  const openAuth = useAuthUi((s) => s.openAuth);
  const openDeposit = useDepositUi((s) => s.openDeposit);
  const openWithdraw = useDepositUi((s) => s.openWithdraw);
  const toggleDrawer = useNavDrawer((s) => s.toggle);
  const setHowTo = useCandlestickUi((s) => s.setHowTo);

  const authed = !!token;
  const balance = fmt((wallet?.real ?? 0) + (wallet?.bonus ?? 0));
  const needAuth = (fn: () => void) => () => (authed ? fn() : openAuth('login'));

  return (
    <header className="flex h-14 w-full shrink-0 items-center justify-between border-b border-[#1f2937] bg-[#111827] px-3 md:h-16 md:px-4">
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2">
          <Link href="/" aria-label={`${brand.name} home`} className="shrink-0">
            <Wordmark text={brandWordmark(brand)} />
          </Link>
          {/* The mock's mode badge. It states the ONE thing a player must not be wrong about: real
              money. There is no demo wallet in this product, so it says Real and means it. */}
          <span className="h-5 shrink-0 whitespace-nowrap rounded-full border border-[#22c55e]/40 bg-[#22c55e]/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[#22c55e]">
            Real
          </span>
        </div>

        <nav className="hidden items-center gap-1 border-l border-[#1f2937] pl-4 md:flex">
          <button
            type="button"
            onClick={toggleDrawer}
            className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-bold uppercase tracking-wide text-gray-400 transition-colors hover:bg-amber-400/10 hover:text-amber-400"
          >
            Top Traders
          </button>
          <button
            type="button"
            onClick={toggleDrawer}
            className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-bold uppercase tracking-wide text-gray-400 transition-colors hover:bg-[#22c55e]/10 hover:text-[#22c55e]"
          >
            Tournaments
          </button>
        </nav>
      </div>

      <div className="flex items-center gap-1.5 rounded border border-[#00ff901a] bg-[#142425] px-2 py-1 md:gap-3 md:px-3">
        {authed ? (
          <div className="hidden min-w-0 flex-col items-end leading-tight sm:flex">
            <span className="max-w-[9rem] truncate text-[10px] text-gray-400">{user?.username ?? 'Account'}</span>
            <span className="whitespace-nowrap text-xs font-bold text-white">{balance}</span>
          </div>
        ) : null}

        <button
          type="button"
          onClick={() => setHowTo(true)}
          aria-label="How to trade"
          className="h-8 shrink-0 rounded-md border border-[#22c55e]/40 px-2 text-xs font-semibold text-[#22c55e] transition-colors hover:bg-[#22c55e]/10 md:px-3"
        >
          <span className="hidden sm:inline">How to</span>
          <span className="sm:hidden">?</span>
        </button>

        {authed ? (
          <>
            <button
              type="button"
              onClick={() => openDeposit()}
              className="h-8 shrink-0 rounded-md border border-[#22c55e] px-2 text-xs font-bold uppercase tracking-wide text-[#22c55e] transition-colors hover:bg-[#22c55e]/10 md:px-3"
            >
              Deposit
            </button>
            <button
              type="button"
              onClick={needAuth(openWithdraw)}
              className="hidden h-8 shrink-0 rounded-md bg-[#b91c1c] px-3 text-xs font-bold uppercase tracking-wide text-white transition-colors hover:bg-[#991b1b] sm:block"
            >
              Withdraw
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              onClick={() => openAuth('login')}
              className="h-8 shrink-0 rounded-md border border-[#374151] px-2 text-xs font-semibold text-white transition-colors hover:border-[#4b5563] md:px-3"
            >
              Login
            </button>
            <button
              type="button"
              onClick={() => openAuth('register')}
              className="h-8 shrink-0 rounded-md bg-[#22c55e] px-2 text-xs font-bold text-black transition-colors hover:brightness-110 md:px-3"
            >
              Register
            </button>
          </>
        )}

        <button
          type="button"
          onClick={toggleDrawer}
          aria-label="Menu"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-gray-300 transition-colors hover:bg-white/5 hover:text-white"
        >
          <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>
      </div>
    </header>
  );
}

/**
 * The mock's two-tone wordmark: the first word in the accent green, the rest white.
 *
 * The page this copies hard-codes "Mpesa" + "Cash"; this takes the split from the brand's own
 * wordmark, so every brand that wears this screen gets its own name in the same lockup rather than
 * someone else's.
 */
function Wordmark({ text }: { text: string }) {
  const i = text.indexOf(' ');
  const [a, b] = i > 0 ? [text.slice(0, i), text.slice(i + 1)] : [text, ''];
  return (
    <span className="whitespace-nowrap text-base font-black uppercase leading-none tracking-tighter md:text-xl">
      <span className="text-[#22c55e]">{a}</span>
      {b ? <span className="text-white">{b}</span> : null}
    </span>
  );
}
