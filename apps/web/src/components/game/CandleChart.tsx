'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  IChartApi, ISeriesApi, UTCTimestamp, CandlestickData, BarData, LineData, Time, SeriesType, LogicalRange,
} from 'lightweight-charts';
import { sma, bollinger, type Candle } from '@invest254/shared/chart';
import { TIMEFRAME_KEYS, TIMEFRAMES, bucketStartS, valueOfRate, XAUUSD, type MarketSymbol, type Timeframe } from '@invest254/shared/candles';
import type { CandlesReply } from '@/lib/game/GameSocketProvider';
import type { ConnStatus, Tick } from '@/lib/game/types';
import { InterfaceModeToggle } from '@/components/game/InterfaceModeToggle';
import { cn } from '@/lib/cn';

/**
 * MetaTrader-style candlestick terminal, built on TradingView's Lightweight Charts (v5) so the axes,
 * crosshair and interactions ARE TradingView's.
 *
 * It used to fold the live tick tape into 1s–10s buckets, which meant the chart only ever knew the
 * last minute of prices: every period looked the same and there was nothing to scroll back to. It
 * now runs on real MT5 periods (M1 … MN1) served by the engine's candle feed, with one year of
 * history behind it, and splices the forming bar on top from the live tick stream.
 *
 * Two things keep the picture honest. History bars are the same seeded curve the settlement engine
 * scores — not a re-render of it — and the forming bar is priced through the anchor that came with
 * them, so the bar being built sits on exactly the axis of the bars beside it.
 *
 * Feature set (the ⚙ Tools menu exposes the pro tools):
 *   - periods M1…MN1 · chart type Candles · Bars · Line · Area · Baseline
 *   - price scale Normal · Logarithmic · Percent
 *   - indicators (off by default): MA(7) · MA(25) · MA(99) · Bollinger(20,2)
 *   - scroll back to load older history · −/+ zoom · live snap-back
 *   - wheel/pinch zoom · drag-to-pan · crosshair · OHLC legend (tracks the crosshair)
 *   - LOCAL-timezone time axis + crosshair · faint symbol watermark · left drawing rail
 *
 * Lightweight Charts is imported dynamically inside the effect so it never runs during SSR.
 */

type MainType = 'candles' | 'bars' | 'line' | 'area' | 'baseline';
type ScaleMode = 'normal' | 'log' | 'percent';

const CHART_TYPES: ReadonlyArray<{ id: MainType; label: string }> = [
  { id: 'candles', label: 'Candles' }, { id: 'bars', label: 'Bars' }, { id: 'line', label: 'Line' },
  { id: 'area', label: 'Area' }, { id: 'baseline', label: 'Baseline' },
];
const SCALES: ReadonlyArray<{ id: ScaleMode; label: string }> = [
  { id: 'normal', label: 'Linear' }, { id: 'log', label: 'Log' }, { id: 'percent', label: 'Percent' },
];

const DEFAULT_TF: Timeframe = 'M1';
const TF_STORAGE_KEY = 'pp:chart:tf';
/** Bars fetched on open, and per page when scrolling back. */
const INITIAL_BARS = 500, PAGE_BARS = 500;
/** Load older history once the view comes within this many bars of the left edge. */
const PAGE_TRIGGER_BARS = 40;
/** Ceiling on bars held client-side, so a long session cannot grow without bound. */
const MAX_HELD_BARS = 6000;

const MIN_BARS = 8, MAX_BARS = 600, ZOOM_STEP = 0.7, RIGHT_OFFSET_BARS = 3;
const RESUME_MS = 3000; // auto-return to the live edge after this idle time following manual pan/zoom
const MA = { fast: 7, mid: 25, slow: 99 }, BB_PERIOD = 20, BB_MULT = 2;

/** TradingView Supercharts dark palette — the look the candlestick/OHLC view is styled to. */
const TV = {
  bg: '#131722', surface: '#1b2029', rail: '#171b24', border: '#2a2e39', grid: 'rgba(42,46,57,0.5)',
  text: '#d1d4dc', muted: '#787b86', up: '#089981', down: '#f23645', accent: '#2962ff', info: '#2962ff',
  cross: '#9598a1', crossLabel: '#363a45',
} as const;

const pad = (n: number) => String(n).padStart(2, '0');
/**
 * Axis/crosshair label in the viewer's own timezone. Intraday periods want the clock; from D1 up the
 * clock is noise, so those show the date instead — the same split MetaTrader makes.
 */
