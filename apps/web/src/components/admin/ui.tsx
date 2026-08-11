import * as React from 'react';
import { cn } from '@/lib/cn';
import { Button } from '@/components/ui/Button';
import { Money } from '@/components/ui/Money';

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div className="flex flex-col gap-0.5">
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        {subtitle ? <p className="text-sm text-muted">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </div>
  );
}

/** Compact KPI tile. Pass either `value` (string) or `money` (cents). */
export function StatCard({
  label,
  value,
  money,
  hint,
  tone,
}: {
  label: string;
  value?: string | number;
  money?: number;
  hint?: string;
  tone?: 'default' | 'up' | 'down' | 'warn';
}) {
  const toneCls =
    tone === 'up' ? 'text-up' : tone === 'down' ? 'text-down' : tone === 'warn' ? 'text-warn' : 'text-fg';
  return (
    <div className="flex flex-col gap-1 rounded-2xl border border-border bg-surface p-4">
      <span className="text-xs uppercase tracking-wide text-muted">{label}</span>
      <span className={cn('text-2xl font-bold tabular-nums', toneCls)}>
        {money !== undefined ? <Money cents={money} /> : value}
      </span>
      {hint ? <span className="text-xs text-muted">{hint}</span> : null}
    </div>
  );
}

export function Section({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      {title ? <h2 className="text-sm font-semibold tracking-tight">{title}</h2> : null}
      {children}
    </section>
  );
}

/** Horizontally scrollable table wrapper (uses the global .table-wrapper class). */
export function TableWrap({ children }: { children: React.ReactNode }) {
  return (
    <div className="table-wrapper overflow-x-auto rounded-2xl border border-border bg-surface">
      <table className="w-full min-w-[640px] text-sm">{children}</table>
    </div>
  );
}
export function Th({ children, className }: { children?: React.ReactNode; className?: string }) {
  return (
    <th className={cn('px-3 py-2.5 text-left text-xs font-medium uppercase tracking-wide text-muted', className)}>
      {children}
    </th>
  );
}
export function Td({ children, className }: { children?: React.ReactNode; className?: string }) {
  return <td className={cn('px-3 py-2.5 align-middle', className)}>{children}</td>;
}

export function Toolbar({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-wrap items-center gap-2">{children}</div>;
}

/** Small select used for table filters. */
export function FilterSelect({
  value,
  onChange,
  options,
  label,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  label?: string;
}) {
  return (
    <label className="flex items-center gap-1.5 text-xs text-muted">
      {label ? <span>{label}</span> : null}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-9 rounded-lg border border-border bg-surface-2 px-2 text-sm text-fg outline-none focus:border-accent"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export function Empty({ title, description }: { title: string; description?: string }) {
  return (
    <div className="flex flex-col items-center gap-1 rounded-2xl border border-dashed border-border p-8 text-center">
      <p className="text-sm font-medium text-fg">{title}</p>
      {description ? <p className="text-sm text-muted">{description}</p> : null}
    </div>
  );
}

/** Two-step inline confirm for irreversible/visible actions (approve/reject, etc.). */
export function ConfirmButton({
  label,
  confirmLabel,
  onConfirm,
  variant = 'primary',
  size = 'sm',
  busy,
  disabled,
}: {
  label: string;
  confirmLabel?: string;
  onConfirm: () => void;
  variant?: React.ComponentProps<typeof Button>['variant'];
  size?: React.ComponentProps<typeof Button>['size'];
  busy?: boolean;
  disabled?: boolean;
}) {
  const [armed, setArmed] = React.useState(false);
  React.useEffect(() => {
    if (!armed) return;
    const id = setTimeout(() => setArmed(false), 4000);
    return () => clearTimeout(id);
  }, [armed]);

  if (armed) {
    return (
      <span className="inline-flex items-center gap-1">
        <Button
          size={size}
          variant={variant}
          disabled={busy}
          onClick={() => {
            setArmed(false);
            onConfirm();
          }}
        >
          {busy ? '…' : confirmLabel ?? `Confirm ${label.toLowerCase()}`}
        </Button>
        <Button size={size} variant="ghost" onClick={() => setArmed(false)} disabled={busy}>
          Cancel
        </Button>
      </span>
    );
  }
  return (
    <Button size={size} variant={variant} onClick={() => setArmed(true)} disabled={disabled || busy}>
      {label}
    </Button>
  );
}
