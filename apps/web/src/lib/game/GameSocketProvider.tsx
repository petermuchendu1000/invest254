'use client';

import {
  createContext,
  useMemo,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { Direction } from '@invest254/shared';
import { formatKes } from '@invest254/shared/money';
import { CURVE_AMPLITUDE, CURVE_BASE_RATE } from '@invest254/shared/config';
import { env } from '@/lib/env';
import { useBrand } from '@/lib/brand/BrandProvider';
import { curveProfileForChartStyle, chartStyleOf, tradingViewTypeOf, type Candle } from '@invest254/shared/chart';
import { valueOfRate, type Timeframe, type MarketSymbol } from '@invest254/shared/candles';
import { wsUrlForSite } from '@/lib/brand/brand';
import { useSession } from '@/lib/auth/session';
import { useToast } from '@/lib/toast/ToastProvider';
import { useDisplayMoney } from '@/lib/money';
import { useOutcomeFx } from '@/lib/game/outcomeFx';
import { logJournal } from '@/lib/game/journal';
import {
  errorTitle, friendlyError, type LocalRefusal,
} from '@/lib/game/orderResult';
import { orderWindowWaiting } from '@/lib/game/orderWindow';
import type { WalletDto } from '@/lib/api/types';
import type {
  ConnStatus,
  Envelope,
  FairnessData,
  HelloData,
  OnlineData,
  Tick,
} from '@/lib/game/types';
import type {
  ActivePosition,
  BalanceData,
  OpenPositionInput,
  PositionOpenedData,
  PositionSettledData,
  PositionUpdateData,
  WsErrorData,
} from '@/lib/game/betting';
import type { InstrumentTick } from '@/lib/game/useInstrument';

const MAX_TICKS = 3000;

/** C→S: open a Deriv-style DIGIT contract on an instrument (server-authoritative). */
export interface OpenDigitInput { instrumentId: string; kind: string; target?: number; stakeCents: number; ticks?: number }
/** S→C: a settled digit contract (authoritative outcome + new balance). */
export interface DigitSettledData { positionId: string; instrumentId: string; index: number; digit: number; won: boolean; payoutCents: number; pnlCents: number; balance: number }
/** C→S: open a Deriv-style MULTIPLIER contract (server-authoritative). */
export interface OpenMultiplierInput { instrumentId: string; dir: 'up' | 'down'; multiplier: number; stakeCents: number; tpCents?: number | null; slCents?: number | null; dcMinutes?: number }
/** S→C: multiplier lifecycle events (opened ack / per-tick P&L / authoritative close). */
export interface MultOpenedData { positionId: string; instrumentId: string; entry: number; stakeCents: number; dir: 'up' | 'down'; multiplier: number; tpCents: number | null; slCents: number | null; dcUntilMs: number | null; dcFeeCents: number }
export interface MultUpdateData { positionId: string; instrumentId: string; index: number; pnlCents: number }
export interface MultClosedData { positionId: string; reason: 'manual' | 'tp' | 'sl' | 'stopout' | 'cancel'; pnlCents: number; payoutCents: number; balance: number }
export type MultEvent =
  | { type: 'opened'; data: MultOpenedData }
  | { type: 'update'; data: MultUpdateData }
  | { type: 'closed'; data: MultClosedData };

interface GameSocketValue {
  status: ConnStatus;
  online: number;
  fairness: FairnessData | null;
  getTicks: () => Tick[];
  getLastTick: () => Tick | null;
  /** The single in-flight position (optimistic → open → settling), or null. */
  activePosition: ActivePosition | null;
  /**
   * Place a BUY/SELL position (optimistic; reconciled by `position_opened`).
   *
   * Returns the reason it was NOT sent, or null when it went. It used to return void and refuse
   * silently, which hid the single-open rule completely: a contract still settling counts as open
   * while the Trade screen already says "No open positions", so a tap did nothing at all for a
   * reason nothing on screen stated. MetaTrader puts a rejection in the order window, and it
   * cannot do that without being told.
   */
  openPosition: (input: OpenPositionInput) => LocalRefusal | null;
  /**
   * Move or clear the protective levels on the open position (MetaTrader's Modify position).
   *
   * Returns false when there is nothing open or the socket is down. The engine's reply is the
   * truth; this only asks.
   */
  setLevels: (slPrice: number | null, tpPrice: number | null) => boolean;
  /**
   * The last trade error the engine sent, for the order window to show as MetaTrader's rejection.
   *
   * Carries the same title and detail the toast uses, from `lib/game/orderResult`, so the two
   * cannot drift into saying different things about one refusal.
   */
  lastTradeError: { code: string; title: string; detail: string | undefined; at: number } | null;
  /** Manually cash out the open position (only valid while `sellable`). */
  sell: () => void;
  /**
   * Whether `sell` can succeed on this brand at all. The engine refuses every manual close while
   * the brand runs in pool mode, so a Close control, and anything built on it (take profit), is
   * only honest where this is true. False until the engine has said otherwise.
   */
  earlyCloseEnabled: boolean;

  // ── Phase 2: Deriv-style digits/instrument stream (isolated from the rise/fall path above) ──────
  /** Authoritative per-instrument tick buffer (quote as `rate`), for the digits chart. */
  getInstrumentTicks: () => InstrumentTick[];
  getLastInstrumentTick: () => InstrumentTick | null;
  /** Bumps whenever the subscribed instrument (re)seeds, so the chart re-renders its data. */
  instrumentResetKey: string;
  /** Subscribe the socket to an instrument's authoritative feed (history + live ticks). */
  subscribeInstrument: (instrumentId: string) => void;
  /** Place a DIGIT contract; settlement arrives via `onDigitSettled`. False = not sent (no login / offline). */
  openDigit: (input: OpenDigitInput) => boolean;
  /** Subscribe to authoritative digit settlements. Returns an unsubscribe fn. */
  onDigitSettled: (cb: (s: DigitSettledData) => void) => () => void;
  /** The engine refused a digit open (funds, limits, one-at-a-time…). Returns an unsubscribe fn. */
  onDigitRejected: (cb: (e: { code: string; message: string }) => void) => () => void;
  /** The engine accepted a digit open from THIS socket (its position id). Returns an unsubscribe fn. */
  onDigitOpened: (cb: (e: { positionId: string; instrumentId: string }) => void) => () => void;
  /** Place a MULTIPLIER contract; lifecycle arrives via `onMultiplier`. */
  openMultiplier: (input: OpenMultiplierInput) => void;
  /** Manually close an open multiplier (server may refuse in pool mode). */
  closeMultiplier: (positionId: string) => void;
  /** Subscribe to multiplier lifecycle events (opened/update/closed). Returns an unsubscribe fn. */
  onMultiplier: (cb: (e: MultEvent) => void) => () => void;

  // ── Candle history (MT5 chart). Display-only: these bars settle nothing. ───────────────────────
  /**
   * Closed OHLC bars at an MT5 period, newest last, plus the anchor that places live ticks on the
   * same price axis. Pass `to` (a bar time in epoch seconds) to page further back.
   *
   * Rejects rather than resolving empty, so the chart can tell "no history here" from "ask again".
   */
  requestCandles: (tf: Timeframe, count: number, to?: number, symbol?: string) => Promise<CandlesReply>;
  /**
   * The brand's tradable list, for Market Watch and the Symbols dialog.
   *
   * Carries no prices. What each symbol IS is static; what it costs comes off the quote stream, and
   * a price embedded here would be one nothing could age.
   */
  requestSymbols: () => Promise<SymbolsReply>;
  /**
   * Replace the set of symbols this client wants live quotes for.
   *
   * A SET, not an addition, because that is what a Market Watch list is: the client owns it and
   * re-sends it when the trader changes it. Re-armed automatically after a reconnect.
   */
  subscribeSymbols: (symbols: readonly string[]) => void;
  /** A watched symbol's live quote, or null before its first one lands. */
  getSymbolQuote: (symbol: string) => SymbolQuote | null;
  /**
   * Instrument and day anchor from the most recent candle reply, or null before one has landed.
   *
   * It lets anything outside the chart — the price strip, an order ticket, a position's P/L — quote
   * the same symbol at the same price as the chart, instead of each deriving its own.
   */
  getMarket: () => { instrument: MarketSymbol; anchor: CandlesReply['anchor'] } | null;
  /** Market newswire for the News tab. Public market copy; rejects on failure. */
  requestNews: (limit?: number) => Promise<NewsReply>;
  /**
   * The day anchors needed to place rates from EARLIER days on the price axis.
   *
   * `getMarket()` carries today's anchor only, and the axis is re-anchored every UTC midnight, so a
   * rate recorded on an older day cannot be priced from it. Ask the engine for that day's own.
   */
  requestAnchors: (days: readonly string[]) => Promise<AnchorsReply>;
}

export interface NewsItemDto {
  id: string;
  title: string;
  source: string;
  url: string;
  publishedAtMs: number;
  summary: string;
}
export interface NewsReply { items: NewsItemDto[]; fetchedAtMs: number }

/** One UTC day's price anchor: price = base + instrument.scale * (value(t) - openValue). */
export interface DayAnchor { dateKey: string; base: number; openValue: number }
export interface AnchorsReply { instrument: MarketSymbol; days: DayAnchor[] }

/** One row of the brand's tradable list. `group` is MetaTrader's tree path, e.g. `Forex\\Majors`. */
export interface SymbolRow { symbol: string; description: string; group: string; digits: number }
export interface SymbolsReply { defaultSymbol: string; symbols: SymbolRow[] }

/**
 * A watched symbol's live state: enough to print its price and colour it the way MetaTrader does.
 *
 * `price` is kept alongside `rate` because every consumer would otherwise redo the same arithmetic
 * against the same anchor, and one of them would eventually use the wrong symbol's anchor.
 */
export interface SymbolQuote {
  symbol: string;
  instrument: MarketSymbol;
  anchor: { tradeDate: string; base: number; openValue: number };
  rate: number;
  price: number;
  /** Direction of the last price CHANGE, and when it changed. See lib/game/quoteTone. */
  up: boolean | null;
  changedAt: number | null;
  t: number;
  /**
   * The day's high and low SO FAR, as prices, which MetaTrader's phone row prints as `H:` and `L:`.
   *
   * They arrive on the quote because the engine is the only side that can know them: it holds the
   * day, and a client deriving them would have to fetch a day of bars per watched symbol. Null
   * until the first quote carrying them lands, and on an engine that predates them, which is why
   * the row renders without them rather than printing a dash.
   */
  dayHigh: number | null;
  dayLow: number | null;
}

export interface CandlesReply {
  tf: Timeframe;
  instrument: MarketSymbol;
  bars: Candle[];
  /** price = base + instrument.scale * (valueOfRate(tick.rate) - openValue) */
  anchor: { tradeDate: string; base: number; openValue: number };
}

/** Stable functions (never change identity) — consumers that only trade/read buffers never re-render. */
type GameSocketApi = Omit<GameSocketValue, 'status' | 'online' | 'fairness' | 'activePosition' | 'earlyCloseEnabled' | 'lastTradeError' | 'instrumentResetKey'>;
type GameSocketState = Pick<GameSocketValue, 'status' | 'online' | 'fairness' | 'activePosition' | 'earlyCloseEnabled' | 'lastTradeError'>;
const ApiCtx = createContext<GameSocketApi | null>(null);
const StateCtx = createContext<GameSocketState | null>(null);
const InstKeyCtx = createContext<string>('');

const SYNTH_SPACING_MS = 150;
const SYNTH_SPAN_MS = 60_000;

// CLIENT-ONLY placeholder tape, shown until the first real engine tick arrives (or while offline).
// It mirrors the engine's price curve (packages/shared/curve.ts): a dense, non-harmonic spectrum of
// pink-noise sinusoids ⇒ fractional-Brownian-motion texture (trends, pullbacks, varied candles) that
// reads like a market, NOT a repeating wave. It is NOT seeded/deterministic and never decides any
// outcome — purely cosmetic, so live data overwrites it the moment it arrives.
const SYNTH_DRIFT = 0.30;  // green bias — mirrors DEFAULT_CONFIG.driftBias
const SYNTH_VOL = 1.0;     // amplitude scaler — mirrors DEFAULT_CONFIG.volatility

const synthRate = (value: number) => CURVE_BASE_RATE + CURVE_AMPLITUDE * value;

// The two shapes the engine curve uses (packages/shared/curve.ts), mirrored here so the placeholder
// matches the brand it is standing in for: `wave` for line brands (irregular rise/fall waves),
// `market` for the trending candlestick/bars/area brands.
const SYNTH_PROFILES = {
  market: { K: 16, baseFreq: 0.006, ratio: 1.42, ampExp: 0.85, fj: 0.38, fj0: 0.82, aj: 0.4, aj0: 0.8, driftScale: 1 },
  wave: { K: 14, baseFreq: 0.022, ratio: 1.4, ampExp: 0.5, fj: 0.65, fj0: 0.7, aj: 0.75, aj0: 0.65, driftScale: 0.18 },
} as const;

/** Build a closed-form fBm-like curve value(t) (seconds) in (-1,1), matching the engine's shape. */
function makeSynthCurve(profile: 'market' | 'wave'): (t: number) => number {
  const p = SYNTH_PROFILES[profile];
  const comps: { freq: number; amp: number; phase: number }[] = [];
  let ampSum = 0;
  for (let k = 0; k < p.K; k++) {
    const freq = p.baseFreq * p.ratio ** k * (p.fj0 + Math.random() * p.fj); // jitter off the ladder
    const amp = (1 / freq ** p.ampExp) * (p.aj0 + Math.random() * p.aj);      // pink-ish spectrum
    ampSum += amp;
    comps.push({ freq, amp, phase: Math.random() * 2 * Math.PI });
  }
  return (t: number) => {
    let s = 0;
    for (const c of comps) s += c.amp * Math.sin(2 * Math.PI * c.freq * t + c.phase);
    return Math.tanh((s / ampSum) * SYNTH_VOL + SYNTH_DRIFT * p.driftScale);
  };
}

function isTick(v: unknown): v is Tick {
  return (
    typeof v === 'object' && v !== null &&
    typeof (v as Tick).t === 'number' && typeof (v as Tick).rate === 'number'
  );
}

/** The user a JWT belongs to (its `sub`), or null. Used only to tell "same user, refreshed token" apart. */
function subOf(token: string | null): string | null {
  if (!token) return null;
  try { return (JSON.parse(atob(token.split('.')[1]!.replace(/-/g, '+').replace(/_/g, '/'))) as { sub?: string }).sub ?? null; } catch { return null; }
}

export function GameSocketProvider({ children }: { children: React.ReactNode }) {
  const token = useSession((s) => s.token);
  const tokenRef = useRef<string | null>(token);
  tokenRef.current = token;

  // Bind the live socket to the current brand: the multiplexed engine reads `?site=` at connect
  // (before any token) so the public tick stream starts on the right brand; the post-auth JWT
  // `site` claim must then match. Kept in a ref so the mount-scoped connect() closure sees it.
  const brand = useBrand();
  const siteRef = useRef(brand.siteId);
  siteRef.current = brand.siteId;

  const qc = useQueryClient();
  const toast = useToast();
  const { fmt } = useDisplayMoney();
  const fmtRef = useRef(fmt);
  fmtRef.current = fmt;

  const ticksRef = useRef<Tick[]>([]);
  const wsRef = useRef<WebSocket | null>(null);
  const closedRef = useRef(false);
  const attemptRef = useRef(0);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const heartbeat = useRef<ReturnType<typeof setInterval> | null>(null);
  const clientSeq = useRef(0);
  const realSeenRef = useRef(false);
  const synthCurveRef = useRef<((t: number) => number) | null>(null);
  const synthOriginRef = useRef(0);
  // Placeholder tape shape for this brand: `wave` for line brands, `market` for candlestick/bars/area.
  const synthProfileRef = useRef<'market' | 'wave'>(curveProfileForChartStyle(chartStyleOf(brand.chartStyle)));
  synthProfileRef.current = curveProfileForChartStyle(chartStyleOf(brand.chartStyle));
  /**
   * Whether this brand is a MetaTrader terminal, read inside the socket handler.
   *
   * A ref rather than a value, because the handler is installed once and closes over what it can
   * see; a brand read at install time would be stale after a brand switch.
   */
  const terminalRef = useRef(tradingViewTypeOf(chartStyleOf(brand.chartStyle)) !== null);
  terminalRef.current = tradingViewTypeOf(chartStyleOf(brand.chartStyle)) !== null;

  const [status, setStatus] = useState<ConnStatus>('connecting');
  const [online, setOnline] = useState(0);
  const [fairness, setFairness] = useState<FairnessData | null>(null);
  // Set from the engine's hello. False until then: the close affordances stay away rather than
  // appearing and then failing.
  const [earlyCloseEnabled, setEarlyCloseEnabled] = useState(false);
  const [activePosition, setActivePosition] = useState<ActivePosition | null>(null);
  const activeRef = useRef<ActivePosition | null>(null);
  /**
   * The last trade rejection, for the order window to show.
   *
   * Stamped with `at` so a window can tell a fresh refusal from the one it already showed: two
   * identical refusals in a row are two events, and the second has to re-render.
   */
  const [lastTradeError, setLastTradeError] =
    useState<{ code: string; title: string; detail: string | undefined; at: number } | null>(null);

  // Phase 2 — instrument/digit stream state (separate buffer so it never touches the rise/fall path).
  const instTicksRef = useRef<InstrumentTick[]>([]);
  const [instrumentResetKey, setInstrumentResetKey] = useState('');
  const subscribedInstrumentRef = useRef<string | null>(null);
  const digitListenersRef = useRef<Set<(s: DigitSettledData) => void>>(new Set());
  // Digit opens sent and not yet acknowledged: an 'error' frame while one is outstanding is its refusal.
  const digitAwaitingRef = useRef(0);
  const digitRejectRef = useRef<Set<(e: { code: string; message: string }) => void>>(new Set());
  const digitOpenedRef = useRef<Set<(e: { positionId: string; instrumentId: string }) => void>>(new Set());
  const rejectDigit = (code: string, message: string) => {
    digitAwaitingRef.current = Math.max(0, digitAwaitingRef.current - 1);
    digitRejectRef.current.forEach((cb) => { try { cb({ code, message }); } catch { /* non-fatal */ } });
  };
  const multListenersRef = useRef<Set<(e: MultEvent) => void>>(new Set());

  /** Keep ref + state in lockstep so socket handlers can read the current value. */
  const setActive = useCallback(
    (next: ActivePosition | null | ((cur: ActivePosition | null) => ActivePosition | null)) => {
      const resolved = typeof next === 'function' ? next(activeRef.current) : next;
      activeRef.current = resolved;
      setActivePosition(resolved);
    },
    [],
  );

  /**
   * The order-acknowledgement watchdog.
   *
   * `open_position` is the one request on this socket that moves money, and it was the only one with
   * no bound on the wait: candles and anchors time out at 20s, symbols and news have their own
   * waiters, auth at 8s, and an order had nothing. A lost `position_opened` therefore left the card
   * reading "Opening…" with the stake optimistically debited, for the life of the page. The engine
   * cannot be the slow part: measured against it, an order is acknowledged in 0.4ms at the median,
   * 1.9ms at p95 and 4.1ms at the worst of 25 (scratchpad/acklat2.mjs), so everything past that is
   * network. 8s matches the auth timeout already in this file, which is the same judgement about the
   * same socket.
   *
   * On firing it does NOT roll back. Rolling back a position the engine really opened would leave a
   * trader unable to see or close it, which is worse than the freeze; keeping one that was never
   * opened shows money committed to nothing. So it asks: `sync_positions` is answered with the
   * authoritative list, and `open_positions` below resolves the pending order against it either way.
   */
  const OPEN_ACK_TIMEOUT_MS = 8_000;
  const openAckTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** True between the watchdog firing and the `open_positions` that answers it. */
  const awaitingSync = useRef(false);
  const clearOpenAck = useCallback(() => {
    if (openAckTimer.current) { clearTimeout(openAckTimer.current); openAckTimer.current = null; }
    awaitingSync.current = false;
  }, []);

  const getTicks = useCallback(() => ticksRef.current, []);
  const getLastTick = useCallback(
    () => (ticksRef.current.length > 0 ? ticksRef.current[ticksRef.current.length - 1]! : null),
    [],
  );

  const getInstrumentTicks = useCallback(() => instTicksRef.current, []);
  const getLastInstrumentTick = useCallback(
    () => (instTicksRef.current.length > 0 ? instTicksRef.current[instTicksRef.current.length - 1]! : null),
    [],
  );

  const send = useCallback((type: string, data: unknown): boolean => {
    const ws = wsRef.current;
    if (ws && ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify({ type, data }));
      return true;
    }
    return false;
  }, []);

  /**
   * Candle requests waiting for a reply, by request id.
   *
   * The chart pages backwards while the live edge keeps updating, so several can be in flight at
   * once; the engine echoes the id so each reply — including a failure — matches its own request.
   */
  const candleWaitersRef = useRef(new Map<string, { resolve: (r: CandlesReply) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>());
  const candleSeqRef = useRef(0);
  const marketRef = useRef<{ instrument: MarketSymbol; anchor: CandlesReply['anchor'] } | null>(null);
  const getMarket = useCallback(() => marketRef.current, []);
  /**
   * Candle frames raised before the socket was open, flushed once it is.
   *
   * The chart mounts with the page and asks for history immediately, which is almost always before
   * the WebSocket has finished connecting. Failing there left the chart stuck on "History
   * unavailable" for the whole session; holding the frame costs nothing and the per-request deadline
   * still applies.
   */
  const candleOutboxRef = useRef<Array<{ reqId: string; tf: Timeframe; count: number; to?: number; symbol?: string }>>([]);

  const settleCandleWaiter = useCallback((reqId: string, outcome: { ok: CandlesReply } | { err: Error }): void => {
    const w = candleWaitersRef.current.get(reqId);
    if (!w) return;
    candleWaitersRef.current.delete(reqId);
    clearTimeout(w.timer);
    if ('ok' in outcome) w.resolve(outcome.ok); else w.reject(outcome.err);
  }, []);

  /** Reject everything still waiting — the socket went away, so no reply is ever coming. */
  const dropCandleWaiters = useCallback((reason: string): void => {
    for (const [id] of candleWaitersRef.current) settleCandleWaiter(id, { err: new Error(reason) });
  }, [settleCandleWaiter]);

  const requestCandles = useCallback((tf: Timeframe, count: number, to?: number, symbol?: string): Promise<CandlesReply> => {
    const reqId = `c${++candleSeqRef.current}`;
    return new Promise<CandlesReply>((resolve, reject) => {
      // No symbol means the brand's default, which is what every caller written before multi-symbol
      // asks for. Naming one that the brand does not offer is refused by the engine rather than
      // answered with the default's bars under the requested name.
      const frame = { reqId, tf, count, ...(to === undefined ? {} : { to }), ...(symbol === undefined ? {} : { symbol }) };
      if (!send('candles', frame)) candleOutboxRef.current.push(frame);
      // Without a deadline a dropped reply would leave the chart spinning for ever.
      const timer = setTimeout(() => settleCandleWaiter(reqId, { err: new Error('CANDLES_TIMEOUT') }), 20_000);
      candleWaitersRef.current.set(reqId, { resolve, reject, timer });
    });
  }, [send, settleCandleWaiter]);

  // ── Day anchors ────────────────────────────────────────────────────────────────────────────────
  // Request-id matched like the candles, not queued like the news: two tabs of the Toolbox can be
  // asking about different sets of days at once, and a reply must reach the caller that wanted it.
  const anchorSeqRef = useRef(0);
  const anchorWaitersRef = useRef<Map<string, { resolve: (r: AnchorsReply) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>>(new Map());
  const anchorOutboxRef = useRef<Array<{ reqId: string; days: string[] }>>([]);

  const settleAnchorWaiter = useCallback((reqId: string, outcome: { ok: AnchorsReply } | { err: Error }): void => {
    const w = anchorWaitersRef.current.get(reqId);
    if (!w) return;
    anchorWaitersRef.current.delete(reqId);
    clearTimeout(w.timer);
    if ('ok' in outcome) w.resolve(outcome.ok); else w.reject(outcome.err);
  }, []);

  const requestAnchors = useCallback((days: readonly string[]): Promise<AnchorsReply> => {
    const reqId = `a${++anchorSeqRef.current}`;
    return new Promise<AnchorsReply>((resolve, reject) => {
      const frame = { reqId, days: [...days] };
      if (!send('anchors', frame)) anchorOutboxRef.current.push(frame);
      const timer = setTimeout(() => settleAnchorWaiter(reqId, { err: new Error('ANCHORS_TIMEOUT') }), 20_000);
      anchorWaitersRef.current.set(reqId, { resolve, reject, timer });
    });
  }, [send, settleAnchorWaiter]);

  // ── The brand's symbol list, and live quotes for the ones this client watches ──────────────────
  /**
   * Queued rather than request-id matched, like the newswire and unlike the candles: there is one
   * list per brand and one shape of answer, so the next `symbols` frame belongs to everyone waiting.
   */
  const symbolsWaitersRef = useRef<Array<{ resolve: (r: SymbolsReply) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>>([]);
  const symbolsOutboxRef = useRef(false);
  const requestSymbols = useCallback((): Promise<SymbolsReply> => new Promise<SymbolsReply>((resolve, reject) => {
    // Asked for before the socket is ready (Market Watch mounts with the page), the request is held
    // and flushed on open: failing outright would leave the list permanently empty.
    if (!send('symbols', {})) symbolsOutboxRef.current = true;
    const timer = setTimeout(() => {
      const i = symbolsWaitersRef.current.findIndex((w) => w.timer === timer);
      if (i >= 0) symbolsWaitersRef.current.splice(i, 1)[0]!.reject(new Error('SYMBOLS_TIMEOUT'));
    }, 20_000);
    symbolsWaitersRef.current.push({ resolve, reject, timer });
  }), [send]);

  /** The symbols asked for, kept so the subscription can be re-armed after a reconnect. */
  const watchedRef = useRef<readonly string[]>([]);
  const quotesRef = useRef(new Map<string, SymbolQuote>());
  const subscribeSymbols = useCallback((symbols: readonly string[]) => {
    watchedRef.current = [...symbols];
    // Quotes for symbols no longer watched are dropped: keeping them would let a stale price from
    // minutes ago be printed as if it were live.
    for (const sym of [...quotesRef.current.keys()]) if (!symbols.includes(sym)) quotesRef.current.delete(sym);
    send('subscribe_symbols', { symbols: [...symbols] }); // no-op while closed; re-sent on hello
  }, [send]);
  const getSymbolQuote = useCallback((symbol: string) => quotesRef.current.get(symbol) ?? null, []);

  const newsWaitersRef = useRef<Array<{ resolve: (r: NewsReply) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>>([]);
  const newsOutboxRef = useRef<Array<{ limit: number }>>([]);
  const requestNews = useCallback((limit = 40): Promise<NewsReply> => new Promise<NewsReply>((resolve, reject) => {
    // The newswire carries no request id: there is one wire and one shape of answer, so the next
    // `news` frame belongs to whoever is waiting. Everyone in the queue is served by it.
    // Asked for before the socket is ready (the News tab can be opened immediately), the frame is
    // held and flushed on open — failing outright would leave the tab permanently empty.
    if (!send('news', { limit })) newsOutboxRef.current.push({ limit });
    const timer = setTimeout(() => {
      const i = newsWaitersRef.current.findIndex((w) => w.timer === timer);
      if (i >= 0) newsWaitersRef.current.splice(i, 1)[0]!.reject(new Error('NEWS_TIMEOUT'));
    }, 20_000);
    newsWaitersRef.current.push({ resolve, reject, timer });
  }), [send]);

  // BUGLOG #88: the engine verifies `auth` asynchronously, so a trade sent in the moments after a
  // (re)connect was refused AUTH_REQUIRED ("Log in to trade" while signed in). Trades wait for the
  // auth answer (the `balance` frame) — at most a few seconds — then go out in order.
  const authedRef = useRef(false);
  const lastFrameAtRef = useRef(0);
  const authQueueRef = useRef<Array<{ type: string; data: unknown; at: number }>>([]);
  const sendTrade = useCallback((type: string, data: unknown): boolean => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== ws.OPEN) return false;
    if (authedRef.current) { ws.send(JSON.stringify({ type, data })); return true; }
    authQueueRef.current.push({ type, data, at: Date.now() });
    return true;
  }, []);

  // Trades that will never be sent (auth refused / timed out, socket closed): tell whoever waits
  // (BUGLOG #116: only digit opens were told; a classic open stayed "Opening…" for good).
  const dropQueued = (code: string) => {
    const q = authQueueRef.current.splice(0);
    let classic = false;
    for (const m of q) {
      if (m.type === 'open_digit') rejectDigit(code, '');     // the digits screen tells the player
      if (m.type === 'open_position' && activeRef.current && !activeRef.current.positionId) {
        activeRef.current = null; setActivePosition(null); classic = true;
        void qc.invalidateQueries({ queryKey: ['wallet'] });
      }
    }
    if (classic) toast.push({ tone: 'error', title: 'Not connected', description: 'Reconnecting…' });
  };
  // The auth answer must come within 8 s, or whatever waits behind it is dropped (was: no timer).
  const authTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const armAuthTimer = () => {
    if (authTimerRef.current) clearTimeout(authTimerRef.current);
    authTimerRef.current = setTimeout(() => { authTimerRef.current = null; if (!authedRef.current) dropQueued('NOT_CONNECTED'); }, 8_000);
  };
  const authAnswered = () => { if (authTimerRef.current) { clearTimeout(authTimerRef.current); authTimerRef.current = null; } };

  const setWalletReal = useCallback(
    (real: number, currency?: string, bonus?: number) => {
      qc.setQueryData<WalletDto>(['wallet'], (old) =>
        old
          ? { ...old, real, ...(typeof bonus === 'number' ? { bonus } : {}) }
          : { real, bonus: bonus ?? 0, currency: currency ?? 'KES' },
      );
    },
    [qc],
  );

  const openPosition = useCallback(
    (input: OpenPositionInput): LocalRefusal | null => {
      // Single-open rule, the engine's own. A contract in `settling` still holds the slot.
      if (activeRef.current) return 'POSITION_OPEN';
      if (!tokenRef.current) {
        toast.push({ tone: 'error', title: 'Log in to trade' });
        return 'LOGIN_REQUIRED';
      }
      if (!sendTrade('open_position', input)) {
        toast.push({ tone: 'error', title: 'Not connected', description: 'Reconnecting: try again shortly.' });
        return 'OFFLINE';
      }
      const last = ticksRef.current[ticksRef.current.length - 1] ?? null;
      const now = Date.now();
      setActive({
        positionId: null,
        clientId: `c${++clientSeq.current}`,
        direction: input.direction,
        stakeCents: input.stakeCents,
        durationS: input.durationS,
        phase: 'pending',
        entryRate: last?.rate ?? null,
        expiresAtMs: now + input.durationS * 1000,
        liveMultiplier: 1,
        livePnlCents: 0,
        secondsLeft: input.durationS,
        sellable: false,
        // What was ASKED for. `position_opened` replaces these with what the engine actually took.
        slPrice: input.slPrice ?? null,
        tpPrice: input.tpPrice ?? null,
      });
      // Bound the wait. See OPEN_ACK_TIMEOUT_MS: on firing this asks the engine rather than guessing.
      if (openAckTimer.current) clearTimeout(openAckTimer.current);
      openAckTimer.current = setTimeout(() => {
        openAckTimer.current = null;
        const a = activeRef.current;
        if (!a || a.positionId) return; // acked while the timer was in flight
        logJournal('warn', 'Trade', 'No acknowledgement in 8s: asking the server what is open');
        awaitingSync.current = true;
        if (!sendTrade('sync_positions', {})) {
          // The socket is gone, so nothing can answer. Roll back and let the reconnect's own
          // `open_positions` re-adopt the position if the engine does hold one.
          awaitingSync.current = false;
          setActive(null);
          void qc.invalidateQueries({ queryKey: ['wallet'] });
          toast.push({ tone: 'error', title: 'Order not confirmed', description: 'Reconnecting: your positions will reappear if the order was taken.' });
        }
      }, OPEN_ACK_TIMEOUT_MS);
      // Optimistic debit; reconciled by the authoritative `balance` push.
      qc.setQueryData<WalletDto>(['wallet'], (old) =>
        old ? { ...old, real: Math.max(0, old.real - input.stakeCents) } : old,
      );
      return null;
    },
    [qc, send, setActive, toast],
  );

  /**
   * MetaTrader's Modify position, sent to the ENGINE.
   *
   * The levels do not live here. This asks the engine to hold them, and the engine's `levels_set`
   * reply is what the UI believes afterwards, so a tab that lost a race against another device is
   * corrected rather than left showing a stop the server never took.
   */
  const setLevels = useCallback((slPrice: number | null, tpPrice: number | null): boolean => {
    const a = activeRef.current;
    if (!a || !a.positionId || a.phase !== 'open') return false;
    if (!send('set_levels', { positionId: a.positionId, slPrice, tpPrice })) {
      toast.push({ tone: 'error', title: 'Not connected', description: 'Reconnecting: your levels were not changed.' });
      return false;
    }
    return true;
  }, [send, toast]);

  const sell = useCallback(() => {
    const a = activeRef.current;
    if (!a || !a.positionId || a.phase !== 'open' || !a.sellable) return;
    if (!send('sell', { positionId: a.positionId })) {
      toast.push({ tone: 'error', title: 'Not connected', description: 'Reconnecting. Your position auto-settles at expiry.' });
      return;
    }
    setActive({ ...a, phase: 'settling' });
  }, [send, setActive, toast]);

  const subscribeInstrument = useCallback(
    (instrumentId: string) => {
      if (subscribedInstrumentRef.current === instrumentId && instTicksRef.current.length > 0) return;
      subscribedInstrumentRef.current = instrumentId;
      instTicksRef.current = [];
      setInstrumentResetKey(`${instrumentId}:${Date.now()}`);
      send('subscribe_instrument', { instrumentId }); // no-op if the socket is not open yet; re-sent on hello
    },
    [send],
  );

  const openDigit = useCallback(
    (input: OpenDigitInput): boolean => {
      if (!tokenRef.current) {
        toast.push({ tone: 'error', title: 'Log in to trade' });
        return false;
      }
      if (!sendTrade('open_digit', input)) {
        toast.push({ tone: 'error', title: 'Not connected', description: 'Reconnecting: try again shortly.' });
        return false;
      }
      digitAwaitingRef.current += 1;
      return true;
    },
    [send, toast],
  );

  const onDigitSettled = useCallback((cb: (s: DigitSettledData) => void) => {
    digitListenersRef.current.add(cb);
    return () => { digitListenersRef.current.delete(cb); };
  }, []);

  const onDigitRejected = useCallback((cb: (e: { code: string; message: string }) => void) => {
    digitRejectRef.current.add(cb);
    return () => { digitRejectRef.current.delete(cb); };
  }, []);

  const onDigitOpened = useCallback((cb: (e: { positionId: string; instrumentId: string }) => void) => {
    digitOpenedRef.current.add(cb);
    return () => { digitOpenedRef.current.delete(cb); };
  }, []);

  const openMultiplier = useCallback(
    (input: OpenMultiplierInput) => {
      if (!tokenRef.current) {
        toast.push({ tone: 'error', title: 'Log in to trade' });
        return;
      }
      if (!sendTrade('open_multiplier', input)) {
        toast.push({ tone: 'error', title: 'Not connected', description: 'Reconnecting: try again shortly.' });
      }
    },
    [send, toast],
  );

  const closeMultiplier = useCallback(
    (positionId: string) => {
      if (!send('close_multiplier', { positionId })) {
        toast.push({ tone: 'error', title: 'Not connected', description: 'Reconnecting: try again shortly.' });
      }
    },
    [send, toast],
  );

  const onMultiplier = useCallback((cb: (e: MultEvent) => void) => {
    multListenersRef.current.add(cb);
    return () => { multListenersRef.current.delete(cb); };
  }, []);

  // Pre-fill the tick buffer with a smooth synthetic history so the curve is
  // already full on load (never "fills in" from the right). Keeps emitting until
  // the first real tick arrives, then stands down so live data takes over.
  useEffect(() => {
    const curve = synthCurveRef.current ?? (synthCurveRef.current = makeSynthCurve(synthProfileRef.current));
    if (ticksRef.current.length === 0) {
      const now = Date.now();
      const origin = now - SYNTH_SPAN_MS;              // curve t=0 at the left edge of the seed window
      synthOriginRef.current = origin;
      const count = Math.floor(SYNTH_SPAN_MS / SYNTH_SPACING_MS);
      const seed: Tick[] = [];
      let prevRate = synthRate(curve(0));
      for (let i = count; i > 0; i--) {
        const t = now - i * SYNTH_SPACING_MS;
        const rate = synthRate(curve((t - origin) / 1000));
        seed.push({ t, rate, delta: rate - prevRate });
        prevRate = rate;
      }
      ticksRef.current = seed;
    }
    const id = setInterval(() => {
      if (realSeenRef.current) {
        clearInterval(id);
        return;
      }
      const buf = ticksRef.current;
      const t = Date.now();
      const prevRate = buf.length > 0 ? buf[buf.length - 1]!.rate : synthRate(curve(0));
      const rate = synthRate(curve((t - synthOriginRef.current) / 1000));
      buf.push({ t, rate, delta: rate - prevRate });
      if (buf.length > MAX_TICKS) buf.splice(0, buf.length - MAX_TICKS);
    }, SYNTH_SPACING_MS);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    closedRef.current = false;

    const clearTimers = () => {
      if (heartbeat.current) clearInterval(heartbeat.current);
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      heartbeat.current = null;
      reconnectTimer.current = null;
    };

    const pushTick = (t: Tick) => {
      const buf = ticksRef.current;
      buf.push(t);
      if (buf.length > MAX_TICKS) buf.splice(0, buf.length - MAX_TICKS);
    };

    const handle = (env_: Envelope) => {
      const data = env_.data;
      switch (env_.type) {
        case 'hello': {
          {
            const h = data as { tradeDate?: string; serverSeedHash?: string };
            logJournal('info', 'Network', `server ready: trade date ${h.tradeDate ?? '?'}, seed ${(h.serverSeedHash ?? '').slice(0, 12)}`);
          }
          const d = data as HelloData;
          if (d?.serverSeedHash) setFairness({ serverSeedHash: d.serverSeedHash, tradeDate: d.tradeDate });
          setEarlyCloseEnabled(d?.gameConfig?.earlyCloseEnabled === true);
          // Re-arm the instrument subscription after a (re)connect so the digits chart keeps streaming.
          if (subscribedInstrumentRef.current) send('subscribe_instrument', { instrumentId: subscribedInstrumentRef.current });
          // Same for the watch list: without this a reconnect left Market Watch frozen on the last
          // prices it saw before the drop, with no indication they had stopped moving.
          if (watchedRef.current.length > 0) send('subscribe_symbols', { symbols: [...watchedRef.current] });
          if (symbolsOutboxRef.current) { symbolsOutboxRef.current = false; send('symbols', {}); }
          break;
        }
        case 'tick': {
          if (isTick(data)) {
            realSeenRef.current = true;
            pushTick(data);
          }
          break;
        }
        case 'tick_batch': {
          const items = (data as { ticks?: unknown[] })?.ticks ?? [];
          for (const it of items)
            if (isTick(it)) {
              realSeenRef.current = true;
              pushTick(it);
            }
          break;
        }
        case 'game_config': {
          // The engine pushes this when an operator saves new limits. Invalidating the cached
          // GET /game/config makes stake bounds and round duration update in place, instead of
          // the player being rejected by limits their tab has not seen yet.
          void qc.invalidateQueries({ queryKey: ['gameConfig'] });
          break;
        }
        case 'online': {
          const d = data as OnlineData;
          if (typeof d?.count === 'number') setOnline(d.count);
          break;
        }
        case 'fairness': {
          const d = data as FairnessData;
          if (d?.serverSeedHash) setFairness({ serverSeedHash: d.serverSeedHash, tradeDate: d.tradeDate });
          break;
        }
        case 'balance': {
          const d = data as BalanceData;
          if (typeof d?.real === 'number') setWalletReal(d.real, d.currency, d.bonus);
          if (!authedRef.current) {
            // the auth answer: release trades queued while it was verified
            authedRef.current = true;
            authAnswered();
            const q = authQueueRef.current.splice(0);
            const ws = wsRef.current;
            for (const m of q) ws?.send(JSON.stringify({ type: m.type, data: m.data }));
          }
          break;
        }
        /**
         * What this user already had running when the socket authed, so a refresh does not hide it.
         *
         * A reload destroyed `activePosition`, which lives only in React state, and nothing re-asked
         * the engine. The contract kept running, its `position_update` frames kept arriving at the
         * new socket, and every one was dropped: that handler only ever MUTATES a position it
         * already has (`cur && cur.positionId === d.positionId`), so with nothing to attach them to
         * the live P/L, the countdown and `sellable` all went nowhere, and the trade settled into a
         * balance change the trader could not account for.
         *
         * Only taken when nothing is already active, so this can never overwrite an optimistic open
         * that the trader raised in this page's life: that one is reconciled by `position_opened`.
         * Pool and digit contracts are not here at all, because the engine holds those in their own
         * maps and this frame reports only rise/fall positions.
         */
        case 'open_positions': {
          const d = data as { positions?: readonly {
            positionId: string; direction: Direction; stakeCents: number; durationS: number;
            openedAtMs: number; expiresAtMs: number; entryRate: number; sellable: boolean;
            slPrice?: number | null; tpPrice?: number | null;
          }[] };
          const first = d.positions?.[0];
          /**
           * Two callers, and the difference matters.
           *
           * Normally this is the auth reply and is taken only when nothing is active, so it can
           * never overwrite an optimistic open the trader raised in this page's life: that one is
           * reconciled by `position_opened`.
           *
           * When the acknowledgement watchdog asked (`awaitingSync`), the optimistic open is exactly
           * what has to be resolved, and this frame is the authoritative answer to "did the engine
           * take my order". A PENDING position is adopted or dropped on its evidence; an ACKED one
           * is still never touched, because it already has the truth.
           */
          const pending = activeRef.current && !activeRef.current.positionId;
          const answeringWatchdog = awaitingSync.current && pending;
          if (answeringWatchdog) {
            awaitingSync.current = false;
            if (!first) {
              // The engine has nothing open for this user, so the order was never taken. Roll the
              // optimistic debit back and say so, rather than leaving money committed to nothing.
              logJournal('error', 'Trade', 'The server has no such position: the order was not taken');
              setActive(null);
              void qc.invalidateQueries({ queryKey: ['wallet'] });
              toast.push({ tone: 'error', title: 'Order not accepted', description: 'The server has no record of it. Your balance is unchanged.' });
              break;
            }
            logJournal('ok', 'Trade', `#${first.positionId.slice(0, 8)} confirmed by the server after a lost acknowledgement`);
          } else if (!first || activeRef.current) break;
          if (!answeringWatchdog) logJournal('ok', 'Trade', `#${first.positionId.slice(0, 8)} recovered after reconnect`);
          setActive({
            positionId: first.positionId,
            clientId: `srv${first.positionId}`,
            direction: first.direction,
            stakeCents: first.stakeCents,
            durationS: first.durationS,
            phase: 'open',
            entryRate: first.entryRate,
            expiresAtMs: first.expiresAtMs,
            /**
             * The live figures are the engine's and arrive on its next tick, which is within one
             * tick interval. Seeded neutral rather than guessed: a multiplier invented here would
             * print a P/L the engine never said, for as long as it took the first update to land.
             */
            liveMultiplier: 1,
            livePnlCents: 0,
            secondsLeft: Math.max(0, Math.round((first.expiresAtMs - Date.now()) / 1000)),
            sellable: first.sellable,
            // The stop the ENGINE still holds. A refreshed tab gets its levels back because the
            // engine never lost them, which is the whole reason they live there.
            slPrice: first.slPrice ?? null,
            tpPrice: first.tpPrice ?? null,
          });
          break;
        }
        case 'position_opened': {
          {
            const o = data as { positionId?: string; direction?: string; stakeCents?: number; entryRate?: number };
            logJournal('ok', 'Trade', `#${(o.positionId ?? '').slice(0, 8)} ${o.direction} accepted at ${o.entryRate?.toFixed?.(6) ?? '?'}`);
          }
          const d = data as PositionOpenedData;
          clearOpenAck(); // acknowledged: the watchdog has nothing left to guard
          setActive((cur) => ({
            positionId: d.positionId,
            clientId: cur?.clientId ?? `srv${d.positionId}`,
            direction: d.direction,
            stakeCents: d.stakeCents,
            durationS: d.durationS,
            phase: 'open',
            entryRate: d.entryRate,
            expiresAtMs: d.expiresAtMs,
            liveMultiplier: cur?.liveMultiplier ?? 1,
            livePnlCents: cur?.livePnlCents ?? 0,
            secondsLeft: cur?.secondsLeft ?? d.durationS,
            sellable: cur?.sellable ?? false,
            // What the engine ACTUALLY took, which can differ from what was asked (a level it
            // refused comes back null). The ack is the truth, not the optimistic copy above.
            slPrice: d.slPrice ?? null,
            tpPrice: d.tpPrice ?? null,
          }));
          /**
           * No popup on a terminal brand, because MetaTrader has none.
           *
           * MetaQuotes is specific about where a result goes: "Once an order is sent, its execution
           * results will appear IN THE WINDOW: either confirmation of a successful trade or a
           * rejection with the reason specified." A confirmation is the order screen's own, and
           * after it the position itself is the confirmation — it appears on the Trade tab, in the
           * live position panel, and as a level on the chart.
           *
           * A floating card over the ticket was not only absent from MetaTrader, it painted in this
           * app's brand palette (`bg-up/10`, an accent dot), so on a green brand it arrived as a
           * green panel over MetaTrader's grey. Its wording was not MetaTrader's either: it called
           * the expiry an "Auto-sell".
           *
           * REJECTIONS still raise one, on every shell, because MetaTrader reports those: that is
           * the other half of the sentence above. They render in MetaTrader's own colours on a
           * terminal screen; see ToastProvider.
           */
          if (!terminalRef.current) {
            toast.push({
              tone: 'info',
              title: `Opened · ${d.direction === 'buy' ? 'BUY' : 'SELL'} ${formatKes(d.stakeCents)}`,
              description: `Auto-sell in ${d.durationS}s`,
            });
          }
          break;
        }
        /**
         * The engine's answer to Modify position: what it NOW holds.
         *
         * Taken as the truth rather than merged with the local request. Two devices can both move a
         * stop, and the one that lost should show the level that will actually fire, not its own.
         */
        case 'levels_set': {
          const d = data as { positionId?: string; slPrice?: number | null; tpPrice?: number | null };
          setActive((cur) => (cur && cur.positionId === d.positionId
            ? { ...cur, slPrice: d.slPrice ?? null, tpPrice: d.tpPrice ?? null }
            : cur));
          break;
        }
        case 'position_update': {
          const d = data as PositionUpdateData;
          setActive((cur) =>
            cur && cur.positionId === d.positionId
              ? {
                  ...cur,
                  phase: cur.phase === 'settling' ? 'settling' : 'open',
                  liveMultiplier: d.liveMultiplier,
                  livePnlCents: d.livePnlCents,
                  secondsLeft: d.secondsLeft,
                  sellable: d.sellable,
                }
              : cur,
          );
          break;
        }
        case 'position_settled': {
          {
            const d2 = data as { positionId?: string; result?: string; pnlCents?: number; mode?: string };
            logJournal(d2.result === 'win' ? 'ok' : 'info', 'Trade',
              `#${(d2.positionId ?? '').slice(0, 8)} closed ${d2.result} (${d2.mode}) p/l ${((d2.pnlCents ?? 0) / 100).toFixed(2)}`);
          }
          const d = data as PositionSettledData;
          // The side, for the close report. The engine states it on the settle; the local position
          // is only a fallback for an engine that predates that field, and it may itself be gone
          // (a settle arriving after a reconnect has no local position at all).
          const local = activeRef.current;
          const closedDirection = d.direction
            ?? (local && local.positionId === d.positionId ? local.direction : undefined);
          setActive((cur) => (cur && cur.positionId === d.positionId ? null : cur));
          if (typeof d.balance === 'number') setWalletReal(d.balance);
          void qc.invalidateQueries({ queryKey: ['positions'] });
          void qc.invalidateQueries({ queryKey: ['ledger'] });
          // Refresh real + bonus + wagering progress: a settle can spend/convert bonus funds
          // (migration 0094), and only /wallet carries the authoritative bonus + wagering figures.
          void qc.invalidateQueries({ queryKey: ['wallet'] });

          const won = d.result === 'win';
          // stake is recoverable from the authoritative figures: payout − pnl.
          const stakeCents = Math.max(0, Math.round(d.payoutCents - d.pnlCents));
          const mult = d.lockedMultiplier;
          // Prefer the engine's engagement presentation; fall back to a safe local derivation.
          const headline =
            d.presentation?.headline ??
            (won ? (mult >= 2.5 ? 'big_win' : mult < 1.25 ? 'small_win' : 'win') : 'loss');
          useOutcomeFx.getState().show({
            result: d.result,
            headline,
            nearMiss: d.presentation?.nearMiss ?? false,
            lossDisguisedAsWin: d.presentation?.lossDisguisedAsWin ?? (won && mult < 1.25),
            lockedMultiplier: mult,
            payoutCents: d.payoutCents,
            pnlCents: d.pnlCents,
            stakeCents,
            mode: d.mode,
            ticket: d.positionId,
            direction: closedDirection,
          });
          break;
        }
        case 'news': {
          const d = data as NewsReply;
          for (const w of newsWaitersRef.current.splice(0)) { clearTimeout(w.timer); w.resolve(d); }
          break;
        }
        case 'anchors': {
          const d = data as AnchorsReply & { reqId?: string };
          if (d.reqId) settleAnchorWaiter(d.reqId, { ok: d });
          break;
        }
        case 'candles': {
          const d = data as CandlesReply & { reqId?: string; symbol?: string };
          // Only the brand's DEFAULT symbol may set the shared market axis. A chart that has been
          // switched to another symbol would otherwise re-anchor the price strip, the order ticket
          // and every open position's P/L onto an instrument nothing was traded on.
          if (d.instrument && d.anchor && (marketRef.current === null || d.instrument.symbol === marketRef.current.instrument.symbol)) {
            marketRef.current = { instrument: d.instrument, anchor: d.anchor };
          }
          if (d.reqId) settleCandleWaiter(d.reqId, { ok: d });
          break;
        }
        case 'symbols': {
          const d = data as SymbolsReply;
          for (const w of symbolsWaitersRef.current.splice(0)) { clearTimeout(w.timer); w.resolve(d); }
          break;
        }
        case 'subscribed_symbols': {
          const d = data as { symbols?: string[]; rejected?: string[]; max?: number };
          // A rejected symbol is worth saying out loud rather than leaving as a row that never
          // quotes: the Journal is where this app explains itself.
          if (d.rejected && d.rejected.length > 0) {
            logJournal('warn', 'Quotes', `not quoted (${d.rejected.length} of ${(d.symbols?.length ?? 0) + d.rejected.length}, cap ${d.max ?? '?'}): ${d.rejected.slice(0, 6).join(', ')}`);
          }
          break;
        }
        case 'symbol_quote': {
          // The seed for one symbol: what it is, where its axis sits, and a first price. Everything
          // the tick stream sends afterwards is read against this.
          const d = data as { symbol: string; instrument: MarketSymbol; anchor: SymbolQuote['anchor']; rate: number; t: number };
          if (!d.symbol || !d.instrument || !d.anchor) break;
          if (!watchedRef.current.includes(d.symbol)) break;
          const price = d.anchor.base + d.instrument.scale * (valueOfRate(d.rate) - d.anchor.openValue);
          const prev = quotesRef.current.get(d.symbol);
          quotesRef.current.set(d.symbol, {
            symbol: d.symbol, instrument: d.instrument, anchor: d.anchor, rate: d.rate, price, t: d.t,
            // A re-seed after a reconnect keeps the colour it had, so the whole list does not flash,
            // and the day's range it already had, which the next tick refreshes anyway.
            up: prev?.up ?? null, changedAt: prev?.changedAt ?? null,
            dayHigh: prev?.dayHigh ?? null, dayLow: prev?.dayLow ?? null,
          });
          break;
        }
        case 'symbol_ticks': {
          const d = data as {
            t: number;
            quotes?: Array<{ symbol: string; rate: number; delta: number; high?: number; low?: number }>;
          };
          for (const q of d.quotes ?? []) {
            const prev = quotesRef.current.get(q.symbol);
            // No seed yet means no anchor, and a rate without its anchor cannot be priced. Dropping
            // it is right: the seed is on its way.
            if (!prev) continue;
            const price = prev.anchor.base + prev.instrument.scale * (valueOfRate(q.rate) - prev.anchor.openValue);
            const moved = price !== prev.price;
            quotesRef.current.set(q.symbol, {
              ...prev, rate: q.rate, price, t: d.t,
              up: moved ? price > prev.price : prev.up,
              changedAt: moved ? Date.now() : prev.changedAt,
              // Already prices: the engine maps them through the day's anchor, where it lives.
              // Kept from the previous quote when absent, so an engine that does not send them
              // leaves the row without an `H:`/`L:` rather than blanking one it had.
              dayHigh: typeof q.high === 'number' ? q.high : prev.dayHigh,
              dayLow: typeof q.low === 'number' ? q.low : prev.dayLow,
            });
          }
          break;
        }
        // ── Phase 2: instrument stream + digit settlements ────────────────────────────────────
        case 'inst_history': {
          const d = data as { instrumentId: string; ticks: Array<{ t: number; quote: number; digit: number }> };
          if (d.instrumentId !== subscribedInstrumentRef.current) break;
          let prev = d.ticks[0]?.quote ?? 0;
          instTicksRef.current = d.ticks.map((x) => {
            const t: InstrumentTick = { t: x.t, rate: x.quote, delta: x.quote - prev };
            prev = x.quote;
            return t;
          });
          setInstrumentResetKey(`${d.instrumentId}:${d.ticks[d.ticks.length - 1]?.t ?? Date.now()}`);
          break;
        }
        case 'inst_tick': {
          const d = data as { instrumentId: string; t: number; quote: number; digit: number };
          if (d.instrumentId !== subscribedInstrumentRef.current) break;
          const buf = instTicksRef.current;
          const prev = buf.length > 0 ? buf[buf.length - 1]!.rate : d.quote;
          buf.push({ t: d.t, rate: d.quote, delta: d.quote - prev });
          if (buf.length > MAX_TICKS) buf.splice(0, buf.length - MAX_TICKS);
          break;
        }
        case 'digit_opened': {
          digitAwaitingRef.current = Math.max(0, digitAwaitingRef.current - 1);
          const d = data as { positionId: string; instrumentId: string };
          digitOpenedRef.current.forEach((cb) => { try { cb(d); } catch { /* non-fatal */ } });
          break;
        }
        case 'digit_settled': {
          const d = data as DigitSettledData;
          if (typeof d.balance === 'number') setWalletReal(d.balance);
          void qc.invalidateQueries({ queryKey: ['wallet'] });
          void qc.invalidateQueries({ queryKey: ['positions'] });
          void qc.invalidateQueries({ queryKey: ['ledger'] });
          digitListenersRef.current.forEach((cb) => { try { cb(d); } catch { /* listener error is non-fatal */ } });
          break;
        }
        case 'mult_opened': {
          const d = data as MultOpenedData;
          multListenersRef.current.forEach((cb) => { try { cb({ type: 'opened', data: d }); } catch { /* non-fatal */ } });
          break;
        }
        case 'mult_update': {
          const d = data as MultUpdateData;
          multListenersRef.current.forEach((cb) => { try { cb({ type: 'update', data: d }); } catch { /* non-fatal */ } });
          break;
        }
        case 'mult_closed': {
          const d = data as MultClosedData;
          if (typeof d.balance === 'number') setWalletReal(d.balance);
          void qc.invalidateQueries({ queryKey: ['wallet'] });
          void qc.invalidateQueries({ queryKey: ['positions'] });
          void qc.invalidateQueries({ queryKey: ['ledger'] });
          multListenersRef.current.forEach((cb) => { try { cb({ type: 'closed', data: d }); } catch { /* non-fatal */ } });
          break;
        }
        case 'error': {
          const d = data as WsErrorData & { reqId?: string };
          // A candle request that failed (bad timeframe, a line brand with no candles) must reject
          // its own promise rather than surface as a toast meant for trading errors.
          if (d.reqId) { settleCandleWaiter(d.reqId, { err: new Error(d.code) }); break; }
          logJournal('error', 'Server', `${d.code}${d.message ? `: ${d.message}` : ''}`);
          // Signed in but the socket forgot us (restart / race): authenticate again, quietly.
          if (d.code === 'AUTH_REQUIRED' && tokenRef.current) {
            authedRef.current = false;
            if (send('auth', { token: tokenRef.current })) armAuthTimer();
          }
          if (d.code === 'AUTH_INVALID' || d.code === 'AUTH_SITE_MISMATCH') {
            // auth will not come: nothing queued behind it may wait
            authAnswered();
            dropQueued(d.code);
          } else if (d.code === 'ENGINE_ERROR' && authTimerRef.current && !authedRef.current) {
            // the engine bound us, then failed to read the wallet for its reply: we ARE signed in
            authedRef.current = true;
            authAnswered();
            const ws = wsRef.current;
            for (const m of authQueueRef.current.splice(0)) ws?.send(JSON.stringify({ type: m.type, data: m.data }));
          }
          // BUGLOG #85: a refused digit open used to leave the screen "in play" forever. Only errors an
          // open can produce count (a stray error from another request must not clear a live contract).
          if (digitAwaitingRef.current > 0 && /^(ENGINE_ERROR|AUTH_|SYSTEM_DISABLED|INVALID_INSTRUMENT)/.test(String(d.code ?? '')))
            rejectDigit(String(d.code ?? ''), String(d.message ?? ''));
          const a = activeRef.current;
          if (a && !a.positionId) {
            // optimistic open refused → roll back and re-sync balance
            clearOpenAck();
            setActive(null);
            void qc.invalidateQueries({ queryKey: ['wallet'] });
          } else if (a && a.phase === 'settling') {
            // cash-out failed → restore so the user can retry / let it auto-settle
            setActive({ ...a, phase: 'open' });
          }
          const title = errorTitle(/^INSUFFICIENT_FUNDS/.test(String(d.message ?? '')) ? 'INSUFFICIENT_FUNDS' : d.code);
          const detail = friendlyError(d.message, d.reasons, fmtRef.current);
          // Recorded for the order window, which is where MetaTrader puts a rejection.
          setLastTradeError({ code: String(d.code ?? ''), title, detail, at: Date.now() });
          /**
           * The popup only where nothing else will say it.
           *
           * An order window that is waiting prints this same rejection itself, in MetaTrader's own
           * place for it: "its execution results will appear in the window". Raising a card over
           * that window is one tap answered twice, in two different visual languages. Where no
           * window is waiting — the one-click panel firing instantly, the desktop shell, a refusal
           * that is nobody's order — the popup is the only surface a rejection has and it stays.
           */
          if (!orderWindowWaiting()) toast.push({ tone: 'error', title, description: detail });
          break;
        }
        default:
          break; // pong / unknown frames are ignored
      }
    };

    const connect = () => {
      if (closedRef.current) return;
      setStatus('connecting');
      let ws: WebSocket;
      try {
        ws = new WebSocket(wsUrlForSite(env.wsUrl, siteRef.current));
      } catch {
        scheduleReconnect();
        return;
      }
      wsRef.current = ws;

      ws.onopen = () => {
        attemptRef.current = 0;
        authedRef.current = false;
        setStatus('open');
        logJournal('ok', 'Network', 'connected to the trade server');
        // Chart history asked for before the socket was ready (see candleOutboxRef).
        for (const frame of candleOutboxRef.current.splice(0)) ws.send(JSON.stringify({ type: 'candles', data: frame }));
        for (const frame of newsOutboxRef.current.splice(0)) ws.send(JSON.stringify({ type: 'news', data: frame }));
        for (const frame of anchorOutboxRef.current.splice(0)) ws.send(JSON.stringify({ type: 'anchors', data: frame }));
        if (tokenRef.current) { ws.send(JSON.stringify({ type: 'auth', data: { token: tokenRef.current } })); armAuthTimer(); }
        // Heartbeat + dead-socket check (BUGLOG #92): on a network switch a socket can stay "OPEN" for
        // minutes while nothing arrives. A ping every 6 s guarantees a frame (pong) even on a brand with a
        // slow tick rate, so 12 s of silence = a dead socket = reconnect.
        lastFrameAtRef.current = Date.now();
        let beats = 0;
        heartbeat.current = setInterval(() => {
          if (ws.readyState !== ws.OPEN) return;
          if (Date.now() - lastFrameAtRef.current > 12_000) { try { ws.close(); } catch { /* ignore */ } return; }
          if (++beats % 2 === 0) ws.send(JSON.stringify({ type: 'ping', data: {} }));
        }, 3_000);
      };

      ws.onmessage = (ev) => {
        lastFrameAtRef.current = Date.now();
        let parsed: Envelope;
        try {
          parsed = JSON.parse(typeof ev.data === 'string' ? ev.data : '') as Envelope;
        } catch {
          return;
        }
        if (parsed && typeof parsed.type === 'string') handle(parsed);
      };

      ws.onclose = () => {
        if (heartbeat.current) clearInterval(heartbeat.current);
        heartbeat.current = null;
        authedRef.current = false;
        // acks for opens in flight on this socket will never come (BUGLOG #85/#92); queued ones are
        // dropped just below (each told once)
        const queuedDigits = authQueueRef.current.filter((m) => m.type === 'open_digit').length;
        const inflight = Math.max(0, digitAwaitingRef.current - queuedDigits);
        for (let i = 0; i < inflight; i++) rejectDigit('NOT_CONNECTED', '');
        // queued trades never left: nobody may wait for them
        authAnswered();
        dropQueued('NOT_CONNECTED');
        candleOutboxRef.current.length = 0;
        newsOutboxRef.current.length = 0;
        anchorOutboxRef.current.length = 0;
        for (const [id] of anchorWaitersRef.current) settleAnchorWaiter(id, { err: new Error('SOCKET_CLOSED') });
        for (const w of newsWaitersRef.current.splice(0)) { clearTimeout(w.timer); w.reject(new Error('NOT_CONNECTED')); }
        dropCandleWaiters('NOT_CONNECTED');
        digitAwaitingRef.current = 0;
        if (!closedRef.current) {
          setStatus('closed');
          logJournal('warn', 'Network', 'disconnected: reconnecting');
          scheduleReconnect();
        }
      };

      ws.onerror = () => {
        try {
          ws.close();
        } catch {
          /* ignore */
        }
      };
    };

    const scheduleReconnect = () => {
      if (closedRef.current) return;
      const n = attemptRef.current++;
      const delay = Math.min(1000 * 2 ** n, 10_000) + Math.random() * 500;
      reconnectTimer.current = setTimeout(connect, delay);
    };

    connect();

    return () => {
      closedRef.current = true;
      clearTimers();
      const ws = wsRef.current;
      if (ws && (ws.readyState === ws.OPEN || ws.readyState === ws.CONNECTING)) ws.close();
      wsRef.current = null;
    };
    // socket lifecycle is mount-scoped; stable callbacks/refs are intentionally omitted
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Token changes. Sign-in on an open socket: authenticate it (trades wait for the answer). Sign-out
  // or a different account (BUGLOG #93): the socket was bound to the previous user and kept receiving
  // their balance and settlements — reconnect it, and drop that user's cached wallet/history/session.
  const prevTokenRef = useRef<string | null>(token);
  useEffect(() => {
    const prev = prevTokenRef.current;
    prevTokenRef.current = token;
    if (prev === token) return;
    const ws = wsRef.current;
    if (prev && prev !== token && subOf(prev) !== subOf(token)) {
      authedRef.current = false;
      // caches and session stores are dropped app-wide by SessionCacheGuard
      if (ws && (ws.readyState === ws.OPEN || ws.readyState === ws.CONNECTING)) { ws.close(); return; } // onclose reconnects; onopen authenticates
    }
    if (token && ws && ws.readyState === ws.OPEN) {
      authedRef.current = false;
      ws.send(JSON.stringify({ type: 'auth', data: { token } }));
      armAuthTimer();
    }
  }, [token]);

  // Perf (BUGLOG #92): the value used to be a new object every render, and `online` changes on every
  // connect/disconnect across the brand — re-rendering the whole trade screen and chart each time.
  const apiValue = useMemo<GameSocketApi>(() => ({
    getTicks, getLastTick, openPosition, setLevels, sell, getInstrumentTicks, getLastInstrumentTick, subscribeInstrument,
    openDigit, onDigitSettled, onDigitRejected, onDigitOpened, openMultiplier, closeMultiplier, onMultiplier,
    requestCandles, getMarket, requestNews, requestAnchors,
    requestSymbols, subscribeSymbols, getSymbolQuote,
  }), [getTicks, getLastTick, openPosition, setLevels, sell, getInstrumentTicks, getLastInstrumentTick, subscribeInstrument,
    openDigit, onDigitSettled, onDigitRejected, onDigitOpened, openMultiplier, closeMultiplier, onMultiplier,
    requestCandles, getMarket, requestNews, requestAnchors,
    requestSymbols, subscribeSymbols, getSymbolQuote]);
  const stateValue = useMemo<GameSocketState>(() => ({ status, online, fairness, activePosition, earlyCloseEnabled, lastTradeError }), [status, online, fairness, activePosition, earlyCloseEnabled, lastTradeError]);

  return (
    <ApiCtx.Provider value={apiValue}>
      <StateCtx.Provider value={stateValue}>
        <InstKeyCtx.Provider value={instrumentResetKey}>
          {children}
        </InstKeyCtx.Provider>
      </StateCtx.Provider>
    </ApiCtx.Provider>
  );
}

export function useGameSocket(): GameSocketValue {
  const api = useContext(ApiCtx);
  const state = useContext(StateCtx);
  const instrumentResetKey = useContext(InstKeyCtx);
  if (!api || !state) throw new Error('useGameSocket must be used within <GameSocketProvider>');
  return { ...api, ...state, instrumentResetKey };
}

/** Only the stable trading/buffer functions: no re-render on status/online/position changes. */
export function useGameSocketApi(): GameSocketApi {
  const api = useContext(ApiCtx);
  if (!api) throw new Error('useGameSocketApi must be used within <GameSocketProvider>');
  return api;
}

/** Bumps when the subscribed instrument (re)seeds. */
export function useInstrumentResetKey(): string { return useContext(InstKeyCtx); }
