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
import { CIcon } from '@/components/game/candlestick/icons';
import { CandlestickModeBadge } from '@/components/candlestick-account/CandlestickModeBadge';

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
 * the auth modal and — behind the mode badge — the shared Real/Demo account panel. The hamburger
 * opens `CandlestickNavSheet`, this shell's own simple menu (Trade / Deposit / Withdraw / History /
 * Profile / How to trade), NOT the terminal's `MT5Drawer`: see that file and AppShell's candlestick
 * branch for why the broker's panel has no business on this screen.
 *
 * The balance is on the bar at every width, phone included — see the note on it below.
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

  const authed = !!token;
  const balance = fmt((wallet?.real ?? 0) + (wallet?.bonus ?? 0));
  const needAuth = (fn: () => void) => () => (authed ? fn() : openAuth('login'));

  return (
    // `px-2` on a phone rather than `px-3`: the bar now carries the balance as well as the wordmark,
    // the badge, Deposit and the menu, and at 320px those 8px are the difference between a row that
    // fits and one that squeezes the figure.
    <header className="flex h-14 w-full shrink-0 items-center justify-between gap-1.5 border-b border-[#1f2937] bg-[#111827] px-2 md:h-16 md:gap-3 md:px-4">
      <div className="flex min-w-0 items-center gap-4">
        <div className="flex min-w-0 items-center gap-1.5 md:gap-2">
          {/* The wordmark is the one thing here a player can still identify when it is clipped, so
              it is the child that gives way: `min-w-0` + `truncate` inside. Everything to its right
              — the badge, the balance, Deposit, the menu — is load-bearing. */}
          <Link href="/" aria-label={`${brand.name} home`} className="min-w-0">
            <Wordmark text={brandWordmark(brand)} />
          </Link>
          {/* The mock's mode badge, and the screen's account switch: it names the ONE thing a
              player must not be wrong about — which money a tap spends — and is the control that
              changes it, through the demo mechanism the other shells already use (DEMO-1). */}
          <CandlestickModeBadge />
        </div>

        <nav className="hidden items-center gap-1 border-l border-[#1f2937] pl-4 md:flex">
          <button
            type="button"
            onClick={toggleDrawer}
            className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-bold uppercase tracking-wide text-gray-400 transition-colors hover:bg-amber-400/10 hover:text-amber-400"
          >
            <CIcon name="top" className="h-3.5 w-3.5" />
            Top Traders
          </button>
          <button
            type="button"
            onClick={toggleDrawer}
            className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-bold uppercase tracking-wide text-gray-400 transition-colors hover:bg-[#22c55e]/10 hover:text-[#22c55e]"
          >
            <CIcon name="tours" className="h-3.5 w-3.5" />
            Tournaments
          </button>
        </nav>
      </div>

      <div className="flex min-w-0 items-center gap-1 rounded border border-[#00ff901a] bg-[#142425] px-1.5 py-1 md:gap-3 md:px-3">
        {/* The balance, on the bar, at EVERY width.

            It used to be `hidden sm:flex`, which hid it on the one device this audience actually
            trades on: the figure was only on the chart pane's quote band, so a player who had
            switched to Chat or Top Traders could not see their money at all. The username is the
            half that goes: a name tells a player nothing they do not know, so below `sm` the block
            is the figure alone, centred on one line. `min-w-0` + `truncate` because a brand's
            wallet can run to eight digits and this is the only unbounded thing in the row. */}
        {authed ? (
          <div className="flex min-w-0 flex-col items-end justify-center leading-tight">
            <span className="hidden max-w-[9rem] truncate text-[10px] text-gray-400 sm:block">{user?.username ?? 'Account'}</span>
            <span className="min-w-0 max-w-[6rem] truncate text-xs font-bold text-white sm:max-w-[9rem]">{balance}</span>
          </div>
        ) : null}

        {authed ? (
          <>
            <button
              type="button"
              onClick={() => openDeposit()}
              // `px-1.5` and `text-[11px]` on a phone: Deposit stays (it is the one action this bar
              // exists to offer) but it gives up the padding the balance beside it needs.
              className="h-8 shrink-0 rounded-md border border-[#22c55e] px-1.5 text-[11px] font-bold uppercase tracking-wide text-[#22c55e] transition-colors hover:bg-[#22c55e]/10 sm:px-2 sm:text-xs md:px-3"
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
    <span className="block truncate whitespace-nowrap text-sm font-black uppercase leading-none tracking-tighter sm:text-base md:text-xl">
      <span className="text-[#22c55e]">{a}</span>
      {b ? <span className="text-white">{b}</span> : null}
    </span>
  );
}
