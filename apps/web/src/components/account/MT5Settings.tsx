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
import { aboutRows, kycSub, kycTone } from '@/lib/account/mt5settings';
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

  return (
    <div className="flex flex-1 flex-col bg-[#0f1720] text-white">
      {/* MetaTrader's Settings title bar is a single line — there is no second instrument-filter
          line the way the History screen has one. */}
      <div className="sticky top-14 z-20 bg-[#3183ff] px-3 py-2.5">
        <div className="text-[15px] font-semibold leading-tight">Settings</div>
      </div>

      {/* The title bar is full-bleed, as the terminal's chrome is; the settings themselves are a
          reading column — MetaTrader's own settings on a wide window are a panel, not an edge-to-edge
          list with the value a thousand pixels from its label. */}
      <div className="mx-auto w-full lg:max-w-3xl">
        <div className="p-3">
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

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="border-t border-[#2b3543] px-3 pb-1.5 pt-4 text-[12px] font-bold uppercase tracking-wide text-white">
        {title}
      </h2>
      <div className="border-t border-[#2b3543]">{children}</div>
    </section>
  );
}

/**
 * One settings row: the label, the current state under it, and at most one thing on the right —
 * MetaTrader's checkbox, a value, or a chevron.
 */
function Row({
  label, sub, subTone, value, check, control, href, onClick, chevron, tone,
}: {
  label: string;
  sub?: string | undefined;
  subTone?: 'ok' | 'bad' | 'neutral' | undefined;
  value?: string | undefined;
  check?: boolean | undefined;
  control?: React.ReactNode;
  href?: string | undefined;
  onClick?: (() => void) | undefined;
  chevron?: boolean | undefined;
  tone?: 'bad' | undefined;
}) {
  const body = (
    <>
      <span className="min-w-0 flex-1">
        <span className={cn('block truncate text-[15px] leading-tight', tone === 'bad' ? 'text-[#f23645]' : 'text-white')}>
          {label}
        </span>
        {sub ? (
          /* MetaTrader WRAPS this line rather than clipping it — the sub-label is the setting's
             current state, so a truncated one ("Amounts are converted for display; yo…") is the one
             part of the row that must not be cut. Two lines, then ellipsis. */
          <span
            className={cn(
              'mt-0.5 line-clamp-2 block break-words text-[13px] leading-tight',
              subTone === 'ok' ? 'text-[#41be56]' : subTone === 'bad' ? 'text-[#f23645]' : 'text-[#8fa2b8]',
            )}
          >
            {sub}
          </span>
        ) : null}
      </span>
      {control ?? null}
      {value !== undefined ? (
        <span className="shrink-0 font-mono text-[13px] text-[#4597ff]">{value}</span>
      ) : null}
      {check !== undefined ? <Check on={check} /> : null}
      {chevron ? <span aria-hidden className="shrink-0 text-[#8fa2b8]">›</span> : null}
    </>
  );

  const className = 'flex w-full items-center gap-3 border-b border-[#2b3543] px-3 py-3 text-left';

  if (href) return <Link href={href} className={className}>{body}</Link>;
  // A row with a control inside it is not itself a button — the select would swallow its own taps
  // and a nested interactive element is invalid markup.
  if (onClick) return <button type="button" onClick={onClick} className={className}>{body}</button>;
  return <div className={className}>{body}</div>;
}

/** MetaTrader's square checkbox: an outline when off, solid blue with a white tick when on. */
function Check({ on }: { on: boolean }) {
  return (
    <span
      className={cn(
        'grid h-5 w-5 shrink-0 place-items-center rounded-[2px] border',
        on ? 'border-[#3183ff] bg-[#3183ff]' : 'border-[#8fa2b8]',
      )}
    >
      {on ? (
        <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 text-white" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M5 12.5l5 5 9-10" />
        </svg>
      ) : null}
    </span>
  );
}
