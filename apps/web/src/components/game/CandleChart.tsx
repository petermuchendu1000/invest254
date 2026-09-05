'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { IChartApi, ISeriesApi, UTCTimestamp, CandlestickData } from 'lightweight-charts';
import { aggregateCandles, upsertCandle, type Candle } from '@invest254/shared/chart';
import type { Tick } from '@/lib/game/types';
import { cn } from '@/lib/cn';

/**
 * Candlestick renderer — the per-brand alternative to the line/area `CurveCanvas` (migration 0111,
 * `sites.chart_style = 'candlestick'`). Drop-in: identical props and mount, so `GameCurve` swaps the
 * two purely on brand config.
 *
 * It consumes the SAME authoritative engine tick stream (`getTicks`/`getLastTick`) — candles are built
 * from our own price via the pure, unit-tested `@invest254/shared/chart` helpers, so the chart can
 * never desync from the game outcome. TradingView Lightweight Charts (v5) draws them and provides the
 * exchange-grade interaction: wheel/pinch zoom, drag to pan, crosshair, price/time scales.
 *
 * Interaction model (TradingView-like):
 *  - Auto-follows the live edge. Any manual interaction (wheel, drag, pinch, −/+ buttons while
 *    detached) pauses following; the "Live" button snaps back to the tape.
 *  - Timeframe pills change the candle interval (1s…10s) by re-aggregating the tick history.
 *  - −/+ change how many bars are visible (zoom) — while following, the view stays glued to the
 *    live edge at the new zoom.
 *
 * Lightweight Charts is imported dynamically inside the effect so it never executes during SSR.
 */

/** Candle intervals offered in the toolbar (ms). Multiples of 1000 so bar times are unique seconds. */
const INTERVALS: ReadonlyArray<{ ms: number; label: string }> = [
  { ms: 1000, label: '1s' },
  { ms: 2000, label: '2s' },
  { ms: 5000, label: '5s' },
  { ms: 10_000, label: '10s' },
];
const DEFAULT_INTERVAL_MS = 2000;
const MIN_BARS = 8;
const MAX_BARS = 600;
const ZOOM_STEP = 0.7; // −/+ multiply/divide the visible bar count by this
const RIGHT_OFFSET_BARS = 3;

function readVar(cs: CSSStyleDeclaration, name: string, fallback: string): string {
  return cs.getPropertyValue(name).trim() || fallback;
}

