'use client';

import { cn } from '@/lib/cn';
import { Modal } from '@/components/ui/Modal';
import { Money } from '@/components/ui/Money';
import { Skeleton } from '@/components/ui/Skeleton';
import { Button } from '@/components/ui/Button';
import { formatDateTime } from '@/lib/format';
import { usePositionDetail } from '@/lib/positions/hooks';

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1.5 text-sm">
      <span className="text-muted">{label}</span>
      <span className="text-right font-medium text-fg">{children}</span>
    </div>
  );
}

export function PositionDetailModal({ id, onClose }: { id: string | null; onClose: () => void }) {
  const { data, isLoading, isError } = usePositionDetail(id);

  return (
    <Modal open={!!id} onClose={onClose} title="Position detail">
      <div className="flex items-center justify-between border-b border-border p-4">
        <h2 className="text-base font-semibold">Position detail</h2>
        <button type="button" onClick={onClose} className="text-sm text-muted hover:text-fg">
          Close
        </button>
      </div>

      <div className="flex flex-col gap-1 p-4">
        {isLoading ? (
          <Skeleton className="h-48 w-full rounded-xl" />
        ) : isError || !data ? (
          <p className="text-sm text-down">Couldn&apos;t load this position.</p>
        ) : (
          <>
            <Row label="Direction">
              <span className={cn('uppercase', data.direction === 'buy' ? 'text-up' : 'text-down')}>
                {data.direction}
              </span>
            </Row>
            <Row label="Status">
              <span className="capitalize">{data.status}</span>
            </Row>
            {data.result ? (
              <Row label="Result">
                <span className={cn('capitalize', data.result === 'win' ? 'text-up' : 'text-down')}>
                  {data.result}
                  {data.multiplier ? ` · ×${data.multiplier.toFixed(2)}` : ''}
                </span>
              </Row>
            ) : null}
            <Row label="Stake">
              <Money cents={data.stakeCents} />
            </Row>
            {data.payoutCents !== null ? (
              <Row label="Payout">
                <Money cents={data.payoutCents} />
              </Row>
            ) : null}
            {data.pnlCents !== null ? (
              <Row label="P&L">
                <Money
                  cents={data.pnlCents}
                  className={data.pnlCents >= 0 ? 'text-up' : 'text-down'}
                />
              </Row>
            ) : null}
            <Row label="Entry rate">{data.entryRate.toFixed(5)}</Row>
            {data.exitRate !== null ? <Row label="Exit rate">{data.exitRate.toFixed(5)}</Row> : null}
            <Row label="Duration">{data.durationS}s</Row>
            <Row label="Opened">{formatDateTime(data.openedAt)}</Row>
            {data.settledAt !== null ? <Row label="Settled">{formatDateTime(data.settledAt)}</Row> : null}

            <div className="mt-3 rounded-xl border border-border bg-surface-2/40 p-3">
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">
                Provable fairness
              </p>
              {data.fairness ? (
                <div className="flex flex-col gap-1">
                  <Row label="Trade date">{data.fairness.tradeDate}</Row>
                  <div className="py-1.5 text-sm">
                    <span className="text-muted">Server seed hash</span>
                    <p className="mt-0.5 break-all font-mono text-[11px] text-fg">
                      {data.fairness.serverSeedHash}
                    </p>
                  </div>
                  <div className="py-1.5 text-sm">
                    <span className="text-muted">Server seed</span>
                    {data.fairness.serverSeed ? (
                      <p className="mt-0.5 break-all font-mono text-[11px] text-fg">
                        {data.fairness.serverSeed}
                      </p>
                    ) : (
                      <p className="mt-0.5 text-xs text-muted">
                        Revealed after the trading day rotates.
                      </p>
                    )}
                  </div>
                </div>
              ) : (
                <p className="text-xs text-muted">No fairness record for this position.</p>
              )}
            </div>

            <Button variant="secondary" fullWidth className="mt-4" onClick={onClose}>
              Done
            </Button>
          </>
        )}
      </div>
    </Modal>
  );
}
