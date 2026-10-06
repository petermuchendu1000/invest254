'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type {
  IChartApi, ISeriesApi, UTCTimestamp, CandlestickData, BarData, LineData, Time, SeriesType, LogicalRange,
} from 'lightweight-charts';
import { heikinAshi, heikinAshiBar, type Candle } from '@invest254/shared/chart';
import {
  INDICATOR_BY_ID, INDICATOR_GROUPS, VOLUME_GROUP_NOTE, type Plot,
} from '@/lib/chart/indicatorCatalog';
import { ChartDrawings, DrawingsBackdrop, type Projection } from '@/components/game/ChartDrawings';
import {
  TOOLS, parseDrawings, serializeDrawings, storageKey, type Drawing, type DrawingKind, type ToolId,
} from '@/lib/chart/drawings';
import { OBJECT_GROUPS, objectOf } from '@/lib/chart/objects';
import {
  atLiveEdge, widthOf, liveWindow, clampBars, zoomedWindow, RIGHT_OFFSET_BARS,
} from '@/lib/chart/follow';
import type { Colours } from '@/lib/chart/chartProperties';
import {
  DEFAULT_PROPERTIES, parseProperties, serializeProperties, storageKey as propsKey,
  type ChartKind, type ChartProperties,
} from '@/lib/chart/chartProperties';
import { MT5ChartProperties } from '@/components/game/MT5ChartProperties';
import { MT5ObjectMenu, type ObjectMenuAt } from '@/components/game/MT5ObjectMenu';
import { MT5ObjectsList } from '@/components/game/MT5ObjectsList';
import { MT5ObjectProperties } from '@/components/game/MT5ObjectProperties';
import { useNavDrawer } from '@/lib/ui/drawer';
import { MT5ChartLevels } from '@/components/game/mobile/MT5ChartLevels';
import { useOneClickStore, useRestoreOneClick } from '@/lib/game/oneClick';
import { useAlertsStore, ALERT_DEFAULTS } from '@/lib/game/alerts';
import {
  MOBILE_TF_GROUPS, MAX_QUICK_TF, mobileTfLabel, useQuickTfStore, useRestoreQuickTf,
} from '@/lib/game/mobileTimeframes';
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
 *   - periods M1…MN1 · chart type Bars · Candlesticks · Line · Heikin Ashi
 *   - Chart Properties (F8): Common, Show and Colors, which is where the scale is pinned. There is
 *     no price-scale TYPE, because MetaTrader has neither a logarithmic nor a percentage scale.
 *   - all 38 MetaTrader indicators, in its four Navigator groups
 *   - all 44 MetaTrader objects, with the Objects List (Ctrl+B) and Object Properties
 *   - scroll back to load older history · −/+ zoom · live snap-back
 *   - wheel/pinch zoom · drag-to-pan · crosshair · OHLC legend (tracks the crosshair)
 *   - LOCAL-timezone time axis + crosshair · faint symbol watermark · left drawing rail
 *
 * Lightweight Charts is imported dynamically inside the effect so it never runs during SSR.
 */

type MainType = 'candles' | 'bars' | 'line' | 'heikin' | 'area' | 'baseline';

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
/**
 * The chart types a surface may offer, which is not the same list on both.
 *
 * `docs/mt5/03-chart-ui.md` 18-19 and 47-50: "Heikin Ashi is a native chart type on MOBILE but not
 * on desktop. The single biggest desktop/mobile divergence in the chart." On desktop MetaTrader has
 * exactly three (`ENUM_CHART_MODE` has three members and no API surface for a fourth) and ships
 * Heikin Ashi only as a bundled custom indicator, so offering it as a fourth type on the desktop
 * menu is one step past the fact. Dropping Area and Baseline from this list was right for the same
 * reason; this is the one that was missed.
 *
 * A chart already SET to Heikin Ashi still lists it, on either surface, because hiding the option
 * that is currently in force would leave a trader looking at bars they cannot name or change back
 * from. That is the same rule `ADDON_TYPES` already uses for a brand's own extra type.
 */
function chartTypesFor(phone: boolean, current: MainType): ReadonlyArray<{ id: MainType; label: string }> {
  return phone ? CHART_TYPES : CHART_TYPES.filter((c) => c.id !== 'heikin' || current === 'heikin');
}
/** The add-on systems that are not MetaTrader types; shown only to the brand that owns one. */
const ADDON_TYPES: ReadonlyArray<{ id: MainType; label: string }> = [
  { id: 'area', label: 'Area' }, { id: 'baseline', label: 'Baseline' },
];
/**
 * The same three types as `CHART_KINDS`, under the CONTEXT MENU's spelling of them.
 *
 * The two surfaces really do disagree in MetaTrader. Its menu screenshot reads `Bar Chart` /
 * `Candlesticks` / `Line Chart` (docs/mt5/08-chart-properties.md:499-501) while its Properties
 * dialog reads `Bar chart` / `Candlesticks` / `Line chart`, and the doc records the casing clash as
 * one of the six places MetaQuotes' prose and its own screenshot differ, with the screenshot
 * winning for the menu (:547-549). Copying the dialog's casing here would quietly resolve a
 * difference the doc went to the trouble of measuring, so the menu carries its own labels and
 * `CHART_KINDS` keeps the dialog's.
 */
const MENU_CHART_TYPES: ReadonlyArray<{ id: ChartKind; label: string; accel: string }> = [
  { id: 'bars', label: 'Bar Chart', accel: 'Alt+1' },
  { id: 'candles', label: 'Candlesticks', accel: 'Alt+2' },
  { id: 'line', label: 'Line Chart', accel: 'Alt+3' },
];
/**
 * There is no price-scale TYPE here, and that is deliberate.
 *
 * MetaTrader has no logarithmic and no percentage price scale: `ENUM_CHART_PROPERTY_INTEGER` and
 * `_DOUBLE` carry no such property, the Chart Settings dialog offers no such control, Options >
 * Charts has none, and MQL5's own moderator states the terminal "always uses a linear scale for
 * price representation". The `Linear | Log | Percent` row this menu used to carry was TradingView's,
 * so it is gone rather than relabelled. What MetaTrader offers instead is three ways of PINNING the
 * scale, and they live on Chart Properties' Common tab (see lib/chart/chartProperties).
 */

const DEFAULT_TF: Timeframe = 'M1';
const TF_STORAGE_KEY = 'pp:chart:tf';
/** Bars fetched on open, and per page when scrolling back. */
const INITIAL_BARS = 500, PAGE_BARS = 500;
/** Load older history once the view comes within this many bars of the left edge. */
const PAGE_TRIGGER_BARS = 40;
/** Ceiling on bars held client-side, so a long session cannot grow without bound. */
const MAX_HELD_BARS = 6000;

const ZOOM_STEP = 0.7;
/**
 * There is no "resume following" timer, and that is the fix rather than an omission.
 *
 * A three-second timer used to fire on any wheel, pointerdown or touchstart anywhere on the chart
 * and force a hard-coded 120-bar window at the live edge, so zooming in on one candle was undone a
 * moment later at a zoom the trader never chose. MetaTrader has one rule instead, and it is in
 * lib/chart/follow.ts: a NEW BAR scrolls to the latest bar if the chart was already showing it,
 * keeping the window's width.
 */

/**
 * MetaTrader 5's dark theme, sampled from the product (see lib/ui/mt5.ts for the counts).
 *
 * This used to be TradingView's Supercharts palette — close enough to look deliberate, wrong enough
 * to not be MetaTrader (#131722 against #0f1720, #2962ff against #3183ff). Those near-misses are
 * what stop a copy reading as the real thing. Kept inline because the chart library wants plain
 * strings at construction, not Tailwind classes.
 */
/**
 * The chart's palette, resolved from MetaTrader's thirteen Chart Properties colours.
 *
 * It used to be a frozen constant, which made the Colors tab impossible: thirteen controls that
 * stored a value and changed nothing. Each slot below now names which of MetaTrader's fields feeds
 * it, and two of them carry MetaTrader's own extra meanings: `Volumes` also colours position opening
 * levels, and `Line chart` also colours Doji candlesticks.
 *
 * `rail`, `accent` and `muted` are this terminal's chrome rather than chart colours; MetaTrader has
 * no field for them, so they do not move with the scheme.
 */
