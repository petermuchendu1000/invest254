'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  IChartApi, ISeriesApi, UTCTimestamp, CandlestickData, BarData, LineData, Time, SeriesType,
} from 'lightweight-charts';
import { aggregateCandles, upsertCandle, sma, bollinger, type Candle } from '@invest254/shared/chart';
import type { Tick } from '@/lib/game/types';
import { cn } from '@/lib/cn';

/**
 * TradingView-grade candlestick view — the per-brand alternative to the line `CurveCanvas`
 * (migration 0111). Built on TradingView's own Lightweight Charts (v5), so the axes, crosshair and
 * interactions ARE TradingView's. Drop-in with `CurveCanvas` (same props/mount).
 *
 * It consumes the SAME authoritative engine tick stream (`getTicks`/`getLastTick`) and folds it into
 * OHLC via the pure, unit-tested `@invest254/shared/chart` helpers, so the chart can never desync
 * from the settled price. Feature set (a "⚙ features" menu exposes the pro tools):
 *   - chart type: Candles · Bars · Line · Area · Baseline
 *   - price scale: Normal · Logarithmic · Percent
 *   - indicators (OFF by default): MA(7) · MA(25) · MA(99) · Bollinger(20,2)
 *   - timeframe pills 1s/2s/5s/10s (re-aggregate the tape) · −/+ zoom · Live snap-back
 *   - wheel/pinch zoom · drag-to-pan · crosshair · OHLC legend (tracks the crosshair)
 *   - LOCAL-timezone time axis + crosshair · 4-dp price axis · faint symbol watermark
 *
 * Lightweight Charts is imported dynamically inside the effect so it never runs during SSR.
 */

type MainType = 'candles' | 'bars' | 'line' | 'area' | 'baseline';
type ScaleMode = 'normal' | 'log' | 'percent';

const INTERVALS: ReadonlyArray<{ ms: number; label: string }> = [
  { ms: 1000, label: '1s' }, { ms: 2000, label: '2s' }, { ms: 5000, label: '5s' }, { ms: 10_000, label: '10s' },
];
const CHART_TYPES: ReadonlyArray<{ id: MainType; label: string }> = [
  { id: 'candles', label: 'Candles' }, { id: 'bars', label: 'Bars' }, { id: 'line', label: 'Line' },
  { id: 'area', label: 'Area' }, { id: 'baseline', label: 'Baseline' },
];
const SCALES: ReadonlyArray<{ id: ScaleMode; label: string }> = [
  { id: 'normal', label: 'Linear' }, { id: 'log', label: 'Log' }, { id: 'percent', label: 'Percent' },
];
const DEFAULT_INTERVAL_MS = 2000;
const MIN_BARS = 8, MAX_BARS = 600, ZOOM_STEP = 0.7, RIGHT_OFFSET_BARS = 3;
const RESUME_MS = 3000; // auto-return to the live edge after this idle time following manual pan/zoom
const MA = { fast: 7, mid: 25, slow: 99 }, BB_PERIOD = 20, BB_MULT = 2;
/**
 * 6, not 4. The market curve is a random walk, so a round's move is inevitably ~1% of the day's
 * range (sqrt(roundS / 86400)) — at 4 decimals that is a handful of ticks and the chart looks
 * frozen mid-round. At 6 it is hundreds. See the WALK notes in packages/shared/src/curve.ts.
 */
const PRICE_PRECISION = 6;

/** TradingView Supercharts dark palette — the look the candlestick/OHLC view is styled to. */
const TV = {
  bg: '#131722', surface: '#1b2029', rail: '#171b24', border: '#2a2e39', grid: 'rgba(42,46,57,0.5)',
  text: '#d1d4dc', muted: '#787b86', up: '#089981', down: '#f23645', accent: '#2962ff', info: '#2962ff',
  cross: '#9598a1', crossLabel: '#363a45',
} as const;

