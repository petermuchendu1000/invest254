'use client';

import { useState } from 'react';
import { kesToCents, centsToKes, formatKes } from '@invest254/shared/money';
import { normalizeMsisdn, MIN_WITHDRAWAL_CENTS } from '@invest254/shared/payments';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { useWithdraw, useWallet } from '@/lib/wallet/hooks';
import { useDepositUi } from '@/lib/wallet/depositUi';
import { useSession } from '@/lib/auth/session';
import { authErrorMessage } from '@/lib/auth/errors';
import { maskMsisdn } from '@/lib/wallet/format';

const MIN_KES = centsToKes(MIN_WITHDRAWAL_CENTS);
const QUICK = [
  { label: '25%', frac: 0.25 },
  { label: '50%', frac: 0.5 },
  { label: 'Max', frac: 1 },
] as const;

const digitsOnly = (s: string) => s.replace(/\D/g, '');
const grouped = (s: string) => (s ? Number(s).toLocaleString('en-KE') : '');

/** Withdraw body for the unified wallet sheet (no Modal/header — WalletModal provides those). */
export function WithdrawForm() {
  const close = useDepositUi((s) => s.close);
  const { data: wallet } = useWallet();
  const accountPhone = useSession((s) => s.user?.phone ?? null);
  const withdraw = useWithdraw();

  const [amount, setAmount] = useState('');
  const [editingPhone, setEditingPhone] = useState(false);
  const [phone, setPhone] = useState('');
  const [errors, setErrors] = useState<Record<string, string | undefined>>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [paid, setPaid] = useState(false);
  const [paidAmountKes, setPaidAmountKes] = useState(0);

  const realCents = wallet?.real ?? 0;
  const maxKes = Math.floor(centsToKes(realCents));
  const effectivePhone = editingPhone || !accountPhone ? phone : accountPhone;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setServerError(null);
    const kes = Number(amount);
    const next: Record<string, string | undefined> = {};
    if (!Number.isInteger(kes) || kes < MIN_KES) next['amount'] = `Minimum withdrawal is ${formatKes(MIN_WITHDRAWAL_CENTS)}.`;
    else if (kesToCents(kes) > realCents) next['amount'] = 'Amount exceeds your real balance.';
    try {
      normalizeMsisdn(effectivePhone);
    } catch {
      next['phone'] = 'Enter a valid Kenyan number, e.g. 0712 345 678.';
    }
    setErrors(next);
    if (Object.values(next).some(Boolean)) return;
    try {
      const res = await withdraw.mutateAsync({ amount: kesToCents(kes), phone: effectivePhone });
      setPaid(Boolean(res?.paid));
      setPaidAmountKes(kes);
      setDone(true);
    } catch (err) {
      setServerError(authErrorMessage(err));
    }
  }

  if (done) {
    return (
      <div className="flex flex-col gap-3 p-4">
        {paid ? (
          <p className="rounded-xl border border-up/40 bg-up/10 px-3 py-2 text-sm text-up">
            {formatKes(kesToCents(paidAmountKes))} sent to your M-Pesa. It reflects in your M-Pesa balance instantly.
          </p>
        ) : (
          <p className="rounded-xl border border-up/40 bg-up/10 px-3 py-2 text-sm text-up">
            Withdrawal requested. Funds are held and paid out to {maskMsisdn(normalizeMsisdn(effectivePhone))} after approval.
          </p>
        )}
        <Button fullWidth onClick={close}>Done</Button>
      </div>
    );
  }

  return (
    <form className="flex flex-col gap-4 p-4" onSubmit={onSubmit} noValidate>
      <div className="flex gap-2">
        {QUICK.map((q) => {
          const val = q.frac === 1 ? maxKes : Math.floor(maxKes * q.frac);
          const active = Number(amount) === val && val > 0;
          return (
            <button
              key={q.label}
              type="button"
              disabled={maxKes <= 0}
              onClick={() => { setAmount(String(val)); setErrors((p) => ({ ...p, amount: undefined })); }}
              className={[
                'flex-1 rounded-full border px-3 py-2 text-sm font-semibold transition disabled:opacity-40',
                active ? 'border-accent bg-accent text-accent-fg' : 'border-border bg-surface-2 text-fg hover:border-accent/60',
              ].join(' ')}
            >
              {q.label}
            </button>
          );
        })}
      </div>

      <Input
        label="Amount (KES)"
        name="amount"
        type="text"
        inputMode="numeric"
        autoComplete="off"
        required
        leading={<span className="text-sm font-semibold text-muted">KES</span>}
        value={grouped(amount)}
        onChange={(e) => setAmount(digitsOnly(e.target.value))}
        error={errors['amount']}
        hint={`Min ${formatKes(MIN_WITHDRAWAL_CENTS)} · Max ${formatKes(realCents)}`}
        className="text-lg font-semibold"
      />

      {accountPhone && !editingPhone ? (
        <div className="flex items-center justify-between rounded-xl border border-border bg-surface-2 px-3.5 py-3">
          <div>
            <div className="text-xs text-muted">M-Pesa number</div>
            <div className="text-sm font-medium text-fg">{maskMsisdn(accountPhone)}</div>
          </div>
          <button
            type="button"
            onClick={() => { setEditingPhone(true); setPhone(''); }}
            className="text-sm font-semibold text-accent hover:underline"
          >
            Change
          </button>
        </div>
      ) : (
        <Input
          label="M-Pesa number"
          name="phone"
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          required
          placeholder="0712 345 678"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          error={errors['phone']}
          {...(accountPhone ? { hint: 'Paying out to a different number than your account.' } : {})}
        />
      )}

      {serverError ? (
        <p className="rounded-xl border border-down/40 bg-down/10 px-3 py-2 text-sm text-down" role="alert">
          {serverError}
        </p>
      ) : null}

      <Button type="submit" size="lg" fullWidth disabled={withdraw.isPending}>
        {withdraw.isPending ? 'Requesting…' : 'Withdraw'}
      </Button>
    </form>
  );
}