function themeOf(c: Colours) {
  return {
    bg: c.background,
    surface: c.background,
    rail: '#202933',
    border: '#2b3543',
    grid: c.grid,
    text: c.foreground,
    muted: '#8fa2b8',
    up: c.bullCandle,
    down: c.bearCandle,
    barUp: c.barUp,
    barDown: c.barDown,
    line: c.lineChart,
    volumes: c.volumes,
    lastLine: c.lastLine,
    stopLevels: c.stopLevels,
    accent: '#3183ff',
    info: '#3183ff',
    cross: c.foreground,
    crossLabel: '#2b3543',
  };
}

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
  getLastTick, requestCandles, status, initialType = 'candles', openPosition = null, symbol,
  phone = false, levelStakeCents = 0, fullScreen, onFullScreen,
}: {
  getLastTick: () => Tick | null;
  requestCandles: (tf: Timeframe, count: number, to?: number) => Promise<CandlesReply>;
  /**
   * The symbol this chart is drawing, when the caller is tracking one.
   *
   * It is not used to FETCH anything — `requestCandles` is already bound to it by the caller — only
   * to tell the live edge which instrument the bars it is extending belong to. Between a symbol
   * change and the new history landing, `getLastTick` is already the new symbol's while the anchor
   * is still the old one, and pricing one against the other would draw a bar at a price that never
   * existed on either instrument.
   */
  symbol?: string | undefined;
  /** Connection state, so history can be refetched after a drop. */
  status: ConnStatus;
  initialType?: MainType;
  /**
   * The live position, so the chart can draw its level. MetaTrader's `CHART_SHOW_TRADE_LEVELS`
   * draws "levels of open positions, Stop Loss, Take Profit and pending orders"; here only the
   * open-position level exists, for the reason given where it is drawn.
   */
  openPosition?: { entryRate: number | null; direction: 'buy' | 'sell'; lots: string } | null;
  /**
   * Draw MetaTrader's PHONE chrome instead of its desktop chrome.
   *
   * The two are different screens, not the same screen at two widths. MetaTrader's desktop chart
   * carries a period strip of all 21 periods, a Tools menu and a left object rail; its phone chart
   * carries six icons on one row (`☰ ✛ ∿ M30 ◐ ▭`) and NO object rail at all — on Android,
   * graphical objects are reached only through the radial menu. The desktop bar on a 360px screen
   * truncated at M5 and the rail took 40 of those 360 pixels, which is why this prop exists.
   */
  phone?: boolean;
  /**
   * What a contract at the current volume risks, which is the money figure MetaTrader shows while a
   * Stop Loss level is dragged. Phone only; zero where the caller has no ticket behind it.
   */
  levelStakeCents?: number | undefined;
  /**
   * Phone, landscape only: MetaTrader's full-screen, with the app's tab bar hidden.
   *
   * Undefined in portrait, where MetaTrader has no such mode, so the bar does not offer a control
   * that would do nothing.
   */
  fullScreen?: boolean | undefined;
  onFullScreen?: ((full: boolean) => void) | undefined;
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
  /** The requested symbol, read inside the animation loop, which never re-renders. */
  const symbolRef = useRef(symbol);
  symbolRef.current = symbol;
  const hoverRef = useRef(false);
  const menuWrapRef = useRef<HTMLDivElement>(null);
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
  /**
   * MetaTrader's Common tab carries three of the four chart types this chart draws. Picking one
   * there and picking one on the toolbar must be the same act, so the dialog writes through to the
   * chart type rather than keeping a second copy of it.
   */
  const chartTypeRef = useRef<MainType>(initialType); chartTypeRef.current = chartType;
  const [ind, setInd] = useState<Enabled>(() => new Set<string>());
  const indRef = useRef<Enabled>(ind); indRef.current = ind;
  /**
   * The drawing rail's state. `revision` is bumped whenever the visible range moves, which is what
   * re-projects every object onto its bars after a pan or zoom — objects are stored in time/price,
   * so without it they would paint once and then drift away from the candles they mark.
   */
  const [tool, setTool] = useState<ToolId>('cursor');
  const [drawings, setDrawings] = useState<Drawing[]>([]);
  /**
   * The current objects, read outside React's update cycle, and written beside every `setDrawings`.
   *
   * The undo stack is pushed to from here, NOT from inside a `setDrawings` updater: React may run
   * an updater more than once for the same change, which would push one deletion onto the stack
   * twice and make the first Undo Delete restore it and the second restore it again.
   */
  const drawingsRef = useRef<Drawing[]>([]);
  const [selectedDrawing, setSelectedDrawing] = useState<string | null>(null);
  const [objectsListOpen, setObjectsListOpen] = useState(false);
  const [propertiesFor, setPropertiesFor] = useState<string | null>(null);
  const [objectMenu, setObjectMenu] = useState<ObjectMenuAt | null>(null);
  /**
   * Chart Properties (F8), per SYMBOL: MetaTrader titles the dialog "Properties of EURUSD,M1"
   * because the settings belong to that chart window and not to the terminal.
   */
  const [propertiesOpen, setPropertiesOpen] = useState(false);
  const [props, setProps] = useState<ChartProperties>(DEFAULT_PROPERTIES);
  const [plotSize, setPlotSize] = useState({ w: 0, h: 0 });
  const [revision, setRevision] = useState(0);
  const plotRef = useRef<HTMLDivElement>(null);
  const resizeObsRef = useRef<ResizeObserver | null>(null);
  const followingRef = useRef(true);
  /**
   * MetaTrader's "Chart auto scroll", read from inside the animation loop.
   *
   * A ref because the loop is installed once and closes over what it can see; the value read at
   * install time would never change again.
   */
  const autoScrollRef = useRef(true);
  autoScrollRef.current = props.autoScroll;
  /** The last `scaleFix` written to the price scale, so the effect below writes it only on change. */
  const scaleFixAppliedRef = useRef<boolean | null>(null);
  /**
   * MetaTrader's "Free chart movement": the vertical scale is the trader's, not the bars'.
   *
   * True once the price axis has been dragged, and it is what keeps that stretch: the library sets
   * its own `autoScale: false` on the drag, and this stops the app writing `true` back over it.
   * MetaTrader's "Auto scale" and "Reset vertical scale" commands are the two ways out.
   */
  const [priceManual, setPriceManual] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  /**
   * Where MetaTrader's chart background context menu is open, in client pixels, or null.
   *
   * Right-clicking the plot did nothing at all before this: the browser's own menu was not even
   * suppressed. On the desktop terminal that menu is the primary route to the chart's commands
   * (docs/mt5/08-chart-properties.md:482-524), so everything it offers that this platform has was
   * reachable only through the ⚙ Tools menu and the left rail.
   */
  /**
   * Where the chart menu was opened, and at WHAT PRICE.
   *
   * MetaTrader's menu is built around the price under the cursor: its first rows are
   * `Sell Limit 1  219.306` and a `Trading ▸` submenu whose every row carries that same level
   * (docs/mt5/08-chart-properties.md:490, 527). Without the price the menu is just a list of
   * commands; with it, the menu is about the point on the chart that was clicked.
   */
  const [chartMenu, setChartMenu] = useState<{ x: number; y: number; price: number | null } | null>(null);
  /**
   * MetaTrader's `One Click Trading` (Alt+T), which is a terminal setting rather than a chart one:
   * the same flag the phone's one-click panel fires from, so switching it here switches it there.
   */
  const oneClick = useOneClickStore((s) => s.instant);
  const setOneClick = useOneClickStore((s) => s.setInstant);
  useRestoreOneClick();
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
    let restored: Drawing[] = [];
    try { restored = parseDrawings(window.localStorage.getItem(storageKey(instrument.symbol))); }
    catch { restored = []; }
    drawingsRef.current = restored;
    setDrawings(restored);
    setSelectedDrawing(null);
    // A different symbol's objects are a different chart's: nothing deleted on the old one is
    // restorable onto this one.
    undoRef.current = [];
    setCanUndoDelete(false);
    try { setProps(parseProperties(window.localStorage.getItem(propsKey(instrument.symbol)))); }
    catch { setProps(DEFAULT_PROPERTIES); }
  }, [instrument.symbol]);

  const changeProps = useCallback((next: ChartProperties) => {
    setProps(next);
    try { window.localStorage.setItem(propsKey(instRef.current.symbol), serializeProperties(next)); }
    catch { /* private mode — the settings still hold for this session */ }
  }, []);

  // F8, which is MetaTrader's own shortcut for this dialog.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el !== null && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
      if (e.key === 'F8') { e.preventDefault(); setPropertiesOpen((v) => !v); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  /**
   * Every deletion is recorded so MetaTrader's "Undo Delete" can restore it.
   *
   * It is captured HERE rather than at each delete button, because objects are removed from four
   * places (the rail's bin, the Objects List, the Delete and Backspace keys, the context menu) and
   * an undo that only covered some of them would be worse than none.
   */
  const undoRef = useRef<Drawing[][]>([]);
  const [canUndoDelete, setCanUndoDelete] = useState(false);
  const persistDrawings = useCallback((next: Drawing[]) => {
    drawingsRef.current = next;
    setDrawings(next);
    try { window.localStorage.setItem(storageKey(instRef.current.symbol), serializeDrawings(next)); }
    catch { /* private mode — the objects still work for this session */ }
  }, []);

  const changeDrawings = useCallback((next: Drawing[]) => {
    const kept = new Set(next.map((d) => d.id));
    const removed = drawingsRef.current.filter((d) => !kept.has(d.id));
    if (removed.length > 0) {
      undoRef.current = [...undoRef.current.slice(-19), removed];
      setCanUndoDelete(true);
    }
    persistDrawings(next);
  }, [persistDrawings]);

  /** MetaTrader's "Undo Delete": "restore the last deleted object". */
  const undoDelete = useCallback(() => {
    const batch = undoRef.current.pop();
    setCanUndoDelete(undoRef.current.length > 0);
    if (!batch || batch.length === 0) return;
    const prev = drawingsRef.current;
    persistDrawings([...prev, ...batch.filter((d) => !prev.some((p) => p.id === d.id))]);
  }, [persistDrawings]);

  /**
   * MetaTrader's Objects List "Show": scroll the chart until the object is on screen.
   *
   * The object's own time span sets the range, with a margin either side so it does not land
   * against the edge, and a single-anchor object (a horizontal line, an arrow) gets the current
   * window's width centred on it rather than a zero-width range.
   */
  const showObject = useCallback((id: string) => {
    const chart = chartRef.current;
    const d = drawings.find((x) => x.id === id);
    if (!chart || !d || d.points.length === 0) return;
    const times = d.points.map((pt) => pt.time);
    const from = Math.min(...times), to = Math.max(...times);
    const bar = TIMEFRAMES[tf] ?? 60;
    const pad = Math.max(bar * 8, (to - from) * 0.15);
    try {
      chart.timeScale().setVisibleRange({
        from: ((from - pad) as unknown) as UTCTimestamp,
        to: ((to + pad) as unknown) as UTCTimestamp,
      });
      // Scrolling away from the live edge means the chart must stop snapping back to it.
      followingRef.current = false;
    } catch { /* the object is outside the loaded history; the list still selected it */ }
  }, [drawings, tf]);

  // Ctrl+B, which is MetaTrader's own shortcut for the Objects List. Not while a field has focus:
  // a dialog's own text boxes keep their editing keys.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el !== null && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
      if ((e.ctrlKey || e.metaKey) && (e.key === 'b' || e.key === 'B')) {
        e.preventDefault();
        setObjectsListOpen((v) => !v);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  /**
   * Project between the chart's coordinates and pixels.
   *
   * Read from the live chart on every call rather than captured, because the mapping changes with
   * every pan, zoom and new bar; a captured projection would place objects where the chart USED to
   * be. Returns null off-scale so a half-visible object is clipped rather than drawn at the edge.
   */
  const projection: Projection = {
    /**
     * Chart time to pixels.
     *
     * `timeToCoordinate` answers only for times the series actually HAS, so a ray extended four
     * spans past its anchors, which is how a Gann Fan and a Fibonacci Fan are drawn, asks about a
     * time beyond the last bar and gets null. That used to make the whole fan disappear rather
     * than run off the edge. Past the data the coordinate is extrapolated at the bar spacing the
     * chart is currently using, so a ray leaves the plot in the direction it should and the SVG
     * clips it, which is what MetaTrader shows.
     */
    xOf: (time) => {
      const ts = chartRef.current?.timeScale();
      if (!ts) return null;
      const exact = ts.timeToCoordinate(time as UTCTimestamp);
      if (exact !== null && exact !== undefined) return exact;
      const bars = candlesRef.current;
      const first = bars[0], last = bars[bars.length - 1];
      if (!first || !last || last.time === first.time) return null;
      const x0 = ts.timeToCoordinate(first.time as UTCTimestamp);
      const xN = ts.timeToCoordinate(last.time as UTCTimestamp);
      if (x0 === null || xN === null) return null;
      return x0 + (time - first.time) * ((xN - x0) / (last.time - first.time));
    },
    yOf: (price) => mainRef.current?.priceToCoordinate(price) ?? null,
    timeOf: (x) => (chartRef.current?.timeScale().coordinateToTime(x) as number | null) ?? null,
    priceOf: (y) => mainRef.current?.coordinateToPrice(y) ?? null,
    // The regression and standard-deviation channels are fitted through the BARS in the span.
    closesBetween: (from: number, to: number) => {
      const lo = Math.min(from, to), hi = Math.max(from, to);
      return candlesRef.current
        .filter((c) => c.time >= lo && c.time <= hi)
        .map((c) => ({ x: c.time, y: c.close }));
    },
    barSeconds: TIMEFRAMES[tf] ?? 60,
    digits: instrument.digits,
  };

  const propertiesDrawing = propertiesFor === null ? null : drawings.find((d) => d.id === propertiesFor) ?? null;
  const TV = themeOf(props.colours);
  const shownKind: ChartKind = chartType === 'bars' || chartType === 'line' ? chartType : 'candles';
  // Memoised: a fresh object on every tick would re-seed the dialog's draft out from under the
  // trader, which is exactly the bug a live chart makes and a still one hides.
  const propsForDialog = useMemo(() => ({ ...props, kind: shownKind }), [props, shownKind]);

  const setFollow = useCallback((v: boolean) => { followingRef.current = v; }, []);
  const legendOf = (c: Candle): Legend => ({ o: c.open, h: c.high, l: c.low, c: c.close, changePct: c.open ? ((c.close - c.open) / c.open) * 100 : 0 });

  /**
   * Shift the view to the latest bar, KEEPING THE WIDTH the trader last zoomed to.
   *
   * The width is read from the chart rather than from a constant. The old version wrote a
   * hard-coded 120 bars, so every call silently replaced the trader's zoom with a figure nobody had
   * chosen; `visibleBarsRef` was only ever written by the toolbar's own +/- buttons.
   */
  const snapToLive = useCallback(() => {
    const chart = chartRef.current, n = candlesRef.current.length;
    if (!chart || n === 0) return;
    const w = widthOf(chart.timeScale().getVisibleLogicalRange(), visibleBarsRef.current);
    chart.timeScale().setVisibleLogicalRange(liveWindow(n, w));
  }, []);
  /**
   * MetaTrader's three vertical-scale commands, which this chart had none of.
   *
   * Its chart menu carries `Auto scale`, `Free chart movement` and `Reset vertical scale`, and they
   * are the control surface for exactly the behaviour a trader complains about when a zoom will not
   * stay put: auto-scale lets the bars set the scale, free movement hands it to the trader, and
   * reset puts a stretched scale back. Without them a manual stretch was only escapable by
   * reloading the page.
   */
  const setAutoScale = useCallback((on: boolean) => {
    const chart = chartRef.current; if (!chart) return;
    chart.priceScale('right').applyOptions({ autoScale: on });
    setPriceManual(!on);
  }, []);
  /** MetaTrader's "Reset vertical scale": back to auto, which is the scale it started on. */
  const resetVerticalScale = useCallback(() => setAutoScale(true), [setAutoScale]);
  const zoom = useCallback((dir: 'in' | 'out') => {
    const chart = chartRef.current; if (!chart) return;
    const r = chart.timeScale().getVisibleLogicalRange();
    const from = widthOf(r, visibleBarsRef.current);
    const bars = clampBars(dir === 'in' ? from * ZOOM_STEP : from / ZOOM_STEP);
    visibleBarsRef.current = bars;
    // Zooming holds the RIGHT edge still, in history as at the live edge, so the candle being read
    // does not move out from under the pointer.
    chart.timeScale().setVisibleLogicalRange(
      followingRef.current ? liveWindow(candlesRef.current.length, bars) : zoomedWindow(r, bars, candlesRef.current.length),
    );
  }, []);

  /**
   * MetaTrader's `Save as Picture`, through the chart's own `takeScreenshot`.
   *
   * It is composited onto the background colour first. This chart's series canvas is deliberately
   * transparent so an object set to "draw as background" can sit between the pane colour and the
   * candles (see the `createChart` call), which means a raw screenshot of it saves candles floating
   * on nothing.
   *
   * The file name is MetaTrader's own chart title, `SYMBOL,PERIOD`, with the comma that a file
   * system would rather not carry replaced.
   */
  const savePicture = useCallback(() => {
    const chart = chartRef.current;
    if (!chart) return;
    const shot = chart.takeScreenshot();
    const out = document.createElement('canvas');
    out.width = shot.width;
    out.height = shot.height;
    const ctx = out.getContext('2d');
    if (!ctx) return;
    ctx.fillStyle = props.colours.background;
    ctx.fillRect(0, 0, out.width, out.height);
    ctx.drawImage(shot, 0, 0);
    const name = `${instRef.current.symbol}_${tfRef.current}.png`;
    const link = document.createElement('a');
    link.href = out.toDataURL('image/png');
    link.download = name;
    link.click();
    /**
     * A test seam, for the same reason `chartBars` and `chartTradeLevel` are ones: a download
     * leaves nothing behind in the page, so from outside there is no way to tell a picture that
     * was saved from a menu item that did nothing at all.
     */
    const host = plotRef.current;
    if (host) host.dataset.chartPicture = name;
  }, [props.colours.background]);

  /**
   * The accelerators the context menu prints, so it is not advertising keys that do nothing.
   *
   * The menu's own shortcut column is MetaQuotes' (docs/mt5/08-chart-properties.md:493-524), and
   * four of these keys appear NOWHERE else in its documentation — the menu is the only published
   * source for Alt+T (:558-559). F8 and Ctrl+B already have their own effects above, so this
   * covers the rest of the set the menu draws.
   *
   * Read from `e.code` rather than `e.key`, because Alt is a modifier that rewrites `key` on
   * several keyboard layouts while the physical key stays put.
   */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el !== null && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
      if (e.altKey && !e.ctrlKey && !e.metaKey) {
        // Alt+1/2/3 are MENU_CHART_TYPES' own accelerators, taken from its order rather than
        // written out a second time where the two could drift apart.
        const typed = e.code.startsWith('Digit') ? MENU_CHART_TYPES[Number(e.code.slice(5)) - 1] : undefined;
        if (typed) { e.preventDefault(); setChartType(typed.id); return; }
        if (e.code === 'KeyT') { e.preventDefault(); setOneClick(!oneClick); return; }
        return;
      }
      if ((e.ctrlKey || e.metaKey) && !e.altKey) {
        if (e.code === 'KeyG') { e.preventDefault(); changeProps({ ...props, showGrid: !props.showGrid }); }
        else if (e.code === 'KeyI') { e.preventDefault(); setMenuOpen(true); }
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      // `=` as well as `+`: on most layouts the key the menu calls "+" is unshifted `=`, and a
      // zoom that needed a second hand would read as broken rather than as faithful.
      if (e.key === '+' || e.key === '=') { e.preventDefault(); zoom('in'); }
      else if (e.key === '-') { e.preventDefault(); zoom('out'); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [props, changeProps, zoom, oneClick, setOneClick]);

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


  /**
   * Chart Properties applied LIVE, without rebuilding the chart.
   *
   * Every one of these is a control MetaTrader has and this chart can honour. The ones it cannot are
   * disabled in the dialog with the reason, rather than being accepted and ignored: there is no
   * traded volume behind this feed and no separate bid and ask, so those four rows say so.
   */
  useEffect(() => {
    const chart = chartRef.current, main = mainRef.current;
    if (!chart) return;
    const t = themeOf(props.colours);
    chart.applyOptions({
      layout: { textColor: t.text },
      // Show grid. MetaTrader's Ctrl+G, and its own checkbox on the Show tab.
      grid: {
        vertLines: { color: t.grid, visible: props.showGrid },
        horzLines: { color: t.grid, visible: props.showGrid },
      },
      crosshair: {
        vertLine: { color: t.cross, labelBackgroundColor: t.crossLabel },
        horzLine: { color: t.cross, labelBackgroundColor: t.crossLabel },
      },
      timeScale: {
        // Chart shift holds the last bar off the right edge by 10 to 50 per cent of the window.
        rightOffset: props.chartShift ? Math.round((props.shiftSize / 100) * visibleBarsRef.current) : RIGHT_OFFSET_BARS,
        borderColor: t.border,
      },
      rightPriceScale: { borderColor: t.border },
    });
    if (main) {
      const kind = chartTypeRef.current;
      if (kind === 'line' || kind === 'area' || kind === 'baseline') {
        main.applyOptions({ color: t.line } as never);
      } else if (kind === 'bars') {
        main.applyOptions({ upColor: t.barUp, downColor: t.barDown } as never);
      } else {
        main.applyOptions({
          upColor: t.up, downColor: t.down,
          borderUpColor: t.up, borderDownColor: t.down,
          wickUpColor: t.up, wickDownColor: t.down,
        } as never);
      }
      // Show last price line: MetaTrader's own row, drawn in its Last price line colour.
      main.applyOptions({
        priceLineVisible: props.showLastLine,
        priceLineColor: t.lastLine,
      } as never);
    }
    /**
     * Scale fix pins the vertical scale between Fixed maximum and Fixed minimum; without it the
     * scale follows the bars, which is MetaTrader's default. One to one is MetaTrader's third mode
     * and this renderer has no equivalent of it, so it pins the scale the same way rather than
     * claiming a square aspect it cannot hold.
     *
     * NOT re-asserted on every run of this effect. This effect depends on the whole properties
     * object, so it re-ran on any chart setting and on every symbol change, and each run wrote
     * `autoScale: true` over the `autoScale: false` that dragging the price axis had just set:
     * stretching the scale by hand and then touching any other setting lost the stretch. It is
     * written only when `scaleFix` itself changes, or when the trader asks for auto-scale back
     * through MetaTrader's own command (see `setAutoScale`).
     */
    if (scaleFixAppliedRef.current !== props.scaleFix) {
      scaleFixAppliedRef.current = props.scaleFix;
      chart.priceScale('right').applyOptions({ autoScale: !props.scaleFix });
      setPriceManual(false);
    }
  }, [props, setPriceManual]);

  /**
   * Fixed maximum / Fixed minimum. lightweight-charts has no "set this range" call, so the series
   * declares the range it wants autoscaled to, which is the documented way to pin one.
   */
  useEffect(() => {
    const main = mainRef.current;
    if (!main) return;
    const hi = props.fixedMaximum, lo = props.fixedMinimum;
    const pinned = props.scaleFix && hi !== null && lo !== null && hi > lo;
    main.applyOptions({
      autoscaleInfoProvider: pinned
        ? () => ({ priceRange: { minValue: lo, maxValue: hi } })
        : undefined,
    } as never);
  }, [props.scaleFix, props.fixedMaximum, props.fixedMinimum, revision]);

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
    /**
     * Where the trader was looking, in TIME, before the refetch replaces the bars.
     *
     * A reconnect and the midnight reseed both land here, and both used to force the view back to
     * the live edge: a trader reading a candle from this morning lost their place because the
     * socket blinked. Time rather than logical index, because the array is replaced wholesale and
     * every index moves; the bar times do not.
     *
     * Only kept when the trader was NOT at the live edge. At the edge, going back to the edge is
     * what they want, and it is also where the new bars are.
     */
    const heldView = followingRef.current
      ? null
      : chartRef.current?.timeScale().getVisibleRange() ?? null;
    requestCandles(tf, INITIAL_BARS)
      .then((reply) => {
        if (cancelled) return;
        candlesRef.current = reply.bars.slice();
        anchorRef.current = reply.anchor;
        instRef.current = reply.instrument;
        setInstrument(reply.instrument);
        paint();
        if (reply.bars.length) setLegend(legendOf(reply.bars[reply.bars.length - 1]!));
        if (heldView === null) {
          setFollow(true);
          snapToLive();
        } else {
          // Put them back where they were. The visible-range subscription re-derives `following`
          // from the restored view, so nothing has to be told that they are still in history.
          try { chartRef.current?.timeScale().setVisibleRange(heldView); }
          catch { setFollow(true); snapToLive(); }
        }
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
    /**
     * A drag on the PRICE AXIS is MetaTrader's "free chart movement": the trader has taken the
     * vertical scale, so the app must stop handing it back to the bars. The library has already set
     * its own `autoScale: false`; this records it so no later effect writes `true` over it.
     *
     * Scoped to the axis, not the plot, because a drag on the plot pans and does not touch the
     * scale. The axis is the right 56px of the host (`minimumWidth`), which is where the library
     * draws it.
     */
    const onAxisDrag = (e: PointerEvent) => {
      const box = host.getBoundingClientRect();
      if (e.clientX >= box.right - 56) setPriceManual(true);
    };
    host.addEventListener('pointerdown', onAxisDrag);

    /**
     * Nothing is attached to wheel, pointerdown or touchstart any more.
     *
     * Those three listeners armed the resume timer, which is what undid a manual zoom. Following is
     * now a FACT ABOUT THE VIEW, read off the visible range below, so a gesture needs no handler:
     * pan away from the last bar and the chart stops following because it is no longer showing it;
     * pan back and it follows again, with no mode to toggle either way.
     */

    (async () => {
      const lc = await import('lightweight-charts');
      const { createChart, CandlestickSeries, BarSeries, LineSeries, AreaSeries, BaselineSeries, ColorType, CrosshairMode, LineStyle } = lc;
      if (disposed) return;
      // Held so indicators can add their own series and panes after the chart exists.
      lcRef.current = lc;
      const up = TV.up, down = TV.down, accent = TV.accent, info = TV.info, border = TV.border;

      const chart = createChart(host, {
        autoSize: true,
        /**
         * The pane colour is painted by the wrapper, not the chart, so an object with MetaTrader's
         * "Draw object as background" set can be drawn BETWEEN the colour and the candles. The
         * chart's own background is transparent for that one reason; see DrawingsBackdrop.
         */
        layout: { background: { type: ColorType.Solid, color: 'rgba(0,0,0,0)' }, textColor: TV.text, fontSize: 11, attributionLogo: true },
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
        /**
         * The trader's own zoom and position, recorded from the view itself.
         *
         * This is where a manual pinch, wheel or drag becomes known: the library reports the new
         * range, the width is remembered so a new bar can preserve it, and whether the chart is
         * still showing the latest bar decides whether it follows at all.
         */
        visibleBarsRef.current = widthOf(range, visibleBarsRef.current);
        followingRef.current = atLiveEdge(range, candlesRef.current.length);
        /**
         * The view, published on the plot.
         *
         * A test seam, and the honest one: there is no way to ask the chart its visible range from
         * outside, and asserting on a React ref asserts on nothing a trader can see. These two say
         * how wide the window is and whether it is following, which is exactly what broke. Written
         * to the DOM rather than to state so this handler does not re-render on every pan.
         */
        const host = plotRef.current;
        if (host) {
          host.dataset.chartBars = String(Math.round(visibleBarsRef.current));
          host.dataset.chartFollowing = followingRef.current ? '1' : '0';
        }
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
        // The symbol guard is the second half of the same rule as the day guard below it: draw only
        // when the tick, the anchor and the instrument all belong together.
        const sameSymbol = symbolRef.current === undefined || instRef.current.symbol === symbolRef.current;
        /**
         * A price chart draws PRICES THE SERVER SENT, and nothing else.
         *
         * The client pre-fills its tick buffer with an invented curve for the classic shell's
         * backdrop (see `Tick.synthetic`). One of those reaching here used to create the forming bar
         * from a fabricated rate, so the bar opened tens of points off the market and kept that open,
         * high and low for the rest of its minute. The source is fixed too, so this should never
         * fire; it is here because a false print on a broker's chart is not a thing to leave to one
         * guard, and because the next person to add a tick source has the rule written down.
         */
        const realTick = last && last.synthetic !== true ? last : null;
        if (realTick && anchor && series && sameSymbol && utcDateKey(realTick.t) === anchor.tradeDate) {
          const last = realTick;
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
          /**
           * MetaTrader's "Chart auto scroll", and its whole rule: a NEW BAR scrolls to the latest
           * bar, if the chart was already showing the latest bar.
           *
           * `closedOne` is the new bar. This used to run on EVERY animation frame while following,
           * which made the chart un-zoomable: any manual range change was overwritten within
           * 16ms. Gated on the setting too, which is what the setting is for; it was previously
           * read once and then overridden by the resume timer three seconds later.
           */
          if (closedOne && autoScrollRef.current && followingRef.current) snapToLive();
        }
        raf = requestAnimationFrame(loop);
      };
      raf = requestAnimationFrame(loop);
    })();

    return () => {
      disposed = true;
      if (raf) cancelAnimationFrame(raf);
      host.removeEventListener('pointerdown', onAxisDrag);
      chartRef.current?.remove();
      resizeObsRef.current?.disconnect();
      resizeObsRef.current = null;
      chartRef.current = mainRef.current = lcRef.current = null;
      // The chart owned every indicator series and pane, so dropping the registries is the cleanup —
      // leaving stale handles behind would have the next chart draw onto a disposed one.
      plotsRef.current.clear();
      markersRef.current.clear();
    };
  }, [getLastTick, chartType, setFollow, snapToLive, refreshIndicators, paint, loadOlder]);

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
   *   - the Stop Loss and the Take Profit ARE prices, and they are drawn, but by `MT5ChartLevels`
   *     over this canvas rather than by the series: they are draggable, they carry MetaTrader's own
   *     chips, and they come from the shared levels store the ticket writes.
   * What is left here is the open-position level alone. Drawing a second, undraggable pair through
   * the series would put two lines on one level and let them disagree.
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
    /**
     * A test seam, for the same reason `chartBars` is one: the level is drawn INTO a canvas by
     * lightweight-charts, so from outside the only way to ask whether it is there is to count
     * pixels of its colour on the price axis — and that colour is `#41be56`, which is also the up
     * candle's, so the last-value price label paints ~780 pixels of it whenever the last bar closed
     * up, position or no position. A pixel test therefore answers a different question than the one
     * it looks like it answers. This says plainly whether the level is drawn.
     */
    const mark = (on: boolean) => { const host = plotRef.current; if (host) host.dataset.chartTradeLevel = on ? '1' : '0'; };
    const rate = openPosition?.entryRate ?? null;
    // Show trade levels, which MetaTrader carries on its Show tab and in Options as a global.
    if (rate === null || !openPosition || !props.showTradeLevels) { mark(false); return; }
    const inst = instRef.current;
    const price = anchor.base + inst.scale * (valueOfRate(rate) - anchor.openValue);
    if (!Number.isFinite(price)) { mark(false); return; }
    const line = series.createPriceLine({
      price,
      // MetaTrader colours a position's opening level with its `Volumes:` colour. That reads like a
      // mistake and is not: its own help says the Volumes field "also colours position opening
      // levels", so the two move together.
      color: themeOf(props.colours).volumes,
      lineWidth: 1,
      lineStyle: lc.LineStyle.Solid,
      axisLabelVisible: true,
      title: `${openPosition.direction} ${openPosition.lots}`,
    });
    mark(true);
    return () => {
      mark(false);
      try { series.removePriceLine(line); } catch { /* series already gone */ }
    };
  }, [openPosition?.entryRate, openPosition?.direction, openPosition?.lots, revision, props.showTradeLevels, props.colours]);

  const sep = <span className="mx-1 h-4 w-px shrink-0 bg-[#2b3543]" aria-hidden />;
  const dp = instrument.digits;

  return (
    <div className="flex h-full w-full flex-col bg-[#0f1720] text-[#ffffff]">
      {/* MetaTrader draws a different chart screen on a phone, so this renders one or the other
          rather than one squeezed. See the `phone` prop for what the two actually differ in. */}
      {phone ? (
        <MobileChartBar
          tf={tf}
          chooseTf={chooseTf}
          crosshair={tool === 'crosshair'}
          onCrosshair={() => { setSelectedDrawing(null); setTool(tool === 'crosshair' ? 'cursor' : 'crosshair'); }}
          chartType={chartType}
          setChartType={setChartType}
          ind={ind}
          toggleIndicator={toggleIndicator}
          onProperties={() => setPropertiesOpen(true)}
          onObjectsList={() => setObjectsListOpen(true)}
          tool={tool}
          onPickTool={(id) => { setSelectedDrawing(null); setTool(id); }}
          priceManual={priceManual}
          setAutoScale={setAutoScale}
          resetVerticalScale={resetVerticalScale}
          {...(fullScreen === undefined ? {} : { fullScreen })}
          {...(onFullScreen === undefined ? {} : { onFullScreen })}
        />
      ) : (
        /* Desktop: symbol, the full MT5 period set, the Tools menu and the interface gear. */
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
                      {/* One per row, not three across. This menu is a fixed `w-60`, so a third of
                          it is a 71px cell, and `Candlesticks` needs 84px: it spilled 13px outside
                          its own highlight box at every width while `Bar chart` and `Line chart`
                          wrapped onto a second line inside a 24px pill. MetaTrader stacks these
                          three vertically too, as the radio group on the Properties dialog's
                          Common tab (docs/mt5/03-chart-ui.md:67), and it is how the Scale and
                          Chart sections just below already read. */}
                      <div className="grid gap-1">
                        {[...chartTypesFor(false, chartType), ...ADDON_TYPES.filter((a) => a.id === initialType)].map((c) => (
                          <button key={c.id} type="button" onClick={() => setChartType(c.id)} className={cn(pill, 'w-full', chartType === c.id ? active : idle)}>{c.label}</button>
                        ))}
                      </div>
                    </Section>
                    {/* MetaTrader's own three vertical-scale commands, in its own words. The
                        trader who has stretched the price axis by hand had no way back before
                        these; now Auto scale hands it to the bars, Free chart movement keeps it
                        theirs, and Reset vertical scale undoes the stretch. */}
                    <Section title="Scale">
                      <div className="grid gap-1">
                        <Toggle on={!priceManual} onClick={() => setAutoScale(true)}>Auto scale</Toggle>
                        <Toggle on={priceManual} onClick={() => setAutoScale(false)}>Free chart movement</Toggle>
                        <button
                          type="button"
                          onClick={() => { setMenuOpen(false); resetVerticalScale(); }}
                          className={cn(pill, idle, 'w-full')}
                        >
                          Reset vertical scale
                        </button>
                      </div>
                    </Section>
                    <Section title="Chart">
                      <div className="grid gap-1">
                        {/* MetaTrader's "Chart auto scroll": a new bar scrolls to the latest bar,
                            if the chart is already showing it. Its own checkbox lives on the
                            Properties dialog too; it is here because it is the one setting that
                            decides whether the view moves on its own. */}
                        <Toggle
                          on={props.autoScroll}
                          onClick={() => changeProps({ ...props, autoScroll: !props.autoScroll })}
                        >
                          Chart auto scroll
                        </Toggle>
                        <button
                          type="button"
                          onClick={() => { setMenuOpen(false); setPropertiesOpen(true); }}
                          className={cn(pill, idle, 'w-full')}
                        >
                          Properties… F8
                        </button>
                      </div>
                    </Section>
                    {/* MetaTrader's Navigator tree: its groups, its order, its names. Scrolls because the
                        list is long — which is the point of it. */}
                    {/* All four of MetaTrader's Navigator groups, under its own names, carrying all 38
                        of its built-in indicators. The seven that read traded volume are listed and
                        DISABLED with the reason: omitting them hides the gap, and feeding them an
                        invented volume would draw a confident line that means nothing. */}
                    {INDICATOR_GROUPS.map((g) => (
                      <Section key={g.group} title={g.label}>
                        {/* `grid-cols-1`, not a bare `grid`: an implicit grid track is sized to its
                            MAX-CONTENT, and a row of nowrap text has no smaller max-content, so the
                            track grew to the longest indicator name and carried all 38 rows 70px
                            past the menu's right edge however much the label inside was willing to
                            shrink. Tailwind's `grid-cols-1` is `minmax(0, 1fr)`, which is the track
                            that cannot outgrow the menu. */}
                        <div className="grid grid-cols-1 gap-1">
                          {g.items.map((def) => (
                            <Toggle
                              key={def.id}
                              on={ind.has(def.id)}
                              disabled={def.unavailable !== undefined}
                              title={def.unavailable}
                              onClick={() => { if (!def.unavailable) toggleIndicator(def.id); }}
                            >
                              <span className="truncate">{def.name} <span className="text-[9px] opacity-70">{def.params}</span></span>
                            </Toggle>
                          ))}
                        </div>
                        {g.group === 'volumes' ? (
                          <p className="px-0.5 pt-1 text-[9px] leading-snug text-[#8fa2b8]">{VOLUME_GROUP_NOTE}</p>
                        ) : null}
                      </Section>
                    ))}
                  </div>
                ) : null}
              </div>
              <button type="button" onClick={() => zoom('out')} aria-label="Zoom out" className={cn(pill, idle, 'text-sm [@media(pointer:coarse)]:hidden')}>−</button>
              <button type="button" onClick={() => zoom('in')} aria-label="Zoom in" className={cn(pill, idle, 'text-sm [@media(pointer:coarse)]:hidden')}>+</button>
              <InterfaceModeToggle />
            </div>
          </div>
      )}


      {/* Body = left drawing rail + plot (TradingView layout). */}
      <div className="flex min-h-0 flex-1">
        {/* MetaTrader's phone chart has NO object rail — on Android graphical objects are reached
            through the radial menu only, and on a 360px screen this rail was taking 40 of those
            pixels from the chart. The objects themselves are still reachable: the phone bar's
            indicator sheet carries the Objects list. */}
        {phone ? null : <DrawRail
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
          onObjectsList={() => setObjectsListOpen(true)}
        />}
        <div
          ref={plotRef}
          className="relative min-h-0 flex-1"
          style={{ background: TV.bg }}
          /**
           * MetaTrader's chart background menu, on MetaTrader's own gesture.
           *
           * Bound to the plot alone, so the browser's menu is suppressed over the chart and nowhere
           * else on the page. It reads the event and nothing more: the left-drag pan and the
           * crosshair belong to lightweight-charts, which ignores the secondary button, so a right
           * click cannot move the view.
           *
           * An object's own right-click menu (ChartDrawings) fires first on the way up and calls
           * `preventDefault`; without this guard the background menu would open on top of it.
           */
          onContextMenu={(e) => {
            if (e.defaultPrevented) return;
            e.preventDefault();
            /**
             * The price under the cursor, read the way every other chart gesture reads one: through
             * the series' own `coordinateToPrice`, against the plot host's box, so it is the price
             * the trader is pointing at on the axis they can see rather than one derived from the
             * data. Null before the first paint, which the menu renders as no price-bearing row.
             */
            const host = hostRef.current?.getBoundingClientRect() ?? null;
            const price = host ? projection.priceOf(e.clientY - host.top) : null;
            setChartMenu({ x: e.clientX, y: e.clientY, price: Number.isFinite(price as number) ? price : null });
          }}
        >
          {/* Behind the candles: objects the trader set to draw as background. */}
          <DrawingsBackdrop
            project={projection}
            drawings={drawings}
            width={plotSize.w}
            height={plotSize.h}
            revision={revision}
            timeframe={tf}
          />
          <div ref={hostRef} className="relative z-[1] h-full w-full" aria-label={`${instrument.symbol} price chart`} role="img" />
          {/* MetaTrader's draggable Stop Loss and Take Profit, which its advanced dialog draws on
              the chart beneath it. Phone only, and only once a level is set: the same `levels`
              store the dialog writes, so dragging the line moves the dialog's figure and stepping
              the dialog's figure moves the line. */}
          {/**
            * MetaTrader draws SL and TP on EVERY chart, so this is no longer phone-only.
            *
            * It was gated on the `phone` prop, which is why "SL/TP does not work on desktop": the
            * desktop chart never mounted the levels at all, so there was nothing to see and nothing
            * to drag. One store feeds both, so a level set in the docked ticket is drawn here and a
            * drag here moves the ticket's figure.
            */}
          <MT5ChartLevels
            project={projection}
            width={plotSize.w}
            height={plotSize.h}
            digits={instrument.digits}
            /* The legend's close is the chart's own current price: it is the forming bar's last
               value, which is what the level distances have to be measured from if the lines are
               to sit where the trader sees the price. */
            price={legend?.c ?? null}
            stakeCents={levelStakeCents}
          />
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
            timeframe={tf}
            onProperties={setPropertiesFor}
            showDescriptions={props.showObjectDescriptions}
            onContextMenu={(id, x, y) => setObjectMenu({ id, x, y })}
            onDeleteLatest={() => {
              const last = drawings[drawings.length - 1];
              if (last) {
                changeDrawings(drawings.slice(0, -1));
                if (selectedDrawing === last.id) setSelectedDrawing(null);
              }
            }}
            onUndoDelete={undoDelete}
          />
          <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
            <span className="select-none text-4xl font-black uppercase tracking-widest text-white/[0.04]">{instrument.symbol}</span>
          </div>
          {legend && (props.showTicker || props.showOHLC) ? (
            // One line, always. Wrapped onto two it covered the top of the plot on a phone, so the
            // full O/H/L/C set appears from `sm` up and a narrow screen gets close + change — which
            // is what MetaTrader's own mobile chart shows.
            <div
              // The symbol and period this chart is drawing, as one readable string. Also the hook
              // that lets a test read the CHART's own instrument rather than the screen's, which
              // matters now that Market Watch quotes other symbols a few pixels to the left.
              data-chart-legend={`${instrument.symbol} ${tf}`}
              className="pointer-events-none absolute left-2 top-1.5 z-20 flex items-baseline gap-x-2 overflow-hidden whitespace-nowrap font-mono text-[11px] tabular-nums"
            >
              {/* Show ticker is the symbol and period; Show OHLC is the four prices. MetaTrader
                  couples them: unticking the ticker unticks OHLC, so OHLC never shows alone. */}
              {props.showTicker ? <span className="font-semibold" style={{ color: TV.text }}>{instrument.symbol}</span> : null}
              {props.showTicker ? <span className="text-[#8fa2b8]">{tf}</span> : null}
              {props.showOHLC ? <span className="hidden text-[#8fa2b8] sm:inline">O <span style={{ color: TV.text }}>{legend.o.toFixed(dp)}</span></span> : null}
              {props.showOHLC ? <span className="hidden text-[#8fa2b8] sm:inline">H <span style={{ color: TV.text }}>{legend.h.toFixed(dp)}</span></span> : null}
              {props.showOHLC ? <span className="hidden text-[#8fa2b8] sm:inline">L <span style={{ color: TV.text }}>{legend.l.toFixed(dp)}</span></span> : null}
              {props.showOHLC ? <span className="text-[#8fa2b8]">C <span style={{ color: TV.text }}>{legend.c.toFixed(dp)}</span></span> : null}
              {props.showOHLC ? <span className="font-semibold" style={{ color: up ? TV.up : TV.down }}>{up ? '+' : ''}{legend.changePct.toFixed(2)}%</span> : null}
            </div>
          ) : null}
          {loading ? (
            <div className="absolute inset-0 z-20 grid place-items-center bg-[#0f1720]/70 text-[11px] font-semibold text-[#8fa2b8]">Loading {tf} history…</div>
          ) : null}
          {loadError ? (
            <div className="absolute inset-x-0 top-8 z-20 mx-auto w-fit rounded-sm border border-[#2b3543] bg-[#0f1720] px-3 py-1.5 text-[11px] text-[#8fa2b8]">
              History unavailable ({loadError}). The live bar is still updating.
            </div>
          ) : null}
        </div>
      </div>

      {objectsListOpen ? (
        <MT5ObjectsList
          drawings={drawings}
          symbol={instrument.symbol}
          timeframe={tf}
          selected={selectedDrawing}
          onSelect={setSelectedDrawing}
          // Show closes the list: it moves the chart, and on a phone the list covers the chart,
          // so leaving it open would hide the one thing the button did.
          onShow={(id) => { showObject(id); setObjectsListOpen(false); }}
          // Properties does NOT close it. MetaTrader opens the properties window OVER the Objects
          // List and returns to the list when it is closed, so Cancel goes back rather than out.
          onProperties={(id) => { setSelectedDrawing(id); setPropertiesFor(id); }}
          onDelete={(id) => {
            changeDrawings(drawings.filter((d) => d.id !== id));
            if (selectedDrawing === id) setSelectedDrawing(null);
          }}
          onDismiss={() => setObjectsListOpen(false)}
        />
      ) : null}

      {objectMenu ? (
        <MT5ObjectMenu
          at={objectMenu}
          drawing={drawings.find((d) => d.id === objectMenu.id) ?? null}
          arrowCount={drawings.filter((d) => objectOf(d.kind)?.group === 'arrows').length}
          canUndo={canUndoDelete}
          onProperties={() => setPropertiesFor(objectMenu.id)}
          onObjectList={() => setObjectsListOpen(true)}
          onDelete={() => {
            changeDrawings(drawings.filter((d) => d.id !== objectMenu.id));
            setSelectedDrawing(null);
          }}
          onDeleteAllArrows={() => {
            changeDrawings(drawings.filter((d) => objectOf(d.kind)?.group !== 'arrows'));
            setSelectedDrawing(null);
          }}
          onUnselect={() => setSelectedDrawing(null)}
          onUndoDelete={undoDelete}
          onDismiss={() => setObjectMenu(null)}
        />
      ) : null}

      {chartMenu ? (
        /**
         * MetaTrader's 27-item chart background menu, minus the items this platform has no
         * equivalent of. The groups below are its groups, in its order, under its labels and with
         * its printed accelerators; the numbers are its rows in docs/mt5/08-chart-properties.md.
         *
         * Nothing here is a second implementation of anything. Every item calls the handler the
         * ⚙ Tools menu, the left rail or the Properties dialog already calls, which is the whole
         * point of a second surface: the menu is a shorter route to the same chart, not a copy of
         * it that can disagree with it.
         *
         * WHAT IS NOT DRAWN, and why. Each of these has no handler to call because the thing itself
         * does not exist here, and drawing a row that cannot act is the one failure this menu
         * cannot afford:
         *   1  `Sell Limit 1 219.306`   every contract is market execution, so there is no pending
         *                    order to place at the clicked price, and the three order rows of the
         *                    `Trading` submenu go with it for the same reason. Its fourth row,
         *                    `Alert  219.306`, IS drawn: see below.
         *   3  `Depth Of Market  Alt+B`  there is no order book; one price is quoted.
         *   7  `Expert List  Alt+X`      there are no Expert Advisors and no MQL5 programs.
         *   12 `Templates ▸`             templates are MetaTrader's saved chart settings files;
         *                                this chart persists its settings per symbol instead and
         *                                has no file to save or load.
         *   14 `Docked  Alt+D`           the chart is a pane in one page, not a detachable window.
         *   18 `Volumes  Ctrl+K` and
         *   19 `Tick Volumes  Ctrl+L`    the feed carries no traded volume, which is the same
         *                                reason the Show tab disables both rows (NO_VOLUME) and the
         *                                seven volume-fed indicators are disabled in the catalogue.
         *   21 `Trade History`           nothing draws closed deals on this chart, so the command
         *                                would toggle a setting with no picture behind it. The
         *                                Show tab keeps its checkbox because that dialog is a
         *                                faithful copy of MetaTrader's thirteen rows; a menu is a
         *                                list of commands, and a command must do something.
         *   24 `Delete Indicators Window`  MetaTrader greys this outside an indicator subwindow,
         *                                and this menu opens on the chart background, which is
         *                                exactly where it greys it.
         *   25 `Step by Step  F12`       that steps the Strategy Tester; there is no tester.
         */
        <MT5ChartMenu
          at={chartMenu}
          onDismiss={() => setChartMenu(null)}
          groups={[
            /**
             * 2. `Trading ▸`, holding the one row of MetaTrader's submenu this platform can honour:
             * `Alert  <price>` (docs/mt5/08-chart-properties.md:527 lists the submenu as
             * `Sell Limit`, `Buy Stop`, `Take Profit`, `Alert`, ———, `New Order F9`).
             *
             * It is here now because the Toolbox grew an Alerts tab and an Alert Editor. Until it
             * did, this row had nowhere to go and was correctly left out; the rule has not changed,
             * only what the platform can do. The three order rows stay out (market execution only)
             * and `New Order F9` stays out because the order ticket is docked beside the chart and
             * never closed, so there is no window for it to open.
             *
             * The CONDITION follows the cursor, which is MetaTrader's own rule for this submenu,
             * stated verbatim at :528-531 for the order types: what the menu offers depends on
             * whether it was opened above or below the current price. An alert placed above the
             * market is one that fires when the price rises to it, and below, when it falls to it.
             * Anything else would arm an alert that was already true the moment it was created.
             *
             * The whole row is omitted rather than shown dead when there is no price yet (before
             * the first paint), which is the same rule every other row here follows.
             */
            ...(chartMenu.price === null ? [] : [[{
              kind: 'submenu' as const,
              label: 'Trading',
              items: [{
                label: `Alert  ${chartMenu.price.toFixed(instrument.digits)}`,
                run: () => {
                  /**
                   * The price the ROW SAYS, not the raw coordinate behind it.
                   *
                   * `coordinateToPrice` returns the full float for the pixel that was clicked
                   * (3078.165777074284), and the row prints it at the symbol's digits (3078.17).
                   * Arming the alert at the float would mean a trader read one number off the menu
                   * and got another, on the one figure the alert is entirely about. The label is the
                   * promise; this makes it the fact.
                   */
                  const price = Number(chartMenu.price?.toFixed(instrument.digits));
                  if (!Number.isFinite(price)) return;
                  const lastClose = candlesRef.current[candlesRef.current.length - 1]?.close ?? price;
                  useAlertsStore.getState().add({
                    enabled: true,
                    symbol: instrument.symbol,
                    condition: price >= lastClose ? 'last>' : 'last<',
                    price,
                    timeHHMM: '',
                    limit: ALERT_DEFAULTS.limit,
                    timeoutS: ALERT_DEFAULTS.timeoutS,
                    expiresAtMs: null,
                  });
                },
              }],
            }]]),
            [
              // 4. Not a chart setting but a terminal one, and the phone's one-click panel fires
              // from this same flag.
              { kind: 'toggle', label: 'One Click Trading', accel: 'Alt+T', on: oneClick, run: () => setOneClick(!oneClick) },
              /**
               * 5. The ⚙ Tools menu IS this chart's indicator list: MetaTrader's lists what is
               * applied so it can be edited or removed, and ours lists all 38 with the applied ones
               * lit, which does both jobs from one place. It is not greyed when none are applied,
               * as MetaTrader greys its own, because an empty list there has nothing to manage
               * while ours is still how an indicator is added.
               */
              { kind: 'command', label: 'Indicator List', accel: 'Ctrl+I', run: () => setMenuOpen(true) },
              // 6. The same dialog Ctrl+B and the rail's list button open.
              { kind: 'command', label: 'Object List', accel: 'Ctrl+B', run: () => setObjectsListOpen(true) },
            ],
            // 8-10. `shownKind` is which of MetaTrader's three is being drawn, so a Heikin Ashi
            // chart marks Candlesticks, exactly as the Properties dialog's radio does.
            MENU_CHART_TYPES.map((c) => ({
              kind: 'radio' as const, label: c.label, accel: c.accel,
              on: shownKind === c.id, run: () => setChartType(c.id),
            })),
            [
              // 11. All 21 periods, through the same `chooseTf` the toolbar strip uses, so the
              // period chosen here is remembered as that one is.
              {
                kind: 'submenu', label: 'Timeframes',
                items: TIMEFRAME_KEYS.map((k) => ({ label: k, on: tf === k, run: () => chooseTf(k) })),
              },
              // 13. The history refetch that a reconnect and the midnight reseed already trigger.
              { kind: 'command', label: 'Refresh', run: () => setReloadKey((k) => k + 1) },
            ],
            [
              // 15-17. Three chart properties, written through the same `changeProps` the
              // Properties dialog writes through, so the menu and the dialog cannot drift apart.
              { kind: 'toggle', label: 'Grid', accel: 'Ctrl+G', on: props.showGrid, run: () => changeProps({ ...props, showGrid: !props.showGrid }) },
              { kind: 'toggle', label: 'Auto Scroll', on: props.autoScroll, run: () => changeProps({ ...props, autoScroll: !props.autoScroll }) },
              { kind: 'toggle', label: 'Chart Shift', on: props.chartShift, run: () => changeProps({ ...props, chartShift: !props.chartShift }) },
            ],
            // 20. The open position's level, which is the one trade level that can exist here.
            [{ kind: 'toggle', label: 'Trade Levels', on: props.showTradeLevels, run: () => changeProps({ ...props, showTradeLevels: !props.showTradeLevels }) }],
            [
              // 22-23. The toolbar's own −/+ , which hold the right edge still.
              { kind: 'command', label: 'Zoom In', accel: '+', run: () => zoom('in') },
              { kind: 'command', label: 'Zoom Out', accel: '-', run: () => zoom('out') },
            ],
            // 26. MetaQuotes states this is one of only two commands the context menu has that the
            // main Charts menu does not (:554-556), which is why it is worth having here.
            [{ kind: 'command', label: 'Save as Picture', run: savePicture }],
            // 27. The F8 dialog.
            [{ kind: 'command', label: 'Properties', accel: 'F8', run: () => setPropertiesOpen(true) }],
          ]}
        />
      ) : null}

      {propertiesOpen ? (
        <MT5ChartProperties
          symbol={instrument.symbol}
          timeframe={tf}
          /**
           * The radio shows the chart's real type. MetaTrader has three and this chart draws four,
           * so Heikin Ashi (and a brand's add-on system) shows as Candlesticks, the one it is drawn
           * from. The type is then only written back if the trader actually moved the radio, so
           * opening the dialog on a Heikin Ashi chart and pressing OK does not quietly flatten it
           * to candlesticks.
           */
          value={propsForDialog}
          onChange={(next) => {
            changeProps(next);
            if (next.kind !== shownKind) setChartType(next.kind as MainType);
          }}
          onDismiss={() => setPropertiesOpen(false)}
        />
      ) : null}

      {propertiesDrawing ? (
        <MT5ObjectProperties
          drawing={propertiesDrawing}
          digits={instrument.digits}
          barSeconds={TIMEFRAMES[tf] ?? 60}
          onChange={(next) => changeDrawings(drawings.map((d) => (d.id === next.id ? next : d)))}
          onDismiss={() => setPropertiesFor(null)}
        />
      ) : null}
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
  tool, onPick, count, hasSelection, onObjectsList,
}: {
  tool: ToolId;
  onPick: (id: ToolId) => void;
  count: number;
  hasSelection: boolean;
  onObjectsList: () => void;
}) {
  const [treeOpen, setTreeOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!treeOpen) return;
    const away = (e: MouseEvent) => { if (!wrap.current?.contains(e.target as Node)) setTreeOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setTreeOpen(false); };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', esc); };
  }, [treeOpen]);

  return (
    <div ref={wrap} className="relative flex w-10 shrink-0 flex-col items-center gap-1 border-r border-[#2b3543] bg-[#202933] py-1.5">
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
      {/* MetaTrader groups its 44 objects into dropdowns on the Line Studies toolbar rather than
          laying them out as 44 icons. This is that button: it opens the Insert > Objects tree. */}
      <button
        type="button"
        title="Objects"
        aria-label="Objects"
        aria-expanded={treeOpen}
        onClick={() => setTreeOpen((v) => !v)}
        className={cn(
          'grid h-8 w-8 shrink-0 place-items-center rounded-md transition',
          treeOpen ? 'bg-[#3183ff] text-white' : 'text-[#8fa2b8] hover:bg-[#2b3543] hover:text-white',
        )}
      >
        <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 20L20 4M6 4v16M3 15h18" />
        </svg>
      </button>

      {treeOpen ? (
        <div className="absolute left-10 top-1 z-30 max-h-[70vh] w-60 overflow-y-auto overscroll-contain rounded-lg border border-[#2b3543] bg-[#0f1720] p-2 text-left shadow-xl">
          {OBJECT_GROUPS.map((g) => (
            <div key={g.group} className="mb-2 last:mb-0">
              <div className="mb-1 text-[9px] font-semibold uppercase tracking-wider text-[#8fa2b8]">{g.label}</div>
              <div className="grid gap-1">
                {g.items.map((o) => (
                  <button
                    key={o.name}
                    type="button"
                    disabled={o.unavailable !== undefined}
                    title={o.unavailable}
                    aria-pressed={o.kind !== null && tool === o.kind}
                    onClick={() => { if (o.kind) { onPick(o.kind as ToolId); setTreeOpen(false); } }}
                    className={cn(
                      'flex h-6 items-center rounded-md border px-2 text-left text-[10px] font-semibold transition',
                      o.kind !== null && tool === o.kind
                        ? 'border-[#3183ff] bg-[#3183ff]/15 text-[#3183ff]'
                        : 'border-[#2b3543] bg-[#0f1720]/80 text-[#8fa2b8] hover:text-white',
                      o.unavailable && 'cursor-not-allowed opacity-45 hover:text-[#8fa2b8]',
                    )}
                  >
                    <span className="truncate">{o.name}</span>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {/* MetaTrader opens the Objects List on Ctrl+B, from the View menu and from the Line Studies
          toolbar. A phone has no Ctrl key, so the rail carries it too. */}
      <button
        type="button"
        title="Objects List (Ctrl+B)"
        aria-label="Objects List"
        onClick={onObjectsList}
        className="grid h-8 w-8 shrink-0 place-items-center rounded-md text-[#8fa2b8] transition hover:bg-[#2b3543] hover:text-white"
      >
        <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 7h16M4 12h16M4 17h16" />
        </svg>
      </button>

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
      <div className="mb-1 text-[9px] font-semibold uppercase tracking-wider text-[#8fa2b8]">{title}</div>
      {children}
    </div>
  );
}
function Toggle({ on, onClick, children, disabled, title }: {
  on: boolean; onClick: () => void; children: React.ReactNode;
  disabled?: boolean | undefined; title?: string | undefined;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      disabled={disabled}
      title={title}
      className={cn(
        'flex h-6 items-center justify-between rounded-md border px-2 text-[10px] font-semibold transition',
        on ? 'border-[#3183ff] bg-[#3183ff]/15 text-[#3183ff]' : 'border-[#2b3543] bg-[#0f1720]/80 text-[#8fa2b8] hover:text-white',
        disabled && 'cursor-not-allowed opacity-45 hover:text-[#8fa2b8]',
      )}
    >
      {/* `min-w-0 flex-1` is what lets the label be truncated. A flex item's default
          `min-width: auto` is its content, so this span refused to shrink and the 38 indicator
          rows pushed their text 70px past the right edge of the `w-60` menu (content 309px in a
          238px box): `Average Directional Movement Index Wilder (14)` was cut mid-word with no
          ellipsis, because the `truncate` the row asks for cannot bite on a box that is never
          narrower than its text. Truncation here is what MetaTrader does with a column too narrow
          for its own label (`Currency` drawn as `Curr…`, docs/mt5/09-toolbox.md:841). */}
      <span className="min-w-0 flex-1 truncate">{children}</span>
      <span className={cn('ml-1 h-1.5 w-1.5 shrink-0 rounded-full', on ? 'bg-accent' : 'bg-border')} />
    </button>
  );
}

/**
 * MetaTrader's PHONE chart bar.
 *
 * Six controls on one row, which is what MetaQuotes' own Android screenshot carries, left to right
 * (docs/mt5/04-mobile-app.md section 3, where each glyph was identified by downloading the icon
 * asset and matching it against the screenshot):
 *
 *   ☰   the navigation drawer (Android has one; iOS has no drawer at all)
 *   ✛   crosshair — "tap the crosshair button in the top bar", not a long press
 *   ∿   Indicators (a zig-zag crossed by a sine curve: `chart_indicators_button.png`)
 *   M30 the current period, which opens the quick strip
 *   ◐   the pending-order button
 *   ▭   the one-click trading panel toggle
 *
 * The period button sits in the middle-right because Android's far left is the drawer; iOS, with no
 * drawer, puts it at the far left instead. This shell has the drawer, so it is Android's order.
 *
 * The pending-order button is present and DISABLED, with the reason on it. Every contract here is
 * market execution, so there is no pending order to place — and a button drawn as if it worked
 * would be worse than one that says why it cannot.
 */
function MobileChartBar({
  tf, chooseTf, crosshair, onCrosshair, chartType, setChartType, ind, toggleIndicator,
  onProperties, onObjectsList, tool, onPickTool, priceManual, setAutoScale, resetVerticalScale,
  fullScreen, onFullScreen,
}: {
  tf: Timeframe;
  chooseTf: (tf: Timeframe) => void;
  crosshair: boolean;
  onCrosshair: () => void;
  chartType: MainType;
  setChartType: (t: MainType) => void;
  ind: ReadonlySet<string>;
  toggleIndicator: (id: string) => void;
  onProperties: () => void;
  onObjectsList: () => void;
  /** The drawing tool now armed, and how to arm one. See the Objects sheet below. */
  tool: ToolId;
  onPickTool: (id: ToolId) => void;
  /** MetaTrader's three vertical-scale modes, which it documents on BOTH phone platforms. */
  priceManual: boolean;
  setAutoScale: (on: boolean) => void;
  resetVerticalScale: () => void;
  /** Landscape only: whether the app's chrome is hidden. Undefined in portrait. */
  fullScreen?: boolean | undefined;
  onFullScreen?: ((full: boolean) => void) | undefined;
}) {
  const toggleDrawer = useNavDrawer((s) => s.toggle);
  const quick = useQuickTfStore((s) => s.quick);
  const toggleQuick = useQuickTfStore((s) => s.toggle);
  useRestoreQuickTf();
  const shown = useOneClickStore((s) => s.shown);
  const setShown = useOneClickStore((s) => s.setShown);
  useRestoreOneClick();

  /** One sheet at a time, as MetaTrader's are: the strip, the full period sheet, or indicators. */
  const [open, setOpen] = useState<null | 'strip' | 'periods' | 'indicators' | 'objects'>(null);
  /**
   * A long press adds or removes a period from the quick strip, which is MetaTrader's own gesture
   * for it. A phone has no right-click, so this is the only way to reach that behaviour.
   */
  const held = useRef<ReturnType<typeof setTimeout> | null>(null);
  const didHold = useRef(false);
  const holdStart = (tfKey: Timeframe) => {
    didHold.current = false;
    held.current = setTimeout(() => { didHold.current = true; toggleQuick(tfKey); }, 600);
  };
  const holdEnd = () => { if (held.current) clearTimeout(held.current); held.current = null; };

  const btn = 'grid h-9 w-9 shrink-0 place-items-center rounded transition';
  const on = 'bg-[#2b3543] text-[#3183ff]';
  const off = 'text-[#8fa2b8]';

  return (
    <>
      <div className="flex h-10 shrink-0 items-center gap-1 border-b border-[#2b3543] px-1">
        <button type="button" onClick={toggleDrawer} aria-label="Menu" className={cn(btn, off)}>
          <BarIcon.Menu />
        </button>
        <button
          type="button"
          onClick={onCrosshair}
          aria-pressed={crosshair}
          aria-label="Crosshair"
          className={cn(btn, crosshair ? on : off)}
        >
          <BarIcon.Crosshair />
        </button>
        <button
          type="button"
          onClick={() => setOpen(open === 'indicators' ? null : 'indicators')}
          aria-expanded={open === 'indicators'}
          aria-label="Indicators"
          className={cn(btn, open === 'indicators' ? on : off)}
        >
          <BarIcon.Indicators />
        </button>
        {/*
          * Objects.
          *
          * MetaTrader puts a dedicated Objects button in the phone chart's top bar on iOS, and
          * reaches the same thing through Android's radial menu; its iOS chart context menu is
          * "Trade / Indicators / Objects / Settings". This shell had NEITHER: the desktop rail is
          * `phone ? null`, and the indicator sheet carried only the Objects LIST — a list of
          * objects a phone trader had no way to create. This is the insert tree, as a sheet.
          */}
        <button
          type="button"
          onClick={() => setOpen(open === 'objects' ? null : 'objects')}
          aria-expanded={open === 'objects'}
          aria-label="Objects"
          className={cn(btn, open === 'objects' || (tool !== 'cursor' && tool !== 'crosshair') ? on : off)}
        >
          <BarIcon.Objects />
        </button>
        {/* The period, which is also the button that opens the quick strip. */}
        <button
          type="button"
          onClick={() => setOpen(open === 'strip' ? null : 'strip')}
          aria-expanded={open === 'strip'}
          aria-label={`Period ${mobileTfLabel(tf)}`}
          className={cn(
            'ml-auto h-9 shrink-0 rounded px-2 font-mono text-[13px] font-bold leading-none transition',
            open === 'strip' ? on : 'text-white',
          )}
        >
          {mobileTfLabel(tf)}
        </button>
        <button
          type="button"
          disabled
          aria-label="Pending order"
          title="Every contract here is market execution, so there is no pending order to place."
          className={cn(btn, off, 'opacity-40')}
        >
          <BarIcon.Pending />
        </button>
        <button
          type="button"
          onClick={() => setShown(!shown)}
          aria-pressed={shown}
          aria-label="One-click trading panel"
          className={cn(btn, shown ? on : off)}
        >
          <BarIcon.OneClick />
        </button>
        {/**
          * MetaTrader's full-screen toggle, LANDSCAPE ONLY, which is the only orientation it has
          * one in: "Rotate to landscape = full-screen mode, automatically. On iOS you can then
          * toggle full-screen/normal by tapping the chart."
          *
          * A button rather than that tap, because a tap on the plot is already the crosshair and
          * the drawing tools here: one gesture meaning two things would resolve as whichever the
          * chart read first. It is absent in portrait rather than disabled, because MetaTrader has
          * no full-screen mode there to be in or out of.
          */}
        {fullScreen === undefined || onFullScreen === undefined ? null : (
          <button
            type="button"
            onClick={() => onFullScreen(!fullScreen)}
            aria-pressed={!fullScreen}
            aria-label={fullScreen ? 'Leave full screen' : 'Full screen'}
            className={cn(btn, fullScreen ? off : on)}
          >
            {fullScreen ? <BarIcon.ExitFull /> : <BarIcon.EnterFull />}
          </button>
        )}
      </div>

      {/* The quick strip: "a horizontal quick strip across the top ... with the current one
          highlighted in solid blue and a gear at the right end". */}
      {open === 'strip' ? (
        <div className="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-[#2b3543] px-1 py-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {quick.map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => { if (!didHold.current) { chooseTf(k); setOpen(null); } }}
              onPointerDown={() => holdStart(k)}
              onPointerUp={holdEnd}
              onPointerLeave={holdEnd}
              onContextMenu={(e) => e.preventDefault()}
              aria-pressed={tf === k}
              className={cn(
                'h-8 shrink-0 rounded px-2.5 font-mono text-[12px] font-semibold leading-none transition',
                tf === k ? 'bg-[#3183ff] text-white' : 'bg-[#202933] text-[#8fa2b8]',
              )}
            >
              {mobileTfLabel(k)}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setOpen('periods')}
            aria-label="Set up timeframes"
            className="ml-auto grid h-8 w-8 shrink-0 place-items-center rounded bg-[#202933] text-[#8fa2b8]"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-4 w-4" aria-hidden>
              <circle cx="12" cy="12" r="3.2" />
              <path d="M12 2.6v2.2M12 19.2v2.2M21.4 12h-2.2M4.8 12H2.6M18.6 5.4l-1.6 1.6M7 17l-1.6 1.6M18.6 18.6L17 17M7 7L5.4 5.4" strokeLinecap="round" />
            </svg>
          </button>
        </div>
      ) : null}

      {/* The gear's sheet: all 21 periods in MetaTrader's three groups. Short press switches the
          chart; long press adds or removes the period from the strip above. */}
      {open === 'periods' ? (
        <MobileSheet title="Timeframes" onClose={() => setOpen(null)}>
          <p className="px-1 pb-2 text-[10px] leading-snug text-[#8fa2b8]">
            Tap to switch the chart. Press and hold to put a period on the quick strip, or take it
            off. The strip holds {MAX_QUICK_TF}.
          </p>
          {MOBILE_TF_GROUPS.map((g) => (
            <div key={g.label} className="mb-2 last:mb-0">
              {/* Title case, not the uppercase the desktop Tools menu uses for its own sections:
                  MetaTrader's phone period sheet heads its three groups "Minutes", "Hours" and
                  "Days", and shouting them would be this shell's styling rather than its. */}
              <div className="mb-1 text-[10px] font-semibold tracking-wide text-[#8fa2b8]">{g.label}</div>
              <div className="grid grid-cols-4 gap-1">
                {g.items.map((k) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => { if (!didHold.current) { chooseTf(k); setOpen(null); } }}
                    onPointerDown={() => holdStart(k)}
                    onPointerUp={holdEnd}
                    onPointerLeave={holdEnd}
                    onContextMenu={(e) => e.preventDefault()}
                    aria-pressed={tf === k}
                    className={cn(
                      'h-9 rounded font-mono text-[12px] font-semibold leading-none transition',
                      // MetaTrader's own two states on this sheet: solid blue = the chart's current
                      // period, outlined = on the quick strip.
                      tf === k
                        ? 'bg-[#3183ff] text-white'
                        : quick.includes(k)
                          ? 'border border-[#3183ff] text-[#3183ff]'
                          : 'bg-[#202933] text-[#8fa2b8]',
                    )}
                  >
                    {mobileTfLabel(k)}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </MobileSheet>
      ) : null}

      {/*
        * The Objects sheet: MetaTrader's 44-object Insert tree, in its own groups.
        *
        * Picking one arms the tool and closes the sheet, so the next tap lands on the chart - which
        * is how MetaTrader's phone app places an object, and the same `setTool` the desktop rail
        * drives. "Cursor" disarms, because a phone has no Esc key to cancel a pending object with.
        */}
      {open === 'objects' ? (
        <MobileSheet title="Objects" onClose={() => setOpen(null)}>
          <button
            type="button"
            onClick={() => { onPickTool('cursor'); setOpen(null); }}
            className={cn(
              'mb-2 h-9 w-full rounded text-[11px] font-semibold transition',
              tool === 'cursor' ? 'bg-[#3183ff] text-white' : 'bg-[#202933] text-[#8fa2b8]',
            )}
          >
            Cursor
          </button>
          <button
            type="button"
            onClick={() => { onObjectsList(); setOpen(null); }}
            className="mb-3 h-9 w-full rounded bg-[#202933] text-[11px] font-semibold text-[#8fa2b8] transition"
          >
            Objects list
          </button>
          {OBJECT_GROUPS.map((g) => (
            <div key={g.group} className="mb-2 last:mb-0">
              <div className="mb-1 text-[10px] font-semibold tracking-wide text-[#8fa2b8]">{g.label}</div>
              <div className="grid gap-1">
                {g.items.map((o) => (
                  <button
                    key={o.name}
                    type="button"
                    disabled={o.unavailable !== undefined}
                    title={o.unavailable}
                    aria-pressed={o.kind !== null && tool === o.kind}
                    onClick={() => { if (o.kind) { onPickTool(o.kind as ToolId); setOpen(null); } }}
                    className={cn(
                      'flex h-9 items-center rounded border px-2 text-left text-[11px] font-semibold transition',
                      o.kind !== null && tool === o.kind
                        ? 'border-[#3183ff] bg-[#3183ff]/15 text-[#3183ff]'
                        : 'border-[#2b3543] text-[#8fa2b8]',
                      o.unavailable && 'cursor-not-allowed opacity-45',
                    )}
                  >
                    <span className="truncate">{o.name}</span>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </MobileSheet>
      ) : null}

      {/* Indicators, chart type, properties and the objects list — the phone's equivalent of the
          desktop Tools menu, minus the object rail it has no room for. */}
      {open === 'indicators' ? (
        <MobileSheet title="Indicators" onClose={() => setOpen(null)}>
          <Section title="Chart type">
            <div className="grid grid-cols-3 gap-1">
              {[...chartTypesFor(true, chartType), ...ADDON_TYPES.filter((a) => a.id === chartType)].map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setChartType(c.id)}
                  className={cn(
                    'h-9 rounded text-[11px] font-semibold transition',
                    chartType === c.id ? 'bg-[#2b3543] text-white' : 'text-[#8fa2b8]',
                  )}
                >
                  {c.label}
                </button>
              ))}
            </div>
          </Section>
          <Section title="Chart">
            <div className="grid grid-cols-2 gap-1">
              <button type="button" onClick={() => { setOpen(null); onProperties(); }} className="h-9 rounded bg-[#202933] text-[11px] font-semibold text-[#8fa2b8]">Properties</button>
              <button type="button" onClick={() => { setOpen(null); onObjectsList(); }} className="h-9 rounded bg-[#202933] text-[11px] font-semibold text-[#8fa2b8]">Objects list</button>
            </div>
          </Section>
          {/*
            * MetaTrader's three vertical-scale modes, which it documents on BOTH phone platforms:
            * "There is an Auto-scale mode that restricts movement to horizontal only and auto-fits
            * the price range; Free chart movement returns to 2-D. Reset vertical scale restores the
            * original scale. (Both platforms.)" The desktop Tools menu carried all three and the
            * phone carried none, so a phone trader who stretched the price axis had no way back but
            * a reload — on the one shell where the stretch happens by accident, with a finger.
            */}
          <Section title="Scale">
            <div className="grid gap-1">
              <Toggle on={!priceManual} onClick={() => setAutoScale(true)}>Auto scale</Toggle>
              <Toggle on={priceManual} onClick={() => setAutoScale(false)}>Free chart movement</Toggle>
              <button
                type="button"
                onClick={() => { setOpen(null); resetVerticalScale(); }}
                className="h-9 rounded bg-[#202933] text-[11px] font-semibold text-[#8fa2b8]"
              >
                Reset vertical scale
              </button>
            </div>
          </Section>
          {INDICATOR_GROUPS.map((g) => (
            <Section key={g.group} title={g.label}>
              <div className="grid gap-1">
                {g.items.map((def) => (
                  <Toggle
                    key={def.id}
                    on={ind.has(def.id)}
                    disabled={def.unavailable !== undefined}
                    title={def.unavailable}
                    onClick={() => { if (!def.unavailable) toggleIndicator(def.id); }}
                  >
                    <span className="truncate">{def.name} <span className="text-[9px] opacity-70">{def.params}</span></span>
                  </Toggle>
                ))}
              </div>
              {g.group === 'volumes' ? (
                <p className="px-0.5 pt-1 text-[9px] leading-snug text-[#8fa2b8]">{VOLUME_GROUP_NOTE}</p>
              ) : null}
            </Section>
          ))}
        </MobileSheet>
      ) : null}
    </>
  );
}

/**
 * MetaTrader's phone sheets come up from the bottom edge over the chart, so this one does. It is
 * dismissed by the backdrop or by its own close button, and it never takes more than two-thirds of
 * the screen, because the chart under it is the thing being configured.
 */
function MobileSheet({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <>
      <button type="button" aria-label={`Close ${title}`} onClick={onClose} className="fixed inset-0 z-40 bg-black/60" />
      <div className="fixed inset-x-0 bottom-0 z-50 max-h-[68vh] overflow-y-auto overscroll-contain rounded-t-xl border-t border-[#2b3543] bg-[#0f1720] p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] shadow-2xl">
        <div className="mb-2 flex items-center">
          <span className="text-[12px] font-semibold text-white">{title}</span>
          <button type="button" onClick={onClose} aria-label="Close" className="ml-auto grid h-7 w-7 place-items-center rounded text-[#8fa2b8]">✕</button>
        </div>
        {children}
      </div>
    </>
  );
}

/**
 * The phone bar's six glyphs, drawn rather than typed.
 *
 * They were Unicode characters first (`☰ ✛ ∿ ◐ ▭`), and two of them came out as blank boxes on a
 * real Android device because the character is not in the system font. A toolbar with invisible
 * buttons is worse than no toolbar, so each is an inline SVG matched to the icon asset described in
 * docs/mt5/04-mobile-app.md section 3.
 */
const BarIcon = {
  /** Four arrows out: MetaTrader's full-screen. */
  EnterFull: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5" aria-hidden>
      <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
    </svg>
  ),
  /** And four arrows in, for the way back to the tabs. */
  ExitFull: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5" aria-hidden>
      <path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" />
    </svg>
  ),
  Menu: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="h-5 w-5" aria-hidden>
      <path d="M4 7h16M4 12h16M4 17h16" />
    </svg>
  ),
  /** A crosshair: a full-width and a full-height rule crossing at the centre, with a gap at it. */
  Crosshair: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" className="h-5 w-5" aria-hidden>
      <path d="M12 3v6M12 15v6M3 12h6M15 12h6" />
      <circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none" />
    </svg>
  ),
  /** Android's indicators glyph: "a zig-zag crossed by a sine curve". */
  Indicators: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5" aria-hidden>
      <path d="M3 17l4-7 4 4 4-8 4 6" />
      <path d="M3 11c3-5 6 5 9 0s6-5 9 0" opacity="0.55" />
    </svg>
  ),
  /** The pending-order button: a half-filled circle with a white clock hand. */
  Pending: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-5 w-5" aria-hidden>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 3.5a8.5 8.5 0 010 17z" fill="currentColor" stroke="none" opacity="0.45" />
      <path d="M12 7.5V12l3 1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  /** iOS's Objects button: the trend-line glyph MetaTrader uses for Line Studies. */
  Objects: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5" aria-hidden>
      <path d="M4 19L20 5" />
      <circle cx="4.6" cy="18.4" r="1.9" fill="currentColor" stroke="none" />
      <circle cx="19.4" cy="5.6" r="1.9" fill="currentColor" stroke="none" />
    </svg>
  ),
  /** The one-click panel toggle: a rounded rectangle with a pill inside it. */
  OneClick: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-5 w-5" aria-hidden>
      <rect x="3" y="7" width="18" height="10" rx="2.5" />
      <rect x="6.5" y="10.5" width="11" height="3" rx="1.5" fill="currentColor" stroke="none" />
    </svg>
  ),
};

/**
 * One row of MetaTrader's chart background menu.
 *
 * Four shapes, because its menu has four: a command, a toggle it draws ticked (`Grid`,
 * `Auto Scroll`), a mutually exclusive choice it draws with the active icon framed (the three
 * chart types, docs/mt5/08-chart-properties.md:500), and a row that opens a submenu.
 */
type ChartMenuItem =
  | { kind: 'command'; label: string; accel?: string; run: () => void }
  | { kind: 'toggle'; label: string; accel?: string; on: boolean; run: () => void }
  | { kind: 'radio'; label: string; accel?: string; on: boolean; run: () => void }
  /**
   * A row that opens a submenu.
   *
   * `on` is OPTIONAL on a submenu row, because MetaTrader's two submenus are different shapes.
   * `Timeframes` is a choice: 21 periods, one of them current, drawn ticked. `Trading` is a list of
   * commands, each acting on the price that was clicked, with nothing to tick. A row with no `on` is
   * announced as a plain `menuitem` rather than a `menuitemradio` that is permanently unchecked,
   * which is what a screen reader would otherwise read out.
   */
  | { kind: 'submenu'; label: string; items: ReadonlyArray<{ label: string; on?: boolean; run: () => void }> };

/**
 * MetaTrader's chart background context menu.
 *
 * It draws what it is given and nothing else; which rows exist, in what order and in what groups is
 * decided where it is used, beside the doc's own table. What lives here is the behaviour every
 * context menu owes its user and this chart had none of: it closes on Escape, on a click outside it
 * and on a choice, and it stays inside the window when it is opened near an edge.
 *
 * Source: docs/mt5/08-chart-properties.md:482-524, read off MetaQuotes' own `chart_trading_menu.png`.
 */
/** The narrowest a submenu is drawn: wide enough for 21 period keys, none longer than `MN1`. */
const SUB_WIDTH = 96;

/**
 * How wide a submenu will come out, before it has been laid out.
 *
 * `Timeframes` holds 21 three-character keys and `Trading` holds rows like `Alert  3075.60`, so one
 * fixed width cannot serve both: at 96px the Trading rows would wrap, and at Trading's width the
 * period list would be a mostly empty column. The box itself is `max-content`, so this estimate is
 * only used to decide whether the submenu fits to the RIGHT of the menu or has to flip left — being
 * a few pixels out moves it to the correct side anyway, and a wrong side is the visible failure.
 */
function subWidthOf(items: ReadonlyArray<{ label: string }>): number {
  const longest = items.reduce((n, i) => Math.max(n, i.label.length), 0);
  return Math.max(SUB_WIDTH, longest * 7 + 24);
}

function MT5ChartMenu({ at, groups, onDismiss }: {
  at: { x: number; y: number };
  groups: ReadonlyArray<ReadonlyArray<ChartMenuItem>>;
  onDismiss: () => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState(at);
  /** Which submenu is open, and where it was placed so that it fits on screen. */
  const [sub, setSub] = useState<{ label: string; x: number; y: number; h: number; w: number } | null>(null);
  /**
   * Right-clicking near the bottom or the right of the window would otherwise open a menu that runs
   * off it, which on a 900px-tall screen hides `Properties` — the item the menu exists for. Measured
   * after layout rather than estimated, because the height depends on how many rows this chart has,
   * and before the paint so the menu does not appear in the wrong place and then jump.
   */
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    const pad = 6;
    setPos({
      x: Math.max(pad, Math.min(at.x, window.innerWidth - width - pad)),
      y: Math.max(pad, Math.min(at.y, window.innerHeight - height - pad)),
    });
  }, [at.x, at.y]);

  /**
   * Place a submenu beside the row that opens it, and inside the window.
   *
   * Measured from the row and the menu rather than offset with `left-full`, because a submenu
   * anchored to its row's top runs off the bottom as soon as the row is in the lower half of the
   * screen — which Timeframes, 21 rows tall and two thirds of the way down a 27-row menu, always
   * is. It stays a CHILD of the row so that moving the pointer into it does not leave the row.
   */
  const openSub = (label: string, row: HTMLElement, items: ReadonlyArray<{ label: string }>) => {
    const r = row.getBoundingClientRect();
    const menu = box.current?.getBoundingClientRect() ?? r;
    const pad = 6;
    const h = Math.min(window.innerHeight - pad * 2, Math.round(window.innerHeight * 0.6));
    const w = subWidthOf(items);
    const right = menu.right + w + pad <= window.innerWidth;
    setSub({
      label,
      x: right ? menu.right : Math.max(pad, menu.left - w),
      y: Math.max(pad, Math.min(r.top, window.innerHeight - h - pad)),
      h,
      w,
    });
  };

  useEffect(() => {
    const away = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) onDismiss(); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onDismiss(); };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', esc); };
  }, [onDismiss]);

  const run = (fn: () => void) => () => { fn(); onDismiss(); };

  return (
    <div
      ref={box}
      role="menu"
      aria-label="Chart"
      data-chart-menu=""
      // A right click on the menu itself must not raise the browser's menu over it; the plot's own
      // suppression does not reach here, because the menu is not inside the plot.
      onContextMenu={(e) => e.preventDefault()}
      className="fixed z-[90] min-w-56 rounded-sm border border-[#2b3543] bg-[#202933] py-1 text-[11px] shadow-xl"
      style={{ left: pos.x, top: pos.y }}
    >
      {groups.map((group, g) => (
        <div key={g} className="contents">
          {/* MetaTrader's group separators, which are what make a 27-item menu readable. */}
          {g > 0 ? <div role="separator" data-menu-separator="" className="my-1 h-px bg-[#2b3543]" /> : null}
          {group.map((item) => (
            item.kind === 'submenu'
              ? (
                <div
                  key={item.label}
                  onMouseEnter={(e) => openSub(item.label, e.currentTarget, item.items)}
                  onMouseLeave={() => setSub(null)}
                >
                  <button
                    type="button"
                    role="menuitem"
                    aria-haspopup="menu"
                    aria-expanded={sub?.label === item.label}
                    onClick={(e) => (sub?.label === item.label ? setSub(null) : openSub(item.label, e.currentTarget, item.items))}
                    className="flex w-full items-center gap-4 px-3 py-1.5 text-left text-white transition hover:bg-[#3183ff]"
                  >
                    <span className="flex-1">{item.label}</span>
                    <span aria-hidden>▸</span>
                  </button>
                  {sub?.label === item.label ? (
                    <div
                      role="menu"
                      aria-label={item.label}
                      style={{ left: sub.x, top: sub.y, minWidth: sub.w, maxHeight: sub.h, width: 'max-content' }}
                      className="fixed z-[91] overflow-y-auto rounded-sm border border-[#2b3543] bg-[#202933] py-1 shadow-xl"
                    >
                      {item.items.map((sub) => (
                        <button
                          key={sub.label}
                          type="button"
                          role={sub.on === undefined ? 'menuitem' : 'menuitemradio'}
                          {...(sub.on === undefined ? {} : { 'aria-checked': sub.on })}
                          onClick={run(sub.run)}
                          className={cn(
                            'block w-full px-3 py-1 text-left transition hover:bg-[#3183ff]',
                            sub.on ? 'bg-[#2b3543] text-white' : 'text-white',
                          )}
                        >
                          {sub.label}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
              )
              : (
                <button
                  key={item.label}
                  type="button"
                  role={item.kind === 'command' ? 'menuitem' : item.kind === 'radio' ? 'menuitemradio' : 'menuitemcheckbox'}
                  {...(item.kind === 'command' ? {} : { 'aria-checked': item.on })}
                  onClick={run(item.run)}
                  onMouseEnter={() => setSub(null)}
                  className="flex w-full items-center gap-4 px-3 py-1.5 text-left text-white transition hover:bg-[#3183ff]"
                >
                  {/* The tick column, always reserved: without it the labels of the toggled rows
                      would sit a glyph further right than the rest and the menu would look ragged,
                      which is not what MetaTrader draws. */}
                  <span className="w-2.5 shrink-0 text-[#3183ff]" aria-hidden>
                    {item.kind !== 'command' && item.on ? (item.kind === 'radio' ? '•' : '✓') : ''}
                  </span>
                  <span className="flex-1">{item.label}</span>
                  {item.accel ? <span className="shrink-0 text-[#8fa2b8]">{item.accel}</span> : null}
                </button>
              )
          ))}
        </div>
      ))}
    </div>
  );
}
