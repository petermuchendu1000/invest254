'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  IChartApi, ISeriesApi, UTCTimestamp, CandlestickData, BarData, LineData, Time, SeriesType, LogicalRange,
} from 'lightweight-charts';
import { heikinAshi, heikinAshiBar, type Candle } from '@invest254/shared/chart';
import {
  INDICATOR_BY_ID, INDICATOR_GROUPS, VOLUME_GROUP_NOTE, type Plot,
} from '@/lib/chart/indicatorCatalog';
import { ChartDrawings, type Projection } from '@/components/game/ChartDrawings';
import {
  TOOLS, parseDrawings, serializeDrawings, storageKey, type Drawing, type ToolId,
} from '@/lib/chart/drawings';
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

type MainType = 'candles' | 'bars' | 'line' | 'heikin' | 'area' | 'baseline';
type ScaleMode = 'normal' | 'log' | 'percent';

/**
 * MetaTrader's chart types, under MetaTrader's own names.
 *
 * The desktop has exactly THREE: `ENUM_CHART_MODE` holds CHART_BARS, CHART_CANDLES and CHART_LINE
 * and nothing else, so there is no API surface for a fourth. The labels are the ones its F8
 * Properties dialog uses ("Bar chart", "Candlesticks", "Line chart"), which is better evidence of
 * the live UI than the help prose, and the shortcuts are Alt+1/2/3.
 *
 * MOBILE has a native fourth, Heikin Ashi, listed on both the Android and iPhone chart pages with
 * its formula. This product is phone first, so it belongs here.
 *
 * Area and Baseline are NOT MetaTrader chart types and are not offered. They are not deleted,
 * though: `area` and `baseline` are sellable chart SYSTEMS (migrations 0147 and 0166) that a brand
 * can be assigned or can buy, so a brand that owns one still opens on it and can return to it. That
 * is the one entry this menu adds beyond MetaTrader's set, and only for the brand that paid for it.
 */