export function CandleChart({
  getTicks,
  getLastTick,
  windowMs,
}: {
  getTicks: () => Tick[];
  getLastTick: () => Tick | null;
  windowMs: number;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const candlesRef = useRef<Candle[]>([]);
  const [intervalMs, setIntervalMs] = useState(DEFAULT_INTERVAL_MS);
  const [following, setFollowing] = useState(true);
  const followingRef = useRef(true);
  const visibleBarsRef = useRef(Math.max(MIN_BARS, Math.ceil(windowMs / DEFAULT_INTERVAL_MS)));

  const setFollow = useCallback((v: boolean) => {
    followingRef.current = v;
    setFollowing(v);
  }, []);

  /** Snap the visible range to the live edge at the current zoom. */
  const snapToLive = useCallback(() => {
    const chart = chartRef.current;
    const n = candlesRef.current.length;
    if (!chart || n === 0) return;
    const bars = visibleBarsRef.current;
    chart.timeScale().setVisibleLogicalRange({ from: n - 1 - bars, to: n - 1 + RIGHT_OFFSET_BARS });
  }, []);

  const zoom = useCallback((dir: 'in' | 'out') => {
    const next = dir === 'in' ? visibleBarsRef.current * ZOOM_STEP : visibleBarsRef.current / ZOOM_STEP;
    visibleBarsRef.current = Math.min(MAX_BARS, Math.max(MIN_BARS, Math.round(next)));
    const chart = chartRef.current;
    if (!chart) return;
    if (followingRef.current) {
      snapToLive();
    } else {
      // Detached: zoom around the current right edge so the user keeps their place.
      const r = chart.timeScale().getVisibleLogicalRange();
      if (r) chart.timeScale().setVisibleLogicalRange({ from: r.to - visibleBarsRef.current, to: r.to });
    }
  }, [snapToLive]);

  // Build (and rebuild on interval change) the chart from the tick history, then track live ticks.
  useEffect(() => {
    let disposed = false;
    let raf = 0;
    const host = hostRef.current;
    if (!host) return;

    // Any direct manipulation of the chart detaches auto-follow (TradingView behaviour).
    const detach = () => setFollow(false);
    host.addEventListener('wheel', detach, { passive: true });
    host.addEventListener('pointerdown', detach);
    host.addEventListener('touchstart', detach, { passive: true });

    (async () => {
      const { createChart, CandlestickSeries, ColorType, CrosshairMode } = await import('lightweight-charts');
      if (disposed) return;

      const cs = getComputedStyle(document.documentElement);
      const up = readVar(cs, '--pp-up', '#16C784');
      const down = readVar(cs, '--pp-down', '#EA3943');
      const bg = readVar(cs, '--pp-surface', readVar(cs, '--pp-bg', '#0B0E11'));
      const text = readVar(cs, '--pp-muted', '#8B97A7');
      const border = readVar(cs, '--pp-border', '#2A323D');

      const chart = createChart(host, {
        autoSize: true,
        layout: { background: { type: ColorType.Solid, color: bg }, textColor: text, fontSize: 10 },
        grid: { vertLines: { color: border }, horzLines: { color: border } },
        rightPriceScale: { borderColor: border, scaleMargins: { top: 0.12, bottom: 0.12 } },
        timeScale: { borderColor: border, timeVisible: true, secondsVisible: true, rightOffset: RIGHT_OFFSET_BARS, barSpacing: 6 },
        crosshair: { mode: CrosshairMode.Normal },
        handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false },
        handleScale: { mouseWheel: true, pinch: true, axisPressedMouseMove: { time: true, price: false } },
      });
      const series = chart.addSeries(CandlestickSeries, {
        upColor: up, downColor: down, borderVisible: false, wickUpColor: up, wickDownColor: down,
      });
      chartRef.current = chart;
      seriesRef.current = series;

      // Seed from history at this interval, then follow the live edge.
      const seeded = aggregateCandles(getTicks(), intervalMs);
      candlesRef.current = seeded;
      series.setData(seeded as unknown as CandlestickData[]);
      visibleBarsRef.current = Math.min(MAX_BARS, Math.max(MIN_BARS, Math.ceil(windowMs / intervalMs)));
      setFollow(true);
      snapToLive();

      const loop = () => {
        if (disposed) return;
        const last = getLastTick();
        if (last && seriesRef.current) {
          const c = upsertCandle(candlesRef.current, last, intervalMs);
          seriesRef.current.update({ time: c.time as UTCTimestamp, open: c.open, high: c.high, low: c.low, close: c.close });
          if (followingRef.current) snapToLive();
        }
        raf = requestAnimationFrame(loop);
      };
      raf = requestAnimationFrame(loop);
    })();

    return () => {
      disposed = true;
      if (raf) cancelAnimationFrame(raf);
      host.removeEventListener('wheel', detach);
      host.removeEventListener('pointerdown', detach);
      host.removeEventListener('touchstart', detach);
      chartRef.current?.remove();
      chartRef.current = null;
      seriesRef.current = null;
      candlesRef.current = [];
    };
  }, [getTicks, getLastTick, intervalMs, windowMs, setFollow, snapToLive]);

  const pill = 'h-6 min-w-[1.75rem] rounded-md border px-1.5 text-[10px] font-semibold leading-none transition';
  const idle = 'border-border bg-surface/80 text-muted hover:text-fg backdrop-blur';
  const active = 'border-accent bg-accent/15 text-accent';

  return (
    <div className="relative h-full w-full">
      <div ref={hostRef} className="h-full w-full" aria-label="Live price candlesticks" role="img" />

      {/* Toolbar — TradingView-style: interval pills left, zoom + Live right. Overlaid so it costs no height. */}
      <div className="pointer-events-none absolute inset-x-1.5 top-1.5 flex items-start justify-between gap-2">
        <div className="pointer-events-auto flex items-center gap-1" role="group" aria-label="Candle interval">
          {INTERVALS.map((iv) => (
            <button
              key={iv.ms}
              type="button"
              onClick={() => setIntervalMs(iv.ms)}
              aria-pressed={intervalMs === iv.ms}
              className={cn(pill, intervalMs === iv.ms ? active : idle)}
            >
              {iv.label}
            </button>
          ))}
        </div>
        <div className="pointer-events-auto flex items-center gap-1" role="group" aria-label="Zoom">
          <button type="button" onClick={() => zoom('out')} aria-label="Zoom out" className={cn(pill, idle, 'text-sm')}>−</button>
          <button type="button" onClick={() => zoom('in')} aria-label="Zoom in" className={cn(pill, idle, 'text-sm')}>+</button>
          <button
            type="button"
            onClick={() => { setFollow(true); snapToLive(); }}
            aria-pressed={following}
            className={cn(pill, following ? active : idle, 'px-2')}
            title="Follow the live price"
          >
            {following ? '● Live' : 'Live'}
          </button>
        </div>
      </div>
    </div>
  );
}
