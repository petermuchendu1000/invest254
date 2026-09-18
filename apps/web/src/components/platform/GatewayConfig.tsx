'use client';

import { useMemo, useState } from 'react';
import { useGatewayConfigs, useSaveGatewayConfig, useTestGatewayConfig } from '@/lib/platform/hooks';
import type { GatewayConfigEntryDto, GatewayFieldDto, ConnResultDto } from '@/lib/platform/endpoints';

/**
 * Superadmin CONFIGURATION for each deposit gateway (migration 0130): credentials + settings, edited
 * from dedicated per-gateway forms. Secrets are encrypted at rest and only ever shown as a masked
 * last-4 hint — the browser never receives a stored secret. "Test connection" runs a SAFE read-only
 * probe (never moves money) before you commit a change. This complements the on/off switches above.
 */
export function GatewayConfigSection() {
  const { data, isLoading } = useGatewayConfigs();
  if (isLoading) return <p className="text-sm text-muted">Loading gateway configuration…</p>;
  const providers = data?.providers ?? [];
  return (
    <section className="flex flex-col gap-4 rounded-2xl border border-border bg-surface-2 p-5">
      <div>
        <h2 className="text-base font-semibold text-fg">Gateway configuration</h2>
        <p className="mt-1 text-sm text-muted">
          Configure each payment gateway’s credentials and settings. Secrets are{' '}
          <span className="font-medium text-fg">encrypted at rest</span> and shown only as a masked hint. Use{' '}
          <span className="font-medium text-fg">Test connection</span> to verify credentials safely — it never moves money.
        </p>
      </div>
      <div className="flex flex-col gap-3">
        {providers.map((p) => <GatewayCard key={p.code} entry={p} />)}
      </div>
    </section>
  );
}

const STATUS_STYLES: Record<ConnResultDto['status'], string> = {
  valid: 'bg-emerald-500/15 text-emerald-500 border-emerald-500/30',
  invalid: 'bg-red-500/15 text-red-500 border-red-500/30',
  unreachable: 'bg-amber-500/15 text-amber-500 border-amber-500/30',
  not_configured: 'bg-border/40 text-muted border-border',
};
const STATUS_LABEL: Record<ConnResultDto['status'], string> = {
  valid: 'Connection valid', invalid: 'Rejected', unreachable: 'Unreachable', not_configured: 'Incomplete',
};

