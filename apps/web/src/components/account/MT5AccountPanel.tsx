'use client';

import { useState } from 'react';
import { useSession } from '@/lib/auth/session';
import { useWallet, useSetAccountMode } from '@/lib/wallet/hooks';
import { useBrand } from '@/lib/brand/BrandProvider';
import { useDisplayMoney } from '@/lib/money';
import { useDepositUi } from '@/lib/wallet/depositUi';
import { cn } from '@/lib/cn';

/**
 * MetaTrader's "Trading accounts" panel.
 *
 * Laid out against MetaTrader's own dialog: a blue title bar, label/value rows with blue-grey labels
 * and white values, a green primary action, and a footer strip with a copy affordance on the right.
 * Colours are the sampled MT5 dark theme (see lib/ui/mt5.ts).
 *
 * TWO THINGS FROM THE DIALOG ARE DELIBERATELY ABSENT.
 *
 * MetaTrader prints a PASSWORD and an INVESTOR password on this screen, because it has just
 * generated them for a demo account it created. Nothing here generates a credential, and rendering
 * a password field — real or placeholder — on an account page is a security anti-pattern: it puts a
 * secret on screen, into screenshots, and into anyone's shoulder view, for no purpose. With no
 * password shown, MetaTrader's "keep your passwords in a safe place" footer has nothing to warn
 * about either, so the strip carries the account identifier instead, which is what people actually
 * need to copy when they contact support.
 *
 * Every row is real: the name, the brand, the active account mode, the balance and the account id
 * all come from the session and the wallet.
 */
export function MT5AccountPanel() {
  const user = useSession((s) => s.user);
  const { data: wallet } = useWallet();
  const brand = useBrand();
  const money = useDisplayMoney();
  const openDeposit = useDepositUi((s) => s.openDeposit);
  const setMode = useSetAccountMode();
  const [copied, setCopied] = useState(false);

  if (!user) return null;

  const demo = wallet?.mode === 'demo';
  const currency = wallet?.currency || brand.currency || 'KES';
  // MetaTrader names the server "<Broker>-Demo" / "<Broker>-Live"; the same convention reads
  // correctly here and is derived, not invented.
  const server = `${brand.name || brand.slug || 'invest254'}-${demo ? 'Demo' : 'Live'}`;
  const balanceCents = (wallet?.real ?? 0) + (wallet?.bonus ?? 0);

  const copyId = async () => {
    try {
      await navigator.clipboard.writeText(user.userId);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard blocked (insecure context, denied permission) — the id is on screen to read */
    }
  };

  const locked = wallet?.modeLocked === true;
  const realCents = wallet?.realBalance ?? (demo ? 0 : wallet?.real ?? 0);
  const demoCents = wallet?.demoBalance ?? (demo ? wallet?.real ?? 0 : 0);

  return (
    <section className="overflow-hidden rounded-md border border-[#2b3543] bg-[#0f1720]">
      <header className="bg-[#3183ff] px-3 py-2 text-[13px] font-semibold text-white">
        Trading account: {brand.name || brand.slug || 'invest254'}
      </header>

      {/* MetaTrader's left column is an account SWITCHER, and there is a real one here: the Real and
          Demo accounts the wallet already carries. Listing them is the mock's structure driving a
          feature that exists, rather than chrome for its own sake. Stacks above the detail on a
          phone, sits beside it from `sm`, as the dialog does. */}
      <div className="flex flex-col sm:flex-row">
        <nav className="shrink-0 border-b border-[#2b3543] sm:w-56 sm:border-b-0 sm:border-r">
          {([['real', 'Real account', realCents], ['demo', 'Demo account', demoCents]] as const).map(([mode, label, cents]) => {
            const active = demo ? mode === 'demo' : mode === 'real';
            return (
              <button
                key={mode}
                type="button"
                disabled={locked || setMode.isPending || active}
                onClick={() => setMode.mutate(mode)}
                className={cn(
                  'flex w-full items-center gap-2 px-3 py-2.5 text-left transition',
                  active ? 'bg-[#202933]' : 'hover:bg-[#202933]/60',
                  locked && !active && 'cursor-not-allowed opacity-40',
                )}
              >
                <span className={cn('grid h-5 w-5 shrink-0 place-items-center rounded-sm', active ? 'bg-[#3183ff]' : 'bg-[#2b3543]')}>
                  <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 text-white" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                    <circle cx="12" cy="8" r="3.2" />
                    <path d="M5 20a7 7 0 0114 0" strokeLinecap="round" />
                  </svg>
                </span>
                <span className="min-w-0">
                  <span className={cn('block truncate text-[13px]', active ? 'text-[#4597ff]' : 'text-white')}>{label}</span>
                  <span className={cn('block truncate font-mono text-[11px]', active ? 'text-[#4597ff]' : 'text-[#8fa2b8]')}>
                    {money.fmt(cents)}
                  </span>
                </span>
              </button>
            );
          })}
          {locked ? <p className="px-3 py-2 text-[11px] text-[#8fa2b8]">Switching is disabled on this account.</p> : null}
        </nav>

        <div className="min-w-0 flex-1 px-4 py-4">
        <h2 className="mb-3 text-[14px] font-semibold text-white">
          {demo ? 'Demo account' : 'Live account'}
        </h2>
        <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-[13px]">
          <Row label="Name" value={user.username} />
          <Row label="Server" value={server} />
          <Row label="Account type" value={`${demo ? 'Demo' : 'Real'} ${currency}`} />
          <Row label="Balance" value={money.fmt(balanceCents)} strong />
          {/* MetaTrader's Login. Ours is the account identifier support asks for. */}
          <Row label="Account ID" value={user.userId} strong mono />
          {user.phone ? <Row label="Phone" value={user.phone} /> : null}
        </dl>

        <div className="mt-4 flex justify-end">
          <button
            type="button"
            onClick={() => (demo ? setMode.mutate('real') : openDeposit({}))}
            disabled={setMode.isPending}
            className="rounded bg-[#41be56] px-4 py-2 text-[13px] font-semibold text-white transition hover:bg-[#2e9d41] disabled:opacity-60"
          >
            {demo ? 'Switch to your live account' : 'Fund your account'}
          </button>
        </div>
        </div>
      </div>

      <footer className="flex items-center justify-between gap-3 border-t border-[#2b3543] bg-[#202933] px-3 py-2">
        <span className="text-[12px] text-[#8fa2b8]">Quote this ID when you contact support</span>
        <button
          type="button"
          onClick={copyId}
          className={cn('flex items-center gap-1.5 text-[12px] font-medium transition', copied ? 'text-[#41be56]' : 'text-[#4597ff] hover:text-[#3183ff]')}
        >
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
            <rect x="9" y="9" width="11" height="11" rx="2" />
            <path d="M5 15V5a2 2 0 012-2h10" strokeLinecap="round" />
          </svg>
          {copied ? 'Copied' : 'Copy to clipboard'}
        </button>
      </footer>
    </section>
  );
}

function Row({ label, value, strong, mono }: { label: string; value: string; strong?: boolean; mono?: boolean }) {
  return (
    <>
      <dt className="text-[#8fa2b8]">{label}</dt>
      <dd className={cn('break-all text-white', strong && 'font-semibold', mono && 'font-mono text-[12px]')}>{value}</dd>
    </>
  );
}
