'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { SUPPORTED_DISPLAY_CURRENCIES } from '@invest254/shared/geo';
import { useAccountUi, useMyKyc, PLAYER_TWO_FACTOR } from '@/lib/account/accountUi';
import { useSession } from '@/lib/auth/session';
import { useAuthActions } from '@/lib/auth/useAuthActions';
import { useBrand } from '@/lib/brand/BrandProvider';
import { readCurrencyCookie, writeCurrencyCookie } from '@/lib/brand/currency';
import { useMarketerSkin } from '@/lib/marketer/isMarketer';
import { useSound } from '@/lib/sound/sound';
import { useCan } from '@/lib/auth/can';
import { useReferral } from '@/lib/affiliate/hooks';
import { useDisplayMoney } from '@/lib/money';
import { useToast } from '@/lib/toast/ToastProvider';
import { MT5AccountPanel } from '@/components/account/MT5AccountPanel';
import { useWallet, useWalletFigures } from '@/lib/wallet/hooks';
import { mt5ServerName } from '@/lib/brand/mt5Server';
import { aboutRows, kycSub, kycTone } from '@/lib/account/mt5settings';
import { MT5TitleBar, MT5Section as Section, MT5Row as Row } from '@/components/mt5/kit';
import { cn } from '@/lib/cn';

/**
 * MetaTrader 5's Settings screen.
 *
 * Built against the product's own screen (metatrader5.com/en/mobile-trading/android/help/settings):
 * a plain title bar, then groups under small uppercase headings, each row a label over the CURRENT
 * VALUE in grey, with a checkbox or a blue value on the right. MetaTrader puts the state in the
 * sub-label rather than in a switch, so you can read the whole screen's settings at a glance without
 * decoding a column of toggles — which is why the sub-label is never decoration here.
 *
 * The account sits at the top, as MetaTrader's own account screen does, and is the panel that was
 * already built for it.
 *
 * Every row does something real. MetaTrader's own list has entries this product has no equivalent
 * for — MetaQuotes ID, notification ringtone, tablet interface — and they are absent rather than
 * drawn as rows that go nowhere.
 */
export function MT5Settings() {
  const user = useSession((s) => s.user);
  const brand = useBrand();
  const { isMarketer } = useMarketerSkin();
  const { logout } = useAuthActions();
  const openDialog = useAccountUi((s) => s.open);
  const kyc = useMyKyc();
  const mayEarn = useCan('earn.referrals');
  const [accountOpen, setAccountOpen] = useState(false);

  return (
    <div className="flex flex-1 flex-col bg-[#0f1720] text-white">
      {/* MetaTrader's Settings title bar is a single line — there is no second instrument-filter
          line the way the History screen has one. */}
      <MT5TitleBar title="Settings" />

      {/* The title bar is full-bleed, as the terminal's chrome is; the settings themselves are a
          reading column — MetaTrader's own settings on a wide window are a panel, not an edge-to-edge
          list with the value a thousand pixels from its label. */}
      <div className="mx-auto w-full lg:max-w-3xl">
        {/*
          MetaTrader's phone puts the account at the top of Settings as a CARD, not as a panel with a
          blue header of its own: *"Account card (top): `John Smith` / `40739870 - MetaQuotes-Demo` /
          `Access Point EU 3`, with a green "Demo" corner ribbon and a chevron -> opens saved-accounts
          management"* (docs/mt5/04-mobile-app.md section 7).

          The panel below IS that saved-accounts management, so on a phone it waits behind the card
          rather than stacking a third blue band under the title bar and pushing every setting off
          the first screen. On a wide window there is room for both and the panel stays open, which
          is MetaTrader's desktop "Trading accounts" dialog.
        */}
        <div className="lg:hidden">
          <AccountCard open={accountOpen} onToggle={() => setAccountOpen((v) => !v)} />
          {accountOpen ? (
            <div className="border-b border-[#2b3543] p-3">
              <MT5AccountPanel embedded />
            </div>
          ) : null}
        </div>
        <div className="hidden p-3 lg:block">
          <MT5AccountPanel />
        </div>

      <Section title="Security">
        {PLAYER_TWO_FACTOR ? (
          <Row
            label="Two-factor authentication"
            sub="Ask for a code from your authenticator at sign-in"
            onClick={() => openDialog('twofactor')}
            chevron
          />
        ) : null}
        <Row
          label="Identity verification"
          sub={kycSub(kyc.data?.status)}
          subTone={kycTone(kyc.data?.status)}
          onClick={() => openDialog('verify')}
          chevron
        />
      </Section>

      {mayEarn ? <ReferralSection /> : null}

      <InterfaceSection />

      <Section title="About">
        {aboutRows(isMarketer).map((r) => (
          <Row key={r.id} label={r.label} sub={r.sub} href={r.href} chevron />
        ))}
        {/* The problem-gambling helpline is a gambling disclosure, so it follows the same rule as the
            rows above and is absent from a marketer screen. Same number the footer carries. */}
        {!isMarketer ? <Row label="Helpline" sub="Free, confidential support" href="tel:1190" value="1190" /> : null}
        <Row label="Operated by" sub={brand.licenceLine || 'Operated under licence.'} value={brand.name || brand.slug} />
      </Section>

      <Section title="Session">
        {user ? <Row label="Signed in" sub="This device" value={`@${user.username}`} /> : null}
        <Row label="Log out" tone="bad" onClick={logout} />
      </Section>

        <div className="h-6" />
      </div>
    </div>
  );
}