function GatewayCard({ entry }: { entry: GatewayConfigEntryDto }) {
  const { schema, config } = entry;
  const save = useSaveGatewayConfig();
  const test = useTestGatewayConfig();
  const [open, setOpen] = useState(false);

  // Form state seeded from stored non-secret settings; secrets are NEVER prefilled (blank = keep on save).
  const initial = useMemo(() => {
    const v: Record<string, string> = {};
    for (const f of schema.fields) v[f.key] = f.secret ? '' : (config.settings[f.key] ?? f.default ?? '');
    return v;
  }, [schema, config]);
  const [values, setValues] = useState<Record<string, string>>(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState(false);
  const [result, setResult] = useState<ConnResultDto | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);

  const set = (k: string, val: string) => { setValues((s) => ({ ...s, [k]: val })); setSaved(false); setResult(null); setErrors((e) => ({ ...e, [k]: '' })); };

  /** Client-side mirror of the backend schema validation (backend re-validates as the source of truth). */
  function validate(): Record<string, string> {
    const errs: Record<string, string> = {};
    const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/; const urlRe = /^https?:\/\/[^\s]+$/;
    for (const f of schema.fields) {
      const raw = (values[f.key] ?? '').trim();
      const onFile = f.secret && config.secretMeta[f.key]?.set;
      if (f.required && !raw && !onFile) { errs[f.key] = `${f.label} is required`; continue; }
      if (!raw) continue;
      if (f.kind === 'email' && !emailRe.test(raw)) errs[f.key] = `${f.label} must be a valid email`;
      if (f.kind === 'url' && !urlRe.test(raw)) errs[f.key] = `${f.label} must be a valid https URL`;
      if (f.kind === 'select' && f.options && !f.options.some((o) => o.value === raw)) errs[f.key] = `${f.label} is invalid`;
      if (f.pattern && !new RegExp(f.pattern).test(raw)) errs[f.key] = `${f.label} has an unexpected format`;
    }
    return errs;
  }

  /** Build the submit payload: all settings + only the secret fields the admin actually typed. */
  function payload(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const f of schema.fields) {
      const raw = values[f.key] ?? '';
      if (f.secret) { if (raw.trim() !== '') out[f.key] = raw.trim(); }
      else out[f.key] = raw.trim();
    }
    return out;
  }

  async function onSave() {
    setServerError(null); setResult(null);
    const errs = validate();
    setErrors(errs);
    if (Object.keys(errs).some((k) => errs[k])) return;
    try { await save.mutateAsync({ code: schema.code, values: payload() }); setSaved(true); }
    catch (e) { setServerError((e as Error).message || 'Save failed'); }
  }
  async function onTest() {
    setServerError(null); setSaved(false);
    try { const r = await test.mutateAsync({ code: schema.code, draft: payload() }); setResult(r.result); }
    catch (e) { setServerError((e as Error).message || 'Test failed'); }
  }

  const configuredCount = Object.values(config.secretMeta).filter((m) => m?.set).length;
  const statusLabel = config.exists ? (config.hasSecret ? 'Configured' : 'Settings only') : 'Not configured';

  return (
    <div className="rounded-xl border border-border bg-surface">
      {/* Card header (always visible) */}
      <button type="button" onClick={() => setOpen((o) => !o)} className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-fg">{schema.displayName}</span>
            <span className={['rounded-full border px-2 py-0.5 text-[11px] font-medium',
              config.exists ? 'border-accent/30 bg-accent/10 text-accent' : 'border-border text-muted'].join(' ')}>{statusLabel}</span>
          </div>
          <div className="mt-0.5 truncate text-xs text-muted">{schema.blurb}</div>
        </div>
        <svg className={['h-4 w-4 shrink-0 text-muted transition-transform', open ? 'rotate-180' : ''].join(' ')} viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.17l3.71-3.94a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clipRule="evenodd" /></svg>
      </button>

      {open && (
        <div className="flex flex-col gap-4 border-t border-border px-4 py-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {schema.fields.map((f) => (
              <Field key={f.key} field={f} value={values[f.key] ?? ''} error={errors[f.key]}
                storedHint={f.secret ? config.secretMeta[f.key] : undefined} onChange={(v) => set(f.key, v)} />
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={onSave} disabled={save.isPending}
              className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-accent-fg transition hover:opacity-90 disabled:opacity-50">
              {save.isPending ? 'Saving…' : 'Save configuration'}
            </button>
            <button type="button" onClick={onTest} disabled={test.isPending}
              className="rounded-lg border border-border px-4 py-2 text-sm font-semibold text-fg transition hover:bg-surface-2 disabled:opacity-50">
              {test.isPending ? 'Testing…' : 'Test connection'}
            </button>
            {saved && <span className="text-xs font-medium text-emerald-500">✓ Saved &amp; encrypted</span>}
            <span className="ml-auto text-[11px] text-muted">
              {configuredCount > 0 ? `${configuredCount} secret${configuredCount > 1 ? 's' : ''} on file` : 'No secrets stored'}
              {config.updatedAt ? ` · updated ${new Date(config.updatedAt).toLocaleDateString()}` : ''}
            </span>
          </div>

          {result && (
            <div className={['flex items-start gap-2 rounded-lg border px-3 py-2 text-xs', STATUS_STYLES[result.status]].join(' ')}>
              <span className="font-semibold">{STATUS_LABEL[result.status]}:</span>
              <span className="min-w-0">{result.detail}</span>
            </div>
          )}
          {serverError && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-500">{serverError}</div>
          )}

          <p className="text-[11px] text-muted">
            Secrets are encrypted with AES-256-GCM before storage — leave a secret field blank to keep the current value.{' '}
            <a href={schema.docsUrl} target="_blank" rel="noreferrer" className="text-accent hover:underline">{schema.displayName} docs ↗</a>
          </p>
        </div>
      )}
    </div>
  );
}

function Field({ field, value, error, storedHint, onChange }: {
  field: GatewayFieldDto; value: string; error?: string | undefined;
  storedHint?: { set: boolean; last4: string } | undefined; onChange: (v: string) => void;
}) {
  const base = 'rounded-lg border bg-surface px-3 py-2 text-sm text-fg outline-none focus:border-accent ' + (error ? 'border-red-500/60' : 'border-border');
  const secretSet = field.secret && storedHint?.set;
  const placeholder = secretSet ? `•••••••• ${storedHint?.last4 ?? ''} (leave blank to keep)` : (field.placeholder ?? '');
  return (
    <label className={['flex flex-col gap-1 text-xs text-muted', field.kind === 'select' ? '' : ''].join(' ')}>
      <span className="flex items-center gap-1">
        {field.label}{field.required && <span className="text-red-500">*</span>}
        {field.secret && <span className="rounded bg-border/50 px-1 text-[10px] uppercase tracking-wide text-muted">secret</span>}
      </span>
      {field.kind === 'select' ? (
        <select value={value} onChange={(e) => onChange(e.target.value)} className={base}>
          {field.options?.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      ) : (
        <input
          type={field.secret ? 'password' : 'text'} autoComplete={field.secret ? 'new-password' : 'off'}
          value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className={base} />
      )}
      {error ? <span className="text-[11px] text-red-500">{error}</span>
        : field.help ? <span className="text-[11px] text-muted">{field.help}</span> : null}
    </label>
  );
}
