'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { IChartApi, ISeriesApi, UTCTimestamp, CandlestickData, LineData, Time } from 'lightweight-charts';
import { aggregateCandles, upsertCandle, sma, bollinger, type Candle } from '@invest254/shared/chart';
import type { Tick } from '@/lib/game/types';
import { cn } from '@/lib/cn';

/**
 * Candlestick renderer — the per-brand alternative to the line/area `CurveCanvas` (migration 0111).
 * Drop-in with `CurveCanvas`: identical props/mount, so `GameCurve` swaps purely on brand config.
 *
 * Consumes the SAME authoritative engine tick stream (`getTicks`/`getLastTick`); candles are folded
 * from our own price via the pure, unit-tested `@invest254/shared/chart` helpers, so the chart can
 * never desync from the settled game price. TradingView Lightweight Charts (v5) draws it and gives
 * the exchange-grade interaction + analysis tools:
 *   - wheel/pinch zoom, drag-to-pan, crosshair; auto-follow with a "Live" snap-back
 *   - timeframe pills (1s…10s) re-aggregate the tick history
 *   - overlays: MA(7), MA(25), Bollinger(20,2) — computed from the real price, toggleable
 *   - OHLC legend that tracks the crosshair (or the live bar)
 *   - LOCAL-time axis + crosshair (viewer's timezone), not UTC
 *
 * Lightweight Charts is imported dynamically inside the effect so it never runs during SSR.
 */

const INTERVALS: ReadonlyArray<{ ms: number; label: string }> = [
  { ms: 1000, label: '1s' }, { ms: 2000, label: '2s' }, { ms: 5000, label: '5s' }, { ms: 10_000, label: '10s' },
];
const DEFAULT_INTERVAL_MS = 2000;
const MIN_BARS = 8, MAX_BARS = 600, ZOOM_STEP = 0.7, RIGHT_OFFSET_BARS = 3;
const MA_FAST = 7, MA_SLOW = 25, BB_PERIOD = 20, BB_MULT = 2;

