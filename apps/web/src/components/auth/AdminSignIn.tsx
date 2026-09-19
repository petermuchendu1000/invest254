'use client';

import * as React from 'react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { LogoMark } from '@/components/layout/Logo';
import { useAuthActions } from '@/lib/auth/useAuthActions';
import { ApiError } from '@/lib/api/client';

/**
 * Unified OPERATOR sign-in (Issue 1 — one entry point for every admin).
 *
 * High-end auth pattern (Binance/Stripe/Coinbase): a split screen on desktop — a brand/assurance
 * panel beside a single focused sign-in card — collapsing to just the card on mobile. It calls the
 * IDENTITY-based `adminLogin` (not the per-brand player login), so a platform_admin bound to one
 * brand, a site admin, or the system owner all authenticate at the SAME console regardless of the
 * host domain. Styling uses the app's brand tokens for a consistent, professional dark UI.
 */
export function AdminSignIn({ onSignedIn }: { onSignedIn?: () => void }) {
  const { adminLogin } = useAuthActions();
  const [phone, setPhone] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [totp, setTotp] = React.useState('');
  const [needsTotp, setNeedsTotp] = React.useState(false);
  const [showPw, setShowPw] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setError(null);
    setBusy(true);
    try {
      await adminLogin(phone.trim(), password, needsTotp ? totp.trim() : undefined);
      onSignedIn?.();
    } catch (err) {
      const code = err instanceof ApiError ? err.code : '';
      if (code === 'MFA_REQUIRED') {
        setNeedsTotp(true);
        setError('Enter the 6-digit code from your authenticator app.');
      } else if (code === 'MFA_INVALID') {
        setError('That authentication code was incorrect or expired. Try again.');
      } else if (code === 'INVALID_CREDENTIALS') {
        setError('Incorrect phone number or password.');
      } else {
        setError(err instanceof Error ? err.message : 'Sign-in failed. Please try again.');
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid min-h-dvh w-full grid-cols-1 bg-bg md:grid-cols-2">
      {/* Brand / assurance panel (desktop only) */}
      <aside className="relative hidden overflow-hidden border-r border-border bg-surface md:flex md:flex-col md:justify-between md:p-10">
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.14]"
          style={{ background: 'radial-gradient(60% 50% at 20% 15%, var(--pp-accent) 0%, transparent 60%), radial-gradient(50% 40% at 90% 90%, var(--pp-accent) 0%, transparent 55%)' }}
          aria-hidden
        />
        <div className="relative flex items-center gap-2">
          <LogoMark className="h-8 w-8" />
          <div className="flex flex-col leading-tight">
            <span className="text-sm font-semibold tracking-tight text-fg">invest254 Platform</span>
            <span className="text-[10px] font-medium uppercase tracking-wide text-accent">Operator console</span>
          </div>
        </div>

        <div className="relative flex flex-col gap-6">
          <h1 className="max-w-sm text-3xl font-semibold leading-tight tracking-tight text-fg">
            One secure entry point for every operator.
          </h1>
          <ul className="flex max-w-sm flex-col gap-3 text-sm text-muted">
            {[
              'System, Platform, and Site admins sign in here — access is scoped automatically to your role.',
              'Strict platform isolation: you only ever see the brands you are entitled to.',
              'Every privileged action is authenticated, rate-limited, and audit-logged.',
            ].map((t) => (
              <li key={t} className="flex items-start gap-2.5">
                <svg viewBox="0 0 24 24" className="mt-0.5 h-4 w-4 shrink-0 text-accent" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden>
                  <path d="M20 6L9 17l-5-5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                <span>{t}</span>
              </li>
            ))}
          </ul>
        </div>

        <p className="relative text-xs text-muted">Authorized personnel only. Access is monitored.</p>
      </aside>

      {/* Sign-in card */}
      <main className="flex items-center justify-center px-5 py-10 sm:px-8">
        <div className="w-full max-w-sm">
          {/* Mobile brand mark */}
          <div className="mb-8 flex items-center gap-2 md:hidden">
            <LogoMark className="h-7 w-7" />
            <div className="flex flex-col leading-tight">
              <span className="text-sm font-semibold tracking-tight text-fg">invest254 Platform</span>
              <span className="text-[10px] font-medium uppercase tracking-wide text-accent">Operator console</span>
            </div>
          </div>

          <div className="mb-6 flex flex-col gap-1.5">
            <h2 className="text-2xl font-semibold tracking-tight text-fg">Sign in to the console</h2>
            <p className="text-sm text-muted">Use your operator account. Your access is scoped to your role.</p>
          </div>

          <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
            <Input
              label="Phone number"
              name="phone"
              type="tel"
              inputMode="tel"
              autoComplete="username"
              placeholder="07XX XXX XXX"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              required
            />
            <Input
              label="Password"
              name="password"
              type={showPw ? 'text' : 'password'}
              autoComplete="current-password"
              placeholder="Your password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              trailing={
                <button
                  type="button"
                  onClick={() => setShowPw((v) => !v)}
                  className="rounded-md px-2 py-1 text-xs font-medium text-muted transition hover:text-fg"
                  aria-label={showPw ? 'Hide password' : 'Show password'}
                >
                  {showPw ? 'Hide' : 'Show'}
                </button>
              }
            />

            {needsTotp ? (
              <Input
                label="Authentication code"
                name="totp"
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder="123456"
                value={totp}
                onChange={(e) => setTotp(e.target.value)}
                hint="6-digit code from your authenticator app."
                required
              />
            ) : null}

            {error ? (
              <div role="alert" className="rounded-brand border border-down/40 bg-down/10 px-3 py-2 text-sm text-down">
                {error}
              </div>
            ) : null}

            <Button type="submit" size="lg" fullWidth className="mt-1 font-semibold" disabled={busy}>
              {busy ? 'Signing in…' : needsTotp ? 'Verify & sign in' : 'Sign in'}
            </Button>
          </form>

          <p className="mt-6 flex items-center justify-center gap-1.5 text-xs text-muted">
            <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Secured & audit-logged. Authorized personnel only.
          </p>
        </div>
      </main>
    </div>
  );
}
