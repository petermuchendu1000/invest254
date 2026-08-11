import { cn } from '@/lib/cn';

export function StatusBadge({ status }: { status: string }) {
  const s = status.toLowerCase();
  const tone = /success|paid|credited|complete|approved|settled/.test(s)
    ? 'bg-up/15 text-up'
    : /fail|reject|revers|cancel|error|void/.test(s)
      ? 'bg-down/15 text-down'
      : 'bg-surface-2 text-muted';
  return (
    <span className={cn('inline-block rounded-full px-2 py-0.5 text-xs font-medium capitalize', tone)}>
      {status.replace(/_/g, ' ')}
    </span>
  );
}