/**
 * MetaTrader's account card: who you are, the login and server under it, and the account's own
 * balance, with the Demo/Real tag MetaTrader draws as a corner ribbon.
 *
 * Three lines and a chevron, because that is what MetaTrader's card is. The access point it prints
 * on its third line has no equivalent here, so the line carries the balance, which is the figure
 * this card is actually consulted for.
 */
function AccountCard({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  const user = useSession((s) => s.user);
  const { data: wallet } = useWallet();
  const figures = useWalletFigures();
  const brand = useBrand();
  const money = useDisplayMoney();

  if (!user) return null;
  const demo = figures.demo;
  const server = mt5ServerName(brand, demo ? 'demo' : 'real');
  const balanceCents = (wallet?.real ?? 0) + (wallet?.bonus ?? 0);

  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      className="flex w-full items-center gap-3 border-b border-[#2b3543] px-3 py-3 text-left"
    >
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline gap-2">
          <span className="min-w-0 truncate text-[15px] font-semibold leading-tight text-white">{user.username}</span>
          <span className="shrink-0 rounded-sm bg-[#2b3543] px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[#8fa2b8]">
            {demo ? 'Demo' : 'Real'}
          </span>
        </span>
        <span className="mt-0.5 block truncate font-mono text-[12px] leading-tight text-[#8fa2b8]">
          {user.userId} - {server}
        </span>
        <span className="mt-0.5 block truncate font-mono text-[13px] leading-tight text-[#4597ff]">
          {money.fmt(balanceCents)}
        </span>
      </span>
      <span aria-hidden className={cn('shrink-0 text-[#8fa2b8] transition-transform', open && 'rotate-90')}>&#8250;</span>
    </button>
  );
}

function ReferralSection() {
  const { data: r } = useReferral();
  const { fmt } = useDisplayMoney();
  const toast = useToast();
  const [copied, setCopied] = useState<'code' | 'link' | null>(null);
  useEffect(() => {
    if (!copied) return;
    const id = setTimeout(() => setCopied(null), 1500);
    return () => clearTimeout(id);
  }, [copied]);

  if (!r || !r.referralCode) return null;
  const link = typeof window !== 'undefined' && r.referralPath ? `${window.location.origin}${r.referralPath}` : (r.referralPath ?? '');

  const copy = async (text: string, what: 'code' | 'link') => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(what);
    } catch {
      toast.push({ tone: 'error', title: 'Copy failed' });
    }
  };

  return (
    <Section title="Invite &amp; earn">
      <Row
        label="Your referral code"
        sub={r.earnedCents > 0 ? `Earned ${fmt(r.earnedCents)} so far` : 'You earn 5% of every deposit by someone you invite'}
        value={copied === 'code' ? 'Copied' : r.referralCode}
        onClick={() => void copy(r.referralCode!, 'code')}
      />
      {link ? (
        <Row
          label="Invite link"
          sub={link}
          value={copied === 'link' ? 'Copied' : 'Copy'}
          onClick={() => void copy(link, 'link')}
        />
      ) : null}
    </Section>
  );
}

/**
 * MetaTrader's Interface group. Theme and sound are per-device preferences the app already stored;
 * this is the first screen that shows their current state in words rather than as a bare icon.
 */
function InterfaceSection() {
  const brand = useBrand();
  const router = useRouter();
  const muted = useSound((s) => s.muted);
  const toggleSound = useSound((s) => s.toggle);

  // Both of these live in browser storage, which the server cannot see, so they are read after mount
  // — rendering the stored value during SSR would be a hydration mismatch.
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');
  const [currency, setCurrency] = useState('');
  useEffect(() => {
    setTheme(window.localStorage.getItem('pp-theme') === 'light' ? 'light' : 'dark');
    setCurrency(readCurrencyCookie());
  }, []);

  const setThemeTo = (next: 'dark' | 'light') => {
    setTheme(next);
    document.documentElement.classList.toggle('light', next === 'light');
    document.documentElement.classList.toggle('dark', next !== 'light');
    window.localStorage.setItem('pp-theme', next);
  };

  const setCurrencyTo = (next: string) => {
    setCurrency(next);
    writeCurrencyCookie(next || null);
    // The resolved currency and its FX rate are read server-side, so every amount on the site
    // re-renders from the new cookie.
    router.refresh();
  };

  return (
    <Section title="Interface">
      <Row
        label="Dark theme"
        sub={theme === 'dark' ? 'Dark colour scheme' : 'Light colour scheme'}
        check={theme === 'dark'}
        onClick={() => setThemeTo(theme === 'dark' ? 'light' : 'dark')}
      />
      <Row
        label="Order sounds"
        sub="A sound when an order opens and when it settles"
        check={!muted}
        onClick={toggleSound}
      />
      <Row
        label="Display currency"
        sub="Amounts are converted for display; your balance is held in KES"
        control={
          <select
            value={currency}
            onChange={(e) => setCurrencyTo(e.target.value)}
            aria-label="Display currency"
            className="rounded border border-[#2b3543] bg-[#0f1720] px-2 py-1 text-[13px] text-[#4597ff] outline-none focus:border-[#3183ff]"
          >
            <option value="">Auto ({brand.currency || 'KES'})</option>
            {SUPPORTED_DISPLAY_CURRENCIES.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        }
      />
    </Section>
  );
}

// ───────────────────────────────── chrome ─────────────────────────────────