const readVar = (cs: CSSStyleDeclaration, n: string, f: string) => cs.getPropertyValue(n).trim() || f;
const pad = (n: number) => String(n).padStart(2, '0');
/** Local-timezone HH:MM:SS for a Lightweight-Charts UTCTimestamp (seconds). */
function localTime(t: number, withSecs = true): string {
  const d = new Date(t * 1000);
  return withSecs ? `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}` : `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
const line = (candles: Candle[], vals: Array<number | null>): LineData[] => {
  const out: LineData[] = [];
  for (let i = 0; i < candles.length; i++) if (vals[i] != null) out.push({ time: candles[i]!.time as UTCTimestamp, value: vals[i]! });
  return out;
};

interface Legend { o: number; h: number; l: number; c: number; changePct: number } // per-bar OHLC + close-vs-open %

export function CandleChart({
  getTicks, getLastTick, windowMs,
}: { getTicks: () => Tick[]; getLastTick: () => Tick | null; windowMs: number }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const maFastRef = useRef<ISeriesApi<'Line'> | null>(null);
  const maSlowRef = useRef<ISeriesApi<'Line'> | null>(null);
  const bbUpRef = useRef<ISeriesApi<'Line'> | null>(null);
  const bbMidRef = useRef<ISeriesApi<'Line'> | null>(null);
  const bbLoRef = useRef<ISeriesApi<'Line'> | null>(null);
  const candlesRef = useRef<Candle[]>([]);
  const hoverRef = useRef(false); // crosshair hovering a bar -> freeze the legend on it

  const [intervalMs, setIntervalMs] = useState(DEFAULT_INTERVAL_MS);
  const [following, setFollowing] = useState(true);
  const followingRef = useRef(true);
  const [ind, setInd] = useState({ ma: true, bb: false });
  const indRef = useRef(ind); indRef.current = ind;
  const [legend, setLegend] = useState<Legend | null>(null);
  const visibleBarsRef = useRef(Math.max(MIN_BARS, Math.ceil(windowMs / DEFAULT_INTERVAL_MS)));

  const setFollow = useCallback((v: boolean) => { followingRef.current = v; setFollowing(v); }, []);
  const legendOf = (c: Candle): Legend => ({ o: c.open, h: c.high, l: c.low, c: c.close, changePct: c.open ? ((c.close - c.open) / c.open) * 100 : 0 });

  const snapToLive = useCallback(() => {
    const chart = chartRef.current, n = candlesRef.current.length;
    if (!chart || n === 0) return;
    chart.timeScale().setVisibleLogicalRange({ from: n - 1 - visibleBarsRef.current, to: n - 1 + RIGHT_OFFSET_BARS });
  }, []);

  const zoom = useCallback((dir: 'in' | 'out') => {
    const next = dir === 'in' ? visibleBarsRef.current * ZOOM_STEP : visibleBarsRef.current / ZOOM_STEP;
    visibleBarsRef.current = Math.min(MAX_BARS, Math.max(MIN_BARS, Math.round(next)));
    const chart = chartRef.current; if (!chart) return;
    if (followingRef.current) snapToLive();
    else { const r = chart.timeScale().getVisibleLogicalRange(); if (r) chart.timeScale().setVisibleLogicalRange({ from: r.to - visibleBarsRef.current, to: r.to }); }
  }, [snapToLive]);

  /** Recompute + set all indicator series from the current candles (called on build / interval / toggle). */
  const refreshIndicators = useCallback(() => {
    const candles = candlesRef.current;
    const closes = candles.map((c) => c.close);
    if (maFastRef.current) maFastRef.current.setData(indRef.current.ma ? line(candles, sma(closes, MA_FAST)) : []);
    if (maSlowRef.current) maSlowRef.current.setData(indRef.current.ma ? line(candles, sma(closes, MA_SLOW)) : []);
    if (bbUpRef.current && bbMidRef.current && bbLoRef.current) {
      const bb = indRef.current.bb ? bollinger(closes, BB_PERIOD, BB_MULT) : [];
      bbUpRef.current.setData(line(candles, bb.map((b) => b?.upper ?? null)));
      bbMidRef.current.setData(line(candles, bb.map((b) => b?.mid ?? null)));
      bbLoRef.current.setData(line(candles, bb.map((b) => b?.lower ?? null)));
    }
  }, []);

  useEffect(() => { refreshIndicators(); }, [ind, refreshIndicators]);

  useEffect(() => {
    let disposed = false, raf = 0;
    const host = hostRef.current; if (!host) return;
    const detach = () => setFollow(false);
    host.addEventListener('wheel', detach, { passive: true });
    host.addEventListener('pointerdown', detach);
    host.addEventListener('touchstart', detach, { passive: true });

    (async () => {
      const { createChart, CandlestickSeries, LineSeries, ColorType, CrosshairMode, LineStyle } = await import('lightweight-charts');
      if (disposed) return;
      const cs = getComputedStyle(document.documentElement);
      const up = readVar(cs, '--pp-up', '#16C784'), down = readVar(cs, '--pp-down', '#EA3943');
      const bg = readVar(cs, '--pp-surface', readVar(cs, '--pp-bg', '#0B0E11'));
      const text = readVar(cs, '--pp-muted', '#8B97A7'), border = readVar(cs, '--pp-border', '#2A323D');
      const accent = readVar(cs, '--pp-accent', '#67E997'), info = readVar(cs, '--pp-info', '#3B82F6');

      const chart = createChart(host, {
        autoSize: true,
        layout: { background: { type: ColorType.Solid, color: bg }, textColor: text, fontSize: 10 },
        grid: { vertLines: { color: border }, horzLines: { color: border } },
        rightPriceScale: { borderColor: border, scaleMargins: { top: 0.16, bottom: 0.12 } },
        timeScale: {
          borderColor: border, timeVisible: true, secondsVisible: true, rightOffset: RIGHT_OFFSET_BARS, barSpacing: 6,
          tickMarkFormatter: (t: Time) => localTime(t as number, true),
        },
        localization: { timeFormatter: (t: Time) => localTime(t as number, true) }, // crosshair label in local time
        crosshair: { mode: CrosshairMode.Normal },
        handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false },
        handleScale: { mouseWheel: true, pinch: true, axisPressedMouseMove: { time: true, price: false } },
      });
      chartRef.current = chart;

      // Bollinger first (drawn under), then MAs, then candles on top.
      bbUpRef.current = chart.addSeries(LineSeries, { color: info, lineWidth: 1, lineStyle: LineStyle.Dotted, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
      bbMidRef.current = chart.addSeries(LineSeries, { color: info, lineWidth: 1, lineStyle: LineStyle.Dashed, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
      bbLoRef.current = chart.addSeries(LineSeries, { color: info, lineWidth: 1, lineStyle: LineStyle.Dotted, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
      maFastRef.current = chart.addSeries(LineSeries, { color: accent, lineWidth: 2, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
      maSlowRef.current = chart.addSeries(LineSeries, { color: '#F0B90B', lineWidth: 2, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
      const candle = chart.addSeries(CandlestickSeries, { upColor: up, downColor: down, borderVisible: false, wickUpColor: up, wickDownColor: down });
      candleRef.current = candle;

      const seeded = aggregateCandles(getTicks(), intervalMs);
      candlesRef.current = seeded;
      candle.setData(seeded as unknown as CandlestickData[]);
      refreshIndicators();
      if (seeded.length) setLegend(legendOf(seeded[seeded.length - 1]!));
      visibleBarsRef.current = Math.min(MAX_BARS, Math.max(MIN_BARS, Math.ceil(windowMs / intervalMs)));
      setFollow(true); snapToLive();

      // Crosshair -> freeze legend on the hovered bar; leaving resumes the live bar.
      chart.subscribeCrosshairMove((param) => {
        const d = param.seriesData?.get(candle) as CandlestickData | undefined;
        if (d && typeof d.open === 'number') { hoverRef.current = true; setLegend({ o: d.open, h: d.high, l: d.low, c: d.close, changePct: d.open ? ((d.close - d.open) / d.open) * 100 : 0 }); }
        else hoverRef.current = false;
      });

      let lastCount = seeded.length;
      const loop = () => {
        if (disposed) return;
        const last = getLastTick();
        if (last && candleRef.current) {
          const c = upsertCandle(candlesRef.current, last, intervalMs);
          candleRef.current.update({ time: c.time as UTCTimestamp, open: c.open, high: c.high, low: c.low, close: c.close });
          const n = candlesRef.current.length;
          if (n !== lastCount) { refreshIndicators(); lastCount = n; }          // new bar -> extend indicators
          else {                                                                 // same bar -> move its last indicator point
            const closes = candlesRef.current.map((x) => x.close);
            const put = (s: ISeriesApi<'Line'> | null, v: number | null) => { if (s && v != null) s.update({ time: c.time as UTCTimestamp, value: v }); };
            if (indRef.current.ma) { const f = sma(closes, MA_FAST), sl = sma(closes, MA_SLOW); put(maFastRef.current, f[f.length - 1]!); put(maSlowRef.current, sl[sl.length - 1]!); }
            if (indRef.current.bb) { const b = bollinger(closes, BB_PERIOD, BB_MULT); const t = b[b.length - 1]; if (t) { put(bbUpRef.current, t.upper); put(bbMidRef.current, t.mid); put(bbLoRef.current, t.lower); } }
          }
          if (!hoverRef.current) setLegend(legendOf(c));
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
      chartRef.current = candleRef.current = null;
      maFastRef.current = maSlowRef.current = bbUpRef.current = bbMidRef.current = bbLoRef.current = null;
      candlesRef.current = [];
    };
  }, [getTicks, getLastTick, intervalMs, windowMs, setFollow, snapToLive, refreshIndicators]);

  const pill = 'h-6 min-w-[1.75rem] rounded-md border px-1.5 text-[10px] font-semibold leading-none transition backdrop-blur';
  const idle = 'border-border bg-surface/80 text-muted hover:text-fg';
  const active = 'border-accent bg-accent/15 text-accent';
  const up = (legend?.changePct ?? 0) >= 0;

  return (
    <div className="relative h-full w-full">
      <div ref={hostRef} className="h-full w-full" aria-label="Live price candlesticks" role="img" />

      {/* OHLC legend (top-left) — tracks the crosshair, else the live bar. */}
      {legend ? (
        <div className="pointer-events-none absolute left-1.5 top-8 flex flex-wrap gap-x-2 gap-y-0 rounded-md bg-surface/70 px-2 py-1 font-mono text-[10px] tabular-nums backdrop-blur">
          <span className="text-muted">O <span className="text-fg">{legend.o.toFixed(4)}</span></span>
          <span className="text-muted">H <span className="text-fg">{legend.h.toFixed(4)}</span></span>
          <span className="text-muted">L <span className="text-fg">{legend.l.toFixed(4)}</span></span>
          <span className="text-muted">C <span className="text-fg">{legend.c.toFixed(4)}</span></span>
          <span className={cn('font-semibold', up ? 'text-up' : 'text-down')}>{up ? '+' : ''}{legend.changePct.toFixed(2)}%</span>
        </div>
      ) : null}

      {/* Toolbar — intervals + indicators (left), zoom + Live (right). Overlaid so it costs no height. */}
      <div className="pointer-events-none absolute inset-x-1.5 top-1.5 flex items-start justify-between gap-2">
        <div className="pointer-events-auto flex flex-wrap items-center gap-1">
          {INTERVALS.map((iv) => (
            <button key={iv.ms} type="button" onClick={() => setIntervalMs(iv.ms)} aria-pressed={intervalMs === iv.ms} className={cn(pill, intervalMs === iv.ms ? active : idle)}>{iv.label}</button>
          ))}
          <span className="mx-0.5 h-4 w-px bg-border" aria-hidden />
          <button type="button" onClick={() => setInd((s) => ({ ...s, ma: !s.ma }))} aria-pressed={ind.ma} className={cn(pill, ind.ma ? active : idle)} title="Moving averages (7, 25)">MA</button>
          <button type="button" onClick={() => setInd((s) => ({ ...s, bb: !s.bb }))} aria-pressed={ind.bb} className={cn(pill, ind.bb ? active : idle)} title="Bollinger Bands (20, 2)">BB</button>
        </div>
        <div className="pointer-events-auto flex items-center gap-1">
          <button type="button" onClick={() => zoom('out')} aria-label="Zoom out" className={cn(pill, idle, 'text-sm')}>−</button>
          <button type="button" onClick={() => zoom('in')} aria-label="Zoom in" className={cn(pill, idle, 'text-sm')}>+</button>
          <button type="button" onClick={() => { setFollow(true); snapToLive(); }} aria-pressed={following} className={cn(pill, following ? active : idle, 'px-2')} title="Follow the live price">{following ? '● Live' : 'Live'}</button>
        </div>
      </div>
    </div>
  );
}
