/**
 * MetaTrader's analytical OBJECTS — the drawing tools — as data and geometry.
 *
 * The chart's left rail used to be decoration: eight icons that drew nothing. This is what they
 * draw. `lightweight-charts` has no drawing primitives at all (it renders series and nothing else),
 * so every object is stored here in CHART space — a time and a price per anchor — and projected to
 * pixels at paint time. That is the whole reason objects stay pinned to the bars they were drawn
 * against when the chart is panned or zoomed; anchoring them in pixels would slide them off the
 * price the moment the view moved.
 *
 * Everything in this file is pure, so the arithmetic that actually matters — where a Fibonacci level
 * sits, what a pitchfork's parallels are, what a measurement reports — is tested without a browser.
 */

/** One anchor of a drawing, in the chart's own coordinates. */
export interface Anchor {
  /** Epoch SECONDS, matching lightweight-charts' UTCTimestamp. */
  time: number;
  price: number;
}

export type DrawingKind = 'trend' | 'horizontal' | 'fib' | 'pitchfork' | 'text' | 'measure';

export interface Drawing {
  id: string;
  kind: DrawingKind;
  /** 1 anchor for horizontal/text, 2 for trend/fib/measure, 3 for a pitchfork. */
  points: Anchor[];
  /** `text` only. */
  label?: string;
  color: string;
}

/** How many anchors each tool needs before the object is complete. */
export const ANCHORS_NEEDED: Record<DrawingKind, number> = {
  horizontal: 1,
  text: 1,
  trend: 2,
  fib: 2,
  measure: 2,
  pitchfork: 3,
};

/** The tools on the rail. `cursor` and `crosshair` draw nothing; `trash` is an action. */
export type ToolId = 'cursor' | 'crosshair' | DrawingKind | 'trash';

export interface ToolDef {
  id: ToolId;
  label: string;
  /** SVG path data on a 24×24 viewBox. */
  icon: string;
}

/** MetaTrader's own object list, in the order its toolbar carries them. */
export const TOOLS: readonly ToolDef[] = [
  { id: 'cursor', label: 'Cursor', icon: 'M5 3l6 14 2-6 6-2z' },
  { id: 'crosshair', label: 'Crosshair', icon: 'M12 3v18M3 12h18' },
  { id: 'trend', label: 'Trend line', icon: 'M4 20L20 4' },
  { id: 'horizontal', label: 'Horizontal line', icon: 'M3 12h18' },
  { id: 'pitchfork', label: 'Andrews pitchfork', icon: 'M5 19l4-9 3 5 3-8 4 12' },
  { id: 'fib', label: 'Fibonacci retracement', icon: 'M6 4v16M18 4v16M3 9h18M3 15h18' },
  { id: 'text', label: 'Text', icon: 'M4 7h16M4 12h10M4 17h16' },
  { id: 'measure', label: 'Measure', icon: 'M7 4h10l-5 16z' },
];

/**
 * Fibonacci retracement ratios, as MetaTrader draws them.
 *
 * 0 is the second anchor and 1 the first, so dragging from a low to a high puts 0% at the high —
 * which is the direction a retracement is read in.
 */
export const FIB_LEVELS: readonly number[] = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];

export interface FibLine { ratio: number; price: number; label: string }

/** The price each Fibonacci level sits at, between two anchors. */
export function fibLines(a: Anchor, b: Anchor): FibLine[] {
  return FIB_LEVELS.map((ratio) => ({
    ratio,
    // ratio 0 lands on `b` (where the drag ended) and 1 on `a`, so a drag low→high reads top-down.
    price: b.price + (a.price - b.price) * ratio,
    label: `${(ratio * 100).toFixed(ratio === 0 || ratio === 1 || ratio === 0.5 ? 0 : 1)}%`,
  }));
}

export interface Line { from: Anchor; to: Anchor }

/**
 * Andrews pitchfork from three anchors: the handle runs from the first pivot to the midpoint of the
 * other two, and the two tines run parallel to it from each of those.
 *
 * Each line is returned with its far end extended well beyond the third anchor, because a pitchfork
 * is used for where price is GOING; a fork that stops at the last pivot says nothing about that.
 */