const CHART_TYPES: ReadonlyArray<{ id: MainType; label: string }> = [
  { id: 'bars', label: 'Bar chart' },
  { id: 'candles', label: 'Candlesticks' },
  { id: 'line', label: 'Line chart' },
  { id: 'heikin', label: 'Heikin Ashi' },
];
/** The add-on systems that are not MetaTrader types; shown only to the brand that owns one. */
const ADDON_TYPES: ReadonlyArray<{ id: MainType; label: string }> = [
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

/**
 * MetaTrader 5's dark theme, sampled from the product (see lib/ui/mt5.ts for the counts).
 *
 * This used to be TradingView's Supercharts palette — close enough to look deliberate, wrong enough
 * to not be MetaTrader (#131722 against #0f1720, #2962ff against #3183ff). Those near-misses are
 * what stop a copy reading as the real thing. Kept inline because the chart library wants plain
 * strings at construction, not Tailwind classes.
 */
const TV = {
  bg: '#0f1720', surface: '#0f1720', rail: '#202933', border: '#2b3543', grid: 'rgba(43,53,67,0.5)',
  text: '#ffffff', muted: '#8fa2b8', up: '#41be56', down: '#f23645', accent: '#3183ff', info: '#3183ff',
  cross: '#8fa2b8', crossLabel: '#2b3543',
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

/** Which of MetaTrader's indicators are switched on, by catalogue id (lib/chart/indicatorCatalog). */
type Enabled = ReadonlySet<string>;
const IND_STORAGE_KEY = 'pp-chart-indicators';
interface Legend { o: number; h: number; l: number; c: number; changePct: number }
type Anchor = CandlesReply['anchor'];

export function CandleChart({
  getLastTick, requestCandles, status, initialType = 'candles', openPosition = null,
}: {
  getLastTick: () => Tick | null;
  requestCandles: (tf: Timeframe, count: number, to?: number) => Promise<CandlesReply>;
  /** Connection state, so history can be refetched after a drop. */
  status: ConnStatus;
  initialType?: MainType;
  /**
   * The live position, so the chart can draw its level. MetaTrader's `CHART_SHOW_TRADE_LEVELS`
   * draws "levels of open positions, Stop Loss, Take Profit and pending orders"; here only the
   * open-position level exists, for the reason given where it is drawn.
   */
  openPosition?: { entryRate: number | null; direction: 'buy' | 'sell'; lots: string } | null;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const mainRef = useRef<ISeriesApi<SeriesType> | null>(null);
  /**
   * Live indicator series, keyed `<indicatorId>:<plotKey>`, plus the sub-pane each own-pane
   * indicator was given and the marker plugin for the ones MetaTrader draws as arrows.
   *
   * Created on demand rather than up front: the catalogue is long, and pre-creating a series for
   * every plot of every indicator would mean dozens of empty series on a chart showing none.
   */
  const plotsRef = useRef(new Map<string, ISeriesApi<SeriesType>>());
  const markersRef = useRef(new Map<string, { setMarkers: (m: unknown[]) => void }>());
  const lcRef = useRef<typeof import('lightweight-charts') | null>(null);
  /**
   * Heikin Ashi's live state: the bar currently drawn for the newest bucket, and the one before it.
   * A Heikin Ashi bar is defined by its predecessor, so the forming bar cannot be computed from the
   * tick alone, and the library will not accept an update to any bar but the newest.
   */
  const haLastRef = useRef<Candle | null>(null);
  const haPrevRef = useRef<Candle | null>(null);
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
  const [ind, setInd] = useState<Enabled>(() => new Set<string>());
  const indRef = useRef<Enabled>(ind); indRef.current = ind;
  /**
   * The drawing rail's state. `revision` is bumped whenever the visible range moves, which is what
   * re-projects every object onto its bars after a pan or zoom — objects are stored in time/price,
   * so without it they would paint once and then drift away from the candles they mark.
   */
  const [tool, setTool] = useState<ToolId>('cursor');
  const [drawings, setDrawings] = useState<Drawing[]>([]);
  const [selectedDrawing, setSelectedDrawing] = useState<string | null>(null);
  const [plotSize, setPlotSize] = useState({ w: 0, h: 0 });
  const [revision, setRevision] = useState(0);
  const plotRef = useRef<HTMLDivElement>(null);
  const resizeObsRef = useRef<ResizeObserver | null>(null);
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

  // Objects survive a reload, as MetaTrader's do, and are kept per symbol.
  useEffect(() => {
    try { setDrawings(parseDrawings(window.localStorage.getItem(storageKey(instrument.symbol)))); }
    catch { setDrawings([]); }
    setSelectedDrawing(null);
  }, [instrument.symbol]);
  const changeDrawings = useCallback((next: Drawing[]) => {
    setDrawings(next);
    try { window.localStorage.setItem(storageKey(instRef.current.symbol), serializeDrawings(next)); }
    catch { /* private mode — the objects still work for this session */ }
  }, []);

  /**
   * Project between the chart's coordinates and pixels.
   *
   * Read from the live chart on every call rather than captured, because the mapping changes with
   * every pan, zoom and new bar; a captured projection would place objects where the chart USED to
   * be. Returns null off-scale so a half-visible object is clipped rather than drawn at the edge.
   */
  const projection: Projection = {
    xOf: (time) => chartRef.current?.timeScale().timeToCoordinate(time as UTCTimestamp) ?? null,
    yOf: (price) => mainRef.current?.priceToCoordinate(price) ?? null,
    timeOf: (x) => (chartRef.current?.timeScale().coordinateToTime(x) as number | null) ?? null,
    priceOf: (y) => mainRef.current?.coordinateToPrice(y) ?? null,
    barSeconds: TIMEFRAMES[tf] ?? 60,
    digits: instrument.digits,
  };

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

  /**
   * Draw whatever is switched on, and remove whatever is not.
   *
   * Every indicator goes through one path: read its definition from the catalogue, compute its
   * plots, and create or update a series per plot. Nothing here knows what an RSI is — which is why
   * adding an indicator is an entry in the catalogue and no change to this component.
   *
   * It recomputes from the whole bar array rather than appending the newest value, because several
   * of MetaTrader's indicators are displaced (Ichimoku's cloud is drawn 26 bars ahead, the Chikou
   * span 26 behind) and an append cannot place a value in a bar that has not arrived. Only the
   * indicators actually switched on are computed, so the usual cost is one or two passes.
   */
  const refreshIndicators = useCallback(() => {
    const chart = chartRef.current, lc = lcRef.current;
    if (!chart || !lc) return;
    const bars = candlesRef.current;
    const on = indRef.current;
    const live = new Set<string>();

    for (const id of on) {
      const def = INDICATOR_BY_ID.get(id);
      if (!def) continue;
      let plots: Plot[];
      try {
        plots = def.compute(bars);
      } catch {
        // A single bad indicator must never take the chart down with it.
        continue;
      }

      /**
       * An own-pane indicator gets its sub-pane the first time it is switched on.
       *
       * The pane is found by ASKING one of the indicator's existing series which pane it is in,
       * never from a remembered index. Removing a pane renumbers the ones after it, so a cached
       * index silently starts pointing at someone else's pane — which is exactly how the Awesome
       * Oscillator ended up drawing into, and then stranding, a pane that was not its own.
       */
      let paneIndex = 0;
      if (def.pane === 'own') {
        const existing = plots.map((pl) => plotsRef.current.get(`${id}:${pl.key}`)).find((x) => x !== undefined);
        if (existing) paneIndex = existing.getPane().paneIndex();
        else {
          const pane = chart.addPane();
          paneIndex = pane.paneIndex();
          pane.setHeight(Math.max(60, Math.round(chart.paneSize(0).height * 0.22)));
        }
      }

      for (const plot of plots) {
        const key = `${id}:${plot.key}`;
        live.add(key);
        if (plot.kind === 'markers') {
          const main = mainRef.current;
          if (!main) continue;
          const marks = bars.flatMap((b, i) => {
            const v = plot.values[i];
            return v === null || v === undefined ? [] : [{
              time: b.time as UTCTimestamp,
              position: plot.markerUp ? 'aboveBar' : 'belowBar',
              color: plot.color,
              shape: plot.markerUp ? 'arrowDown' : 'arrowUp',
            }];
          });
          let api = markersRef.current.get(key);
          if (!api) {
            api = lc.createSeriesMarkers(main, []) as unknown as { setMarkers: (m: unknown[]) => void };
            markersRef.current.set(key, api);
          }
          api.setMarkers(marks);
          continue;
        }

        let series = plotsRef.current.get(key);
        if (!series) {
          const common = { priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false };
          series = plot.kind === 'histogram'
            ? chart.addSeries(lc.HistogramSeries, { ...common, color: plot.color }, paneIndex)
            : chart.addSeries(lc.LineSeries, {
                ...common,
                color: plot.color,
                lineWidth: plot.width ?? 1,
                lineStyle: plot.style === 'dotted' ? lc.LineStyle.Dotted : plot.style === 'dashed' ? lc.LineStyle.Dashed : lc.LineStyle.Solid,
              }, paneIndex);
          plotsRef.current.set(key, series);
          // MetaTrader's reference levels (RSI's 30/70, a zero line) belong to the pane, so they are
          // drawn once on the indicator's first plot.
          if (def.levels && plot === plots[0]) {
            for (const level of def.levels) {
              series.createPriceLine({ price: level, color: TV.grid, lineWidth: 1, lineStyle: lc.LineStyle.Dashed, axisLabelVisible: false, title: '' });
            }
          }
        }
        series.setData(asLine(bars, plot.values));
      }
    }

    // Anything left over belongs to an indicator that has been switched off.
    for (const [key, series] of plotsRef.current) {
      if (live.has(key)) continue;
      try { chart.removeSeries(series); } catch { /* already gone with its pane */ }
      plotsRef.current.delete(key);
    }
    for (const [key, api] of markersRef.current) {
      if (live.has(key)) continue;
      try { api.setMarkers([]); } catch { /* the main series was rebuilt */ }
      markersRef.current.delete(key);
    }
    // Panes need no cleanup of their own: `addPane()` without `preserveEmptyPane` lets the chart
    // drop a pane once its last series goes, which the loop above has just done.
    for (let i = chart.panes().length - 1; i >= 1; i--) {
      const pane = chart.panes()[i];
      if (pane && pane.getSeries().length === 0) {
        try { chart.removePane(i); } catch { /* already gone */ }
      }
    }
  }, []);
  useEffect(() => { refreshIndicators(); }, [ind, refreshIndicators]);

  /** Toggle one indicator, and remember the set across sessions as MetaTrader does. */
  const toggleIndicator = useCallback((id: string) => {
    setInd((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      try { window.localStorage.setItem(IND_STORAGE_KEY, JSON.stringify([...next])); } catch { /* blocked storage */ }
      return next;
    });
  }, []);

  // Restore the indicators the player last had on.
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(IND_STORAGE_KEY);
      if (!raw) return;
      const ids = (JSON.parse(raw) as unknown);
      if (Array.isArray(ids)) setInd(new Set(ids.filter((x): x is string => typeof x === 'string' && INDICATOR_BY_ID.has(x))));
    } catch { /* private mode / corrupt value — no indicators is a fine default */ }
  }, []);

  /**
   * The crosshair tool is not a drawing tool — it switches the chart's own crosshair to MAGNET,
   * which snaps it to the nearest OHLC value. That is what the icon means in MetaTrader, and it is
   * why the tool belongs on the rail beside the objects rather than in the settings menu.
   */
  useEffect(() => {
    const chart = chartRef.current, lc = lcRef.current;
    if (!chart || !lc) return;
    chart.applyOptions({ crosshair: { mode: tool === 'crosshair' ? lc.CrosshairMode.Magnet : lc.CrosshairMode.Normal } });
  }, [tool]);

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
    if (t === 'heikin') {
      const ha = heikinAshi(data);
      main.setData(ha as unknown as CandlestickData[]);
      haLastRef.current = ha.length ? ha[ha.length - 1]! : null;
      haPrevRef.current = ha.length > 1 ? ha[ha.length - 2]! : null;
    }
    else if (t === 'candles' || t === 'bars') main.setData(data as unknown as (CandlestickData | BarData)[]);
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
      // Held so indicators can add their own series and panes after the chart exists.
      lcRef.current = lc;
      const up = TV.up, down = TV.down, accent = TV.accent, info = TV.info, border = TV.border;

      const chart = createChart(host, {
        autoSize: true,
        layout: { background: { type: ColorType.Solid, color: TV.bg }, textColor: TV.text, fontSize: 11, attributionLogo: true },
        grid: { vertLines: { color: TV.grid }, horzLines: { color: TV.grid } },
        // The price axis is MetaTrader's second control surface, not decoration: it is where the
        // vertical scale is set. `visible` and `minimumWidth` are stated rather than left to the
        // library's defaults so a narrow phone cannot be the one layout that drops it, and
        // `autoScale` is the state the double-click below returns to.
        rightPriceScale: {
          visible: true,
          minimumWidth: 56,
          autoScale: true,
          borderColor: border,
          scaleMargins: { top: 0.08, bottom: 0.08 },
          mode: scaleMode === 'log' ? 1 : scaleMode === 'percent' ? 2 : 0,
        },
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
        // MT5's axis gestures, both of them. Dragging the PRICE axis stretches and compresses the
        // vertical scale (`price: true`, which was off, so the y-axis was the one thing on this
        // chart that could not be zoomed), and double-clicking either axis returns it to auto-fit.
        handleScale: {
          mouseWheel: true,
          pinch: true,
          axisPressedMouseMove: { time: true, price: true },
          axisDoubleClickReset: { time: true, price: true },
        },
      });
      chartRef.current = chart;

      const digits = instRef.current.digits;
      const priceFormat = { type: 'price', precision: digits, minMove: 1 / 10 ** digits } as const;
      const held = candlesRef.current;
      const baseVal = held.length ? held[Math.floor(held.length / 2)]!.close : 0;
      const t = chartTypeRef.current;
      let main: ISeriesApi<SeriesType>;
      if (t === 'candles' || t === 'heikin') main = chart.addSeries(CandlestickSeries, { upColor: up, downColor: down, borderVisible: false, wickUpColor: up, wickDownColor: down, priceFormat });
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
        // Objects live in time/price, so every view change has to re-project them onto their bars.
        setRevision((r) => r + 1);
      });

      // Keep the drawing surface the size of the plot, so its coordinate space is the chart's.
      const measurePlot = () => {
        const el = plotRef.current;
        if (el) setPlotSize({ w: el.clientWidth, h: el.clientHeight });
      };
      measurePlot();
      const ro = new ResizeObserver(measurePlot);
      if (plotRef.current) ro.observe(plotRef.current);
      resizeObsRef.current = ro;

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
          if (kind === 'heikin') {
            // Only ever the NEWEST bar: the library refuses an update to an older one, and the
            // formula needs nothing more than the bar before this one.
            const last = haLastRef.current;
            if (last && last.time !== bar.time) haPrevRef.current = last;
            const ha = heikinAshiBar(bar, haPrevRef.current);
            haLastRef.current = ha;
            series.update({ time: ha.time as UTCTimestamp, open: ha.open, high: ha.high, low: ha.low, close: ha.close } as CandlestickData);
          } else if (kind === 'candles' || kind === 'bars') {
            series.update({ time: tm, open: bar.open, high: bar.high, low: bar.low, close: bar.close } as CandlestickData);
          } else {
            series.update({ time: tm, value: bar.close } as LineData);
          }

          // One path for both cases. Appending only the newest value cannot work once displaced
          // indicators are in play, and recomputing costs a pass per switched-on indicator.
          if (indRef.current.size > 0) refreshIndicators();
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
      resizeObsRef.current?.disconnect();
      resizeObsRef.current = null;
      chartRef.current = mainRef.current = lcRef.current = null;
      // The chart owned every indicator series and pane, so dropping the registries is the cleanup —
      // leaving stale handles behind would have the next chart draw onto a disposed one.
      plotsRef.current.clear();
      markersRef.current.clear();
    };
  }, [getLastTick, chartType, setFollow, snapToLive, refreshIndicators, paint, loadOlder, scaleMode]);

  // TradingView Supercharts chrome — fixed palette so the whole view reads as a TV/MT5 terminal.
  const pill = 'h-6 min-w-[1.6rem] [@media(pointer:coarse)]:min-h-8 shrink-0 rounded px-1 text-[11px] font-semibold leading-none transition sm:px-1.5';
  const idle = 'text-[#8fa2b8] hover:text-white';
  const active = 'bg-[#2b3543] text-white';
  const up = (legend?.changePct ?? 0) >= 0;
  const row = 'flex items-center gap-0.5';
  /**
   * MetaTrader's trade levels.
   *
   * `CHART_SHOW_TRADE_LEVELS` draws the levels of open positions, Stop Loss, Take Profit and
   * pending orders. Only the first of those can exist here, and the reasons are worth stating
   * because they are not laziness:
   *   - there are no pending orders: every contract is market execution;
   *   - the Stop Loss has no price level at all. A losing contract cannot be closed early, so the
   *     whole downside is the stake and no price would ever trigger a stop;
   *   - the Take Profit is an amount rather than a price, because the payout rises with elapsed
   *     time rather than with price, so it has no line to sit on either.
   * Drawing a stop line at a made-up price would be the exact invention this rebuild is undoing.
   *
   * Colour: MetaTrader draws position levels in the `Volumes` colour (CHART_COLOR_VOLUME is
   * documented as "Color of volumes and position opening levels"), which is Green in the one
   * scheme MetaQuotes publishes values for. The dark schemes' values are undocumented, so this
   * uses the terminal's own green rather than inventing a hex and calling it MetaTrader's.
   */
  useEffect(() => {
    const series = mainRef.current;
    const anchor = anchorRef.current;
    const lc = lcRef.current;
    if (!series || !anchor || !lc) return;
    const rate = openPosition?.entryRate ?? null;
    if (rate === null || !openPosition) return;
    const inst = instRef.current;
    const price = anchor.base + inst.scale * (valueOfRate(rate) - anchor.openValue);
    if (!Number.isFinite(price)) return;
    const line = series.createPriceLine({
      price,
      color: TV.up,
      lineWidth: 1,
      lineStyle: lc.LineStyle.Solid,
      axisLabelVisible: true,
      title: `${openPosition.direction} ${openPosition.lots}`,
    });
    return () => { try { series.removePriceLine(line); } catch { /* series already gone */ } };
  }, [openPosition?.entryRate, openPosition?.direction, openPosition?.lots, revision]);

  const sep = <span className="mx-1 h-4 w-px shrink-0 bg-[#2b3543]" aria-hidden />;
  const dp = instrument.digits;

  return (
    <div className="flex h-full w-full flex-col bg-[#0f1720] text-[#ffffff]">
      {/* Toolbar — symbol, the full MT5 period set, tools, and the interface gear. */}
      <div className="flex h-10 shrink-0 items-center gap-0.5 border-b border-[#2b3543] px-2 text-[12px]">
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
              <div className="absolute right-0 top-8 z-30 max-h-[70vh] w-60 overflow-y-auto overscroll-contain rounded-lg border border-[#2b3543] bg-[#0f1720] p-2 text-left shadow-xl">
                <Section title="Chart type">
                  <div className="grid grid-cols-3 gap-1">
                    {[...CHART_TYPES, ...ADDON_TYPES.filter((a) => a.id === initialType)].map((c) => (
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
                {/* MetaTrader's Navigator tree: its groups, its order, its names. Scrolls because the
                    list is long — which is the point of it. */}
                {INDICATOR_GROUPS.map((g) => (
                  <Section key={g.group} title={g.label}>
                    <div className="grid gap-1">
                      {g.items.map((def) => (
                        <Toggle key={def.id} on={ind.has(def.id)} onClick={() => toggleIndicator(def.id)}>
                          <span className="truncate">{def.name} <span className="text-[9px] opacity-70">{def.params}</span></span>
                        </Toggle>
                      ))}
                    </div>
                  </Section>
                ))}
                <Section title="Volumes">
                  <p className="px-0.5 text-[9px] leading-snug text-muted">{VOLUME_GROUP_NOTE}</p>
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
        <DrawRail
          tool={tool}
          onPick={(id) => {
            if (id === 'trash') {
              // Delete the selected object, or clear the lot when nothing is selected — which is
              // what a bin with no selection can only sensibly mean.
              changeDrawings(selectedDrawing ? drawings.filter((d) => d.id !== selectedDrawing) : []);
              setSelectedDrawing(null);
              return;
            }
            setSelectedDrawing(null);
            setTool(id);
          }}
          count={drawings.length}
          hasSelection={selectedDrawing !== null}
        />
        <div ref={plotRef} className="relative min-h-0 flex-1">
          <div ref={hostRef} className="h-full w-full" aria-label={`${instrument.symbol} price chart`} role="img" />
          <ChartDrawings
            tool={tool}
            project={projection}
            drawings={drawings}
            onChange={changeDrawings}
            // MetaTrader drops back to the cursor once an object is placed, rather than drawing a
            // second one on the next tap.
            onToolDone={() => setTool('cursor')}
            selected={selectedDrawing}
            onSelect={setSelectedDrawing}
            width={plotSize.w}
            height={plotSize.h}
            revision={revision}
          />
          <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
            <span className="select-none text-4xl font-black uppercase tracking-widest text-white/[0.04]">{instrument.symbol}</span>
          </div>
          {legend ? (
            // One line, always. Wrapped onto two it covered the top of the plot on a phone, so the
            // full O/H/L/C set appears from `sm` up and a narrow screen gets close + change — which
            // is what MetaTrader's own mobile chart shows.
            <div className="pointer-events-none absolute left-2 top-1.5 z-20 flex items-baseline gap-x-2 overflow-hidden whitespace-nowrap font-mono text-[11px] tabular-nums">
              <span className="font-semibold text-white">{instrument.symbol}</span>
              <span className="text-[#8fa2b8]">{tf}</span>
              <span className="hidden text-[#8fa2b8] sm:inline">O <span className="text-[#ffffff]">{legend.o.toFixed(dp)}</span></span>
              <span className="hidden text-[#8fa2b8] sm:inline">H <span className="text-[#ffffff]">{legend.h.toFixed(dp)}</span></span>
              <span className="hidden text-[#8fa2b8] sm:inline">L <span className="text-[#ffffff]">{legend.l.toFixed(dp)}</span></span>
              <span className="text-[#8fa2b8]">C <span className="text-[#ffffff]">{legend.c.toFixed(dp)}</span></span>
              <span className={cn('font-semibold', up ? 'text-[#41be56]' : 'text-[#f23645]')}>{up ? '+' : ''}{legend.changePct.toFixed(2)}%</span>
            </div>
          ) : null}
          {loading ? (
            <div className="absolute inset-0 z-20 grid place-items-center bg-[#0f1720]/70 text-[11px] font-semibold text-[#8fa2b8]">Loading {tf} history…</div>
          ) : null}
          {loadError ? (
            <div className="absolute inset-x-0 top-8 z-20 mx-auto w-fit rounded-md border border-[#2b3543] bg-[#0f1720] px-3 py-1.5 text-[11px] text-[#8fa2b8]">
              History unavailable ({loadError}). The live bar is still updating.
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/**
 * Left drawing rail — MetaTrader's object toolbar, and it draws.
 *
 * It used to be eight icons that did nothing: "cosmetic chrome that completes the terminal look".
 * Each one now selects a real tool (see lib/chart/drawings for the geometry, ChartDrawings for the
 * surface). `crosshair` is not a drawing tool — it switches the chart's own crosshair to magnet
 * mode, which is what the icon means in MetaTrader.
 */
function DrawRail({
  tool, onPick, count, hasSelection,
}: {
  tool: ToolId;
  onPick: (id: ToolId) => void;
  count: number;
  hasSelection: boolean;
}) {
  return (
    <div className="flex w-10 shrink-0 flex-col items-center gap-1 border-r border-[#2b3543] bg-[#202933] py-1.5">
      {TOOLS.map((t) => (
        <button
          key={t.id}
          type="button"
          title={t.label}
          aria-label={t.label}
          aria-pressed={tool === t.id}
          onClick={() => onPick(t.id)}
          className={cn(
            'grid h-8 w-8 shrink-0 place-items-center rounded-md transition',
            tool === t.id ? 'bg-[#3183ff] text-white' : 'text-[#8fa2b8] hover:bg-[#2b3543] hover:text-white',
          )}
        >
          <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d={t.icon} />
          </svg>
        </button>
      ))}
      {/* The bin deletes the selected object, or clears the chart when nothing is selected. Disabled
          with nothing to remove, so it never looks like it did something it could not. */}
      <button
        type="button"
        title={hasSelection ? 'Delete selected object' : 'Clear all objects'}
        aria-label={hasSelection ? 'Delete selected object' : 'Clear all objects'}
        onClick={() => onPick('trash')}
        disabled={count === 0}
        className={cn(
          'mt-auto grid h-8 w-8 shrink-0 place-items-center rounded-md transition',
          count === 0 ? 'cursor-not-allowed text-[#2b3543]' : 'text-[#8fa2b8] hover:bg-[#2b3543] hover:text-[#f23645]',
        )}
      >
        <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M5 7h14M9 7V5h6v2M7 7l1 13h8l1-13" />
        </svg>
      </button>
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
