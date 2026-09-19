'use client';

import * as React from 'react';
import { Button } from '@/components/ui/Button';
import { LogoMark } from '@/components/layout/Logo';
import { useAuthActions } from '@/lib/auth/useAuthActions';
import { ApiError } from '@/lib/api/client';

/**
 * Unified OPERATOR sign-in (Issue 1). High-end fintech pattern (Binance/Stripe/Coinbase): a rich,
 * vertically-composed brand panel beside a single ELEVATED sign-in card, collapsing to just the card
 * on mobile. Identity-based `adminLogin` (not per-brand), so every admin signs in at one entry point.
 */

function Field({
  label, type, name, value, onChange, placeholder, autoComplete, inputMode, trailing, required,
}: {
  label: string; type: string; name: string; value: string; onChange: (v: string) => void;
  placeholder?: string; autoComplete?: string; inputMode?: 'tel' | 'numeric' | 'text'; trailing?: React.ReactNode; required?: boolean;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[13px] font-medium text-fg/90">{label}</span>
      <span className="group relative flex items-center rounded-xl border border-border bg-surface-2/70 transition focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/40">
        <input
          name={name}
          type={type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          autoComplete={autoComplete}
          inputMode={inputMode}
          required={required}
          className="h-12 w-full rounded-xl bg-transparent px-4 text-[15px] text-fg outline-none placeholder:text-muted/70"
        />
        {trailing ? <span className="absolute right-2 flex items-center">{trailing}</span> : null}
      </span>
    </label>
  );
}

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
      if (code === 'MFA_REQUIRED') { setNeedsTotp(true); setError('Enter the 6-digit code from your authenticator app.'); }
      else if (code === 'MFA_INVALID') setError('That authentication code was incorrect or expired.');
      else if (code === 'INVALID_CREDENTIALS') setError('Incorrect phone number or password.');
      else setError(err instanceof Error ? err.message : 'Sign-in failed. Please try again.');
    } finally { setBusy(false); }
  }

  const eye = (
    <button
      type="button"
      onClick={() => setShowPw((v) => !v)}
      aria-label={showPw ? 'Hide password' : 'Show password'}
      className="flex h-8 w-8 items-center justify-center rounded-lg text-muted transition hover:bg-surface hover:text-fg"
    >
      {showPw ? (
        <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden><path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19M1 1l22 22M9.53 9.53a3 3 0 004.24 4.24" strokeLinecap="round" strokeLinejoin="round" /></svg>
      ) : (
        <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" strokeLinecap="round" strokeLinejoin="round" /><circle cx="12" cy="12" r="3" /></svg>
      )}
    </button>
  );

  return (
    <div className="grid min-h-dvh w-full grid-cols-1 bg-bg md:grid-cols-[1.05fr_1fr]">
      {/* ── Brand / assurance panel (desktop) ─────────────────────────────────────────── */}
      <aside className="relative hidden overflow-hidden border-r border-border bg-surface md:flex md:flex-col md:p-12">
        {/* layered accent glow + subtle dot grid */}
        <div className="pointer-events-none absolute inset-0" style={{ background: 'radial-gradient(70% 55% at 15% 10%, color-mix(in srgb, var(--pp-accent) 22%, transparent) 0%, transparent 60%), radial-gradient(60% 50% at 95% 100%, color-mix(in srgb, var(--pp-accent) 16%, transparent) 0%, transparent 55%)' }} aria-hidden />
        <div className="pointer-events-none absolute inset-0 opacity-[0.35]" style={{ backgroundImage: 'radial-gradient(color-mix(in srgb, var(--color-fg, #fff) 8%, transparent) 1px, transparent 1px)', backgroundSize: '22px 22px', maskImage: 'radial-gradient(80% 80% at 30% 30%, #000 0%, transparent 75%)', WebkitMaskImage: 'radial-gradient(80% 80% at 30% 30%, #000 0%, transparent 75%)' }} aria-hidden />

        <div className="relative flex items-center gap-2.5">
          <LogoMark className="h-8 w-8" />
          <div className="flex flex-col leading-tight">
            <span className="text-sm font-semibold tracking-tight text-fg">invest254 Platform</span>
            <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-accent">Operator console</span>
          </div>
        </div>

        <div className="relative my-auto flex max-w-md flex-col gap-8 py-10">
          <div className="flex flex-col gap-4">
            <span className="inline-flex w-fit items-center gap-2 rounded-full border border-border bg-surface-2/60 px-3 py-1 text-[11px] font-medium text-muted">
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-accent" /> Secure operator access
            </span>
            <h1 className="text-[34px] font-semibold leading-[1.1] tracking-tight text-fg">
              One secure entry point<br />for every operator.
            </h1>
            <p className="max-w-sm text-[15px] leading-relaxed text-muted">
              System, Platform, and Site admins sign in here — and only ever see what their role and platform allow.
            </p>
          </div>

          <ul className="flex flex-col gap-3.5">
            {[
              ['Role-scoped by design', 'Access is applied automatically from your role — no shared super-accounts.'],
              ['Strict platform isolation', 'You only ever see the brands you are entitled to. Nothing leaks across platforms.'],
              ['Fully audited', 'Every privileged action is authenticated, rate-limited, and audit-logged.'],
            ].map(([t, d]) => (
              <li key={t} className="flex items-start gap-3">
                <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent/15 text-accent">
                  <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="3" aria-hidden><path d="M20 6L9 17l-5-5" strokeLinecap="round" strokeLinejoin="round" /></svg>
                </span>
                <span className="flex flex-col">
                  <span className="text-sm font-medium text-fg">{t}</span>
                  <span className="text-[13px] leading-snug text-muted">{d}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>

        <p className="relative flex items-center gap-2 text-xs text-muted">
          <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" strokeLinecap="round" strokeLinejoin="round" /></svg>
          Authorized personnel only · Access is monitored
        </p>
      </aside>

      {/* ── Sign-in card ──────────────────────────────────────────────────────────────── */}
      <main className="flex items-center justify-center px-5 py-10 sm:px-8">
        <div className="w-full max-w-[400px]">
          {/* mobile brand mark */}
          <div className="mb-8 flex items-center gap-2.5 md:hidden">
            <LogoMark className="h-8 w-8" />
            <div className="flex flex-col leading-tight">
              <span className="text-sm font-semibold tracking-tight text-fg">invest254 Platform</span>
              <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-accent">Operator console</span>
            </div>
          </div>

          <div className="rounded-2xl border border-border bg-surface/80 p-7 shadow-2xl shadow-black/40 ring-1 ring-white/5 sm:p-8">
            <div className="mb-6 flex flex-col gap-2">
              <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-accent/15 text-accent">
                <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0110 0v4" strokeLinecap="round" strokeLinejoin="round" /></svg>
              </span>
              <h2 className="mt-1 text-[22px] font-semibold tracking-tight text-fg">Sign in to the console</h2>
              <p className="text-sm text-muted">Use your operator account. Access is scoped to your role.</p>
            </div>

            <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
              <Field label="Phone number" type="tel" name="phone" inputMode="tel" autoComplete="username" placeholder="07XX XXX XXX" value={phone} onChange={setPhone} required />
              <Field label="Password" type={showPw ? 'text' : 'password'} name="password" autoComplete="current-password" placeholder="Your password" value={password} onChange={setPassword} trailing={eye} required />
              {needsTotp ? (
                <Field label="Authentication code" type="text" name="totp" inputMode="numeric" autoComplete="one-time-code" placeholder="123456" value={totp} onChange={setTotp} required />
              ) : null}

              {error ? (
                <div role="alert" className="flex items-start gap-2 rounded-xl border border-down/40 bg-down/10 px-3 py-2.5 text-[13px] text-down">
                  <svg viewBox="0 0 24 24" className="mt-0.5 h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden><circle cx="12" cy="12" r="10" /><path d="M12 8v4M12 16h.01" strokeLinecap="round" /></svg>
                  <span>{error}</span>
                </div>
              ) : null}

              <Button type="submit" size="lg" fullWidth className="mt-1 h-12 font-semibold" disabled={busy}>
                {busy ? 'Signing in…' : needsTotp ? 'Verify & sign in' : 'Sign in'}
              </Button>
            </form>

            <div className="mt-6 flex items-center justify-center gap-1.5 border-t border-border pt-4 text-xs text-muted">
              <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" strokeLinecap="round" strokeLinejoin="round" /></svg>
              Secured &amp; audit-logged · Authorized personnel only
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