const labelFor = (t: number, tf: Timeframe): string => {
  const d = new Date(t * 1000);
  if (tf === 'D1' || tf === 'W1' || tf === 'MN1') return `${d.getDate()} ${d.toLocaleString(undefined, { month: 'short' })}`;
  if (TIMEFRAMES[tf] >= TIMEFRAMES.H1) return `${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

const asLine = (candles: Candle[], vals: Array<number | null>): LineData[] => {
  const out: LineData[] = [];
  for (let i = 0; i < candles.length; i++) if (vals[i] != null) out.push({ time: candles[i]!.time as UTCTimestamp, value: vals[i]! });
  return out;
};

const utcDateKey = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

interface Ind { ma7: boolean; ma25: boolean; ma99: boolean; bb: boolean }
interface Legend { o: number; h: number; l: number; c: number; changePct: number }
type Anchor = CandlesReply['anchor'];

export function CandleChart({
  getLastTick, requestCandles, status, initialType = 'candles',
}: {
  getLastTick: () => Tick | null;
  requestCandles: (tf: Timeframe, count: number, to?: number) => Promise<CandlesReply>;
  /** Connection state, so history can be refetched after a drop. */
  status: ConnStatus;
  initialType?: MainType;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const mainRef = useRef<ISeriesApi<SeriesType> | null>(null);
  const maFastRef = useRef<ISeriesApi<'Line'> | null>(null);
  const maMidRef = useRef<ISeriesApi<'Line'> | null>(null);
  const maSlowRef = useRef<ISeriesApi<'Line'> | null>(null);
  const bbUpRef = useRef<ISeriesApi<'Line'> | null>(null);
  const bbMidRef = useRef<ISeriesApi<'Line'> | null>(null);
  const bbLoRef = useRef<ISeriesApi<'Line'> | null>(null);
  /** Closed history plus, as the last element, the bar currently forming from live ticks. */
  const candlesRef = useRef<Candle[]>([]);
  const anchorRef = useRef<Anchor | null>(null);
  const instRef = useRef<MarketSymbol>(XAUUSD);
  const hoverRef = useRef(false);
  const menuWrapRef = useRef<HTMLDivElement>(null);
  const resumeRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Guards against firing a page request on every scroll frame, and against racing the initial load. */
  const pagingRef = useRef(false);
  const exhaustedRef = useRef(false);

  /**
   * Bumped to force a history refetch without changing the period: on reconnect (the socket may have
   * missed bars) and at UTC midnight (a new seeded day means a new base, so every price before the
   * refetch would sit on the wrong axis).
   */
  const [reloadKey, setReloadKey] = useState(0);
  const [tf, setTf] = useState<Timeframe>(DEFAULT_TF);
  const tfRef = useRef<Timeframe>(tf); tfRef.current = tf;
  const [instrument, setInstrument] = useState<MarketSymbol>(XAUUSD);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [chartType, setChartType] = useState<MainType>(initialType);
  const chartTypeRef = useRef<MainType>(initialType); chartTypeRef.current = chartType;
  const [scaleMode, setScaleMode] = useState<ScaleMode>('normal');
  const [ind, setInd] = useState<Ind>({ ma7: false, ma25: false, ma99: false, bb: false });
  const indRef = useRef(ind); indRef.current = ind;
  const followingRef = useRef(true);
  const [menuOpen, setMenuOpen] = useState(false);
  const [legend, setLegend] = useState<Legend | null>(null);
  const visibleBarsRef = useRef(120);

  // Restore the player's last period (MT5 remembers it too).
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(TF_STORAGE_KEY);
      if (saved && (TIMEFRAME_KEYS as string[]).includes(saved)) setTf(saved as Timeframe);
    } catch { /* private mode / blocked storage — the default is fine */ }
  }, []);
  const chooseTf = useCallback((next: Timeframe) => {
    setTf(next);
    try { window.localStorage.setItem(TF_STORAGE_KEY, next); } catch { /* non-fatal */ }
  }, []);

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
    chart.priceScale('right').applyOptions({ mode: scaleMode === 'log' ? 1 : scaleMode === 'percent' ? 2 : 0 });
  }, [scaleMode]);

  // Close the features menu on outside click.
  useEffect(() => {
    if (!menuOpen) return;
    const onDoc = (e: MouseEvent) => { if (menuWrapRef.current && !menuWrapRef.current.contains(e.target as Node)) setMenuOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [menuOpen]);

  /** Write the whole series, in whatever shape the current chart type takes. */
  const paint = useCallback(() => {
    const main = mainRef.current; if (!main) return;
    const data = candlesRef.current;
    const t = chartTypeRef.current;
    if (t === 'candles' || t === 'bars') main.setData(data as unknown as (CandlestickData | BarData)[]);
    else main.setData(data.map((c) => ({ time: c.time as UTCTimestamp, value: c.close })) as LineData[]);
    refreshIndicators();
  }, [refreshIndicators]);

  // ── History: (re)load on period change, and page backwards on scroll ──────────────────────────
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    exhaustedRef.current = false;
    pagingRef.current = true; // no paging until the first page has landed
    requestCandles(tf, INITIAL_BARS)
      .then((reply) => {
        if (cancelled) return;
        candlesRef.current = reply.bars.slice();
        anchorRef.current = reply.anchor;
        instRef.current = reply.instrument;
        setInstrument(reply.instrument);
        paint();
        if (reply.bars.length) setLegend(legendOf(reply.bars[reply.bars.length - 1]!));
        setFollow(true);
        snapToLive();
        setLoading(false);
        pagingRef.current = false;
      })
      .catch((err: Error) => {
        if (cancelled) return;
        setLoadError(err.message);
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, [tf, reloadKey, requestCandles, paint, setFollow, snapToLive]);

  // Refetch when the connection comes back: while it was down the engine kept printing bars we never
  // saw, so the gap has to be filled rather than drawn over.
  const prevStatusRef = useRef(status);
  useEffect(() => {
    if (status === 'open' && prevStatusRef.current !== 'open') setReloadKey((k) => k + 1);
    prevStatusRef.current = status;
  }, [status]);

  // Refetch at UTC midnight, when the engine reseeds and the day's base price changes.
  useEffect(() => {
    const id = setInterval(() => {
      const anchor = anchorRef.current;
      if (anchor && utcDateKey(Date.now()) !== anchor.tradeDate) setReloadKey((k) => k + 1);
    }, 15_000);
    return () => clearInterval(id);
  }, []);

  /**
   * Prepend an older page, keeping the view still.
   *
   * Lightweight Charts indexes bars logically, so inserting at the front shifts every index by the
   * number added; without re-offsetting the visible range the chart would jump backwards under the
   * player's finger mid-scroll.
   */
  const loadOlder = useCallback(() => {
    if (pagingRef.current || exhaustedRef.current) return;
    const held = candlesRef.current;
    const oldest = held[0];
    if (!oldest || held.length >= MAX_HELD_BARS) return;
    pagingRef.current = true;
    const activeTf = tfRef.current;
    requestCandles(activeTf, PAGE_BARS, oldest.time)
      .then((reply) => {
        if (tfRef.current !== activeTf) return; // the player switched period mid-flight
        const older = reply.bars.filter((b) => b.time < oldest.time);
        if (older.length === 0) { exhaustedRef.current = true; return; }
        candlesRef.current = older.concat(candlesRef.current);
        const chart = chartRef.current;
        const before = chart?.timeScale().getVisibleLogicalRange();
        paint();
        if (chart && before) {
          chart.timeScale().setVisibleLogicalRange({ from: before.from + older.length, to: before.to + older.length });
        }
      })
      .catch(() => { exhaustedRef.current = true; })
      .finally(() => { pagingRef.current = false; });
  }, [requestCandles, paint]);

  // Build the chart (rebuild only on chart-type change), then track live ticks.
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
      const up = TV.up, down = TV.down, accent = TV.accent, info = TV.info, border = TV.border;

      const chart = createChart(host, {
        autoSize: true,
        layout: { background: { type: ColorType.Solid, color: TV.bg }, textColor: TV.text, fontSize: 11, attributionLogo: true },
        grid: { vertLines: { color: TV.grid }, horzLines: { color: TV.grid } },
        rightPriceScale: { borderColor: border, scaleMargins: { top: 0.08, bottom: 0.08 }, mode: scaleMode === 'log' ? 1 : scaleMode === 'percent' ? 2 : 0 },
        timeScale: {
          borderColor: border, timeVisible: true, secondsVisible: false, rightOffset: RIGHT_OFFSET_BARS, barSpacing: 6,
          tickMarkFormatter: (t: Time) => labelFor(t as number, tfRef.current),
        },
        localization: { timeFormatter: (t: Time) => labelFor(t as number, tfRef.current) },
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

      const digits = instRef.current.digits;
      const priceFormat = { type: 'price', precision: digits, minMove: 1 / 10 ** digits } as const;
      const held = candlesRef.current;
      const baseVal = held.length ? held[Math.floor(held.length / 2)]!.close : 0;
      const t = chartTypeRef.current;
      let main: ISeriesApi<SeriesType>;
      if (t === 'candles') main = chart.addSeries(CandlestickSeries, { upColor: up, downColor: down, borderVisible: false, wickUpColor: up, wickDownColor: down, priceFormat });
      else if (t === 'bars') main = chart.addSeries(BarSeries, { upColor: up, downColor: down, priceFormat });
      else if (t === 'line') main = chart.addSeries(LineSeries, { color: accent, lineWidth: 2, priceFormat });
      else if (t === 'area') main = chart.addSeries(AreaSeries, { lineColor: accent, topColor: `${accent}55`, bottomColor: `${accent}05`, lineWidth: 2, priceFormat });
      else main = chart.addSeries(BaselineSeries, { baseValue: { type: 'price', price: baseVal }, topLineColor: up, topFillColor1: `${up}44`, topFillColor2: `${up}08`, bottomLineColor: down, bottomFillColor1: `${down}08`, bottomFillColor2: `${down}44`, priceFormat });
      mainRef.current = main;
      paint();
      if (held.length) snapToLive();

      chart.subscribeCrosshairMove((param) => {
        const d = param.seriesData?.get(main) as (CandlestickData | BarData | LineData) | undefined;
        if (d && 'open' in d && typeof d.open === 'number') { hoverRef.current = true; setLegend({ o: d.open, h: d.high, l: d.low, c: d.close, changePct: d.open ? ((d.close - d.open) / d.open) * 100 : 0 }); }
        else hoverRef.current = false;
      });
      // Scrolled near the left edge ⇒ fetch the page before it (MT5/TradingView lazy history).
      chart.timeScale().subscribeVisibleLogicalRangeChange((range: LogicalRange | null) => {
        if (range && range.from < PAGE_TRIGGER_BARS) loadOlder();
      });

      const put = (s: ISeriesApi<'Line'> | null, tm: UTCTimestamp, v: number | null) => { if (s && v != null) s.update({ time: tm, value: v }); };
      const loop = () => {
        if (disposed) return;
        const last = getLastTick();
        const anchor = anchorRef.current;
        const series = mainRef.current;
        // Ticks after UTC midnight belong to a new seeded day with a new base; pricing them against
        // yesterday's anchor would step the whole chart. The history effect refetches on its own —
        // until it does, leave the last closed bar standing rather than draw a wrong one.
        if (last && anchor && series && utcDateKey(last.t) === anchor.tradeDate) {
          const inst = instRef.current;
          const raw = anchor.base + inst.scale * (valueOfRate(last.rate) - anchor.openValue);
          const f = 10 ** inst.digits;
          const price = Math.round(raw * f) / f;
          const bucket = bucketStartS(Math.floor(last.t / 1000), tfRef.current);
          const buf = candlesRef.current;
          const cur = buf[buf.length - 1];

          let closedOne = false;
          let bar: Candle;
          if (!cur || bucket > cur.time) {
            bar = { time: bucket, open: price, high: price, low: price, close: price };
            buf.push(bar);
            if (buf.length > MAX_HELD_BARS) buf.splice(0, buf.length - MAX_HELD_BARS);
            closedOne = true;
          } else if (bucket < cur.time) {
            bar = cur; // a late tick inside an already-closed bucket: ignore it
          } else {
            cur.high = Math.max(cur.high, price);
            cur.low = Math.min(cur.low, price);
            cur.close = price;
            bar = cur;
          }

          const tm = bar.time as UTCTimestamp;
          const kind = chartTypeRef.current;
          if (kind === 'candles' || kind === 'bars') series.update({ time: tm, open: bar.open, high: bar.high, low: bar.low, close: bar.close } as CandlestickData);
          else series.update({ time: tm, value: bar.close } as LineData);

          if (closedOne) refreshIndicators();
          else {
            const closes = candlesRef.current.map((x) => x.close), on = indRef.current;
            if (on.ma7) put(maFastRef.current, tm, sma(closes, MA.fast).at(-1)!);
            if (on.ma25) put(maMidRef.current, tm, sma(closes, MA.mid).at(-1)!);
            if (on.ma99) put(maSlowRef.current, tm, sma(closes, MA.slow).at(-1)!);
            if (on.bb) { const b = bollinger(closes, BB_PERIOD, BB_MULT).at(-1); if (b) { put(bbUpRef.current, tm, b.upper); put(bbMidRef.current, tm, b.mid); put(bbLoRef.current, tm, b.lower); } }
          }
          if (!hoverRef.current) setLegend(legendOf(bar));
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
    };
  }, [getLastTick, chartType, setFollow, snapToLive, refreshIndicators, paint, loadOlder, scaleMode]);

  // TradingView Supercharts chrome — fixed palette so the whole view reads as a TV/MT5 terminal.
  const pill = 'h-6 min-w-[1.6rem] [@media(pointer:coarse)]:min-h-8 shrink-0 rounded px-1 text-[11px] font-semibold leading-none transition sm:px-1.5';
  const idle = 'text-[#787b86] hover:text-white';
  const active = 'bg-[#2a2e39] text-white';
  const up = (legend?.changePct ?? 0) >= 0;
  const row = 'flex items-center gap-0.5';
  const sep = <span className="mx-1 h-4 w-px shrink-0 bg-[#2a2e39]" aria-hidden />;
  const dp = instrument.digits;

  return (
    <div className="flex h-full w-full flex-col bg-[#131722] text-[#d1d4dc]">
      {/* Toolbar — symbol, the full MT5 period set, tools, and the interface gear. */}
      <div className="flex h-10 shrink-0 items-center gap-0.5 border-b border-[#2a2e39] px-2 text-[12px]">
        <span className="shrink-0 pr-1 text-[13px] font-bold text-white">{instrument.symbol}</span>
        {sep}
        {/* All 21 MT5 periods. The row scrolls rather than wrapping, so the toolbar keeps one height
            on a phone and the chart keeps its own. */}
        <div className={cn(row, 'min-w-0 flex-1 overflow-x-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden')}>
          {TIMEFRAME_KEYS.map((k) => (
            <button key={k} type="button" onClick={() => chooseTf(k)} aria-pressed={tf === k} className={cn(pill, tf === k ? active : idle)}>{k}</button>
          ))}
        </div>
        <div className={cn(row, 'shrink-0')} ref={menuWrapRef}>
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
          <InterfaceModeToggle />
        </div>
      </div>

      {/* Body = left drawing rail + plot (TradingView layout). */}
      <div className="flex min-h-0 flex-1">
        <DrawRail />
        <div className="relative min-h-0 flex-1">
          <div ref={hostRef} className="h-full w-full" aria-label={`${instrument.symbol} price chart`} role="img" />
          <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
            <span className="select-none text-4xl font-black uppercase tracking-widest text-white/[0.04]">{instrument.symbol}</span>
          </div>
          {legend ? (
            // One line, always. Wrapped onto two it covered the top of the plot on a phone, so the
            // full O/H/L/C set appears from `sm` up and a narrow screen gets close + change — which
            // is what MetaTrader's own mobile chart shows.
            <div className="pointer-events-none absolute left-2 top-1.5 z-20 flex items-baseline gap-x-2 overflow-hidden whitespace-nowrap font-mono text-[11px] tabular-nums">
              <span className="font-semibold text-white">{instrument.symbol}</span>
              <span className="text-[#787b86]">{tf}</span>
              <span className="hidden text-[#787b86] sm:inline">O <span className="text-[#d1d4dc]">{legend.o.toFixed(dp)}</span></span>
              <span className="hidden text-[#787b86] sm:inline">H <span className="text-[#d1d4dc]">{legend.h.toFixed(dp)}</span></span>
              <span className="hidden text-[#787b86] sm:inline">L <span className="text-[#d1d4dc]">{legend.l.toFixed(dp)}</span></span>
              <span className="text-[#787b86]">C <span className="text-[#d1d4dc]">{legend.c.toFixed(dp)}</span></span>
              <span className={cn('font-semibold', up ? 'text-[#089981]' : 'text-[#f23645]')}>{up ? '+' : ''}{legend.changePct.toFixed(2)}%</span>
            </div>
          ) : null}
          {loading ? (
            <div className="absolute inset-0 z-20 grid place-items-center bg-[#131722]/70 text-[11px] font-semibold text-[#787b86]">Loading {tf} history…</div>
          ) : null}
          {loadError ? (
            <div className="absolute inset-x-0 top-8 z-20 mx-auto w-fit rounded-md border border-[#2a2e39] bg-[#1b2029] px-3 py-1.5 text-[11px] text-[#787b86]">
              History unavailable ({loadError}) — the live bar is still updating.
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