const pad = (n: number) => String(n).padStart(2, '0');
const localTime = (t: number) => { const d = new Date(t * 1000); return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`; };
const asLine = (candles: Candle[], vals: Array<number | null>): LineData[] => {
  const out: LineData[] = [];
  for (let i = 0; i < candles.length; i++) if (vals[i] != null) out.push({ time: candles[i]!.time as UTCTimestamp, value: vals[i]! });
  return out;
};

interface Ind { ma7: boolean; ma25: boolean; ma99: boolean; bb: boolean }
interface Legend { o: number; h: number; l: number; c: number; changePct: number }

export function CandleChart({
  getTicks, getLastTick, windowMs, symbol = 'BTC/KES', initialType = 'candles',
}: { getTicks: () => Tick[]; getLastTick: () => Tick | null; windowMs: number; symbol?: string; initialType?: MainType }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const mainRef = useRef<ISeriesApi<SeriesType> | null>(null);
  const maFastRef = useRef<ISeriesApi<'Line'> | null>(null);
  const maMidRef = useRef<ISeriesApi<'Line'> | null>(null);
  const maSlowRef = useRef<ISeriesApi<'Line'> | null>(null);
  const bbUpRef = useRef<ISeriesApi<'Line'> | null>(null);
  const bbMidRef = useRef<ISeriesApi<'Line'> | null>(null);
  const bbLoRef = useRef<ISeriesApi<'Line'> | null>(null);
  const candlesRef = useRef<Candle[]>([]);
  const hoverRef = useRef(false);
  const menuWrapRef = useRef<HTMLDivElement>(null);
  const resumeRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [intervalMs, setIntervalMs] = useState(DEFAULT_INTERVAL_MS);
  // ADDON-1: opens on the brand's chart system (area / bars / baseline / candles); players can still switch views.
  const [chartType, setChartType] = useState<MainType>(initialType);
  const chartTypeRef = useRef<MainType>(initialType); chartTypeRef.current = chartType;
  const [scaleMode, setScaleMode] = useState<ScaleMode>('normal');
  const [ind, setInd] = useState<Ind>({ ma7: false, ma25: false, ma99: false, bb: false });
  const indRef = useRef(ind); indRef.current = ind;
  const followingRef = useRef(true);
  const [menuOpen, setMenuOpen] = useState(false);
  const [legend, setLegend] = useState<Legend | null>(null);
  const visibleBarsRef = useRef(Math.max(MIN_BARS, Math.ceil(windowMs / DEFAULT_INTERVAL_MS)));

  const setFollow = useCallback((v: boolean) => { followingRef.current = v; }, []);
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

  const refreshIndicators = useCallback(() => {
    const candles = candlesRef.current, closes = candles.map((c) => c.close), on = indRef.current;
    maFastRef.current?.setData(on.ma7 ? asLine(candles, sma(closes, MA.fast)) : []);
    maMidRef.current?.setData(on.ma25 ? asLine(candles, sma(closes, MA.mid)) : []);
    maSlowRef.current?.setData(on.ma99 ? asLine(candles, sma(closes, MA.slow)) : []);
    if (bbUpRef.current && bbMidRef.current && bbLoRef.current) {
      const bb = on.bb ? bollinger(closes, BB_PERIOD, BB_MULT) : [];
      bbUpRef.current.setData(asLine(candles, bb.map((b) => b?.upper ?? null)));
      bbMidRef.current.setData(asLine(candles, bb.map((b) => b?.mid ?? null)));
      bbLoRef.current.setData(asLine(candles, bb.map((b) => b?.lower ?? null)));
    }
  }, []);
  useEffect(() => { refreshIndicators(); }, [ind, refreshIndicators]);

  // Price-scale mode is applied live (no rebuild).
  useEffect(() => {
    const chart = chartRef.current; if (!chart) return;
    // lazily import the enum values via numeric map (0 normal, 1 log, 2 percent)
    const mode = scaleMode === 'log' ? 1 : scaleMode === 'percent' ? 2 : 0;
    chart.priceScale('right').applyOptions({ mode });
  }, [scaleMode]);

  // Close the features menu on outside click.
  useEffect(() => {
    if (!menuOpen) return;
    const onDoc = (e: MouseEvent) => { if (menuWrapRef.current && !menuWrapRef.current.contains(e.target as Node)) setMenuOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [menuOpen]);

  // Build (rebuild on interval OR chart-type change), then track live ticks.
  useEffect(() => {
    let disposed = false, raf = 0;
    const host = hostRef.current; if (!host) return;
    const detach = () => {
      setFollow(false);
      if (resumeRef.current) clearTimeout(resumeRef.current);
      resumeRef.current = setTimeout(() => { setFollow(true); snapToLive(); }, RESUME_MS);
    };
    host.addEventListener('wheel', detach, { passive: true });
    host.addEventListener('pointerdown', detach);
    host.addEventListener('touchstart', detach, { passive: true });

    (async () => {
      const lc = await import('lightweight-charts');
      const { createChart, CandlestickSeries, BarSeries, LineSeries, AreaSeries, BaselineSeries, ColorType, CrosshairMode, LineStyle } = lc;
      if (disposed) return;
      // TradingView Supercharts palette — fixed (not brand-themed) so candlestick/OHLC read as a
      // genuine TV terminal: dark navy canvas, teal/red bodies, faint grid, TV blue overlays.
      const up = TV.up, down = TV.down, bg = TV.bg, text = TV.text, border = TV.border;
      const accent = TV.accent, info = TV.info;

      const chart = createChart(host, {
        autoSize: true,
        layout: { background: { type: ColorType.Solid, color: bg }, textColor: text, fontSize: 11, attributionLogo: true },
        grid: { vertLines: { color: TV.grid }, horzLines: { color: TV.grid } },
        rightPriceScale: { borderColor: border, scaleMargins: { top: 0.08, bottom: 0.08 }, mode: scaleMode === 'log' ? 1 : scaleMode === 'percent' ? 2 : 0 },
        timeScale: {
          borderColor: border, timeVisible: true, secondsVisible: true, rightOffset: RIGHT_OFFSET_BARS, barSpacing: 6,
          tickMarkFormatter: (t: Time) => localTime(t as number),
        },
        localization: { timeFormatter: (t: Time) => localTime(t as number) },
        crosshair: {
          mode: CrosshairMode.Normal,
          vertLine: { color: TV.cross, width: 1, style: LineStyle.Dashed, labelBackgroundColor: TV.crossLabel },
          horzLine: { color: TV.cross, width: 1, style: LineStyle.Dashed, labelBackgroundColor: TV.crossLabel },
        },
        handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false },
        handleScale: { mouseWheel: true, pinch: true, axisPressedMouseMove: { time: true, price: false } },
      });
      chartRef.current = chart;

      // Indicators under the price series (created regardless; data set only when toggled on).
      const lineOpts = { priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false } as const;
      bbUpRef.current = chart.addSeries(LineSeries, { ...lineOpts, color: info, lineWidth: 1, lineStyle: LineStyle.Dotted });
      bbMidRef.current = chart.addSeries(LineSeries, { ...lineOpts, color: info, lineWidth: 1, lineStyle: LineStyle.Dashed });
      bbLoRef.current = chart.addSeries(LineSeries, { ...lineOpts, color: info, lineWidth: 1, lineStyle: LineStyle.Dotted });
      maFastRef.current = chart.addSeries(LineSeries, { ...lineOpts, color: accent, lineWidth: 2 });
      maMidRef.current = chart.addSeries(LineSeries, { ...lineOpts, color: '#F0B90B', lineWidth: 2 });
      maSlowRef.current = chart.addSeries(LineSeries, { ...lineOpts, color: '#A78BFA', lineWidth: 2 });

      // Main price series per selected chart type.
      const seeded = aggregateCandles(getTicks(), intervalMs);
      candlesRef.current = seeded;
      const priceFormat = { type: 'price', precision: PRICE_PRECISION, minMove: 1 / 10 ** PRICE_PRECISION } as const;
      const baseVal = seeded.length ? seeded[Math.floor(seeded.length / 2)]!.close : 0;
      const t = chartTypeRef.current;
      let main: ISeriesApi<SeriesType>;
      if (t === 'candles') main = chart.addSeries(CandlestickSeries, { upColor: up, downColor: down, borderVisible: false, wickUpColor: up, wickDownColor: down, priceFormat });
      else if (t === 'bars') main = chart.addSeries(BarSeries, { upColor: up, downColor: down, priceFormat });
      else if (t === 'line') main = chart.addSeries(LineSeries, { color: accent, lineWidth: 2, priceFormat });
      else if (t === 'area') main = chart.addSeries(AreaSeries, { lineColor: accent, topColor: `${accent}55`, bottomColor: `${accent}05`, lineWidth: 2, priceFormat });
      else main = chart.addSeries(BaselineSeries, { baseValue: { type: 'price', price: baseVal }, topLineColor: up, topFillColor1: `${up}44`, topFillColor2: `${up}08`, bottomLineColor: down, bottomFillColor1: `${down}08`, bottomFillColor2: `${down}44`, priceFormat });
      mainRef.current = main;

      const ohlc = seeded as unknown as (CandlestickData | BarData)[];
      const lineData: LineData[] = seeded.map((c) => ({ time: c.time as UTCTimestamp, value: c.close }));
      main.setData((t === 'candles' || t === 'bars') ? ohlc : lineData);

      refreshIndicators();
      if (seeded.length) setLegend(legendOf(seeded[seeded.length - 1]!));
      visibleBarsRef.current = Math.min(MAX_BARS, Math.max(MIN_BARS, Math.ceil(windowMs / intervalMs)));
      setFollow(true); snapToLive();

      chart.subscribeCrosshairMove((param) => {
        const d = param.seriesData?.get(main) as (CandlestickData | BarData | LineData) | undefined;
        if (d && 'open' in d && typeof d.open === 'number') { hoverRef.current = true; setLegend({ o: d.open, h: d.high, l: d.low, c: d.close, changePct: d.open ? ((d.close - d.open) / d.open) * 100 : 0 }); }
        else hoverRef.current = false;
      });

      let lastCount = seeded.length;
      const put = (s: ISeriesApi<'Line'> | null, tm: UTCTimestamp, v: number | null) => { if (s && v != null) s.update({ time: tm, value: v }); };
      const loop = () => {
        if (disposed) return;
        const last = getLastTick();
        if (last && mainRef.current) {
          const c = upsertCandle(candlesRef.current, last, intervalMs);
          const tm = c.time as UTCTimestamp;
          const cur = chartTypeRef.current;
          if (cur === 'candles' || cur === 'bars') mainRef.current.update({ time: tm, open: c.open, high: c.high, low: c.low, close: c.close } as CandlestickData);
          else mainRef.current.update({ time: tm, value: c.close } as LineData);

          const n = candlesRef.current.length;
          if (n !== lastCount) { refreshIndicators(); lastCount = n; }
          else {
            const closes = candlesRef.current.map((x) => x.close), on = indRef.current;
            if (on.ma7) put(maFastRef.current, tm, sma(closes, MA.fast).at(-1)!);
            if (on.ma25) put(maMidRef.current, tm, sma(closes, MA.mid).at(-1)!);
            if (on.ma99) put(maSlowRef.current, tm, sma(closes, MA.slow).at(-1)!);
            if (on.bb) { const b = bollinger(closes, BB_PERIOD, BB_MULT).at(-1); if (b) { put(bbUpRef.current, tm, b.upper); put(bbMidRef.current, tm, b.mid); put(bbLoRef.current, tm, b.lower); } }
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
      if (resumeRef.current) clearTimeout(resumeRef.current);
      host.removeEventListener('wheel', detach);
      host.removeEventListener('pointerdown', detach);
      host.removeEventListener('touchstart', detach);
      chartRef.current?.remove();
      chartRef.current = mainRef.current = null;
      maFastRef.current = maMidRef.current = maSlowRef.current = bbUpRef.current = bbMidRef.current = bbLoRef.current = null;
      candlesRef.current = [];
    };
  }, [getTicks, getLastTick, intervalMs, chartType, windowMs, setFollow, snapToLive, refreshIndicators, scaleMode]);

  // TradingView Supercharts chrome — fixed palette so the whole view reads as a TV terminal.
  const pill = 'h-6 min-w-[1.75rem] [@media(pointer:coarse)]:min-w-11 rounded px-1.5 text-[11px] font-semibold leading-none transition';
  const idle = 'text-[#787b86] hover:text-white';
  const active = 'bg-[#2a2e39] text-white';
  const up = (legend?.changePct ?? 0) >= 0;
  const row = 'flex items-center gap-0.5';
  const sep = <span className="mx-1 h-4 w-px shrink-0 bg-[#2a2e39]" aria-hidden />;

  return (
    <div className="flex h-full w-full flex-col bg-[#131722] text-[#d1d4dc]">
      {/* Top toolbar — symbol + timeframe pills + tools (TradingView-style, above the plot). */}
      <div className="flex h-10 shrink-0 items-center gap-0.5 border-b border-[#2a2e39] px-2 text-[12px]">
        <span className="shrink-0 pr-1 text-[13px] font-bold text-white">{symbol}</span>
        {sep}
        <div className={cn('flex-wrap', row)}>
          {INTERVALS.map((iv) => (
            <button key={iv.ms} type="button" onClick={() => setIntervalMs(iv.ms)} aria-pressed={intervalMs === iv.ms} className={cn(pill, intervalMs === iv.ms ? active : idle)}>{iv.label}</button>
          ))}
        </div>
        <div className="flex-1" />
        <div className={row} ref={menuWrapRef}>
          <div className="relative">
            <button type="button" onClick={() => setMenuOpen((v) => !v)} aria-expanded={menuOpen} className={cn(pill, menuOpen ? active : idle, 'px-2')} title="Chart features">⚙ Tools</button>
            {menuOpen ? (
              <div className="absolute right-0 top-8 z-30 w-52 rounded-lg border border-[#2a2e39] bg-[#1b2029] p-2 text-left shadow-xl">
                <Section title="Chart type">
                  <div className="grid grid-cols-3 gap-1">
                    {CHART_TYPES.map((c) => (
                      <button key={c.id} type="button" onClick={() => setChartType(c.id)} className={cn(pill, 'w-full', chartType === c.id ? active : idle)}>{c.label}</button>
                    ))}
                  </div>
                </Section>
                <Section title="Price scale">
                  <div className="grid grid-cols-3 gap-1">
                    {SCALES.map((sm) => (
                      <button key={sm.id} type="button" onClick={() => setScaleMode(sm.id)} className={cn(pill, 'w-full', scaleMode === sm.id ? active : idle)}>{sm.label}</button>
                    ))}
                  </div>
                </Section>
                <Section title="Indicators">
                  <div className="grid grid-cols-2 gap-1">
                    <Toggle on={ind.ma7} onClick={() => setInd((s) => ({ ...s, ma7: !s.ma7 }))}>MA 7</Toggle>
                    <Toggle on={ind.ma25} onClick={() => setInd((s) => ({ ...s, ma25: !s.ma25 }))}>MA 25</Toggle>
                    <Toggle on={ind.ma99} onClick={() => setInd((s) => ({ ...s, ma99: !s.ma99 }))}>MA 99</Toggle>
                    <Toggle on={ind.bb} onClick={() => setInd((s) => ({ ...s, bb: !s.bb }))}>Boll 20</Toggle>
                  </div>
                </Section>
              </div>
            ) : null}
          </div>
          <button type="button" onClick={() => zoom('out')} aria-label="Zoom out" className={cn(pill, idle, 'text-sm [@media(pointer:coarse)]:hidden')}>−</button>
          <button type="button" onClick={() => zoom('in')} aria-label="Zoom in" className={cn(pill, idle, 'text-sm [@media(pointer:coarse)]:hidden')}>+</button>
        </div>
      </div>

      {/* Body = left drawing rail + plot (TradingView layout). */}
      <div className="flex min-h-0 flex-1">
        <DrawRail />
        {/* Plot area — fills the remaining width/height; watermark + OHLC legend overlay it. */}
        <div className="relative min-h-0 flex-1">
          <div ref={hostRef} className="h-full w-full" aria-label="Live price chart" role="img" />
          <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
            <span className="select-none text-4xl font-black uppercase tracking-widest text-white/[0.04]">{symbol}</span>
          </div>
          {legend ? (
            <div className="pointer-events-none absolute left-2 top-1.5 z-20 flex flex-wrap items-baseline gap-x-2 font-mono text-[11px] tabular-nums">
              <span className="font-semibold text-white">{symbol}</span>
              <span className="text-[#787b86]">O <span className="text-[#d1d4dc]">{legend.o.toFixed(4)}</span></span>
              <span className="text-[#787b86]">H <span className="text-[#d1d4dc]">{legend.h.toFixed(4)}</span></span>
              <span className="text-[#787b86]">L <span className="text-[#d1d4dc]">{legend.l.toFixed(4)}</span></span>
              <span className="text-[#787b86]">C <span className="text-[#d1d4dc]">{legend.c.toFixed(4)}</span></span>
              <span className={cn('font-semibold', up ? 'text-[#089981]' : 'text-[#f23645]')}>{up ? '+' : ''}{legend.changePct.toFixed(2)}%</span>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/**
 * Left drawing rail — the TradingView Supercharts tool column (cursor, crosshair, trend/horizontal
 * lines, Fibonacci, text, measure, …). Cosmetic chrome that completes the terminal look; the chart's
 * own pointer tools (pan/zoom/crosshair) remain active in the plot to its right.
 */
function DrawRail() {
  const tools: { d: string; label: string }[] = [
    { d: 'M5 3l6 14 2-6 6-2z', label: 'Cursor' },
    { d: 'M12 3v18M3 12h18', label: 'Crosshair' },
    { d: 'M4 20L20 4', label: 'Trend line' },
    { d: 'M3 12h18', label: 'Horizontal line' },
    { d: 'M5 19l4-9 3 5 3-8 4 12', label: 'Pitchfork' },
    { d: 'M6 4v16M18 4v16M3 9h18M3 15h18', label: 'Fibonacci' },
    { d: 'M4 7h16M4 12h10M4 17h16', label: 'Text' },
    { d: 'M7 4h10l-5 16z', label: 'Measure' },
  ];
  return (
    <div className="flex w-10 shrink-0 flex-col items-center gap-1 border-r border-[#2a2e39] bg-[#171b24] py-1.5" aria-hidden>
      {tools.map((t, i) => (
        <span
          key={t.label}
          title={t.label}
          className={cn('grid h-8 w-8 place-items-center rounded-md', i === 0 ? 'bg-[#2a2e39] text-white' : 'text-[#b2b5be]')}
        >
          <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d={t.d} />
          </svg>
        </span>
      ))}
      <span className="mt-auto grid h-8 w-8 place-items-center rounded-md text-[#b2b5be]" title="Trash" aria-hidden>
        <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M5 7h14M9 7V5h6v2M7 7l1 13h8l1-13" />
        </svg>
      </span>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-2 last:mb-0">
      <div className="mb-1 text-[9px] font-semibold uppercase tracking-wider text-muted">{title}</div>
      {children}
    </div>
  );
}
function Toggle({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      className={cn(
        'flex h-6 items-center justify-between rounded-md border px-2 text-[10px] font-semibold transition',
        on ? 'border-accent bg-accent/15 text-accent' : 'border-border bg-surface/80 text-muted hover:text-fg',
      )}
    >
      <span>{children}</span>
      <span className={cn('ml-1 h-1.5 w-1.5 rounded-full', on ? 'bg-accent' : 'bg-border')} />
    </button>
  );
}
