'use client';

import { useEffect, useRef } from 'react';
import type { IChartApi, ISeriesApi, UTCTimestamp, CandlestickData } from 'lightweight-charts';
import { aggregateCandles, upsertCandle, type Candle } from '@invest254/shared/chart';
import type { Tick } from '@/lib/game/types';

/**
 * Candlestick renderer — the per-brand alternative to the line/area `CurveCanvas` (migration 0111,
 * `sites.chart_style = 'candlestick'`). Drop-in: identical props, identical mount, so `GameCurve`
 * swaps the two purely on brand config with no other change.
 *
 * It consumes the SAME authoritative engine tick stream (`getTicks`/`getLastTick`) — the candles are
 * built from our own price, so the chart can never desync from the game outcome (unlike embedding a
 * real-symbol TradingView widget). Ticks are folded into fixed OHLC buckets by the pure, unit-tested
 * `@invest254/shared/chart` helpers; TradingView Lightweight Charts (v5) draws them.
 *
 * Lightweight Charts is imported dynamically inside the effect so it never executes during SSR
 * (it touches `window`); the type-only import above is erased at build and is SSR-safe.
 */

/** OHLC bucket width. Multiple of 1000ms so candle times are unique whole seconds (chart requirement). */
const BUCKET_MS = 2000;

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
  const windowRef = useRef(windowMs);
  windowRef.current = windowMs;

  useEffect(() => {
    let disposed = false;
    let raf = 0;
    let chart: IChartApi | null = null;
    let series: ISeriesApi<'Candlestick'> | null = null;
    const candles: Candle[] = [];

    (async () => {
      const { createChart, CandlestickSeries, ColorType, CrosshairMode } = await import('lightweight-charts');
      const host = hostRef.current;
      if (disposed || !host) return;

      const cs = getComputedStyle(document.documentElement);
      const up = readVar(cs, '--pp-up', '#16C784');
      const down = readVar(cs, '--pp-down', '#EA3943');
      const bg = readVar(cs, '--pp-surface', readVar(cs, '--pp-bg', '#0B0E11'));
      const text = readVar(cs, '--pp-muted', '#8B97A7');
      const border = readVar(cs, '--pp-border', '#2A323D');

      chart = createChart(host, {
        autoSize: true, // resizes with the flex container — no manual ResizeObserver needed
        layout: { background: { type: ColorType.Solid, color: bg }, textColor: text, attributionLogo: false },
        grid: { vertLines: { color: border }, horzLines: { color: border } },
        rightPriceScale: { borderColor: border },
        timeScale: { borderColor: border, timeVisible: true, secondsVisible: true, rightOffset: 3 },
        crosshair: { mode: CrosshairMode.Normal },
        handleScroll: false, // it's a live game curve, not a chart to pan/zoom
        handleScale: false,
      });
      series = chart.addSeries(CandlestickSeries, {
        upColor: up, downColor: down, borderVisible: false, wickUpColor: up, wickDownColor: down,
      });

      // Seed from the existing tick history, then track live.
      const seeded = aggregateCandles(getTicks(), BUCKET_MS);
      candles.push(...seeded);
      series.setData(candles as unknown as CandlestickData[]);
      chart.timeScale().fitContent();

      const loop = () => {
        if (disposed || !series) return;
        const last = getLastTick();
        if (last) {
          const c = upsertCandle(candles, last, BUCKET_MS);
          series.update({ time: c.time as UTCTimestamp, open: c.open, high: c.high, low: c.low, close: c.close });
          // Keep only the trailing window on screen (a couple of buckets of lead room).
          const visible = Math.max(10, Math.ceil(windowRef.current / BUCKET_MS));
          if (candles.length > visible + 2) {
            const from = candles[candles.length - visible]!.time as UTCTimestamp;
            const to = (candles[candles.length - 1]!.time + BUCKET_MS / 1000) as UTCTimestamp;
            chart!.timeScale().setVisibleRange({ from, to });
          }
        }
        raf = requestAnimationFrame(loop);
      };
      raf = requestAnimationFrame(loop);
    })();

    return () => {
      disposed = true;
      if (raf) cancelAnimationFrame(raf);
      if (chart) chart.remove();
      chart = null;
      series = null;
    };
  }, [getTicks, getLastTick]);

  return <div ref={hostRef} className="h-full w-full" aria-label="Live price candlesticks" role="img" />;
}