export function pitchforkLines(a: Anchor, b: Anchor, c: Anchor, extend = 3): { median: Line; upper: Line; lower: Line } {
  const mid: Anchor = { time: (b.time + c.time) / 2, price: (b.price + c.price) / 2 };
  const dt = mid.time - a.time;
  const dp = mid.price - a.price;
  const far = (from: Anchor): Anchor => ({ time: from.time + dt * extend, price: from.price + dp * extend });
  return {
    median: { from: a, to: far(a) },
    upper: { from: b, to: far(b) },
    lower: { from: c, to: far(c) },
  };
}

export interface Measurement {
  /** Price change from the first anchor to the second. */
  delta: number;
  /** …as a percentage of the first anchor's price. */
  percent: number;
  /** Seconds between the anchors (always positive). */
  seconds: number;
  /** Bars between the anchors at the given timeframe, when one is known. */
  bars: number | null;
  up: boolean;
}

/** What MetaTrader's measure tool reports: how far, how much, how long. */
export function measure(a: Anchor, b: Anchor, barSeconds?: number): Measurement {
  const delta = b.price - a.price;
  const seconds = Math.abs(b.time - a.time);
  return {
    delta,
    percent: a.price === 0 ? 0 : (delta / a.price) * 100,
    seconds,
    bars: barSeconds && barSeconds > 0 ? Math.round(seconds / barSeconds) : null,
    up: delta >= 0,
  };
}

/** A duration as MetaTrader writes it on the measure label. */
export function humanDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  if (seconds < 86_400) return `${(seconds / 3600).toFixed(seconds % 3600 === 0 ? 0 : 1)}h`;
  return `${(seconds / 86_400).toFixed(seconds % 86_400 === 0 ? 0 : 1)}d`;
}

// ───────────────────────────── selection ─────────────────────────────

export interface Point { x: number; y: number }

/** Shortest distance from `p` to the segment `a`–`b`, in pixels. */
export function distanceToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  // Project p onto the segment, clamped to its ends.
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/**
 * Which drawing is under the pointer, if any — the nearest within `tolerance` pixels.
 *
 * Takes already-projected segments rather than chart coordinates, because hit-testing has to happen
 * in the space the finger is in: a line that is 2px away on screen is 2px away whatever price scale
 * it was drawn on.
 */
export function hitTest(
  p: Point,
  segments: ReadonlyArray<{ id: string; a: Point; b: Point }>,
  tolerance = 8,
): string | null {
  let best: { id: string; d: number } | null = null;
  for (const s of segments) {
    const d = distanceToSegment(p, s.a, s.b);
    if (d <= tolerance && (best === null || d < best.d)) best = { id: s.id, d };
  }
  return best?.id ?? null;
}

// ───────────────────────────── persistence ─────────────────────────────

const KEY = 'pp-chart-drawings';
const MAX_PER_SYMBOL = 200;

/** Drawings survive a reload, as MetaTrader's objects survive closing the terminal. Per symbol. */
export function storageKey(symbol: string): string { return `${KEY}:${symbol}`; }

/** Parse stored drawings, discarding anything malformed rather than throwing on a bad value. */
export function parseDrawings(raw: string | null): Drawing[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isDrawing).slice(0, MAX_PER_SYMBOL);
  } catch {
    return [];
  }
}

function isDrawing(v: unknown): v is Drawing {
  if (typeof v !== 'object' || v === null) return false;
  const d = v as Partial<Drawing>;
  if (typeof d.id !== 'string' || typeof d.color !== 'string') return false;
  if (typeof d.kind !== 'string' || !(d.kind in ANCHORS_NEEDED)) return false;
  if (!Array.isArray(d.points) || d.points.length === 0) return false;
  return d.points.every((p) => typeof p?.time === 'number' && typeof p?.price === 'number'
    && Number.isFinite(p.time) && Number.isFinite(p.price));
}

/** Serialise for storage, capped so a long session cannot grow the key without bound. */
export function serializeDrawings(drawings: readonly Drawing[]): string {
  return JSON.stringify(drawings.slice(-MAX_PER_SYMBOL));
}
