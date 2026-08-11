'use client';

import * as React from 'react';

export type Point = { label: string; value: number };

/** Compact KES from integer cents: 12 345 600 → "KES 123K". */
export function kesCompact(cents: number): string {
  const kes = cents / 100;
  const abs = Math.abs(kes);
  const sign = kes < 0 ? '-' : '';
  if (abs >= 1_000_000) return `${sign}KES ${(abs / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 1)}M`;
  if (abs >= 1_000) return `${sign}KES ${(abs / 1_000).toFixed(abs >= 10_000 ? 0 : 1)}K`;
  return `${sign}KES ${abs.toFixed(0)}`;
}

const VB_W = 300;
const VB_H = 96;
const PAD = 4;

/** Build (x,y) screen coords for a series, mapping value range (incl. 0 baseline) to the plot box. */
function project(points: Point[]) {
  const n = points.length;
  const values = points.map((p) => p.value);
  let min = Math.min(0, ...values);
  let max = Math.max(0, ...values);
  if (min === max) max = min + 1; // avoid divide-by-zero on flat/empty series
  const span = max - min;
  const x = (i: number) => (n <= 1 ? VB_W / 2 : PAD + (i / (n - 1)) * (VB_W - 2 * PAD));
  const y = (v: number) => VB_H - PAD - ((v - min) / span) * (VB_H - 2 * PAD);
  return { x, y, min, max, zeroY: y(0) };
}

/** Filled line/area chart. Tone drives the accent color via Tailwind stroke/fill classes. */
export function AreaChart({ points, tone = 'accent' }: { points: Point[]; tone?: 'accent' | 'up' | 'down' }) {
  if (points.length === 0) return <div className="h-24 w-full" />;
  const { x, y, zeroY } = project(points);
  const line = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${x(i).toFixed(2)} ${y(p.value).toFixed(2)}`).join(' ');
  const area = `${line} L ${x(points.length - 1).toFixed(2)} ${zeroY.toFixed(2)} L ${x(0).toFixed(2)} ${zeroY.toFixed(2)} Z`;
  const stroke = tone === 'up' ? 'stroke-up' : tone === 'down' ? 'stroke-down' : 'stroke-accent';
  const fill = tone === 'up' ? 'fill-up/10' : tone === 'down' ? 'fill-down/10' : 'fill-accent/10';
  return (
    <svg viewBox={`0 0 ${VB_W} ${VB_H}`} preserveAspectRatio="none" className="h-24 w-full" role="img">
      <line x1={PAD} x2={VB_W - PAD} y1={zeroY} y2={zeroY} className="stroke-border" strokeWidth={0.5} strokeDasharray="2 2" />
      <path d={area} className={fill} stroke="none" />
      <path d={line} className={stroke} fill="none" strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

/** Two-series grouped bars (e.g. deposits vs withdrawals) sharing one scale. */
export function GroupedBars({ a, b }: { a: { label: string; points: Point[]; tone: 'up' | 'down' | 'accent' }; b: { label: string; points: Point[]; tone: 'up' | 'down' | 'accent' } }) {
  const n = Math.max(a.points.length, b.points.length);
  if (n === 0) return <div className="h-24 w-full" />;
  const max = Math.max(1, ...a.points.map((p) => p.value), ...b.points.map((p) => p.value));
  const slot = (VB_W - 2 * PAD) / n;
  const bw = Math.min(slot * 0.38, 10);
  const fillOf = (t: string) => (t === 'up' ? 'fill-up' : t === 'down' ? 'fill-down' : 'fill-accent');
  const barY = (v: number) => VB_H - PAD - (v / max) * (VB_H - 2 * PAD);
  return (
    <svg viewBox={`0 0 ${VB_W} ${VB_H}`} preserveAspectRatio="none" className="h-24 w-full" role="img">
      {Array.from({ length: n }).map((_, i) => {
        const cx = PAD + slot * (i + 0.5);
        const av = a.points[i]?.value ?? 0;
        const bv = b.points[i]?.value ?? 0;
        return (
          <g key={i}>
            <rect x={cx - bw - 0.5} y={barY(av)} width={bw} height={Math.max(0, VB_H - PAD - barY(av))} className={fillOf(a.tone)} rx={0.5} />
            <rect x={cx + 0.5} y={barY(bv)} width={bw} height={Math.max(0, VB_H - PAD - barY(bv))} className={fillOf(b.tone)} rx={0.5} />
          </g>
        );
      })}
    </svg>
  );
}

/** Card frame for a chart: title, latest/summary readout, legend, and the plot. */
export function ChartCard({
  title,
  readout,
  legend,
  children,
}: {
  title: string;
  readout?: string;
  legend?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2 rounded-2xl border border-border bg-surface p-4">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs uppercase tracking-wide text-muted">{title}</span>
        {readout ? <span className="text-sm font-semibold tabular-nums">{readout}</span> : null}
      </div>
      {children}
      {legend ? <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">{legend}</div> : null}
    </div>
  );
}

export function LegendDot({ tone, label }: { tone: 'up' | 'down' | 'accent'; label: string }) {
  const bg = tone === 'up' ? 'bg-up' : tone === 'down' ? 'bg-down' : 'bg-accent';
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`h-2 w-2 rounded-full ${bg}`} />
      {label}
    </span>
  );
}
